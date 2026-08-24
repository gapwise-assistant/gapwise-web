import type {
  ClarityNode,
  ContextSource,
  DecisionValueAssessment,
  GapGuidance,
  Project,
} from '@/types/clarity';

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
}

function limit(value: string, max = 240): string {
  const normalized = clean(value);
  if (normalized.length <= max) return `${normalized}.`;
  const shortened = normalized.slice(0, max - 2).replace(/\s+\S*$/, '');
  return `${shortened || normalized.slice(0, max - 2)}…`;
}

function focusFor(question: string): string {
  return question;
}

function quote(value: string): string {
  return `“${clean(value)}”`;
}

function nodeFor(project: Project, id: string | undefined): ClarityNode | null {
  return id ? project.nodes.find((node) => node.id === id) ?? null : null;
}

function strongestTarget(project: Project, value: DecisionValueAssessment): ClarityNode | null {
  return nodeFor(project, value.strongest_path?.node_id);
}

function pathNodes(project: Project, value: DecisionValueAssessment): ClarityNode[] {
  return (value.strongest_path?.path_node_ids ?? [])
    .map((id) => nodeFor(project, id))
    .filter((node): node is ClarityNode => Boolean(node));
}

function linkedNextAction(project: Project, value: DecisionValueAssessment): ClarityNode | null {
  return pathNodes(project, value).find((node) => node.type === 'NEXT_ACTION') ?? null;
}

function linkedSource(project: Project, node: ClarityNode): ContextSource | null {
  return node.source_refs
    .map((sourceId) => project.sources.find((source) => source.id === sourceId))
    .find((source): source is ContextSource => Boolean(source)) ?? null;
}

function validDeadline(deadline: string | undefined): string | null {
  if (!deadline?.trim()) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(deadline.trim());
  const parsed = new Date(dateOnly ? `${deadline.trim()}T12:00:00` : deadline);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function targetRationale(target: ClarityNode): string | null {
  const rationale = target.why_it_matters?.find((item) => item.trim());
  return rationale ? clean(rationale) : null;
}

function lowerInitial(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function targetImpact(target: ClarityNode): string {
  const rationale = targetRationale(target);
  if (rationale) {
    const clause = lowerInitial(rationale);
    if (/^(determines|affects|supports|tests|shows|explains|prevents|reduces|controls|defines|sets|indicates|requires|depends|informs|impacts|enables|establishes|guides|ensures)\b/i.test(clause)) {
      return `matters because it ${clause}`;
    }
    return `matters because ${clause}`;
  }

  switch (target.type) {
    case 'DECISION':
      return `could determine ${quote(target.text)}`;
    case 'GOAL':
      return `directly supports ${quote(target.text)}`;
    case 'CONSTRAINT':
      return `tests whether the plan can satisfy ${quote(target.text)}`;
    case 'RISK':
      return `shows how to manage ${quote(target.text)}`;
    case 'NEXT_ACTION':
      return `determines whether ${quote(target.text)} is the right next move`;
    default:
      return `helps move the project forward through ${quote(target.text)}`;
  }
}

function targetAction(target: ClarityNode | null, project: Project): string {
  if (!target) return quote(project.goal);
  switch (target.type) {
    case 'DECISION':
      return `the decision ${quote(target.text)}`;
    case 'GOAL':
      return `the goal ${quote(target.text)}`;
    case 'CONSTRAINT':
      return `a plan that satisfies ${quote(target.text)}`;
    case 'RISK':
      return `the response to ${quote(target.text)}`;
    case 'NEXT_ACTION':
      return `the next step ${quote(target.text)}`;
    default:
      return quote(target.text);
  }
}

function whyNowFor(project: Project, node: ClarityNode, value: DecisionValueAssessment): string {
  const target = strongestTarget(project, value);
  const deadline = validDeadline(project.deadline);
  const timing = deadline ? ` before ${deadline}` : '';
  const subject = quote(node.text);

  if (value.evidence_strength === 'conflicting') {
    const consequence = target
      ? `the evidence for ${targetAction(target, project)} remains unsettled`
      : 'the project cannot safely rely on the current information';
    return limit(`Conflicting evidence about ${subject} means ${consequence}${timing}`);
  }
  if (target) return limit(`The answer to ${subject} ${targetImpact(target)}${timing}`);
  if (project.goal.trim()) return limit(`The answer to ${subject} helps move ${quote(project.goal)} forward${timing}`);
  return limit(`The answer to ${subject} removes an unresolved project uncertainty`);
}

function nextStepFor(project: Project, node: ClarityNode, value: DecisionValueAssessment): string {
  const target = strongestTarget(project, value);
  const targetText = target ? targetAction(target, project) : quote(project.goal);
  const nextAction = linkedNextAction(project, value);
  const source = linkedSource(project, node);

  if (value.evidence_strength === 'conflicting') {
    return limit(`Ask the relevant owner to resolve the conflict about ${quote(node.text)} before relying on ${targetText}`);
  }
  if (nextAction) {
    return limit(`Complete ${quote(nextAction.text)} and use its result to answer ${quote(node.text)}`);
  }
  if (value.acquisition_difficulty === 'high') {
    return limit(`Run the smallest check that can distinguish the possible answers to ${quote(node.text)} before changing ${targetText}`);
  }
  if (source) {
    return limit(`Use the latest result from ${quote(source.filename)} to confirm ${quote(node.text)} before acting on ${targetText}`);
  }
  return limit(`Get a direct answer to ${quote(node.text)} from the relevant owner before acting on ${targetText}`);
}

function whatCouldChangeFor(project: Project, value: DecisionValueAssessment): string {
  const target = strongestTarget(project, value);
  const action = targetAction(target, project);

  switch (value.expected_action_change) {
    case 'could_flip_decision':
      return limit(`If the answer supports the current direction, proceed with ${action}; if not, revisit the alternatives before committing`);
    case 'could_change_scope':
      return limit(`If the answer supports the current scope, keep ${action}; if not, narrow or expand the plan before proceeding`);
    case 'could_change_sequence':
      return limit(`If the answer is confirmed in time, take ${action} next; if not, change the order or choose a fallback`);
    case 'could_change_risk':
      return limit(`If the risk is acceptable, continue with ${action}; if not, add a mitigation or change the plan`);
    case 'could_confirm':
      return limit(`If the answer is confirmed, continue with ${action}; if not, investigate before relying on the current direction`);
    case 'same_action':
      return limit(`If the answer confirms the current plan, continue with ${action}; if not, identify the next decision it affects`);
    default:
      return limit(`If the answer supports the project goal, continue with ${action}; if not, adjust the plan before committing further`);
  }
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
    whyNow: whyNowFor(params.project, params.node, params.decisionValue),
    nextStep: nextStepFor(params.project, params.node, params.decisionValue),
    whatCouldChange: whatCouldChangeFor(params.project, params.decisionValue),
    supportingIds,
    generatedBy: 'deterministic',
  };
}
