import {
  ClarityNode,
  MyWorldGraph,
  Project,
  WorldDomainSummary,
  WorldDomainType,
  WorldEdge,
  WorldNode,
} from '@/types/clarity';
import { projectForReasoning } from '@/lib/context/sourceState';

const DOMAIN_LABELS: Record<WorldDomainType, string> = {
  work: 'Work',
  personal: 'Personal',
  learning: 'Learning',
  finance: 'Finance',
  health: 'Health',
  relationships: 'Relationships',
  operations: 'Operations',
  unknown: 'Unsorted',
};

const DOMAIN_KEYWORDS: Record<WorldDomainType, string[]> = {
  work: ['startup', 'project', 'hackathon', 'builder', 'demo', 'submission', 'customer', 'product'],
  personal: ['life', 'personal', 'home', 'family'],
  learning: ['learn', 'learning', 'research', 'course', 'ai', 'agentic'],
  finance: ['financial', 'salary', 'pricing', 'recruiter', 'money', 'stability', 'pay'],
  health: ['health', 'doctor', 'sleep', 'exercise'],
  relationships: ['partner', 'friend', 'team', 'relationship'],
  operations: ['deadline', 'meeting', 'calendar', 'reply', 'prepare', 'follow up', 'constraint'],
  unknown: [],
};

function textForProject(project: Project): string {
  return [
    project.title,
    project.goal,
    project.one_sentence_context,
    ...project.sources.map((source) => `${source.filename} ${source.content}`),
    ...project.nodes.map((node) => node.text),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function classifyDomain(text: string): WorldDomainType {
  const lower = text.toLowerCase();
  const scores = Object.entries(DOMAIN_KEYWORDS)
    .filter(([domain]) => domain !== 'unknown')
    .map(([domain, keywords]) => ({
      domain: domain as WorldDomainType,
      score: keywords.reduce((total, keyword) => total + (lower.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);

  return scores[0] && scores[0].score > 0 ? scores[0].domain : 'unknown';
}

function nodePriority(node: ClarityNode): number {
  if (typeof node.priority === 'number') return node.priority;
  return Math.max(0, Math.min(1, Number(((1 - node.confidence) * 0.45 + node.impact * 0.55).toFixed(3))));
}

function createWorldNode(node: WorldNode): WorldNode {
  return node;
}

function createWorldEdge(edge: WorldEdge): WorldEdge {
  return edge;
}

export function buildMyWorldGraph(userId: string, projects: Project[]): MyWorldGraph {
  const nodes: WorldNode[] = [];
  const edges: WorldEdge[] = [];
  const domainMap = new Map<WorldDomainType, WorldDomainSummary>();

  const ensureDomain = (domain: WorldDomainType): WorldNode => {
    const id = `domain_${domain}`;
    const existing = nodes.find((node) => node.id === id);
    if (existing) return existing;

    const created = createWorldNode({
      id,
      type: 'DOMAIN',
      label: DOMAIN_LABELS[domain],
      domain,
      summary: `${DOMAIN_LABELS[domain]} context across active projects and sources.`,
      priority: 0,
      source_refs: [],
      linked_node_ids: [],
      status: 'active',
    });
    nodes.push(created);
    domainMap.set(domain, {
      domain,
      label: DOMAIN_LABELS[domain],
      project_count: 0,
      source_count: 0,
      open_gap_count: 0,
      risk_count: 0,
      priority: 0,
    });
    return created;
  };

  projects.forEach((project) => {
    const reasoningProject = projectForReasoning(project);
    const projectDomain = classifyDomain(textForProject(reasoningProject));
    const domainNode = ensureDomain(projectDomain);
    const projectNode = createWorldNode({
      id: `project_${project.id}`,
      type: 'PROJECT',
      label: project.title,
      domain: projectDomain,
      summary: project.goal,
      priority: (100 - project.clarity_score) / 100,
      source_refs: reasoningProject.sources.map((source) => source.id),
      linked_node_ids: reasoningProject.nodes.map((node) => node.id),
      status: 'active',
    });
    nodes.push(projectNode);
    edges.push(createWorldEdge({
      id: `edge_${domainNode.id}_${projectNode.id}`,
      source: domainNode.id,
      target: projectNode.id,
      type: 'contains',
      strength: 1,
    }));

    const domainSummary = domainMap.get(projectDomain);
    if (domainSummary) {
      domainSummary.project_count += 1;
      domainSummary.source_count += reasoningProject.sources.length;
      domainSummary.open_gap_count += reasoningProject.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').length;
      domainSummary.risk_count += reasoningProject.nodes.filter((node) => node.type === 'RISK' && node.status === 'OPEN').length;
      domainSummary.priority = Math.max(domainSummary.priority, projectNode.priority);
    }

    reasoningProject.sources.forEach((source) => {
      const sourceDomain = classifyDomain(`${source.filename} ${source.content}`) || projectDomain;
      ensureDomain(sourceDomain);
      const sourceNode = createWorldNode({
        id: `source_${source.id}`,
        type: 'SOURCE',
        label: source.filename,
        domain: sourceDomain,
        summary: source.extraction_summary ?? source.content.slice(0, 120),
        priority: source.processing_status === 'failed' ? 0.8 : 0.35,
        source_refs: [source.id],
        linked_node_ids: source.derived_node_ids,
        status: source.processing_status === 'failed' ? 'watch' : 'active',
      });
      nodes.push(sourceNode);
      edges.push(createWorldEdge({
        id: `edge_${projectNode.id}_${sourceNode.id}`,
        source: projectNode.id,
        target: sourceNode.id,
        type: 'derived_from',
        strength: 0.7,
      }));
    });

    reasoningProject.nodes
      .filter((node) => ['GOAL', 'UNKNOWN', 'RISK', 'PREFERENCE'].includes(node.type))
      .forEach((node) => {
        const mappedType = node.type === 'UNKNOWN' ? 'GAP' : node.type;
        const worldNode = createWorldNode({
          id: `clarity_${node.id}`,
          type: mappedType as WorldNode['type'],
          label: node.text,
          domain: classifyDomain(node.text) === 'unknown' ? projectDomain : classifyDomain(node.text),
          summary: node.why_it_matters?.[0] ?? node.text,
          priority: nodePriority(node),
          source_refs: node.source_refs,
          linked_node_ids: [node.id],
          status: node.status === 'RESOLVED' ? 'resolved' : node.type === 'RISK' ? 'watch' : 'active',
        });
        nodes.push(worldNode);
        edges.push(createWorldEdge({
          id: `edge_${projectNode.id}_${worldNode.id}`,
          source: projectNode.id,
          target: worldNode.id,
          type: node.type === 'UNKNOWN' || node.type === 'RISK' ? 'blocks' : 'supports',
          strength: worldNode.priority,
        }));
      });
  });

  return {
    userId,
    generated_at: new Date().toISOString(),
    nodes,
    edges,
    domains: Array.from(domainMap.values()).sort((a, b) => b.priority - a.priority),
  };
}
