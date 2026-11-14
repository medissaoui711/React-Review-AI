import { createServer as createNodeServer } from 'node:http';
import { randomUUID } from 'node:crypto';
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
import { createReviewService } from './review.mjs';
import { createRuntimeMetrics } from './metrics.mjs';
import { WorkspaceManager } from './workspaces.mjs';
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

async function isToolCallRequest(request) {
  try {
    const payload = await request.clone().json();
    const messages = Array.isArray(payload) ? payload : [payload];
    return messages.some(message => message?.method === 'tools/call');
  } catch {
    return false;
  }
}

export function createHttpServer(env = process.env, authOptions = {}) {
  const bindHost = env.MCP_HTTP_HOST || '127.0.0.1';
  const allowRemote = env.MCP_HTTP_ALLOW_REMOTE === 'true';
  const remoteBind = !isLoopback(bindHost);
  const oauth = createOAuthRuntime(env, authOptions);

  if (remoteBind && !allowRemote) {
    throw new Error('Non-loopback HTTP binding requires MCP_HTTP_ALLOW_REMOTE=true.');
  }
  if (allowRemote && (!oauth || env.MCP_TRUST_PROXY_TLS !== 'true')) {
    throw new Error('Remote HTTP requires OAuth configuration and MCP_TRUST_PROXY_TLS=true for a TLS-terminating reverse proxy.');
  }
  if (allowRemote && oauth.config.resource.protocol !== 'https:') {
    throw new Error('Remote MCP_PUBLIC_URL must use HTTPS.');
  }

  const allowedHosts = remoteBind ? [] : [...localhostAllowedHostnames()];
  const allowedOrigins = remoteBind ? [] : [...localhostAllowedOrigins()];
  const configuredHosts = (env.MCP_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const hostname of configuredHosts) {
    const validDnsName = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(hostname);
    const validIpv6Name = /^\[[0-9a-f:]+\]$/i.test(hostname);
    if (!validDnsName && !validIpv6Name) {
      throw new Error('MCP_ALLOWED_HOSTS must contain comma-separated hostnames only, without schemes, ports, or wildcards.');
    }
    allowedHosts.push(hostname.toLowerCase());
  }
  const configuredOrigins = (env.MCP_ALLOWED_ORIGIN_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const hostname of configuredOrigins) {
    const validDnsName = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(hostname);
    const validIpv6Name = /^\[[0-9a-f:]+\]$/i.test(hostname);
    if (!validDnsName && !validIpv6Name) {
      throw new Error('MCP_ALLOWED_ORIGIN_HOSTS must contain comma-separated hostnames only, without schemes, ports, or wildcards.');
    }
    allowedOrigins.push(hostname.toLowerCase());
  }
  if (oauth) {
    allowedHosts.push(oauth.config.resource.hostname);
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
  const shutdownTimeoutMs = readPositiveLimit('MCP_SHUTDOWN_TIMEOUT_MS', 10_000);
  const maxConcurrentRequests = readPositiveLimit('MCP_MAX_CONCURRENT_REQUESTS', 4);
  let activeRequests = 0;
  const metrics = createRuntimeMetrics();
  const workspaceManager = new WorkspaceManager();
  const isReady = async () => {
    if (oauth) return workspaceManager.ready();
    try { await createReviewService(env.REACT_REVIEW_ROOT); return true; }
    catch { return false; }
  };

  const sendWorkspaceResponse = async (nodeResponse, webResponse) => {
    const headers = Object.fromEntries(webResponse.headers.entries());
    nodeResponse.writeHead(webResponse.status, headers);
    if (webResponse.status === 204 || webResponse.status === 304) nodeResponse.end();
    else nodeResponse.end(await webResponse.text());
  };

  const handleWorkspaceNodeRequest = async (nodeRequest, nodeResponse) => {
    const requestUrl = new URL(nodeRequest.url, 'http://' + (nodeRequest.headers.host || 'localhost'));
    const headers = new Headers();
    for (const key of ['host', 'origin', 'authorization']) {
      const value = nodeRequest.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    const authRequest = new Request(requestUrl, { method: nodeRequest.method, headers });
    const hostRejection = hostHeaderValidationResponse(authRequest, allowedHosts);
    if (hostRejection) {
      nodeRequest.resume();
      await sendWorkspaceResponse(nodeResponse, hostRejection);
      return;
    }
    const originRejection = originValidationResponse(authRequest, allowedOrigins);
    if (originRejection) {
      nodeRequest.resume();
      await sendWorkspaceResponse(nodeResponse, originRejection);
      return;
    }
    const limited = rateLimit(authRequest);
    if (limited) {
      metrics.recordRateLimit();
      nodeRequest.resume();
      await sendWorkspaceResponse(nodeResponse, limited);
      return;
    }
    if (!oauth) {
      nodeRequest.resume();
      nodeResponse.writeHead(401, { 'Cache-Control': 'no-store' });
      nodeResponse.end('Authentication is required.');
      return;
    }

    let authInfo;
    try {
      authInfo = await oauth.authenticate(authRequest);
    } catch {
      nodeRequest.resume();
      nodeResponse.writeHead(503, { 'Cache-Control': 'no-store', 'Retry-After': '5' });
      nodeResponse.end('Authentication service temporarily unavailable.');
      return;
    }
    if (authInfo instanceof Response) {
      nodeRequest.resume();
      await sendWorkspaceResponse(nodeResponse, authInfo);
      return;
    }
    if (!authInfo.userId) {
      nodeRequest.resume();
      nodeResponse.writeHead(401, { 'Cache-Control': 'no-store' });
      nodeResponse.end('Authenticated subject is required.');
      return;
    }

    const workspaceItem = /^\/workspaces\/([0-9a-f-]{36})$/i.exec(requestUrl.pathname);
    if (requestUrl.pathname === '/workspaces' && nodeRequest.method === 'POST') {
      const contentType = String(nodeRequest.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/zip' && contentType !== 'application/octet-stream') {
        nodeRequest.resume();
        nodeResponse.writeHead(415, { 'Cache-Control': 'no-store' });
        nodeResponse.end('Content-Type must be application/zip.');
        return;
      }
      const declaredLength = nodeRequest.headers['content-length'];
      if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 20_000_000)) {
        nodeRequest.resume();
        nodeResponse.writeHead(413, { 'Cache-Control': 'no-store' });
        nodeResponse.end('Payload Too Large');
        return;
      }
      const bodyResult = await new Promise((resolve, reject) => {
        const chunks = [];
        let received = 0;
        let tooLarge = false;
        nodeRequest.on('data', chunk => {
          if (tooLarge) return;
          received += chunk.length;
          if (received > 20_000_000) {
            tooLarge = true;
            chunks.length = 0;
            nodeRequest.pause();
            resolve({ tooLarge: true });
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        nodeRequest.once('end', () => {
          if (!tooLarge) resolve({ body: Buffer.concat(chunks, received) });
        });
        nodeRequest.once('error', reject);
      });
      if (bodyResult.tooLarge) {
        nodeResponse.writeHead(413, { 'Cache-Control': 'no-store' });
        nodeResponse.end('Payload Too Large');
        nodeRequest.resume();
        return;
      }
      try {
        const workspace = await workspaceManager.createFromZip(authInfo.userId, bodyResult.body);
        nodeResponse.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        nodeResponse.end(JSON.stringify(workspace));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid project archive.';
        nodeResponse.writeHead(400, { 'Cache-Control': 'no-store' });
        nodeResponse.end(message);
      }
      return;
    }

    if (workspaceItem && nodeRequest.method === 'DELETE') {
      nodeRequest.resume();
      const deleted = await workspaceManager.delete(authInfo.userId, workspaceItem[1]);
      nodeResponse.writeHead(deleted ? 204 : 404, { 'Cache-Control': 'no-store' });
      nodeResponse.end(deleted ? undefined : 'Workspace not found.');
      return;
    }

    nodeRequest.resume();
    nodeResponse.writeHead(405, {
      Allow: requestUrl.pathname === '/workspaces' ? 'POST' : 'DELETE',
      'Cache-Control': 'no-store'
    });
    nodeResponse.end('Method Not Allowed');
  };
  const mcp = createMcpHandler(() => createServer({ metrics, env, workspaceManager }), { legacy: 'reject' });

  const guardedHandler = {
    fetch: async (request) => {
      const url = new URL(request.url);
      const isMetadataRequest = oauth && url.pathname === '/.well-known/oauth-protected-resource';
      const isHealthRequest = url.pathname === '/healthz' || url.pathname === '/readyz';
      if (url.pathname !== MCP_PATH && !isMetadataRequest && !isHealthRequest) {
        return new Response('Not Found', { status: 404 });
      }

      const hostRejection = hostHeaderValidationResponse(request, allowedHosts);
      if (hostRejection) return hostRejection;
      const originRejection = originValidationResponse(request, allowedOrigins);
      if (originRejection) return originRejection;

      if (isHealthRequest) {
        if (request.method.toUpperCase() !== 'GET') {
          return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
        }
        if (url.pathname === '/healthz') {
          return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
        }
        const ready = await isReady();
        return Response.json({ status: ready ? 'ready' : 'not_ready' }, {
          status: ready ? 200 : 503,
          headers: { 'Cache-Control': 'no-store' }
        });
      }

      if (isMetadataRequest) {
        if (request.method.toUpperCase() !== 'GET') {
          return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
        }
        return oauth.metadataResponse();
      }

      if (request.method.toUpperCase() !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }

      const rateLimitResponse = rateLimit(request);
      if (rateLimitResponse) {
        metrics.recordRateLimit();
        return rateLimitResponse;
      }

      const boundedRequest = await enforceRequestBodyLimit(request);
      if (boundedRequest instanceof Response) return boundedRequest;
      const safeRequest = boundedRequest || request;

      // MCP discovery and initialization are intentionally unauthenticated.
      // Browser-origin tools/call requests use HTTP OAuth challenges; non-browser
      // hosts retain the MCP-level challenge used by ChatGPT integrations.
      if (oauth && await isToolCallRequest(safeRequest)) {
        const authorization = safeRequest.headers.get('authorization');
        // Browser MCP clients need an HTTP challenge so the official SDK can
        // run OAuth discovery and Authorization Code + PKCE. Non-browser
        // hosts retain the MCP-level challenge used by ChatGPT integrations.
        if (!authorization && safeRequest.headers.has('origin')) {
          return new Response('Unauthorized', {
            status: 401,
            headers: {
              'Cache-Control': 'no-store',
              'WWW-Authenticate': oauth.challenge('invalid_token', 'A bearer access token is required.')
            }
          });
        }
        if (authorization) {
          let authResult;
          try {
            authResult = await oauth.authenticate(safeRequest);
          } catch {
            return new Response('Authentication service temporarily unavailable.', {
              status: 503,
              headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' }
            });
          }
          if (authResult instanceof Response) {
            // Browser SDKs need the HTTP status and WWW-Authenticate challenge
            // to refresh or restart OAuth. Non-browser hosts retain the
            // MCP-level challenge contract used by ChatGPT integrations.
            if (safeRequest.headers.has('origin')) return authResult;
            const insufficientScope = authResult.status === 403;
            return mcp.fetch(safeRequest, {
              authInfo: {
                clientId: null,
                scopes: [],
                authFailure: {
                  errorCode: insufficientScope ? 'insufficient_scope' : 'invalid_token'
                }
              }
            });
          }
          return mcp.fetch(safeRequest, { authInfo: authResult });
        }
      }
      return mcp.fetch(safeRequest);
    }
  };

  const nodeHandler = toNodeHandler(guardedHandler);
  const server = createNodeServer(
    { maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 },
    (request, response) => {
      const requestId = randomUUID();
      const startedAt = Date.now();
      const requestPath = new URL(request.url, 'http://localhost').pathname;
      const isWorkspaceRequest = requestPath === '/workspaces' || /^\/workspaces\/[0-9a-f-]{36}$/i.test(requestPath);
      const route = requestPath === MCP_PATH
        ? 'mcp'
        : requestPath === '/healthz'
          ? 'health'
          : requestPath === '/readyz'
            ? 'readiness'
            : requestPath === '/.well-known/oauth-protected-resource'
              ? 'oauth_metadata'
              : isWorkspaceRequest
                ? 'workspace'
                : 'other';
      response.setHeader('X-Request-Id', requestId);
      let logged = false;
      const writeRequestLog = event => {
        if (logged) return;
        logged = true;
        const status = event === 'http_request_aborted' && !response.headersSent ? null : response.statusCode;
        metrics.recordHttp({ route, status, durationMs: Date.now() - startedAt, aborted: event === 'http_request_aborted' });
        console.error(JSON.stringify({
          level: 'info',
          event,
          request_id: requestId,
          method: request.method,
          route,
          status,
          duration_ms: Math.max(0, Date.now() - startedAt)
        }));
      };
      response.once('finish', () => writeRequestLog('http_request'));
      response.once('close', () => {
        if (!response.writableFinished) writeRequestLog('http_request_aborted');
      });

      const isHealthProbe = request.method === 'GET' && (requestPath === '/healthz' || requestPath === '/readyz');
      const rateRequest = new Request('http://rate-limit.internal/', {
        headers: {
          // The Cloudflare Worker overwrites this header from CF-Connecting-IP.
          // The container is not publicly reachable, so this value comes only
          // through the trusted Worker-to-Durable-Object path.
          'x-mcp-rate-limit-key': request.headers['x-mcp-rate-limit-key'] || request.socket.remoteAddress || 'unknown'
        }
      });
      const rejection = isHealthProbe ? null : networkRateLimit(rateRequest);
      if (rejection) {
        metrics.recordRateLimit();
        response.writeHead(rejection.status, Object.fromEntries(rejection.headers));
        response.end('Too Many Requests');
        return;
      }
      if (!isHealthProbe && activeRequests >= maxConcurrentRequests) {
        metrics.recordOverloaded();
        response.writeHead(503, { 'Retry-After': '1', 'Cache-Control': 'no-store' });
        response.end('Service Unavailable');
        return;
      }
      if (!isHealthProbe) {
        activeRequests += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          activeRequests = Math.max(0, activeRequests - 1);
        };
        response.once('finish', release);
        response.once('close', release);
      }
      if (isWorkspaceRequest) {
        handleWorkspaceNodeRequest(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' });
          response.end('Workspace request failed.');
        });
        return;
      }
      nodeHandler(request, response);
    }
  );
  server.maxRequestsPerSocket = 1_000;

  return {
    server,
    getMetrics() { return metrics.snapshot(); },
    async close() {
      if (!server.listening) {
        await mcp.close();
        await workspaceManager.close();
        return;
      }
      let shutdownTimer;
      const closePromise = new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      server.closeIdleConnections?.();
      shutdownTimer = setTimeout(() => server.closeAllConnections?.(), shutdownTimeoutMs);
      shutdownTimer.unref?.();
      try {
        await closePromise;
      } finally {
        clearTimeout(shutdownTimer);
        await mcp.close();
        await workspaceManager.close();
      }
    }
  };
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const rawPort = process.env.PORT || '3000';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const runtime = createHttpServer();
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
  runtime.server.listen(port, host, () => {
    console.error(`React Review AI Streamable HTTP listening at http://${host}:${port}${MCP_PATH}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
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
