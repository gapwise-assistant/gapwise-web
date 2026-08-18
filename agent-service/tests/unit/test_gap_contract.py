import pytest
from pydantic import ValidationError

from app.gap_contract import (
    GapAssessmentRequest,
    GapAssessmentV1,
    GapSelectionDraftV1,
    validate_assessment_graph,
)
from app.gap_runtime import _apply_selection, create_gap_agent
from app.model_policy import AgentModelConfig


def valid_assessment() -> dict:
    return {
        "schemaVersion": "1",
        "candidates": [
            {
                "schemaVersion": "1",
                "gapId": "gap:unknown_fit",
                "sourceUnknownNodeIds": ["unknown_fit"],
                "question": "Is this role acceptable?",
                "targetUnknown": "Whether the role is acceptable",
                "affectedDecisions": [
                    {
                        "decisionId": "decision_continue",
                        "relationship": "could_flip",
                        "pathNodeIds": ["unknown_fit", "decision_continue"],
                    }
                ],
                "evidenceReview": {
                    "evidenceIds": ["source_job"],
                    "answerability": "partially_answered",
                    "conflictingEvidenceIds": [],
                },
                "decisionChangeLikelihood": "high",
                "decisionImpact": "high",
                "assessmentConfidence": "medium",
                "acquisitionPath": "ask_user",
                "whyItMatters": "The answer determines whether to continue.",
                "suppressionReason": None,
            }
        ],
        "selectedGapId": "gap:unknown_fit",
        "suppressedGapIds": [],
        "selectionRationale": "This is the smallest fact that can flip the decision.",
        "escalationEligible": False,
        "escalationReasons": [],
    }


def valid_request() -> GapAssessmentRequest:
    return GapAssessmentRequest.model_validate(
        {
            "userId": "test-user",
            "project": {
                "id": "project",
                "title": "Career decision",
                "goal": "Choose a suitable role",
                "nodes": [
                    {
                        "id": "unknown_fit",
                        "type": "UNKNOWN",
                        "text": "Is this role acceptable?",
                        "status": "OPEN",
                        "confidence": 0.2,
                        "impact": 0.9,
                        "source_refs": ["source_job"],
                    },
                    {
                        "id": "decision_continue",
                        "type": "DECISION",
                        "text": "Continue interviewing",
                        "status": "OPEN",
                        "confidence": 0.3,
                        "impact": 0.9,
                        "source_refs": [],
                    },
                ],
                "edges": [
                    {
                        "id": "edge",
                        "source": "unknown_fit",
                        "target": "decision_continue",
                        "type": "blocks",
                    }
                ],
                "sources": [{"id": "source_job", "filename": "job.pdf"}],
            },
            "contextPack": {"includedContextIds": ["unknown_fit", "source_job"]},
            "candidateScaffold": valid_assessment(),
        }
    )


def test_gap_contract_and_graph_references_validate() -> None:
    assessment = GapAssessmentV1.model_validate(valid_assessment())
    validate_assessment_graph(assessment, valid_request().project)


def test_answered_candidate_requires_suppression() -> None:
    value = valid_assessment()
    value["candidates"][0]["evidenceReview"]["answerability"] = "answered"
    with pytest.raises(ValidationError):
        GapAssessmentV1.model_validate(value)


def test_missing_graph_path_is_rejected() -> None:
    request = valid_request()
    request.project.edges = []
    assessment = GapAssessmentV1.model_validate(valid_assessment())
    with pytest.raises(ValueError, match="missing edge"):
        validate_assessment_graph(assessment, request.project)


def test_gap_agent_uses_structured_output_and_role_config(monkeypatch) -> None:
    monkeypatch.setenv("GAPSWISE_DEMO_MODE", "false")
    agent = create_gap_agent(
        AgentModelConfig("gap", "gemini-3.5-flash", "high", 2048)
    )
    assert agent.name == "gap_agent"
    assert agent.output_schema is GapSelectionDraftV1
    assert agent.generate_content_config.response_mime_type == "application/json"
    assert agent.generate_content_config.max_output_tokens == 2048
    assert agent.generate_content_config.thinking_config is not None


def test_selection_merges_into_prevalidated_candidate_scaffold() -> None:
    draft = GapSelectionDraftV1.model_validate(
        {
            "schemaVersion": "1",
            "selectedGapId": "gap:unknown_fit",
            "selectionRationale": "This boundary can flip the live decision.",
            "escalationEligible": False,
            "escalationReasons": [],
        }
    )

    assessment = _apply_selection(draft, valid_request())

    assert assessment.selectedGapId == "gap:unknown_fit"
    assert assessment.candidates[0].evidenceReview.evidenceIds == ["source_job"]


def test_selection_rejects_suppressed_or_unknown_identifier() -> None:
    draft = GapSelectionDraftV1.model_validate(
        {
            "schemaVersion": "1",
            "selectedGapId": "gap:invented",
            "selectionRationale": "Invalid identifier.",
            "escalationEligible": False,
            "escalationReasons": [],
        }
    )
    with pytest.raises(ValueError, match="missing or suppressed"):
        _apply_selection(draft, valid_request())
