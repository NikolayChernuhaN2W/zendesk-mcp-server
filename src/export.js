import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { summarizeComment, summarizeTicket } from './format.js';
import { collectTicketComments, nextCursor } from './pagination.js';

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
    const { comments, users } = await collectTicketComments(client, ticket.id);
    record.comments = comments.map(comment => summarizeComment(comment, users));
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
