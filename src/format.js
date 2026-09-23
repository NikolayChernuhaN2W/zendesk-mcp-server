// Compact, analysis-friendly views of Zendesk objects. Raw API objects carry
// dozens of fields and HTML bodies that use up the model's context quickly.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(p|div|h[1-6]|blockquote|pre|table|ul|ol)>/gi, '\n')
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
