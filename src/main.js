import "./style.css";

const tools = [
  {
    number: "01",
    title: "Project Review",
    description: "Inspect a React codebase for maintainability, reliability, and common engineering risks.",
    tag: "Repository analysis",
  },
  {
    number: "02",
    title: "Component Review",
    description: "Review a focused component for correctness, React patterns, and potential regressions.",
    tag: "Component analysis",
  },
  {
    number: "03",
    title: "Test Audit",
    description: "Identify test gaps and suggest practical coverage improvements for critical behavior.",
    tag: "Quality signals",
  },
  {
    number: "04",
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

const mcpConfiguration = getMcpConfiguration();
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
              <div class="card-footer"><span>${tool.tag}</span><span class="footer-arrow" aria-hidden="true">→</span></div>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="section integration-section" id="integration" aria-labelledby="integration-title">
        <div class="section-heading">
          <div><div class="eyebrow">CONNECTION READINESS</div><h2 id="integration-title">MCP integration</h2><p>Frontend configuration is separated from authentication and backend availability.</p></div>
          <span class="count">CONFIGURATION</span>
        </div>
        <div class="connection-card" data-connection-state="${mcpConfiguration.state}" role="status" aria-live="polite">
          <span class="connection-indicator" aria-hidden="true"></span>
          <div class="connection-copy">
            <h3>${mcpConfiguration.title}</h3>
            <p>${mcpConfiguration.detail}</p>
          </div>
          <span class="connection-state">${mcpConfiguration.state === "configured" ? "NOT VERIFIED" : mcpConfiguration.state === "invalid" ? "INVALID CONFIG" : "PENDING"}</span>
        </div>
        <p class="integration-note">No access token or client secret is stored in this static frontend. The dashboard does not send requests until the browser OAuth flow and MCP session lifecycle are implemented and tested. Browser access also requires an explicit server-side origin allowlist.</p>
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
