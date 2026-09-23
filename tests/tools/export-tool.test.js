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
