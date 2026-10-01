// End-to-end checks against a real Zendesk account. Starts the real MCP
// server over stdio, the way Claude Desktop does, and calls its tools.
//
// Read-only: the server runs with ZENDESK_READ_ONLY=true, so no tool that
// can change Zendesk data is even offered. Exports go to a temporary folder
// that is removed afterwards.
//
// Credentials come from .env (or the environment):
//   ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN
// Optional: ZENDESK_E2E_LABEL, a Help Center label to search by (default ai_valid)
//
// Run with: npm run test:e2e
import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const placeholder = value => !value || /^your-/.test(value);
const missing = ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN'].filter(name => placeholder(process.env[name]));
const skip = missing.length ? `set ${missing.join(', ')} in .env to run the end-to-end checks` : false;
const label = process.env.ZENDESK_E2E_LABEL || 'ai_valid';

describe('Zendesk end to end (read-only)', { skip }, () => {
  let client;
  let exportDir;
  const found = {};

  before(async () => {
    exportDir = mkdtempSync(join(tmpdir(), 'zendesk-e2e-'));
    client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'src/index.js')],
      cwd: root,
      // These win over anything in .env: always read-only, exports to a temp folder
      env: { ...process.env, ZENDESK_READ_ONLY: 'true', ZENDESK_EXPORT_DIR: exportDir },
      stderr: 'pipe'
    }));
  });

  after(async () => {
    await client?.close();
    if (exportDir) rmSync(exportDir, { recursive: true, force: true });
  });

  // Calls a tool and returns its parsed JSON output, failing on a tool error
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    assert.ok(!result.isError, `${name} returned an error: ${text}`);
    return JSON.parse(text);
  }

  test('read-only mode offers no tool that can change data', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.filter(tool => /^(create|update|delete)_/.test(tool.name)).map(tool => tool.name), []);
    for (const name of ['search', 'get_ticket', 'get_ticket_comments', 'search_articles', 'get_help_center_structure', 'export_tickets']) {
      assert.ok(tools.some(tool => tool.name === name), `${name} is offered`);
    }
  });

  test('search finds tickets', async () => {
    const output = await call('search', { query: 'type:ticket', per_page: 5 });
    assert.ok(Array.isArray(output.results), 'results is an array');
    found.ticketId = output.results.find(result => result.result_type === 'ticket')?.id;
  });

  test('list_tickets returns compact tickets', async () => {
    const output = await call('list_tickets', { per_page: 2 });
    assert.ok(Array.isArray(output.tickets), 'tickets is an array');
    found.ticketId ??= output.tickets[0]?.id;
  });

  test('get_ticket returns one ticket', async t => {
    if (!found.ticketId) return t.skip('the account has no tickets');
    const output = await call('get_ticket', { id: found.ticketId });
    assert.equal(output.id, found.ticketId);
    assert.equal(typeof output.subject, 'string');
  });

  test('get_ticket_comments returns the conversation', async t => {
    if (!found.ticketId) return t.skip('the account has no tickets');
    const output = await call('get_ticket_comments', { id: found.ticketId, max_comments: 5 });
    assert.ok(Array.isArray(output.comments), 'comments is an array');
    assert.ok(output.comments.length > 0, 'a ticket has at least its first comment');
    assert.equal(typeof output.comments[0].body, 'string');
  });

  test('get_help_center_structure returns the tree with counts', async () => {
    const output = await call('get_help_center_structure', {});
    assert.ok(Array.isArray(output.categories), 'categories is an array');
    assert.equal(typeof output.totals.sections, 'number');
    found.sectionId = output.categories.flatMap(category => category.sections ?? [])[0]?.id;
  });

  test('list_articles returns articles', async () => {
    const output = await call('list_articles', { per_page: 2 });
    assert.ok(Array.isArray(output.articles), 'articles is an array');
    found.articleId = output.articles[0]?.id;
  });

  test('search_articles by keyword', async () => {
    const output = await call('search_articles', { query: 'the', per_page: 2 });
    assert.ok(Array.isArray(output.articles), 'articles is an array');
    found.articleId ??= output.articles[0]?.id;
  });

  // The bug reported from the field: label searches failed with
  // "400 - Request body not accepted on GET request"
  test(`search_articles by label (${label})`, async () => {
    const output = await call('search_articles', { label_names: [label], per_page: 5 });
    assert.ok(Array.isArray(output.articles), 'articles is an array');
  });

  test('search_articles by section, without a query', async t => {
    if (!found.sectionId) return t.skip('the Help Center has no sections');
    const output = await call('search_articles', { section_id: found.sectionId, per_page: 2 });
    assert.ok(Array.isArray(output.articles), 'articles is an array');
  });

  test('get_article returns the full text', async t => {
    if (!found.articleId) return t.skip('the Help Center has no articles');
    const output = await call('get_article', { id: found.articleId });
    assert.equal(output.id, found.articleId);
    assert.equal(typeof output.body, 'string');
  });

  test('export_tickets writes JSON Lines and resumes until done', async () => {
    let output = await call('export_tickets', { query: 'created>7days', file_name: 'e2e' });
    for (let calls = 1; !output.done && calls < 5; calls++) {
      output = await call('export_tickets', { resume: output.resume });
    }
    const lines = readFileSync(output.file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, output.written);
    for (const line of lines) assert.equal(typeof JSON.parse(line).id, 'number');
    assert.ok(output.file.startsWith(exportDir), 'the export stays in the export folder');
  });

  test('the Zendesk API docs resource is readable', async () => {
    const { resources } = await client.listResources();
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.ok(resources.length + resourceTemplates.length > 0, 'the server offers a resource');
  });
});
