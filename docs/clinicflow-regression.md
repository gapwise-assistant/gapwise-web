# ClinicFlow regression scenario

This is the first complete, zero-cost regression scenario for the project
workflow. It is intentionally deterministic and does not call Gemini, ADK,
Firestore, Storage, Calendar, or any other external service.

Run it with:

```bash
npm run test:clinicflow
```

The scenario uses the four baseline documents in
`docs/test-data/clinicflow/` and a deterministic follow-up source containing
the result of the planned offline retry test. It checks the same state changes
the product relies on:

1. Start a fresh ClinicFlow project with a September 4 go/no-go deadline.
2. Ingest the pilot brief, clinical/operations notes, vendor review, and
   steering update in order.
3. Verify source provenance, graph references, decision links, deduplication,
   and the highest-value unresolved launch gate.
4. Re-submit the first source and verify the hash guard skips it without
   creating duplicate graph nodes.
5. Ingest the conclusive retry-test result and verify that the offline-retry
   question becomes resolved through a `resolves` edge.
6. Re-rank gaps and verify the resolved retry question is no longer eligible;
   Today now surfaces another launch gate (SMS approval in this fixture).
7. Build a project-scoped Context Pack and verify the newly resolved gap and
   source evidence are available while unrelated career context is excluded.
8. Generate Today questions and recommendations and verify the resolved
   question is not duplicated there.
9. Save the graph to the file-backed mock provider, reload it in a new
   provider instance, and verify project isolation plus the resolved state.
10. Run the local Ask workflow against the persisted project and verify its
    prompt and sources are ClinicFlow-scoped.

The fixture is defined in
`src/lib/evals/clinicflowRegression.ts`; the test is
`src/lib/evals/clinicflowRegression.test.ts`.

This is the deterministic baseline for later live-agent comparisons. A future
AI evaluation can run the same source sequence and compare its selected gap,
guidance, latency, and trace fields against this expected state without
changing the regression fixture.
