import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

interface Env {
  REACT_REVIEW_CONTAINER: DurableObjectNamespace<ReactReviewContainer>;
  OAUTH_ISSUER_URL?: string;
  OAUTH_JWKS_URL?: string;
  OAUTH_REQUIRED_SCOPE?: string;
  MCP_ALLOWED_ORIGIN_HOSTS?: string;
  MCP_RATE_LIMIT_PER_MINUTE?: string;
  MCP_RATE_LIMIT_PER_IP_PER_MINUTE?: string;
}

export class JwksEgress extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const configuredUrl = this.env.OAUTH_JWKS_URL;
    if (!configuredUrl) return new Response("JWKS egress is not configured.", { status: 503 });

    let expected: URL;
    let actual: URL;
    try {
      expected = new URL(configuredUrl);
      actual = new URL(request.url);
    } catch {
      return new Response("Outbound destination is not allowed.", { status: 403 });
    }

    // Match the complete canonical URL. This includes port, path, query,
    // credentials and fragment, not merely the destination hostname.
    if (
      expected.protocol !== "https:" ||
      expected.username !== "" ||
      expected.password !== "" ||
      expected.hash !== "" ||
      request.method !== "GET" ||
      actual.href !== expected.href
    ) {
      return new Response("Outbound destination is not allowed.", { status: 403 });
    }

    return fetch(request, { redirect: "manual" });
  }
}

const PORT = 3000;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const STARTUP_ATTEMPTS = 60;
const STARTUP_RETRY_MS = 200;

function unavailable(message: string, status = 503): Response {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store", "Retry-After": "5" },
  });
}

const CORS_ALLOWED_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
]);

function resolveAllowedOrigin(origin: string, env: Env): string | null {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }

  const allowedHosts = (env.MCP_ALLOWED_ORIGIN_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    !allowedHosts.includes(parsed.hostname.toLowerCase())
  ) {
    return null;
  }
  return parsed.origin;
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version");
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsPreflight(request: Request, origin: string | null, expectedMethod: "GET" | "POST"): Response {
  const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase();
  const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);

  if (
    !origin ||
    requestedMethod !== expectedMethod ||
    requestedHeaders.some((header) => !CORS_ALLOWED_HEADERS.has(header))
  ) {
    return new Response("CORS request is not allowed.", { status: 403 });
  }

  return withCors(new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": `${expectedMethod}, OPTIONS`,
      "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type, Last-Event-ID, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    },
  }), origin);
}

function publicMetadata(request: Request, env: Env): Response {
  const resource = new URL("/mcp", request.url).href;
  const metadata = {
    resource,
    authorization_servers: [env.OAUTH_ISSUER_URL],
    scopes_supported: [env.OAUTH_REQUIRED_SCOPE || "review:read"],
    bearer_methods_supported: ["header"],
  };
  return Response.json(metadata, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

export class ReactReviewContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  private async startAndWaitForPort(origin: string): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("Cloudflare Container binding is unavailable.");

    const publicUrl = new URL(origin);
    const runtimeEnv: Record<string, string> = {
      NODE_ENV: "production",
      PORT: String(PORT),
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_ALLOW_REMOTE: "true",
      MCP_TRUST_PROXY_TLS: "true",
      MCP_PUBLIC_URL: new URL("/mcp", publicUrl).href,
      MCP_ALLOWED_HOSTS: "container",
      REACT_REVIEW_ROOT: "/app/demo-project",
      NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      MCP_RATE_LIMIT_PER_MINUTE: this.env.MCP_RATE_LIMIT_PER_MINUTE || "120",
      MCP_RATE_LIMIT_PER_IP_PER_MINUTE: this.env.MCP_RATE_LIMIT_PER_IP_PER_MINUTE || "300",
    };

    if (this.env.OAUTH_ISSUER_URL) runtimeEnv.OAUTH_ISSUER_URL = this.env.OAUTH_ISSUER_URL;
    if (this.env.OAUTH_JWKS_URL) runtimeEnv.OAUTH_JWKS_URL = this.env.OAUTH_JWKS_URL;
    if (this.env.OAUTH_REQUIRED_SCOPE) runtimeEnv.OAUTH_REQUIRED_SCOPE = this.env.OAUTH_REQUIRED_SCOPE;
    if (this.env.MCP_ALLOWED_ORIGIN_HOSTS) {
      runtimeEnv.MCP_ALLOWED_ORIGIN_HOSTS = this.env.MCP_ALLOWED_ORIGIN_HOSTS;
    }

    if (!runtimeEnv.OAUTH_ISSUER_URL || !runtimeEnv.OAUTH_JWKS_URL) {
      throw new Error("OAuth issuer and JWKS configuration must be set before the public demo can start.");
    }

    const jwksUrl = new URL(runtimeEnv.OAUTH_JWKS_URL);
    if (jwksUrl.protocol !== "https:") {
      throw new Error("OAuth JWKS URL must use HTTPS.");
    }
    await container.interceptOutboundHttps(jwksUrl.hostname, this.ctx.exports.JwksEgress);

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "basic",
        enableInternet: false,
        env: runtimeEnv,
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    let lastError: unknown;

    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      try {
        const response = await port.fetch("http://container/readyz", {
          signal: AbortSignal.timeout(1_000),
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`Container readiness returned HTTP ${response.status}.`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(STARTUP_RETRY_MS);
    }

    throw new Error("React Review AI container did not become ready.", { cause: lastError });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });
    if (request.method.toUpperCase() !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }

    this.starting ??= this.startAndWaitForPort(url.origin).finally(() => {
      this.starting = undefined;
    });

    try {
      await this.starting;
      const containerUrl = new URL(request.url);
      containerUrl.protocol = "http:";
      containerUrl.hostname = "container";
      containerUrl.port = "";
      const forwarded = new Request(containerUrl, request);
      forwarded.headers.delete("host");
      return await this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
    } catch {
      return unavailable("Demo runtime is not ready.");
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isMcpRoute = url.pathname === "/mcp";
    const isResourceMetadata = url.pathname === "/.well-known/oauth-protected-resource";
    const originHeader = request.headers.get("origin");
    const allowedOrigin = originHeader ? resolveAllowedOrigin(originHeader, env) : null;
    const respond = (response: Response) => withCors(response, allowedOrigin);

    if ((isMcpRoute || isResourceMetadata) && originHeader && !allowedOrigin) {
      return new Response("Origin is not allowed.", { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    if ((isMcpRoute || isResourceMetadata) && request.method.toUpperCase() === "OPTIONS") {
      return corsPreflight(request, allowedOrigin, isMcpRoute ? "POST" : "GET");
    }

    // Liveness and OAuth discovery stay at the edge; neither can wake a Container.
    if (url.pathname === "/healthz") {
      if (request.method.toUpperCase() !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
      }
      return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
    }

    if (isResourceMetadata) {
      if (request.method.toUpperCase() !== "GET") {
        return respond(new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } }));
      }
      if (!env.OAUTH_ISSUER_URL || !env.OAUTH_JWKS_URL) {
        return respond(unavailable("Public demo authentication is not configured."));
      }
      return respond(publicMetadata(request, env));
    }

    if (!isMcpRoute) return new Response("Not Found", { status: 404 });
    if (request.method.toUpperCase() !== "POST") {
      return respond(new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } }));
    }

    if (!env.OAUTH_ISSUER_URL || !env.OAUTH_JWKS_URL) {
      return respond(unavailable("Public demo authentication is not configured."));
    }

    const forwarded = new Request(request);
    forwarded.headers.delete("x-mcp-rate-limit-key");
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) forwarded.headers.set("x-mcp-rate-limit-key", clientIp);

    const stub = env.REACT_REVIEW_CONTAINER.getByName("react-review-ai-demo");
    return respond(await stub.fetch(forwarded));
  },
};
