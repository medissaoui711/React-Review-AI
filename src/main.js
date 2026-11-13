import "./style.css";
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";

const tools = [
  {
    number: "01",
    name: "review_project",
    title: "Project Review",
    description: "Inspect a React codebase for maintainability, reliability, and common engineering risks.",
    tag: "Repository analysis",
  },
  {
    number: "02",
    name: "review_component",
    title: "Component Review",
    description: "Review a focused component for correctness, React patterns, and potential regressions.",
    tag: "Component analysis",
  },
  {
    number: "03",
    name: "run_test_audit",
    title: "Test Audit",
    description: "Identify test gaps and suggest practical coverage improvements for critical behavior.",
    tag: "Quality signals",
  },
  {
    number: "04",
    name: "audit_accessibility",
    title: "Accessibility Audit",
    description: "Highlight accessibility heuristics and actionable improvements for inclusive interfaces.",
    tag: "A11y heuristics",
  },
];

function getMcpConfiguration() {
  const configuredEndpoint = import.meta.env.VITE_MCP_ENDPOINT?.trim();

  if (!configuredEndpoint) {
    return {
      state: "not-configured",
      title: "Backend connection not configured",
      detail: "The dashboard is running independently. Add a public MCP endpoint when the backend is ready.",
    };
  }

  try {
    const endpoint = new URL(configuredEndpoint);
    const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(endpoint.hostname);

    if (
      (endpoint.protocol !== "https:" && !(isLocalDevelopment && endpoint.protocol === "http:")) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname.replace(/\/$/, "") !== "/mcp"
    ) {
      throw new Error("Invalid MCP endpoint");
    }

    return {
      state: "configured",
      title: "MCP endpoint configured",
      detail: "The endpoint format is valid. Authentication, CORS, and live MCP connectivity have not been verified.",
    };
  } catch {
    return {
      state: "invalid",
      title: "MCP endpoint configuration needs attention",
      detail: "Use an HTTPS URL ending in /mcp. HTTP is allowed only for localhost development.",
    };
  }
}

function getOAuthIssuerConfiguration() {
  const issuer = import.meta.env.VITE_OAUTH_ISSUER?.trim();
  if (!issuer) return null;
  try {
    const parsed = new URL(issuer);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.href !== issuer
    ) return null;
    return issuer;
  } catch {
    return null;
  }
}

const mcpConfiguration = getMcpConfiguration();
const oauthClientId = import.meta.env.VITE_OAUTH_CLIENT_ID?.trim();
const oauthIssuer = getOAuthIssuerConfiguration();
const oauthConfigurationReady = mcpConfiguration.state === "configured" && Boolean(oauthClientId) && Boolean(oauthIssuer);
const app = document.querySelector("#app");

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#overview" aria-label="React Review AI home">
        <span class="brand-mark">R<span>✳</span></span>
        <span class="brand-copy"><strong>React Review</strong><small>AI TOOLKIT</small></span>
      </a>
      <div class="nav-label">WORKSPACE</div>
      <nav class="navigation" aria-label="Main navigation">
        <a class="nav-link active" href="#overview" aria-current="page"><span class="nav-icon">⌂</span> Overview</a>
        <a class="nav-link" href="#tools"><span class="nav-icon">◇</span> Review tools</a>
        <a class="nav-link" href="#integration"><span class="nav-icon">↗</span> Integration</a>
        <a class="nav-link" href="#workflow"><span class="nav-icon">⌘</span> Workflow</a>
      </nav>
      <div class="sidebar-bottom">
        <div class="side-status" data-connection-state="${mcpConfiguration.state}">
          <span class="status-dot"></span>
          <span><strong>${mcpConfiguration.state === "configured" ? "Endpoint configured" : "Demo interface"}</strong><small>${mcpConfiguration.state === "configured" ? "Live connection not verified" : "Backend connection pending"}</small></span>
        </div>
        <div class="sidebar-version">VERSION 0.6.0</div>
      </div>
    </aside>

    <main class="main-content" id="overview">
      <header class="topbar">
        <div class="breadcrumb">Workspace <span>/</span> Overview</div>
        <div class="topbar-right"><span class="readonly-pill"><span></span> READ-ONLY ANALYSIS</span><div class="avatar" aria-hidden="true">RA</div></div>
      </header>

      <section class="welcome">
        <div class="eyebrow"><span class="eyebrow-line"></span> AI-POWERED CODE QUALITY</div>
        <h1>Ship better React.<br /><span>Review with confidence.</span></h1>
        <p class="intro">A focused toolkit for understanding code quality, spotting risks, and improving the reliability of your React applications.</p>
        <a class="primary-link" href="#tools">Explore review tools <span aria-hidden="true">→</span></a>
        <div class="orb orb-one"></div><div class="orb orb-two"></div>
      </section>

      <section class="section" id="tools" aria-labelledby="tools-title">
        <div class="section-heading">
          <div><div class="eyebrow">CAPABILITIES</div><h2 id="tools-title">Review toolkit</h2><p>Four focused analysis tools. One clearer view of your codebase.</p></div>
          <span class="count">04 TOOLS</span>
        </div>
        <div class="tool-grid">
          ${tools.map((tool) => `
            <article class="tool-card">
              <div class="card-top"><span class="tool-number">${tool.number}</span><span class="card-arrow" aria-hidden="true">↗</span></div>
              <h3>${tool.title}</h3>
              <p>${tool.description}</p>
              <label class="tool-input-label" ${tool.name === "review_component" ? "" : "hidden"}>
                <span>Relative component path</span>
                <input type="text" data-component-path placeholder="src/components/Button.jsx" autocomplete="off" />
              </label>
              <div class="card-footer"><span>${tool.tag}</span><button type="button" class="tool-action" data-run-tool="${tool.name}" aria-label="Run ${tool.title}" aria-controls="tool-output" disabled>Run analysis</button></div>
            </article>
          `).join("")}
        </div>
        <section class="tool-output" id="tool-output" aria-live="polite" aria-label="Tool result" hidden>
          <div class="tool-output-heading"><h3 id="tool-output-title">Analysis result</h3><button type="button" id="clear-tool-output">Clear</button></div>
          <pre id="tool-output-content"></pre>
        </section>
      </section>

      <section class="section integration-section" id="integration" aria-labelledby="integration-title">
        <div class="section-heading">
          <div><div class="eyebrow">CONNECTION READINESS</div><h2 id="integration-title">MCP integration</h2><p>Frontend configuration is separated from authentication and backend availability.</p></div>
          <span class="count">CONFIGURATION</span>
        </div>
        <div class="connection-card" data-connection-state="${mcpConfiguration.state}">
          <span class="connection-indicator" aria-hidden="true"></span>
          <div class="connection-copy" role="status" aria-live="polite">
            <h3>${mcpConfiguration.title}</h3>
            <p>${mcpConfiguration.detail}</p>
          </div>
          <span class="connection-state">${mcpConfiguration.state === "configured" ? "NOT VERIFIED" : mcpConfiguration.state === "invalid" ? "INVALID CONFIG" : "PENDING"}</span>
          <button type="button" class="connection-action" id="connect-mcp">Connect MCP</button>
        </div>
        <p class="integration-note">Browser integration uses the official MCP client with Authorization Code + PKCE. Access and refresh tokens stay in memory; only the one-time PKCE verifier, OAuth state, and discovery metadata survive the redirect in session-scoped storage. The server must explicitly allow this Pages origin, and the Auth0 public client must list this exact callback URL.</p>
      </section>

      <section class="workflow" id="workflow">
        <div class="workflow-icon" aria-hidden="true">⌘</div>
        <div><div class="eyebrow">BUILT FOR DEVELOPERS</div><h2>Insights that keep you in control.</h2><p>React Review AI performs read-only static analysis. It does not modify project files, execute your application, or claim that heuristic checks are a full WCAG certification.</p></div>
        <div class="workflow-badge">READ ONLY <span>✓</span></div>
      </section>

      <footer><span>© 2026 React Review AI</span><span>Built for thoughtful code reviews.</span></footer>
    </main>
  </div>
`;

const navigationLinks = [...document.querySelectorAll(".nav-link")];
const sections = navigationLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      navigationLinks.forEach((link) => {
        const active = link.getAttribute("href") === `#${entry.target.id}`;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    }
  }, { rootMargin: "-20% 0px -65% 0px" });

  sections.forEach((section) => observer.observe(section));
}


// Browser OAuth uses the official MCP SDK. Only the short-lived PKCE verifier,
// state and discovery metadata survive the authorization redirect; access and
// refresh tokens remain in memory and are never written to browser storage.
const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const OAUTH_SESSION_KEYS = Object.freeze({
  state: "react-review-ai.oauth.state",
  verifier: "react-review-ai.oauth.pkce-verifier",
  discovery: "react-review-ai.oauth.discovery",
  createdAt: "react-review-ai.oauth.created-at",
});

function readOAuthSessionValue(key) {
  try { return window.sessionStorage.getItem(key); } catch {
    throw new Error("Secure browser session storage is unavailable; OAuth cannot continue.");
  }
}

function writeOAuthSessionValue(key, value) {
  try { window.sessionStorage.setItem(key, value); } catch {
    throw new Error("Secure browser session storage is unavailable; OAuth cannot continue.");
  }
}

function removeOAuthSessionValue(key) {
  try { window.sessionStorage.removeItem(key); } catch {
    // Cleanup is best-effort; no credential is persisted here.
  }
}

class BrowserOAuthProvider {
  constructor(clientId, issuer) {
    this.clientId = clientId;
    this.issuer = issuer;
    this.accessTokens = undefined;
    this.redirectUrl = new URL(window.location.pathname, window.location.origin).href;
    this.clientMetadata = {
      client_name: "React Review AI",
      redirect_uris: [this.redirectUrl],
      application_type: "web",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    };
  }

  clientInformation(context) {
    if (!context?.issuer || !this.clientId) return undefined;
    if (context.issuer !== this.issuer) {
      throw new Error("Authorization server issuer does not match the configured issuer.");
    }
    return {
      client_id: this.clientId,
      token_endpoint_auth_method: "none",
      issuer: context.issuer,
    };
  }

  saveClientInformation() {
    // The configured authorization server uses a pre-registered public client; dynamic registration is not used.
  }

  tokens() {
    return this.accessTokens;
  }

  saveTokens(tokens) {
    this.accessTokens = tokens;
  }

  state() {
    const value = crypto.randomUUID();
    writeOAuthSessionValue(OAUTH_SESSION_KEYS.createdAt, String(Date.now()));
    writeOAuthSessionValue(OAUTH_SESSION_KEYS.state, value);
    return value;
  }

  get pendingState() {
    const state = readOAuthSessionValue(OAUTH_SESSION_KEYS.state);
    const createdAt = Number(readOAuthSessionValue(OAUTH_SESSION_KEYS.createdAt));
    if (!state || !Number.isFinite(createdAt) || Date.now() - createdAt > OAUTH_TRANSACTION_TTL_MS) {
      this.clearOAuthTransaction();
      return null;
    }
    return state;
  }

  saveCodeVerifier(verifier) {
    writeOAuthSessionValue(OAUTH_SESSION_KEYS.verifier, verifier);
  }

  codeVerifier() {
    if (!this.pendingState) throw new Error("The PKCE transaction has expired. Please reconnect.");
    const verifier = readOAuthSessionValue(OAUTH_SESSION_KEYS.verifier);
    if (!verifier) throw new Error("The PKCE transaction has expired. Please reconnect.");
    return verifier;
  }

  saveDiscoveryState(discovery) {
    writeOAuthSessionValue(OAUTH_SESSION_KEYS.discovery, JSON.stringify(discovery));
  }

  discoveryState() {
    if (!this.pendingState) return undefined;
    const value = readOAuthSessionValue(OAUTH_SESSION_KEYS.discovery);
    if (!value) return undefined;
    try { return JSON.parse(value); } catch {
      this.clearOAuthTransaction();
      throw new Error("OAuth discovery state is invalid. Please reconnect.");
    }
  }

  redirectToAuthorization(url) {
    window.location.assign(url.href);
  }

  invalidateCredentials(scope) {
    if (scope === "tokens" || scope === "all") this.accessTokens = undefined;
    if (scope === "verifier" || scope === "all") removeOAuthSessionValue(OAUTH_SESSION_KEYS.verifier);
    if (scope === "discovery" || scope === "all") removeOAuthSessionValue(OAUTH_SESSION_KEYS.discovery);
    if (scope === "all") {
      removeOAuthSessionValue(OAUTH_SESSION_KEYS.state);
      removeOAuthSessionValue(OAUTH_SESSION_KEYS.createdAt);
    }
  }

  clearOAuthTransaction() {
    removeOAuthSessionValue(OAUTH_SESSION_KEYS.state);
    removeOAuthSessionValue(OAUTH_SESSION_KEYS.verifier);
    removeOAuthSessionValue(OAUTH_SESSION_KEYS.discovery);
    removeOAuthSessionValue(OAUTH_SESSION_KEYS.createdAt);
  }
}

let mcpClient;
let mcpTransport;
let oauthProvider;

const connectionCard = document.querySelector(".connection-card");
const connectionTitle = connectionCard?.querySelector(".connection-copy h3");
const connectionDetail = connectionCard?.querySelector(".connection-copy p");
const connectionState = connectionCard?.querySelector(".connection-state");
const connectButton = document.querySelector("#connect-mcp");
const runButtons = [...document.querySelectorAll("[data-run-tool]")];
const toolOutput = document.querySelector("#tool-output");
const toolOutputTitle = document.querySelector("#tool-output-title");
const toolOutputContent = document.querySelector("#tool-output-content");

function setConnectionStatus(title, detail, state = "pending") {
  if (connectionTitle) connectionTitle.textContent = title;
  if (connectionDetail) connectionDetail.textContent = detail;
  if (connectionState) connectionState.textContent = state.toUpperCase();
  connectionCard?.setAttribute("data-connection-state", state);
}

function clearOAuthCallbackUrl() {
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
}

function showToolOutput(title, value) {
  if (!toolOutput || !toolOutputTitle || !toolOutputContent) return;
  toolOutputTitle.textContent = title;
  toolOutputContent.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  toolOutput.hidden = false;
}

async function finishOAuthCallback(provider) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") && !params.has("error")) return false;

  const expectedState = provider.pendingState;
  if (!expectedState || params.get("state") !== expectedState) {
    provider.clearOAuthTransaction();
    clearOAuthCallbackUrl();
    throw new Error("OAuth state validation failed. Start a new connection.");
  }
  if (params.has("error")) {
    provider.clearOAuthTransaction();
    clearOAuthCallbackUrl();
    throw new Error("Authorization was cancelled or denied. No provider error details were displayed.");
  }

  const callbackTransport = new StreamableHTTPClientTransport(
    new URL(import.meta.env.VITE_MCP_ENDPOINT.trim()),
    { authProvider: provider },
  );
  try {
    await callbackTransport.finishAuth(params);
  } catch (error) {
    provider.clearOAuthTransaction();
    clearOAuthCallbackUrl();
    throw error;
  } finally {
    await callbackTransport.close();
  }
  provider.clearOAuthTransaction();
  clearOAuthCallbackUrl();
  return true;
}

async function connectMcp() {
  if (!oauthConfigurationReady) {
    setConnectionStatus(
      "OAuth configuration required",
      "Configure the HTTPS MCP endpoint, exact OAuth issuer (VITE_OAUTH_ISSUER), and public client ID (VITE_OAUTH_CLIENT_ID) before connecting.",
      "invalid",
    );
    return;
  }

  connectButton.disabled = true;
  let pendingTransport;
  setConnectionStatus("Preparing secure connection", "Discovering the protected resource and preparing OAuth Authorization Code + PKCE.", "pending");
  try {
    oauthProvider ??= new BrowserOAuthProvider(oauthClientId, oauthIssuer);
    await finishOAuthCallback(oauthProvider);

    const client = new Client({ name: "react-review-ai-dashboard", version: "0.6.0" });
    pendingTransport = new StreamableHTTPClientTransport(
      new URL(import.meta.env.VITE_MCP_ENDPOINT.trim()),
      { authProvider: oauthProvider },
    );

    try {
      await client.connect(pendingTransport);
    } catch (error) {
      if (error instanceof UnauthorizedError) return;
      await pendingTransport.close();
      throw error;
    }

    const listed = await client.listTools();
    const availableTools = new Set((listed.tools || []).map((tool) => tool.name));
    const requiredTools = ["review_project", "review_component", "run_test_audit", "audit_accessibility"];
    const missingTools = requiredTools.filter((name) => !availableTools.has(name));
    if (missingTools.length) {
      throw new Error("MCP server is missing required tools: " + missingTools.join(", "));
    }
    mcpClient = client;
    mcpTransport = pendingTransport;
    runButtons.forEach((button) => {
      button.disabled = !availableTools.has(button.dataset.runTool);
    });
    setConnectionStatus(
      "MCP transport ready",
      "The server handshake and tool discovery succeeded. OAuth is completed when the first protected tool is invoked.",
      "configured",
    );
    connectButton.textContent = "Disconnect";
    connectButton.disabled = false;
  } catch (error) {
    try { await pendingTransport?.close(); } catch {
      // A failed handshake may already have closed the transport.
    }
    setConnectionStatus("Connection could not be completed", error instanceof Error ? error.message : "Unexpected connection error.", "invalid");
    connectButton.disabled = false;
  }
}

async function disconnectMcp() {
  try { await mcpClient?.close(); } catch {
    // Closing a failed or expired transport is best-effort.
  }
  try { await mcpTransport?.close(); } catch {
    // Closing a failed or expired transport is best-effort.
  }
  mcpClient = undefined;
  mcpTransport = undefined;
  oauthProvider = undefined;
  runButtons.forEach((button) => { button.disabled = true; });
  connectButton.textContent = "Connect MCP";
  setConnectionStatus("MCP disconnected", "The browser session is disconnected. Tokens were held in memory only.", "pending");
}

async function runMcpTool(name) {
  if (!mcpClient) {
    await connectMcp();
    if (!mcpClient) return;
  }

  const args = {};
  if (name === "review_component") {
    const pathInput = document.querySelector("[data-component-path]");
    const filePath = pathInput?.value.trim();
    if (!filePath) {
      showToolOutput("Component review needs a file path", "Enter a project-relative source path, for example src/components/Button.jsx.");
      return;
    }
    args.file_path = filePath;
  }

  const button = runButtons.find((item) => item.dataset.runTool === name);
  if (button) button.disabled = true;
  showToolOutput("Running " + name, "The read-only analysis request is being sent to the MCP server.");
  try {
    const result = await mcpClient.callTool({ name, arguments: args });
    showToolOutput(name + " result", result.structuredContent?.data ?? result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return;
    showToolOutput(name + " failed", error instanceof Error ? error.message : "The MCP tool request failed.");
  } finally {
    if (button && mcpClient) button.disabled = false;
  }
}

connectButton?.addEventListener("click", () => {
  if (mcpClient) void disconnectMcp();
  else void connectMcp();
});

runButtons.forEach((button) => {
  button.addEventListener("click", () => void runMcpTool(button.dataset.runTool));
});

document.querySelector("#clear-tool-output")?.addEventListener("click", () => {
  if (toolOutput) toolOutput.hidden = true;
  if (toolOutputContent) toolOutputContent.textContent = "";
});

if (oauthConfigurationReady && (new URLSearchParams(window.location.search).has("code") || new URLSearchParams(window.location.search).has("error"))) {
  void connectMcp();
}
