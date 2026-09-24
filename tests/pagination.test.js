import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, collectTicketComments } from '../src/pagination.js';

function pagedSource(pages) {
  const requests = [];
  const fetchPage = async params => {
    requests.push(params);
    return pages[requests.length - 1];
  };
  return { requests, fetchPage };
}

test('follows cursors until has_more is false', async () => {
  const { requests, fetchPage } = pagedSource([
    { items: [1, 2], meta: { has_more: true, after_cursor: 'c1' } },
    { items: [3], meta: { has_more: false, after_cursor: 'c2' } }
  ]);
  assert.deepEqual(await collectPages(fetchPage, 'items', { pageSize: 2 }), { items: [1, 2, 3], truncated: false });
  assert.deepEqual(requests, [{ 'page[size]': 2 }, { 'page[size]': 2, 'page[after]': 'c1' }]);
});

test('stops at the limit and reports truncation', async () => {
  const { requests, fetchPage } = pagedSource([
    { items: [1, 2], meta: { has_more: true, after_cursor: 'c1' } },
    { items: [3, 4], meta: { has_more: true, after_cursor: 'c2' } }
  ]);
  assert.deepEqual(await collectPages(fetchPage, 'items', { pageSize: 2, limit: 3 }), { items: [1, 2, 3], truncated: true });
  assert.equal(requests.length, 2);
});

test('reads the cursor from links.next when meta has no after_cursor', async () => {
  const { requests, fetchPage } = pagedSource([
    { items: [1], meta: { has_more: true }, links: { next: 'https://acme.zendesk.com/api/v2/x.json?page%5Bafter%5D=c1&page%5Bsize%5D=100' } },
    { items: [2], meta: { has_more: false } }
  ]);
  assert.deepEqual((await collectPages(fetchPage, 'items')).items, [1, 2]);
  assert.equal(requests[1]['page[after]'], 'c1');
});

test('stops if Zendesk says has_more but gives no cursor', async () => {
  const { requests, fetchPage } = pagedSource([{ items: [1], meta: { has_more: true } }]);
  assert.deepEqual(await collectPages(fetchPage, 'items'), { items: [1], truncated: true });
  assert.equal(requests.length, 1);
});

test('calls onPage with each raw page, for sideloads', async () => {
  const seen = [];
  const { fetchPage } = pagedSource([{ items: [1], users: [{ id: 7 }], meta: { has_more: false } }]);
  await collectPages(fetchPage, 'items', { onPage: page => seen.push(page.users) });
  assert.deepEqual(seen, [[{ id: 7 }]]);
});

test('collectTicketComments pages through comments with the users sideload', async () => {
  const requests = [];
  const client = {
    async listTicketComments(id, params) {
      requests.push({ id, params });
      return params['page[after]']
        ? { comments: [{ id: 2 }], users: [{ id: 8, name: 'B' }], meta: { has_more: false } }
        : { comments: [{ id: 1 }], users: [{ id: 7, name: 'A' }], meta: { has_more: true, after_cursor: 'c1' } };
    }
  };
  const { comments, users, truncated } = await collectTicketComments(client, 42, { limit: 10 });
  assert.deepEqual(comments.map(c => c.id), [1, 2]);
  assert.deepEqual([...users.keys()], [7, 8]);
  assert.equal(truncated, false);
  assert.deepEqual(requests, [
    { id: 42, params: { 'page[size]': 100, include: 'users' } },
    { id: 42, params: { 'page[size]': 100, 'page[after]': 'c1', include: 'users' } }
  ]);
});
