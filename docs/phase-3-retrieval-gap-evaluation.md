# Phase 3 — Retrieval-aware Gap Agent

Phase 3 makes the Context Pack a real input boundary for the Gap Agent, not
just metadata attached to a trace. The same behavior is used by local
deterministic mode, shadow comparison, and the live ADK route.

The production path now:

- scopes candidate UNKNOWN/ASSUMPTION nodes to the selected project pack;
- carries the pack's retrieved evidence and graph provenance into each
  candidate's evidence review;
- suppresses answered or out-of-scope gaps before selection;
- uses the V1 assessment to update the effective active question and partner
  handoff; and
- records a sanitized Decision Map activity trace even when no provider is
  available. The trace says when retrieved context already answered every
  candidate without exposing document bodies or prompts.

The regression scenario validates the two intelligence boundaries that sit on
top of the stable source graph from Phases 1–2:

- Context Pack retrieval selects evidence for the active ClinicFlow question,
  including the newest retry-test result when the query asks for the latest
  document.
- Project scope excludes another project's sources and durable memories.
- A resolved retry question appears as recently resolved context but cannot be
  selected as an actionable gap.
- A retrieved source with a clear affirmative result can suppress a duplicate
  question; pending or negative status language remains an unresolved gap.
- Gap Agent V1 candidates reference real graph nodes, evidence, and decision
  paths; actionable candidates have an acquisition path and suppressed gaps
  have an explicit reason.
- Demo mode runs only the deterministic assessment. It records a deterministic
  selection trace, never fabricated Gemini/ADK usage.

Run it with:

```bash
npm run test:clinicflow:phase3
```

The test is intentionally zero-cost. Live ADK comparison remains a separate,
explicitly gated evaluation and cannot affect deterministic demo behavior.
