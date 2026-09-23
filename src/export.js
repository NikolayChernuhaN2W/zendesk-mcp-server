import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

// A resume token is unsigned, so every field is validated before use. That
// alone isn't enough to trust it, though: exportTickets also binds it to the
// actual file with a byte-length check before appending anything.
function decodeResume(token) {
  try {
    const state = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    const valid = typeof state.query === 'string'
      && typeof state.file === 'string'
      && (state.after === null || typeof state.after === 'string')
      && isNonNegativeInt(state.skip)
      && isNonNegativeInt(state.written)
      && isNonNegativeInt(state.bytes)
      && typeof state.includeComments === 'boolean';
    if (!valid) throw new Error();
    return { ...state, file: safeFileName(state.file) };
  } catch {
    throw new Error('Invalid resume value. Start a new export instead.');
  }
}

async function ticketRecord(client, ticket, includeComments) {
  const record = summarizeTicket(ticket, { descriptionLength: Infinity });
  if (includeComments) {
    const { comments, users, truncated } = await collectTicketComments(client, ticket.id);
    record.comments = comments.map(comment => summarizeComment(comment, users));
    if (truncated) record.comments_truncated = true;
  }
  return record;
}

function progress(state, path, done, extra = {}) {
  return {
    file: path,
    written: state.written,
    done,
    ...(done ? {} : { resume: encodeResume(state) }),
    message: done
      ? `Exported ${state.written} tickets to ${path}.`
      : `Exported ${state.written} tickets so far. Call export_tickets again with this resume value within an hour to continue.`,
    ...extra
  };
}

// A mid-call failure (a page fetch or a ticket's comments) still leaves a
// usable resume token, so the caller can retry instead of losing progress
function errorProgress(state, path, error) {
  return progress(state, path, false, {
    error: error.message,
    message: `Stopped after ${state.written} tickets because of an error: ${error.message}. Call export_tickets again with this resume value to retry; if it keeps failing, start a new export (the cursor expires after an hour).`
  });
}

// Writes one summarized ticket per line. `after` is the cursor that fetched
// the current page (null for the first) and `skip` is how many of its
// tickets are already written, so a resumed call picks up exactly where the
// last one stopped. `bytes` is the file's length after the last line
// written, so a resume token only unlocks appending to the exact file it
// came from, not any other file that happens to have that name.
export async function exportTickets(client, { query, include_comments = false, file_name, resume } = {},
  { now = Date.now, budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const state = resume
    ? decodeResume(resume)
    : { query, includeComments: Boolean(include_comments), file: safeFileName(file_name), after: null, skip: 0, written: 0, bytes: 0 };
  if (!state.query) throw new Error('query is required to start an export');

  const dir = exportDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, state.file);

  if (resume) {
    if (!existsSync(path) || statSync(path).size !== state.bytes) {
      throw new Error('The export file no longer matches this resume value. Start a new export.');
    }
  } else {
    // Created up front, even for zero results, so the caller always gets a
    // real file; 'wx' fails atomically if another export already claimed it
    try {
      writeFileSync(path, '', { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error(`${state.file} already exists in the export folder. Choose another file name.`);
      }
      throw error;
    }
  }

  const deadline = now() + budgetMs;
  // Zendesk allows 1000 but recommends 100: big pages can time out on
  // accounts with many archived tickets
  const pageSize = 100;
  let writtenThisCall = 0;

  while (true) {
    let page;
    try {
      const params = { query: state.query, 'filter[type]': 'ticket', 'page[size]': pageSize };
      if (state.after) params['page[after]'] = state.after;
      page = await client.exportSearch(params);
    } catch (error) {
      return errorProgress(state, path, error);
    }
    const tickets = page.results || [];

    for (let index = state.skip; index < tickets.length; index++) {
      // Always write at least one ticket per call so an export can't stall
      if (writtenThisCall > 0 && now() >= deadline) {
        state.skip = index;
        return progress(state, path, false);
      }
      // Set before the ticket is fetched, so a failure below resumes by
      // retrying this ticket instead of skipping it or repeating one
      // already written
      state.skip = index;
      let record;
      try {
        record = await ticketRecord(client, tickets[index], state.includeComments);
      } catch (error) {
        return errorProgress(state, path, error);
      }
      const line = JSON.stringify(record) + '\n';
      appendFileSync(path, line);
      state.bytes += Buffer.byteLength(line);
      state.written++;
      writtenThisCall++;
    }

    const cursor = nextCursor(page);
    if (!page.meta?.has_more) return progress(state, path, true);
    if (!cursor) {
      return progress(state, path, true, {
        warning: 'Zendesk reported more results but gave no cursor to fetch them, so this export may be incomplete.'
      });
    }
    state.after = cursor;
    state.skip = 0;
    if (now() >= deadline) return progress(state, path, false);
  }
}
