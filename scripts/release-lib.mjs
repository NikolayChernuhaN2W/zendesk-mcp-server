// Helpers shared by scripts/release.mjs, scripts/release.sh and the release
// workflow. No dependencies, so they run before `npm ci` if need be.

// "1.2.3", "v1.2.3" or a pre-release like "v1.2.3-rc.1" -> the version without the v
export function parseVersion(input) {
  const match = String(input).match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (!match) throw new Error(`Not a version: ${input}. Use X.Y.Z, for example 1.2.0.`);
  return match[1];
}

export function isPrerelease(version) {
  return version.includes('-');
}

// Semver precedence of two X.Y.Z[-pre] versions: -1, 0 or 1. A pre-release
// sorts before its release; pre-release identifiers compare numerically when
// both are numbers, as ASCII otherwise, and numbers sort before words.
export function compareVersions(a, b) {
  const split = version => {
    const [core, ...pre] = version.split('-');
    return { core: core.split('.').map(Number), pre: pre.length ? pre.join('-').split('.') : [] };
  };
  const sign = n => (n > 0) - (n < 0);
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return sign(x.core[i] - y.core[i]);
  }
  if (!x.pre.length || !y.pre.length) return sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pNumeric = /^\d+$/.test(p);
    const qNumeric = /^\d+$/.test(q);
    if (pNumeric && qNumeric) return sign(Number(p) - Number(q));
    if (pNumeric !== qNumeric) return pNumeric ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// The highest stable (no pre-release) version among tag names like v1.2.0,
// without the v, or null. Release tags are always v-prefixed, so other names
// are ignored.
export function latestVersion(tagNames) {
  let latest = null;
  for (const name of tagNames) {
    if (!name.startsWith('v')) continue;
    let version;
    try {
      version = parseVersion(name);
    } catch {
      continue;
    }
    if (isPrerelease(version)) continue;
    if (latest === null || compareVersions(version, latest) > 0) latest = version;
  }
  return latest;
}

// The version after latest for a patch, minor or major release
export function nextVersion(latest, kind) {
  const [major, minor, patch] = latest.split('-')[0].split('.').map(Number);
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'major') return `${major + 1}.0.0`;
  throw new Error(`Unknown release type: ${kind}. Use patch, minor, major or a version like 1.4.0.`);
}

// The user-facing notes for this version: its "## v<version>" section of
// RELEASE_NOTES.md, without the heading (the release title shows the version)
export function releaseNotes(markdown, version) {
  const heading = `## v${version}`;
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => line.trim() === heading);
  if (start === -1) throw new Error(`RELEASE_NOTES.md has no "${heading}" section. Write the notes for this release first.`);

  const rest = lines.slice(start + 1);
  const next = rest.findIndex(line => /^## /.test(line));
  const body = (next === -1 ? rest : rest.slice(0, next)).join('\n').trim();
  if (!body) throw new Error(`The "${heading}" section of RELEASE_NOTES.md is empty.`);
  return body;
}
