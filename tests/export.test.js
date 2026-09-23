import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportTickets, safeFileName } from '../src/export.js';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zendesk-export-test-'));
  process.env.ZENDESK_EXPORT_DIR = dir;
});

const ticket = id => ({ id, subject: `Ticket ${id}`, status: 'open', url: `https://x/${id}` });

// A fake Zendesk client: `pages` are search-export pages in order.
// `failOnce` is a set of ticket ids whose first comment fetch throws, so a
// retry (a resumed call) then succeeds.
function fakeClient(pages, commentsByTicket = {}, failOnce = new Set()) {
  const searches = [];
  const commentRequests = [];
  return {
    searches,
    commentRequests,
    async exportSearch(params) {
      searches.push(params);
      const index = params['page[after]'] ? Number(params['page[after]'].slice(1)) : 0;
      return pages[index];
    },
    async listTicketComments(id, params) {
      commentRequests.push({ id, params });
      if (failOnce.has(id)) {
        failOnce.delete(id);
        throw new Error('boom');
      }
      return { comments: commentsByTicket[id] || [], users: [], meta: { has_more: false } };
    }
  };
}

const lines = file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));

// A clock that advances `step` ms every time it is read
function clock(step) {
  let time = 0;
  return () => (time += step);
}

test('safeFileName keeps exports inside the export folder', () => {
  assert.equal(safeFileName('restores.jsonl'), 'restores.jsonl');
  assert.equal(safeFileName('restores'), 'restores.jsonl');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd.jsonl');
  assert.equal(safeFileName('my file (1).jsonl'), 'my_file__1_.jsonl');
  assert.equal(safeFileName(undefined, new Date('2026-09-23T10:11:12.345Z')), 'tickets-2026-09-23T10-11-12-345Z.jsonl');
  assert.throws(() => safeFileName('..'), /Invalid file name/);
});

test('exports every page to JSON Lines', async () => {
  const client = fakeClient([
    { results: [ticket(1), ticket(2)], meta: { has_more: true, after_cursor: 'p1' } },
    { results: [ticket(3)], meta: { has_more: false } }
  ]);
  const result = await exportTickets(client, { query: 'status:open', file_name: 'open' });

  assert.equal(result.done, true);
  assert.equal(result.written, 3);
  assert.equal(result.file, join(dir, 'open.jsonl'));
  assert.equal(result.resume, undefined);
  assert.deepEqual(lines(result.file).map(line => line.id), [1, 2, 3]);
  assert.equal(lines(result.file)[0].url, undefined, 'lines are summaries');
  assert.deepEqual(client.searches, [
    { query: 'status:open', 'filter[type]': 'ticket', 'page[size]': 100 },
    { query: 'status:open', 'filter[type]': 'ticket', 'page[size]': 100, 'page[after]': 'p1' }
  ]);
});

test('can include each ticket\'s conversation', async () => {
  const client = fakeClient(
    [{ results: [ticket(1)], meta: { has_more: false } }],
    { 1: [{ id: 9, author_id: 5, public: true, plain_body: 'Hello' }] }
  );
  const result = await exportTickets(client, { query: 'x', include_comments: true });
  assert.deepEqual(lines(result.file)[0].comments, [{ id: 9, author_id: 5, public: true, body: 'Hello' }]);
  assert.equal(lines(result.file)[0].comments_truncated, undefined);
  assert.deepEqual(client.commentRequests[0].params, { 'page[size]': 100, include: 'users' });
});

test('stops at the time budget and resumes without duplicates', async () => {
  const pages = [
    { results: [ticket(1), ticket(2), ticket(3)], meta: { has_more: true, after_cursor: 'p1' } },
    { results: [ticket(4)], meta: { has_more: false } }
  ];
  // Each clock read advances 10 ms against a 15 ms budget: the first call
  // stops part-way through page one, the next one stops between pages
  const options = { now: clock(10), budgetMs: 15 };

  const first = await exportTickets(fakeClient(pages), { query: 'x', file_name: 'big' }, options);
  assert.equal(first.done, false);
  assert.ok(first.resume);
  assert.equal(first.written, 2);

  let result = first;
  for (let calls = 0; !result.done && calls < 10; calls++) {
    result = await exportTickets(fakeClient(pages), { resume: result.resume }, options);
  }
  assert.equal(result.done, true);
  assert.equal(result.written, 4);
  assert.deepEqual(lines(result.file).map(line => line.id), [1, 2, 3, 4]);
});

test('always makes progress, even with no time budget', async () => {
  const pages = [{ results: [ticket(1), ticket(2)], meta: { has_more: false } }];
  const result = await exportTickets(fakeClient(pages), { query: 'x' }, { now: clock(1), budgetMs: 0 });
  assert.equal(result.written, 1);
  assert.equal(result.done, false);
});

test('refuses to overwrite an existing file', async () => {
  writeFileSync(join(dir, 'taken.jsonl'), '');
  await assert.rejects(
    exportTickets(fakeClient([]), { query: 'x', file_name: 'taken.jsonl' }),
    /taken\.jsonl already exists/
  );
});

test('needs a query unless resuming, and rejects a garbled resume token', async () => {
  await assert.rejects(exportTickets(fakeClient([]), {}), /query is required/);
  await assert.rejects(exportTickets(fakeClient([]), { resume: 'not-a-token' }), /Invalid resume value/);
});

test('refuses a resume value that does not match the file', async () => {
  const pages = [
    { results: [ticket(1), ticket(2), ticket(3)], meta: { has_more: true, after_cursor: 'p1' } },
    { results: [ticket(4)], meta: { has_more: false } }
  ];
  const options = { now: clock(10), budgetMs: 15 };

  const first = await exportTickets(fakeClient(pages), { query: 'x', file_name: 'a' }, options);
  assert.equal(first.done, false);
  assert.ok(first.resume);

  appendFileSync(join(dir, 'a.jsonl'), 'tampered\n');

  await assert.rejects(
    exportTickets(fakeClient(pages), { resume: first.resume }, options),
    /no longer matches/
  );
});

test('refuses a forged resume value for another existing file', async () => {
  writeFileSync(join(dir, 'notes.jsonl'), 'USER DATA\n');
  const token = Buffer.from(JSON.stringify({
    query: 'x', includeComments: false, file: 'notes.jsonl', after: null, skip: 0, written: 0, bytes: 0
  })).toString('base64url');

  await assert.rejects(exportTickets(fakeClient([]), { resume: token }), /no longer matches/);
  assert.equal(readFileSync(join(dir, 'notes.jsonl'), 'utf8'), 'USER DATA\n');
});

test('rejects resume values with invalid counters', async () => {
  const token = Buffer.from(JSON.stringify({
    query: 'x', includeComments: false, file: 'a.jsonl', after: null, skip: -1, written: 0, bytes: 0
  })).toString('base64url');

  await assert.rejects(exportTickets(fakeClient([]), { resume: token }), /Invalid resume value/);
});

test('an empty result still creates the file', async () => {
  const pages = [{ results: [], meta: { has_more: false } }];
  const result = await exportTickets(fakeClient(pages), { query: 'x', file_name: 'empty' });
  assert.equal(result.done, true);
  assert.equal(result.written, 0);
  assert.equal(readFileSync(result.file, 'utf8'), '');
});

test('an error mid-call returns a resume value and loses nothing', async () => {
  const pages = [{ results: [ticket(1), ticket(2), ticket(3)], meta: { has_more: false } }];
  const client = fakeClient(pages, {}, new Set([2]));

  const first = await exportTickets(client, { query: 'x', include_comments: true });
  assert.equal(first.done, false);
  assert.equal(first.written, 1);
  assert.equal(first.error, 'boom');
  assert.ok(first.resume);

  const result = await exportTickets(client, { resume: first.resume });
  assert.equal(result.done, true);
  assert.equal(result.written, 3);
  assert.deepEqual(lines(result.file).map(line => line.id), [1, 2, 3]);
});

test('warns when Zendesk says there is more but gives no cursor', async () => {
  const pages = [{ results: [ticket(1)], meta: { has_more: true } }];
  const result = await exportTickets(fakeClient(pages), { query: 'x' });
  assert.equal(result.done, true);
  assert.match(result.warning, /may be incomplete/);
});

test('marks conversations that were cut short', async () => {
  const client = {
    async exportSearch() {
      return { results: [ticket(1)], meta: { has_more: false } };
    },
    async listTicketComments() {
      return { comments: [{ id: 9, public: true, plain_body: 'x' }], users: [], meta: { has_more: true } };
    }
  };
  const result = await exportTickets(client, { query: 'x', include_comments: true });
  assert.equal(lines(result.file)[0].comments_truncated, true);
});
