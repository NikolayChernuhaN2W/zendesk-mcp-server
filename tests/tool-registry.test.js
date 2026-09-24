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
