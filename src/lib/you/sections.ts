import { ClarityNode, Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { activeMemories } from '@/lib/memory/store';
import { projectForReasoning } from '@/lib/context/sourceState';

export function currentPriorities(memories: DurableMemory[]): DurableMemory[] {
  return activeMemories(memories)
    .filter((memory) => memory.category === 'current_priorities')
    .sort((a, b) => b.confidence - a.confidence);
}

export function activeGoals(project: Project): ClarityNode[] {
  return projectForReasoning(project).nodes
    .filter((node) => node.type === 'GOAL' && node.status !== 'DEPRECATED')
    .sort((a, b) => b.impact - a.impact);
}

export function unresolvedPersonalQuestions(project: Project): ClarityNode[] {
  return projectForReasoning(project).nodes
    .filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && node.status === 'OPEN')
    .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact))
    .slice(0, 8);
}

export function userLevelUnresolvedQuestions(projects: Project[]): ClarityNode[] {
  const seen = new Set<string>();
  return projects
    .flatMap((project) => projectForReasoning(project).nodes)
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      if ((node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION') || node.status !== 'OPEN') return false;
      const text = node.text.toLowerCase();
      return /\b(you|your|user|role|career|priority|priorities|preference|direction|relocation|working style|ultimately|personal)\b/.test(
        text
      );
    })
    .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact))
    .slice(0, 6);
}

export function highImpactProjectGaps(project: Project): ClarityNode[] {
  return projectForReasoning(project).nodes
    .filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION' || node.type === 'RISK') && node.status === 'OPEN')
    .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact));
}
