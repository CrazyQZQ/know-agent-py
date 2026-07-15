# Know-Agent HTML Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, interactive HTML prototype that mirrors the implemented Know-Agent frontend workflows.

**Architecture:** One static HTML document contains semantic UI markup, scoped CSS design tokens, mock data, and event-driven JavaScript. The prototype is isolated from the Next.js application and uses no backend API.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript, Lucide browser icons.

---

### Task 1: Prototype shell and design system

**Files:**
- Create: `know-agent-ui/原型/index.html`

- [ ] Add the responsive application shell, sidebar, top bar, reusable control styles, typography, spacing, and color tokens.
- [ ] Add realistic mock users, threads, messages, documents, segments, and workflow stages.

### Task 2: Interactive product workflows

**Files:**
- Modify: `know-agent-ui/原型/index.html`

- [ ] Implement login/logout and top-level navigation.
- [ ] Implement assistant history, message sending, tool activity, and approval states.
- [ ] Implement workflow card list, PPT detail entry, Mermaid flow rendering, assistant-style conversation, and completion state.
- [ ] Implement knowledge search, filtering, upload dialog, detail view, and lifecycle actions.

### Task 3: Responsive and browser verification

**Files:**
- Create: `know-agent-ui/原型/design-qa.md`

- [ ] Serve the prototype with a local static server.
- [ ] Verify desktop and mobile layouts and exercise the primary interactions.
- [ ] Record QA findings, fix all blocking and major issues, and mark the final result.
