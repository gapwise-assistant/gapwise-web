import { Project } from '@/types/clarity';
import { activeContextSources } from '@/lib/context/sourceState';

export function retrieveRelevantSources(project: Project, query: string, limit = 3) {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);

  return activeContextSources(project)
    .map((source) => {
      const content = `${source.filename} ${source.content}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (content.includes(term) ? 1 : 0), 0);
      return { source, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.source);
}
