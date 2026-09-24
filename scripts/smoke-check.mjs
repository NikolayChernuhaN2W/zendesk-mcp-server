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
