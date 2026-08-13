import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { Insight } from '@/types/insight';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { isDismissed, makeInsightId } from '@/lib/insights/common';
import { projectForReasoning } from '@/lib/context/sourceState';

function hasActiveGoal(project: Project, memories: DurableMemory[]): boolean {
  return (
    project.nodes.some((node) => node.type === 'GOAL' && node.status !== 'DEPRECATED') ||
    memories.some((memory) => !memory.forgotten_at && memory.category === 'current_priorities')
  );
}

function isCommitmentText(text: string): boolean {
  return /\breply\b|\bfollow up\b|\bfollow-up\b|\bprepare\b|\bsend\b|\bmeeting\b|\brecruiter\b/i.test(text);
}

export function detectLooseEnds(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  now?: Date;
}): Insight[] {
  const now = params.now ?? new Date();
  const reasoningProject = projectForReasoning(params.project);
  if (!hasActiveGoal(reasoningProject, params.memories)) return [];

  const commitmentNodes = reasoningProject.nodes.filter(
    (node) => node.status === 'OPEN' && (node.type === 'NEXT_ACTION' || isCommitmentText(node.text))
  );

  const sourceCommitments = reasoningProject.sources
    .filter((source) => isCommitmentText(`${source.filename} ${source.content}`))
    .map((source) => ({
      source,
      text: source.content,
      createdAt: source.extracted_at,
    }));

  const nodeInsights: Array<Insight | null> = commitmentNodes.map((node) => {
    const ageDays = Math.max(0, (now.getTime() - new Date(node.created_at).getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays < 1 && !/tomorrow|deadline|recruiter/i.test(node.text)) return null;
    const id = makeInsightId(['loose', node.id]);
    if (isDismissed(id)) return null;
    const pack = buildContextPack({
      userId: params.userId,
      query: node.text,
      project: reasoningProject,
      profile: {
        answer_density: 'concise',
        question_frequency: 'moderate',
        challenge_level: 'high',
        evidence_preference: 'research_first',
        brainstorm_style: 'diverge_then_converge',
        uncertainty_style: 'explicit',
      },
      durableMemories: params.memories,
    });
    return {
      id,
      type: 'LOOSE_END',
      title: 'Possible loose end',
      summary: node.text,
      question: `Is this still waiting on you: ${node.text}?`,
      priority: Math.min(1, 0.55 + ageDays * 0.05 + node.impact * 0.25),
      status: 'open',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      evidence: {
        node_ids: [node.id],
        source_ids: node.source_refs,
        excerpts: pack.relevantEvidence,
      },
      context_pack: pack,
    } satisfies Insight;
  });

  const sourceInsights: Array<Insight | null> = sourceCommitments.map(({ source, text }) => {
    const id = makeInsightId(['loose', source.id]);
    if (isDismissed(id)) return null;
    const pack = buildContextPack({
      userId: params.userId,
      query: text,
      project: reasoningProject,
      profile: {
        answer_density: 'concise',
        question_frequency: 'moderate',
        challenge_level: 'high',
        evidence_preference: 'research_first',
        brainstorm_style: 'diverge_then_converge',
        uncertainty_style: 'explicit',
      },
      durableMemories: params.memories,
    });
    return {
      id,
      type: 'LOOSE_END',
      title: source.filename.includes('recruiter') ? 'Pending recruiter response' : 'Possible loose end',
      summary: text,
      question: `Does this need a reply or next step: ${source.filename}?`,
      priority: source.filename.includes('recruiter') ? 0.82 : 0.68,
      status: 'open',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      evidence: {
        node_ids: source.derived_node_ids,
        source_ids: [source.id],
        excerpts: pack.relevantEvidence,
      },
      context_pack: pack,
    } satisfies Insight;
  });

  const insights: Insight[] = [...nodeInsights, ...sourceInsights].filter(
    (insight): insight is Insight => insight !== null
  );

  return insights
    .sort((a, b) => b.priority - a.priority);
}
