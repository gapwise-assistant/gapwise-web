import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { Insight } from '@/types/insight';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { projectForReasoning } from '@/lib/context/sourceState';
import { isDismissed, makeInsightId } from '@/lib/insights/common';

const PERSONA_PATTERNS = [
  { key: 'founder', terms: ['founder', 'startup founder'] },
  { key: 'student', terms: ['student', 'researcher'] },
  { key: 'consultant', terms: ['consultant', 'agency'] },
  { key: 'hackathon_builder', terms: ['hackathon builder', 'builder under deadline'] },
];

function personaKey(text: string): string | null {
  const lower = text.toLowerCase();
  return PERSONA_PATTERNS.find((pattern) => pattern.terms.some((term) => lower.includes(term)))?.key ?? null;
}

function isTargetPersonaStatement(text: string): boolean {
  return /target persona|primary persona|target user|demo scenario/i.test(text);
}

export function detectContextConflicts(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  now?: Date;
}): Insight[] {
  const now = params.now ?? new Date();
  const reasoningProject = projectForReasoning(params.project);
  const relevantNodes = reasoningProject.nodes.filter((node) => isTargetPersonaStatement(node.text));
  const insights: Insight[] = [];

  for (let i = 0; i < relevantNodes.length; i += 1) {
    for (let j = i + 1; j < relevantNodes.length; j += 1) {
      const a = relevantNodes[i];
      const b = relevantNodes[j];
      const aPersona = personaKey(a.text);
      const bPersona = personaKey(b.text);
      if (!aPersona || !bPersona || aPersona === bPersona) continue;
      const id = makeInsightId(['context_change', a.id, b.id]);
      if (isDismissed(id)) continue;
      const pack = buildContextPack({
        userId: params.userId,
        query: `${a.text} ${b.text}`,
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
      insights.push({
        id,
        type: 'POSSIBLE_CONTEXT_CHANGE',
        title: 'Possible target-persona change',
        summary: 'Two target-persona statements point in different directions.',
        question: 'Did your target persona change, or should one of these statements be retired?',
        priority: 0.84,
        status: 'open',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        evidence: {
          node_ids: [a.id, b.id],
          source_ids: [...a.source_refs, ...b.source_refs],
          excerpts: pack.relevantEvidence,
        },
        context_pack: pack,
      });
    }
  }

  return insights;
}
