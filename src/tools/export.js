import { z } from 'zod';
import { zendeskClient } from '../zendesk-client.js';
import { exportTickets } from '../export.js';
import { jsonResult } from '../format.js';

export const exportTools = [
  {
    name: "export_tickets",
    description: "Export every ticket matching a Zendesk search to a JSON Lines file in the export folder, one ticket per line, for analyzing more tickets than fit in a conversation. Large exports take several calls: while done is false, call again with only the returned resume value.",
    // Writes a local file but never changes Zendesk, so read-only mode keeps it
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    schema: {
      query: z.string().optional().describe("Zendesk search query, e.g. 'created>2026-01-01 tags:backup'. Required unless resuming"),
      include_comments: z.boolean().optional().describe("Also export each ticket's full conversation (one extra request per ticket, so much slower)"),
      file_name: z.string().optional().describe("File name inside the export folder (default tickets-<timestamp>.jsonl)"),
      resume: z.string().optional().describe("The resume value from the previous call, to continue an export")
    },
    handler: async args => {
      try {
        const result = await exportTickets(zendeskClient, args);
        if (result.error) {
          // Report the failure as an error, but keep the resume value so the call can be retried
          return {
            content: [{ type: "text", text: `Error exporting tickets: ${result.message}\n${JSON.stringify(result)}` }],
            isError: true
          };
        }
        return jsonResult(result);
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error exporting tickets: ${error.message}` }],
          isError: true
        };
      }
    }
  }
];
