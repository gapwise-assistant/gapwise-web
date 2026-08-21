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
  const value = clean(question)
    .replace(/^clarify:\s*/i, '')
    .replace(/^does\s+(.+?)\s+remain\s+/i, 'whether $1 remains ')
    .replace(/^is\s+there\s+/i, 'whether there is ')
    .replace(/^is\s+/i, 'whether ')
    .replace(/^are\s+/i, 'whether ')
    .replace(/^can\s+/i, 'whether ')
    .replace(/^who(?: exactly)?\s+is\s+/i, '')
    .replace(/^what(?: exactly)?\s+is\s+/i, '')
    .replace(/^what\s+/i, '')
    .replace(/^how much\s+/i, 'the amount of ')
    .replace(/^how many\s+/i, 'the number of ');
  const grammaticalValue = value.replace(/\b(configuration|build|setup|plan|option|choice)\s+stay\b/gi, '$1 stays');
  if (/^whether\b/i.test(grammaticalValue)) return limit(`Decide ${grammaticalValue}`, 150);
  if (/^(the primary|the target|the normal|the amount|the number|which|when|where)\b/i.test(grammaticalValue)) {
    return limit(`Clarify ${grammaticalValue}`, 150);
  }
  return limit(`Find out ${grammaticalValue.charAt(0).toLowerCase()}${grammaticalValue.slice(1)}`, 150);
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

function careerRoleGuidance(params: {
  node: ClarityNode;
  project: Project;
  supportingIds: string[];
}): GapGuidance | null {
  const isNorthstarRoleBoundary = /northstar/i.test(params.project.title)
    && /frontend/i.test(params.node.text)
    && /acceptable|worth pursuing/i.test(params.node.text);
  if (!isNorthstarRoleBoundary) return null;

  return {
    focus: 'Decide whether the Northstar Product Engineer role is worth pursuing.',
    whyNow: 'The role conflicts with your preferred direction, and this answer determines whether the interview process should continue.',
    nextStep: 'Set the longest frontend-heavy period you would accept, then verify the steady-state workload and transition path on the recruiter call.',
    whatCouldChange: 'The answer could stop the process or justify continuing to the full Northstar interview loop.',
    supportingIds: params.supportingIds,
    generatedBy: 'deterministic',
  };
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
  const seededCareerGuidance = careerRoleGuidance({
    node: params.node,
    project: params.project,
    supportingIds,
  });
  if (seededCareerGuidance) return seededCareerGuidance;
  return {
    focus: focusFor(params.node.text),
    whyNow: whyNowFor(params.project, params.decisionValue),
    nextStep: nextStepFor(params.node, params.decisionValue),
    whatCouldChange: whatCouldChangeFor(params.decisionValue),
    supportingIds,
    generatedBy: 'deterministic',
  };
}
