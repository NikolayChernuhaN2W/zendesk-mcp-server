# Zendesk API MCP Server

    A comprehensive Model Context Protocol (MCP) server for interacting with the Zendesk API. This server provides tools and resources for managing Zendesk Support, Talk, Chat, and Guide products.

    ## Features

    - Complete coverage of Zendesk API functionality
    - Tools for managing tickets, users, organizations, and more
    - Resources for accessing Zendesk API documentation
    - Secure authentication with Zendesk API tokens

    ## Getting Started

    ### Prerequisites

    - Node.js 14 or higher
    - A Zendesk account with API access

    ### Installation

    1. Clone this repository
    2. Install dependencies:
       ```
       npm install
       ```
    3. Create a `.env` file with your Zendesk credentials:
       ```
       ZENDESK_SUBDOMAIN=your-subdomain
       ZENDESK_EMAIL=your-email@example.com
       ZENDESK_API_TOKEN=your-api-token
       ```
    4. Optionally, restrict what the server can do:
       - `ZENDESK_READ_ONLY=true` registers only read tools (list, get, search); every create, update and delete tool is left out.
       - `ZENDESK_ALLOW_ADMIN_ROLE=true` lets `create_user` and `update_user` grant the `admin` role. It is off by default.
       - `ZENDESK_EXPORT_DIR=/path` sets where `export_tickets` saves files (default `~/Zendesk exports`).

       Ticket and article content is written by customers and can contain prompt-injection attempts. Use read-only mode unless you need writes, and use an API token from the least-privileged account that works.

    ### Running the Server

    Start the server:
    ```
    npm start
    ```

    For development with auto-restart:
    ```
    npm run dev
    ```

    ### Claude Desktop extension

    Build the one-click `.mcpb` installer into `dist/`:
    ```
    scripts/release.sh build                 # read-only mode on by default
    scripts/release.sh build --allow-writes  # read-only mode off by default
    scripts/release.sh build --all           # both
    ```

    Publish it as a release on this repo (tagged `v<version>` from `package.json`). This needs a Forgejo access token with the `write:repository` scope:
    ```
    scripts/release.sh publish                 # read-only mode on by default
    scripts/release.sh publish --allow-writes  # read-only mode off by default
    scripts/release.sh publish --all           # both, on the same release
    ```
    Before publishing, add a `## v<version>` section to [RELEASE_NOTES.md](RELEASE_NOTES.md), written for the people installing the extension. It becomes the release description, and publishing stops if it's missing.

    It uses `FORGEJO_TOKEN` if set and asks for the token otherwise. Publishing a second variant for the same version adds it to the existing release. Commit and push first: the release is tagged at the current commit.

    ### Checking against a real account

    Before publishing a release, anyone with Zendesk access can run a quick read-only check. It never changes Zendesk data:
    ```
    ZENDESK_SUBDOMAIN=... ZENDESK_EMAIL=... ZENDESK_API_TOKEN=... node scripts/smoke-check.mjs
    ```
    It calls each analysis tool once and prints PASS, FAIL or SKIP for each. An agent token is enough.

    ### Testing with MCP Inspector

    Test the server using the MCP Inspector:
    ```
    npm run inspect
    ```

    ## Available Tools

    ### Tickets
    - `list_tickets`: List tickets in Zendesk
    - `get_ticket`: Get a specific ticket by ID
    - `get_ticket_comments`: Get a ticket's full conversation (replies and internal notes) as plain text
    - `create_ticket`: Create a new ticket
    - `update_ticket`: Update an existing ticket
    - `delete_ticket`: Delete a ticket

    ### Users
    - `list_users`: List users in Zendesk
    - `get_user`: Get a specific user by ID
    - `create_user`: Create a new user
    - `update_user`: Update an existing user
    - `delete_user`: Delete a user

    ### Organizations
    - `list_organizations`: List organizations in Zendesk
    - `get_organization`: Get a specific organization by ID
    - `create_organization`: Create a new organization
    - `update_organization`: Update an existing organization
    - `delete_organization`: Delete an organization

    ### Groups
    - `list_groups`: List agent groups in Zendesk
    - `get_group`: Get a specific group by ID
    - `create_group`: Create a new agent group
    - `update_group`: Update an existing group
    - `delete_group`: Delete a group

    ### Macros
    - `list_macros`: List macros in Zendesk
    - `get_macro`: Get a specific macro by ID
    - `create_macro`: Create a new macro
    - `update_macro`: Update an existing macro
    - `delete_macro`: Delete a macro

    ### Views
    - `list_views`: List views in Zendesk
    - `get_view`: Get a specific view by ID
    - `create_view`: Create a new view
    - `update_view`: Update an existing view
    - `delete_view`: Delete a view

    ### Triggers
    - `list_triggers`: List triggers in Zendesk
    - `get_trigger`: Get a specific trigger by ID
    - `create_trigger`: Create a new trigger
    - `update_trigger`: Update an existing trigger
    - `delete_trigger`: Delete a trigger

    ### Automations
    - `list_automations`: List automations in Zendesk
    - `get_automation`: Get a specific automation by ID
    - `create_automation`: Create a new automation
    - `update_automation`: Update an existing automation
    - `delete_automation`: Delete an automation

    ### Search
    - `search`: Search across Zendesk data

    ### Help Center
    - `list_articles`: List Help Center articles
    - `get_article`: Get a specific Help Center article by ID
    - `search_articles`: Search Help Center articles by keyword
    - `get_help_center_structure`: Categories, sections and per-section article counts
    - `create_article`: Create a new Help Center article
    - `update_article`: Update an existing Help Center article
    - `delete_article`: Delete a Help Center article

    ### Talk
    - `get_talk_stats`: Get Zendesk Talk statistics (account overview, agents overview, agent activity, or live queue)

    ### Chat
    - `list_chats`: List chat and messaging conversations (found as tickets via search)

    ### Export
    - `export_tickets`: Export tickets matching a search to a JSON Lines file in the export folder (`ZENDESK_EXPORT_DIR`, default `~/Zendesk exports`); resumable for large exports

    ## Available Resources

    - `zendesk://docs/{section}`: Access documentation for different sections of the Zendesk API

    ## License

    MIT
