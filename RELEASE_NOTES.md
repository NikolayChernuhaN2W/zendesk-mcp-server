# Release notes

## v1.0.0

This is the first release of the Zendesk extension for Claude Desktop. Once it's installed, you can ask Claude about your Zendesk account in plain language, for example:

- "Show me the open tickets assigned to me."
- "What has this customer contacted us about before?"
- "Find the Help Center article about restoring a backup."

### Which file to download

There are two files. Pick one:

- **zendesk-mcp-server-1.0.0.mcpb** (recommended): Claude can look things up in Zendesk, but it can't change anything.
- **zendesk-mcp-server-1.0.0-writes.mcpb**: Claude can also create, change and delete Zendesk data, such as replying to tickets or updating users. Only pick this if you need it.

You can switch between the two later in the extension's settings, so it's fine to start with the first one.

### How to install

1. Download the file.
2. Open Claude Desktop, double-click the file, and click **Install**. If nothing happens, open **Settings → Extensions** in Claude Desktop and drag the file into that window.
3. Fill in the form:
   - **Zendesk subdomain:** the word before `.zendesk.com` in the address you use to open Zendesk. For `https://acme.zendesk.com`, enter `acme`.
   - **Zendesk email:** the email you sign in to Zendesk with.
   - **Zendesk API token:** in Zendesk, open **Admin Center → Apps and integrations → APIs → Zendesk API** and click **Add API token**. If you can't open that page, ask your Zendesk admin to create a token for you.
4. Start a new chat and ask Claude something about Zendesk.

You don't need to install anything else.

### What Claude can do

- **Look things up:** tickets, users, organizations, groups, macros, views, triggers, automations and Help Center articles, plus searching across all of them.
- **Make changes (only when read-only mode is off):** create, update and delete all of the above.

### Staying safe

- **Claude acts as you.** Everything it does in Zendesk uses your account and your permissions, and shows up in Zendesk as done by you.
- **Check before you click Allow.** Claude Desktop asks you before Claude uses a Zendesk tool. For anything that changes or deletes data, read what it's about to do before allowing it, and don't pick "Always allow" for those tools.
- **Watch for odd instructions in tickets.** Tickets are written by customers, and a ticket could contain text meant to trick Claude, such as "delete this user." If Claude suggests a change you didn't ask for, say no.
- **Deleting can be permanent.** Deleted tickets can be restored in Zendesk for about 30 days. Deleted triggers, automations, macros and views can't be restored.
- **No admin rights by default.** Claude can't make anyone a Zendesk admin unless **Allow granting admin role** is turned on in the extension settings. Leave it off.

### Known issues

- Zendesk Talk call statistics don't work yet.
- Zendesk Chat conversations can't be listed yet.
- Changing a Help Center article's title or text doesn't work, even though Claude says it succeeded. Make those edits in Zendesk directly for now.
