# Phase 2 — Source and evidence integrity

Phase 2 makes Context state truthful before we tune AI quality.

## Completed

- Completed and failed processing attempts now receive a `processed_at`
  timestamp even when callers only provide a processing status.
- Connector-created sources use the same extraction/processing timestamp.
- Older completed sources without that field display their extraction time as
  a safe UI fallback instead of claiming they were never processed.
- Near-duplicate UNKNOWN and ASSUMPTION questions are merged conservatively
  using normalized meaningful tokens and light singular/plural stemming.
- Distinct questions remain separate; deduplication is restricted to open-gap
  node types and does not merge facts, decisions, risks, or constraints.
- Existing source hashes, provenance references, graph relationships, and
  project boundaries remain unchanged.

## Verification

```bash
npm test -- --run src/lib/context/ingestion.test.ts
npm run test:clinicflow
npm run lint
```

The next phase can now evaluate retrieval and Gap Agent selection against a
stable graph without confusing missing metadata or duplicate question nodes
for model-quality failures.
