import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';

describe('AssistantMarkdown', () => {
  it('renders common agent Markdown as structured HTML', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown>{`## Focus next

- **Define** the demo persona
- Review \`contextPack\`

[Open docs](https://example.com)`}</AssistantMarkdown>
    );

    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('<strong');
    expect(html).toContain('<code');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('## Focus next');
  });

  it('does not render raw HTML from agent responses', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown>{'<script>alert("unsafe")</script>\n\nSafe response'}</AssistantMarkdown>
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(&quot;unsafe&quot;)');
    expect(html).toContain('Safe response');
  });

  it('renders internal citations as source controls', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown onSourceOpen={() => {}}>Supported claim [1](#source-src_2)</AssistantMarkdown>
    );

    expect(html).toContain('Open source and explanation');
    expect(html).toContain('<button');
  });
});
