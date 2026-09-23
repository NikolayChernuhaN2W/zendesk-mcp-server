# Read-Only Analysis Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude (in Claude Desktop and Cowork) what it needs to analyze Zendesk tickets and Help Center articles in read-only mode: full ticket conversations, article search, the Help Center structure, compact output, and bulk export to a local file.

**Architecture:** New read-only MCP tools sit next to the existing ones in `src/tools/`. Shared logic goes in small, focused modules: `src/format.js` (compact views of Zendesk objects), `src/pagination.js` (cursor paging), `src/export.js` (resumable JSONL export) and `src/tool-registry.js` (read-only filtering and annotations). Tests use Node's built-in test runner, with the Zendesk HTTP layer stubbed so no test ever touches a real account.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk` 1.30, `zod` 3.25, `axios`, `node:test` + `node:assert/strict`.

**Spec:** There is no separate spec document. The requirements were agreed in conversation on 2026-09-23 and are recorded in **Design decisions** below. Executors should treat that section as the spec.

## Global Constraints

- **No new runtime dependencies.** Tests use only `node:test` and `node:assert/strict`, with no test framework added.
- **Node versions:** the extension must still run on Node ≥ 18 (`manifest.json` `compatibility.runtimes.node`). The test script uses `node --test` with a glob, so development needs Node ≥ 22.
- **Naming:** every tool this plan adds reads from Zendesk. None may be named `create_*`, `update_*` or `delete_*`, because that prefix is what read-only mode hides.
- **No test may depend on a real Zendesk account.** Stub `zendeskClient.request` (tool tests) or `zendeskClient.http` (client tests). The only exception is Task 7's red step, described there.
- **Indentation:** existing files under `src/` indent their entire contents by 4 extra spaces, with 2-space nesting inside. Edits to those files must keep that. New files use normal 2-space indentation with no leading indent.
- **Tool error pattern:** tool handlers catch errors and return `{ content: [{ type: "text", text: \`Error <doing thing>: ${error.message}\` }], isError: true }`, the same as the existing tools.
- **Output format:** tool output is compact JSON (`JSON.stringify(value)`, no indentation), produced by `jsonResult()` from `src/format.js`.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Branch:** work on `feature/read-only-analysis-tools`, created from `main`.

## Design decisions

1. **Ticket conversations.** `get_ticket_comments` returns every comment on a ticket (public replies and internal notes), oldest first, as plain text, with author names taken from Zendesk's `include=users` sideload. It follows cursor pagination and stops at `max_comments` (default 200).
2. **Article search.** `search_articles` calls `GET /api/v2/help_center/articles/search.json` and returns titles, links and highlighted snippets without bodies. Claude then calls `get_article` for the full text. The endpoint, parameters and response are documented at https://developer.zendesk.com/api-reference/help_center/help-center-api/help_center_search/:
   - At least one of `query`, `category`, `section` or `label_names` is required. This tool always sends `query`.
   - Pagination is offset-only: at most 100 per page and 1,000 results in total.
   - `label_names` needs a Professional or Enterprise plan.
3. **Knowledge base structure.** `get_help_center_structure` returns categories, then sections, then subsections as a tree. By default each section also gets article counts (published and draft) and its last-updated date, which is what questions like "which areas are thin or stale?" need.
4. **Trimmed output.** Ticket, comment and article tools return a compact summary: key fields only, HTML converted to text, long descriptions truncated in lists, and null or empty fields dropped. `get_ticket` and `get_article` accept `raw: true` for the full API object.
5. **Bulk export.** `export_tickets` uses Zendesk's Search Export API (`GET /api/v2/search/export.json`), which works with an agent token and has no 1,000-result cap. It uses 100 results per page, the size Zendesk recommends, because larger pages can time out. It writes one ticket per line (JSON Lines) to a file in the export folder, optionally with each ticket's full conversation.
   - **Where files go:** the export folder comes from `ZENDESK_EXPORT_DIR`, set through the extension's "Export folder" setting. It defaults to `~/Zendesk exports`. Callers pass only a bare file name, which is sanitized, so a prompt-injected call can't write outside that folder.
   - **Resumable calls:** each call stops after about 40 seconds of work, so it stays under client tool-call timeouts. It returns a `resume` token, and calling again with that token continues without duplicating lines. Zendesk's cursor expires after an hour, so a resume has to happen within that time.
   - **Stays in read-only mode:** the tool writes a local file, so its annotations are `readOnlyHint: false, destructiveHint: false`. It never writes to Zendesk, so read-only mode keeps it available.
6. **Rate limits.** The client retries a `429` response up to 3 times, waiting for Zendesk's `Retry-After` (capped at 60 seconds, 10 seconds if the header is missing). Exports with conversations make one request per ticket, so this is needed.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `tests/helpers.js` | create | Stubs the Zendesk HTTP layer, finds a tool by name, parses tool output |
| `src/tool-registry.js` | create | Which tools read-only mode keeps, and each tool's MCP annotations |
| `src/tools/index.js` | create | The single `allTools` list, used by the server and the manifest test |
| `src/server.js` | modify | Registers `allTools` through the registry |
| `src/format.js` | create | `htmlToText`, `truncate`, `summarizeTicket`, `summarizeComment`, `summarizeArticle`, `jsonResult` |
| `src/pagination.js` | create | `collectPages` for Zendesk cursor pagination |
| `src/zendesk-client.js` | modify | New endpoints, 429 retry, injectable `http`/`sleep` |
| `src/tools/tickets.js` | modify | Trimmed output, `get_ticket_comments` |
| `src/tools/search.js`, `src/tools/chat.js` | modify | Trimmed output |
| `src/tools/help-center.js` | modify | Trimmed output, `search_articles`, `get_help_center_structure` |
| `src/export.js` | create | Resumable JSONL ticket export |
| `src/tools/export.js` | create | `export_tickets` tool |
| `manifest.json`, `package.json`, `README.md`, `RELEASE_NOTES.md` | modify | Export folder setting, tool list, version 1.1.0, user-facing notes |
| `scripts/smoke-check.mjs` | create | Read-only check for anyone with a real account to run before a release |

---

### Task 1: Test harness and tool registry

Adds the test setup, then moves the read-only filtering and annotation logic out of `server.js` into a module that can be unit-tested. Export (Task 8) needs a tool that isn't a Zendesk write but also isn't `readOnlyHint: true`, which the current logic can't express.

**Files:**
- Create: `tests/helpers.js`, `tests/server.test.js`, `tests/tool-registry.test.js`, `src/tool-registry.js`, `src/tools/index.js`
- Modify: `package.json` (scripts), `src/server.js:3-15` (tool imports), `src/server.js:24-72` (tool list and registration)

**Interfaces:**
- Produces:
  - `isZendeskWrite(tool) → boolean`
  - `getAnnotations(tool) → object`, where `tool.annotations`, if present, wins
  - `selectTools(tools, { readOnly }) → tool[]`
  - `allTools` exported from `src/tools/index.js`
  - Test helpers: `stubZendesk(t, routes) → calls[]`, `findTool(tools, name) → tool`, `resultJson(result) → any`, `defined(obj) → obj`, `setProperty(t, obj, key, value)`

- [ ] **Step 1: Add the test script**

In `package.json`, add a `test` script after `inspect` (keep the file's existing indentation):

```json
        "inspect": "npx -y @modelcontextprotocol/inspector node src/index.js",
        "test": "node --test \"tests/**/*.test.js\"",
```

- [ ] **Step 2: Write the test helpers**

Create `tests/helpers.js`:

```js
import assert from 'node:assert/strict';
import { zendeskClient } from '../src/zendesk-client.js';

// Replace zendeskClient.request for one test. `routes` maps "METHOD /endpoint"
// to a response object, or to a function (params, data) that returns one.
// Returns the list of calls made, for assertions.
export function stubZendesk(t, routes) {
  const calls = [];
  t.mock.method(zendeskClient, 'request', async (method, endpoint, data = null, params = null) => {
    calls.push({ method, endpoint, data, params });
    const route = routes[`${method} ${endpoint}`];
    if (route === undefined) throw new Error(`Unexpected request: ${method} ${endpoint}`);
    return typeof route === 'function' ? route(params, data) : route;
  });
  return calls;
}

export function findTool(tools, name) {
  const tool = tools.find(candidate => candidate.name === name);
  if (!tool) throw new Error(`No tool named ${name}`);
  return tool;
}

// Parse a tool result's JSON text, failing the test if the tool returned an error
export function resultJson(result) {
  assert.ok(!result.isError, result.content[0].text);
  return JSON.parse(result.content[0].text);
}

// Drop undefined values so request params can be compared with deepEqual
export function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

// Set object[key] for one test and restore it afterwards
// (node:test in Node 22 has no mock.property)
export function setProperty(t, object, key, value) {
  const had = Object.hasOwn(object, key);
  const previous = object[key];
  object[key] = value;
  t.after(() => {
    if (had) object[key] = previous;
    else delete object[key];
  });
}
```

- [ ] **Step 3: Write characterization tests for the running server**

These tests describe how the server behaves today, before the refactor. Create `tests/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('..', import.meta.url));

async function listTools(env) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'src/index.js')],
    cwd: root,
    env: { ...process.env, ...env },
    stderr: 'pipe'
  }));
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

test('default mode offers write tools, annotated as destructive', async () => {
  const tools = await listTools({ ZENDESK_READ_ONLY: 'false' });
  assert.equal(tools.find(tool => tool.name === 'delete_ticket').annotations.destructiveHint, true);
  assert.equal(tools.find(tool => tool.name === 'get_ticket').annotations.readOnlyHint, true);
  assert.ok(tools.every(tool => tool.description), 'every tool has a description');
});

test('read-only mode hides every create, update and delete tool', async () => {
  const tools = await listTools({ ZENDESK_READ_ONLY: 'true' });
  assert.deepEqual(tools.filter(tool => /^(create|update|delete)_/.test(tool.name)).map(tool => tool.name), []);
  assert.ok(tools.some(tool => tool.name === 'get_ticket'));
});
```

- [ ] **Step 4: Run them. They should pass, because they describe current behavior**

Run: `npm test`
Expected: PASS, 2 tests. If either fails, stop: the baseline is wrong, so investigate before refactoring.

- [ ] **Step 5: Write the failing registry unit tests**

Create `tests/tool-registry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAnnotations, isZendeskWrite, selectTools } from '../src/tool-registry.js';

const tool = (name, extra = {}) => ({ name, ...extra });

test('create, update and delete tools are Zendesk writes; nothing else is', () => {
  for (const name of ['create_ticket', 'update_user', 'delete_view']) {
    assert.equal(isZendeskWrite(tool(name)), true, name);
  }
  for (const name of ['get_ticket', 'list_articles', 'search', 'export_tickets']) {
    assert.equal(isZendeskWrite(tool(name)), false, name);
  }
});

test('annotations follow the naming convention', () => {
  assert.deepEqual(getAnnotations(tool('delete_ticket')),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
  assert.deepEqual(getAnnotations(tool('update_ticket')),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
  assert.deepEqual(getAnnotations(tool('create_ticket')),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  assert.deepEqual(getAnnotations(tool('get_ticket')), { readOnlyHint: true, openWorldHint: true });
});

test('a tool can declare its own annotations', () => {
  const annotations = { readOnlyHint: false, destructiveHint: false };
  assert.equal(getAnnotations(tool('export_tickets', { annotations })), annotations);
});

test('read-only mode drops Zendesk writes and keeps everything else', () => {
  const tools = ['get_ticket', 'update_ticket', 'export_tickets', 'delete_user'].map(name => tool(name));
  assert.deepEqual(selectTools(tools, { readOnly: true }).map(t => t.name), ['get_ticket', 'export_tickets']);
  assert.equal(selectTools(tools, { readOnly: false }).length, 4);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm test`
Expected: FAIL in `tool-registry.test.js` with `ERR_MODULE_NOT_FOUND` for `src/tool-registry.js`.

- [ ] **Step 7: Implement the registry**

Create `src/tool-registry.js`:

```js
// Which tools the server offers, and the MCP annotations that tell clients
// what each one does. Tools that change Zendesk data are named create_*,
// update_* or delete_*.
const ZENDESK_WRITE = /^(create|update|delete)_/;

export function isZendeskWrite(tool) {
  return ZENDESK_WRITE.test(tool.name);
}

export function getAnnotations(tool) {
  if (tool.annotations) return tool.annotations;
  if (/^(delete|update)_/.test(tool.name)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
  }
  if (tool.name.startsWith('create_')) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  }
  return { readOnlyHint: true, openWorldHint: true };
}

// Read-only mode hides tools that write to Zendesk. Tools that only write
// local files, like exports, stay available.
export function selectTools(tools, { readOnly }) {
  return readOnly ? tools.filter(tool => !isZendeskWrite(tool)) : tools;
}
```

Create `src/tools/index.js`:

```js
import { ticketsTools } from './tickets.js';
import { usersTools } from './users.js';
import { organizationsTools } from './organizations.js';
import { groupsTools } from './groups.js';
import { macrosTools } from './macros.js';
import { viewsTools } from './views.js';
import { triggersTools } from './triggers.js';
import { automationsTools } from './automations.js';
import { searchTools } from './search.js';
import { helpCenterTools } from './help-center.js';
import { supportTools } from './support.js';
import { talkTools } from './talk.js';
import { chatTools } from './chat.js';

// Every tool the server offers, in registration order
export const allTools = [
  ...ticketsTools,
  ...usersTools,
  ...organizationsTools,
  ...groupsTools,
  ...macrosTools,
  ...viewsTools,
  ...triggersTools,
  ...automationsTools,
  ...searchTools,
  ...helpCenterTools,
  ...supportTools,
  ...talkTools,
  ...chatTools
];
```

In `src/server.js`, replace the thirteen `import { …Tools } from './tools/….js';` lines (lines 3–15) with:

```js
    import { allTools } from './tools/index.js';
    import { getAnnotations, selectTools } from './tool-registry.js';
```

Then replace everything from `// Register all tools` down to the end of the `allTools.forEach(...)` registration block (just before `// Add a resource for Zendesk API documentation`) with:

```js
    const readOnly = process.env.ZENDESK_READ_ONLY === 'true';

    // Register each tool with the server, skipping Zendesk writes in read-only mode
    selectTools(allTools, { readOnly }).forEach(tool => {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.schema,
          annotations: getAnnotations(tool)
        },
        tool.handler
      );
    });
```

Keep the `import { zendeskClient } from './zendesk-client.js';` line, and the `McpServer`/`ResourceTemplate` import.

- [ ] **Step 8: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS, 6 tests (the 2 server tests and the 4 registry tests).

- [ ] **Step 9: Commit**

```bash
git add package.json tests src/tool-registry.js src/tools/index.js src/server.js
git commit -m "Add test suite and move tool filtering into a registry module

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Compact formatting helpers

Pure functions that turn raw Zendesk objects into short, analysis-friendly summaries. Tasks 3–8 use them.

**Files:**
- Create: `src/format.js`, `tests/format.test.js`

**Interfaces:**
- Produces:
  - `htmlToText(html) → string`
  - `truncate(text, max) → string`
  - `summarizeTicket(ticket, { descriptionLength = 500 }) → object`
  - `summarizeComment(comment, usersById: Map) → object`
  - `summarizeArticle(article, { bodyLength = 0 }) → object`
  - `jsonResult(value) → { content: [{ type: 'text', text }] }`
- Summaries drop `undefined`, `null` and `''` values. They keep `false` and `0`.

- [ ] **Step 1: Write the failing tests**

Create `tests/format.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/format.js`.

- [ ] **Step 3: Implement**

Create `src/format.js`:

```js
// Compact, analysis-friendly views of Zendesk objects. Raw API objects carry
// dozens of fields and HTML bodies that use up the model's context quickly.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1].toLowerCase() === 'x';
        return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}… [${text.length - max} more characters]`;
}

// Drop fields with no value so summaries stay short; false and 0 are kept
function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function nonEmpty(list) {
  return list?.length ? list : undefined;
}

function filledCustomFields(fields = []) {
  const filled = fields.filter(field =>
    field.value !== null && field.value !== '' && !(Array.isArray(field.value) && !field.value.length));
  return nonEmpty(filled.map(field => ({ id: field.id, value: field.value })));
}

export function summarizeTicket(ticket, { descriptionLength = 500 } = {}) {
  const score = ticket.satisfaction_rating?.score;
  return compact({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    type: ticket.type,
    channel: ticket.via?.channel,
    requester_id: ticket.requester_id,
    assignee_id: ticket.assignee_id,
    group_id: ticket.group_id,
    organization_id: ticket.organization_id,
    tags: nonEmpty(ticket.tags),
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    satisfaction: score && score !== 'unoffered' ? score : undefined,
    custom_fields: filledCustomFields(ticket.custom_fields),
    description: truncate(ticket.description, descriptionLength)
  });
}

export function summarizeComment(comment, usersById = new Map()) {
  const author = usersById.get(comment.author_id);
  return compact({
    id: comment.id,
    author: author ? `${author.name} (${author.role})` : undefined,
    author_id: comment.author_id,
    public: comment.public,
    created_at: comment.created_at,
    channel: comment.via?.channel,
    body: comment.plain_body || htmlToText(comment.html_body) || comment.body,
    attachments: nonEmpty(comment.attachments?.map(attachment => attachment.file_name))
  });
}

export function summarizeArticle(article, { bodyLength = 0 } = {}) {
  return compact({
    id: article.id,
    title: article.title,
    section_id: article.section_id,
    locale: article.locale,
    draft: article.draft,
    labels: nonEmpty(article.label_names),
    html_url: article.html_url,
    updated_at: article.updated_at,
    snippet: article.snippet ? htmlToText(article.snippet) : undefined,
    body: bodyLength ? truncate(htmlToText(article.body), bodyLength) : undefined
  });
}

export function jsonResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, all tests in `format.test.js` and the earlier suites.

- [ ] **Step 5: Commit**

```bash
git add src/format.js tests/format.test.js
git commit -m "Add compact formatting helpers for tickets, comments and articles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Trimmed output from existing read tools

Switches `list_tickets`, `get_ticket`, `search`, `list_chats`, `list_articles` and `get_article` to the compact summaries. `get_ticket` and `get_article` get a `raw` option that returns the full API object.

**Files:**
- Modify: `src/tools/tickets.js` (`list_tickets`, `get_ticket`), `src/tools/search.js`, `src/tools/chat.js`, `src/tools/help-center.js` (`list_articles`, `get_article`)
- Test: `tests/tools/read-output.test.js`

**Interfaces:**
- Consumes: `summarizeTicket`, `summarizeArticle`, `jsonResult` (Task 2); `stubZendesk`, `findTool`, `resultJson` (Task 1)
- Produces the following output shapes (later tasks and the release notes rely on these):
  - `list_tickets` → `{ tickets: TicketSummary[], count, next_page }`
  - `get_ticket` → `TicketSummary` with the full description, or `{ ticket: raw }` when `raw: true`
  - `search` → `{ results: (TicketSummary | raw)[], count, next_page }`. Tickets are summarized, and other result types pass through unchanged.
  - `list_chats` → `{ chats: TicketSummary[], count, next_page }`
  - `list_articles` → `{ articles: ArticleSummary[] (no body), count, next_page }`
  - `get_article` → `ArticleSummary` with the full body as text, or `{ article: raw }` when `raw: true`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/read-output.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL. For example, `list_tickets` output keys are the raw API keys, and `output.tickets[0].url` is defined.

- [ ] **Step 3: Implement**

In each file below, add the formatting import after the existing `zendeskClient` import, keeping the 4-space leading indent. Use only the names that file needs:

```js
    import { jsonResult, summarizeArticle, summarizeTicket } from '../format.js';
```

**`src/tools/tickets.js`.** In `list_tickets`, replace the `return { content: [...] };` after `listTickets(params)` with:

```js
            return jsonResult({
              tickets: result.tickets.map(ticket => summarizeTicket(ticket)),
              count: result.count,
              next_page: result.next_page
            });
```

For `get_ticket`, change the schema and handler to:

```js
        schema: {
          id: z.number().describe("Ticket ID"),
          raw: z.boolean().optional().describe("Return the full Zendesk API object instead of a summary")
        },
        handler: async ({ id, raw = false }) => {
          try {
            const result = await zendeskClient.getTicket(id);
            return jsonResult(raw ? result : summarizeTicket(result.ticket, { descriptionLength: Infinity }));
```

Keep the existing `catch` block.

**`src/tools/search.js`.** Replace the `return { content: [...] };` with:

```js
            return jsonResult({
              results: result.results.map(item => item.result_type === 'ticket' ? summarizeTicket(item) : item),
              count: result.count,
              next_page: result.next_page
            });
```

**`src/tools/chat.js`.** Replace the `return { content: [...] };` with:

```js
            return jsonResult({
              chats: result.results.map(ticket => summarizeTicket(ticket)),
              count: result.count,
              next_page: result.next_page
            });
```

**`src/tools/help-center.js`.** In `list_articles`, replace the `return { content: [...] };` with:

```js
            return jsonResult({
              articles: result.articles.map(article => summarizeArticle(article)),
              count: result.count,
              next_page: result.next_page
            });
```

For `get_article`, change the schema and handler to:

```js
        schema: {
          id: z.number().describe("Article ID"),
          raw: z.boolean().optional().describe("Return the full Zendesk API object (HTML body) instead of a summary")
        },
        handler: async ({ id, raw = false }) => {
          try {
            const result = await zendeskClient.getArticle(id);
            return jsonResult(raw ? result : summarizeArticle(result.article, { bodyLength: Infinity }));
```

Keep the existing `catch` block.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/tools tests/tools/read-output.test.js
git commit -m "Return compact summaries from ticket, search, chat and article tools

get_ticket and get_article accept raw: true for the full API object.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cursor pagination helper and ticket conversations

**Files:**
- Create: `src/pagination.js`, `tests/pagination.test.js`, `tests/tools/ticket-comments.test.js`
- Modify: `src/zendesk-client.js` (add `listTicketComments` after `deleteTicket`), `src/tools/tickets.js` (add `get_ticket_comments` after `get_ticket`)

**Interfaces:**
- Consumes: `summarizeComment`, `jsonResult` (Task 2)
- Produces:
  - `collectPages(fetchPage, key, { pageSize = 100, limit = Infinity, onPage }) → Promise<{ items, truncated }>`. `fetchPage(params)` receives `page[size]` and, after the first page, `page[after]`. It reads `meta.has_more`, then gets the cursor through `nextCursor`.
  - `nextCursor(page) → string | undefined`: returns `meta.after_cursor`, or else the `page[after]` value from `links.next`.
  - `zendeskClient.listTicketComments(id, params)` → `GET /tickets/{id}/comments.json`
  - The `get_ticket_comments` tool → `{ ticket_id, comments: CommentSummary[], truncated }`

- [ ] **Step 1: Write the failing pagination tests**

Create `tests/pagination.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPages } from '../src/pagination.js';

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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/pagination.js`.

- [ ] **Step 3: Implement collectPages**

Create `src/pagination.js`:

```js
// Walks a Zendesk endpoint that uses cursor pagination. fetchPage(params) is
// called with page[size] and, after the first page, page[after]; `key` names
// the array in each response (e.g. "comments"). onPage sees each raw page,
// which is where sideloads like "users" arrive.
export async function collectPages(fetchPage, key, { pageSize = 100, limit = Infinity, onPage } = {}) {
  const items = [];
  let after;
  let hasMore = true;

  while (hasMore && items.length < limit) {
    const params = { 'page[size]': pageSize };
    if (after) params['page[after]'] = after;

    const page = await fetchPage(params);
    onPage?.(page);
    items.push(...(page[key] || []));
    hasMore = Boolean(page.meta?.has_more);
    after = nextCursor(page);
    // A page that claims more results but has no cursor would loop forever
    if (hasMore && !after) break;
  }

  return { items: items.slice(0, limit), truncated: hasMore || items.length > limit };
}

// Zendesk documents meta.after_cursor on some endpoints and only links.next
// (a URL carrying page[after]) on others, so accept either
export function nextCursor(page) {
  if (page.meta?.after_cursor) return page.meta.after_cursor;
  if (!page.links?.next) return undefined;
  try {
    return new URL(page.links.next).searchParams.get('page[after]') || undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run to verify the pagination tests pass**

Run: `npm test`
Expected: PASS, all 5 tests in `pagination.test.js`.

- [ ] **Step 5: Write the failing tool tests**

Create `tests/tools/ticket-comments.test.js`:

```js
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
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `No tool named get_ticket_comments`.

- [ ] **Step 7: Implement the client method and tool**

In `src/zendesk-client.js`, add after `deleteTicket`:

```js

      async listTicketComments(id, params) {
        return this.request('GET', `/tickets/${id}/comments.json`, null, params);
      }
```

In `src/tools/tickets.js`, add to the imports:

```js
    import { collectPages } from '../pagination.js';
```

Change the format import to `import { jsonResult, summarizeComment, summarizeTicket } from '../format.js';`. Then add this tool object right after the `get_ticket` object:

```js
      {
        name: "get_ticket_comments",
        description: "Get the conversation on a ticket: every public reply and internal note, oldest first, as plain text with author names",
        schema: {
          id: z.number().describe("Ticket ID"),
          include_internal: z.boolean().optional().describe("Include internal notes (default true)"),
          max_comments: z.number().int().positive().optional().describe("Stop after this many comments (default 200)")
        },
        handler: async ({ id, include_internal = true, max_comments = 200 }) => {
          try {
            const users = new Map();
            const { items, truncated } = await collectPages(
              params => zendeskClient.listTicketComments(id, { ...params, include: 'users' }),
              'comments',
              { limit: max_comments, onPage: page => (page.users || []).forEach(user => users.set(user.id, user)) }
            );
            const comments = items
              .filter(comment => include_internal || comment.public)
              .map(comment => summarizeComment(comment, users));
            return jsonResult({ ticket_id: id, comments, truncated });
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting ticket comments: ${error.message}` }],
              isError: true
            };
          }
        }
      },
```

- [ ] **Step 8: Run to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 9: Commit**

```bash
git add src/pagination.js src/zendesk-client.js src/tools/tickets.js tests/pagination.test.js tests/tools/ticket-comments.test.js
git commit -m "Add get_ticket_comments for full ticket conversations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Help Center article search

**Files:**
- Modify: `src/zendesk-client.js` (add `searchArticles` after `getArticle`), `src/tools/help-center.js` (add `search_articles` after `get_article`)
- Test: `tests/tools/search-articles.test.js`

**Interfaces:**
- Consumes: `summarizeArticle`, `jsonResult` (Task 2); `defined` (Task 1)
- Produces:
  - `zendeskClient.searchArticles(params)` → `GET /help_center/articles/search.json`
  - The `search_articles` tool → `{ articles: ArticleSummary[] (with snippet, no body), count, next_page }`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/search-articles.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `No tool named search_articles`.

- [ ] **Step 3: Implement**

In `src/zendesk-client.js`, add after `getArticle`:

```js

      async searchArticles(params) {
        return this.request('GET', '/help_center/articles/search.json', null, params);
      }
```

In `src/tools/help-center.js`, add this tool object after `get_article`:

```js
      {
        name: "search_articles",
        description: "Search Help Center articles by keyword. Returns titles, links and matching snippets; use get_article for an article's full text",
        schema: {
          query: z.string().describe("Words to search for"),
          locale: z.string().optional().describe("Only articles in this locale, e.g. 'en-us'"),
          category_id: z.number().optional().describe("Only articles in this category"),
          section_id: z.number().optional().describe("Only articles in this section"),
          label_names: z.array(z.string()).optional().describe("Only articles with any of these labels (Professional and Enterprise plans only)"),
          updated_after: z.string().optional().describe("Only articles updated after this date (YYYY-MM-DD)"),
          page: z.number().optional().describe("Page number for pagination"),
          per_page: z.number().optional().describe("Number of articles per page (max 100)")
        },
        handler: async ({ query, locale, category_id, section_id, label_names, updated_after, page, per_page }) => {
          try {
            const result = await zendeskClient.searchArticles({
              query,
              locale,
              category: category_id,
              section: section_id,
              label_names: label_names?.join(','),
              updated_after,
              page,
              per_page
            });
            return jsonResult({
              articles: result.results.map(article => summarizeArticle(article)),
              count: result.count,
              next_page: result.next_page
            });
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error searching articles: ${error.message}` }],
              isError: true
            };
          }
        }
      },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/zendesk-client.js src/tools/help-center.js tests/tools/search-articles.test.js
git commit -m "Add search_articles for Help Center keyword search

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Help Center structure

**Files:**
- Modify: `src/zendesk-client.js` (add `listCategories` and `listSections` before `listArticles`), `src/tools/help-center.js` (add `get_help_center_structure` after `search_articles`)
- Test: `tests/tools/help-center-structure.test.js`

**Interfaces:**
- Consumes: `collectPages` (Task 4), `jsonResult` (Task 2)
- Produces:
  - `zendeskClient.listCategories(params)` → `GET /help_center/categories.json`
  - `zendeskClient.listSections(params)` → `GET /help_center/sections.json`
  - The `get_help_center_structure` tool → `{ categories: CategoryNode[], totals: { categories, sections, articles? } }`, where
    - `CategoryNode = { id, name, html_url, sections?: SectionNode[] }`
    - `SectionNode = { id, name, html_url, articles?, drafts?, last_updated?, sections?: SectionNode[] }`
    - Nodes are sorted by `position`. Empty `sections` arrays are left out.

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/help-center-structure.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `No tool named get_help_center_structure`.

- [ ] **Step 3: Implement**

In `src/zendesk-client.js`, add before `listArticles`:

```js
      async listCategories(params) {
        return this.request('GET', '/help_center/categories.json', null, params);
      }

      async listSections(params) {
        return this.request('GET', '/help_center/sections.json', null, params);
      }

```

In `src/tools/help-center.js`, add `import { collectPages } from '../pagination.js';` to the imports. Add these helpers between the imports and `export const helpCenterTools`:

```js
    function byPosition(a, b) {
      return (a.position ?? 0) - (b.position ?? 0);
    }

    // Per-section article counts: { articles, drafts, last_updated }
    function countArticles(articles) {
      const counts = new Map();
      for (const article of articles) {
        const count = counts.get(article.section_id) || { articles: 0, drafts: 0 };
        count.articles++;
        if (article.draft) count.drafts++;
        if (!count.last_updated || article.updated_at > count.last_updated) count.last_updated = article.updated_at;
        counts.set(article.section_id, count);
      }
      return counts;
    }

    // Categories → sections → subsections; counts is null when not requested
    function buildTree(categories, sections, counts) {
      const sectionNode = section => {
        const children = sections.filter(child => child.parent_section_id === section.id).sort(byPosition).map(sectionNode);
        return {
          id: section.id,
          name: section.name,
          html_url: section.html_url,
          ...(counts ? (counts.get(section.id) || { articles: 0, drafts: 0 }) : {}),
          ...(children.length ? { sections: children } : {})
        };
      };

      return [...categories].sort(byPosition).map(category => {
        const topLevel = sections.filter(section => section.category_id === category.id && !section.parent_section_id);
        const children = topLevel.sort(byPosition).map(sectionNode);
        return {
          id: category.id,
          name: category.name,
          html_url: category.html_url,
          ...(children.length ? { sections: children } : {})
        };
      });
    }

```

Add this tool object after `search_articles`:

```js
      {
        name: "get_help_center_structure",
        description: "Get the Help Center's categories, sections and subsections as a tree, with article counts and last-updated dates per section, to see which areas are thin or stale",
        schema: {
          include_article_counts: z.boolean().optional().describe("Count articles per section (default true; lists every article, so slower on large Help Centers)")
        },
        handler: async ({ include_article_counts = true }) => {
          try {
            const [categories, sections] = await Promise.all([
              collectPages(params => zendeskClient.listCategories(params), 'categories'),
              collectPages(params => zendeskClient.listSections(params), 'sections')
            ]);
            const articles = include_article_counts
              ? (await collectPages(params => zendeskClient.listArticles(params), 'articles')).items
              : null;

            return jsonResult({
              categories: buildTree(categories.items, sections.items, articles && countArticles(articles)),
              totals: {
                categories: categories.items.length,
                sections: sections.items.length,
                ...(articles ? { articles: articles.length } : {})
              }
            });
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting Help Center structure: ${error.message}` }],
              isError: true
            };
          }
        }
      },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, all suites. Key order matters for `deepEqual` only in arrays, not in objects, so the spread order doesn't affect the test.

- [ ] **Step 5: Commit**

```bash
git add src/zendesk-client.js src/tools/help-center.js tests/tools/help-center-structure.test.js
git commit -m "Add get_help_center_structure with per-section article counts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Retry on rate limits

**Files:**
- Modify: `src/zendesk-client.js` (constructor and `request`)
- Test: `tests/zendesk-client.test.js`

**Interfaces:**
- Consumes: `setProperty` (Task 1 test helpers)
- Produces:
  - `zendeskClient.http`: the axios-compatible function used for requests (replaceable in tests).
  - `zendeskClient.sleep(ms)`: replaceable in tests.
  - `request()` retries `429` up to 3 times, then throws.
  - Thrown API errors carry `error.status`, and their message format is unchanged: `Zendesk API Error: <status> - <json>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/zendesk-client.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zendeskClient } from '../src/zendesk-client.js';
import { setProperty } from './helpers.js';

function httpError(status, headers = {}, data = { error: 'x' }) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, headers, data } });
}

// Configure credentials and fake the transport for one test
function setup(t, responses) {
  const sleeps = [];
  const requests = [];
  setProperty(t, zendeskClient, 'subdomain', 'acme');
  setProperty(t, zendeskClient, 'email', 'a@b.c');
  setProperty(t, zendeskClient, 'apiToken', 'token');
  setProperty(t, zendeskClient, 'sleep', async ms => { sleeps.push(ms); });
  setProperty(t, zendeskClient, 'http', async config => {
    requests.push(config);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { data: next };
  });
  return { sleeps, requests };
}

test('sends the request to the account URL with basic auth', async t => {
  const { requests } = setup(t, [{ ok: true }]);
  assert.deepEqual(await zendeskClient.request('GET', '/tickets.json', null, { page: 1 }), { ok: true });
  assert.equal(requests[0].url, 'https://acme.zendesk.com/api/v2/tickets.json');
  assert.deepEqual(requests[0].params, { page: 1 });
  assert.match(requests[0].headers.Authorization, /^Basic /);
});

test('waits for Retry-After and retries on 429', async t => {
  const { sleeps, requests } = setup(t, [httpError(429, { 'retry-after': '5' }), { ok: true }]);
  assert.deepEqual(await zendeskClient.request('GET', '/tickets.json'), { ok: true });
  assert.deepEqual(sleeps, [5000]);
  assert.equal(requests.length, 2);
});

test('waits 10 seconds without Retry-After, and at most 60', async t => {
  const { sleeps } = setup(t, [httpError(429), httpError(429, { 'retry-after': '120' }), { ok: true }]);
  await zendeskClient.request('GET', '/tickets.json');
  assert.deepEqual(sleeps, [10000, 60000]);
});

test('gives up after 3 retries', async t => {
  const { requests } = setup(t, [httpError(429), httpError(429), httpError(429), httpError(429)]);
  await assert.rejects(zendeskClient.request('GET', '/tickets.json'), error => {
    assert.equal(error.status, 429);
    assert.match(error.message, /^Zendesk API Error: 429 - /);
    return true;
  });
  assert.equal(requests.length, 4);
});

test('does not retry other errors, and keeps the message format', async t => {
  const { requests } = setup(t, [httpError(404, {}, { error: 'RecordNotFound' })]);
  await assert.rejects(zendeskClient.request('GET', '/tickets/1.json'), error => {
    assert.equal(error.status, 404);
    assert.equal(error.message, 'Zendesk API Error: 404 - {"error":"RecordNotFound"}');
    return true;
  });
  assert.equal(requests.length, 1);
});

test('refuses to call Zendesk without credentials', async t => {
  setup(t, []);
  zendeskClient.apiToken = undefined; // restored by setup's setProperty
  await assert.rejects(zendeskClient.request('GET', '/tickets.json'), /credentials not configured/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL. Every test except `refuses to call Zendesk without credentials` fails, because the client still calls `axios` directly and ignores the fake `http`. In this one red run, those tests send a real, unauthenticated request to `acme.zendesk.com` that fails. That's expected, and it stops once Step 3 adds the `http` seam.

- [ ] **Step 3: Implement**

In `src/zendesk-client.js`, add at the end of the constructor, after the credentials warning:

```js

        // Replaceable in tests
        this.http = axios;
        this.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
```

Replace the whole `request` method with:

```js
      async request(method, endpoint, data = null, params = null) {
        if (!this.subdomain || !this.email || !this.apiToken) {
          throw new Error('Zendesk credentials not configured. Please set environment variables.');
        }

        const url = `${this.getBaseUrl()}${endpoint}`;
        const headers = {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json'
        };

        for (let attempt = 0; ; attempt++) {
          try {
            const response = await this.http({ method, url, headers, data, params });
            return response.data;
          } catch (error) {
            const status = error.response?.status;
            // Rate limited: wait as long as Zendesk asks (capped), then retry
            if (status === 429 && attempt < MAX_RETRIES) {
              const seconds = Number(error.response.headers?.['retry-after']) || 10;
              await this.sleep(Math.min(seconds, 60) * 1000);
              continue;
            }
            if (error.response) {
              const apiError = new Error(`Zendesk API Error: ${status} - ${JSON.stringify(error.response.data)}`);
              apiError.status = status;
              throw apiError;
            }
            throw error;
          }
        }
      }
```

Add after `import axios from 'axios';`:

```js

    const MAX_RETRIES = 3;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/zendesk-client.js tests/zendesk-client.test.js
git commit -m "Retry Zendesk requests that hit the rate limit

Waits for Retry-After (10s if missing, at most 60s), up to 3 retries.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Resumable ticket export to a local file

**Files:**
- Create: `src/export.js`, `src/tools/export.js`, `tests/export.test.js`, `tests/tools/export-tool.test.js`
- Modify: `src/zendesk-client.js` (add `exportSearch` after `search`), `src/tools/index.js` (add `exportTools`), `manifest.json` (add the export folder setting)

**Interfaces:**
- Consumes: `collectPages`, `nextCursor` (Task 4), `summarizeTicket`, `summarizeComment`, `jsonResult` (Task 2), `selectTools`/`getAnnotations` (Task 1), `zendeskClient.listTicketComments` (Task 4)
- Produces:
  - `zendeskClient.exportSearch(params)` → `GET /search/export.json`
  - `exportDir() → string`, `safeFileName(name?, now?) → string`
  - `exportTickets(client, { query, include_comments, file_name, resume }, { now, budgetMs }) → Promise<{ file, written, done, resume?, message }>`
  - The `export_tickets` tool, which returns the same object.
  - File format: one `summarizeTicket(ticket, { descriptionLength: Infinity })` JSON object per line. With `include_comments`, each line also has `comments: CommentSummary[]`.

- [ ] **Step 1: Write the failing core tests**

Create `tests/export.test.js`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportTickets, safeFileName } from '../src/export.js';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zendesk-export-test-'));
  process.env.ZENDESK_EXPORT_DIR = dir;
});

const ticket = id => ({ id, subject: `Ticket ${id}`, status: 'open', url: `https://x/${id}` });

// A fake Zendesk client: `pages` are search-export pages in order
function fakeClient(pages, commentsByTicket = {}) {
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/export.js`.

- [ ] **Step 3: Implement the export core**

In `src/zendesk-client.js`, add after `search`:

```js

      // Search Export API: cursor-paginated, no 1,000-result cap, needs filter[type]
      async exportSearch(params) {
        return this.request('GET', '/search/export.json', null, params);
      }
```

Create `src/export.js`:

```js
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { summarizeComment, summarizeTicket } from './format.js';
import { collectPages, nextCursor } from './pagination.js';

// Stop starting new work after this long, so each tool call finishes well
// inside client timeouts; the caller resumes with the returned token
const DEFAULT_BUDGET_MS = 40_000;

export function exportDir() {
  return process.env.ZENDESK_EXPORT_DIR || join(homedir(), 'Zendesk exports');
}

// Only a bare, sanitized file name inside the export folder, so a
// prompt-injected call can't write anywhere else
export function safeFileName(name, now = new Date()) {
  const base = name
    ? basename(name).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
    : `tickets-${now.toISOString().replace(/[:.]/g, '-')}`;
  if (!base) throw new Error('Invalid file name');
  return base.endsWith('.jsonl') ? base : `${base}.jsonl`;
}

function encodeResume(state) {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeResume(token) {
  try {
    const state = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (typeof state.query !== 'string' || typeof state.file !== 'string') throw new Error();
    return { ...state, file: safeFileName(state.file) };
  } catch {
    throw new Error('Invalid resume value. Start a new export instead.');
  }
}

async function ticketRecord(client, ticket, includeComments) {
  const record = summarizeTicket(ticket, { descriptionLength: Infinity });
  if (includeComments) {
    const users = new Map();
    const { items } = await collectPages(
      params => client.listTicketComments(ticket.id, { ...params, include: 'users' }),
      'comments',
      { onPage: page => (page.users || []).forEach(user => users.set(user.id, user)) }
    );
    record.comments = items.map(comment => summarizeComment(comment, users));
  }
  return record;
}

function progress(state, path, done) {
  return {
    file: path,
    written: state.written,
    done,
    ...(done ? {} : { resume: encodeResume(state) }),
    message: done
      ? `Exported ${state.written} tickets to ${path}.`
      : `Exported ${state.written} tickets so far. Call export_tickets again with this resume value within an hour to continue.`
  };
}

// Writes one summarized ticket per line. `after` is the cursor that fetched
// the current page (null for the first) and `skip` is how many of its
// tickets are already written, so a resumed call picks up exactly where the
// last one stopped.
export async function exportTickets(client, { query, include_comments = false, file_name, resume } = {},
  { now = Date.now, budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const state = resume
    ? decodeResume(resume)
    : { query, includeComments: Boolean(include_comments), file: safeFileName(file_name), after: null, skip: 0, written: 0 };
  if (!state.query) throw new Error('query is required to start an export');

  const dir = exportDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, state.file);
  if (!resume && existsSync(path)) {
    throw new Error(`${state.file} already exists in the export folder. Choose another file name.`);
  }

  const deadline = now() + budgetMs;
  // Zendesk allows 1000 but recommends 100: big pages can time out on
  // accounts with many archived tickets
  const pageSize = 100;
  let writtenThisCall = 0;

  while (true) {
    const params = { query: state.query, 'filter[type]': 'ticket', 'page[size]': pageSize };
    if (state.after) params['page[after]'] = state.after;
    const page = await client.exportSearch(params);
    const tickets = page.results || [];

    for (let index = state.skip; index < tickets.length; index++) {
      // Always write at least one ticket per call so an export can't stall
      if (writtenThisCall > 0 && now() >= deadline) {
        state.skip = index;
        return progress(state, path, false);
      }
      const record = await ticketRecord(client, tickets[index], state.includeComments);
      appendFileSync(path, JSON.stringify(record) + '\n');
      state.written++;
      writtenThisCall++;
    }

    const cursor = nextCursor(page);
    if (!page.meta?.has_more || !cursor) return progress(state, path, true);
    state.after = cursor;
    state.skip = 0;
    if (now() >= deadline) return progress(state, path, false);
  }
}
```

- [ ] **Step 4: Run to verify the core tests pass**

Run: `npm test`
Expected: PASS, all tests in `export.test.js`.

- [ ] **Step 5: Write the failing tool tests**

Create `tests/tools/export-tool.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportTools } from '../../src/tools/export.js';
import { allTools } from '../../src/tools/index.js';
import { getAnnotations, selectTools } from '../../src/tool-registry.js';
import { findTool, resultJson, stubZendesk } from '../helpers.js';

// Never write to the real export folder, even when one test runs alone
process.env.ZENDESK_EXPORT_DIR = mkdtempSync(join(tmpdir(), 'zendesk-export-tool-'));

test('export_tickets exports through the Zendesk client', async t => {
  stubZendesk(t, { 'GET /search/export.json': { results: [{ id: 1, subject: 'A' }], meta: { has_more: false } } });
  const output = resultJson(await findTool(exportTools, 'export_tickets').handler({ query: 'tags:backup', file_name: 'backup' }));
  assert.equal(output.done, true);
  assert.equal(output.written, 1);
  assert.equal(output.file, join(process.env.ZENDESK_EXPORT_DIR, 'backup.jsonl'));
});

test('export_tickets reports errors as tool errors', async t => {
  stubZendesk(t, { 'GET /search/export.json': () => { throw new Error('Zendesk API Error: 422 - {}'); } });
  const result = await findTool(exportTools, 'export_tickets').handler({ query: 'x' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^Error exporting tickets: /);
});

test('export_tickets stays available in read-only mode and is marked as writing locally', () => {
  const tool = findTool(allTools, 'export_tickets');
  assert.ok(selectTools(allTools, { readOnly: true }).includes(tool));
  assert.deepEqual(getAnnotations(tool), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/tools/export.js`.

- [ ] **Step 7: Implement the tool and register it**

Create `src/tools/export.js`:

```js
import { z } from 'zod';
import { zendeskClient } from '../zendesk-client.js';
import { exportTickets } from '../export.js';
import { jsonResult } from '../format.js';

export const exportTools = [
  {
    name: "export_tickets",
    description: "Export every ticket matching a Zendesk search to a JSON Lines file in the export folder, one ticket per line, for analyzing more tickets than fit in a conversation. Large exports take several calls: while done is false, call again with only the returned resume value.",
    // Writes a local file but never changes Zendesk, so read-only mode keeps it
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    schema: {
      query: z.string().optional().describe("Zendesk search query, e.g. 'created>2026-01-01 tags:backup'. Required unless resuming"),
      include_comments: z.boolean().optional().describe("Also export each ticket's full conversation (one extra request per ticket, so much slower)"),
      file_name: z.string().optional().describe("File name inside the export folder (default tickets-<timestamp>.jsonl)"),
      resume: z.string().optional().describe("The resume value from the previous call, to continue an export")
    },
    handler: async args => {
      try {
        return jsonResult(await exportTickets(zendeskClient, args));
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error exporting tickets: ${error.message}` }],
          isError: true
        };
      }
    }
  }
];
```

In `src/tools/index.js`, add `import { exportTools } from './export.js';` after the `chatTools` import, and add `...exportTools` as the last entry of `allTools`. Remember to add a comma after `...chatTools`.

In `manifest.json`, add to `server.mcp_config.env`:

```json
        "ZENDESK_EXPORT_DIR": "${user_config.export_dir}"
```

Add to `user_config`, after `allow_admin_role`:

```json
    "export_dir": {
      "type": "directory",
      "title": "Export folder",
      "description": "Where ticket exports are saved. To analyze exports in Cowork, pick the folder you use with Cowork.",
      "default": "${HOME}/Zendesk exports",
      "required": false
    }
```

- [ ] **Step 8: Run all tests and validate the manifest**

Run: `npm test && npx mcpb validate manifest.json`
Expected: all tests PASS, then `Manifest schema validation passes!`.

- [ ] **Step 9: Commit**

```bash
git add src/export.js src/tools/export.js src/tools/index.js src/zendesk-client.js manifest.json tests/export.test.js tests/tools/export-tool.test.js
git commit -m "Add export_tickets: resumable export of search results to JSON Lines

Uses the Search Export API (agent token, no 1,000-result cap) and writes
only inside the configured export folder. Each call stops after about 40
seconds and returns a resume token.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Manifest tool list, version 1.1.0, docs and release notes

**Files:**
- Modify: `manifest.json` (`tools`), `package.json` (`version`), `README.md` (tool list), `RELEASE_NOTES.md` (new `## v1.1.0` section at the top)
- Test: `tests/manifest.test.js`

**Interfaces:**
- Consumes: `allTools` (Tasks 1 and 8)

- [ ] **Step 1: Write the failing test**

Create `tests/manifest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allTools } from '../src/tools/index.js';

const readJson = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('manifest lists exactly the tools the server offers', () => {
  const manifest = readJson('manifest.json');
  assert.deepEqual(manifest.tools.map(tool => tool.name).sort(), allTools.map(tool => tool.name).sort());
});

test('manifest and package.json versions match', () => {
  assert.equal(readJson('manifest.json').version, readJson('package.json').version);
});

test('release notes cover the current version', () => {
  const version = readJson('package.json').version;
  assert.match(readFileSync(new URL('../RELEASE_NOTES.md', import.meta.url), 'utf8'), new RegExp(`^## v${version.replace(/\./g, '\\.')}$`, 'm'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL in the first test, because the manifest is missing `get_ticket_comments`, `search_articles`, `get_help_center_structure` and `export_tickets`. The other two pass for now.

- [ ] **Step 3: Update the manifest tool list and bump the version**

In `manifest.json`, add these entries to `tools`:
- Put `get_ticket_comments` after `get_ticket`.
- Put `search_articles` and `get_help_center_structure` after `get_article`.
- Put `export_tickets` last.

```json
    {
      "name": "get_ticket_comments",
      "description": "Get the conversation on a ticket: every public reply and internal note, oldest first, as plain text with author names"
    },
```

```json
    {
      "name": "search_articles",
      "description": "Search Help Center articles by keyword. Returns titles, links and matching snippets; use get_article for an article's full text"
    },
    {
      "name": "get_help_center_structure",
      "description": "Get the Help Center's categories, sections and subsections as a tree, with article counts and last-updated dates per section, to see which areas are thin or stale"
    },
```

```json
    {
      "name": "export_tickets",
      "description": "Export every ticket matching a Zendesk search to a JSON Lines file in the export folder, one ticket per line, for analyzing more tickets than fit in a conversation. Large exports take several calls: while done is false, call again with only the returned resume value."
    }
```

Set `"version": "1.1.0"` in both `manifest.json` and `package.json`.

- [ ] **Step 4: Run to verify the manifest test passes and the release-notes test fails**

Run: `npm test`
Expected: the first two manifest tests PASS. `release notes cover the current version` FAILS, because there is no `## v1.1.0` heading yet.

- [ ] **Step 5: Write the release notes and README**

In `RELEASE_NOTES.md`, insert this section directly under the `# Release notes` heading, above `## v1.0.0`. It's written for the people installing the extension, not for developers.

```markdown
## v1.1.0

This release makes Claude much better at analyzing your tickets and Help Center, and all of it works in read-only mode.

### What's new

- **Full ticket conversations.** Claude can now read every reply and internal note on a ticket, not just the first message, and sees who wrote each one.
- **Help Center search.** Ask things like "which articles cover restoring a volume?" and Claude searches your Help Center directly.
- **Help Center overview.** Claude can see how your Help Center is organized and how many articles each section has, including when each section was last updated. Try "which sections of our Help Center are thin or out of date?"
- **Exports for big questions.** For questions about hundreds or thousands of tickets, Claude can save the matching tickets to a file and analyze the file. This avoids the limit on how many tickets fit in one conversation. Exports go to the **Export folder** in the extension's settings (normally a folder called *Zendesk exports* in your home folder). If you use Claude Cowork, set it to the folder you use with Cowork so Claude can read the files.
- **Faster, longer conversations.** Claude now gets a short summary of each ticket and article instead of everything Zendesk sends, so it can look at many more of them before a conversation gets too long.

### Good to know

- **Big exports come in batches.** A large export can take several minutes. Claude saves it in batches and keeps going on its own. Including full conversations makes exports much slower.
- **Claude may ask before exporting.** Because an export saves a file on your computer, Claude Desktop may ask your permission first, even in read-only mode. The export only reads from Zendesk and never changes anything there.
- **Busy accounts may pause.** If your Zendesk account is busy, Claude may pause for a few seconds and retry. That's normal.

### Updating

Download the new `.mcpb` file and double-click it with Claude Desktop open. Your settings are kept.

```

In `README.md`, under `## Available Tools`, add these lines. Keep the README's existing leading indentation.
- Under `### Tickets`: ``- `get_ticket_comments`: Get a ticket's full conversation (replies and internal notes) as plain text``
- Under `### Help Center`: ``- `search_articles`: Search Help Center articles by keyword`` and ``- `get_help_center_structure`: Categories, sections and per-section article counts``
- A new `### Export` section: ``- `export_tickets`: Export tickets matching a search to a JSON Lines file in the export folder (`ZENDESK_EXPORT_DIR`, default `~/Zendesk exports`); resumable for large exports``

Also add `ZENDESK_EXPORT_DIR` to the list of optional settings in the Installation section: ``- `ZENDESK_EXPORT_DIR=/path` sets where `export_tickets` saves files (default `~/Zendesk exports`).``

- [ ] **Step 6: Run the full suite and build both bundles**

Run: `npm test && scripts/release.sh build --all`
Expected: all tests PASS. Two files are built: `dist/zendesk-mcp-server-1.1.0.mcpb` and `dist/zendesk-mcp-server-1.1.0-writes.mcpb`.

- [ ] **Step 7: Commit**

```bash
git add manifest.json package.json README.md RELEASE_NOTES.md tests/manifest.test.js
git commit -m "Release notes, docs and manifest for v1.1.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Read-only smoke check for a real account

No live Zendesk account was available while planning. The automated tests prove the code handles Zendesk's documented responses, but not that a real account returns exactly those. This task adds a script that anyone with access can run in a minute, before a release goes out. Examples: a teammate on the real account, or a free Zendesk trial. The script only reads from Zendesk and never changes anything.

**Files:**
- Create: `scripts/smoke-check.mjs`, `tests/smoke-check.test.js`
- Modify: `README.md` (how to run it)

**Interfaces:**
- Consumes: `allTools` (Task 1), `findTool`-style lookup by name, `exportTickets` output shape (Task 8)
- Produces: `runSmokeCheck(tools, { log }) → Promise<{ passed: number, failed: number }>`, exported from `scripts/smoke-check.mjs`. When the script runs directly, it exits 1 if any check failed.

- [ ] **Step 1: Write the failing test**

The smoke check's logic is tested with stubbed tools, so a broken check is caught before anyone runs it for real. Create `tests/smoke-check.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/smoke-check.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/smoke-check.mjs`:

```js
#!/usr/bin/env node
// Read-only smoke check against a real Zendesk account. Calls each analysis
// tool once and checks the response shape. Never changes Zendesk data; the
// export check writes one small file to a temporary folder.
//
// Usage: ZENDESK_SUBDOMAIN=... ZENDESK_EMAIL=... ZENDESK_API_TOKEN=... node scripts/smoke-check.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function call(tools, name, args) {
  const tool = tools.find(candidate => candidate.name === name);
  const result = await tool.handler(args);
  const text = result.content[0].text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

export async function runSmokeCheck(tools, { log = console.log } = {}) {
  let passed = 0;
  let failed = 0;
  let ticketId;

  const checks = [
    ['search', () => call(tools, 'search', { query: 'type:ticket', per_page: 1 }), output => {
      if (!Array.isArray(output.results)) return 'no results array';
      ticketId = output.results[0]?.id;
    }],
    ['get_ticket_comments', () => ticketId && call(tools, 'get_ticket_comments', { id: ticketId, max_comments: 5 }),
      output => Array.isArray(output.comments) ? null : 'no comments array'],
    ['search_articles', () => call(tools, 'search_articles', { query: 'the', per_page: 1 }),
      output => Array.isArray(output.articles) ? null : 'no articles array'],
    ['get_help_center_structure', () => call(tools, 'get_help_center_structure', { include_article_counts: false }),
      output => Array.isArray(output.categories) && output.totals ? null : 'no categories tree'],
    ['export_tickets', () => call(tools, 'export_tickets', { query: 'created>2000-01-01', file_name: 'smoke-check' }),
      output => typeof output.written === 'number' && typeof output.done === 'boolean' ? null : 'no export progress']
  ];

  for (const [name, run, check] of checks) {
    try {
      const output = await run();
      // The comments check has nothing to run when search found no ticket
      if (output === undefined) {
        log(`SKIP ${name}: the account has no tickets to check it with`);
        continue;
      }
      const problem = check(output);
      if (problem) throw new Error(`unexpected response: ${problem}`);
      log(`PASS ${name}`);
      passed++;
    } catch (error) {
      log(`FAIL ${name}: ${error.message}`);
      failed++;
    }
  }

  return { passed, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.ZENDESK_EXPORT_DIR = mkdtempSync(join(tmpdir(), 'zendesk-smoke-'));
  const { allTools } = await import('../src/tools/index.js');
  const { passed, failed } = await runSmokeCheck(allTools);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
```

In `README.md`, add under the Claude Desktop extension section:

```markdown
    ### Checking against a real account

    Before publishing a release, anyone with Zendesk access can run a quick read-only check. It never changes Zendesk data:
    ```
    ZENDESK_SUBDOMAIN=... ZENDESK_EMAIL=... ZENDESK_API_TOKEN=... node scripts/smoke-check.mjs
    ```
    It calls each analysis tool once and prints PASS, FAIL or SKIP for each. An agent token is enough.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, all suites including `smoke-check.test.js`.

- [ ] **Step 5: Confirm the script refuses to run without credentials**

Run: `env -u ZENDESK_SUBDOMAIN -u ZENDESK_EMAIL -u ZENDESK_API_TOKEN node scripts/smoke-check.mjs; echo "exit $?"`

Run it from a directory without a `.env`, or temporarily move `.env` aside. The script imports `src/tools/index.js`, which doesn't load `.env` itself, so only the shell environment counts.

Expected: `search`, `search_articles`, `get_help_center_structure` and `export_tickets` each print `FAIL …: Zendesk credentials not configured…`. `get_ticket_comments` prints `SKIP`, because `search` found no ticket. The script then prints `0 passed, 4 failed` and `exit 1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-check.mjs tests/smoke-check.test.js README.md
git commit -m "Add read-only smoke check for running against a real account

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Before publishing v1.1.0**

Someone with Zendesk access runs `node scripts/smoke-check.mjs` with their own credentials, and pastes the output into the PR. If a check fails, reproduce the failure in a unit test using the real response, fix it, and run the smoke check again. Checking that Cowork can read an export also needs a real account: set **Export folder** to the Cowork folder, run a small export and ask Claude to summarize it.

---

## Self-review

- **Coverage of the five requirements:**
  - Conversations → Task 4. Article search → Task 5. Structure → Task 6. Trimmed output → Tasks 2–3. Export → Task 8, with rate limits in Task 7.
  - Read-only-mode compatibility → Tasks 1 and 8.
  - Cowork file access → the Task 8 manifest setting, plus the Task 10 pre-release step.
  - Users learn about all of it → Task 9 release notes.
- **Names used across tasks:** `collectPages`, `summarizeTicket`, `summarizeComment`, `summarizeArticle`, `jsonResult`, `selectTools`, `getAnnotations`, `allTools`, `listTicketComments`, `searchArticles`, `listCategories`, `listSections`, `exportSearch` and `exportTickets` are each defined once and used with the same signature everywhere.
- **API details:** each endpoint, parameter and response shape used here comes from Zendesk's API reference: ticket comments, Help Center search (`help_center_search`), sections, articles, Search Export, cursor pagination and rate limits. The test fixtures follow those documented shapes. No live account was available, so Task 10 provides a read-only smoke check for whoever does have access.
