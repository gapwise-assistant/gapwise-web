import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('uses shared variants, sizes, and focus treatment', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" size="md" icon={<span aria-hidden="true">→</span>}>
        Resolve
      </Button>,
    );

    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('data-size="md"');
    expect(html).toContain('h-10');
    expect(html).toContain('rounded-md');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain('Resolve');
  });

  it('keeps the button disabled and dimensioned while loading', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" size="sm" loading>
        Save
      </Button>,
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('h-8');
    expect(html).toContain('Save');
    expect(html).toContain('animate-spin');
  });
});
