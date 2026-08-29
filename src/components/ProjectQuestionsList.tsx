import { Check, Eye, EyeOff, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ClarityNode } from '@/types/clarity';
import { resolvedGapMatchesHistory } from '@/lib/questions/history';
import type { AnsweredQuestion, ResolvedGapRecord } from '@/lib/questions/history';
import { normalizeQuestionGrammar, resolveQuestionReferences } from '@/lib/questions/presentation';

interface ProjectQuestionsListProps {
  openQuestions: ClarityNode[];
  answeredQuestions: AnsweredQuestion[];
  openDecisions: ClarityNode[];
  resolvedDecisions?: ClarityNode[];
  resolvedGaps?: ResolvedGapRecord[];
  projectId: string;
  sourceContents?: string[];
  onAnswerQuestion: (node: ClarityNode, intent?: 'confirm' | 'correct') => void;
  onEditAnsweredQuestion: (item: AnsweredQuestion, projectId: string) => void;
  onReviewDecision: (nodeId: string) => void;
  onOpenResolvedGap?: (record: ResolvedGapRecord) => void;
  initialStatusFilter?: GapStatusFilter;
  readOnly?: boolean;
}

export type GapStatusFilter = 'all' | 'open' | 'resolved';

interface GapRow {
  id: string;
  text: string;
  displayText: string;
  status: 'open' | 'resolved';
  kind: 'question' | 'decision';
  question?: ClarityNode;
  answeredQuestion?: AnsweredQuestion;
  node?: ClarityNode;
  resolvedGap?: ResolvedGapRecord;
  resolution?: string;
}

function rowKey(item: AnsweredQuestion): string {
  return item.nodeId ? `answered:${item.nodeId}:${item.timestamp}` : `${item.timestamp}-${item.question}`;
}

function sortGaps(left: GapRow, right: GapRow): number {
  if (left.status !== right.status) return left.status === 'open' ? -1 : 1;
  return left.text.localeCompare(right.text);
}

function GapRowButton({ gap, onOpen, showResolution = false }: { gap: GapRow; onOpen?: () => void; showResolution?: boolean }) {
  const resolved = gap.status === 'resolved';
  const className = `flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${onOpen ? 'hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500' : ''} sm:px-5 ${resolved ? 'bg-slate-950/25' : ''}`;
  const content = (
    <>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${resolved ? 'border-slate-700 text-slate-500' : 'border-cyan-700 text-cyan-400'}`} aria-hidden="true">
        {resolved ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 block text-sm font-bold leading-snug sm:text-[15px] ${resolved ? 'text-slate-500' : 'text-slate-100'}`}>
          {gap.displayText}
        </span>
        {showResolution && resolved && gap.resolution && (
          <span className="mt-1 block whitespace-pre-wrap break-words text-xs font-normal leading-relaxed text-slate-500">
            {gap.resolution}
          </span>
        )}
      </span>
      {onOpen && <span className={`shrink-0 text-xs ${resolved ? 'text-slate-700' : 'text-slate-600'}`} aria-hidden="true">›</span>}
    </>
  );

  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className={className}
      title={resolved ? 'View resolved gap details' : 'Open gap details'}
    >
      {content}
    </button>
  ) : (
    <div className={className} aria-label={resolved ? 'Resolved workspace gap' : 'Open workspace gap'}>
      {content}
    </div>
  );
}

export function ProjectQuestionsList({
  openQuestions,
  answeredQuestions,
  openDecisions,
  resolvedDecisions = [],
  resolvedGaps = [],
  projectId,
  sourceContents = [],
  onAnswerQuestion,
  onEditAnsweredQuestion,
  onReviewDecision,
  onOpenResolvedGap,
  initialStatusFilter,
  readOnly = false,
}: ProjectQuestionsListProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<GapStatusFilter>(initialStatusFilter ?? 'all');
  const [hideResolved, setHideResolved] = useState(false);

  useEffect(() => {
    if (initialStatusFilter) setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  const gaps = useMemo<GapRow[]>(() => {
    const coveredHistory = (item: AnsweredQuestion) => resolvedGaps.some((record) =>
      resolvedGapMatchesHistory(record, item),
    );
    const resolvedHistoryFallback = answeredQuestions
      .filter((item) => !coveredHistory(item))
      .map((item) => ({
        id: rowKey(item),
        text: item.question,
        displayText: normalizeQuestionGrammar(resolveQuestionReferences(item.question, sourceContents.join('\n'))),
        status: 'resolved' as const,
        kind: 'question' as const,
        answeredQuestion: item,
        resolution: item.answer,
      }));
    const legacyDecisionFallback = resolvedGaps.length === 0
      ? resolvedDecisions.map((node) => ({
        id: node.id,
        text: node.text,
        displayText: normalizeQuestionGrammar(resolveQuestionReferences(node.text, sourceContents.join('\n'))),
        status: 'resolved' as const,
        kind: 'decision' as const,
        node,
        resolution: node.decision_outcome,
      }))
      : [];
    return [
      ...openQuestions.map((node) => ({
        id: node.id,
        text: node.text,
        displayText: normalizeQuestionGrammar(resolveQuestionReferences(node.text, sourceContents.join('\n'))),
        status: 'open' as const,
        kind: 'question' as const,
        question: node,
      })),
      ...openDecisions.map((node) => ({
        id: node.id,
        text: node.text,
        displayText: normalizeQuestionGrammar(resolveQuestionReferences(node.text, sourceContents.join('\n'))),
        status: 'open' as const,
        kind: 'decision' as const,
        node,
      })),
      ...resolvedGaps.map((record) => ({
        id: `resolved:${record.nodeId}`,
        text: record.prompt,
        displayText: normalizeQuestionGrammar(resolveQuestionReferences(record.prompt, sourceContents.join('\n'))),
        status: 'resolved' as const,
        kind: record.kind === 'decision' ? 'decision' as const : 'question' as const,
        resolvedGap: record,
        resolution: record.resolution,
      })),
      ...resolvedHistoryFallback,
      ...legacyDecisionFallback,
    ].sort(sortGaps);
  }, [answeredQuestions, openDecisions, openQuestions, resolvedDecisions, resolvedGaps, sourceContents]);

  const filteredGaps = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return gaps.filter((gap) => {
      if (hideResolved && gap.status === 'resolved') return false;
      if (statusFilter !== 'all' && gap.status !== statusFilter) return false;
      return !normalizedQuery || gap.text.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [gaps, hideResolved, query, statusFilter]);

  const openGaps = filteredGaps.filter((gap) => gap.status === 'open');
  const visibleResolvedGaps = filteredGaps.filter((gap) => gap.status === 'resolved');

  const openGap = (gap: GapRow) => {
    if (readOnly) return;
    if (gap.resolvedGap && onOpenResolvedGap) {
      onOpenResolvedGap(gap.resolvedGap);
      return;
    }
    if (gap.kind === 'decision' && gap.node) {
      onReviewDecision(gap.node.id);
      return;
    }
    if (gap.answeredQuestion) {
      onEditAnsweredQuestion(gap.answeredQuestion, gap.answeredQuestion.projectId ?? projectId);
      return;
    }
    if (gap.question) {
      onAnswerQuestion({ ...gap.question, text: gap.displayText }, gap.question.type === 'ASSUMPTION' ? 'confirm' : undefined);
    }
  };

  const renderSection = (title: string, items: GapRow[], emptyText: string) => (
    <section aria-labelledby={`workspace-${title.toLocaleLowerCase()}-gaps-heading`} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`workspace-${title.toLocaleLowerCase()}-gaps-heading`} className={`text-sm font-extrabold ${title === 'Resolved' ? 'text-slate-500' : 'text-slate-100'}`}>
          {title}
        </h2>
        {title === 'Resolved' && (
          <button
            type="button"
            onClick={() => setHideResolved(true)}
            aria-label="Hide resolved gaps"
            title="Hide resolved gaps"
            className="rounded-md p-1 text-slate-600 hover:bg-slate-900 hover:text-slate-300"
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {items.length ? items.map((gap) => <GapRowButton key={gap.id} gap={gap} onOpen={readOnly ? undefined : () => openGap(gap)} showResolution={readOnly} />) : (
          <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">{emptyText}</p>
        )}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">GAPS</p>
        <h2 className="mt-2 text-xl font-extrabold text-slate-100">Workspace gaps</h2>
        <p className="mt-1 text-sm text-slate-500">Open uncertainties and resolved items in one place.</p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search gaps</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search gaps"
            className="min-h-10 w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-600"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter gaps by status">
          {(['all', 'open', 'resolved'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              aria-pressed={statusFilter === filter}
              className={`min-h-9 rounded-md px-2.5 py-1.5 text-xs font-bold capitalize ${statusFilter === filter ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'}`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {hideResolved && (
        <button
          type="button"
          onClick={() => setHideResolved(false)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-200"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Show resolved gaps
        </button>
      )}
      {statusFilter !== 'resolved' && renderSection('Open', openGaps, 'No open gaps match this view.')}
      {statusFilter !== 'open' && !hideResolved && renderSection('Resolved', visibleResolvedGaps, 'No resolved gaps match this view.')}
    </div>
  );
}
