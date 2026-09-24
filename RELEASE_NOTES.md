# Release notes

## v1.1.0

This release makes Claude much better at analyzing your tickets and Help Center, and all of it works in read-only mode.

### What's new

- **Full ticket conversations.** Claude can now read every reply and internal note on a ticket, not just the first message, and sees who wrote each one.
- **Help Center search.** Ask things like "which articles cover restoring a volume?" and Claude searches your Help Center directly.
- **Help Center overview.** Claude can see how your Help Center is organized and how many articles each section has, including when each section was last updated. Try "which sections of our Help Center are thin or out of date?"
- **Exports for big questions.** For questions about hundreds or thousands of tickets, Claude can save the matching tickets to a file and analyze the file. This avoids the limit on how many tickets fit in one conversation. Exports go to the **Export folder** in the extension's settings (normally a folder called *Zendesk exports* in your home folder). If you use Claude Cowork, set it to the folder you use with Cowork so Claude can read the files.
- **Faster, longer conversations.** Claude now gets a short summary of each ticket and article instead of everything Zendesk sends, so it can look at many more of them before a conversation gets too long.

### Good to know

- **Big exports come in batches.** A large export can take several minutes. Claude saves it in batches and keeps going on its own. Including full conversations makes exports much slower.
- **Interrupted exports pick up where they stopped.** If an export stops partway, for example because Zendesk had a problem, Claude can continue it without saving any ticket twice. If Zendesk's results might be incomplete, Claude tells you.
- **Claude may ask before exporting.** Because an export saves a file on your computer, Claude Desktop may ask your permission first, even in read-only mode. The export only reads from Zendesk and never changes anything there.
- **Busy accounts may pause.** If your Zendesk account is busy, Claude may pause for a few seconds and retry. That's normal.

### Updating

Download the new `.mcpb` file and double-click it with Claude Desktop open. Your settings are kept.

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
- **See chats and calls:** recent chat and messaging conversations, and Zendesk Talk call statistics, including who's waiting in the phone queue right now.
- **Make changes (only when read-only mode is off):** create, update and delete all of the above.

### Staying safe

- **Claude acts as you.** Everything it does in Zendesk uses your account and your permissions, and shows up in Zendesk as done by you.
- **Check before you click Allow.** Claude Desktop asks you before Claude uses a Zendesk tool. For anything that changes or deletes data, read what it's about to do before allowing it, and don't pick "Always allow" for those tools.
- **Watch for odd instructions in tickets.** Tickets are written by customers, and a ticket could contain text meant to trick Claude, such as "delete this user." If Claude suggests a change you didn't ask for, say no.
- **Deleting can be permanent.** Deleted tickets can be restored in Zendesk for about 30 days. Deleted triggers, automations, macros and views can't be restored.
- **No admin rights by default.** Claude can't make anyone a Zendesk admin unless **Allow granting admin role** is turned on in the extension settings. Leave it off.
