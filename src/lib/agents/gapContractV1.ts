import { z } from 'zod';
import type { Project } from '@/types/clarity';

export const GAP_CONTRACT_VERSION = '1' as const;

export const gapDecisionRelationshipSchema = z.enum([
  'could_flip',
  'could_narrow',
  'could_confirm',
  'could_change_sequence',
  'could_change_risk',
]);

export const gapAnswerabilitySchema = z.enum([
  'answered',
  'partially_answered',
  'unanswered',
  'conflicting',
]);

export const gapDecisionChangeLikelihoodSchema = z.enum(['low', 'medium', 'high']);
export const gapDecisionImpactSchema = z.enum(['low', 'medium', 'high']);
export const gapAssessmentConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const gapAcquisitionPathSchema = z.enum([
  'ask_user',
  'ask_other_person',
  'retrieve_existing_context',
  'run_experiment',
  'wait_for_event',
]);

export const gapSuppressionReasonSchema = z.enum([
  'already_answered',
  'not_decision_relevant',
  'duplicate',
  'too_broad',
  'too_generic',
  'obsolete',
]);

export const gapEscalationReasonSchema = z.enum([
  'close_candidates',
  'conflicting_evidence',
  'low_confidence',
  'high_impact',
  'complex_path',
]);

export const gapCandidateV1Schema = z.object({
  schemaVersion: z.literal(GAP_CONTRACT_VERSION),
  gapId: z.string().min(1),
  /** Graph UNKNOWN/ASSUMPTION nodes that the semantic gap is based on. */
  sourceUnknownNodeIds: z.array(z.string().min(1)).min(1),
  question: z.string().min(1),
  targetUnknown: z.string().min(1),
  affectedDecisions: z.array(z.object({
    decisionId: z.string().min(1),
    relationship: gapDecisionRelationshipSchema,
    pathNodeIds: z.array(z.string().min(1)).min(2),
  })),
  evidenceReview: z.object({
    evidenceIds: z.array(z.string().min(1)),
    answerability: gapAnswerabilitySchema,
    conflictingEvidenceIds: z.array(z.string().min(1)),
  }),
  decisionChangeLikelihood: gapDecisionChangeLikelihoodSchema,
  decisionImpact: gapDecisionImpactSchema,
  assessmentConfidence: gapAssessmentConfidenceSchema,
  acquisitionPath: gapAcquisitionPathSchema.nullable(),
  whyItMatters: z.string().min(1),
  suppressionReason: gapSuppressionReasonSchema.nullable(),
}).superRefine((candidate, ctx) => {
  const suppressed = candidate.suppressionReason !== null;

  if (candidate.evidenceReview.answerability === 'answered' && candidate.suppressionReason !== 'already_answered') {
    ctx.addIssue({
      code: 'custom',
      path: ['suppressionReason'],
      message: 'An answered gap must be suppressed as already_answered.',
    });
  }
  if (candidate.evidenceReview.answerability === 'conflicting') {
    const conflicts = candidate.evidenceReview.conflictingEvidenceIds;
    if (conflicts.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceReview', 'conflictingEvidenceIds'],
        message: 'Conflicting evidence requires at least two evidence identifiers.',
      });
    }
    const evidenceIds = new Set(candidate.evidenceReview.evidenceIds);
    if (conflicts.some((id) => !evidenceIds.has(id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceReview', 'conflictingEvidenceIds'],
        message: 'Conflicting evidence identifiers must also be present in evidenceIds.',
      });
    }
  }
  if (suppressed && candidate.acquisitionPath !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['acquisitionPath'],
      message: 'Suppressed gaps cannot recommend an acquisition path.',
    });
  }
  if (!suppressed && candidate.acquisitionPath === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['acquisitionPath'],
      message: 'An actionable gap must specify an acquisition path.',
    });
  }
  if (!suppressed && candidate.affectedDecisions.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['affectedDecisions'],
      message: 'An actionable gap must affect at least one live decision.',
    });
  }
});

export const gapAssessmentV1Schema = z.object({
  schemaVersion: z.literal(GAP_CONTRACT_VERSION),
  candidates: z.array(gapCandidateV1Schema),
  selectedGapId: z.string().min(1).nullable(),
  suppressedGapIds: z.array(z.string().min(1)),
  selectionRationale: z.string().min(1),
  escalationEligible: z.boolean(),
  escalationReasons: z.array(gapEscalationReasonSchema),
}).superRefine((assessment, ctx) => {
  const candidateIds = new Set(assessment.candidates.map((candidate) => candidate.gapId));
  const suppressedIds = new Set(
    assessment.candidates
      .filter((candidate) => candidate.suppressionReason !== null)
      .map((candidate) => candidate.gapId),
  );

  if (candidateIds.size !== assessment.candidates.length) {
    ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'Gap identifiers must be unique.' });
  }
  if (assessment.selectedGapId && !candidateIds.has(assessment.selectedGapId)) {
    ctx.addIssue({ code: 'custom', path: ['selectedGapId'], message: 'The selected gap must exist.' });
  }
  if (assessment.selectedGapId && suppressedIds.has(assessment.selectedGapId)) {
    ctx.addIssue({ code: 'custom', path: ['selectedGapId'], message: 'A suppressed gap cannot be selected.' });
  }
  const actionableCount = assessment.candidates.length - suppressedIds.size;
  if (actionableCount > 0 && assessment.selectedGapId === null) {
    ctx.addIssue({ code: 'custom', path: ['selectedGapId'], message: 'One actionable gap must be selected.' });
  }
  if (actionableCount === 0 && assessment.selectedGapId !== null) {
    ctx.addIssue({ code: 'custom', path: ['selectedGapId'], message: 'No gap can be selected when every candidate is suppressed.' });
  }
  const reportedSuppressed = new Set(assessment.suppressedGapIds);
  if (
    reportedSuppressed.size !== assessment.suppressedGapIds.length ||
    [...reportedSuppressed].some((id) => !suppressedIds.has(id)) ||
    [...suppressedIds].some((id) => !reportedSuppressed.has(id))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['suppressedGapIds'],
      message: 'suppressedGapIds must exactly match candidates with a suppression reason.',
    });
  }
  if (!assessment.escalationEligible && assessment.escalationReasons.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['escalationReasons'],
      message: 'Escalation reasons require escalationEligible to be true.',
    });
  }
  if (assessment.escalationEligible && assessment.escalationReasons.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['escalationReasons'],
      message: 'An escalation-eligible assessment must identify at least one reason.',
    });
  }
});

export type GapDecisionRelationship = z.infer<typeof gapDecisionRelationshipSchema>;
export type GapAnswerability = z.infer<typeof gapAnswerabilitySchema>;
export type GapDecisionChangeLikelihood = z.infer<typeof gapDecisionChangeLikelihoodSchema>;
export type GapDecisionImpact = z.infer<typeof gapDecisionImpactSchema>;
export type GapAssessmentConfidence = z.infer<typeof gapAssessmentConfidenceSchema>;
export type GapAcquisitionPath = z.infer<typeof gapAcquisitionPathSchema>;
export type GapSuppressionReason = z.infer<typeof gapSuppressionReasonSchema>;
export type GapEscalationReason = z.infer<typeof gapEscalationReasonSchema>;
export type GapCandidateV1 = z.infer<typeof gapCandidateV1Schema>;
export type GapAssessmentV1 = z.infer<typeof gapAssessmentV1Schema>;

export const GAP_AGENT_RESPONSIBILITY_V1 = {
  context: 'Determine what is already known and which evidence supports it.',
  gap: 'Select the smallest unresolved fact that could materially change a live decision.',
  attention: 'Determine whether the gap matters now, including calendar and deadline urgency.',
  partner: 'Choose whether and how to interrupt or help the user acquire the answer.',
} as const;

export const GAP_AGENT_INSTRUCTIONS_V1 = [
  GAP_AGENT_RESPONSIBILITY_V1.gap,
  'Review relevant existing evidence before treating an unknown as a question.',
  'Suppress gaps that are answered, obsolete, duplicated, generic, broad, or not decision-relevant.',
  'Prefer the minimum discriminating question over an umbrella question.',
  'Do not use calendar urgency or interruption cost to select the structural gap.',
].join(' ');

/**
 * Zod validates the portable contract. This companion validator checks graph
 * references and edge ordering, which require the concrete project graph.
 */
export function validateGapAssessmentAgainstProject(
  value: unknown,
  project: Project,
): GapAssessmentV1 {
  const assessment = gapAssessmentV1Schema.parse(value);
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const edges = new Set(project.edges.map((edge) => `${edge.source}->${edge.target}`));

  for (const candidate of assessment.candidates) {
    for (const nodeId of candidate.sourceUnknownNodeIds) {
      const node = nodes.get(nodeId);
      if (!node || !['UNKNOWN', 'ASSUMPTION'].includes(node.type)) {
        throw new Error(`Gap ${candidate.gapId} references a missing or non-gap source node: ${nodeId}`);
      }
    }
    for (const affected of candidate.affectedDecisions) {
      if (nodes.get(affected.decisionId)?.type !== 'DECISION') {
        throw new Error(`Gap ${candidate.gapId} references a missing decision: ${affected.decisionId}`);
      }
      const path = affected.pathNodeIds;
      if (!candidate.sourceUnknownNodeIds.includes(path[0]) || path.at(-1) !== affected.decisionId) {
        throw new Error(`Gap ${candidate.gapId} has an invalid path boundary for ${affected.decisionId}`);
      }
      for (let index = 0; index < path.length - 1; index += 1) {
        const forward = `${path[index]}->${path[index + 1]}`;
        const reverse = `${path[index + 1]}->${path[index]}`;
        if (!edges.has(forward) && !edges.has(reverse)) {
          throw new Error(`Gap ${candidate.gapId} path contains a missing edge: ${forward}`);
        }
      }
    }
    const knownEvidenceIds = new Set([
      ...project.sources.map((source) => source.id),
      ...project.nodes.map((node) => node.id),
    ]);
    for (const evidenceId of candidate.evidenceReview.evidenceIds) {
      if (!knownEvidenceIds.has(evidenceId)) {
        throw new Error(`Gap ${candidate.gapId} references missing evidence: ${evidenceId}`);
      }
    }
  }

  return assessment;
}
