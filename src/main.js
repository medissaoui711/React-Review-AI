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

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="React Review AI home">
        <span class="brand-mark">R<span>✳</span></span>
        <span class="brand-copy"><strong>React Review</strong><small>AI TOOLKIT</small></span>
      </a>
      <div class="nav-label">WORKSPACE</div>
      <nav class="navigation" aria-label="Main navigation">
        <a class="nav-link active" href="#overview"><span class="nav-icon">⌂</span> Overview</a>
        <a class="nav-link" href="#tools"><span class="nav-icon">◇</span> Review tools</a>
        <a class="nav-link" href="#workflow"><span class="nav-icon">↗</span> Workflow</a>
      </nav>
      <div class="sidebar-bottom">
        <div class="side-status"><span class="status-dot"></span><span><strong>Demo interface</strong><small>Backend connection pending</small></span></div>
        <div class="sidebar-version">VERSION 0.6.0</div>
      </div>
    </aside>

    <main class="main-content" id="overview">
      <header class="topbar">
        <div class="breadcrumb">Workspace <span>/</span> Overview</div>
        <div class="topbar-right"><span class="readonly-pill"><span></span> READ-ONLY ANALYSIS</span><div class="avatar">RA</div></div>
      </header>

      <section class="welcome">
        <div class="eyebrow"><span class="eyebrow-line"></span> AI-POWERED CODE QUALITY</div>
        <h1>Ship better React.<br /><span>Review with confidence.</span></h1>
        <p class="intro">A focused toolkit for understanding code quality, spotting risks, and improving the reliability of your React applications.</p>
        <a class="primary-link" href="#tools">Explore review tools <span>→</span></a>
        <div class="orb orb-one"></div><div class="orb orb-two"></div>
      </section>

      <section class="section" id="tools">
        <div class="section-heading">
          <div><div class="eyebrow">CAPABILITIES</div><h2>Review toolkit</h2><p>Four focused analysis tools. One clearer view of your codebase.</p></div>
          <span class="count">04 TOOLS</span>
        </div>
        <div class="tool-grid">
          ${tools.map((tool) => `
            <article class="tool-card">
              <div class="card-top"><span class="tool-number">${tool.number}</span><span class="card-arrow">↗</span></div>
              <h3>${tool.title}</h3>
              <p>${tool.description}</p>
              <div class="card-footer"><span>${tool.tag}</span><span class="footer-arrow">→</span></div>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="workflow" id="workflow">
        <div class="workflow-icon">⌘</div>
        <div><div class="eyebrow">BUILT FOR DEVELOPERS</div><h2>Insights that keep you in control.</h2><p>React Review AI performs read-only static analysis. It does not modify project files, execute your application, or claim that heuristic checks are a full WCAG certification.</p></div>
        <div class="workflow-badge">READ ONLY <span>✓</span></div>
      </section>

      <footer><span>© 2026 React Review AI</span><span>Built for thoughtful code reviews.</span></footer>
    </main>
  </div>
`;
