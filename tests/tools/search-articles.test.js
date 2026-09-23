import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpCenterTools } from '../../src/tools/help-center.js';
import { defined, findTool, resultJson, stubZendesk } from '../helpers.js';

const response = {
  results: [{
    id: 5, title: 'Restoring a volume', section_id: 9, locale: 'en-us', draft: false,
    html_url: 'https://acme.zendesk.com/hc/en-us/articles/5', updated_at: '2026-08-01T00:00:00Z',
    snippet: 'How to <em>restore</em> a volume', body: '<p>Long body</p>', result_type: 'article'
  }],
  count: 1,
  next_page: null
};

test('returns article summaries with snippets and no bodies', async t => {
  stubZendesk(t, { 'GET /help_center/articles/search.json': response });
  const output = resultJson(await findTool(helpCenterTools, 'search_articles').handler({ query: 'restore' }));
  assert.deepEqual(output, {
    articles: [{
      id: 5, title: 'Restoring a volume', section_id: 9, locale: 'en-us', draft: false,
      html_url: 'https://acme.zendesk.com/hc/en-us/articles/5', updated_at: '2026-08-01T00:00:00Z',
      snippet: 'How to restore a volume'
    }],
    count: 1,
    next_page: null
  });
});

test('maps filters to Zendesk parameter names', async t => {
  const calls = stubZendesk(t, { 'GET /help_center/articles/search.json': response });
  await findTool(helpCenterTools, 'search_articles').handler({
    query: 'restore', locale: 'en-us', category_id: 1, section_id: 9,
    label_names: ['aws', 'ebs'], updated_after: '2026-01-01', page: 2, per_page: 50
  });
  assert.deepEqual(defined(calls[0].params), {
    query: 'restore', locale: 'en-us', category: 1, section: 9,
    label_names: 'aws,ebs', updated_after: '2026-01-01', page: 2, per_page: 50
  });
});

test('reports API errors as tool errors', async t => {
  stubZendesk(t, { 'GET /help_center/articles/search.json': () => { throw new Error('Zendesk API Error: 400 - {}'); } });
  const result = await findTool(helpCenterTools, 'search_articles').handler({ query: 'x' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^Error searching articles: /);
});
