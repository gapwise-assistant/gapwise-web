# GAPSWISE — PROJECT DOCUMENTATION & STATUS REPORT

> **Tagline**: Find the question that unlocks the next decision.  
> **Track**: Collaborative Partner, All Things Agentic Hackathon  
> **Current Status**: Milestones 1-10 complete, with ADK health/context-pack integration, Firestore persistence, Cloud Storage PDF uploads, and server-side PDF analysis wired.  
> **Local URL**: `http://localhost:3000`  
> **Verification Standard**: `npm run lint`, `npm test`, `npm run build`

---

## 1. Product Thesis

Gapswise is a persistent AI context partner that accepts messy context, remembers relevant evidence, connects it across a user's projects and priorities, identifies decision-critical gaps, and chooses the next high-value question or action.

The MVP is intentionally scoped around four behaviors:

- **Remember** durable facts, goals, preferences, decisions, commitments, and evidence.
- **Connect** new information to existing goals, projects, sources, and graph nodes.
- **Question** unresolved uncertainty only when it matters and retrieval cannot already answer it.
- **Prioritize** explain why one question or action deserves attention now.

Gapswise is not a generic task manager, inbox replacement, or open-ended RAG chatbot.

---

## 2. Current Stack

- **Frontend**: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4.
- **Build**: `next build --webpack`.
- **Testing**: Vitest.
- **Validation**: Zod structured-output schemas.
- **Persistence**: Storage abstraction with Firestore as the default provider and a file-backed mock/local provider available through `USE_FIRESTORE=false`.
- **Google infrastructure**: Firestore Native, Cloud Storage PDF assets, Vertex AI Gemini PDF extraction, Cloud Run-compatible API routes.
- **Agent architecture**: ADK-ready four-agent orchestration layer. The actual `@google/adk` runtime is not hard-required yet because the official TypeScript quickstart currently expects Node 24.13+/npm 11.8+, while this workspace uses Node 23.3/npm 10.9.

---

## 3. Milestone Status

### Milestone 1 — Persistence and Cloud Foundation

Completed.

Implemented:

- Project scaffolding and verification scripts in `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, and `.env.example`.
- Storage abstraction in `src/lib/storage/types.ts`.
- File-backed mock provider in `src/lib/storage/mock.ts`.
- Firestore-ready provider in `src/lib/storage/firestore.ts`.
- Google Cloud config helper in `src/lib/firebase-admin.ts`.
- Project-to-storage mapping in `src/lib/storage/projectMapper.ts`.
- Storage service facade in `src/lib/storage/index.ts`.
- `/api/storage` load/save/reset route.
- Golden Demo seed module in `src/lib/demo/seed.ts`.
- User-scoped persistence and Golden Demo reset behavior.

Tests:

- User scoping.
- Graph node and edge round-trip persistence.
- Golden Demo reset determinism.
- Missing Firestore config error clarity.

### Milestone 2 — ADK-Ready Agent Architecture

Completed.

Implemented:

- Four named agent modules:
  - `Context Agent`: `src/lib/agents/contextAgent.ts`
  - `Gap Agent`: `src/lib/agents/gapAgent.ts`
  - `Attention Agent`: `src/lib/agents/attentionAgent.ts`
  - `Partner Agent`: `src/lib/agents/partnerAgent.ts`
- Orchestrator trace flow in `src/lib/agents/orchestrator.ts`.
- Structured-output schemas and validation in `src/lib/agents/schemas.ts`.
- Deterministic tool wrappers:
  - `src/lib/tools/contextTools.ts`
  - `src/lib/tools/serverContextTools.ts`
  - `src/lib/tools/graphTools.ts`
  - `src/lib/tools/feedbackTools.ts`
- `/api/agents/turn` endpoint for inspectable agent turns.
- Existing Project Home answer flow remains compatible through `src/lib/gemini.ts`.

Tests:

- Structured four-agent trace validation.
- Retrieval-before-question guardrail.
- Deterministic top-gap ranking.
- Malformed output rejection.
- One-question Partner Agent default behavior.

### Milestone 3 — Universal Context Inbox

Completed.

Implemented:

- Extended `ContextSource` metadata for:
  - `text`, `pdf`, `image`, `note`, and `voice`
  - processing status
  - MIME type
  - size
  - hash
  - origin
  - storage URL
  - extraction summary
  - error message
- Deterministic ingestion service in `src/lib/context/ingestion.ts`.
- Context Inbox UI support for:
  - source type selector
  - file picker
  - PDF/image/voice metadata capture
  - transcript, description, or excerpt entry
  - source processing/error states
  - derived node lineage display
- Cloud Storage-ready bucket config through `CLOUD_STORAGE_BUCKET`.
- Reversible source discard: context moves to `Discarded context` while source metadata, provenance, derived nodes, and private files remain restorable.
- User-facing Context destination now presents:
  - Recent
  - Documents
  - Connections
  - Add context
- Context UI uses product language such as Source, Processed, What Gapswise learned, and Used in instead of internal graph/retrieval terminology.

Tests:

- PDF source metadata and provenance.
- Voice-note preference extraction.
- Source deletion/deprecation behavior.

### Milestone 4 — My World / Cross-Context Graph

Completed.

Objective:

Add a higher-level map of domains, goals, projects, sources, priorities, and unresolved gaps. The existing Clarity Graph remains the project-level deep view.

Implemented:

- Cross-context graph types in `src/types/clarity.ts`:
  - `WorldDomainType`
  - `WorldNodeType`
  - `WorldNode`
  - `WorldEdge`
  - `WorldDomainSummary`
  - `MyWorldGraph`
- Deterministic graph derivation in `src/lib/world/graph.ts`.
- Domain classification for work, personal, learning, finance, health, relationships, operations, and unsorted context.
- Derived world graph nodes for:
  - domains
  - projects
  - sources
  - goals
  - gaps
  - preferences
  - risks
- Domain rollups for project count, source count, open gaps, risks, and priority.
- My World UI in `src/components/MyWorldView.tsx`.
- Header navigation now includes `My World`.
- Project-level Clarity Graph remains available as the deep view.

Tests:

- Stable domain classification.
- Domain/project/source/gap/risk graph derivation.
- Domain summary rollups.

### Milestone 5 — Evidence-Backed Retrieval and Persistent Memory

Completed.

Objective:

Build targeted retrieval that assembles a small evidence-backed Context Pack for each question/recommendation, plus inspectable durable memory for stable user preferences and priorities.

Implemented:

- Context Pack and durable-memory types in `src/types/contextPack.ts`.
- Relevance scoring and source excerpt retrieval in `src/lib/retrieval/relevance.ts`.
- Context Pack builder in `src/lib/retrieval/contextPack.ts` with:
  - active goals
  - recent important events
  - unresolved gaps
  - relevant source evidence
  - user preferences
  - upcoming commitments
  - recent decisions
  - contradictions
  - included context IDs for trace inspection
- Durable memory policy in `src/lib/memory/policy.ts`.
- Durable memory transform helpers in `src/lib/memory/store.ts`.
- Server-side durable memory persistence in `src/lib/memory/serverStore.ts`, backed by the existing storage abstraction.
- User-scoped Firestore memory documents under `users/{userId}/memories/{memoryId}`.
- Memory API route in `src/app/api/memory/route.ts` for Memory UI load/save operations.
- Memory surface in `src/components/MemoryView.tsx` with:
  - grouped memory categories
  - edit
  - forget
  - confirm
  - why-remembered display
  - explicit memory creation
- Evidence drawer in `src/components/EvidenceDrawer.tsx`.
- Project Home evidence button for the active priority question.
- Agent orchestrator now builds and returns a `contextPack`, and trace events record included context IDs.

Tests:

- Relevant vs irrelevant retrieval fixture.
- Do-not-remember transient statement fixture.
- Explicit preference to durable memory fixture.
- Forget memory excluded from next Context Pack fixture.
- Server durable-memory regressions:
  - created memory persists across provider reloads
  - preference memory appears in server-built Context Packs
  - forgotten memory disappears from the next Context Pack
  - transient statements are not promoted
  - memories remain isolated by `userId`

Current durable memory behavior:

- Firestore is the canonical durable memory store in normal app mode.
- Browser memory storage remains only as a fallback if the memory API is unavailable.
- Memory UI actions create, edit, confirm, and forget through `/api/memory`.
- Context Pack server retrieval loads Firestore-backed durable memory before ranking `userPreferences`.
- Calendar events are not automatically promoted into durable memory.

### Milestone 6 — Attention Engine and Daily Brief

Completed.

Objective:

Create the core Today experience: generate, score, explain, and act on 3-5 items that deserve the user's attention now.

Implemented:

- Attention types in `src/types/attention.ts`.
- Deterministic attention scoring in `src/lib/attention/scoring.ts`.
- Attention candidate generation in `src/lib/attention/candidates.ts`.
- Daily brief generation and idempotent in-memory brief cache in `src/lib/attention/generateBrief.ts`.
- Scheduled/manual attention run endpoint in `src/app/api/attention/run/route.ts`.
- Optional internal scheduler auth through `ATTENTION_RUN_SECRET`.
- Today page in `src/components/Today.tsx`.
- Recommendation card UI in `src/components/RecommendationCard.tsx`.
- Why drawer with user-facing context and evidence in `src/components/RecommendationWhy.tsx`.
- Global navigation in `src/components/Header.tsx` now exposes only:
  - Today
  - Ask
  - Context
  - You
- Mobile uses a fixed bottom navigation for those four destinations.
- Top-level Ask is implemented by `src/components/AskGapswise.tsx`.
- Ask uses the real Google ADK service through the Next.js proxy route `src/app/api/ask/route.ts`.
- The ADK proxy client in `src/lib/ask/adkClient.ts`:
  - creates or reuses ADK sessions
  - calls the ADK `/run_sse` route
  - parses user-visible ADK text responses
  - returns sanitized `Why / Sources` data from Context Pack
  - never returns raw Context Pack JSON, traces, tool calls, or ADK internals to normal users
- Ask service URL is configured with `GAPSWISE_AGENT_URL`, defaulting to the Agents CLI playground at `http://127.0.0.1:8080`.
- Today is organized into one ranked What deserves attention feed and a
  separate compact Coming up section.
- The Today feed presentation model in `src/lib/today/feed.ts` maps ranked
  recommendations to `QUESTION`, `ACTION`, `DECISION`, or `REMINDER` cards and
  deduplicates items backed by the same graph node.
- Deterministic Today section helpers in `src/lib/today/sections.ts`.
- Proactive questions are derived from existing Context Pack gaps, contradictions, assumptions, risks, and Calendar commitments.
- Coming up reads compact Google Calendar commitments from Context Pack only; Today does not call Calendar independently.
- Top-level Scope is implemented by `src/components/YouDestination.tsx` (the file name is retained for compatibility).
- Scope section selectors live in `src/lib/you/sections.ts` and only read existing durable memory and graph state.
- Scope is organized around:
  - Priorities
  - Goals
  - Still unclear
  - Projects
  - What Gapswise remembers
  - View My World
- Existing advanced screens are preserved under Scope:
  - My World visualization
  - active project overview
  - project gaps
  - project graph
  - project sources
  - server-backed durable Memory UI
- Still unclear questions are existing open UNKNOWN/ASSUMPTION records, not generated personal prompts.
- Recommendation feedback:
  - `Not now`
  - `Done`
  - secondary Useful, Not useful, and Wrong assumption feedback lives under a
    `...` menu
  - suppressed recommendations do not remain in the active brief.

Tests:

- Income priority plus recruiter email ranks recruiter opportunity highly.
- Frontend recruiter is not recommended when memory says to avoid frontend roles.
- Urgent meeting plus unresolved related gap ranks as preparation.
- Today section regressions for proactive question limits, provenance, and compact Calendar commitments.
- Ask regressions for ADK session creation/reuse, `/run_sse` response parsing, sanitized sources, invalid requests, and graceful ADK unavailable errors.
- You section regressions for priorities from durable memory, active goals from graph state, and unresolved questions from existing open graph records.
- Low-urgency learning idea does not crowd out urgent goal-aligned work.
- Already done suppresses obsolete recommendations.
- Same user/period brief generation is idempotent unless forced.

### Milestone 7 — Loose Ends, Context Conflicts and Stale State Detection

Completed.

Objective:

Add proactive reasoning that monitors coherence and completeness over time without creating a noisy alert center.

Implemented:

- Insight types in `src/types/insight.ts`.
- Shared insight suppression/action helpers in `src/lib/insights/common.ts`.
- Loose-end detector in `src/lib/insights/looseEnds.ts`.
- Possible context change detector in `src/lib/insights/conflicts.ts`.
- Stale context detector in `src/lib/insights/stale.ts`.
- Combined detector facade in `src/lib/insights/index.ts`.
- Compact Insights panel on Today in `src/components/InsightsPanel.tsx`.
- Per-insight review card in `src/components/InsightReview.tsx`.
- Insight actions:
  - confirm
  - dismiss
  - still true
  - changed
  - not relevant
- Stale-memory actions update durable memory state so future Today ranking can change.
- Dismissed false positives are suppressed unless new evidence creates a different insight ID.

Tests:

- Pending recruiter response becomes a loose end when tied to active goals/priorities.
- Compatible target-persona statements do not trigger contradiction.
- Conflicting target-persona statements include both evidence node IDs.
- Explicit priority change can supersede old priority by excluding forgotten memory from ranking.
- Stale-context threshold behavior.
- Dismissed false positive is not repeatedly surfaced.

### Milestone 8 — Google Workspace Awareness

Completed.

Objective:

Connect selected Gmail, Calendar and Drive context so Today and Context retrieval can reason about deadlines, opportunities and approved documents without becoming a full automation suite.

Implemented:

- Google Workspace types in `src/types/google.ts`.
- Read-only auth/permission helpers in `src/lib/google/auth.ts`.
- Integration state store in `src/lib/google/state.ts`.
- Calendar signal retrieval in `src/lib/google/calendar.ts`.
- Gmail signal retrieval in `src/lib/google/gmail.ts`.
- Drive selected-file/folder retrieval in `src/lib/google/drive.ts`.
- Workspace signal aggregation in `src/lib/google/workspace.ts`.
- Workspace signal to Context Source mapping in `src/lib/google/sourceMapper.ts`.
- Demo-safe API route in `src/app/api/integrations/google/route.ts`.
- Connected Context settings UI in `src/components/ConnectedContext.tsx`.
- Per-integration controls in `src/components/IntegrationSettings.tsx`.
- Context Inbox can sync selected Workspace signals into connector-origin sources.
- Attention engine recognizes:
  - Calendar meeting urgency from Context Pack `upcomingCommitments`
  - Gmail recruiter opportunities
  - selected Drive CV update signals

Safety behavior:

- Integrations are read-only.
- Disconnected integrations do not retrieve future signals.
- Drive content is indexed only after selected file/folder IDs are configured.
- No external write action exists; email is not sent automatically.

Tests:

- Permission denied and token expired handling.
- Disconnected integration retrieval prevention.
- Selected Drive folder/file boundary.
- Calendar relevance fixture.
- Recruiter Gmail source explanation fixture.

### Milestone 9 — Feedback-Driven Personalization

Completed.

Objective:

Make user feedback materially change future questions, memories and recommendations so the product demonstrates adaptation instead of only displaying preference controls.

Implemented:

- Feedback types in `src/types/feedback.ts`.
- Browser feedback event history in `src/lib/personalization/feedbackStore.ts`.
- Feedback application rules in `src/lib/personalization/applyFeedback.ts`.
- Explicit preference thresholds in `src/lib/personalization/preferences.ts`.
- Inspectable prompt profile in `src/lib/personalization/promptProfile.ts`.
- Reusable feedback controls in `src/components/FeedbackControls.tsx`.
- Recommendation cards now support:
  - Useful
  - Not useful
  - Not now
  - Done
  - Wrong assumption
- Today stores feedback events and uses them to suppress/re-rank future briefs.
- `Not now` suppression is bounded by `suppress_until`.
- `Wrong assumption` can add or supersede durable memory.
- Partner Agent now uses `question_frequency` to decide whether a gap is worth interrupting for.
- Memory screen now includes "Why Gapswise Thinks This About You" with current thresholds, citation density and memory reasons.

Tests:

- Priority change from startup growth/no explicit priority to financial stability reranks Today.
- Frontend-role correction persists and suppresses frontend recruiter recommendations.
- Not-now suppression expires.
- Question-frequency threshold changes Partner Agent behavior.

### Milestone 10 — Productization, Mobile PWA, Evaluation and Golden Demo

Completed.

Objective:

Turn the completed capabilities into a reliable mobile-first product and repeatable 4-minute hackathon demonstration with observability and deterministic evaluation fixtures.

Implemented:

- PWA manifest in `public/manifest.webmanifest`.
- SVG app icon in `public/icons/gapswise-icon.svg`.
- Cloud Run-ready `Dockerfile`.
- `.dockerignore`.
- README with local run, verification, Golden Demo flow, and Cloud Run environment notes.
- Mobile navigation polish:
  - wrapped header layout
  - horizontal nav contained inside nav strip
  - hidden secondary labels on small screens
  - global horizontal overflow guard
- Developer observability:
  - trace type in `src/types/observability.ts`
  - trace store in `src/lib/observability/trace.ts`
  - trace API in `src/app/api/dev/traces/route.ts`
  - trace panel in `src/components/dev/TracePanel.tsx`
  - agent turn and attention run trace recording
- Deterministic evaluation suite:
  - `src/lib/evals/scenarios.ts`
  - `src/lib/evals/evals.test.ts`
  - `src/lib/evals/productization.test.ts`
- Evaluation coverage includes 15 scenarios across:
  - retrieval
  - attention ranking
  - context pack explainability
  - conflict detection
  - loose-end detection
  - stale context
  - Workspace boundaries
  - agent trace
  - personalization
  - Golden Demo reset determinism

Deployment notes:

- `npm run build` uses `next build --webpack`.
- Docker image uses Node 24, matching the ADK-ready runtime direction.
- Required production environment variables are documented in README.
- Actual Cloud Run deployment was prepared but not executed from this workspace.

Tests:

- PWA manifest smoke test.
- Evaluation suite count and pass/fail report.
- Trace store safe-metadata smoke test.

### Internal Integration — Context Pack API

Implemented:

- Internal POST endpoint at `src/app/api/internal/context-pack/route.ts`.
- Request validation with Zod for `{ userId, query }`.
- Endpoint reuses `src/lib/retrieval/contextPack.ts` through `buildContextPack`.
- Response wraps the existing Context Pack shape under `contextPack`, including active goals, unresolved gaps, relevant evidence when selected, user preferences when selected, upcoming commitments, recent decisions, contradictions, and included context IDs.
- Automated route tests in `src/app/api/internal/context-pack/route.test.ts`.

Constraints preserved:

- No Context Pack retrieval algorithm changes.
- No duplicated retrieval logic.
- No Python ADK service changes.

### Infrastructure Integration — Firestore Persistence

Implemented:

- Firebase Admin server-side initialization in `src/lib/firebase-admin.ts`.
- Application Default Credentials are used for Firestore access; no service-account JSON key is required.
- Firestore project targeting is configured through environment values:
  - `GOOGLE_CLOUD_PROJECT=gapwise-505217`
  - `FIRESTORE_DATABASE_ID=(default)`
- Existing `FirestoreStorageProvider` now uses Firebase Admin Firestore while preserving:
  - user-scoped `users/{userId}/...` collection layout
  - the existing storage abstraction
  - project mapper behavior
  - Golden Demo reset behavior
- Mock storage remains the default local/offline provider unless `USE_FIRESTORE=true`.
- Firestore mode fails loudly when required Google Cloud project configuration is missing.
- Standalone Google Firestore smoke test in `scripts/firestore-smoke.mjs`.
- npm script:
  - `npm run test:google:firestore`

Verified:

- Firestore smoke writes, reads, verifies, and deletes a `_smoke` document in `gapwise-505217/(default)`.
- `npm run lint`
- `npm test`
- `npm run build`

### Infrastructure Integration — Cloud Storage

Implemented:

- Google Cloud Storage bucket:
  - `gs://gapwise-505217-context`
  - location: `us-central1`
  - uniform bucket-level access enabled
  - public access prevention enforced
- Cloud Storage project/bucket configuration through environment values:
  - `GOOGLE_CLOUD_PROJECT=gapwise-505217`
  - `CLOUD_STORAGE_BUCKET=gapwise-505217-context`
- Direct dependency on the official `@google-cloud/storage` Node.js client.
- Standalone Google Cloud Storage smoke test in `scripts/storage-smoke.mjs`.
- npm script:
  - `npm run test:google:storage`

Verified:

- Smoke test creates a temporary `_smoke/*.txt` object, verifies existence, downloads exact contents, deletes it, and verifies cleanup.

Constraints preserved:

- Context Inbox uploads are not connected to Cloud Storage yet.
- No ADK, Gmail, Calendar, Drive, Firestore schema, or product UI changes.

### Context Inbox — PDF Cloud Storage Uploads

Implemented:

- PDF-only Context Inbox file upload path to Cloud Storage.
- Server-side upload route at `src/app/api/storage/assets/route.ts`.
- Upload target:
  - `gs://gapwise-505217-context/users/{userId}/sources/{sourceId}/{filename}`
- Cloud Storage helper in `src/lib/storage/gcsAssets.ts` for:
  - object path generation
  - private PDF upload
  - `gs://` parsing
  - object deletion
- Context Source metadata remains the persistence boundary:
  - original filename
  - MIME type
  - size
  - source ID
  - processing status
  - created timestamp
  - `storage_url` as the `gs://` reference
- Firestore stores the Cloud Storage reference only; PDF bytes stay in Cloud Storage.
- Discarding a PDF source keeps the private Cloud Storage object and source metadata so the context can be restored. The Context UI no longer performs destructive file deletion.
- Upload failures create a failed Context Source with a useful error message.

Constraints preserved:

- Text/excerpt ingestion still works through the existing Context Inbox flow.
- No ADK, Gmail, Calendar, Drive, Firestore schema, or overall UI architecture changes.

### Context Inbox — Server-Side PDF Analysis

Implemented:

- Server-side PDF analysis after successful Cloud Storage upload.
- Gemini integration through the existing `@google/genai` SDK with Vertex AI and Application Default Credentials.
- Central Gemini configuration in `src/lib/google/genai.ts`:
  - `GOOGLE_CLOUD_PROJECT=gapwise-505217`
  - `GOOGLE_CLOUD_LOCATION=global`
  - `GOOGLE_GENAI_USE_VERTEXAI=true`
  - `GEMINI_MODEL=gemini-2.5-flash-lite`
- Structured extraction schema in `src/lib/context/pdfAnalysis.ts` compatible with the existing Gapswise graph node model:
  - summary
  - node type
  - node text
  - confidence
- Extracted PDF nodes preserve provenance through `source_refs: [sourceId]`.
- Context Source metadata now persists:
  - extraction summary
  - derived node IDs
  - processing status
  - processed timestamp
  - model used
  - extraction hash
- Cost-control guardrail: a PDF is skipped when the source hash matches a previously successful extraction, unless `forceReprocess` is explicitly passed for development.
- Upload-analysis failures keep the private Cloud Storage reference on a failed Context Source so source deletion can clean up the object later.

Tests:

- Successful structured extraction.
- PDF source provenance on derived graph nodes.
- Duplicate/hash skip.
- Failed model call state.
- Force reprocessing.

Constraints preserved:

- Gemini is called once during PDF processing, not during every Context Pack/user question.
- Firestore remains the persistence boundary for metadata; PDF bytes remain only in Cloud Storage.
- No ADK, Gmail, Calendar, Drive, embeddings, vector databases, or new UI surfaces.

### Context Ingestion — AI Graph Updates

Implemented the real Context Inbox flow for new text, notes, images/voice descriptions,
and PDFs:

```text
Context Inbox
  -> POST /api/context/ingest
  -> load the user-scoped project or General context
  -> upload a PDF privately when applicable
  -> one structured Gemini/Vertex call using gemini-2.5-flash-lite
  -> conservative node deduplication and provenance assignment
  -> persist the updated project through the existing storage provider
  -> recalculate clarity_score and active_question
```

The server sends Gemini the new context, project goal, deadline, up to twelve
important existing graph nodes, and up to eight unresolved UNKNOWN nodes. The
structured response in `src/lib/context/contextAnalysis.ts` is:

```json
{
  "summary": "short grounded summary",
  "nodes": [
    {
      "type": "GOAL | KNOWN | CONSTRAINT | ASSUMPTION | DECISION | UNKNOWN | EVIDENCE | EXPERIMENT | RISK | NEXT_ACTION | PREFERENCE",
      "text": "concise grounded statement or question",
      "confidence": 0.0,
      "impact": 0.0,
      "why_it_matters": ["optional reason"],
      "related_node_ids": ["optional existing node id"],
      "relationship": "optional existing graph edge type"
    }
  ]
}
```

Application code adds `source_refs: [sourceId]`, `created_by: agent`, status, timestamps,
and the storage-layer `projectId`. New UNKNOWNs are capped at three per ingestion and
must share meaningful terms with the new source or project state; generic questions
such as “What should I do next?” are rejected. Duplicate nodes are matched by normalized
type and text, and an existing match receives the new source provenance instead of a
second node. Clear relationships can create existing-schema graph edges, but existing
nodes are never deleted or rewritten automatically.

Successful sources store the AI summary, model used, hash/extraction hash, and derived
node IDs. A successful source with the same hash is skipped, so unchanged context does
not call Gemini again. A development-only `forceReprocess` request bypasses that guard.
The flow makes exactly one Gemini call per new real-AI context item; PDF analysis uses
the uploaded `gs://` file in that same call. `GAPSWISE_DEMO_MODE=true` uses the existing
deterministic ingestion/fixture path and never calls Gemini.

After persistence, the existing `calculateClarityScore` formula and `selectTopGap`
function run unchanged. That refreshes the project clarity score, active highest-priority
question, Context Pack unresolved gaps, and the existing Questions/Still unclear UI.

Coverage includes explicit and inferred UNKNOWNs, generic-gap rejection, deduplication,
source provenance, project isolation, clarity refresh, unchanged-context skipping, demo
no-call behavior, endpoint persistence, and PDF `gs://` routing.

### Context Relevance and Reversible Discard

Implemented a lightweight source-level relevance signal in the same single Gemini analysis
response used for graph extraction. The response now includes:

```json
{
  "summary": "short grounded summary",
  "relevance": "relevant | possibly_not_relevant",
  "nodes": []
}
```

`relevance` is advisory only. A possibly-not-relevant source remains fully available to
the project until the user explicitly moves it to discarded context. The signal is stored
on the existing `ContextSource` and survives Firestore mapping/provider reloads.

The Context destination displays a small warning icon with the tooltip
`Is this relevant to this project?` when Gemini returns `possibly_not_relevant`.
The existing trash action now moves any source to `Discarded context`; it does not delete
the source, learned nodes, provenance, or private Cloud Storage object. Discarded sources
remain visible in the Recent view and can be restored with the restore action.

Discarded sources and nodes supported only by them are excluded from Context Pack retrieval,
attention candidates, insights, clarity recalculation, and My World summaries. Restoring a
source immediately brings its existing source-backed understanding back into those views.
Gemini never auto-discards a source.

### Ask — Direct Answers From Scoped Context

Ask keeps the selected project or Everything scope as its retrieval boundary, but does not
require a source to match the project goal before using it. The existing Context Pack
query ranks evidence against the user's actual question. Therefore a source such as
`My birthday is tomorrow.` can answer `When is my birthday?` even while the selected
project is about an unrelated topic such as green pencils.

The ADK instruction makes this contract explicit: `relevantEvidence` and
`provenanceSources` are authoritative for direct factual answers, and the agent must not
refuse solely because retrieved evidence is unrelated to the project goal. Ask continues
to expose the same source/provenance links for those answers.

The Ask client also removes repeated assistant paragraphs before rendering a response,
including duplicated refusal text emitted inside a single ADK response. As a final
deterministic guard, if ADK returns a refusal while the same question has a high-confidence
direct source match, Ask answers from that retrieved excerpt instead of repeating the
refusal. The source list and provenance links are preserved unchanged.

Ask suggestion phrasing is normalized for user-owned facts. For example, a model-generated
`When is your birthday?` suggestion becomes `When is my birthday?`, so the question is
clearly addressed to the user rather than to the Gapswise agent. An explicitly typed
`When is your birthday?` remains an AI-directed question and is not silently reinterpreted.

### PDF Ingestion Diagnosis — `gapswise_test.pdf`

Finding:

- `gapswise_test.pdf` exists in Cloud Storage at:
  - `gs://gapwise-505217-context/users/demo-user/sources/src_1786480545158_b6l4y4/gapswise_test.pdf`
- Firestore no longer has the matching Context Source for that object.
- Firestore does contain a deprecated node from the earlier source:
  - `From gapswise_test.pdf: test1`
  - no remaining source refs
- Firestore also contains a later PDF source named `test1`:
  - `processing_status=failed`
  - real `gs://` storage URL
  - `mime_type=application/pdf`
  - fallback extraction summary only
  - empty `derived_node_ids`
  - Gemini/Vertex error persisted from the failed analysis attempt

Root cause:

- The PDF upload reached Cloud Storage and Gemini was called, but no valid structured extraction was persisted.
- A live retry showed Gemini could read the PDF, but without an enum-constrained response schema it returned a node type outside the existing Gapswise graph model.
- Context Pack source ranking also indexed only `filename + content`, not `extraction_summary`, so a PDF whose user-provided content was only `test` could remain invisible even after a useful extraction summary existed.

Fix:

- Constrained Gemini's PDF extraction response schema to the existing Gapswise node type enum.
- Kept Zod validation against the existing graph schema and allowed lowercase versions of valid enum values.
- Updated Context Pack source ranking and excerpts to include `extraction_summary`.
- Added a mocked regression test proving:
  - PDF analysis creates completed source metadata
  - meaningful extracted content creates derived nodes
  - derived nodes point back to the PDF source
  - Context Pack retrieval finds the PDF by extracted PDF content
  - unchanged successful PDFs are still skipped unless `forceReprocess` is used

### Firestore Context Inbox Retrieval Diagnosis

Finding:

- The Context Inbox note `FIRESTORE TEST 001 — I want to learn more about Google ADK this week.` was persisted to real Firestore under `users/demo-user-1`.
- `/api/internal/context-pack` was being called with `userId=demo-user`, so it correctly loaded `users/demo-user`, where that source did not exist.
- The Context Pack implementation already searches raw `project.sources` through `rankSources`; retrieval and relevance filtering were working when the user ID matched.
- Ingestion also created the expected derived graph node for the note.

Fix:

- Aligned the app default demo user to `demo-user`, matching the documented API/agent contract.
- Kept `demo-user-1` selectable as a legacy demo user.
- Added a regression test proving a persisted raw Context Source containing Google ADK is retrieved by Context Pack.

### Context Pack Retrieval — Temporal Source Intent

Implemented:

- Temporal source intent detection for queries such as:
  - latest PDF
  - newest document
  - most recent note
  - last uploaded file
- When temporal source intent is detected, Context Pack source evidence now:
  - filters by requested source kind or MIME where applicable
  - selects the newest matching source timestamp
  - uses semantic relevance after temporal/source selection
- Normal semantic queries keep the previous relevance-first behavior; newer sources do not receive a global ranking boost.

Regression coverage:

- A newer `testpdf` source is selected instead of older `hackathon-rules.pdf` for:
  - `What does my latest PDF say I am trying to verify?`
- A newer unrelated source is excluded from non-temporal semantic retrieval.

### ADK Dev UI User ID Normalization

Finding:

- The ADK dev UI was calling `get_context_pack` with `user_id=default`.
- That caused the Python tool to request `/api/internal/context-pack` for the wrong Gapswise user.
- The `default` user only had the seeded Golden Demo data, so the agent kept seeing `hackathon-rules.pdf` as the latest PDF even though `demo-user` had the newer `testpdf`.

Fix:

- Added `GAPSWISE_DEFAULT_USER_ID=demo-user` to the Python ADK service environment.
- `get_context_pack` now maps ADK placeholder users (`default`, `user`, or blank) to the configured Gapswise default user.
- Explicit user IDs such as `demo-user-1` still pass through unchanged.
- Strengthened the root agent instruction to use `demo-user` for the local Gapswise demo unless a different Gapswise user ID is explicitly provided.

Verified:

- `agents-cli run "What does my latest PDF say I am trying to verify?"` calls `get_context_pack` for `demo-user`.
- The agent answers from `testpdf`, not `hackathon-rules.pdf`.

### Google Calendar OAuth Integration

Implemented:

- Google Calendar API enabled in `gapwise-505217`.
- `.env.local` is ignored by Git and stores local OAuth secrets.
- Calendar OAuth start route:
  - `src/app/api/integrations/google/calendar/start/route.ts`
- Calendar OAuth callback route:
  - `src/app/api/integrations/google/calendar/callback/route.ts`
- Server-side OAuth/token helper:
  - `src/lib/google/oauth.ts`
- Calendar tokens are stored server-side in Firestore under:
  - `users/{userId}/googleTokens/calendar`
- Calendar uses read-only scope only:
  - `https://www.googleapis.com/auth/calendar.readonly`
- Context Inbox Connected Context Calendar connect now starts the real OAuth flow.
- Calendar sync now fetches upcoming events from the user's primary Google Calendar and converts them into existing connector `ContextSource` records.

Constraints preserved:

- Existing Google Workspace UI shape remains intact.
- Gmail and Drive remain demo/read-only simulations for now.
- No Calendar write actions.
- No ADK service changes for Calendar.

Tests:

- OAuth state round-trip.
- OAuth URL generation with read-only Calendar scope.
- Real Calendar API event mapping into connector sources using a mocked Calendar client.

### Google Calendar API Diagnostic Endpoint

Implemented:

- Temporary authenticated diagnostic endpoint:
  - `GET /api/integrations/google/calendar/events?userId=demo-user`
- The endpoint reuses the stored Calendar OAuth credentials and existing Google Calendar client path.
- It queries the authenticated user's primary calendar with:
  - `timeMin=now`
  - `maxResults=10`
  - `singleEvents=true`
  - `orderBy=startTime`
- It returns safe event fields only:
  - `id`
  - `summary`
  - `description`
  - `start`
  - `end`
  - `location`
- It never returns OAuth access or refresh tokens.

Verified:

- Live local call for `demo-user` returned real upcoming Calendar events including `gapwise calendar test`.
- Context Pack, Today, ADK, Gmail, and Drive were not modified.

### Google Calendar Events in Context Pack

Implemented:

- The internal Context Pack API now enriches `upcomingCommitments` with real upcoming Google Calendar events for the requested user.
- It reuses the server-side Calendar OAuth/token code and calls `listContextPackCalendarEvents` directly instead of calling the temporary HTTP endpoint.
- Context Pack Calendar retrieval uses an actionable near-term window:
  - `timeMin=now`
  - `timeMax=now + 30 days`
  - `singleEvents=true`
  - `orderBy=startTime`
- Calendar events are mapped into the existing `ClarityNode` shape:
  - `type=NEXT_ACTION`
  - `status=OPEN`
  - event title/summary, start, end, description, and location in `text`
  - `source_refs=["gcal_{eventId}"]`
  - `why_it_matters` includes `Source: Google Calendar`, event ID, start, end, and location where present
- Ongoing and future events inside the 30-day horizon are included when `event.end > now`.
- Birthday and working-location events are excluded from commitments.
- Useful event types currently included:
  - `default`
  - `fromGmail`
  - `focusTime`
  - `outOfOffice`
- The temporary raw Calendar debug endpoint remains broader and can still show birthdays for diagnosis.
- Calendar enrichment is best-effort:
  - disconnected Calendar leaves Calendar commitments empty
  - unavailable Calendar or token refresh failure does not break Context Pack
  - OAuth tokens are never included in Context Pack output

Constraints preserved:

- Existing synchronous Context Pack builder remains available for client-side and unit-test use.
- Server-only Calendar enrichment lives in `src/lib/retrieval/contextPackServer.ts`.
- ADK, Today, Gmail, Drive, and Calendar OAuth flow were not modified.

Verified:

- Live `/api/internal/context-pack` call for `demo-user` no longer floods `upcomingCommitments` with recurring birthday events.
- Already-ended events are excluded by local `event.end > now` filtering; ongoing events remain actionable, and events more than 30 days away are excluded by `timeMax` and local horizon filtering.
- The Context Pack commitment mapper also uses `event.end > now`, so ongoing Calendar events are not dropped after retrieval.
- Today and the Attention Engine now consume real Calendar commitments only through the Context Pack:
  - the server attention route builds an enriched Context Pack before generating the brief
  - ongoing Calendar events can surface as current commitments
  - events within 2 hours receive very high urgency
  - tomorrow events can appear with lower urgency
  - unrelated events several weeks away do not crowd out important gaps
  - Calendar failures degrade to the normal non-Calendar Today brief
  - the Why drawer shows `Source: Google Calendar` with event title/time provenance

Diagnosis and fix:

- The raw Calendar endpoint is intentionally broad and may show recurring birthday events for debugging.
- Context Pack Calendar retrieval now does not use a multi-value `eventTypes` API query.
- It retrieves all primary-calendar events in the 30-day window and filters locally.
- Missing `eventType` is treated as `default`, which keeps ordinary Google Calendar events actionable.
- Development-only debug logging reports safe metadata only:
  - raw event count
  - filtered event count
  - event titles and event types
- OAuth tokens are never logged.

### Multi-Project Creation Flow

Implemented:

- Added a minimal project creation flow under:
  - `You → Projects → New project`
- Added a compact global project selector beside the Gapswise logo.
- The global selector lists all projects for the current user and includes `+ New project`.
- Normal UI continues to use the internal `demo-user` but no longer exposes that user ID or demo user switcher in the header.
- The creation form captures:
  - project name
  - goal / what the user is trying to accomplish
  - optional description/context
  - optional deadline
- New projects are deterministic local graph seeds:
  - one project metadata record
  - one active `GOAL` node derived from the goal field
  - zero sources
  - zero fabricated gaps
  - no Gemini call
- Added the project API:
  - `GET /api/projects`
  - `POST /api/projects`
- Added active project selection through:
  - `PATCH /api/projects`
- The app now loads a user-scoped project list and switches the active project after creation.
- `You → Projects` now shows selectable projects and opens the newly created project immediately.
- Switching projects persists the selected active project.

Storage changes:

- Extended the existing storage abstraction with `listProjects(userId)`.
- Extended the storage abstraction with:
  - `getActiveProjectId(userId)`
  - `setActiveProjectId(userId, projectId)`
- Project records now carry `projectId` on contexts, nodes, edges, sources, and conversations.
- `saveProject` is scoped to the project being saved instead of replacing every graph/source record for the user.
- Legacy Golden Demo records without `projectId` remain backward-compatible and attach to the default Golden Demo project.
- Firestore and mock providers both support multiple projects through the same abstraction.
- Firestore stores active project selection at:
  - `users/{userId}/preferences/app.activeProjectId`
- Browser localStorage is only a fallback for active-project selection when the project API is unavailable.

Regression coverage:

- User can create a project through `/api/projects`.
- Initial `GOAL` node persists.
- Two projects can exist for one user.
- User projects are isolated by `userId`.
- File-backed mock storage preserves projects across provider restart.
- Active project selection persists across provider restart.
- Active project selection is isolated by `userId`.
- Existing Golden Demo reset still returns the seeded demo project.

### You → Projects Management Surface

Implemented:

- Upgraded `You → Projects` from a project switcher into a project-management surface.
- Project cards now show:
  - project name
  - primary goal
  - active/archived status
  - open important gap/question count
  - source count
  - last updated label
  - `Open` action
- Active projects are grouped first.
- Archived projects appear in a separate `Archived` section only when archived projects exist.
- Empty state is present for an empty project list:
  - `No projects yet`
  - `Create a project and give Gapswise some context.`
  - `New project`
- Each project card opens the project detail view.
- Each card has a `...` actions menu:
  - `Rename`
  - `Archive`
- Permanent delete is intentionally not implemented.

Storage/model notes:

- Project status is stored as lightweight project metadata on the existing `Project`/context record.
- Existing Firestore/mock project persistence remains the architecture boundary.
- Archiving does not remove graph/source/history data.

Regression coverage:

- Project summary cards count important open questions and sources.
- Project updated labels are deterministic in tests.
- Active and archived project grouping is covered.
- Archived status persists through the storage provider without deleting the project.

### Project Detail Redesign

Implemented:

- Redesigned the active project view under `Scope` when a project is selected.
- The project now uses the tabs:
  - `Overview`
  - `Questions`
  - `Graph`
  - `Sources`
- Overview shows:
  - project goal
  - clarity score
  - highest-value unresolved question
  - recent decisions
  - source count
  - primary actions for `Add context` and `Ask Gapswise`
- Questions replaces the old gap wording with `Open questions`.
- Question cards show:
  - question
  - why it matters
  - what it affects
  - evidence checked
- Graph reuses the existing Clarity Graph component.
- Sources reuse project-associated Context Sources and show:
  - source name
  - source type
  - processing state
  - what Gapswise learned
- Project settings are now available from the header Settings destination and allow:
  - rename project
  - edit goal
  - edit description/context
  - edit deadline
  - archive project
- Permanent deletion remains intentionally absent.

Constraints preserved:

- No new backend intelligence.
- No graph rewrite.
- No persistence architecture changes.

### Top-Level Scope Refinement

Implemented:

- Reframed the top-level `Scope` destination around:
  - what Gapswise understands about the user
  - what the user is working on
- The primary sections are now:
  - `Projects`
  - `Priorities`
  - `Still unclear`
  - `My World`
- `Projects` is now the most visually prominent section on the initial Scope screen.
- `New project` remains clearly available.
- `Priorities` only displays cross-project/user priorities from durable memory.
- Project goals are no longer mixed into top-level personal priorities.
- `Still unclear` now uses a conservative user-level selector for persistent unresolved questions about the user or broader direction.
- Project-specific questions remain inside the project detail `Questions` tab.
- `What Gapswise remembers` continues to use the existing server-backed Memory UI for edit, confirm, and forget from Settings.
- `My World` is kept as an optional deeper visualization and no longer dominates the initial Scope page.

Constraints preserved:

- No memory persistence changes.
- No graph algorithm changes.
- No ADK changes.
- No Today or Calendar changes.

### Global Context Scope

Implemented:

- Replaced the user-facing globally active project model with a persisted reasoning/view scope:
  - `Everything`
  - one specific project
- Added the shared `AppScope` type in `src/types/scope.ts`.
- The header selector now shows:
  - `Everything`
  - the user's projects
  - `New project`
- Scope is applied consistently to Today, Ask, Context, and Scope.
- `Everything` is the default scope.
- A missing, deleted, or invalid project scope falls back to `Everything`.
- Creating or opening a project switches scope to that project.
- Switching back to `Everything` restores cross-project behavior.

Persistence and compatibility:

- Scope is stored in the existing user preference document:
  - `users/{userId}/preferences/app.scopeType`
  - `users/{userId}/preferences/app.scopeProjectId` when project-scoped
- Existing `activeProjectId` storage and APIs remain available for backward compatibility.
- Browser fallback uses `gapwise_scope_{userId}` only when the projects API is unavailable.
- Project records, IDs, Firestore collections, Golden Demo data, and project creation remain unchanged.

Reasoning behavior:

- `Everything` builds an in-memory merged view over all active projects plus general context. No duplicate `Everything` project is stored.
- Project scope loads the exact user-owned project and excludes nodes, sources, decisions, gaps, and conversations from other projects.
- Durable memories/preferences remain user-level and available in both scope modes.
- Calendar remains user-level. In project scope, Calendar commitments enter Context Pack only when existing title/description text is relevant to the selected project's title, goal, nodes, or sources.
- Today reuses the existing Attention Engine with the scoped project view. Its brief cache key includes the scope project/view ID so recommendations cannot leak between scopes.

Ask and ADK:

- `/api/ask` accepts an optional `projectId`.
- Project scope is stored in the existing ADK session state as `gapswise_project_id`.
- The existing `get_context_pack` ADK tool reads that state through `ToolContext` and forwards optional `projectId` to the existing Next.js Context Pack endpoint.
- No second agent, retrieval implementation, or Python-side deterministic retrieval was added.
- Ask sessions and local conversation state are separated by scope.

Context behavior:

- In `Everything`, Recent and Documents show sources across active projects and general context.
- `Add context` asks where the source belongs:
  - `General / no project`
  - one active project
- In project scope, new context is assigned to the selected project automatically.
- General context uses the existing user-scoped `nodes` and `sources` collections with no `projectId` and `scope: global`; it does not create a synthetic persisted project.
- Project context continues to persist through the existing `saveProject` mapper with its real `projectId`.
- PDF upload, Cloud Storage paths, Gemini extraction, source deletion, and provenance behavior are preserved.

You behavior:

- `Everything` keeps the global reasoning view: projects, priorities, unresolved user-level questions, and My World.
- Project scope shows the existing project detail experience directly under `ABOUT THIS PROJECT` with Overview, Questions, Graph, and Sources.
- Durable memory, Connections, account actions, and preferences are available from Settings; project configuration stays in Workspace.
- Existing project detail components and persistence actions are reused.

Regression coverage:

- Default and invalid scope resolve to `Everything`.
- Project scope persists across a file-backed provider restart.
- Everything Context Pack retrieval can use sources from multiple projects.
- Project Context Pack retrieval excludes unrelated project sources.
- Global durable memory remains available in project scope.
- Today focused on one project excludes another project's recommendation candidates.
- Ask forwards project scope to both ADK session state and sanitized Context Pack source retrieval.
- The ADK Context Pack tool forwards session project scope to Next.js.
- Project-scoped Context assignment is automatic; Everything can choose a project or general context.
- General context maps to unassigned global records in existing storage collections.
- Project creation switches scope to the new project.
- Golden Demo behavior remains intact.

Verification:

- `npm run lint`: passed.
- `npm test`: 25 files and 121 tests passed.
- `uv run pytest tests/unit tests/integration`: 12 tests passed.
- `agents-cli eval run`: 3 valid cases, 0 errors, `custom_response_quality` mean 5.0.
- `npm run build`: passed with Next.js 16.3.0; `/api/context/general` is included as a dynamic server route.
- Live runtime smoke check: `/` returned 200, persisted scope loaded as `Everything`, and an Everything Context Pack returned goals from both current projects.
- Live Firestore scope smoke check: switched `demo-user` to project `test1`, reloaded the project state and confirmed the project scope persisted, then restored the canonical scope to `Everything`.

### Ask Markdown Rendering

Implemented:

- Ask assistant responses now render Markdown instead of displaying Markdown punctuation as plain text.
- Added `react-markdown` with `remark-gfm` for GitHub-flavored Markdown support.
- Styled headings, paragraphs, ordered and unordered lists, emphasis, blockquotes, links, inline code, fenced code blocks, tables, and horizontal rules for the existing dark Gapswise chat UI.
- Code blocks and tables scroll horizontally on narrow screens instead of overflowing the message bubble.
- External links open in a new tab with `noopener`/`noreferrer` protection.
- Raw HTML from agent output remains disabled and is never injected into the page.
- User messages remain plain text so user input is shown exactly as entered.

Regression coverage:

- Common agent Markdown renders into structured HTML.
- Raw HTML and scripts from agent responses are not rendered.

### Ask Provenance Links

Implemented:

- Ask responses now receive deterministic, numbered provenance citations for supported claims.
- Citation matching uses stored Context Pack evidence and graph provenance. It does not ask Gemini to invent source links.
- Context Pack now returns `provenanceSources` for every selected goal, gap, decision, assumption, or risk that has source references.
- Each provenance source records the graph statements it supports.
- Ask source coverage also includes:
  - graph records that do not yet have an underlying source
  - durable memories used in the answer
  - Google Calendar commitments
- Every assistant response with provenance displays compact source links beneath the answer, even when no inline block match is confident enough for automatic citation placement.
- Clicking a numbered citation or source link opens a focused explanation with:
  - source title
  - supporting excerpt
  - relevance score when available
  - the exact stored statement or reason supporting the answer
- `View in Context` navigates to the cited source, promotes older cited sources into the Recent list when necessary, scrolls to the source, and highlights it.
- Calendar provenance navigates to Settings Connections.
- Graph provenance navigates to Scope; memory provenance navigates to Settings.
- Existing `Why / Sources` remains available as the complete provenance drawer.

Regression coverage:

- The Clarity Graph interface-assumption example receives a citation to its supporting source.
- Unrelated content is not assigned a citation.
- Citations are not inserted inside fenced code blocks.
- Internal source links render as interactive source controls.
- Context Pack preserves the source-to-graph-statement support relationship.

### Answer to Understanding

Implemented:

- Today and You now share a focused answer flow for persisted open questions and important assumptions.
- `POST /api/questions/answer` validates `userId`, `nodeId`, the answer, and optional project scope with Zod.
- The server locates the exact user-scoped project that owns the node; answering from Everything scope does not assume the currently selected project owns it.
- Only open `UNKNOWN` and `ASSUMPTION` records can be answered. Missing, cross-project, and already-resolved records are rejected.
- Answers reuse the existing deterministic `resolveGap` graph update:
  - the original record becomes resolved
  - a user-created `DECISION` records the explicit answer
  - a `resolves` edge connects the answer to the original question
  - project history preserves the question, answer, timestamp, and graph change summary
  - clarity and the next active question are recalculated
- Firestore and mock node mapping now preserve `created_by`, so direct user-answer provenance survives reloads.
- After a successful answer, the modal confirms that Gapswise updated its understanding and Today refreshes from the changed context.
- The existing I-don't-know strategy remains available when the answered item is the selected project's active question.
- Live Calendar preparation prompts remain conversational and are not converted into durable graph answers.

Regression coverage:

- The exact owning project is updated from Everything scope.
- Project scope cannot resolve a node from another project.
- Already-resolved questions reject duplicate answers.
- Empty API answers are rejected before storage is called.
- Resolved state, answer history, and user provenance survive a file-backed provider restart.

### Zero-Cost Local Demo Mode

Enable with:

```env
GAPSWISE_DEMO_MODE=true
USE_FIRESTORE=false
```

Architecture and safety:

- `src/lib/runtime/demoMode.ts` is the single policy helper for detecting demo mode and rejecting external-service access.
- Demo mode always selects the existing file-backed `MockStorageProvider`, even if `USE_FIRESTORE` is accidentally set to `true`.
- Low-level Firestore, Cloud Storage, Vertex/Gemini, Google OAuth, Google Calendar, and ADK adapters independently reject calls while demo mode is active.
- Routes select deterministic local adapters before invoking any external client. A failed local fixture never falls back to a real Google service.
- The real Firestore, Cloud Storage, Gemini PDF, Calendar OAuth/API, Context Pack, and ADK implementations remain intact for real mode.

Fixtures:

- Central fixtures live in `src/lib/demo/localFixtures.ts`.
- The local seed includes the Gapswise Hackathon and Job Search projects, project-specific sources and questions, two upcoming Calendar events, and deterministic PDF extraction.
- The default durable-memory seed contains a concise-answer preference and a cross-project priority to ship Gapswise before expanding the job search.

Behavior:

- Projects, scope, graph updates, context, memories, question answers, rename/archive, and other existing workflows persist in `.gapwise-data/mock-storage.json` through the mock provider. `GAPSWISE_MOCK_STORAGE_PATH` can select an isolated file for smoke tests.
- Text and note ingestion use the normal deterministic ingestion path.
- PDF upload stores only a `local-demo://` metadata URL and uses fixture extraction. It does not retain PDF bytes, upload to GCS, or call Gemini.
- Calendar fixtures enter the existing Context Pack and Attention Engine. Today does not have a separate demo implementation.
- Ask builds the real scoped Context Pack in-process and returns deterministic Markdown with the existing source/provenance UI. It never starts an ADK session or records fake ADK traces.
- If local persisted context is temporarily unreadable, demo Ask falls back to the centralized scoped fixtures and still returns a useful response; it never falls through to ADK.
- Project-scoped Ask receives only that project's loaded context; Everything uses the existing merged scope.
- Calendar connection status and refresh are local fixtures; OAuth start/callback and token storage are blocked.
- A subtle `Demo mode` badge appears in the header in development only.

### Context Source Details

Context Recent and Documents cards are clickable. Selecting a source opens a detail view with:

- source name, type, scope, origin, status, MIME type, and size
- added and processed timestamps
- the complete stored summary and original text/content
- learned graph statements with type, confidence, and why they matter
- private storage reference, analysis model, file fingerprint, and any processing error when available

The detail view resolves learned statements from the current scoped project/context data and does not expose raw derived node IDs in the user-facing view. Deleting a source remains a separate action and does not accidentally open the detail view.

Regression coverage explicitly verifies:

- Demo mode forces mock storage and blocks direct Firestore access.
- Injected GCS, Gemini, Calendar, and ADK clients are never invoked.
- Demo PDF route returns fixture extraction without GCS or Gemini.
- Demo Calendar reaches Context Pack and Today through existing interfaces.
- Deterministic project Ask does not leak another project's context.
- A file-backed workflow preserves two projects, project scope, local Context, durable memory, and answered-question state across provider restart.
- Global `scope: global` records remain isolated from Golden Demo compatibility records and survive later project updates in both storage providers.

### Real Cloud AI and Cost Configuration

The local Gapswise environment is now configured for the real Google Cloud path:

```env
GAPSWISE_DEMO_MODE=false
USE_FIRESTORE=true
GOOGLE_CLOUD_PROJECT=gapwise-505217
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_USE_VERTEXAI=true
GEMINI_MODEL=gemini-2.5-flash-lite
```

The Next.js app and `agent-service/` have separate environment files, so both now
set `GEMINI_MODEL=gemini-2.5-flash-lite`. The ADK agent reads this value instead of
hardcoding a model and falls back to the same low-cost model if the variable is
missing or blank.

Authentication continues to use Google Application Default Credentials. No API
key or service-account JSON file was added. LLM-as-judge evaluations use the
separate `GEMINI_EVAL_MODEL` setting and now default to Flash-Lite as well; a more
capable judge must be selected explicitly when its additional cost is justified.

The August 2026 billing review reported 6.87 MXN total Vertex/Agent Platform spend,
including 6.77 MXN categorized as an unattributed model. The code now avoids moving
`latest` aliases and names `gemini-2.5-flash-lite` explicitly in the Next.js Gemini
adapter, ADK runtime, agent metadata, and evaluation configuration. Cloud Audit Logs
did not contain Vertex data-access entries for the reviewed period, so historical
unattributed calls could not be mapped back to individual model requests from logs.

Current standard global list pricing is $0.10 per million input tokens and $0.40
per million output tokens. The model supports the ADK function-calling path and the
structured PDF extraction path, but Google lists October 20, 2026 as its retirement
date. The configured model must be reviewed before that date.

Verification:

- `npm run lint`: passed.
- `npm test`: 32 files and 145 tests passed.
- `GAPSWISE_DEMO_MODE=true USE_FIRESTORE=false npm run build`: passed with Next.js 16.3.0.
- An isolated live server using `GAPSWISE_MOCK_STORAGE_PATH=/tmp/gapwise-zero-cost-smoke-3.json` verified:
  - both fixture projects load
  - a third project can be created and selected
  - selected scope survives reload
  - general text context persists without leaking into a project
  - durable memory persists
  - answering a question resolves the stored node
  - project-scoped Ask uses the selected local project and a `demo_` session
  - Today returns five recommendations and includes `Gapswise Demo Review`
  - PDF upload returns a `local-demo://` URL, `demo-fixture-v1`, and two derived fixture nodes

---

## 4. Current App Screens

- **Global workspace selector**: chooses Everything or one project and consistently controls Today, Ask, Context, and Workspace.
- **Today**: one ranked attention feed of questions/actions/decisions plus compact near-term commitments in the selected scope.
- **Ask**: conversational Gapswise surface backed by the real Google ADK service and scope-aware Context Pack integration.
- **Context**: scope-aware source area organized into Recent, Documents, and Add context.
- **Workspace**: global understanding in Everything, or the selected project's focused understanding surface.
- **Workspace > Projects**: project-management surface with active and archived sections, project cards, New project, Rename, Archive, and project detail tabs.
- **Project**: active project workspace under Workspace with Overview, Questions, Graph, and Sources.
- **Settings**: Connections, durable memory, preferences, and account/sign-out configuration.
- **My World**: high-level cross-context map of domains, projects, sources, gaps, risks, and preferences, currently available under Workspace.
- **Clarity Graph**: project-level graph of goals, knowns, constraints, assumptions, decisions, risks, unknowns, evidence, experiments, next actions, and preferences, currently available under Workspace > Graph.
- **Context Add context**: universal context capture with source metadata and provenance, currently available under Context.
- **Connections**: read-only connected-account status inside Settings. Google Calendar uses real OAuth; Gmail and Google Drive are shown as not connected unless implemented later.
- **Memory**: editable profile preferences plus durable memory bank with edit/forget/confirm/why controls, currently available under Settings.
- **Insights Panel**: compact review surface for loose ends, possible context changes, and stale context. The component remains available for future relocation.
- **Feedback Controls**: reusable controls on recommendations that persist feedback history and adapt future behavior.

---

## 5. Verification

Current expected commands:

```bash
npm run lint
npm test
npm run build
```

Notes:

- `npm run lint` currently delegates to source-only TypeScript checking through `tsconfig.typecheck.json`.
- `npm run build` uses webpack because Turbopack hit an internal panic with server SDK externals. Webpack production builds pass.
- npm audit currently reports transitive dependency findings. No force upgrade has been applied because that could destabilize the milestone baseline.
- Current test count should be verified with `npm test` after each milestone; PDF analysis adds focused mocked Gemini coverage and does not call Vertex AI during normal tests.

---

## 6. How to Run

```bash
cd /home/martelaxe/gapwise
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

### Contextual Ask Suggestions

Ask no longer uses a fixed list of recommended questions. When the Ask screen
opens, it requests six questions for the current scope, split into two groups:

- `top_questions`: the three highest-value questions, ranked by urgency, impact,
  goal alignment, actionability, and confidence.
- `other_questions`: three useful but less urgent or exploratory ideas.

- Everything sends the merged active-project and global context to the existing
  `gapswise_agent`.
- A selected project sends that project ID through the existing ADK session state,
  so the agent's `get_context_pack` call is project-scoped.
- The agent must call `get_context_pack` before generating the questions and return
  the small JSON question contract used by the UI.

The server endpoint is `POST /api/ask/suggestions`. It reuses the existing Ask
ADK client and does not create another agent or conversation architecture. The UI
shows the top three as prominent actions and the other three as a quieter
secondary group. It also shows a loading state while questions are generated and
lets the user continue typing if the agent is unavailable.

Zero-cost demo mode uses the already loaded local Context Pack instead of Gemini.
Its deterministic fallback remains scope-aware: for travel context it can surface
missing trip cost/logistics, while project goals, unresolved gaps, commitments, and
memories shape other questions. Tests cover strict JSON output, non-strict model
output, project scope propagation, Everything scope, and demo behavior.

The suggestion parser also tolerates ADK's streamed partial JSON fragments,
minor unescaped quotation marks inside model-generated question text, and the
previous flat `questions` response shape. This keeps a valid agent response from
being lost merely because the model did not serialize it perfectly.

Suggestions use a scoped broad-context retrieval flag. This lets the suggestion
Context Pack include recent supplied sources and their original content even when a
generic exploratory query has no keyword match. Normal user retrieval keeps its
existing semantic filtering, so unrelated sources are not added to ordinary Ask
answers. Connector notes such as Calendar events remain in their existing
upcoming-commitments path instead of flooding broad source evidence.

## 7. Firebase Authentication

The application now supports Google sign-in through Firebase Authentication.

- `src/lib/auth/client.ts` initializes the Firebase Web SDK from
  `NEXT_PUBLIC_FIREBASE_*` configuration, signs users in with Google through
  Firebase's redirect flow, attaches the current Firebase ID token to API
  requests, and signs users out. Redirect avoids cross-origin popup cleanup
  warnings and works better on mobile browsers.
- `src/components/AuthProvider.tsx` loads the runtime mode, exposes the
  authenticated UID to the app, and keeps the existing local `demo-user` only
  when `GAPSWISE_DEMO_MODE=true`.
- `src/components/LoginScreen.tsx` is shown in real mode until a user signs in.
- `src/lib/auth/server.ts` verifies Firebase ID tokens with Firebase Admin and
  derives the server-side `userId` from the verified `uid`. A client-supplied
  user ID can only be used as a consistency check and cannot select another
  user's data.
- User-scoped storage remains under the existing `users/{userId}/...` paths;
  no `demo-user` data is migrated automatically.
- Authenticated users with no projects now remain empty in the `Everything`
  scope and are prompted to create their first project. The reserved
  `hackathon_demo` fixture is excluded outside explicit demo mode, including
  copies written by the earlier first-user bootstrap.
- Golden Demo seeding and reset controls are available only when
  `GAPSWISE_DEMO_MODE=true`; real Firebase users never silently fall back to
  demo project data when Firestore is empty or temporarily unavailable.
- The trusted ADK service may call the internal Context Pack route using the
  shared `GAPSWISE_INTERNAL_API_SECRET`. This secret is server-only and is not
  a browser credential.
- Calendar OAuth remains separate. Calendar OAuth start is authenticated by
  the signed-in Firebase session, then its existing OAuth state/callback flow
  stores Calendar tokens separately under the verified UID.

Real-mode setup:

1. Enable Google under Firebase Console → Authentication → Sign-in method.
2. Add `localhost` and the deployed host to Firebase authorized domains.
3. Create a Firebase Web App and copy its public configuration to
   `.env.local` using `.env.example`.
4. Set the same random `GAPSWISE_INTERNAL_API_SECRET` in the Next.js and
   `agent-service/.env` files.
5. Start Next.js and the ADK service, then open `http://localhost:3000`.

The route tests use an explicit test-only identity fallback so existing route
tests do not require live Firebase credentials. Deployed environments always
require a verified Firebase ID token or the private server-to-server secret.

## 8. Cloud Run Staging

Staging is deployed in Google Cloud project `gapwise-505217`, region
`us-central1`, with both services configured for minimum instances `0`:

- Public web service: `gapswise-web`
- Private ADK service: `gapswise-agent`
- Web URL: `https://gapswise-web-r3zqs7f2gq-uc.a.run.app`
- Agent URL: `https://gapswise-agent-r3zqs7f2gq-uc.a.run.app`

The web service runs with the dedicated
`gapswise-web-runtime@gapwise-505217.iam.gserviceaccount.com` identity. It
uses ADC for Firestore, Cloud Storage, and Vertex AI, and reads the internal
API secret and Calendar OAuth client secret from Secret Manager. The agent
uses `gapswise-agent-runtime@gapwise-505217.iam.gserviceaccount.com` and is
not publicly invokable.

The web runtime is the only principal granted `roles/run.invoker` on the
agent. When `GAPSWISE_AGENT_AUTH=true`, the server-side Ask client obtains a
Google-signed identity token for the private agent URL. The agent then calls
the web Context Pack route with `GAPSWISE_INTERNAL_API_SECRET`. The verified
Firebase UID and selected project ID remain in the ADK session/request, so
real staging calls are never normalized to `demo-user`.

Staging runtime values include:

- `GAPSWISE_DEMO_MODE=false`
- `USE_FIRESTORE=true`
- `GOOGLE_CLOUD_PROJECT=gapwise-505217`
- `GOOGLE_CLOUD_LOCATION=global`
- `GEMINI_MODEL=gemini-2.5-flash-lite`
- `CLOUD_STORAGE_BUCKET=gapwise-505217-context`
- `GAPSWISE_AGENT_AUTH=true`

The public staging Calendar callback is:

`https://gapswise.web.app/api/integrations/google/calendar/callback`

That exact URI must also be listed under the existing Google OAuth Web Client
in Google Cloud Console → APIs & Services → Credentials. The existing
localhost callback remains configured for local development.

Firebase Authentication authorized domains include both Cloud Run hostnames:

- `gapswise-web-r3zqs7f2gq-uc.a.run.app`
- `gapswise-web-782439096411.us-central1.run.app`

The Firebase Hosting frontend hostname must also be authorized:

- `gapswise.web.app`

Authorized domains contain only hostnames, without `https://`, paths, or a
trailing slash.

Local demo mode remains independent: set `GAPSWISE_DEMO_MODE=true` and
`USE_FIRESTORE=false`; it does not require Firebase login or Cloud Run.

### Production configuration boundary

Production configuration is deployed through the checked-in `cloudbuild.yaml`.
It contains no secret values. Firebase browser configuration and the OAuth
client ID are supplied as Cloud Build substitutions because Next.js inlines
`NEXT_PUBLIC_*` values during the browser build. The internal API secret and
Google OAuth client secret are referenced from Secret Manager using
`--set-secrets`; their values never enter the repository, Docker build context,
image arguments, or browser bundle.

Cloud Run uses `gapswise-web-runtime` and `gapswise-agent-runtime` service
identities with Application Default Credentials for Google APIs. No
`GOOGLE_APPLICATION_CREDENTIALS` path or service-account JSON file is used in
staging. `.env.local` and `agent-service/.env` remain local-development-only
files and are ignored by Git, Docker, and Cloud Build upload contexts.

The existing `roles/run.invoker` binding from the web runtime identity to the
private agent is preserved during deployment. The Cloud Build runtime does not
need permission to change IAM policy for every release.

### Firebase Hosting frontend

Firebase Hosting site `gapswise` is deployed in project `gapwise-505217`:

- Public URL: `https://gapswise.web.app`
- Hosting configuration: `firebase.json`
- Firebase project mapping: `.firebaserc`
- Live Hosting version: `1bf889afccd62146`

All Hosting routes rewrite to the existing `gapswise-web` Cloud Run service in
`us-central1`. The Next.js app remains on Cloud Run, and `gapswise-agent`
remains private. `GAPSWISE_APP_URL` continues to use the Cloud Run URL for the
internal agent-to-web Context Pack call; only the public Calendar OAuth
redirect uses the Hosting URL.

The root document is explicitly `no-store` at both Next.js and Firebase
Hosting, so a new Cloud Run revision is picked up at the normal
`https://gapswise.web.app` URL without a cache-busting query parameter. Hashed
`_next/static` assets remain cacheable and immutable.

### Billing budget alert

The Google Cloud Billing Budgets API is enabled for `gapwise-505217`. A
project-scoped monthly alert named `Gapswise monthly alert (50 MXN)` tracks only
this project and not the rest of the billing account. Notifications are sent
at 50%, 90%, 100%, and 150% of the 50 MXN threshold through the billing
account's default recipients. This is an alert only; it does not automatically
stop Cloud Run, Vertex AI, Firestore, Storage, or other billable services.

## 9. Authenticated User Demo Bootstrap

Authenticated users start with a clean project list. The application does not
copy, migrate, or expose the `demo-user` account automatically. When a signed-in
user has no projects, the first-login empty state offers:

- `Create project` — opens the normal single-step project form.
- `Load demo` — explicitly copies the reusable Golden Demo project into that
  user's own `users/{uid}/contexts`, `nodes`, `edges`, `sources`, and related
  storage collections.

The demo load endpoint is `POST /api/projects/demo` and uses the verified
Firebase identity. It seeds the canonical `hackathon_demo` project from
`src/lib/demo/seed.ts`, sets that user's scope to the seeded project, and never
writes to `demo-user`. The canonical project ID makes the operation idempotent:
repeated clicks return the existing user-owned project rather than creating a
second copy or overwriting the user's edits.

Users who already have one or more projects bypass this empty state. Local
`GAPSWISE_DEMO_MODE=true` remains separate and continues to use the local demo
fixtures and reset behavior for development and presentations.

## 10. Responsive Mobile/PWA Surface

The web app keeps one responsive implementation for desktop and phone widths.
The existing desktop header, navigation, project layouts, cards, and breakpoints
remain the primary layout above the mobile breakpoint.

Phone-width behavior is additive:

- `Today`, `Ask`, `Context`, and `Scope` use the existing fixed bottom navigation
  only below the desktop breakpoint.
- The page reserves space for the bottom navigation and the device safe-area
  inset, so content and the Ask composer are not covered by phone browser chrome.
- Ask, Context source details, and Today/You explanations become viewport-sized
  bottom sheets on narrow screens and retain side-panel/modal behavior on larger
  screens.
- Context tabs and graph filters use touch-friendly horizontal scrolling instead
  of widening the page. Source actions, project menus, forms, and key controls
  have larger phone tap targets.
- Today, Ask, Context, Scope, Settings, Memory, My World, the Clarity Graph, and the legacy
  project view use narrower mobile padding while preserving their desktop
  multi-column layouts.
- `touch-scroll` hides scrollbar chrome without disabling horizontal scrolling.

No authentication, scope, graph, AI, storage, Calendar, or deployment behavior
was changed for this responsive pass. Desktop/browser-width verification is
covered by the typecheck and production build; no browser automation dependency
is currently installed in the repository.

## 11. Workspace and Settings Navigation

The primary application destinations are now:

- `Today`: what deserves attention now.
- `Ask`: conversation with Gapswise.
- `Context`: sources and context capture supplied to Gapswise.
- `Workspace`: the current reasoning/view boundary.

The header workspace selector continues to offer `Everything`, individual
projects, and `New project`. The selected internal scope still controls Today,
Ask, Context, and Workspace behavior, while stored entities remain named
`Project` internally.

When `Everything` is selected, Workspace exposes:

- Projects
- Priorities supported by durable memory
- Still unclear user/cross-project questions
- My World

When a project is selected, Workspace exposes the existing project workspace with:

- Overview
- Questions
- Graph
- Sources

Project configuration is no longer a project workspace tab. The header gear
opens Settings, which contains:

- Connections, including the existing Google Calendar OAuth integration
- What Gapswise remembers and durable memory actions
- Preferences and personalization controls
- Account and sign out

Project name, goal, description, deadline, and archive controls remain in the
selected project's Workspace edit modal.

Context now contains only Recent, Documents, and Add context. Connected account
status and sync controls are available from Settings instead. Existing source
ingestion, project persistence, scope persistence, Calendar OAuth, and backend
contracts are unchanged.

## 11. Graph Reconciliation During Context Ingestion

Real-AI context ingestion now performs one structured Gemini analysis for each
new, changed context item. The prompt receives the project goal, a compact set
of important nodes, unresolved gaps, and their existing edges. Gemini can return
source-backed nodes plus conservative relationships using:

- `supports`
- `contradicts`
- `supersedes`
- `resolves`
- `depends_on`
- `blocks`
- `affects`
- `informs`
- `derived_from`

Relationship output uses a returned-node index for the new source nodes and an
existing node ID, or `new:<index>` for another node in the same response. Only
relationships with confidence at least `0.6` and valid project-local endpoints
are persisted. Unknown-question filtering keeps the relationship indexes aligned
when generic or duplicate questions are rejected.

Ingestion preserves graph history. Reprocessing a source retains its previous
derived nodes and marks them `DEPRECATED`; they remain visible in the graph but
are excluded from normal reasoning. `contradicts` marks older knowns,
assumptions, decisions, or evidence as `DEFERRED` and records why. `supersedes`
marks the older node stale, while `resolves` marks an existing unknown or
assumption resolved. All affected nodes retain provenance to the newer source.

The existing `Project.edges` representation remains the canonical graph. Edges
are persisted in Firestore and the mock provider, including global edges used by
the Everything scope. Global edge records use `scope: global`; project edges use
`scope: project`, preserving user and project isolation.

Project Questions, Today questions, and the Clarity Graph explain relationship
paths in user-facing language such as `Blocks: "Which hotels should I book?"`,
`Resolved by`, `Contradicted by`, or `Affected by`. The Clarity Score formula was
not changed. Demo mode remains deterministic and does not call Gemini.

## 12. Decision Map and Constellation Graph Visualization

The project Graph tab now defaults to a lazy-loaded interactive 2D Decision
Map. It is a visualization layer over the existing `Project.nodes` and
`Project.edges` only; it does not change graph reasoning, Gemini prompts,
persistence, scope, or provenance.

- `2D` uses deterministic semantic lanes: evidence/known, assumptions/risks,
  open questions, decisions/actions, and the primary goal. Isolated preferences
  and unconnected known/evidence records move to a quieter side area.
- Decision Map edges use arrows for direction, labels for meaningful
  relationships, stronger styling for important relationships, and wrapped
  node cards to keep statements readable.
- Clicking a node focuses its connected reasoning path and opens the existing
  details/provenance panel. `Focus path` isolates the path toward a goal, and
  the map includes pan, zoom, fit-to-view, and node dragging controls.
- `3D` remains optional and uses Three.js with orbit, zoom, and node dragging
  controls.
- Hovering emphasizes connected paths. Selecting a node can focus its
  neighborhood or open a Decision Path toward a project goal.
- The detail panel shows type, statement, status, confidence, relationships,
  why it matters, and clickable supporting sources that open Context details.
- `Readable view` preserves the existing card/SVG graph fallback.
- The graph has a full-screen control for larger exploration. The modal keeps
  the current 2D/3D mode, filters, selected node, focus mode, and decision path;
  it closes with the minimize/close controls or `Escape`.

The layout and decision-path helpers live in `src/lib/graph/constellation.ts`
and are deterministic so graph movement is stable between renders. Heavy 3D
dependencies are loaded only when the Graph tab is rendered.

### Decision Map Stability Pass

The 2D map now renders its grid, semantic lanes, cards, edges, labels, and
secondary context inside one shared pan/zoom transform. Normal page scrolling
does not move or re-layout graph elements, and the map does not auto-fit on
ordinary resize events.

Shared metrics keep lane centers, row spacing, card dimensions, and the SVG
viewBox aligned. Cards wrap several readable lines, edge paths leave card
boundaries, parallel relationship labels are separated and backgrounded, and
weak edges are visually quiet. Selecting a node continues to fade unrelated
content and emphasize the existing neighborhood or goal path.

Disconnected preferences, knowns, and evidence are available through a compact
collapsible `Other context (N)` area instead of a large permanent side panel.
Graph data, reasoning, persistence, provenance, scope, and the optional 3D
view remain unchanged.

## 13. Answered Questions History

The project Scope > Questions view keeps open questions and previously answered
questions separate. The answered section reads the existing persisted
`Project.history` records, so it shows the original question, the user's answer,
the answer date, and the graph-change summary when available. It displays every
record for the selected project, newest first, without creating a second history
store or changing resolved-node behavior.

Answered question cards also provide `Edit answer`. Editing uses
`PATCH /api/questions/answer` with the existing project and history timestamp,
updates the matching persisted answer record, and updates the linked user-created
`DECISION` node in place. This prevents old and new answers from competing in
the project graph. The same clarity recalculation and project persistence path
used by normal question answers runs after an edit.

Today question cards now request one structured AI answer-suggestion response
for the visible unresolved questions (up to three) through the existing ADK and
Context Pack flow. Each suggestion contains an evidence-aware draft answer and
a project-specific explanation of why the question matters. When evidence is
missing, the model must say what is missing rather than inventing an answer.
Demo mode and temporary agent failures retain a cautious deterministic fallback
without inventing context. Agent failures on this optional enrichment endpoint
return HTTP 200 with `generatedBy: local-fallback` and a warning, so Today does
not become unusable merely because the ADK service is offline. Server logs retain
the failure stage (`agent-auth`, `agent-unavailable`, `context-pack`, or
`gemini`) for diagnosis. Real AI mode still uses the ADK when it is available.

The Ask screen's contextual prompt endpoint follows the same resilience rule:
when ADK is unavailable, it returns the existing Context Pack-derived local
suggestions as `generatedBy: local-fallback` with a visible warning instead of
turning the prompt area into a `502`. This fallback does not claim to be a
Gemini response and does not replace the real Ask conversation path.

The project Scope overview now includes the existing project edit panel for
name, goal, description, deadline, and archive controls. The overview no
longer includes separate Recent decisions or Primary actions panels; decisions
remain available through Questions and Graph, while capture and Ask remain in
their top-level destinations.

## 14. Question Decision-Value Explanations

The Today `Why?` action is a trust layer over the existing project graph. It
uses `src/lib/questions/whyQuestion.ts` to translate stored `blocks`,
`depends_on`, `affects`, `supports`, `contradicts`, `supersedes`, `resolves`,
and related path relationships into five user-facing areas: why the question
matters, what it blocks, what Gapswise already knows, what could change after
an answer, and the two-to-four most relevant named evidence sources. It does
not call Gemini or create another explanation store.

Evidence cards use source filenames/titles and short original excerpts rather
than internal source IDs. Clicking a named source opens the existing Context
source detail view. When a question has a connected path to a project goal,
`View reasoning path` opens the project Scope graph with the question selected,
its neighborhood focused, and its goal path highlighted. When the graph lacks
enough information, the explanation states that directly instead of inventing
decision impact.

## 15. Today Primary Attention Feed

Today now presents one primary ranked feed. It keeps the Attention Engine's
internal scores and ranking but does not expose score numbers, signal counts, or
generic internal titles. `src/lib/today/feed.ts` translates each ranked item to
one of four user-facing types: `QUESTION`, `ACTION`, `DECISION`, or `REMINDER`.

Gap-backed recommendations use the underlying question as their title and are
not repeated in a second Questions section. Duplicate candidates sharing the
same underlying gap/action node are collapsed at the presentation boundary.
Question cards use `Answer`, `Why?`, and `Not now`; action, decision, and reminder
cards use `Done`, `Why?`, and `Not now`. Secondary feedback is inside the
overflow menu. AI answer text is shown only when the real agent returns a
specific evidence-supported answer; generic missing-context fallbacks remain
hidden while the question itself stays visible.

## 16. Workspace Navigation and Project Overview

The primary user-facing destination previously called `Scope` is now labeled
`Workspace`. The navigation is `Today`, `Ask`, `Context`, and `Workspace`, while
the existing `AppScope` type, persisted scope values, project storage, and scope
propagation remain unchanged internally. The header selector still offers
`Everything` and the user's project names, so Workspace is the place where the
selected context is viewed and worked on rather than a new data model.

When a project is selected, its Workspace header shows the project name, goal,
optional deadline, and an `Edit project` action. Overview now opens with a
compact `Current picture` section built synchronously from existing graph nodes
and relationships. It uses stored blockers, impacts, contradictions,
dependencies, unresolved questions, decisions, constraints, and knowns; it does
not make a Gemini call or add another summary store. Internal clarity scores and
source-count metrics remain available to ranking and other product logic but are
no longer prominent Overview or header content.

Project editing uses the shared `ProjectSettingsPanel` in a modal. It edits the
existing name, goal, description, and deadline fields, persists through the
existing project update API, and keeps Archive project separated at the bottom.
The modal is reachable from the selected project's Workspace header; Settings
does not expose project configuration.

## 17. User-Level Settings Only

Settings now contains only account-level configuration, ordered as:

1. Connections, with the existing Google Calendar OAuth flow and unavailable
   Gmail/Drive states.
2. What Gapswise remembers, using the existing durable-memory create, edit,
   confirm, forget, and provenance behavior.
3. Preferences, using the existing personalization controls and explanation
   surface.
4. Account, with the signed-in account and sign-out action.

Project name, goal, description, deadline, and archive controls were removed
from Settings. Project editing is available only from the selected project in
Workspace through its shared `Edit project` modal. No OAuth, storage, memory,
or project persistence behavior changed.

## 18. Stable Decision Map Interaction

The 2D graph is a deterministic Decision Map and now keeps one stable SVG
coordinate system for lane backgrounds, relationships, labels, and node cards.
Normal wheel or trackpad scrolling is allowed to scroll the page and does not
zoom the map. Intentional desktop zoom is available through the visible `+`
and `-` controls, with a bounded zoom range, a percentage reset control, and a
Fit action. Ctrl/Cmd plus wheel remains available for users who prefer a
keyboard-assisted zoom gesture.

Dragging the empty map background pans the map. Clicking a node selects it and
opens its existing details/provenance behavior. Nodes cannot be repositioned
accidentally; the explicit `Arrange` mode must be enabled first. The same
guard applies to the optional 3D view. Focus paths, node details, page scroll,
and ordinary resize events do not automatically fit or re-layout the current
viewport. The graph instructions now describe the intentional controls rather
than suggesting that ordinary scrolling zooms the page.

## 19. Decision Workspace

`src/lib/decisions/workspace.ts` builds a focused decision view from existing
project nodes, directed relationships, source provenance, and stored history.
It can be opened from Today decision cards, a project question that blocks a
decision, and the selected DECISION node in the graph. The view shows the
decision, explicit options when the graph or related sources record them,
supporting evidence, constraints, assumptions, risks, remaining blockers, and
named sources. It only shows a recommendation when at least two explicit
options have source-backed evidence with a measurable confidence difference;
otherwise it explains what is still missing.

Confirming a decision updates the existing DECISION node rather than creating a
duplicate. It preserves source references, adds only existing support
relationships that are explicitly `supports` or `informs`, records a history
entry, recalculates the existing clarity score, and refreshes the active gap.
The user can explicitly mark connected UNKNOWN or ASSUMPTION records resolved;
that creates a `resolves` relationship and preserves the old record. The page
persists project decisions through the existing project storage path, while
user-level decisions use the existing general-context persistence path.
