import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPrerelease, parseVersion, releaseNotes } from '../scripts/release-lib.mjs';

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

test('RELEASE_NOTES.md has notes for the current version', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(releaseNotes(read('RELEASE_NOTES.md'), pkg.version).length > 0);
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

// ${{ }} inside a run: script is substituted before the shell sees it, so a
// value like a tag name could inject commands. Values go through env: instead.
// The check is deliberately simple: a `run:` line itself, and for `run: |`
// every following line that is indented deeper than the `run:` key, must not
// contain `${{`.
test('workflows never interpolate ${{ }} inside run: scripts', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const lines = read(path).split('\n');
    const indent = line => line.match(/^ */)[0].length;
    lines.forEach((line, index) => {
      const run = line.match(/^(\s*)(?:- )?run:(.*)$/);
      if (!run) return;
      assert.ok(!line.includes('${{'), `${path}:${index + 1}: ${line.trim()}`);
      if (run[2].trim() !== '|') return;
      const keyIndent = line.indexOf('run:');
      for (let next = index + 1; next < lines.length; next++) {
        const body = lines[next];
        if (body.trim() && indent(body) <= keyIndent) break;
        assert.ok(!body.includes('${{'), `${path}:${next + 1}: ${body.trim()}`);
      }
    });
  }
});
