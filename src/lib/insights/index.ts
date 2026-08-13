import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { Insight } from '@/types/insight';
import { detectContextConflicts } from '@/lib/insights/conflicts';
import { detectLooseEnds } from '@/lib/insights/looseEnds';
import { detectStaleContext } from '@/lib/insights/stale';

export function detectInsights(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  now?: Date;
}): Insight[] {
  return [
    ...detectLooseEnds(params),
    ...detectContextConflicts(params),
    ...detectStaleContext(params),
  ]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}
