---
name: accessibility-audit
description: React accessibility review targeting WCAG 2.2 AA, semantic HTML, ARIA, keyboard, focus, and assistive technology.
---
# Accessibility Audit
Target WCAG 2.2 AA as an engineering goal, not a conformance claim from static inspection. Review semantic structure, names/labels, ARIA roles/states, keyboard reachability, focus visibility/order/restoration, forms/errors, status announcements, text alternatives, headings/landmarks, contrast, reflow, target size, and motion. Prefer native controls. ARIA does not replace interaction behavior. Distinguish source-level clues from rendered behavior. Recommend browser automation (axe-core or equivalent) plus manual keyboard and screen-reader testing.
