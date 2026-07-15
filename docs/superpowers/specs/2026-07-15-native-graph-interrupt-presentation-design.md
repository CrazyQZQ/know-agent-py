# Native Graph Interrupt And Presentation Design

## Goal

Make workflow interaction and user-facing output generic across registered graphs. Replace `interrupt_before` plus frontend field guessing with LangGraph native `interrupt()` / `Command(resume=...)` and a backend-owned presentation adapter.

## Decisions

- Keep `clarification` as an explicit Human Input node.
- The clarification node calls `interrupt(form_payload)`. On resume, the same node receives the structured answer and merges it into graph input.
- Preserve the existing form contract and UI behavior for `textarea`, `single_select`, and `multi_select`, including required validation, option selection, submit, cancel, and legacy plain-text fallback.
- Raw node state remains in each `update.values` payload for the technical details panel.
- Each graph registration converts node-specific state into a generic `presentation` payload. The frontend never reads PPT-specific state keys.
- A presentation has `kind`, `headline`, `body`, and optional artifact fields. Missing presentation means the update is technical/progress-only.
- Native `__interrupt__` output becomes one `interrupt` SSE event. It is not inferred from a preceding update and therefore cannot replace already-rendered model text after a delay.
- Resume uses `Command(resume=...)`; the router no longer mutates graph state with a graph-specific response key.

## Event Contract

```json
{
  "event": "update",
  "data": {
    "node": "outline",
    "values": {"ppt_outline": "..."},
    "presentation": {
      "kind": "message",
      "headline": "Content outline generated",
      "body": "..."
    }
  }
}
```

```json
{
  "event": "interrupt",
  "data": {
    "id": "stable-langgraph-interrupt-id",
    "type": "form",
    "title": "Provide more information",
    "description": "...",
    "fields": [],
    "actions": []
  }
}
```

The `done` event also carries an optional generic `presentation`, so artifact rendering does not depend on `ppt_result` or a synthetic `render` update in the frontend.

## Compatibility

- Existing run request bodies stay unchanged.
- Existing resume bodies keep `answers` and `clarificationResponse`; the backend converts them to the native resume value.
- The right-side raw output remains available.
- Existing form payloads remain valid.
- Legacy non-form interrupt payloads still render through the text composer fallback.

## Verification

- A clarification run emits no duplicate visible update before the interrupt form.
- Structured form fields render and resume exactly as before.
- A non-PPT graph can provide a presentation without frontend node or field changes.
- `done` renders one artifact action.
- SSE replay remains idempotent.

