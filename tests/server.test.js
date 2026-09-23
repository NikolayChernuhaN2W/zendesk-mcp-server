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
