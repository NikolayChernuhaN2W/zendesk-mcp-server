import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmokeCheck } from '../scripts/smoke-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ok = value => async () => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const fails = message => async () => ({ content: [{ type: 'text', text: message }], isError: true });

function fakeTools(overrides = {}) {
  const handlers = {
    search: ok({ results: [{ id: 42, subject: 'A' }], count: 1 }),
    get_ticket_comments: ok({ ticket_id: 42, comments: [{ id: 1, body: 'Hi' }], truncated: false }),
    search_articles: ok({ articles: [{ id: 5, title: 'T' }], count: 1 }),
    get_help_center_structure: ok({ categories: [], totals: { categories: 0, sections: 0, articles: 0 } }),
    export_tickets: ok({ file: '/tmp/x.jsonl', written: 1, done: true }),
    ...overrides
  };
  return Object.entries(handlers).map(([name, handler]) => ({ name, handler }));
}

test('passes when every tool answers in the expected shape', async () => {
  const lines = [];
  assert.deepEqual(await runSmokeCheck(fakeTools(), { log: line => lines.push(line) }), { passed: 5, failed: 0 });
  assert.ok(lines.every(line => line.startsWith('PASS')), lines.join('\n'));
});

test('reports a tool error as a failure with its message', async () => {
  const lines = [];
  const result = await runSmokeCheck(fakeTools({ search_articles: fails('Error searching articles: 403') }), { log: line => lines.push(line) });
  assert.deepEqual(result, { passed: 4, failed: 1 });
  assert.ok(lines.some(line => line.startsWith('FAIL search_articles') && line.includes('403')));
});

test('reports an unexpected response shape as a failure', async () => {
  const result = await runSmokeCheck(fakeTools({ get_ticket_comments: ok({ nope: true }) }), { log: () => {} });
  assert.deepEqual(result, { passed: 4, failed: 1 });
});

test('skips the comments check when the account has no tickets', async () => {
  const lines = [];
  const result = await runSmokeCheck(fakeTools({ search: ok({ results: [], count: 0 }) }), { log: line => lines.push(line) });
  assert.deepEqual(result, { passed: 4, failed: 0 });
  assert.ok(lines.some(line => line.startsWith('SKIP get_ticket_comments')));
});

test('the export check uses a small, read-only time window instead of exporting everything', async () => {
  let receivedArgs;
  const tools = fakeTools({
    export_tickets: async args => {
      receivedArgs = args;
      return { content: [{ type: 'text', text: JSON.stringify({ file: '/tmp/x.jsonl', written: 1, done: true }) }] };
    }
  });
  await runSmokeCheck(tools, { log: () => {} });
  assert.equal(receivedArgs.query, 'created>1day');
});

test('running the check directly cleans up its temporary export folder', () => {
  const before = readdirSync(tmpdir()).filter(name => name.startsWith('zendesk-smoke-'));
  // No real Zendesk credentials: every check fails fast, which is enough to
  // exercise the cleanup without touching a real account
  spawnSync(process.execPath, [join(root, 'scripts/smoke-check.mjs')], {
    cwd: root,
    env: { ...process.env, ZENDESK_SUBDOMAIN: '', ZENDESK_EMAIL: '', ZENDESK_API_TOKEN: '' }
  });
  const after = readdirSync(tmpdir()).filter(name => name.startsWith('zendesk-smoke-'));
  assert.deepEqual(after, before);
});
