#!/usr/bin/env node
    // Must be the first import: other modules read process.env when they load
    import 'dotenv/config';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { server } from './server.js';

    // stdout carries the MCP protocol, so log to stderr
    console.error('Starting Zendesk API MCP server...');

    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
