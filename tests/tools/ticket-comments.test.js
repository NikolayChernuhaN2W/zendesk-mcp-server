import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketsTools } from '../../src/tools/tickets.js';
import { findTool, resultJson, stubZendesk } from '../helpers.js';

const pages = [
  {
    comments: [
      { id: 1, author_id: 10, public: true, plain_body: 'My restore failed', created_at: '2026-09-01T10:00:00Z' },
      { id: 2, author_id: 20, public: false, plain_body: 'Checking logs', created_at: '2026-09-01T11:00:00Z' }
    ],
    users: [{ id: 10, name: 'Casey Customer', role: 'end-user' }, { id: 20, name: 'Dana Agent', role: 'agent' }],
    meta: { has_more: true, after_cursor: 'c1' }
  },
  {
    comments: [{ id: 3, author_id: 20, public: true, html_body: '<p>Fixed</p>', created_at: '2026-09-02T10:00:00Z' }],
    users: [{ id: 20, name: 'Dana Agent', role: 'agent' }],
    meta: { has_more: false }
  }
];

function stubComments(t) {
  return stubZendesk(t, {
    'GET /tickets/42/comments.json': params => (params['page[after]'] === 'c1' ? pages[1] : pages[0])
  });
}

test('returns the whole conversation with author names', async t => {
  const calls = stubComments(t);
  const output = resultJson(await findTool(ticketsTools, 'get_ticket_comments').handler({ id: 42 }));
  assert.equal(output.ticket_id, 42);
  assert.equal(output.truncated, false);
  assert.deepEqual(output.comments.map(c => [c.id, c.author, c.public, c.body]), [
    [1, 'Casey Customer (end-user)', true, 'My restore failed'],
    [2, 'Dana Agent (agent)', false, 'Checking logs'],
    [3, 'Dana Agent (agent)', true, 'Fixed']
  ]);
  assert.deepEqual(calls[0].params, { 'page[size]': 100, include: 'users' });
  assert.equal(calls[1].params['page[after]'], 'c1');
});

test('can leave out internal notes', async t => {
  stubComments(t);
  const output = resultJson(await findTool(ticketsTools, 'get_ticket_comments').handler({ id: 42, include_internal: false }));
  assert.deepEqual(output.comments.map(c => c.id), [1, 3]);
});

test('stops at max_comments and says so', async t => {
  stubComments(t);
  const output = resultJson(await findTool(ticketsTools, 'get_ticket_comments').handler({ id: 42, max_comments: 2 }));
  assert.deepEqual(output.comments.map(c => c.id), [1, 2]);
  assert.equal(output.truncated, true);
});

test('reports API errors as tool errors', async t => {
  stubZendesk(t, { 'GET /tickets/42/comments.json': () => { throw new Error('Zendesk API Error: 404 - {}'); } });
  const result = await findTool(ticketsTools, 'get_ticket_comments').handler({ id: 42 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^Error getting ticket comments: Zendesk API Error: 404/);
});
