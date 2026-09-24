// Which tools the server offers, and the MCP annotations that tell clients
// what each one does. Tools that change Zendesk data are named create_*,
// update_* or delete_*.
const ZENDESK_WRITE = /^(create|update|delete)_/;

export function isZendeskWrite(tool) {
  return ZENDESK_WRITE.test(tool.name);
}

export function getAnnotations(tool) {
  if (tool.annotations) return tool.annotations;
  if (/^(delete|update)_/.test(tool.name)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
  }
  if (tool.name.startsWith('create_')) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  }
  return { readOnlyHint: true, openWorldHint: true };
}

// Read-only mode hides tools that write to Zendesk. Tools that only write
// local files, like exports, stay available.
export function selectTools(tools, { readOnly }) {
  return readOnly ? tools.filter(tool => !isZendeskWrite(tool)) : tools;
}
