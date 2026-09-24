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
