"""Versioned structured contract for the Gap Agent.

The TypeScript contract remains the product-side validator. These Pydantic
models make the same boundary enforceable inside ADK before an assessment can
reach shadow comparison or live selection.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

DecisionRelationship = Literal[
    "could_flip",
    "could_narrow",
    "could_confirm",
    "could_change_sequence",
    "could_change_risk",
]
Answerability = Literal[
    "answered", "partially_answered", "unanswered", "conflicting"
]
Category = Literal["low", "medium", "high"]
AcquisitionPath = Literal[
    "ask_user",
    "ask_other_person",
    "retrieve_existing_context",
    "run_experiment",
    "wait_for_event",
]
SuppressionReason = Literal[
    "already_answered",
    "not_decision_relevant",
    "duplicate",
    "too_broad",
    "too_generic",
    "obsolete",
]
EscalationReason = Literal[
    "close_candidates",
    "conflicting_evidence",
    "low_confidence",
    "high_impact",
    "complex_path",
]


class AffectedDecisionV1(BaseModel):
    decisionId: str = Field(min_length=1)
    relationship: DecisionRelationship
    pathNodeIds: list[str] = Field(min_length=2)


class EvidenceReviewV1(BaseModel):
    evidenceIds: list[str]
    answerability: Answerability
    conflictingEvidenceIds: list[str]

    @model_validator(mode="after")
    def validate_conflicts(self) -> EvidenceReviewV1:
        if self.answerability == "conflicting":
            if len(self.conflictingEvidenceIds) < 2:
                raise ValueError("Conflicting evidence requires at least two sources.")
            if not set(self.conflictingEvidenceIds).issubset(self.evidenceIds):
                raise ValueError("Conflicting evidence must be included in evidenceIds.")
        return self


class GapCandidateV1(BaseModel):
    schemaVersion: Literal["1"]
    gapId: str = Field(min_length=1)
    sourceUnknownNodeIds: list[str] = Field(min_length=1)
    question: str = Field(min_length=1)
    targetUnknown: str = Field(min_length=1)
    affectedDecisions: list[AffectedDecisionV1]
    evidenceReview: EvidenceReviewV1
    decisionChangeLikelihood: Category
    decisionImpact: Category
    assessmentConfidence: Category
    acquisitionPath: AcquisitionPath | None
    whyItMatters: str = Field(min_length=1)
    suppressionReason: SuppressionReason | None

    @model_validator(mode="after")
    def validate_candidate_invariants(self) -> GapCandidateV1:
        suppressed = self.suppressionReason is not None
        if (
            self.evidenceReview.answerability == "answered"
            and self.suppressionReason != "already_answered"
        ):
            raise ValueError("An answered gap must be suppressed as already_answered.")
        if suppressed and self.acquisitionPath is not None:
            raise ValueError("A suppressed gap cannot recommend an acquisition path.")
        if not suppressed and self.acquisitionPath is None:
            raise ValueError("An actionable gap must specify an acquisition path.")
        if not suppressed and not self.affectedDecisions:
            raise ValueError("An actionable gap must affect a live decision.")
        return self


class GapAssessmentV1(BaseModel):
    schemaVersion: Literal["1"]
    candidates: list[GapCandidateV1]
    selectedGapId: str | None
    suppressedGapIds: list[str]
    selectionRationale: str = Field(min_length=1)
    escalationEligible: bool
    escalationReasons: list[EscalationReason]

    @model_validator(mode="after")
    def validate_assessment_invariants(self) -> GapAssessmentV1:
        ids = [candidate.gapId for candidate in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("Gap identifiers must be unique.")
        suppressed = {
            candidate.gapId
            for candidate in self.candidates
            if candidate.suppressionReason is not None
        }
        if set(self.suppressedGapIds) != suppressed or len(
            self.suppressedGapIds
        ) != len(set(self.suppressedGapIds)):
            raise ValueError("suppressedGapIds must exactly match suppressed candidates.")
        if self.selectedGapId is not None and self.selectedGapId not in ids:
            raise ValueError("The selected gap must exist.")
        if self.selectedGapId in suppressed:
            raise ValueError("A suppressed gap cannot be selected.")
        actionable_count = len(ids) - len(suppressed)
        if actionable_count and self.selectedGapId is None:
            raise ValueError("One actionable gap must be selected.")
        if not actionable_count and self.selectedGapId is not None:
            raise ValueError("No gap can be selected when every candidate is suppressed.")
        if self.escalationEligible != bool(self.escalationReasons):
            raise ValueError("Escalation eligibility and reasons must agree.")
        return self


class GapGuidanceDraftV1(BaseModel):
    """Concise, grounded product copy returned with one selected gap."""

    focus: str = Field(min_length=3, max_length=180)
    whyNow: str = Field(min_length=3, max_length=260)
    nextStep: str = Field(min_length=3, max_length=260)
    whatCouldChange: str = Field(min_length=3, max_length=260)
    supportingIds: list[str] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def validate_supporting_ids(self) -> GapGuidanceDraftV1:
        if len(self.supportingIds) != len(set(self.supportingIds)):
            raise ValueError("Guidance supporting identifiers must be unique.")
        return self


class GapGuidanceV1(GapGuidanceDraftV1):
    generatedBy: Literal["gap-agent"] = "gap-agent"


class GapSelectionDraftV1(BaseModel):
    """Compact ADK output; deterministic graph fields stay authoritative."""

    schemaVersion: Literal["1"]
    selectedGapId: str | None
    selectionRationale: str = Field(min_length=1)
    escalationEligible: bool
    escalationReasons: list[EscalationReason]
    recommendation: GapGuidanceDraftV1 | None

    @model_validator(mode="after")
    def validate_recommendation_presence(self) -> GapSelectionDraftV1:
        if self.selectedGapId is None and self.recommendation is not None:
            raise ValueError("A completed decision cannot include gap guidance.")
        if self.selectedGapId is not None and self.recommendation is None:
            raise ValueError("A selected gap requires user-facing guidance.")
        return self


class GapGraphNode(BaseModel):
    id: str
    type: str
    text: str
    status: str
    confidence: float
    impact: float
    priority: float | None = None
    source_refs: list[str] = Field(default_factory=list)
    why_it_matters: list[str] | None = None


class GapGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str


class GapGraphSource(BaseModel):
    id: str
    filename: str


class GapProjectInput(BaseModel):
    id: str
    title: str
    goal: str
    deadline: str | None = None
    nodes: list[GapGraphNode]
    edges: list[GapGraphEdge]
    sources: list[GapGraphSource]


class GapEvaluationConfig(BaseModel):
    model: str
    thinkingLevel: Literal["minimal", "low", "medium", "high"]
    maxOutputTokens: int = Field(gt=0, le=8192)


class GapAssessmentRequest(BaseModel):
    userId: str = Field(min_length=1)
    project: GapProjectInput
    contextPack: dict[str, Any]
    candidateScaffold: GapAssessmentV1
    evaluationConfig: GapEvaluationConfig | None = None


class GapRunMetadata(BaseModel):
    runId: str
    agent: Literal["Gap Agent"]
    model: str
    thinkingLevel: str
    thinkingApplied: bool
    maxOutputTokens: int
    inputTokens: int
    outputTokens: int
    latencyMs: int
    estimatedCost: float | None
    costSource: Literal["configured_rates", "unavailable"]
    validationStatus: Literal["passed", "failed"]
    confidence: float | None
    escalated: bool
    escalationReason: str | None
    inputSummary: str
    outputSummary: str


class GapAssessmentResponse(BaseModel):
    assessment: GapAssessmentV1
    recommendation: GapGuidanceV1 | None
    metadata: GapRunMetadata


def validate_assessment_graph(
    assessment: GapAssessmentV1, project: GapProjectInput
) -> None:
    """Validate node, evidence, decision, and ordered path references."""
    nodes = {node.id: node for node in project.nodes}
    evidence_ids = set(nodes) | {source.id for source in project.sources}
    edges = {(edge.source, edge.target) for edge in project.edges}
    generic_questions = {
        "what should i do?",
        "what should i know?",
        "what should i clarify?",
        "what is missing?",
        "what matters?",
        "clarify this?",
    }

    for candidate in assessment.candidates:
        for node_id in candidate.sourceUnknownNodeIds:
            node = nodes.get(node_id)
            if node is None or node.type not in {"UNKNOWN", "ASSUMPTION"}:
                raise ValueError(
                    f"Gap {candidate.gapId} references a missing or non-gap node."
                )
        if (
            candidate.suppressionReason is None
            and candidate.question.strip().lower() in generic_questions
        ):
            raise ValueError(f"Gap {candidate.gapId} is too generic for live use.")
        for affected in candidate.affectedDecisions:
            decision = nodes.get(affected.decisionId)
            if decision is None or decision.type != "DECISION":
                raise ValueError(
                    f"Gap {candidate.gapId} references a missing decision."
                )
            path = affected.pathNodeIds
            if (
                path[0] not in candidate.sourceUnknownNodeIds
                or path[-1] != affected.decisionId
            ):
                raise ValueError(f"Gap {candidate.gapId} has an invalid path boundary.")
            for index in range(len(path) - 1):
                left, right = path[index], path[index + 1]
                if (left, right) not in edges and (right, left) not in edges:
                    raise ValueError(f"Gap {candidate.gapId} contains a missing edge.")
        if not set(candidate.evidenceReview.evidenceIds).issubset(evidence_ids):
            raise ValueError(f"Gap {candidate.gapId} references missing evidence.")
