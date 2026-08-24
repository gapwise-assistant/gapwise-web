import { describe, expect, it } from 'vitest';
import { addSourceCitations, sourceIdFromCitation } from '@/lib/ask/citations';
import { AskSource } from '@/lib/ask/adkClient';

const source: AskSource = {
  id: 'src_2',
  title: 'project-brief.txt',
  excerpt: 'The interface may use an interactive visual Clarity Graph.',
  kind: 'source',
  supports: [
    'Judges will value an interactive visual Clarity Graph over a generic chatbot interface.',
  ],
  reason: 'Supports the stored interface assumption.',
};

describe('Ask source citations', () => {
  it('does not add inline markers for ordinary project context', () => {
    const answer = `**Validate Interface Assumptions:**

Decide how prominent the **Interactive Visual Clarity Graph** should be versus a traditional chatbot interface.`;

    const cited = addSourceCitations(answer, [source]);

    expect(cited).not.toContain('#source-');
    expect(cited).toContain('**Interactive Visual Clarity Graph**');
  });

  it('adds inline markers only for grounded web sources', () => {
    const webSource: AskSource = {
      ...source,
      id: 'web_2',
      kind: 'web',
      url: 'https://example.com/reference',
    };
    const cited = addSourceCitations(
      'The interface decision should use an interactive visual Clarity Graph.',
      [source, webSource],
    );

    expect(cited).toContain('[2](#source-web_2)');
  });

  it('does not attach unrelated sources or citations inside code fences', () => {
    expect(addSourceCitations('Review the budget forecast before Friday.', [source])).not.toContain('#source-');
    expect(addSourceCitations('```ts\nconst graph = true;\n```', [source])).not.toContain('#source-');
  });

  it('decodes internal source citation links', () => {
    expect(sourceIdFromCitation('#source-src_2')).toBe('src_2');
    expect(sourceIdFromCitation('https://example.com')).toBeNull();
  });
});
