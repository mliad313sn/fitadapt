/** Integration tests read their services from the environment (see .env.example). */
export function integrationEnv() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) and REDIS_URL; see .env.example');
  }
  const dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    // The suite resets the schema: refuse to touch anything but a *_test database.
    throw new Error(`Refusing to run integration tests against "${dbName}": use a database whose name ends in _test`);
  }
  return { databaseUrl, redisUrl };
}
