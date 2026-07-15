# Native Graph Interrupt And Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use native LangGraph interrupts and a backend-owned generic presentation protocol while preserving the current structured form UI.

**Architecture:** Registered graphs own adapters from node state to generic presentation data. The graph router transports raw updates plus adapted presentations and maps native LangGraph interrupts to SSE. The React page renders only the generic protocol and retains the current form renderer.

**Tech Stack:** Python 3.12, FastAPI, LangGraph, pytest, React, TypeScript, Vitest.

---

### Task 1: Native interrupt and resume contract

**Files:**
- Modify: `tests/test_graph_router.py`
- Modify: `tests/test_ppt_interrupt.py`
- Modify: `src/know_agent/routers/graph.py`
- Modify: `src/know_agent/graphs/ppt/nodes.py`
- Modify: `src/know_agent/graphs/ppt/graph.py`

- [ ] Add failing tests showing `__interrupt__` becomes one SSE interrupt event with its id and form payload.
- [ ] Add a failing test showing resume streams `Command(resume=...)` without `update_state()`.
- [ ] Add a failing test showing the clarification node calls native `interrupt()` and merges structured answers after resume.
- [ ] Run `uv run pytest tests/test_graph_router.py tests/test_ppt_interrupt.py -q` and confirm the new assertions fail for the missing behavior.
- [ ] Implement the native interrupt and resume path and remove `interrupt_before`.
- [ ] Re-run the targeted backend tests and confirm they pass.

### Task 2: Backend presentation adapter

**Files:**
- Modify: `tests/test_registry.py`
- Modify: `tests/test_graph_router.py`
- Modify: `src/know_agent/graphs/registry.py`
- Modify: `src/know_agent/graphs/ppt/graph.py`

- [ ] Add failing tests for graph-specific `present_update` and `present_done` adapters.
- [ ] Confirm the router tests fail because update and done events lack `presentation`.
- [ ] Add typed generic presentation helpers to the registry and include adapter output in SSE events.
- [ ] Move all PPT requirement, search, template, outline, schema, and artifact summaries into the PPT registration adapter.
- [ ] Re-run registry and router tests.

### Task 3: Generic frontend rendering with form compatibility

**Files:**
- Modify: `web-ui/src/tests/workflow-message.test.ts`
- Modify: `web-ui/src/tests/workflow.test.tsx`
- Modify: `web-ui/src/features/workflows/workflow-message.ts`
- Modify: `web-ui/src/features/workflows/WorkflowRunPage.tsx`

- [ ] Add failing tests showing arbitrary graph presentations render without known node names or state keys.
- [ ] Add form regression coverage for textarea, single-select, multi-select, required validation, submit, and cancel.
- [ ] Confirm targeted Vitest tests fail before implementation.
- [ ] Remove PPT-specific presentation parsing and `shouldSuppressUpdate()` from the frontend.
- [ ] Render `update.presentation`, `done.presentation`, and native interrupt forms generically.
- [ ] Re-run targeted frontend tests.

### Task 4: Regression and runtime verification

**Files:**
- Test: `tests/test_graph_router.py`
- Test: `tests/test_ppt_interrupt.py`
- Test: `web-ui/src/tests/workflow.test.tsx`

- [ ] Run relevant backend regression tests.
- [ ] Run full frontend tests, lint, and production build.
- [ ] Run the PPT workflow in the browser and verify no visible text flashes before the form.
- [ ] Verify one final artifact action and smooth scrolling.
- [ ] Run `git diff --check` and inspect scoped changes without reverting unrelated user files.

