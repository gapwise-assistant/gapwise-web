import type { ClarityNode, GapGuidance, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';

export function focusAssessmentToGuidance(assessment: FocusAssessment): GapGuidance {
  return {
    focus: assessment.title,
    whyNow: assessment.whyNow ?? 'This is the most useful current focus for the project.',
    nextStep: assessment.nextAction ?? assessment.title,
    whatCouldChange: 'New evidence, a resolved dependency, or a changed deadline may change this assessment.',
    supportingIds: [...assessment.sourceNodeIds, ...assessment.sourceIds],
    generatedBy: 'deterministic',
  };
}

export function focusActionNodeForAssessment(
  project: Project,
  assessment: FocusAssessment | null,
): ClarityNode | null {
  if (!assessment?.actionNodeId) return null;
  const node = project.nodes.find((candidate) => candidate.id === assessment.actionNodeId);
  if (!node || node.status !== 'OPEN') return null;
  return ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION'].includes(node.type) ? node : null;
}
