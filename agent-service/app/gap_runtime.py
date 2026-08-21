"""Isolated ADK runtime for the structured Gap Agent."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any

from google.adk.agents import Agent
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import ValidationError

from app.gap_contract import (
    GapAssessmentRequest,
    GapAssessmentResponse,
    GapAssessmentV1,
    GapGuidanceV1,
    GapRunMetadata,
    GapSelectionDraftV1,
    validate_assessment_graph,
)
from app.model_policy import (
    AgentModelConfig,
    generation_config_for,
    get_agent_model_config,
    get_gap_escalation_model_config,
    get_gap_escalation_policy,
    validate_live_model,
)

GAP_AGENT_APP_NAME = "gap_assessment"
# ADK's internal failure loggers include the raw invalid model output in
# exception values. Disable those two error channels; this module emits only
# its own sanitized failure and completed-run metadata.
for _unsafe_logger_name in (
    "google_adk.google.adk.workflow._node_runner",
    "google_adk.google.adk.runners",
):
    logging.getLogger(_unsafe_logger_name).disabled = True

GAP_AGENT_INSTRUCTION = """
You are Gapwise's Gap Agent. Return only GapSelectionDraftV1 structured output.

Your job is to select the smallest unresolved fact that could materially change
a live decision after reviewing the supplied existing evidence.

Rules:
- Use only the supplied project-scoped graph and Context Pack.
- The candidateScaffold is a deterministic graph/evidence audit. Do not
  regenerate its candidates, paths, evidence status, or suppression fields.
  Select exactly one unsuppressed gapId from it, or null when none are actionable.
- Treat evidence as answered, partially_answered, unanswered, or conflicting.
- If a gap node or adjacent fact has relevant source references, classify it as
  at least partially_answered and include the supporting source IDs. Use
  unanswered only when no supplied evidence addresses the target unknown.
- Suppress answered, obsolete, duplicated, broad, generic, and non-decision-relevant gaps.
- Never select a suppressed gap.
- Every actionable gap must identify an OPEN DECISION and copy an exact path
  from validDecisionPaths for its source node. Never infer or repair a path.
- If a candidate has no validDecisionPaths entry, suppress it as not_decision_relevant,
  leave affectedDecisions empty, and set acquisitionPath to null.
- Prefer a minimum discriminating question over an umbrella question.
- Resolve a user's unstated acceptance boundary before downstream due-diligence
  details: when a known option conflicts with a stated preference and the user
  has not recorded a conditional exception, that acceptability fact is the
  smallest potential decision flip. Once answered or superseded, suppress it
  and consider the next external discriminator.
- Use high decisionChangeLikelihood only for a direct unresolved boundary that
  could independently flip the live decision. Use medium for downstream facts
  that confirm, narrow, sequence, or change the risk of an option unless the
  supplied graph shows that fact alone can flip the decision.
- Node priority is the existing product rank. Treat it as a weak, deterministic
  tie-breaker after the evidence and minimum-question rules, never as evidence.
- Do not select an ASSUMPTION candidate when it feeds an actionable UNKNOWN
  candidate about the same issue; select the downstream UNKNOWN instead.
- Do not use calendar proximity, deadline urgency, or interruption cost to choose the structural gap.
- acquisitionPath describes how the fact can be learned; it does not authorize an action.
- When selectedGapId is not null, return one recommendation with four concise,
  user-facing fields: focus, whyNow, nextStep, and whatCouldChange.
- Start focus with an action verb such as Decide, Confirm, Clarify, Find out,
  or Verify. Make each recommendation field one short sentence.
- whyNow may use a supplied project deadline or related Context Pack commitment
  after structural selection; timing must never change which gap you select.
- nextStep must be the smallest concrete way to acquire the missing answer.
- whatCouldChange must name the downstream decision, action, scope, sequence,
  or risk that a different answer could alter.
- recommendation.supportingIds must contain only identifiers already attached
  to the selected candidate: its source unknowns, evidence, decision paths, or
  affected decisions. Never cite unrelated context.
- If selectedGapId is null, recommendation must be null.
- selectionRationale and whyItMatters must be concise outcome summaries, not private reasoning.
- Never invent node IDs, evidence IDs, paths, facts, or decisions.
- If no actionable gap remains, select null.
""".strip()


class GapRuntimeError(RuntimeError):
    """A safe, user-displayable Gap Agent runtime failure."""


def _timeout_seconds() -> float:
    try:
        configured = float(os.environ.get("AGENT_GAP_TIMEOUT_SECONDS", "20"))
    except ValueError:
        return 20.0
    return min(45.0, max(3.0, configured))


def _thinking_applied(config: AgentModelConfig) -> bool:
    return "flash-lite" not in config.model.lower()


def create_gap_agent(config: AgentModelConfig | None = None) -> Agent:
    """Create a fresh standalone Gap Agent for one isolated assessment."""
    selected = config or get_agent_model_config("gap")
    model = validate_live_model(selected.model)
    generation_config = generation_config_for(selected).model_copy(
        update={
            "response_mime_type": "application/json",
            "temperature": 0,
        }
    )
    return Agent(
        name="gap_agent",
        description="Selects the smallest unresolved fact that could change a decision.",
        model=Gemini(
            model=model,
            retry_options=types.HttpRetryOptions(attempts=3),
        ),
        generate_content_config=generation_config,
        instruction=GAP_AGENT_INSTRUCTION,
        output_schema=GapSelectionDraftV1,
        output_key="gap_assessment_v1",
        include_contents="none",
    )


def _valid_decision_paths(request: GapAssessmentRequest) -> dict[str, list[list[str]]]:
    open_decisions = {
        node.id
        for node in request.project.nodes
        if node.type == "DECISION" and node.status == "OPEN"
    }
    sources = {
        node.id
        for node in request.project.nodes
        if node.type in {"UNKNOWN", "ASSUMPTION"}
    }
    outgoing: dict[str, list[str]] = {}
    for edge in request.project.edges:
        outgoing.setdefault(edge.source, []).append(edge.target)

    result: dict[str, list[list[str]]] = {}
    for source_id in sorted(sources):
        paths: list[list[str]] = []
        queue = [[source_id]]
        shortest_seen = {source_id: 1}
        while queue:
            path = queue.pop(0)
            current = path[-1]
            if len(path) > 1 and current in open_decisions:
                paths.append(path)
                continue
            if len(path) >= 6:
                continue
            for target in outgoing.get(current, []):
                if target in path:
                    continue
                next_length = len(path) + 1
                if shortest_seen.get(target, 10**9) < next_length:
                    continue
                shortest_seen[target] = next_length
                queue.append([*path, target])
        result[source_id] = sorted(paths, key=lambda path: (len(path), path))
    return result


def _prompt(request: GapAssessmentRequest) -> str:
    payload = {
        "schemaVersion": "1",
        "project": request.project.model_dump(),
        "contextPack": request.contextPack,
        "candidateScaffold": request.candidateScaffold.model_dump(),
        "validDecisionPaths": _valid_decision_paths(request),
        "allowedEvidenceIds": sorted(
            {node.id for node in request.project.nodes}
            | {source.id for source in request.project.sources}
        ),
    }
    return (
        "Assess the following scoped Gapwise decision state. "
        "Return only GapSelectionDraftV1.\n" + json.dumps(payload, separators=(",", ":"))
    )


def _configured_cost(input_tokens: int, output_tokens: int) -> tuple[float | None, str]:
    try:
        input_rate = float(os.environ.get("AGENT_GAP_INPUT_COST_PER_MILLION", ""))
        output_rate = float(os.environ.get("AGENT_GAP_OUTPUT_COST_PER_MILLION", ""))
    except ValueError:
        return None, "unavailable"
    if input_rate < 0 or output_rate < 0:
        return None, "unavailable"
    return (
        round((input_tokens * input_rate + output_tokens * output_rate) / 1_000_000, 8),
        "configured_rates",
    )


def _confidence(assessment: GapAssessmentV1) -> float | None:
    selected = next(
        (
            candidate
            for candidate in assessment.candidates
            if candidate.gapId == assessment.selectedGapId
        ),
        None,
    )
    if selected is None:
        return None
    return {"low": 0.35, "medium": 0.65, "high": 0.9}[
        selected.assessmentConfidence
    ]


def _validation_failure_summary(error: Exception) -> str:
    """Return contract locations/codes without echoing model output or context."""
    if isinstance(error, ValidationError):
        issues = [
            f"{'.'.join(str(part) for part in issue['loc'])}:{issue['type']}"
            for issue in error.errors(include_input=False, include_url=False)[:4]
        ]
        return ", ".join(issues) or "schema validation failed"
    return f"{type(error).__name__}: {error}"


def _apply_selection(
    draft: GapSelectionDraftV1,
    request: GapAssessmentRequest,
) -> GapAssessmentV1:
    """Merge semantic selection into the prevalidated deterministic scaffold."""
    scaffold = request.candidateScaffold
    actionable_ids = {
        candidate.gapId
        for candidate in scaffold.candidates
        if candidate.suppressionReason is None
    }
    if draft.selectedGapId is not None and draft.selectedGapId not in actionable_ids:
        raise ValueError("Gap Agent selected a missing or suppressed candidate identifier.")
    if actionable_ids and draft.selectedGapId is None:
        raise ValueError("Gap Agent did not select an actionable candidate.")
    if not actionable_ids and draft.selectedGapId is not None:
        raise ValueError("Gap Agent selected a candidate after the decision was complete.")

    payload = scaffold.model_dump()
    payload["selectedGapId"] = draft.selectedGapId
    payload["selectionRationale"] = draft.selectionRationale
    combined_reasons = list(
        dict.fromkeys([*scaffold.escalationReasons, *draft.escalationReasons])
    )
    payload["escalationReasons"] = combined_reasons
    payload["escalationEligible"] = bool(combined_reasons)
    return GapAssessmentV1.model_validate(payload)


def _apply_guidance(
    draft: GapSelectionDraftV1,
    assessment: GapAssessmentV1,
) -> GapGuidanceV1 | None:
    if draft.selectedGapId is None:
        return None
    recommendation = draft.recommendation
    if recommendation is None:
        raise ValueError("Gap Agent omitted guidance for the selected gap.")
    selected = next(
        (
            candidate
            for candidate in assessment.candidates
            if candidate.gapId == draft.selectedGapId
        ),
        None,
    )
    if selected is None:
        raise ValueError("Gap Agent guidance references a missing selected gap.")
    allowed_ids = set(selected.sourceUnknownNodeIds)
    allowed_ids.update(selected.evidenceReview.evidenceIds)
    for affected in selected.affectedDecisions:
        allowed_ids.add(affected.decisionId)
        allowed_ids.update(affected.pathNodeIds)
    if not set(recommendation.supportingIds).issubset(allowed_ids):
        raise ValueError("Gap Agent guidance cites unrelated context identifiers.")
    return GapGuidanceV1.model_validate(
        {**recommendation.model_dump(), "generatedBy": "gap-agent"}
    )


async def _run_once(
    request: GapAssessmentRequest,
    config: AgentModelConfig,
) -> tuple[GapAssessmentV1, GapGuidanceV1 | None, dict[str, Any]]:
    session_service = InMemorySessionService()
    run_id = f"gap_{uuid.uuid4().hex}"
    session = await session_service.create_session(
        app_name=GAP_AGENT_APP_NAME,
        user_id=request.userId,
        session_id=run_id,
    )
    runner = Runner(
        agent=create_gap_agent(config),
        app_name=GAP_AGENT_APP_NAME,
        session_service=session_service,
    )
    final_text = ""
    input_tokens = 0
    output_tokens = 0
    started = time.perf_counter()
    try:
        async with asyncio.timeout(_timeout_seconds()):
            async for event in runner.run_async(
                user_id=request.userId,
                session_id=session.id,
                new_message=types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=_prompt(request))],
                ),
            ):
                usage = event.usage_metadata
                if usage is not None:
                    input_tokens = max(input_tokens, usage.prompt_token_count or 0)
                    output_tokens = max(output_tokens, usage.candidates_token_count or 0)
                if event.is_final_response() and event.content and event.content.parts:
                    final_text = "".join(
                        part.text or "" for part in event.content.parts if part.text
                    )
    except TimeoutError as error:
        raise GapRuntimeError("Gap Agent timed out before returning an assessment.") from error
    except Exception as error:
        summary = _validation_failure_summary(error)
        raise GapRuntimeError(
            f"Gap Agent inference failed ({summary})."
        ) from error

    latency_ms = round((time.perf_counter() - started) * 1000)
    if not final_text.strip():
        raise GapRuntimeError("Gap Agent returned no structured assessment.")
    try:
        draft = GapSelectionDraftV1.model_validate_json(final_text)
        assessment = _apply_selection(draft, request)
        validate_assessment_graph(assessment, request.project)
        recommendation = _apply_guidance(draft, assessment)
    except Exception as error:
        summary = _validation_failure_summary(error)
        raise GapRuntimeError(
            f"Gap Agent returned an invalid assessment ({summary})."
        ) from error
    return assessment, recommendation, {
        "run_id": run_id,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "latency_ms": latency_ms,
    }


def _evaluation_override(request: GapAssessmentRequest) -> AgentModelConfig | None:
    override = request.evaluationConfig
    if override is None:
        return None
    if os.environ.get("GAP_AGENT_EVAL_OVERRIDES_ENABLED", "").lower() != "true":
        raise GapRuntimeError("Gap Agent evaluation overrides are disabled.")
    return AgentModelConfig(
        role="gap",
        model=validate_live_model(override.model),
        thinking_level=override.thinkingLevel,
        max_output_tokens=override.maxOutputTokens,
    )


async def run_gap_assessment(
    request: GapAssessmentRequest,
) -> GapAssessmentResponse:
    """Run one validated pass and an optional conservative escalation pass."""
    config = _evaluation_override(request) or get_agent_model_config("gap")
    validate_live_model(config.model)
    assessment, recommendation, run = await _run_once(request, config)
    final_config = config
    total_input_tokens = run["input_tokens"]
    total_output_tokens = run["output_tokens"]
    total_latency_ms = run["latency_ms"]
    escalated = False
    escalation_reason: str | None = None

    policy = get_gap_escalation_policy()
    if (
        request.evaluationConfig is None
        and assessment.escalationEligible
        and policy.enabled
        and policy.max_retries > 0
    ):
        stronger = get_gap_escalation_model_config()
        validate_live_model(stronger.model)
        escalation_reason = ", ".join(assessment.escalationReasons)
        try:
            escalated_assessment, escalated_recommendation, escalated_run = await _run_once(request, stronger)
            assessment = escalated_assessment
            recommendation = escalated_recommendation
            final_config = stronger
            total_input_tokens += escalated_run["input_tokens"]
            total_output_tokens += escalated_run["output_tokens"]
            total_latency_ms += escalated_run["latency_ms"]
            run["run_id"] = escalated_run["run_id"]
            escalated = True
        except GapRuntimeError:
            # The first validated pass remains safe to use. Do not convert a
            # failed optional escalation into a product failure.
            escalated = False
            escalation_reason = f"{escalation_reason}; escalation failed, retained first pass"

    estimated_cost, cost_source = _configured_cost(
        total_input_tokens, total_output_tokens
    )
    metadata = GapRunMetadata(
        runId=run["run_id"],
        agent="Gap Agent",
        model=final_config.model,
        thinkingLevel=final_config.thinking_level,
        thinkingApplied=_thinking_applied(final_config),
        maxOutputTokens=final_config.max_output_tokens,
        inputTokens=total_input_tokens,
        outputTokens=total_output_tokens,
        latencyMs=total_latency_ms,
        estimatedCost=estimated_cost,
        costSource=cost_source,
        validationStatus="passed",
        confidence=_confidence(assessment),
        escalated=escalated,
        escalationReason=escalation_reason,
        inputSummary=(
            f"{len(request.project.nodes)} graph nodes, "
            f"{len(request.project.edges)} edges, "
            f"{len(request.contextPack.get('includedContextIds', []))} scoped context IDs"
        ),
        outputSummary=(
            f"{len(assessment.candidates)} candidates; "
            f"selected {assessment.selectedGapId or 'none'}; "
            f"guidance {'returned' if recommendation else 'not applicable'}"
        ),
    )
    return GapAssessmentResponse(
        assessment=assessment,
        recommendation=recommendation,
        metadata=metadata,
    )
