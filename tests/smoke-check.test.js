import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmokeCheck } from '../scripts/smoke-check.mjs';

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
