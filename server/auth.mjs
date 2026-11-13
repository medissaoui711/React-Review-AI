import { createHash } from 'node:crypto';
import {
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth
} from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
export const REQUIRED_SCOPE = 'review:read';

function requiredUrl(value, name, { allowHttpLoopback = false } = {}) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(allowHttpLoopback && loopback && parsed.protocol === 'http:')) {
    throw new Error(`${name} must use HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must not contain credentials or a fragment.`);
  }
  return parsed;
}

export function readAuthConfig(env = process.env, { allowHttpLoopback = false } = {}) {
  const names = ['OAUTH_ISSUER_URL', 'OAUTH_JWKS_URL', 'MCP_PUBLIC_URL'];
  const supplied = names.filter(name => Boolean(env[name]));
  if (supplied.length === 0) return null;
  for (const name of names) {
    if (!env[name]) throw new Error(`${name} is required when HTTP OAuth is enabled.`);
  }

  const issuer = requiredUrl(env.OAUTH_ISSUER_URL, 'OAUTH_ISSUER_URL', { allowHttpLoopback });
  const jwksUrl = requiredUrl(env.OAUTH_JWKS_URL, 'OAUTH_JWKS_URL', { allowHttpLoopback });
  const resource = requiredUrl(env.MCP_PUBLIC_URL, 'MCP_PUBLIC_URL', { allowHttpLoopback });
  if (resource.pathname !== '/mcp' || resource.search) {
    throw new Error('MCP_PUBLIC_URL must identify the canonical /mcp endpoint without a query string.');
  }

  const scope = env.OAUTH_REQUIRED_SCOPE || REQUIRED_SCOPE;
  if (!/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope)) {
    throw new Error('OAUTH_REQUIRED_SCOPE must be a valid OAuth scope token.');
  }

  return Object.freeze({
    issuer: issuer.href,
    jwksUrl,
    resource,
    scope,
    metadataUrl: new URL(PROTECTED_RESOURCE_PATH, resource.origin).href
  });
}

function readScopes(payload) {
  const raw = payload.scope ?? payload.scp ?? payload.scopes;
  if (Array.isArray(raw)) return raw.filter(value => typeof value === 'string');
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  return [];
}

export function createJwtTokenVerifier({ issuer, resource, jwks }) {
  const expectedResource = resource instanceof URL ? resource : new URL(resource);
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience: expectedResource.href,
          algorithms: ['RS256', 'ES256'],
          requiredClaims: ['iss', 'sub', 'aud', 'exp']
        });
        if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number') {
          throw new Error('Required subject or expiry claim is missing.');
        }
        return {
          token,
          clientId: typeof payload.client_id === 'string' ? payload.client_id : payload.sub,
          scopes: readScopes(payload),
          expiresAt: payload.exp,
          resource: expectedResource
        };
      } catch {
        // Never log token material or token-verification failure details.
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is invalid or expired.');
      }
    }
  };
}

export function createOAuthRuntime(env = process.env, { jwks } = {}) {
  const config = readAuthConfig(env, { allowHttpLoopback: env.NODE_ENV === 'test' });
  if (!config) return null;

  const keySet = jwks ?? createRemoteJWKSet(config.jwksUrl, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 300_000
  });
  const verifier = createJwtTokenVerifier({
    issuer: config.issuer,
    resource: config.resource,
    jwks: keySet
  });
  const authenticate = requireBearerAuth({
    verifier,
    requiredScopes: [config.scope],
    expectedResource: config.resource,
    resourceMetadataUrl: config.metadataUrl
  });

  const metadata = Object.freeze({
    resource: config.resource.href,
    authorization_servers: [config.issuer],
    scopes_supported: [config.scope],
    bearer_methods_supported: ['header']
  });

  return Object.freeze({
    config,
    authenticate,
    metadataResponse() {
      return Response.json(metadata, {
        headers: {
          'Cache-Control': 'public, max-age=300',
          'Content-Type': 'application/json'
        }
      });
    }
  });
}

export function createRequestRateLimiter({ windowMs = 60_000, maxRequests = 120, maxEntries = 10_000, keyResolver } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error('Rate limit must be a positive integer.');
  const buckets = new Map();
  return function checkRateLimit(request) {
    const authorization = request.headers.get('authorization') || 'anonymous';
    const rawKey = keyResolver ? keyResolver(request) : authorization;
    const key = createHash('sha256').update(String(rawKey || 'anonymous')).digest('hex');
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (buckets.size > maxEntries) {
      for (const [entryKey, entry] of buckets) {
        if (now - entry.startedAt >= windowMs) buckets.delete(entryKey);
        if (buckets.size <= maxEntries) break;
      }
      if (buckets.size > maxEntries) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey) buckets.delete(oldestKey);
      }
    }

    if (bucket.count > maxRequests) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': String(Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000))) }
      });
    }
    return null;
  };
}

export async function enforceRequestBodyLimit(request, maxBytes = 1_048_576) {
  const length = request.headers.get('content-length');
  if (length && (!/^\\d+$/.test(length) || Number(length) > maxBytes)) {
    return new Response('Payload Too Large', { status: 413 });
  }
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return new Response('Payload Too Large', { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
    duplex: 'half'
  });
}
