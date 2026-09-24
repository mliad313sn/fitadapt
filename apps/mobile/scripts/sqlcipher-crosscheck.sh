#!/usr/bin/env bash
# M04 / ADR-020 evidence: the SQLCipher stand-in used by the jest tests
# (better-sqlite3-multiple-ciphers in SQLCipher 4 mode, __tests__/sqlcipher-double.ts)
# writes files that the SQLCipher expo-sqlite compiles into the app (vendor/sqlcipher,
# built as Android does: OpenSSL crypto) opens with the same raw key, and the reverse;
# a wrong key or no key opens neither. Needs a C compiler and the OpenSSL headers.
# Not part of `pnpm -w test` (no compiler in CI images); run by hand:
#   bash apps/mobile/scripts/sqlcipher-crosscheck.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VENDOR="$ROOT/node_modules/expo-sqlite/vendor/sqlcipher"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cat > "$WORK/shell.c" <<'C'
#include <stdio.h>
#include "sqlite3.h"
static int cb(void *u, int n, char **v, char **c) { for (int i = 0; i < n; i++) printf("%s=%s ", c[i], v[i] ? v[i] : "NULL"); printf("\n"); return 0; }
int main(int argc, char **argv) {
  sqlite3 *db; char *err = 0; int rc = 0;
  if (exsqlite3_open(argv[1], &db)) { printf("open failed\n"); return 1; }
  for (int i = 2; i < argc; i++) if (exsqlite3_exec(db, argv[i], cb, 0, &err)) { printf("ERR %s\n", err); rc = 2; }
  exsqlite3_close(db);
  return rc;
}
C
gcc -O1 -w -D_GNU_SOURCE -include stdint.h -I"$VENDOR" -DSQLITE_HAS_CODEC=1 -DSQLITE_EXTRA_INIT=sqlcipher_extra_init \
  -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown -DSQLCIPHER_CRYPTO_OPENSSL -DNDEBUG -DSQLITE_TEMP_STORE=2 \
  "$WORK/shell.c" "$VENDOR/sqlite3.c" -o "$WORK/sqlcipher" -lcrypto -lpthread -ldl -lm
KEY="x'$(printf 'ab%.0s' $(seq 32))'"
WRONG="x'$(printf '00%.0s' $(seq 32))'"
echo "expo-sqlite vendored: $("$WORK/sqlcipher" "$WORK/v.db" 'PRAGMA cipher_version;')"
node -e "
const Database = require('$ROOT/node_modules/better-sqlite3-multiple-ciphers');
const db = new Database('$WORK/from-standin.db');
db.pragma(\"cipher = 'sqlcipher'\"); db.pragma('legacy = 4');
db.exec(\`PRAGMA key = \"$KEY\"\`);
db.exec(\"CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('CANARY-from-standin')\");
db.close();"
echo "real SQLCipher reads the stand-in's file: $("$WORK/sqlcipher" "$WORK/from-standin.db" "PRAGMA key = \"$KEY\";" 'SELECT x FROM t;' | tail -n 1)"
"$WORK/sqlcipher" "$WORK/from-sqlcipher.db" "PRAGMA key = \"$KEY\";" "CREATE TABLE u (x TEXT); INSERT INTO u VALUES ('CANARY-from-sqlcipher');" > /dev/null
node -e "
const Database = require('$ROOT/node_modules/better-sqlite3-multiple-ciphers');
const db = new Database('$WORK/from-sqlcipher.db');
db.pragma(\"cipher = 'sqlcipher'\"); db.pragma('legacy = 4');
db.exec(\`PRAGMA key = \"$KEY\"\`);
console.log('stand-in reads the real SQLCipher file: x=' + db.prepare('SELECT x FROM u').get().x);
db.close();"
echo "wrong key: $("$WORK/sqlcipher" "$WORK/from-standin.db" "PRAGMA key = \"$WRONG\";" 'SELECT x FROM t;' 2>/dev/null | tail -n 1)"
echo "no key:    $("$WORK/sqlcipher" "$WORK/from-sqlcipher.db" 'SELECT x FROM u;' 2>/dev/null | tail -n 1)"
for f in from-standin.db from-sqlcipher.db; do
  if grep -q CANARY "$WORK/$f"; then echo "FAIL: plaintext in $f"; exit 1; fi
  if head -c 16 "$WORK/$f" | grep -q 'SQLite format 3'; then echo "FAIL: SQLite header in $f"; exit 1; fi
done
echo "no plaintext and no SQLite header in either file: OK"
