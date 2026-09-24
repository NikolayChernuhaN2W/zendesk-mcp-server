import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTools } from '../src/tools/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf8');
const readJson = file => JSON.parse(read(file));
const repo = 'github.com/NikolayChernuhaN2W/zendesk-mcp-server';

test('LICENSE is MIT and credits the original author', () => {
  const license = read('LICENSE');
  assert.ok(license.startsWith('MIT License'));
  assert.match(license, /Matt Coatsworth/);
});

test('package.json and manifest.json are MIT licensed', () => {
  assert.equal(readJson('package.json').license, 'MIT');
  assert.equal(readJson('manifest.json').license, 'MIT');
});

test('package.json has the MCP keywords', () => {
  const { keywords = [] } = readJson('package.json');
  assert.ok(keywords.includes('mcp'));
  assert.ok(keywords.includes('mcp-server'));
});

test('package.json and manifest.json point at the GitHub repository', () => {
  assert.ok(readJson('package.json').repository?.url?.includes(repo));
  assert.ok(readJson('manifest.json').repository?.url?.includes(repo));
});

test('README mentions every tool', () => {
  const readme = read('README.md');
  const missing = allTools.map(tool => tool.name).filter(name => !readme.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});

test('README has no 4-space indented lines outside code fences', () => {
  let fenced = false;
  const indented = [];
  read('README.md').split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      return;
    }
    if (!fenced && /^ {4}\S/.test(line)) indented.push(index + 1);
  });
  assert.equal(fenced, false, 'unbalanced code fences');
  assert.deepEqual(indented, []);
});

test('README credits the original author', () => {
  assert.match(read('README.md'), /mattcoatsworth/);
});

test('.env is not tracked', () => {
  const output = execFileSync('git', ['ls-files', '.env'], { cwd: root, encoding: 'utf8' });
  assert.equal(output, '');
});
