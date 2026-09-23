import { z } from 'zod';
    import { zendeskClient } from '../zendesk-client.js';

    export const talkTools = [
      {
        name: "get_talk_stats",
        description: "Get Zendesk Talk statistics",
        schema: {
          report: z.enum(["account_overview", "agents_overview", "agents_activity", "current_queue_activity"])
            .optional()
            .describe("Which report: account_overview (default; call and queue totals), agents_overview (totals across agents), agents_activity (per-agent status and times), current_queue_activity (live queue)"),
          phone_number_ids: z.array(z.number()).optional().describe("Limit to these phone numbers (account_overview and current_queue_activity only)"),
          group_ids: z.array(z.number()).optional().describe("Limit to agents in these groups (agents_activity only)")
        },
        handler: async ({ report = "account_overview", phone_number_ids, group_ids }) => {
          try {
            const params = {};
            if (phone_number_ids?.length) params.phone_number_ids = phone_number_ids.join(',');
            if (group_ids?.length) params.group_ids = group_ids.join(',');

            const result = await zendeskClient.getTalkStats(report, params);
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting Talk stats: ${error.message}` }],
              isError: true
            };
          }
        }
      }
    ];
