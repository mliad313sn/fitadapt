// @ts-check
/**
 * Pinned gitleaks release (MIT) used for secret scanning, verified by SHA-256
 * before it runs. The binary is a CI tool downloaded at run time, not a
 * dependency of the product. Update version and checksums together from the
 * release's checksums.txt.
 */
export const GITLEAKS_VERSION = '8.28.0';

/** SHA-256 of each release archive, from gitleaks_8.28.0_checksums.txt. */
export const GITLEAKS_SHA256 = Object.freeze({
  linux_x64: 'a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb',
  linux_arm64: 'eff65261156100e5d94a6b3dec313d532fddfe19ae1590bf7a2b4f2699128356',
  darwin_x64: 'edf5a507008b0d2ef4959575772772770586409c1f6f74dabf19cbe7ec341ced',
  darwin_arm64: 'd942f3ad147250c9edbaab3fed9e482f98d3b59ba10ae97b8d75647e3ade492c',
});

/**
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {{ key: keyof typeof GITLEAKS_SHA256, url: string, sha256: string }}
 */
export function gitleaksAsset(platform, arch) {
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : null;
  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (!os || !cpu) throw new Error(`no pinned gitleaks build for ${platform}/${arch}`);
  const key = /** @type {keyof typeof GITLEAKS_SHA256} */ (`${os}_${cpu}`);
  return {
    key,
    url: `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${key}.tar.gz`,
    sha256: GITLEAKS_SHA256[key],
  };
}

/**
 * gitleaks exit codes: 0 = no leaks, 1 = leaks found (our --exit-code), other = error.
 * @param {number | null} code
 */
export function interpretGitleaksExit(code) {
  if (code === 0) return { ok: true, message: 'Secret scan: no leaks found.' };
  if (code === 1) return { ok: false, message: 'Secret scan: LEAKS FOUND (values redacted above). Rotate the secret first, then follow docs/compliance/breach-runbook.md.' };
  return { ok: false, message: `Secret scan: gitleaks failed to run (exit ${code}).` };
}
