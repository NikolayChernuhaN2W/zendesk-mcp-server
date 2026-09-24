# Zendesk MCP Server

An MCP server and one-click Claude Desktop extension that lets Claude read and analyze your Zendesk tickets, full ticket conversations and Help Center. It can also export tickets to a file for analyses that are too big for one conversation. Read-only by default.

[![CI](https://github.com/NikolayChernuhaN2W/zendesk-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/NikolayChernuhaN2W/zendesk-mcp-server/actions/workflows/ci.yml) [![Latest release](https://img.shields.io/github/v/release/NikolayChernuhaN2W/zendesk-mcp-server)](https://github.com/NikolayChernuhaN2W/zendesk-mcp-server/releases/latest) [![License](https://img.shields.io/github/license/NikolayChernuhaN2W/zendesk-mcp-server)](LICENSE) [![MCP server](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

## What it can do

- Read a ticket's full conversation, public replies and internal notes, with author names.
- Search the Help Center, and get an overview of its structure with article counts and last-updated dates, so thin or stale sections stand out.
- Export hundreds or thousands of tickets to a JSON Lines file. Large exports are resumable.
- Return compact output for tickets, search, chats and Help Center articles, so more fits in a conversation.
- Run in read-only mode, which is on by default in the extension.
- Optionally create, update and delete tickets, users, organizations, groups, macros, views, triggers, automations and Help Center articles.
- Get Zendesk Talk statistics and list chat and messaging conversations.

## Example prompts

- "Summarize the conversation on ticket 12345."
- "Which Help Center sections are thin or out of date?"
- "Export all tickets tagged `billing` from the last 90 days and find the top five reasons customers wrote in."
- "List the chat conversations from last week and group them by topic."
- "Search the Help Center for articles about password resets and check whether they agree with each other."

## Install in Claude Desktop

1. Download the extension from the [latest release](https://github.com/NikolayChernuhaN2W/zendesk-mcp-server/releases/latest). There are two files:
   - `zendesk-mcp-server-<version>.mcpb` starts in read-only mode.
   - `zendesk-mcp-server-<version>-writes.mcpb` allows changes by default.
2. Double-click the file with Claude Desktop open.
3. Fill in the settings.

To get an API token, go to Zendesk Admin Center, then **Apps and integrations > APIs > Zendesk API**, and click **Add API token**. The token acts as the user whose email you enter, so use the least-privileged account that works. An agent account is enough for reading.

| Setting | What it does | Default |
| --- | --- | --- |
| Zendesk subdomain | The part before `.zendesk.com` in your Zendesk address. For `https://acme.zendesk.com`, enter `acme`. | Required |
| Zendesk email | The email address you sign in to Zendesk with. | Required |
| Zendesk API token | The API token from Admin Center. Stored as a sensitive value. | Required |
| Read-only mode | When on, Claude can only look things up. Turn it off to let Claude create, change and delete Zendesk data. | On (off in the `-writes` file) |
| Allow granting admin role | Lets Claude make users Zendesk admins. Leave it off unless you need it. | Off |
| Export folder | Where ticket exports are saved. To analyze exports in Cowork, pick the folder you use with Cowork. | `Zendesk exports` in your home folder |

You can change these later in Claude Desktop's extension settings. Updating to a new version keeps them.

## Use with other MCP clients (from source)

You need Node.js 18 or newer to run the server, and Node.js 22 or newer to develop it.

```sh
git clone https://github.com/NikolayChernuhaN2W/zendesk-mcp-server.git
cd zendesk-mcp-server
npm ci
```

Then add the server to your client's configuration. For clients that use a `claude_desktop_config.json`-style file:

```json
{
  "mcpServers": {
    "zendesk": {
      "command": "node",
      "args": ["/path/to/zendesk-mcp-server/src/index.js"],
      "env": {
        "ZENDESK_SUBDOMAIN": "your-subdomain",
        "ZENDESK_EMAIL": "you@example.com",
        "ZENDESK_API_TOKEN": "your-api-token",
        "ZENDESK_READ_ONLY": "true"
      }
    }
  }
}
```

For Claude Code:

```sh
claude mcp add zendesk --env ZENDESK_SUBDOMAIN=your-subdomain --env ZENDESK_EMAIL=you@example.com --env ZENDESK_API_TOKEN=your-api-token --env ZENDESK_READ_ONLY=true -- node /path/to/zendesk-mcp-server/src/index.js
```

| Variable | What it does | Default |
| --- | --- | --- |
| `ZENDESK_SUBDOMAIN` | Your Zendesk subdomain, the part before `.zendesk.com`. | Required |
| `ZENDESK_EMAIL` | The email of the Zendesk user the API token belongs to. | Required |
| `ZENDESK_API_TOKEN` | A Zendesk API token. | Required |
| `ZENDESK_READ_ONLY` | `true` hides every tool that changes Zendesk data. | Off: any other value, or unset, allows writes |
| `ZENDESK_ALLOW_ADMIN_ROLE` | `true` lets `create_user` and `update_user` grant the `admin` role. | Off |
| `ZENDESK_EXPORT_DIR` | The folder `export_tickets` writes to. | `~/Zendesk exports` |

Note that from source, read-only mode is off unless you set `ZENDESK_READ_ONLY=true`. The extension turns it on for you.

The server also reads a `.env` file from the directory you start it in, so for `npm start` you can copy [.env.example](.env.example) to `.env` and fill it in.

## Security

Ticket and article content is written by customers and can contain prompt-injection attempts: text that tries to get Claude to do something you didn't ask for. Use read-only mode unless you need writes, and use an API token from the least-privileged account that works.

- **Read-only mode** hides every tool whose name starts with `create_`, `update_` or `delete_`. Claude can't call a tool the server doesn't offer.
- **Admin role guard.** Unless you allow it, `create_user` and `update_user` can only assign the `end-user` and `agent` roles, so a prompt-injected ticket can't make someone an admin.
- **Exports** only read from Zendesk, so `export_tickets` stays available in read-only mode. It writes only inside the export folder: any folder part of the requested file name is dropped, and unusual characters are replaced, so a file name like `../../x` becomes `x.jsonl` in the export folder.

## Tools

Tools marked `hidden` are left out in read-only mode.

### Tickets

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_tickets` | List tickets. | available |
| `get_ticket` | Get a ticket by ID. | available |
| `get_ticket_comments` | Get a ticket's conversation, public replies and internal notes, oldest first, as plain text with author names. | available |
| `create_ticket` | Create a ticket. | hidden |
| `update_ticket` | Update a ticket. | hidden |
| `delete_ticket` | Delete a ticket. | hidden |

### Users

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_users` | List users. | available |
| `get_user` | Get a user by ID. | available |
| `create_user` | Create a user. | hidden |
| `update_user` | Update a user. | hidden |
| `delete_user` | Delete a user. | hidden |

### Organizations

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_organizations` | List organizations. | available |
| `get_organization` | Get an organization by ID. | available |
| `create_organization` | Create an organization. | hidden |
| `update_organization` | Update an organization. | hidden |
| `delete_organization` | Delete an organization. | hidden |

### Groups

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_groups` | List agent groups. | available |
| `get_group` | Get a group by ID. | available |
| `create_group` | Create an agent group. | hidden |
| `update_group` | Update a group. | hidden |
| `delete_group` | Delete a group. | hidden |

### Macros

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_macros` | List macros. | available |
| `get_macro` | Get a macro by ID. | available |
| `create_macro` | Create a macro. | hidden |
| `update_macro` | Update a macro. | hidden |
| `delete_macro` | Delete a macro. | hidden |

### Views

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_views` | List views. | available |
| `get_view` | Get a view by ID. | available |
| `create_view` | Create a view. | hidden |
| `update_view` | Update a view. | hidden |
| `delete_view` | Delete a view. | hidden |

### Triggers

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_triggers` | List triggers. | available |
| `get_trigger` | Get a trigger by ID. | available |
| `create_trigger` | Create a trigger. | hidden |
| `update_trigger` | Update a trigger. | hidden |
| `delete_trigger` | Delete a trigger. | hidden |

### Automations

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_automations` | List automations. | available |
| `get_automation` | Get an automation by ID. | available |
| `create_automation` | Create an automation. | hidden |
| `update_automation` | Update an automation. | hidden |
| `delete_automation` | Delete an automation. | hidden |

### Search

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `search` | Search across Zendesk data. | available |

### Help Center

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_articles` | List Help Center articles. | available |
| `get_article` | Get an article by ID, with its full text. | available |
| `search_articles` | Search articles by keyword, or list the articles in a category, section or label. Returns titles, links and matching snippets. | available |
| `get_help_center_structure` | Get categories, sections and subsections as a tree, with article counts and last-updated dates per section. | available |
| `create_article` | Create an article. | hidden |
| `update_article` | Update an article. | hidden |
| `delete_article` | Delete an article. | hidden |

### Support

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `support_info` | A placeholder that returns a fixed message. It doesn't call Zendesk yet. | available |

### Talk

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `get_talk_stats` | Get Zendesk Talk statistics: account overview, agents overview, agent activity or the live queue. | available |

### Chat

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `list_chats` | List chat and messaging conversations (the tickets Zendesk creates for them), newest first. | available |

### Export

| Tool | What it does | Read-only mode |
| --- | --- | --- |
| `export_tickets` | Export every ticket matching a search to a JSON Lines file in the export folder, one ticket per line, optionally with each ticket's conversation. Large exports take several calls, each continuing from the last. | available |

### Resource

`zendesk://docs/{section}` returns short notes on a part of the Zendesk API. The sections are `tickets`, `users`, `organizations`, `groups`, `macros`, `views`, `triggers`, `automations`, `search`, `help_center`, `support`, `talk`, `chat` and `overview`. Use `all` for a list.

## Development

Development needs Node.js 22 or newer, because `npm test` uses `node --test` with a glob.

```sh
npm ci
npm test          # run the tests
npm run dev       # run the server, restarting when files change
npm run inspect   # try the server in the MCP Inspector
```

Build the Claude Desktop extension into `dist/`:

```sh
scripts/release.sh build                 # read-only mode on by default
scripts/release.sh build --allow-writes  # read-only mode off by default
scripts/release.sh build --all           # both
```

### Checking against a real account

The tests never call Zendesk. Before a release, anyone with Zendesk access can run a quick read-only check against a real account. It never changes Zendesk data:

```sh
ZENDESK_SUBDOMAIN=... ZENDESK_EMAIL=... ZENDESK_API_TOKEN=... node scripts/smoke-check.mjs
```

It calls each analysis tool once and prints PASS, FAIL or SKIP for each. An agent token is enough. The export check exports tickets created in the last day to one small file in a temporary folder, which is deleted afterwards.

## Releasing

For the maintainer. A release is a version tag. GitHub Actions builds and publishes it when the tag is pushed.

1. If you want hand-written release notes, add a `## vX.Y.Z` section to [RELEASE_NOTES.md](RELEASE_NOTES.md) in a normal pull request, written for the people installing the extension, and merge it first.
2. On `main`, run `npm run release`. This releases the next patch version, the same as `npm run release -- patch`. To pick the version, run `npm run release -- minor`, `npm run release -- major` or `npm run release -- 1.4.0`. For the very first release, when no tags exist yet, the version comes from `package.json`.
3. It checks that you are on an up-to-date `main` with no uncommitted changes, that `main` has changes since the last release, and that the tests pass.
4. It shows the last release, the changes since then and where the release notes will come from, and asks you to confirm. `npm run release -- --yes` skips the question.
5. It creates an annotated tag `vX.Y.Z` with the release date and pushes only the tag. No version-bump commit or pull request is needed.
6. The Release workflow runs on the tag. It checks that the tag points at a commit on `main`, runs the tests, builds both `.mcpb` files with the version taken from the tag, and publishes the GitHub Release titled `vX.Y.Z`. The notes come from the `## vX.Y.Z` section of RELEASE_NOTES.md if there is one. Otherwise GitHub generates them from the merged pull requests.

Only the maintainer can push `v*` tags, and release tags can only point at commits on `main`. Both ends check this: `npm run release` refuses unless you are on an up-to-date `main` with a clean working tree, and the Release workflow fails before building anything if the tagged commit isn't on `main`. That workflow check runs from the `release.yml` in the tagged commit, which is one reason only the maintainer can push tags.

If the Release workflow fails after it has created the GitHub Release, for example during an upload, delete that release on GitHub but keep the tag, then re-run the workflow. A re-run fails while the release still exists.

To build the extension locally without releasing, use `scripts/release.sh build [--allow-writes | --all]`, as described under [Development](#development).

## Contributing

Changes go through pull requests to `main`. The CI `test` check must pass, and the maintainer reviews and merges. Run `npm test` before you open a pull request.

## Credits

Originally created by Matt Coatsworth ([@mattcoatsworth](https://github.com/mattcoatsworth), [original repository](https://github.com/mattcoatsworth/zendesk-mcp-server)). This version is maintained by N2WS and adds read-only mode, the Claude Desktop extension, ticket conversations, Help Center search and structure, compact output, rate-limit retries and resumable exports. The original code was published without a license; see [NOTICE](NOTICE).

## License

MIT for the changes and additions made by N2WS, see [LICENSE](LICENSE). See [NOTICE](NOTICE) for the status of the original code.
