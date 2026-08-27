import type { ClarityNode, GapGuidance, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { isNextActionSatisfied } from '@/lib/actions/completion';

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
  const targetNodeId = assessment?.targetNodeId ?? assessment?.actionNodeId;
  if (!targetNodeId) return null;
  const node = project.nodes.find((candidate) => candidate.id === targetNodeId);
  if (!node || node.status !== 'OPEN') return null;
  if (node.type === 'NEXT_ACTION' && isNextActionSatisfied(project, node)) return null;
  return ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION'].includes(node.type) ? node : null;
}
