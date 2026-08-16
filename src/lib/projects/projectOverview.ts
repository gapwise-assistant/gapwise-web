import type { ClarityNode, Project } from '@/types/clarity';

export interface CurrentPictureItem {
  id: string;
  text: string;
}

export interface NeedsAttentionItem {
  nodeId: string;
  title: string;
  detail: string;
}

function shorten(text: string, maxLength = 150): string {
  const normalized = text.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function nodePriority(node?: ClarityNode): number {
  return node?.priority ?? node?.impact ?? 0;
}

function withoutEndingPunctuation(text: string): string {
  return shorten(text).replace(/[.?!]+$/, '').trim();
}

function sentence(text: string): string {
  const normalized = withoutEndingPunctuation(text);
  return normalized ? `${normalized}.` : '';
}

function lowercaseFirst(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function isRequirement(node: ClarityNode): boolean {
  return /\b(requires?|must|needs? to)\b/i.test(node.text);
}

function summarizeRequirement(text: string): string {
  const normalized = withoutEndingPunctuation(text);
  const trackRequirement = normalized.match(/^(?:the )?track requires? (.+)$/i);
  if (trackRequirement) return `The submission must demonstrate ${trackRequirement[1]}.`;

  return sentence(normalized);
}

function summarizeConstraint(text: string): string {
  const normalized = withoutEndingPunctuation(text);
  const teamDeadline = normalized.match(/^(\w+ developers?) with (\d+) days? remaining before (?:the )?(.+)$/i);
  if (teamDeadline) return `${teamDeadline[1]} have ${teamDeadline[2]} days until the ${teamDeadline[3]}.`;

  return sentence(normalized);
}

function summarizeRisk(text: string): string {
  const normalized = withoutEndingPunctuation(text);
  const liveDemoLatency = normalized.match(/^(.+?) latency could slow down (?:the )?live demo responses?$/i);
  if (liveDemoLatency) {
    const causes = liveDemoLatency[1]
      .replace(/Gemini API calls?/i, 'Gemini calls')
      .replace(/\s+/g, ' ');
    return `Live-demo latency from ${causes} remains a delivery risk.`;
  }

  // Risk nodes commonly already describe the consequence naturally. Keep that
  // wording instead of appending a mechanical graph label to a long sentence.
  return sentence(normalized);
}

function summarizeDecision(text: string): string {
  const normalized = withoutEndingPunctuation(text);
  const action = normalized.match(/^(build|ship|launch|use|focus on)\b/i);
  if (action) return `The current direction is to ${lowercaseFirst(normalized)}.`;

  return `The current direction is ${lowercaseFirst(normalized)}.`;
}

function summarizeNode(node: ClarityNode): string {
  if (node.type === 'RISK') return summarizeRisk(node.text);
  if (node.type === 'CONSTRAINT') return summarizeConstraint(node.text);
  if (node.type === 'DECISION') return summarizeDecision(node.text);
  if (node.type === 'NEXT_ACTION') return `The next step is to ${lowercaseFirst(withoutEndingPunctuation(node.text))}.`;
  if (isRequirement(node)) return summarizeRequirement(node.text);
  return sentence(node.text);
}

function summarizeBlockerQuestion(text: string): string {
  const normalized = withoutEndingPunctuation(text);
  if (/^who(?: exactly)? is the primary target persona and (?:\d+[- ]minute )?demo scenario(?: for .+)?$/i.test(normalized)) {
    return 'Target persona and demo scenario are still undefined.';
  }

  const whatIs = normalized.match(/^what is (?:the )?(.+)$/i);
  if (whatIs) return `${whatIs[1].charAt(0).toUpperCase()}${whatIs[1].slice(1)} is still undefined.`;

  const whoIs = normalized.match(/^who(?: exactly)? is (?:the )?(.+)$/i);
  if (whoIs) return `The ${whoIs[1]} is still undefined.`;

  const which = normalized.match(/^which (.+)$/i);
  if (which) return `${which[1].charAt(0).toUpperCase()}${which[1].slice(1)} is still undecided.`;

  return `${normalized} remains unresolved.`;
}

/** Returns the highest-priority open UNKNOWN that directly blocks a decision or next action. */
export function buildNeedsAttention(project: Project): NeedsAttentionItem | null {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const blockers = project.edges
    .filter((edge) => edge.type === 'blocks')
    .map((edge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (
        !source ||
        !target ||
        source.type !== 'UNKNOWN' ||
        source.status !== 'OPEN' ||
        target.status === 'DEPRECATED' ||
        !['DECISION', 'NEXT_ACTION'].includes(target.type)
      ) {
        return null;
      }

      return {
        source,
        target,
      };
    })
    .filter((item): item is { source: ClarityNode; target: ClarityNode } => Boolean(item))
    .sort(
      (a, b) =>
        nodePriority(b.source) - nodePriority(a.source) ||
        nodePriority(b.target) - nodePriority(a.target)
    );

  const blocker = blockers[0];
  if (!blocker) return null;

  return {
    nodeId: blocker.source.id,
    title: summarizeBlockerQuestion(blocker.source.text),
    detail: blocker.target.type === 'DECISION'
      ? 'This is currently blocking the next product decision.'
      : 'This is currently blocking the next project step.',
  };
}

/** Builds a compact deterministic briefing from the stored project graph. */
export function buildCurrentPicture(project: Project, limit = 3): CurrentPictureItem[] {
  const items: CurrentPictureItem[] = [];
  const seen = new Set<string>();
  const addNode = (node?: ClarityNode) => {
    if (!node) return;
    const text = summarizeNode(node);
    if (!text || seen.has(text)) return;
    seen.add(text);
    items.push({ id: `node:${node.id}`, text });
  };

  const activeNodes = project.nodes.filter((node) => node.status !== 'DEPRECATED');
  const sortByPriority = (a: ClarityNode, b: ClarityNode) => nodePriority(b) - nodePriority(a);
  const requirements = activeNodes
    .filter((node) => ['KNOWN', 'EVIDENCE', 'CONSTRAINT'].includes(node.type) && isRequirement(node))
    .sort(sortByPriority);
  const factsAndConstraints = activeNodes
    .filter((node) => ['KNOWN', 'EVIDENCE', 'CONSTRAINT'].includes(node.type) && !isRequirement(node))
    .sort(sortByPriority);
  const risks = activeNodes
    .filter((node) => node.status === 'OPEN' && node.type === 'RISK')
    .sort(sortByPriority);
  const decisionsAndChanges = activeNodes
    .filter((node) => ['DECISION', 'NEXT_ACTION'].includes(node.type))
    .sort((a, b) => nodePriority(b) - nodePriority(a) || b.updated_at.localeCompare(a.updated_at));

  // Lead with one item from each briefing category, then fill any extra slots
  // from the same graph-derived candidates. UNKNOWN nodes belong in the
  // separate Needs Attention block and are intentionally excluded here.
  [factsAndConstraints[0], risks[0], requirements[0], decisionsAndChanges[0]].forEach(addNode);
  [...factsAndConstraints, ...risks, ...requirements, ...decisionsAndChanges]
    .sort(sortByPriority)
    .forEach(addNode);

  if (!items.length && project.goal) {
    items.push({
      id: `goal:${project.id}`,
      text: `The current goal is to ${withoutEndingPunctuation(project.goal)}.`,
    });
  }

  return items.slice(0, Math.max(0, Math.min(limit, 4)));
}
