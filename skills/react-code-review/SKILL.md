---
name: react-code-review
description: Comprehensive read-only review of React architecture, components, hooks, performance, TypeScript, security, and maintainability.
---
# React Code Review
1. Identify React version, framework, TypeScript, package manager, and project structure.
2. Inspect architecture, component boundaries, state ownership, data flow, routing, and error handling.
3. Review hooks and effect dependencies in full context; do not flag from isolated syntax alone.
4. Inspect rendering performance, list identity, expensive render work, and unnecessary synchronization.
5. Inspect security boundaries, raw HTML, URL handling, client-exposed secrets, and authorization assumptions.
6. Consolidate duplicates and prioritize by impact and likelihood.
Every finding needs ID, severity, category, file/line when available, evidence, explanation, recommendation, and verification. Never invent line numbers or claim runtime behavior from static code. Read-only unless the user explicitly authorizes edits.
