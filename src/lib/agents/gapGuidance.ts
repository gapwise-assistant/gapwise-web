import type { ClarityNode, DecisionValueAssessment, GapGuidance, Project } from '@/types/clarity';

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
}

function limit(value: string, max = 220): string {
  const normalized = clean(value);
  if (normalized.length <= max) return `${normalized}.`;
  const shortened = normalized.slice(0, max - 2).replace(/\s+\S*$/, '');
  return `${shortened || normalized.slice(0, max - 2)}…`;
}

function focusFor(question: string): string {
  return question;
}

function targetLabel(value: DecisionValueAssessment): string | null {
  const label = value.strongest_path?.label;
  return label ? clean(label) : null;
}

function whyNowFor(project: Project, value: DecisionValueAssessment): string {
  const target = targetLabel(value);
  if (value.evidence_strength === 'conflicting') {
    return limit(`Existing evidence conflicts, so ${target ? `“${target}”` : 'the next decision'} is not dependable yet`);
  }
  if (project.deadline && target) return limit(`This is the strongest unresolved input to “${target}” before the project deadline`);
  if (target) return limit(`This is the strongest unresolved input to “${target}”`);
  return 'This is the highest-value unresolved question currently represented in the project.';
}

function nextStepFor(node: ClarityNode, value: DecisionValueAssessment): string {
  if (value.evidence_strength === 'conflicting') {
    return 'Compare the conflicting evidence and confirm the disputed fact with its owner.';
  }
  if (value.acquisition_difficulty === 'low' && /acceptable|preference|willing|priority|comfort/i.test(node.text)) {
    return 'State the minimum condition you would accept, then save that boundary as the answer.';
  }
  if (value.evidence_strength === 'partial' || value.evidence_strength === 'strong') {
    return 'Review the linked evidence, verify the remaining uncertainty, and record the answer.';
  }
  if (value.acquisition_difficulty === 'high') {
    return 'Plan the smallest test or external check that can answer this before committing further.';
  }
  return 'Ask the person who owns this information and record their answer before proceeding.';
}

function whatCouldChangeFor(value: DecisionValueAssessment): string {
  const target = targetLabel(value);
  const suffix = target ? ` for “${target}”` : '';
  if (value.expected_action_change === 'could_flip_decision') return limit(`The answer could reverse or confirm the current decision${suffix}`);
  if (value.expected_action_change === 'could_change_scope') return limit(`The answer could change the scope of the plan${suffix}`);
  if (value.expected_action_change === 'could_change_sequence') return limit(`The answer could change what happens next and in what order${suffix}`);
  if (value.expected_action_change === 'could_change_risk') return limit(`The answer could change whether the current risk is acceptable${suffix}`);
  if (value.expected_action_change === 'could_confirm') return limit(`The answer could confirm whether the current direction remains justified${suffix}`);
  return 'The graph does not yet show a materially different next action.';
}

export function createDeterministicGapGuidance(params: {
  node: ClarityNode;
  project: Project;
  decisionValue: DecisionValueAssessment;
}): GapGuidance {
  const supportingIds = [
    params.node.id,
    ...(params.decisionValue.strongest_path?.path_node_ids.slice(1) ?? []),
    ...params.node.source_refs,
  ].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 6);
  return {
    focus: focusFor(params.node.text),
    whyNow: whyNowFor(params.project, params.decisionValue),
    nextStep: nextStepFor(params.node, params.decisionValue),
    whatCouldChange: whatCouldChangeFor(params.decisionValue),
    supportingIds,
    generatedBy: 'deterministic',
  };
}
