import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersions, isPrerelease, latestVersion, nextVersion, parseVersion, releaseNotes } from '../scripts/release-lib.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('parseVersion accepts X.Y.Z with or without v, including pre-releases', () => {
  assert.equal(parseVersion('1.2.0'), '1.2.0');
  assert.equal(parseVersion('v1.2.0'), '1.2.0');
  assert.equal(parseVersion('v1.2.0-rc.1'), '1.2.0-rc.1');
});

test('parseVersion rejects anything else', () => {
  assert.throws(() => parseVersion('1.2'), /Not a version: 1\.2/);
  assert.throws(() => parseVersion('v1.2.0 '), /Not a version/);
  assert.throws(() => parseVersion('latest'), /Not a version/);
});

test('isPrerelease is true only for versions with a pre-release part', () => {
  assert.equal(isPrerelease('1.2.0-rc.1'), true);
  assert.equal(isPrerelease('1.2.0'), false);
});

test('releaseNotes returns the body of the version section', () => {
  const notes = '# Release notes\n\n## v1.1.0\n\nNew things.\n\n## v1.0.0\n\nOld.\n';
  assert.equal(releaseNotes(notes, '1.1.0'), 'New things.');
  assert.equal(releaseNotes(notes, '1.0.0'), 'Old.');
  assert.throws(() => releaseNotes(notes, '2.0.0'), /no "## v2\.0\.0" section/);
  assert.throws(() => releaseNotes('# Release notes\n\n## v1.1.0\n\n## v1.0.0\n\nOld.\n', '1.1.0'), /is empty/);
});

test('compareVersions orders versions by semver precedence', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.2.0'), 1);
  assert.equal(compareVersions('1.2.0-rc.1', '1.2.0'), -1);
  assert.equal(compareVersions('1.2.0', '1.2.0-rc.1'), 1);
  assert.equal(compareVersions('1.2.0-rc.2', '1.2.0-rc.10'), -1);
  assert.equal(compareVersions('1.2.0-alpha', '1.2.0-beta'), -1);
  assert.equal(compareVersions('1.2.0-1', '1.2.0-alpha'), -1);
  assert.equal(compareVersions('1.2.0-rc', '1.2.0-rc.1'), -1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
});

test('latestVersion picks the highest stable v-prefixed tag', () => {
  // Release tags are always v-prefixed, so a bare 1.5.0 doesn't count
  assert.equal(latestVersion(['v1.0.0', 'v1.10.0', 'v1.9.0', 'v2.0.0-rc.1', 'junk', '1.5.0']), '1.10.0');
  assert.equal(latestVersion(['1.5.0', 'v1.0.0']), '1.0.0');
  assert.equal(latestVersion([]), null);
});

test('nextVersion bumps patch, minor or major', () => {
  assert.equal(nextVersion('1.1.0', 'patch'), '1.1.1');
  assert.equal(nextVersion('1.1.0', 'minor'), '1.2.0');
  assert.equal(nextVersion('1.1.0', 'major'), '2.0.0');
  assert.equal(nextVersion('1.9.9', 'minor'), '1.10.0');
  assert.throws(() => nextVersion('1.1.0', 'bogus'),
    { message: 'Unknown release type: bogus. Use patch, minor, major or a version like 1.4.0.' });
});

test('CI workflow has a job named test, the check main requires', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^  test:$/m);
  assert.match(ci, /^    name: test$/m);
});

test('release workflow runs on version tags and publishes with gh release create', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /tags:\s*\n\s*- ['"]?v\*\.\*\.\*/);
  assert.match(release, /gh release create/);
});

test('release workflow only releases tags on main and takes the version from the tag', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /merge-base --is-ancestor/);
  assert.match(release, /fetch-depth: 0/);
  assert.match(release, /--generate-notes/);
  assert.doesNotMatch(release, /package\.json/);
});

// ${{ }} inside a run: script is substituted before the shell sees it, so a
// value like a tag name could inject commands. Values go through env: instead.
// The check is deliberately simple: a `run:` line itself, and for a block
// scalar (`run: |`, `|-`, `>`, `>+` ...) every following line that is
// indented deeper than the `run:` key, must not contain `${{`. It returns the
// offending lines.
function interpolatedRunLines(yaml) {
  const lines = yaml.split('\n');
  const indent = line => line.match(/^ */)[0].length;
  const found = [];
  lines.forEach((line, index) => {
    const run = line.match(/^\s*(?:- )?run:(.*)$/);
    if (!run) return;
    if (line.includes('${{')) found.push(`${index + 1}: ${line.trim()}`);
    if (!/^[|>][-+]?\s*(#.*)?$/.test(run[1].trim())) return;
    const keyIndent = line.indexOf('run:');
    for (let next = index + 1; next < lines.length; next++) {
      const body = lines[next];
      if (body.trim() && indent(body) <= keyIndent) break;
      if (body.includes('${{')) found.push(`${next + 1}: ${body.trim()}`);
    }
  });
  return found;
}

test('the run: interpolation check catches ${{ }} in every kind of run: value', () => {
  const step = (run, body) => `steps:\n  - name: x\n    run: ${run}\n${body}  - name: next\n    env:\n      A: \${{ github.ref }}\n`;
  assert.deepEqual(interpolatedRunLines(step('|-', '      echo "${{ github.ref }}"\n')), ['4: echo "${{ github.ref }}"']);
  assert.deepEqual(interpolatedRunLines(step('>', '      echo\n      ${{ github.ref }}\n')), ['5: ${{ github.ref }}']);
  assert.deepEqual(interpolatedRunLines(step('echo ${{ github.ref }}', '')), ['3: run: echo ${{ github.ref }}']);
  assert.deepEqual(interpolatedRunLines(step('| # comment', '      echo "$A"\n')), []);
});

test('workflows never interpolate ${{ }} inside run: scripts', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    assert.deepEqual(interpolatedRunLines(read(path)), [], path);
  }
});
