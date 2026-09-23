import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, jsonResult, summarizeArticle, summarizeComment, summarizeTicket, truncate } from '../src/format.js';

test('htmlToText strips tags, keeps structure, decodes entities', () => {
  assert.equal(
    htmlToText('<p>Hello&nbsp;<b>there</b></p><ul><li>One</li><li>Two</li></ul><script>x()</script>'),
    'Hello there\n\n- One\n- Two'
  );
  assert.equal(htmlToText('a<br>b<br/>c'), 'a\nb\nc');
  assert.equal(htmlToText('Tom &amp; Jerry &lt;3 &#8217; &#x2014; &unknown;'), 'Tom & Jerry <3 ’ — &unknown;');
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText(''), '');
});

test('truncate shortens long text and says how much was cut', () => {
  assert.equal(truncate('abcdef', 3), 'abc… [3 more characters]');
  assert.equal(truncate('abc', 3), 'abc');
  assert.equal(truncate(undefined, 3), '');
  assert.equal(truncate('abc', Infinity), 'abc');
});

const ticket = {
  id: 42,
  url: 'https://acme.zendesk.com/api/v2/tickets/42.json',
  subject: 'Restore failed',
  raw_subject: 'Restore failed',
  status: 'open',
  priority: 'high',
  type: 'problem',
  via: { channel: 'email', source: { from: {}, to: {} } },
  requester_id: 1,
  submitter_id: 1,
  assignee_id: 2,
  group_id: 3,
  organization_id: null,
  collaborator_ids: [],
  tags: ['backup', 'restore'],
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  satisfaction_rating: { score: 'unoffered' },
  custom_fields: [{ id: 10, value: null }, { id: 11, value: 'aws' }, { id: 12, value: [] }],
  description: 'x'.repeat(600)
};

test('summarizeTicket keeps the useful fields and truncates the description', () => {
  assert.deepEqual(summarizeTicket(ticket), {
    id: 42,
    subject: 'Restore failed',
    status: 'open',
    priority: 'high',
    type: 'problem',
    channel: 'email',
    requester_id: 1,
    assignee_id: 2,
    group_id: 3,
    tags: ['backup', 'restore'],
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    custom_fields: [{ id: 11, value: 'aws' }],
    description: 'x'.repeat(500) + '… [100 more characters]'
  });
});

test('summarizeTicket can keep the full description and shows real satisfaction scores', () => {
  const summary = summarizeTicket({ ...ticket, satisfaction_rating: { score: 'good' } }, { descriptionLength: Infinity });
  assert.equal(summary.description, 'x'.repeat(600));
  assert.equal(summary.satisfaction, 'good');
});

test('summarizeComment names the author and prefers plain text', () => {
  const users = new Map([[7, { id: 7, name: 'Dana Agent', role: 'agent' }]]);
  assert.deepEqual(summarizeComment({
    id: 1,
    author_id: 7,
    public: false,
    created_at: '2026-09-01T11:00:00Z',
    via: { channel: 'web' },
    plain_body: 'Internal note',
    html_body: '<p>Internal note</p>',
    body: 'Internal note',
    attachments: [{ file_name: 'log.txt', content_url: 'https://…' }]
  }, users), {
    id: 1,
    author: 'Dana Agent (agent)',
    author_id: 7,
    public: false,
    created_at: '2026-09-01T11:00:00Z',
    channel: 'web',
    body: 'Internal note',
    attachments: ['log.txt']
  });
});

test('summarizeComment falls back to html_body and skips unknown authors', () => {
  const summary = summarizeComment({ id: 2, author_id: 99, public: true, html_body: '<p>Hi <b>there</b></p>', attachments: [] }, new Map());
  assert.deepEqual(summary, { id: 2, author_id: 99, public: true, body: 'Hi there' });
});

const article = {
  id: 5,
  url: 'https://acme.zendesk.com/api/v2/help_center/articles/5.json',
  html_url: 'https://acme.zendesk.com/hc/en-us/articles/5',
  title: 'Restoring a volume',
  section_id: 9,
  locale: 'en-us',
  draft: false,
  label_names: [],
  updated_at: '2026-08-01T00:00:00Z',
  snippet: 'How to <em>restore</em> a volume',
  body: '<p>Step one.</p><p>Step two.</p>'
};

test('summarizeArticle omits the body unless asked, and cleans the snippet', () => {
  assert.deepEqual(summarizeArticle(article), {
    id: 5,
    title: 'Restoring a volume',
    section_id: 9,
    locale: 'en-us',
    draft: false,
    html_url: 'https://acme.zendesk.com/hc/en-us/articles/5',
    updated_at: '2026-08-01T00:00:00Z',
    snippet: 'How to restore a volume'
  });
  assert.equal(summarizeArticle(article, { bodyLength: Infinity }).body, 'Step one.\n\nStep two.');
  assert.deepEqual(summarizeArticle({ ...article, label_names: ['aws'] }).labels, ['aws']);
});

test('jsonResult wraps compact JSON as MCP text content', () => {
  assert.deepEqual(jsonResult({ a: 1, b: [2] }), { content: [{ type: 'text', text: '{"a":1,"b":[2]}' }] });
});
