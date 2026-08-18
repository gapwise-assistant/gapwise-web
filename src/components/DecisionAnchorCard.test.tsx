import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DecisionAnchorCard } from '@/components/DecisionAnchorCard';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { ingestContextSource } from '@/lib/context/ingestion';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

describe('DecisionAnchorCard', () => {
  it('gives an unanchored project a direct way to define its pending decision', async () => {
    const project = await ingestContextSource(createProjectFromInput({ name: 'ClinicFlow', goal: 'Improve intake.' }), {
      sourceId: 'clinic-questions',
      filename: 'questions.md',
      type: 'text',
      content: 'The intake routing is still unclear?',
      derivedNodes: [{ type: 'UNKNOWN', text: 'Is intake routing safe enough?', confidence: 0.4, impact: 0.8 }],
    }, DEFAULT_USER_PROFILE);
    const html = renderToStaticMarkup(<DecisionAnchorCard project={project} onUpdateProject={vi.fn()} />);

    expect(html).toContain('Decision to anchor');
    expect(html).toContain('What decision are you trying to make?');
    expect(html).toContain('Anchor decision');
  });
});
