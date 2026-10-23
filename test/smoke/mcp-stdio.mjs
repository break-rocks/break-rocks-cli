#!/usr/bin/env node
// The MCP server of the built CLI on stdio, driven by the client of the SDK: initialize, tools/list,
// then one tools/call (default breakrocks_version). Used by the CI on the three systems, and by hand
// on dev: node test/smoke/mcp-stdio.mjs [tool] [JSON arguments] [-- breakrocks options…]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const [tool = 'breakrocks_version', input = '{}'] = split < 0 ? args : args.slice(0, split);
const options = split < 0 ? [] : args.slice(split + 1);
const bin = fileURLToPath(new URL('../../bin/breakrocks.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [bin, ...options, 'mcp'], env: { ...process.env }, stderr: 'inherit' });
const client = new Client({ name: 'breakrocks-smoke', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`tools/list: ${tools.length} tools (${tools.slice(0, 4).map((t) => t.name).join(', ')}, …)`);
const result = await client.callTool({ name: tool, arguments: JSON.parse(input) });
console.log(`tools/call ${tool}: ${result.isError ? 'error' : 'ok'}`);
console.log(result.content[0].text);
await client.close();
if (result.isError || !tools.some((t) => t.name === 'breakrocks_whoami')) process.exitCode = 1;
