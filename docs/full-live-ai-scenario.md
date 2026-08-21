# Full Gapwise live-AI scenario

This is one complete acceptance journey for understanding what Gapwise currently does. It deliberately separates deterministic product mechanics from live AI intelligence.

## What this scenario covers

- Localhost without login
- Career Demo reset and project isolation
- Today reminders, Open Questions, Coming Up, hidden items, and resolved items
- Resolve, source inspection, Decision Map navigation, `I don't know yet`, defer, and unresolve
- Multiple project chats, draft creation, timestamp/title behavior, deletion, suggestion hiding, and response details
- Context ingestion, duplicate prevention, graph extraction, source provenance, and project-scoped retrieval
- Live Gap Agent selection, grounded recommendation, reranking, sanitized traces, model configuration, latency, and token reporting
- Deterministic fallback labeling

The ClinicFlow sources are fixed test inputs, but their extracted graph, selected gap, and recommendation are not hardcoded into the product.

## Before starting

Use two terminals.

Terminal 1:

```bash
cd /home/martelaxe/gapwise
npm run dev:ai
```

Wait for:

```text
Gapwise is ready with live AI.
Mode: live · gemini-3.5-flash-lite · low thinking
```

Terminal 2:

```bash
cd /home/martelaxe/gapwise
CONFIRM_LIVE_AI_COST=true npm run scenario:ai
```

The seeder creates one new ClinicFlow project and ingests four sources. Each source uses live Gemini context extraction followed by the live Gap Agent, so this run can make up to eight bounded model calls. It never deletes an existing project.

## Part 1 — Confirm the product mechanics with Career Demo

1. Open `http://localhost:3000`.
2. Open the demo picker and select **Career Demo**. This intentionally resets that demo's chats, decisions, answers, and hidden states.
3. Open **Today**.
4. Verify the page is a single aligned feed with:
   - two reminder cards;
   - an `OPEN QUESTIONS · n` section, even if the count later reaches zero;
   - a full-width Coming Up section without duplicated reminder events.
5. Open one reminder's `···` menu. Verify only one overflow menu can be open and clicking outside or pressing Escape closes it.
6. Hide one reminder. Verify it moves to **Hidden reminders**, then restore it.
7. Hide one question. Verify it moves to **Hidden questions**, not the reminder section, then restore it.

Pass condition: feed sections remain visible at zero, hidden types stay separated, and menus never stack.

## Part 2 — Exercise Resolve completely

1. Resolve the highest-priority Career question.
2. Verify the modal title is concise while the original graph question remains the target internally.
3. Expand multiple sections at once:
   - What we know
   - What this affects
   - What your answer could change
   - Decision options
   - Sources
4. Verify empty sections are absent, details are concise, and **View in Decision Map** appears above Your Answer.
5. Open **I don't know yet**.
6. Choose **Help me figure this out**.
7. Verify Ask opens with a draft but no chat is persisted until the first message is sent.
8. Return and choose **I need to ask someone** on another question. Verify it produces a concise, take-away question.
9. Return and choose **Decide later** on another question. Verify it uses the existing defer behavior.
10. Save an actual answer to the top question.
11. Verify it moves to **Resolved** and that **Unresolve** restores the question and its answer flow.

Pass condition: every help path has a visible result and Resolve still operates on the original question node.

## Part 3 — Exercise project Ask and chat persistence

1. In Career Demo, open **Ask**.
2. Keep the project-context suggestions visible and send:

   `Given the Northstar role is 70–80% frontend, what would have to be true for it to support financial stability without derailing my backend or applied AI direction?`

3. Verify the answer uses Northstar project context and lists relevant sources.
4. Expand response details. Verify model, agent, thinking configuration, exact submitted prompt, and selected project context are inspectable without credentials or private chain-of-thought.
5. Start a new chat. Verify it is not saved until the first question is sent.
6. Send a first question and verify the chat title contains its creation timestamp plus the first question, truncates cleanly, and shows the complete title on hover.
7. Start a second chat, switch between both using the scrollable chat list, then delete one.
8. Hide the suggestions box using its icon. Send another message and verify the box remains consistently hidden rather than disappearing unpredictably.

Pass condition: chats are project-specific, persistent, independently deletable, and always use scoped context.

## Part 4 — Inspect the non-hardcoded ClinicFlow project

1. Switch to **ClinicFlow — Outpatient Intake Pilot**.
2. Open **Context** and verify these sources exist:
   - `01-pilot-brief.md`
   - `02-clinical-operations-notes.md`
   - `03-vendor-security-and-commercial-review.md`
   - `04-steering-update-and-decision-log.md`
3. Open each source and verify it reports completed processing, a Gemini model, an extraction summary, and derived graph nodes.
4. Re-upload one source without changing it. Verify duplicate ingestion is skipped instead of creating duplicate nodes or making another extraction call.
5. Open **Decision Map** and inspect the resulting goals, decisions, unknowns, risks, constraints, evidence, and relationships.

Pass condition: the map is derived from uploaded content, preserves provenance, and does not duplicate an unchanged source.

## Part 5 — Judge the live Gap Agent recommendation

1. Open **Today** for ClinicFlow.
2. Find **Recommended Focus**.
3. The badge must say **Gap Agent**. `Project analysis` means live AI failed and the deterministic fallback is being shown.
4. Judge the recommendation using this rubric rather than requiring exact wording:
   - Focus starts with a clear action verb and names the ClinicFlow decision.
   - Why now connects the uncertainty to the September go/no-go decision or the nearest safety review.
   - Next step proposes the smallest answerable action, ideally the named 25-minute safety review rather than a generic research task.
   - What could change identifies launch, pilot scope, safety controls, or sequence.
   - It does not invent approval, a named owner, or a completed test.
5. The strongest acceptable selected gaps are:
   - clinical ownership and correction authority;
   - duplicate prevention for offline retries;
   - consent or identity approval.
6. Treat budget, generic staffing, accessibility, and grant optics as poor top selections while the clinical ownership conflict remains unresolved.

Pass condition: the recommendation helps a person act and is materially more useful than displaying a ranked graph node.

## Part 6 — Inspect how the AI reached the product result

1. Open **Decision Map activity**. It should be collapsed by default.
2. Expand it and refresh.
3. Find the latest `Gap Agent after context ingestion` run.
4. Verify:
   - execution says `used`, not `would use`;
   - model is `gemini-3.5-flash-lite`;
   - validation passed;
   - a stable run ID, latency, input/output tokens, and cost availability are shown;
   - candidate gaps, selected gap, compact reason, confidence, evidence identifiers, and escalation state are shown;
   - the handoff/context counts are present;
   - prompts, credentials, raw source bodies, Context Packs, and chain-of-thought are absent.

Pass condition: the trace proves real execution without leaking private reasoning or raw context.

## Part 7 — Resolve the top ClinicFlow gap and verify reranking

Use this answer only if the selected question concerns clinical ownership or correction authority:

```text
Dr. Maya Chen will be the accountable clinical owner for the pilot. Intake coordinators and vendor administrators may correct demographics only. Medication and allergy corrections require approval by the treating clinician or delegated pharmacist, with an audit reason code. The vendor admin override will remain disabled. Any duplicate clinical record or unreviewed medication/allergy change stops the pilot.
```

Then:

1. Save the answer.
2. Verify feedback and persistent state update.
3. Verify the original question moves to **Resolved**.
4. Refresh Today.
5. Verify Recommended Focus changes to another unresolved gate, normally duplicate retry behavior or consent/identity approval.
6. Refresh the browser and switch to Career Demo and back. Verify the ClinicFlow answer and new recommendation persist and Career data remains isolated.
7. Use **Unresolve** and verify the prior question can become actionable again.

Pass condition: one answer changes stored state and the next recommended action rather than merely changing presentation copy.

## Part 8 — Ask ClinicFlow questions that require retrieval

Ask these in a ClinicFlow project chat:

1. `Should we launch ClinicFlow on September 8? Give me the strongest reason not to and the smallest next step.`
2. `Which sources conflict about who may correct medication and allergy errors?`
3. `If clinical ownership is resolved, what should become the next launch gate and why?`
4. `Compare the full vendor price with the approved budget, but do not let cost outrank patient safety.`

For each response verify:

- it uses only ClinicFlow context;
- it cites the relevant uploaded sources;
- it distinguishes facts, conflicts, assumptions, and unresolved questions;
- it does not claim the pilot is approved;
- response details show the live model and scoped input configuration.

Pass condition: Ask behaves like a project partner, not a generic chatbot.

## Part 9 — Confirm fallback honesty

Do not kill the combined launcher while testing the main flow. To test fallback separately:

1. Stop `npm run dev:ai` with Ctrl+C.
2. Start only the web app with live mode pointing to an unused agent port:

   ```bash
   GAPSWISE_DEMO_MODE=false USE_FIRESTORE=false GAP_AGENT_MODE=live GAPSWISE_AGENT_URL=http://127.0.0.1:8999 npm run dev
   ```

3. Trigger a context/graph turn.
4. Verify Today remains usable and the recommendation says **Project analysis**, never **Gap Agent**.
5. Verify Decision Map activity reports a sanitized unavailable/transport fallback.
6. Stop the web app and return to `npm run dev:ai` for normal testing.

Pass condition: an AI outage degrades transparently without breaking Today or fabricating an AI trace.

## Final acceptance scorecard

Mark the scenario successful only when all are true:

- [ ] Live service startup succeeds with one command.
- [ ] Career Demo mechanics work and remain isolated.
- [ ] ClinicFlow sources are processed by Gemini and produce a connected graph.
- [ ] Unchanged source ingestion is skipped.
- [ ] Recommended Focus is labeled Gap Agent during live execution.
- [ ] Guidance passes the focus/why/next/change rubric.
- [ ] Resolve updates persistent state and reranks the next gap.
- [ ] Hidden, resolved, restore, and unresolve sections behave correctly.
- [ ] Ask uses project sources and supports multiple persistent chats.
- [ ] Response details and Decision Map activity prove model routing safely.
- [ ] Fallback stays functional and is labeled Project analysis.
- [ ] No project leaks context, chats, answers, or hidden state into another project.

