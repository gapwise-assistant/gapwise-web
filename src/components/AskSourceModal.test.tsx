import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AskSourceModal } from '@/components/AskSourceModal';
import type { AskSource } from '@/types/ask';

const internalSource: AskSource = {
  id: 'source-internal-1',
  title: 'Initial context',
  kind: 'source',
  excerpt: 'The first line of relevant context.\nThe second line stays readable.',
  reason: 'This project context directly addresses the question.',
};

const webSource: AskSource = {
  id: 'source-web-1',
  title: 'Official project guidance',
  kind: 'web',
  excerpt: 'A current externally verified detail.',
  reason: 'This web source was used to verify the current detail.',
  url: 'https://example.com/guidance',
};

describe('AskSourceModal', () => {
  it('renders source context in a centered dialog rather than a right-side drawer', () => {
    const html = renderToStaticMarkup(<AskSourceModal sources={[internalSource]} onClose={() => {}} />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Source context');
    expect(html).toContain('Project context');
    expect(html).toContain('The first line of relevant context.');
    expect(html).toContain('The second line stays readable.');
    expect(html).toContain('Why it was used');
    expect(html).toContain('justify-center');
    expect(html).not.toContain('justify-end');
    expect(html).not.toContain('sm:h-full');
  });

  it('shows safe external links only for web sources', () => {
    const internalHtml = renderToStaticMarkup(<AskSourceModal sources={[internalSource]} onClose={() => {}} />);
    const webHtml = renderToStaticMarkup(<AskSourceModal sources={[webSource]} onClose={() => {}} />);

    expect(internalHtml).not.toContain('<a ');
    expect(webHtml).toContain('href="https://example.com/guidance"');
    expect(webHtml).toContain('target="_blank"');
    expect(webHtml).toContain('rel="noreferrer noopener"');
    expect(webHtml).toContain('Web source');
    expect(webHtml).toContain('Close source context');
  });
});
