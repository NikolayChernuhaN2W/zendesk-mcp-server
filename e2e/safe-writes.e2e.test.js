// Live write checks that can't harm a real Zendesk account. Off unless
// ZENDESK_E2E_WRITES=safe is set: npm run test:e2e:writes
//
// What it touches, and nothing else:
//   - a draft Help Center article (customers can't see drafts; subscribers
//     are not emailed)
//   - a group, an organization (no domains, so no users are mapped to it),
//     a macro (it only adds the tag e2e_test) and a view that matches no
//     ticket
// Every record is named MARKER. The first run creates them; later runs reuse
// and update the same records (their IDs are kept in e2e/.state.json). Before
// any update, the record is re-read and must still carry MARKER. Nothing is
// ever deleted; remove the records in Zendesk whenever you like.
//
// Tools that could change tickets, users, triggers or automations, and every
// delete, are refused before any request is sent. They are covered by the
// mocked contract tests in tests/tools/write-contract.test.js instead.
import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const statePath = join(root, 'e2e', '.state.json');
const MARKER = '[E2E TEST] zendesk-mcp-server (safe to delete)';
const NOTE = 'Created by the zendesk-mcp-server end-to-end test. Safe to delete.';
const TAG = 'e2e_test';

const placeholder = value => !value || /^your-/.test(value);
const missing = ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN'].filter(name => placeholder(process.env[name]));
const skip = process.env.ZENDESK_E2E_WRITES !== 'safe'
  ? 'set ZENDESK_E2E_WRITES=safe to run the live write checks'
  : missing.length ? `set ${missing.join(', ')} in .env` : false;

// The only writes this suite may make
const ALLOWED_WRITES = new Set([
  'create_article', 'update_article',
  'create_group', 'update_group',
  'create_organization', 'update_organization',
  'create_macro', 'update_macro',
  'create_view', 'update_view'
]);

describe('Zendesk live writes (safe only, nothing deleted)', { skip }, () => {
  let client;
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const stamp = new Date().toISOString();

  before(async () => {
    client = new Client({ name: 'e2e-writes', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'src/index.js')],
      cwd: root,
      env: { ...process.env, ZENDESK_READ_ONLY: 'false', ZENDESK_ALLOW_ADMIN_ROLE: 'false' },
      stderr: 'pipe'
    }));
  });

  after(async () => {
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
    await client?.close();
  });

  // Calls a tool; refuses any write outside the allowlist before sending it
  async function call(name, args = {}) {
    if (/^(create|update|delete)_/.test(name) && !ALLOWED_WRITES.has(name)) {
      throw new Error(`refusing to call ${name}: not a safe write`);
    }
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    assert.ok(!result.isError, `${name} returned an error: ${text}`);
    // Write tools answer "… successfully!" followed by the JSON
    return JSON.parse(text.slice(text.indexOf('{')));
  }

  // Re-reads a record and returns it only if it is still this suite's own
  async function ownRecord(getTool, key, id, nameField) {
    if (!id) return null;
    const result = await client.callTool({ name: getTool, arguments: { id } });
    if (result.isError) return null; // deleted in Zendesk since the last run
    const text = result.content[0].text;
    const output = JSON.parse(text.slice(text.indexOf('{')));
    const record = output[key] ?? output;
    return record[nameField] === MARKER ? record : null;
  }

  // Creates the record on the first run, then updates the same one on later runs
  async function createOrUpdate({ kind, key, nameField, create, update, check }) {
    const existing = await ownRecord(`get_${kind}`, key, state[kind], nameField);
    let id;
    if (existing) {
      id = existing.id;
    } else {
      id = (await call(`create_${kind}`, create))[key].id;
      state[kind] = id;
    }
    // ownRecord just confirmed (or we just created) MARKER on this id
    await call(`update_${kind}`, { id, ...update });
    const after = await ownRecord(`get_${kind}`, key, id, nameField);
    assert.ok(after, `${kind} ${id} still carries the test marker`);
    check(after);
    return id;
  }

  test('refuses dangerous writes without sending anything', async () => {
    for (const name of ['create_ticket', 'update_user', 'create_trigger', 'delete_group', 'delete_article']) {
      await assert.rejects(call(name, {}), /not a safe write/);
    }
  });

  test('group: create once, then update its description', async () => {
    await createOrUpdate({
      kind: 'group', key: 'group', nameField: 'name',
      create: { name: MARKER, description: NOTE },
      update: { description: `${NOTE} Last checked ${stamp}.` },
      check: group => assert.match(group.description, new RegExp(stamp.replace(/[.]/g, '\\.')))
    });
  });

  test('organization: create once (no domains), then update its notes', async () => {
    await createOrUpdate({
      kind: 'organization', key: 'organization', nameField: 'name',
      create: { name: MARKER, notes: NOTE, tags: [TAG] },
      update: { notes: `${NOTE} Last checked ${stamp}.` },
      check: organization => {
        assert.match(organization.notes, /Last checked/);
        assert.deepEqual(organization.domain_names ?? [], []);
      }
    });
  });

  test('macro: create once (only adds a tag), then update its description', async () => {
    await createOrUpdate({
      kind: 'macro', key: 'macro', nameField: 'title',
      // current_tags adds tags; it never removes or replaces any
      create: { title: MARKER, description: NOTE, actions: [{ field: 'current_tags', value: TAG }] },
      update: { description: `${NOTE} Last checked ${stamp}.` },
      check: macro => assert.deepEqual(macro.actions, [{ field: 'current_tags', value: TAG }])
    });
  });

  test('view: create once (matches no ticket), then update its description', async () => {
    await createOrUpdate({
      kind: 'view', key: 'view', nameField: 'title',
      create: {
        title: MARKER,
        description: NOTE,
        conditions: { all: [
          { field: 'status', operator: 'less_than', value: 'closed' },
          { field: 'current_tags', operator: 'includes', value: 'e2e_test_matches_nothing' }
        ] }
      },
      update: { description: `${NOTE} Last checked ${stamp}.` },
      check: view => assert.match(view.description, /Last checked/)
    });
  });

  test('article: create once as a draft without notifying, then update its body', async () => {
    const structure = await call('get_help_center_structure', { include_article_counts: false });
    const sectionId = Number(process.env.ZENDESK_E2E_SECTION_ID) || structure.categories.flatMap(category => category.sections ?? [])[0]?.id;
    assert.ok(sectionId, 'the Help Center has a section to put the draft in');

    // A new article needs a permission group; borrow one from an existing article
    const { articles } = await call('search_articles', { section_id: sectionId, per_page: 1 });
    const sample = articles[0] ?? (await call('list_articles', { per_page: 1 })).articles[0];
    const raw = sample && await call('get_article', { id: sample.id, raw: true });

    const existing = await ownRecord('get_article', 'article', state.article, 'title');
    let id = existing?.id;
    if (!id) {
      const created = await call('create_article', {
        title: MARKER,
        body: `<p>${NOTE}</p>`,
        section_id: sectionId,
        draft: true,
        notify_subscribers: false,
        label_names: [TAG],
        ...(raw?.article?.permission_group_id ? { permission_group_id: raw.article.permission_group_id } : {}),
        ...(Number.isInteger(raw?.article?.user_segment_id) ? { user_segment_id: raw.article.user_segment_id } : {})
      });
      id = created.article.id;
      state.article = id;
    }
    await call('update_article', { id, body: `<p>${NOTE} Last checked ${stamp}.</p>`, draft: true });

    const after = await call('get_article', { id });
    assert.equal(after.title, MARKER);
    assert.equal(after.draft, true, 'the article is still a draft');
    assert.match(after.body, /Last checked/);
  });

  test('lists the test records for removal later', () => {
    const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com`;
    console.log(`Test records (named "${MARKER}"), safe to delete in Zendesk:`);
    if (state.group) console.log(`  group ${state.group}: ${base}/admin/people/team/groups/${state.group}`);
    if (state.organization) console.log(`  organization ${state.organization}: ${base}/agent/organizations/${state.organization}`);
    if (state.macro) console.log(`  macro ${state.macro}: ${base}/admin/workspaces/agent-workspace/macros/${state.macro}`);
    if (state.view) console.log(`  view ${state.view}: ${base}/admin/workspaces/agent-workspace/views/${state.view}`);
    if (state.article) console.log(`  draft article ${state.article}: ${base}/knowledge/articles/${state.article}`);
  });
});
