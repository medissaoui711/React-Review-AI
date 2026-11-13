import { createServer as createNodeServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createServer } from './app.mjs';

const MCP_PATH = '/mcp';
const HOST_ALLOWLIST = localhostAllowedHostnames();
const ORIGIN_ALLOWLIST = localhostAllowedOrigins();

/**
 * Create a local-only, stateless Streamable HTTP endpoint.
 * The SDK creates a fresh MCP server for each request; no protocol sessions
 * or cross-request project state are retained.
 */
export function createHttpServer() {
  const mcp = createMcpHandler(createServer, { legacy: 'reject' });

  const guardedHandler = {
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname !== MCP_PATH) {
        return new Response('Not Found', { status: 404 });
      }

      const hostRejection = hostHeaderValidationResponse(request, HOST_ALLOWLIST);
      if (hostRejection) return hostRejection;

      const originRejection = originValidationResponse(request, ORIGIN_ALLOWLIST);
      if (originRejection) return originRejection;

      if (request.method.toUpperCase() !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }

      return mcp.fetch(request);
    }
  };

  const server = createNodeServer(toNodeHandler(guardedHandler));

  return {
    server,
    async close() {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
      await mcp.close();
    }
  };
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const runtime = createHttpServer();
  runtime.server.listen(port, '127.0.0.1', () => {
    console.error(`React Review AI Streamable HTTP listening at http://127.0.0.1:${port}${MCP_PATH}`);
  });

  const shutdown = async () => {
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch (error) {
      console.error('HTTP shutdown failed:', error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
