import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemoryView } from '@/components/MemoryView';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { DurableMemory } from '@/types/contextPack';

const memory: DurableMemory = {
  id: 'memory_settings_1',
  category: 'current_priorities',
  text: 'Remember that accessibility is a priority.',
  source: 'explicit',
  source_refs: [],
  confidence: 0.92,
  created_at: '2026-08-28T12:00:00.000Z',
  updated_at: '2026-08-28T12:00:00.000Z',
  last_confirmed_at: '2026-08-28T12:00:00.000Z',
  why_remembered: 'Explicit stable preference or priority stated by the user.',
};

describe('MemoryView drawer controls', () => {
  it('shows one overflow menu by default and hides direct confirmation actions', () => {
    const html = renderToStaticMarkup(
      <MemoryView
        profile={DEFAULT_USER_PROFILE}
        memories={[memory]}
        onUpdateProfile={vi.fn()}
        onUpdateMemories={vi.fn()}
        section="memory"
        variant="drawer"
      />,
    );

    expect(html).toContain(memory.text);
    expect(html).toContain('current priorities');
    expect(html).toContain('Memory actions for Remember that accessibility is a priority.');
    expect(html.match(/aria-label="Memory actions for/g)).toHaveLength(1);
    expect(html).not.toContain('>Confirm<');
    expect(html).not.toContain('>Forget<');
    expect(html).not.toContain('>Remove<');
  });
});
