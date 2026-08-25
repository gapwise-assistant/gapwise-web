import { describe, expect, it } from 'vitest';
import { relationshipGroupsForNode } from './relationshipContext';
import type { Project } from '@/types/clarity';

function projectWithEdges(): Project {
  const node = (id: string, text: string) => ({
    id,
    type: 'KNOWN' as const,
    text,
    status: 'OPEN' as const,
    confidence: 1,
    impact: 0.5,
    source_refs: [],
    created_by: 'user' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  return {
    id: 'relationship-test',
    title: 'Relationship test',
    goal: 'Test relationships',
    clarity_score: 0,
    nodes: [node('pricing', 'Pricing'), node('location', 'Location'), node('evidence', 'Expected prices'), node('isolated', 'Unconnected fact')],
    edges: [
      { id: 'depends', source: 'pricing', target: 'location', type: 'depends_on' },
      { id: 'supports', source: 'evidence', target: 'pricing', type: 'supports' },
    ],
    sources: [],
    history: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('Decision Map relationship inspector model', () => {
  it('translates direct outgoing and incoming relationships from each node perspective', () => {
    const project = projectWithEdges();
    const pricing = relationshipGroupsForNode(project, 'pricing');
    const location = relationshipGroupsForNode(project, 'location');

    expect(pricing).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Depends on', outgoing: true }),
      expect.objectContaining({ label: 'Supported by', outgoing: false }),
    ]));
    expect(pricing.find((group) => group.label === 'Depends on')?.items[0]?.other.text).toBe('Location');
    expect(location).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Required by', outgoing: false }),
    ]));
    expect(location.find((group) => group.label === 'Required by')?.items[0]?.other.text).toBe('Pricing');
  });

  it('reports no relationships for isolated nodes and keeps actual edge semantics', () => {
    const project = projectWithEdges();

    expect(relationshipGroupsForNode(project, 'isolated')).toEqual([]);
    expect(relationshipGroupsForNode(project, 'pricing').flatMap((group) => group.items.map((item) => item.edge.id)))
      .toEqual(['depends', 'supports']);
  });
});
