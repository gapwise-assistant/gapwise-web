import { ClarityNode } from '@/types/clarity';
import { EvidenceExcerpt, SourceLike } from '@/types/contextPack';

const STOP_WORDS = new Set([
  'what',
  'when',
  'where',
  'which',
  'that',
  'this',
  'with',
  'from',
  'have',
  'about',
  'should',
  'could',
  'would',
  'your',
  'you',
  'the',
  'and',
  'for',
  'are',
  'am',
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\W+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

export function relevanceScore(query: string, text: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  const matched = terms.filter((term) => lower.includes(term)).length;
  const density = matched / terms.length;
  const exactBoost = lower.includes(query.toLowerCase()) ? 0.25 : 0;
  return Math.max(0, Math.min(1, Number((density + exactBoost).toFixed(3))));
}

export function rankNodes(query: string, nodes: ClarityNode[], limit: number): ClarityNode[] {
  return nodes
    .map((node) => ({
      node,
      score: relevanceScore(query, `${node.type} ${node.text} ${node.why_it_matters?.join(' ') ?? ''}`),
      priority: node.priority ?? node.impact,
    }))
    .filter((item) => item.score > 0 || item.priority >= 0.75)
    .sort((a, b) => b.score + b.priority * 0.2 - (a.score + a.priority * 0.2))
    .slice(0, limit)
    .map((item) => item.node);
}

type TemporalSourceKind = 'pdf' | 'note' | 'document' | 'file';

interface TemporalSourceIntent {
  kind?: TemporalSourceKind;
}

function detectTemporalSourceIntent(query: string): TemporalSourceIntent | null {
  const lower = query.toLowerCase();
  const hasTemporalIntent = /\b(latest|newest|most recent|last uploaded|last added|last)\b/.test(lower);
  const mentionsSource = /\b(pdf|document|doc|note|file|upload|uploaded|source)\b/.test(lower);

  if (!hasTemporalIntent || !mentionsSource) {
    return null;
  }

  if (/\bpdfs?\b/.test(lower)) return { kind: 'pdf' };
  if (/\bnotes?\b/.test(lower)) return { kind: 'note' };
  if (/\b(documents?|docs?)\b/.test(lower)) return { kind: 'document' };
  if (/\b(files?|uploads?|uploaded)\b/.test(lower)) return { kind: 'file' };
  return {};
}

function isSourceKind(source: SourceLike, kind?: TemporalSourceKind): boolean {
  if (!kind) return true;
  if (kind === 'pdf') {
    return source.type === 'pdf' || source.mime_type === 'application/pdf' || source.filename.toLowerCase().endsWith('.pdf');
  }
  if (kind === 'note') return source.type === 'note';
  if (kind === 'document') return source.type === 'pdf' || source.type === 'text' || source.type === 'note';
  return Boolean(source.storage_url || source.mime_type || source.type === 'pdf' || source.type === 'image' || source.type === 'voice');
}

function sourceTimestamp(source: SourceLike): number {
  const timestamp = source.processed_at ?? source.extracted_at;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function excerptAroundMatch(content: string, query: string, maxLength = 220): string {
  const terms = tokenize(query);
  const lower = content.toLowerCase();
  const firstIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 60);
  const excerpt = content.slice(start, start + maxLength).trim();
  return `${start > 0 ? '...' : ''}${excerpt}${start + maxLength < content.length ? '...' : ''}`;
}

function sourceSearchText(source: SourceLike): string {
  // Put the compact extraction first so the selected excerpt starts with the
  // source's conclusion instead of the beginning of a long document.
  return `${source.filename} ${source.extraction_summary ?? ''} ${source.content}`.trim();
}

function broadSourceExcerpt(source: SourceLike, maxLength = 320): string {
  return `${source.content || ''} ${source.extraction_summary || ''}`.trim().slice(0, maxLength);
}

export function rankSources(
  query: string,
  sources: SourceLike[],
  limit: number,
  options: {
    includeUnmatched?: boolean;
    preferredSourceIds?: ReadonlySet<string>;
    recencyWeight?: number;
    minimumSemanticScore?: number;
  } = {}
): EvidenceExcerpt[] {
  const temporalIntent = detectTemporalSourceIntent(query);
  const candidateSources = temporalIntent ? sources.filter((source) => isSourceKind(source, temporalIntent.kind)) : sources;
  const maxTimestamp = temporalIntent
    ? Math.max(...candidateSources.map((source) => sourceTimestamp(source)))
    : 0;
  const selectedSources =
    temporalIntent && Number.isFinite(maxTimestamp)
      ? candidateSources.filter((source) => sourceTimestamp(source) === maxTimestamp)
      : candidateSources;

  const timestamps = Array.from(new Set(selectedSources.map(sourceTimestamp))).sort((a, b) => a - b);
  const newestIndex = Math.max(1, timestamps.length - 1);
  const recencyWeight = options.recencyWeight ?? 0;
  const ranked = selectedSources
    .map((source) => ({
      source,
      score: relevanceScore(query, sourceSearchText(source)),
    }))
    .filter((item) => temporalIntent
      || options.includeUnmatched
      || item.score >= (options.minimumSemanticScore ?? Number.EPSILON))
    .map((item) => {
      const timestampIndex = Math.max(0, timestamps.indexOf(sourceTimestamp(item.source)));
      const recency = timestampIndex / newestIndex;
      const relevanceScale = Math.min(1, item.score / 0.2);
      const preferredBoost = options.preferredSourceIds?.has(item.source.id) ? 0.3 : 0;
      const recencyBoost = temporalIntent ? 0 : recencyWeight * recency * relevanceScale;
      return {
        ...item,
        rankingScore: Math.min(1, item.score + preferredBoost + recencyBoost),
      };
    })
    .sort((a, b) => temporalIntent
      ? sourceTimestamp(b.source) - sourceTimestamp(a.source) || b.score - a.score
      : b.rankingScore - a.rankingScore || sourceTimestamp(b.source) - sourceTimestamp(a.source))
    .slice(0, limit)
    .map(({ source, rankingScore }) => ({
      source_id: source.id,
      filename: source.filename,
      excerpt: options.includeUnmatched
        ? broadSourceExcerpt(source)
        : excerptAroundMatch(sourceSearchText(source), query),
      score: Number(rankingScore.toFixed(3)),
      derived_node_ids: source.derived_node_ids,
    }));

  return ranked;
}
