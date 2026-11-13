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
import {
  createOAuthRuntime,
  createRequestRateLimiter,
  enforceRequestBodyLimit
} from './auth.mjs';

const MCP_PATH = '/mcp';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopback(host) {
  return LOOPBACK_HOSTS.has(host.replace(/^\[|\]$/g, '').toLowerCase());
}

export function createHttpServer(env = process.env) {
  const bindHost = env.MCP_HTTP_HOST || '127.0.0.1';
  const allowRemote = env.MCP_HTTP_ALLOW_REMOTE === 'true';
  const remoteBind = !isLoopback(bindHost);
  const oauth = createOAuthRuntime(env);

  if (remoteBind && !allowRemote) {
    throw new Error('Non-loopback HTTP binding requires MCP_HTTP_ALLOW_REMOTE=true.');
  }
  if (allowRemote && (!oauth || env.MCP_TRUST_PROXY_TLS !== 'true')) {
    throw new Error('Remote HTTP requires OAuth configuration and MCP_TRUST_PROXY_TLS=true for a TLS-terminating reverse proxy.');
  }
  if (allowRemote && oauth.config.resource.protocol !== 'https:') {
    throw new Error('Remote MCP_PUBLIC_URL must use HTTPS.');
  }

  const allowedHosts = [...localhostAllowedHostnames()];
  const allowedOrigins = [...localhostAllowedOrigins()];
  if (oauth) {
    allowedHosts.push(oauth.config.resource.hostname);
    allowedOrigins.push(oauth.config.resource.hostname);
  }

  const readPositiveLimit = (name, fallback) => {
    const raw = env[name] || String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${name} must be a positive integer.`);
    return Number(raw);
  };
  const rateLimit = createRequestRateLimiter({
    windowMs: 60_000,
    maxRequests: readPositiveLimit('MCP_RATE_LIMIT_PER_MINUTE', 120)
  });
  const networkRateLimit = createRequestRateLimiter({
    windowMs: 60_000,
    maxRequests: readPositiveLimit('MCP_RATE_LIMIT_PER_IP_PER_MINUTE', 300),
    keyResolver: request => request.headers.get('x-mcp-rate-limit-key')
  });
  const mcp = createMcpHandler(createServer, { legacy: 'reject' });

  const guardedHandler = {
    fetch: async (request) => {
      const url = new URL(request.url);
      if (oauth && url.pathname === '/.well-known/oauth-protected-resource') {
        return oauth.metadataResponse();
      }
      if (url.pathname !== MCP_PATH) {
        return new Response('Not Found', { status: 404 });
      }

      const hostRejection = hostHeaderValidationResponse(request, allowedHosts);
      if (hostRejection) return hostRejection;

      const originRejection = originValidationResponse(request, allowedOrigins);
      if (originRejection) return originRejection;

      if (request.method.toUpperCase() !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }

      const rateLimitResponse = rateLimit(request);
      if (rateLimitResponse) return rateLimitResponse;

      const boundedRequest = await enforceRequestBodyLimit(request);
      if (boundedRequest instanceof Response) return boundedRequest;
      const safeRequest = boundedRequest || request;

      if (oauth) {
        const authInfo = await oauth.authenticate(safeRequest);
        if (authInfo instanceof Response) return authInfo;
        return mcp.fetch(safeRequest, { authInfo });
      }
      return mcp.fetch(safeRequest);
    }
  };

  const nodeHandler = toNodeHandler(guardedHandler);
  const server = createNodeServer(
    { maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 10_000 },
    (request, response) => {
      const rateRequest = new Request('http://rate-limit.internal/', {
        headers: { 'x-mcp-rate-limit-key': request.socket.remoteAddress || 'unknown' }
      });
      const rejection = networkRateLimit(rateRequest);
      if (rejection) {
        response.writeHead(rejection.status, Object.fromEntries(rejection.headers));
        response.end('Too Many Requests');
        return;
      }
      nodeHandler(request, response);
    }
  );

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
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  runtime.server.listen(port, host, () => {
    console.error(`React Review AI Streamable HTTP listening at http://${host}:${port}${MCP_PATH}`);
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
