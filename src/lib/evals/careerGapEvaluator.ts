import { assessGapsV1Deterministically } from '@/lib/agents/gapAssessmentV1';
import {
  gapAssessmentV1Schema,
  validateGapAssessmentAgainstProject,
  type GapAssessmentV1,
} from '@/lib/agents/gapContractV1';
import { CAREER_GAP_GOLDEN_SET } from '@/lib/evals/careerGapGoldenSet';
import { materializeCareerGapCase } from '@/lib/evals/careerGapFixture';
import { rankGaps } from '@/lib/tools/graphTools';
import {
  careerGapConceptForGapId,
  careerGapConceptForNodeId,
  type CareerGapConcept,
  type CareerGapGoldenCase,
  type CareerGapStrategy,
  type CareerGapStrategyInput,
  type CareerGapStrategyResult,
  type ExpectedAttentionUrgency,
  type ExpectedPartnerAction,
} from '@/lib/evals/careerGapTypes';

export const CAREER_GAP_QUALITY_GATES = {
  contractValidity: 1,
  answeredSuppression: 1,
  unrelatedCalendarInvariance: 1,
  forbiddenGenericQuestions: 1,
  topConceptAccuracy: 13 / 15,
  evidenceClassificationAccuracy: 14 / 15,
  criticalEvidenceCoverage: 1,
  guidanceValidity: 1,
} as const;

export interface CareerGapCaseScore {
  caseId: string;
  fixtureHash: string;
  selectedGapId: string | null;
  selectedConcept: CareerGapConcept | null;
  contractValid: boolean;
  topConceptCorrect: boolean;
  evidenceClassificationCorrect: boolean;
  answeredSuppressionCorrect: boolean;
  requiredEvidenceCovered: boolean;
  forbiddenConceptsAvoided: boolean;
  genericQuestionsAvoided: boolean;
  guidanceValid: boolean;
  attentionCorrect: boolean;
  partnerActionCorrect: boolean;
  escalationCorrect: boolean;
  runtime?: CareerGapStrategyResult['runtime'];
  errors: string[];
}

export interface CareerGapStrategySummary {
  strategyId: string;
  strategyLabel: string;
  caseScores: CareerGapCaseScore[];
  rates: {
    contractValidity: number;
    topConceptAccuracy: number;
    evidenceClassificationAccuracy: number;
    answeredSuppression: number;
    criticalEvidenceCoverage: number;
    forbiddenGenericQuestions: number;
    unrelatedCalendarInvariance: number;
    attentionAccuracy: number;
    partnerActionAccuracy: number;
    escalationAccuracy: number;
    guidanceValidity: number;
  };
  runtime: {
    models: string[];
    thinkingLevels: string[];
    inputTokens: number;
    outputTokens: number;
    totalLatencyMs: number;
    averageLatencyMs: number;
    estimatedCost: number | null;
    escalatedRuns: number;
  };
  gates: Record<keyof typeof CAREER_GAP_QUALITY_GATES, boolean>;
  passed: boolean;
}

const GENERIC_PATTERNS = [
  /^what should i (do|know|clarify)\??$/i,
  /^what is missing\??$/i,
  /^what matters\??$/i,
  /^clarify this\??$/i,
];

function selectedCandidate(assessment: GapAssessmentV1) {
  return assessment.candidates.find((candidate) => candidate.gapId === assessment.selectedGapId) ?? null;
}

function isAcceptedConcept(goldenCase: CareerGapGoldenCase, selected: CareerGapConcept | null): boolean {
  if (selected === goldenCase.expectedTopGapConcept) return true;
  return selected !== null && goldenCase.acceptableAlternativeConcepts.includes(selected);
}

function candidateForConcept(assessment: GapAssessmentV1, concept: CareerGapConcept) {
  return assessment.candidates.find((candidate) =>
    candidate.sourceUnknownNodeIds.some((nodeId) => careerGapConceptForNodeId(nodeId) === concept),
  );
}

function evaluateCandidateStates(goldenCase: CareerGapGoldenCase, assessment: GapAssessmentV1): boolean {
  return (goldenCase.expectedCandidateStates ?? []).every((expected) => {
    const candidate = candidateForConcept(assessment, expected.concept);
    if (!candidate) return false;
    if (expected.answerability !== undefined && candidate.evidenceReview.answerability !== expected.answerability) return false;
    if (expected.suppressionReason !== undefined && candidate.suppressionReason !== expected.suppressionReason) return false;
    return true;
  });
}

function validGuidance(result: CareerGapStrategyResult, assessment: GapAssessmentV1): boolean {
  const selected = selectedCandidate(assessment);
  if (!selected) return result.guidance === null;
  const guidance = result.guidance;
  if (!guidance) return false;
  const focusIsCanonicalQuestion = guidance.focus.trim() === selected.question.trim();
  const focusIsActionableCopy = /^(Decide|Confirm|Clarify|Find out|Verify)\b/.test(guidance.focus);
  if (!focusIsCanonicalQuestion && !focusIsActionableCopy) return false;
  if (![guidance.focus, guidance.whyNow, guidance.nextStep, guidance.whatCouldChange]
    .every((value) => value.trim().length >= 3)) return false;
  const allowedIds = new Set([
    ...selected.sourceUnknownNodeIds,
    ...selected.evidenceReview.evidenceIds,
    ...selected.affectedDecisions.flatMap((decision) => [decision.decisionId, ...decision.pathNodeIds]),
  ]);
  return guidance.supportingIds.length > 0
    && guidance.supportingIds.every((id) => allowedIds.has(id));
}

export function scoreCareerGapCase(
  goldenCase: CareerGapGoldenCase,
  input: CareerGapStrategyInput,
  result: CareerGapStrategyResult,
): CareerGapCaseScore {
  const errors: string[] = [];
  let contractValid = false;
  const parsed = gapAssessmentV1Schema.safeParse(result.gapAssessment);
  if (parsed.success) {
    try {
      validateGapAssessmentAgainstProject(parsed.data, input.project);
      contractValid = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    errors.push(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }

  const assessment = parsed.success ? parsed.data : result.gapAssessment;
  const selected = selectedCandidate(assessment);
  const selectedConcept = careerGapConceptForGapId(assessment.selectedGapId);
  const topConceptCorrect = isAcceptedConcept(goldenCase, selectedConcept);
  if (!topConceptCorrect) errors.push(`Expected ${goldenCase.expectedTopGapConcept ?? 'no gap'}, received ${selectedConcept ?? 'no gap'}.`);

  const selectedClassificationCorrect = goldenCase.expectedAnswerability === undefined
    || selected?.evidenceReview.answerability === goldenCase.expectedAnswerability;
  const likelihoodCorrect = goldenCase.expectedDecisionChangeLikelihood === undefined
    || selected?.decisionChangeLikelihood === goldenCase.expectedDecisionChangeLikelihood;
  const evidenceClassificationCorrect = selectedClassificationCorrect
    && likelihoodCorrect
    && evaluateCandidateStates(goldenCase, assessment);
  if (!evidenceClassificationCorrect) {
    errors.push(
      `Evidence expectation was ${goldenCase.expectedAnswerability ?? 'any'}/${goldenCase.expectedDecisionChangeLikelihood ?? 'any'}; received ${selected?.evidenceReview.answerability ?? 'none'}/${selected?.decisionChangeLikelihood ?? 'none'}.`,
    );
  }

  const answeredSuppressionCorrect = assessment.candidates
    .filter((candidate) => candidate.evidenceReview.answerability === 'answered')
    .every((candidate) => candidate.suppressionReason === 'already_answered' && candidate.gapId !== assessment.selectedGapId);
  if (!answeredSuppressionCorrect) errors.push('An answered candidate was not suppressed correctly.');

  const evidenceIds = new Set(assessment.candidates.flatMap((candidate) => candidate.evidenceReview.evidenceIds));
  const requiredEvidenceCovered = goldenCase.requiredEvidenceIds.every((id) => evidenceIds.has(id));
  if (!requiredEvidenceCovered) errors.push('Required evidence was not included in candidate evidence review.');

  const forbiddenConceptsAvoided = selectedConcept === null || !goldenCase.forbiddenGapConcepts.includes(selectedConcept);
  if (!forbiddenConceptsAvoided) errors.push(`Selected forbidden concept ${selectedConcept}.`);

  const genericQuestionsAvoided = assessment.candidates
    .filter((candidate) => candidate.suppressionReason === null)
    .every((candidate) => !GENERIC_PATTERNS.some((pattern) => pattern.test(candidate.question.trim())));
  if (!genericQuestionsAvoided) errors.push('An unsuppressed question is generic.');

  const guidanceValid = validGuidance(result, assessment);
  if (!guidanceValid) errors.push('The selected gap did not include valid grounded user guidance.');

  const attentionCorrect = result.attention.urgency === goldenCase.expectedAttentionUrgency;
  const partnerActionCorrect = result.partner.action === goldenCase.expectedPartnerAction;
  if (!attentionCorrect) errors.push(`Expected ${goldenCase.expectedAttentionUrgency} attention, received ${result.attention.urgency}.`);
  if (!partnerActionCorrect) errors.push(`Expected ${goldenCase.expectedPartnerAction}, received ${result.partner.action}.`);

  const escalationCorrect = !goldenCase.expectedEscalation || (
    assessment.escalationEligible === goldenCase.expectedEscalation.eligible
    && goldenCase.expectedEscalation.reasons.every((reason) => assessment.escalationReasons.includes(reason))
  );
  if (!escalationCorrect) errors.push('Escalation eligibility or reasons did not match.');

  return {
    caseId: goldenCase.id,
    fixtureHash: input.fixtureHash,
    selectedGapId: assessment.selectedGapId,
    selectedConcept,
    contractValid,
    topConceptCorrect,
    evidenceClassificationCorrect,
    answeredSuppressionCorrect,
    requiredEvidenceCovered,
    forbiddenConceptsAvoided,
    genericQuestionsAvoided,
    guidanceValid,
    attentionCorrect,
    partnerActionCorrect,
    escalationCorrect,
    runtime: result.runtime,
    errors,
  };
}

function rate(scores: CareerGapCaseScore[], field: keyof CareerGapCaseScore): number {
  if (scores.length === 0) return 0;
  return scores.filter((score) => score[field] === true).length / scores.length;
}

function unrelatedCalendarInvariance(scores: CareerGapCaseScore[]): number {
  const base = scores.find((score) => score.caseId === 'career-gap-01-base-role-conflict');
  const unrelated = scores.find((score) => score.caseId === 'career-gap-12-unrelated-calendar-event');
  return base && unrelated && base.selectedConcept === unrelated.selectedConcept ? 1 : 0;
}

export async function evaluateCareerGapStrategy(
  strategy: CareerGapStrategy,
  cases: readonly CareerGapGoldenCase[] = CAREER_GAP_GOLDEN_SET,
): Promise<CareerGapStrategySummary> {
  const caseScores: CareerGapCaseScore[] = [];
  for (const goldenCase of cases) {
    const input = materializeCareerGapCase(goldenCase);
    const result = await strategy.run(input);
    caseScores.push(scoreCareerGapCase(goldenCase, input, result));
  }

  const rates = {
    contractValidity: rate(caseScores, 'contractValid'),
    topConceptAccuracy: rate(caseScores, 'topConceptCorrect'),
    evidenceClassificationAccuracy: rate(caseScores, 'evidenceClassificationCorrect'),
    answeredSuppression: rate(caseScores, 'answeredSuppressionCorrect'),
    criticalEvidenceCoverage: rate(caseScores, 'requiredEvidenceCovered'),
    forbiddenGenericQuestions: rate(caseScores, 'genericQuestionsAvoided'),
    unrelatedCalendarInvariance: unrelatedCalendarInvariance(caseScores),
    attentionAccuracy: rate(caseScores, 'attentionCorrect'),
    partnerActionAccuracy: rate(caseScores, 'partnerActionCorrect'),
    escalationAccuracy: rate(caseScores, 'escalationCorrect'),
    guidanceValidity: rate(caseScores, 'guidanceValid'),
  };
  const gates = {
    contractValidity: rates.contractValidity >= CAREER_GAP_QUALITY_GATES.contractValidity,
    answeredSuppression: rates.answeredSuppression >= CAREER_GAP_QUALITY_GATES.answeredSuppression,
    unrelatedCalendarInvariance: rates.unrelatedCalendarInvariance >= CAREER_GAP_QUALITY_GATES.unrelatedCalendarInvariance,
    forbiddenGenericQuestions: rates.forbiddenGenericQuestions >= CAREER_GAP_QUALITY_GATES.forbiddenGenericQuestions,
    topConceptAccuracy: rates.topConceptAccuracy >= CAREER_GAP_QUALITY_GATES.topConceptAccuracy,
    evidenceClassificationAccuracy: rates.evidenceClassificationAccuracy >= CAREER_GAP_QUALITY_GATES.evidenceClassificationAccuracy,
    criticalEvidenceCoverage: rates.criticalEvidenceCoverage >= CAREER_GAP_QUALITY_GATES.criticalEvidenceCoverage,
    guidanceValidity: rates.guidanceValidity >= CAREER_GAP_QUALITY_GATES.guidanceValidity,
  };
  const runtimeRows = caseScores.flatMap((score) => score.runtime ? [score.runtime] : []);
  const estimatedCosts = runtimeRows.map((row) => row.estimatedCost);
  const hasCompleteCost = runtimeRows.length > 0 && estimatedCosts.every((cost) => cost !== null);
  const runtime = {
    models: [...new Set(runtimeRows.map((row) => row.model))],
    thinkingLevels: [...new Set(runtimeRows.map((row) => row.thinkingLevel))],
    inputTokens: runtimeRows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: runtimeRows.reduce((sum, row) => sum + row.outputTokens, 0),
    totalLatencyMs: runtimeRows.reduce((sum, row) => sum + row.latencyMs, 0),
    averageLatencyMs: runtimeRows.length
      ? Math.round(runtimeRows.reduce((sum, row) => sum + row.latencyMs, 0) / runtimeRows.length)
      : 0,
    estimatedCost: hasCompleteCost
      ? Number(estimatedCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0).toFixed(8))
      : null,
    escalatedRuns: runtimeRows.filter((row) => row.escalated).length,
  };

  return {
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    caseScores,
    rates,
    runtime,
    gates,
    passed: Object.values(gates).every(Boolean),
  };
}

export async function compareCareerGapStrategies(strategies: CareerGapStrategy[]) {
  return Promise.all(strategies.map((strategy) => evaluateCareerGapStrategy(strategy)));
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatCareerGapComparison(summaries: CareerGapStrategySummary[]): string {
  const lines = [
    '| Strategy | Model / thinking | Avg latency | Tokens in/out | Est. cost | Contract | Top concept | Evidence state | Guidance | Gates |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...summaries.map((summary) => [
      `| ${summary.strategyLabel}`,
      `${summary.runtime.models.join(', ') || 'deterministic'} / ${summary.runtime.thinkingLevels.join(', ') || 'n/a'}`,
      summary.runtime.averageLatencyMs ? `${summary.runtime.averageLatencyMs}ms` : 'n/a',
      `${summary.runtime.inputTokens}/${summary.runtime.outputTokens}`,
      summary.runtime.estimatedCost === null ? 'n/a' : `$${summary.runtime.estimatedCost.toFixed(6)}`,
      percentage(summary.rates.contractValidity),
      percentage(summary.rates.topConceptAccuracy),
      percentage(summary.rates.evidenceClassificationAccuracy),
      percentage(summary.rates.guidanceValidity),
      summary.passed ? 'PASS' : 'FAIL',
    ].join(' | ') + ' |'),
  ];
  return lines.join('\n');
}

function relevantRecruiterEvent(input: CareerGapStrategyInput) {
  return input.calendarEvents
    .filter((event) => /northstar|recruiter/i.test(`${event.summary} ${event.description ?? ''}`))
    .sort((left, right) => (left.start ?? '').localeCompare(right.start ?? ''))[0];
}

export function deriveCareerGapAttention(input: CareerGapStrategyInput, assessment: GapAssessmentV1): ExpectedAttentionUrgency {
  if (!assessment.selectedGapId) return 'low';
  const event = relevantRecruiterEvent(input);
  if (!event?.start) return 'low';
  const minutes = (new Date(event.start).getTime() - new Date(input.fixedNow).getTime()) / 60_000;
  if (minutes <= 180) return 'critical';
  if (minutes > 7 * 24 * 60) return 'low';
  return 'normal';
}

export function deriveCareerGapPartnerAction(
  assessment: GapAssessmentV1,
  urgency: ExpectedAttentionUrgency,
): ExpectedPartnerAction {
  if (!assessment.selectedGapId) return 'do_not_ask';
  return urgency === 'critical' ? 'ask_now' : 'surface_without_interrupting';
}

export const deterministicCareerGapStrategy: CareerGapStrategy = {
  id: 'typescript-current-ranker-v1-adapter',
  label: 'Current TypeScript ranker through GapAssessment V1',
  run(input) {
    const gapAssessment = assessGapsV1Deterministically(input);
    const selectedNodeId = gapAssessment.candidates
      .find((candidate) => candidate.gapId === gapAssessment.selectedGapId)
      ?.sourceUnknownNodeIds[0] ?? null;
    const guidance = selectedNodeId
      ? rankGaps(input.project).find((gap) => gap.node_id === selectedNodeId)?.guidance ?? null
      : null;
    const urgency = deriveCareerGapAttention(input, gapAssessment);
    return {
      gapAssessment,
      guidance,
      attention: { urgency },
      partner: { action: deriveCareerGapPartnerAction(gapAssessment, urgency) },
    };
  },
};

interface VertexContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface CareerGapAgentPlatformEvalCase {
  eval_case_id: string;
  prompt: VertexContent;
  reference: { response: VertexContent };
  career_gap_fixture_hash: string;
  career_gap_fixture_version: string;
  career_gap_expectations: Omit<CareerGapGoldenCase, 'mutations'>;
}

/**
 * Export adapter for Agent Platform Evaluation. Custom fields retain semantic
 * expectations for code metrics; the reference contains no chain-of-thought.
 */
export function toAgentPlatformEvaluationDataset(cases: readonly CareerGapGoldenCase[] = CAREER_GAP_GOLDEN_SET) {
  return {
    eval_cases: cases.map((goldenCase): CareerGapAgentPlatformEvalCase => {
      const input = materializeCareerGapCase(goldenCase);
      const portableInput = {
        fixtureVersion: input.fixtureVersion,
        fixedNow: input.fixedNow,
        fixtureHash: input.fixtureHash,
        project: input.project,
        memories: input.memories,
        calendarEvents: input.calendarEvents,
        contextPack: input.contextPack,
      };
      const { mutations: _mutations, ...expectations } = goldenCase;
      return {
        eval_case_id: goldenCase.id,
        prompt: {
          role: 'user',
          parts: [{
            text: `Apply GapAssessment V1 to this deterministic fixture. Return only the structured assessment.\n${JSON.stringify(portableInput)}`,
          }],
        },
        reference: {
          response: {
            role: 'model',
            parts: [{ text: JSON.stringify(expectations) }],
          },
        },
        career_gap_fixture_hash: input.fixtureHash,
        career_gap_fixture_version: input.fixtureVersion,
        career_gap_expectations: expectations,
      };
    }),
  };
}
