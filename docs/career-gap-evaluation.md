# CareerGap Golden Set v1

CareerGap v1 defines the Gap Agent’s job as:

> Select the smallest unresolved fact that could materially change a live decision, after checking whether existing evidence already answers it.

The Python ADK Gap Agent now implements this contract behind a server-side rollout flag. The existing TypeScript ranker remains the deterministic candidate/evidence scaffold and safe fallback. Today UI, storage, authentication, and the Career Demo seed remain unchanged.

## Agent responsibility boundary

| Agent | Owns |
| --- | --- |
| Context Agent | What is known and which evidence supports it |
| Gap Agent | Which missing fact could change a live decision |
| Attention Agent | Whether it matters now, including deadlines and calendar relevance |
| Partner Agent | Whether and how to interrupt, ask, or help acquire the answer |

Calendar proximity must not change the Gap Agent’s structural winner. It may change Attention urgency and Partner behavior. The current seven-factor ranker still contains urgency and interruption terms; its V1 adapter is intentionally a baseline for measuring that migration rather than silently changing runtime behavior.

## Contracts

[`gapContractV1.ts`](../src/lib/agents/gapContractV1.ts) defines:

- `GapCandidateV1`, including graph source nodes, affected decisions and paths, four-way evidence status, categorical decision effect, acquisition path, and suppression.
- `GapAssessmentV1`, including all candidates, one selected gap or `null`, exact suppressed IDs, a concise rationale, and escalation eligibility.
- Schema invariants: answered gaps are suppressed, suppressed gaps cannot be selected, actionable gaps affect a live decision, conflicting evidence has at least two identified sources, and actionable gaps include an acquisition path.
- Graph validation: node IDs, decision IDs, evidence IDs, path boundaries, and path edges must exist in the supplied project.

The ADK model emits only compact `GapSelectionDraftV1`. Python merges the
selected identifier and concise rationale into the deterministic candidate
scaffold, then validates the complete `GapAssessmentV1`. This keeps graph
references and evidence classification deterministic while evaluating the
model on the core semantic choice. No chain-of-thought is part of either
contract.

## Portable fixture

[`careerGapFixture.ts`](../src/lib/evals/careerGapFixture.ts) rebuilds every case from the unchanged Northstar Career Demo. Mutations are typed, applied centrally, and produce a fully materialized strategy input containing:

- fixture version and fixed clock;
- project graph and sources;
- durable memories;
- Calendar events;
- scoped Context Pack;
- stable FNV-1a fixture hash.

Every strategy receives this materialized snapshot. The Python/ADK strategy therefore does not duplicate TypeScript mutation logic.

## The 15 cases

[`careerGapGoldenSet.ts`](../src/lib/evals/careerGapGoldenSet.ts) covers:

1. Base role-direction conflict.
2. Conditional frontend acceptance.
3. Confirmed transition, making compensation decisive.
4. Known role fit, transition, and compensation, leaving steady-state work mix.
5. Completed rejection with no question remaining.
6. Conflicting work-mix evidence.
7. Removed backend/AI preference.
8. Dominant financial-stability priority.
9. Removed financial concern.
10. Recruiter call in 45 days.
11. Recruiter call in 30 minutes.
12. Unrelated imminent Calendar event.
13. A semantic answer already present in context.
14. Explicitly superseded frontend preference.
15. Close high-value candidates with conflicting evidence and escalation eligibility.

Gold expectations are hand-authored semantic concepts such as `transition_credibility`; they are never calculated by the strategy being evaluated. Exact prose matching is deliberately avoided.

## Quality gates

Deterministic gates are:

- contract validity: 100%;
- answered-gap suppression: 100%;
- unrelated-calendar invariance: 100%;
- no unsuppressed generic questions: 100%;
- top concept: at least 13/15;
- evidence classification: at least 14/15;
- required evidence coverage: 100%.

Attention, Partner action, escalation, forbidden concepts, and categorical decision effect are also scored. A later LLM judge may assess only minimum-question wording and concise rationale quality; it must not replace deterministic semantic checks.

## Run and compare

Run the current deterministic baseline:

```bash
npm run eval:career-gap
```

The report shows contract validity, semantic top-gap accuracy, evidence classification, answer suppression, evidence coverage, Calendar invariance, and overall gate status. Per-case failures explain what a strategy must improve.

To run the real ADK comparison, start the Python service with evaluation
overrides deliberately enabled:

```bash
cd agent-service
set -a; . ./.env; set +a
GAP_AGENT_EVAL_OVERRIDES_ENABLED=true uv run uvicorn app.fast_api_app:app --host 127.0.0.1 --port 8080
```

In another terminal, begin with the default two-case cheap/balanced/strong
matrix:

```bash
GAPSWISE_AGENT_URL=http://127.0.0.1:8080 npm run eval:career-gap:live
```

Then run the full gate for the candidate profile:

```bash
GAPSWISE_AGENT_URL=http://127.0.0.1:8080 \
CAREER_GAP_LIVE_MAX_CASES=15 \
CAREER_GAP_LIVE_PROFILES=cheap \
npm run eval:career-gap:live
```

Optional `CAREER_GAP_LIVE_CASE_IDS` selects comma-separated stable case IDs.
Model, thinking, and output-budget overrides use
`AGENT_GAP_EVAL_<CHEAP|BALANCED|STRONG>_*`. Evaluation overrides are rejected
unless the Python opt-in is true.

### Recorded local proof — 2026-08-17

Vertex AI model listing for `<GCP_PROJECT_ID>/global` returned both exact IDs:
`publishers/google/models/gemini-3.5-flash-lite` and
`publishers/google/models/gemini-3.5-flash`.

The full 15-case cheap run used `gemini-3.5-flash-lite`, passed every hard gate,
scored 14/15 top concepts and 15/15 evidence states, averaged 2.285 seconds,
and used 197,561 input / 1,292 output tokens. A two-case comparison produced
the same 100% contract/top/evidence result for all profiles, with average
latencies of 1.859 seconds (cheap), 5.712 seconds (balanced), and 9.072 seconds
(strong). Cheap is therefore the selected profile for rollout.

Numeric price rates were not configured, so the harness correctly reported
cost as unavailable and used token volume as its explicit cost proxy. Configure
the optional per-million-token rates from the current official price sheet to
record a numeric estimate; never hardcode or guess stale pricing.

The rollout remains `GAP_AGENT_MODE=deterministic` by default. Use `shadow`
first in real traffic; it makes paid calls but cannot change the product result.
Only set `live` after reviewing shadow agreement and sanitized failure rates.

## Agent Platform Evaluation export

`toAgentPlatformEvaluationDataset()` produces the supported single-turn Evaluation Dataset shape:

- user prompt as bare Vertex `Content`;
- model reference wrapped in `ResponseCandidate`;
- semantic expectations and fixture identifiers as custom fields.

This also prepares hosted Agent Platform evaluation without changing product state. The deterministic demo remains zero-cost and makes no Vertex, ADK, Firestore, Cloud Storage, or Calendar calls.
