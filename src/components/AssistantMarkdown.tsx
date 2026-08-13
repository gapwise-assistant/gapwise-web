import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sourceIdFromCitation } from '@/lib/ask/citations';

interface AssistantMarkdownProps {
  children: string;
  onSourceOpen?: (sourceId: string) => void;
}

export const AssistantMarkdown: React.FC<AssistantMarkdownProps> = ({ children, onSourceOpen }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    components={{
      p: ({ children: content }) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{content}</p>,
      h1: ({ children: content }) => <h1 className="mb-2 mt-4 text-lg font-extrabold text-slate-100 first:mt-0">{content}</h1>,
      h2: ({ children: content }) => <h2 className="mb-2 mt-4 text-base font-extrabold text-slate-100 first:mt-0">{content}</h2>,
      h3: ({ children: content }) => <h3 className="mb-2 mt-3 text-sm font-bold text-slate-100 first:mt-0">{content}</h3>,
      ul: ({ children: content }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-cyan-400">{content}</ul>,
      ol: ({ children: content }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:font-semibold marker:text-cyan-400">{content}</ol>,
      li: ({ children: content }) => <li className="pl-1 leading-relaxed">{content}</li>,
      strong: ({ children: content }) => <strong className="font-bold text-slate-100">{content}</strong>,
      em: ({ children: content }) => <em className="text-slate-300">{content}</em>,
      blockquote: ({ children: content }) => (
        <blockquote className="my-3 border-l-2 border-cyan-700 pl-3 text-slate-400">{content}</blockquote>
      ),
      a: ({ children: content, href }) => {
        const sourceId = sourceIdFromCitation(href);
        if (sourceId && onSourceOpen) {
          return (
            <button
              type="button"
              onClick={() => onSourceOpen(sourceId)}
              title="Open source and explanation"
              className="mx-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-cyan-700 bg-cyan-950 px-1.5 align-text-top text-[10px] font-extrabold text-cyan-200 hover:bg-cyan-900"
            >
              {content}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold text-cyan-300 underline decoration-cyan-700 underline-offset-2 hover:text-cyan-200"
          >
            {content}
          </a>
        );
      },
      code: ({ children: content, className }) => {
        const fenced = Boolean(className?.startsWith('language-'));
        return fenced ? (
          <code className={`${className ?? ''} block min-w-max font-mono text-xs leading-relaxed text-slate-200`}>
            {content}
          </code>
        ) : (
          <code className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-200">
            {content}
          </code>
        );
      },
      pre: ({ children: content }) => (
        <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-3">{content}</pre>
      ),
      table: ({ children: content }) => (
        <table className="my-3 block max-w-full overflow-x-auto border-collapse text-left text-xs">{content}</table>
      ),
      th: ({ children: content }) => <th className="border border-slate-700 bg-slate-950 px-3 py-2 font-bold text-slate-100">{content}</th>,
      td: ({ children: content }) => <td className="border border-slate-700 px-3 py-2 align-top text-slate-300">{content}</td>,
      hr: () => <hr className="my-4 border-slate-700" />,
    }}
  >
    {children}
  </ReactMarkdown>
);
