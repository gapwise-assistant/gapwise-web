import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { Insight } from '@/types/insight';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { projectForReasoning } from '@/lib/context/sourceState';
import { isDismissed, makeInsightId } from '@/lib/insights/common';

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

function isVolatileMemory(memory: DurableMemory): boolean {
  return memory.category === 'current_priorities' || /priority|for the next|financial|deadline/i.test(memory.text);
}

export function detectStaleContext(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  now?: Date;
  ttlDays?: number;
}): Insight[] {
  const reasoningProject = projectForReasoning(params.project);
  const now = params.now ?? new Date();
  const ttlDays = params.ttlDays ?? 30;
  const insights: Insight[] = [];

  params.memories
    .filter((memory) => !memory.forgotten_at && isVolatileMemory(memory))
    .forEach((memory) => {
      const lastChecked = new Date(memory.last_confirmed_at ?? memory.updated_at);
      if (daysBetween(now, lastChecked) < ttlDays) return;
      const id = makeInsightId(['stale_memory', memory.id]);
      if (isDismissed(id)) return;
      const pack = buildContextPack({
        userId: params.userId,
        query: memory.text,
        project: params.project,
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
      insights.push({
        id,
        type: 'STALE_CONTEXT',
        title: 'Priority may need reconfirmation',
        summary: memory.text,
        question: 'Is this still true, changed, or no longer relevant?',
        priority: memory.confidence >= 0.8 ? 0.78 : 0.62,
        status: 'open',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        evidence: {
          node_ids: [],
          source_ids: memory.source_refs,
          excerpts: pack.relevantEvidence,
        },
        context_pack: pack,
      });
    });

  reasoningProject.nodes
    .filter((node) => node.status === 'OPEN' && node.impact >= 0.75 && ['ASSUMPTION', 'RISK'].includes(node.type))
    .forEach((node) => {
      if (daysBetween(now, new Date(node.updated_at)) < ttlDays) return;
      const id = makeInsightId(['stale_node', node.id]);
      if (isDismissed(id)) return;
      const pack = buildContextPack({
        userId: params.userId,
        query: node.text,
        project: params.project,
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
      insights.push({
        id,
        type: 'STALE_CONTEXT',
        title: 'High-impact context may be stale',
        summary: node.text,
        question: 'Is this still true, changed, or no longer relevant?',
        priority: 0.72,
        status: 'open',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        evidence: {
          node_ids: [node.id],
          source_ids: node.source_refs,
          excerpts: pack.relevantEvidence,
        },
        context_pack: pack,
      });
    });

  return insights.sort((a, b) => b.priority - a.priority);
}
