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

// A ticket's comments with the users sideload, so authors can be named.
// Returns the raw comments, a Map of user id → user, and whether `limit`
// cut the list short.
export async function collectTicketComments(client, ticketId, { limit = Infinity } = {}) {
  const users = new Map();
  const { items, truncated } = await collectPages(
    params => client.listTicketComments(ticketId, { ...params, include: 'users' }),
    'comments',
    { limit, onPage: page => (page.users || []).forEach(user => users.set(user.id, user)) }
  );
  return { comments: items, users, truncated };
}
