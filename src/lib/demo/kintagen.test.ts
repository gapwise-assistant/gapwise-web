import { describe, expect, it } from 'vitest';
import { createKintaGenDemoProject, KINTAGEN_DEMO_ID } from './kintagen';

describe('KintaGen scientific AI assistant demo', () => {
  it('is a detailed deterministic project seed', () => {
    const first = createKintaGenDemoProject();
    const second = createKintaGenDemoProject();
    expect(first).toEqual(second);
    expect(first.id).toBe(KINTAGEN_DEMO_ID);
    expect(first.title).toContain('KintaGen');
    expect(first.title).toContain('Scientific AI Assistant');
    expect(first.sources.length).toBeGreaterThanOrEqual(16);
    expect(first.nodes.length).toBeGreaterThanOrEqual(50);
    expect(first.edges.length).toBeGreaterThanOrEqual(40);
    expect(first.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').length).toBeGreaterThanOrEqual(10);
    expect(first.nodes.filter((node) => node.type === 'DECISION').length).toBeGreaterThanOrEqual(7);
    expect(first.nodes.filter((node) => node.type === 'RISK').length).toBeGreaterThanOrEqual(7);
    expect(first.active_question?.node_id).toBeTruthy();
  });
});
