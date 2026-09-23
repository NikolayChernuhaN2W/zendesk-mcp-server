import { z } from 'zod';
    import { zendeskClient } from '../zendesk-client.js';

    export const chatTools = [
      {
        name: "list_chats",
        description: "List chat and messaging conversations (the tickets Zendesk creates for them), newest first",
        schema: {
          query: z.string().optional().describe("Extra search terms to narrow the results, e.g. 'status:open' or 'created>2026-01-01'"),
          page: z.number().optional().describe("Page number for pagination"),
          per_page: z.number().optional().describe("Number of chats per page (max 100)")
        },
        handler: async ({ query, page, per_page }) => {
          try {
            // The legacy Chat API needs a separate Chat OAuth token, but every chat and
            // messaging conversation is also a ticket, so search for those instead
            const search = ['type:ticket via:chat via:native_messaging', query].filter(Boolean).join(' ');
            const result = await zendeskClient.search(search, { page, per_page, sort_by: 'created_at', sort_order: 'desc' });
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error listing chats: ${error.message}` }],
              isError: true
            };
          }
        }
      }
    ];
