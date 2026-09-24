import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allTools } from '../src/tools/index.js';

const readJson = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('manifest lists exactly the tools the server offers', () => {
  const manifest = readJson('manifest.json');
  assert.deepEqual(manifest.tools.map(tool => tool.name).sort(), allTools.map(tool => tool.name).sort());
});

test('manifest and package.json versions match', () => {
  assert.equal(readJson('manifest.json').version, readJson('package.json').version);
});

test('release notes cover the current version', () => {
  const version = readJson('package.json').version;
  assert.match(readFileSync(new URL('../RELEASE_NOTES.md', import.meta.url), 'utf8'), new RegExp(`^## v${version.replace(/\./g, '\\.')}$`, 'm'));
});
