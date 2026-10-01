// Contract tests for every tool that can change Zendesk data. They never reach
// Zendesk: the HTTP layer is stubbed, and each test checks the exact method,
// URL and body that would go out, following Zendesk's API reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zendeskClient } from '../../src/zendesk-client.js';
import { allTools } from '../../src/tools/index.js';
import { selectTools } from '../../src/tool-registry.js';
import { findTool, setProperty } from '../helpers.js';

const base = 'https://acme.zendesk.com/api/v2';

// Stub the transport and record every request the tool sends
function capture(t, responseData) {
  const requests = [];
  setProperty(t, zendeskClient, 'subdomain', 'acme');
  setProperty(t, zendeskClient, 'email', 'a@b.c');
  setProperty(t, zendeskClient, 'apiToken', 'token');
  setProperty(t, zendeskClient, 'http', async config => {
    requests.push(config);
    return { data: responseData(config) };
  });
  return requests;
}

// A response with the record every write endpoint returns
const anyRecord = () => ({
  ticket: { id: 1 }, user: { id: 1 }, organization: { id: 1 }, group: { id: 1 },
  macro: { id: 1 }, view: { id: 1 }, trigger: { id: 1 }, automation: { id: 1 },
  article: { id: 1, source_locale: 'en-us' }, translation: { locale: 'en-us' }
});

const condition = { all: [{ field: 'status', operator: 'is', value: 'new' }] };
const action = [{ field: 'status', value: 'open' }];

// [tool, arguments, expected requests as [method, path, body]]
const cases = [
  ['create_ticket', { subject: 'S', comment: 'C', tags: ['x'] },
    [['POST', '/tickets.json', { ticket: { subject: 'S', comment: { body: 'C' }, tags: ['x'] } }]]],
  ['update_ticket', { id: 7, status: 'solved', comment: 'Done' },
    [['PUT', '/tickets/7.json', { ticket: { status: 'solved', comment: { body: 'Done' } } }]]],
  ['delete_ticket', { id: 7 }, [['DELETE', '/tickets/7.json']]],

  ['create_user', { name: 'N', email: 'n@example.com', role: 'end-user' },
    [['POST', '/users.json', { user: { name: 'N', email: 'n@example.com', role: 'end-user' } }]]],
  ['update_user', { id: 8, name: 'M' }, [['PUT', '/users/8.json', { user: { name: 'M' } }]]],
  ['delete_user', { id: 8 }, [['DELETE', '/users/8.json']]],

  ['create_organization', { name: 'O' }, [['POST', '/organizations.json', { organization: { name: 'O' } }]]],
  ['update_organization', { id: 9, notes: 'n' }, [['PUT', '/organizations/9.json', { organization: { notes: 'n' } }]]],
  ['delete_organization', { id: 9 }, [['DELETE', '/organizations/9.json']]],

  ['create_group', { name: 'G' }, [['POST', '/groups.json', { group: { name: 'G' } }]]],
  ['update_group', { id: 10, description: 'd' }, [['PUT', '/groups/10.json', { group: { description: 'd' } }]]],
  ['delete_group', { id: 10 }, [['DELETE', '/groups/10.json']]],

  ['create_macro', { title: 'M', actions: action }, [['POST', '/macros.json', { macro: { title: 'M', actions: action } }]]],
  ['update_macro', { id: 11, title: 'M2' }, [['PUT', '/macros/11.json', { macro: { title: 'M2' } }]]],
  ['delete_macro', { id: 11 }, [['DELETE', '/macros/11.json']]],

  ['create_view', { title: 'V', conditions: condition }, [['POST', '/views.json', { view: { title: 'V', conditions: condition } }]]],
  ['update_view', { id: 12, title: 'V2' }, [['PUT', '/views/12.json', { view: { title: 'V2' } }]]],
  ['delete_view', { id: 12 }, [['DELETE', '/views/12.json']]],

  ['create_trigger', { title: 'T', conditions: condition, actions: action },
    [['POST', '/triggers.json', { trigger: { title: 'T', conditions: condition, actions: action } }]]],
  ['update_trigger', { id: 13, title: 'T2' }, [['PUT', '/triggers/13.json', { trigger: { title: 'T2' } }]]],
  ['delete_trigger', { id: 13 }, [['DELETE', '/triggers/13.json']]],

  ['create_automation', { title: 'A', conditions: condition, actions: action },
    [['POST', '/automations.json', { automation: { title: 'A', conditions: condition, actions: action } }]]],
  ['update_automation', { id: 14, title: 'A2' }, [['PUT', '/automations/14.json', { automation: { title: 'A2' } }]]],
  ['delete_automation', { id: 14 }, [['DELETE', '/automations/14.json']]],

  ['create_article', { title: 'Art', body: '<p>B</p>', section_id: 15, draft: true },
    [['POST', '/help_center/sections/15/articles.json', { article: { title: 'Art', body: '<p>B</p>', draft: true } }]]],
  // notify_subscribers sits next to the article, not inside it (Create Article API)
  ['create_article', { title: 'Art', body: '<p>B</p>', section_id: 15, draft: true, notify_subscribers: false },
    [['POST', '/help_center/sections/15/articles.json', { article: { title: 'Art' }, notify_subscribers: false }]]],
  // A title change goes to the article's translation, in its source locale
  ['update_article', { id: 16, title: 'New' }, [
    ['GET', '/help_center/articles/16.json'],
    ['PUT', '/help_center/articles/16/translations/en-us.json', { translation: { title: 'New' } }]
  ]],
  ['delete_article', { id: 16 }, [['DELETE', '/help_center/articles/16.json']]]
];

// Compare only the fields the case specifies, so optional fields the tool
// fills in (like a default locale) don't make the test brittle
function assertContains(actual, expected, path) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    assert.ok(actual && typeof actual === 'object', `${path} should be an object, got ${JSON.stringify(actual)}`);
    for (const [key, value] of Object.entries(expected)) assertContains(actual[key], value, `${path}.${key}`);
  } else {
    assert.deepEqual(actual, expected, path);
  }
}

test('every write tool is covered by a contract case', () => {
  const writeTools = allTools.map(tool => tool.name).filter(name => /^(create|update|delete)_/.test(name)).sort();
  assert.deepEqual([...new Set(cases.map(([name]) => name))].sort(), writeTools);
});

for (const [name, args, expected] of cases) {
  test(`${name} sends ${expected.map(([method, path]) => `${method} ${path}`).join(', then ')}`, async t => {
    const requests = capture(t, anyRecord);
    const result = await findTool(allTools, name).handler(args);
    assert.ok(!result.isError, result.content[0].text);
    assert.equal(requests.length, expected.length, `requests: ${requests.map(r => `${r.method} ${r.url}`).join(', ')}`);
    expected.forEach(([method, path, body], index) => {
      const request = requests[index];
      assert.equal(request.method, method);
      assert.equal(request.url, base + path);
      if (body === undefined) {
        // GET and DELETE carry no body at all
        assert.equal('data' in request, false, `${method} ${path} must not send a body`);
        assert.equal(request.headers['Content-Type'], undefined);
      } else {
        assertContains(request.data, body, 'body');
        assert.equal(request.headers['Content-Type'], 'application/json');
      }
    });
  });
}

test('read-only mode hides every write tool', () => {
  const offered = new Set(selectTools(allTools, { readOnly: true }).map(tool => tool.name));
  for (const [name] of cases) assert.equal(offered.has(name), false, `${name} is hidden`);
});
