import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketsTools } from '../../src/tools/tickets.js';
import { searchTools } from '../../src/tools/search.js';
import { chatTools } from '../../src/tools/chat.js';
import { helpCenterTools } from '../../src/tools/help-center.js';
import { findTool, resultJson, stubZendesk } from '../helpers.js';

const rawTicket = {
  id: 42, subject: 'Restore failed', status: 'open', via: { channel: 'email' },
  url: 'https://acme.zendesk.com/api/v2/tickets/42.json', collaborator_ids: [], description: 'd'.repeat(800)
};
const rawArticle = {
  id: 5, title: 'Restoring a volume', section_id: 9, locale: 'en-us', draft: false,
  html_url: 'https://acme.zendesk.com/hc/en-us/articles/5', body: '<p>Step one.</p>', author_id: 3, vote_sum: 0
};

test('list_tickets returns ticket summaries', async t => {
  stubZendesk(t, { 'GET /tickets.json': { tickets: [rawTicket], count: 1, next_page: null } });
  const output = resultJson(await findTool(ticketsTools, 'list_tickets').handler({}));
  assert.deepEqual(Object.keys(output), ['tickets', 'count', 'next_page']);
  assert.equal(output.tickets[0].channel, 'email');
  assert.equal(output.tickets[0].url, undefined);
  assert.ok(output.tickets[0].description.length < 600);
});

test('get_ticket returns the full description, or the raw ticket on request', async t => {
  stubZendesk(t, { 'GET /tickets/42.json': { ticket: rawTicket } });
  const tool = findTool(ticketsTools, 'get_ticket');
  assert.equal(resultJson(await tool.handler({ id: 42 })).description, 'd'.repeat(800));
  assert.deepEqual(resultJson(await tool.handler({ id: 42, raw: true })), { ticket: rawTicket });
});

test('search summarizes tickets and passes other result types through', async t => {
  const user = { result_type: 'user', id: 1, name: 'Dana' };
  stubZendesk(t, { 'GET /search.json': { results: [{ ...rawTicket, result_type: 'ticket' }, user], count: 2, next_page: null } });
  const output = resultJson(await findTool(searchTools, 'search').handler({ query: 'restore' }));
  assert.equal(output.results[0].url, undefined);
  assert.equal(output.results[0].subject, 'Restore failed');
  assert.deepEqual(output.results[1], user);
});

test('list_chats returns ticket summaries under "chats"', async t => {
  stubZendesk(t, { 'GET /search.json': { results: [rawTicket], count: 1, next_page: null } });
  const output = resultJson(await findTool(chatTools, 'list_chats').handler({}));
  assert.equal(output.chats[0].id, 42);
  assert.equal(output.chats[0].url, undefined);
});

test('list_articles omits bodies; get_article returns the body as text', async t => {
  stubZendesk(t, {
    'GET /help_center/articles.json': { articles: [rawArticle], count: 1, next_page: null },
    'GET /help_center/articles/5.json': { article: rawArticle }
  });
  const list = resultJson(await findTool(helpCenterTools, 'list_articles').handler({}));
  assert.equal(list.articles[0].body, undefined);
  assert.equal(list.articles[0].vote_sum, undefined);
  const tool = findTool(helpCenterTools, 'get_article');
  assert.equal(resultJson(await tool.handler({ id: 5 })).body, 'Step one.');
  assert.deepEqual(resultJson(await tool.handler({ id: 5, raw: true })), { article: rawArticle });
});
