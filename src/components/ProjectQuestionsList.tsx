import { ChevronRight } from 'lucide-react';
import type { ClarityNode } from '@/types/clarity';
import type { AnsweredQuestion } from '@/lib/questions/history';

interface ProjectQuestionsListProps {
  openQuestions: ClarityNode[];
  answeredQuestions: AnsweredQuestion[];
  projectId: string;
  onAnswerQuestion: (node: ClarityNode, intent?: 'confirm' | 'correct') => void;
  onEditAnsweredQuestion: (item: AnsweredQuestion, projectId: string) => void;
}

function rowKey(item: AnsweredQuestion): string {
  return `${item.timestamp}-${item.question}`;
}

function answerPreview(answer: string): string {
  return answer.replace(/\s+/g, ' ').trim() || 'Answer recorded';
}

function OpenQuestionRow({
  node,
  onAnswerQuestion,
}: {
  node: ClarityNode;
  onAnswerQuestion: ProjectQuestionsListProps['onAnswerQuestion'];
}) {
  const answer = () => onAnswerQuestion(node, node.type === 'ASSUMPTION' ? 'confirm' : undefined);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <button type="button" onClick={answer} className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-bold leading-snug text-slate-100 sm:text-[15px]">{node.text}</span>
        <span className="mt-1 block text-xs font-semibold text-slate-500">Unanswered</span>
      </button>
      <button
        type="button"
        onClick={answer}
        aria-label={`Answer ${node.text}`}
        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border border-cyan-700/80 bg-cyan-950/30 px-3 py-2 text-xs font-bold text-cyan-200 hover:border-cyan-500 hover:bg-cyan-900/40 sm:min-h-0"
      >
        Answer
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function AnsweredQuestionRow({
  item,
  projectId,
  onEditAnsweredQuestion,
}: {
  item: AnsweredQuestion;
  projectId: string;
  onEditAnsweredQuestion: ProjectQuestionsListProps['onEditAnsweredQuestion'];
}) {
  const answer = answerPreview(item.answer);

  return (
    <button
      type="button"
      onClick={() => onEditAnsweredQuestion(item, projectId)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500 sm:px-5"
      title={`Edit answer: ${item.question}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-snug text-slate-100 sm:text-[15px]">{item.question}</span>
        <span className="mt-1 block truncate text-xs font-semibold text-emerald-300/90" title={answer}>
          Answered · {answer}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
    </button>
  );
}

export function ProjectQuestionsList({
  openQuestions,
  answeredQuestions,
  projectId,
  onAnswerQuestion,
  onEditAnsweredQuestion,
}: ProjectQuestionsListProps) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="project-open-questions-heading" className="space-y-2">
        <h2 id="project-open-questions-heading" className="text-lg font-extrabold text-slate-100">
          Open questions
        </h2>
        <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {openQuestions.length ? openQuestions.map((node) => (
            <OpenQuestionRow key={node.id} node={node} onAnswerQuestion={onAnswerQuestion} />
          )) : (
            <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">No open project questions right now.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="project-answered-questions-heading" className="space-y-2">
        <h2 id="project-answered-questions-heading" className="text-lg font-extrabold text-slate-100">
          Answered
        </h2>
        <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {answeredQuestions.length ? answeredQuestions.map((item) => (
            <AnsweredQuestionRow
              key={rowKey(item)}
              item={item}
              projectId={projectId}
              onEditAnsweredQuestion={onEditAnsweredQuestion}
            />
          )) : (
            <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">No answered questions yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
