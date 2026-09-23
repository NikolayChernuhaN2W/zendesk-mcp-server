import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpCenterTools } from '../../src/tools/help-center.js';
import { findTool, resultJson, stubZendesk } from '../helpers.js';

const done = { meta: { has_more: false } };
const categories = [
  { id: 1, name: 'Troubleshooting', position: 2, html_url: 'u1' },
  { id: 2, name: 'Getting started', position: 1, html_url: 'u2' }
];
const sections = [
  { id: 10, name: 'Restores', category_id: 1, parent_section_id: null, position: 1, html_url: 's10' },
  { id: 11, name: 'EBS restores', category_id: 1, parent_section_id: 10, position: 1, html_url: 's11' },
  { id: 20, name: 'Install', category_id: 2, parent_section_id: null, position: 1, html_url: 's20' }
];
const articles = [
  { id: 100, section_id: 10, draft: false, updated_at: '2026-01-01T00:00:00Z' },
  { id: 101, section_id: 10, draft: true, updated_at: '2026-03-01T00:00:00Z' },
  { id: 102, section_id: 11, draft: false, updated_at: '2025-06-01T00:00:00Z' }
];

function stubHelpCenter(t) {
  return stubZendesk(t, {
    'GET /help_center/categories.json': { categories, ...done },
    'GET /help_center/sections.json': { sections, ...done },
    'GET /help_center/articles.json': { articles, ...done }
  });
}

test('builds a category → section → subsection tree with article counts', async t => {
  stubHelpCenter(t);
  const output = resultJson(await findTool(helpCenterTools, 'get_help_center_structure').handler({}));
  assert.deepEqual(output, {
    categories: [
      {
        id: 2, name: 'Getting started', html_url: 'u2',
        sections: [{ id: 20, name: 'Install', html_url: 's20', articles: 0, drafts: 0 }]
      },
      {
        id: 1, name: 'Troubleshooting', html_url: 'u1',
        sections: [{
          id: 10, name: 'Restores', html_url: 's10', articles: 2, drafts: 1, last_updated: '2026-03-01T00:00:00Z',
          sections: [{ id: 11, name: 'EBS restores', html_url: 's11', articles: 1, drafts: 0, last_updated: '2025-06-01T00:00:00Z' }]
        }]
      }
    ],
    totals: { categories: 2, sections: 3, articles: 3 }
  });
});

test('can skip article counts, which avoids listing every article', async t => {
  const calls = stubHelpCenter(t);
  const output = resultJson(await findTool(helpCenterTools, 'get_help_center_structure').handler({ include_article_counts: false }));
  assert.equal(calls.some(call => call.endpoint === '/help_center/articles.json'), false);
  assert.deepEqual(output.categories[0].sections[0], { id: 20, name: 'Install', html_url: 's20' });
  assert.deepEqual(output.totals, { categories: 2, sections: 3 });
});
