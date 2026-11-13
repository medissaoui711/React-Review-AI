import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './app.mjs';

export { createServer };

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  // Keep the existing local transport pinned to the modern MCP protocol era.
  await serveStdio(createServer, { legacy: 'reject' });
}
