import type { AskSource } from '@/lib/ask/adkClient';

const STOP_WORDS = new Set([
  'about', 'after', 'before', 'could', 'from', 'have', 'into', 'should', 'that', 'their',
  'there', 'these', 'they', 'this', 'those', 'what', 'when', 'where', 'which', 'with',
  'would', 'your', 'and', 'are', 'for', 'the', 'you',
]);

function terms(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[`*_#[\]()]/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
  ));
}

function sourceScore(block: string, source: AskSource): number {
  const blockTerms = terms(block);
  if (!blockTerms.length) return 0;
  const sourceText = [source.title, source.excerpt, ...(source.supports ?? [])].join(' ').toLowerCase();
  const matches = blockTerms.filter((term) => sourceText.includes(term)).length;
  return matches / blockTerms.length;
}

export function sourceCitationHref(sourceId: string): string {
  return `#source-${encodeURIComponent(sourceId)}`;
}

export function sourceIdFromCitation(href?: string): string | null {
  if (!href?.startsWith('#source-')) return null;
  try {
    return decodeURIComponent(href.slice('#source-'.length));
  } catch {
    return null;
  }
}

export function addSourceCitations(answer: string, sources: AskSource[]): string {
  if (!sources.length || answer.includes('](#source-')) return answer;
  let inCodeFence = false;
  const blocks = answer.split(/\n{2,}/).map((block) => {
    const fenceCount = (block.match(/```/g) ?? []).length;
    const isCode = inCodeFence || block.trimStart().startsWith('```');
    if (fenceCount % 2 === 1) inCodeFence = !inCodeFence;
    if (isCode || /^#{1,6}\s/.test(block.trim()) || block.trim().length < 24) return block;

    const matches = sources
      .map((source, index) => ({ source, index, score: sourceScore(block, source) }))
      .filter((item) => item.score >= 0.22)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    if (!matches.length) return block;

    const citations = matches
      .map(({ source, index }) => `[${index + 1}](${sourceCitationHref(source.id)})`)
      .join(' ');
    return `${block} ${citations}`;
  });
  return blocks.join('\n\n');
}
