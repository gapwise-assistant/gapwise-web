import { describe, expect, it } from 'vitest';
import {
  BAKERY_DEMO_ID,
  BAKERY_LAUNCH_PLANNING_NOTES,
  BAKERY_LAUNCH_PLANNING_NOTES_ID,
  createBakeryDemoMemories,
  createBakeryDemoProject,
} from './bakery';
import { DEFAULT_USER_PROFILE } from './seed';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { generateFocusAssessment } from '@/lib/focus/focusAssessment';

describe('weekend bakery pop-up demo', () => {
  it('starts with no deadline and exactly one user context note', () => {
    const project = createBakeryDemoProject();

    expect(project.id).toBe(BAKERY_DEMO_ID);
    expect(project.title).toBe('Launch a weekend bakery pop-up');
    expect(project.goal).toBe('Launch a weekend bakery pop-up within eight weeks, prove repeat demand, and reach positive unit economics without taking on large fixed costs too early.');
    expect(project.deadline).toBeUndefined();
    expect(project.one_sentence_context).toBeUndefined();
    expect(project.sources).toEqual([
      expect.objectContaining({
        id: BAKERY_LAUNCH_PLANNING_NOTES_ID,
        filename: 'Bakery Expansion and Launch Planning',
        type: 'note',
        origin: 'user',
        content: BAKERY_LAUNCH_PLANNING_NOTES,
      }),
    ]);
    expect(createBakeryDemoMemories()).toEqual([]);
  });

  it('keeps the open choices distinct from preferences and sequences location before pricing', () => {
    const project = createBakeryDemoProject();

    expect(project.nodes.filter((node) => node.type === 'DECISION' && node.status === 'OPEN').map((node) => node.id)).toEqual([
      'bakery_location_decision',
      'bakery_products_decision',
      'bakery_pricing_decision',
      'bakery_sales_channel_decision',
      'bakery_supplier_decision',
      'bakery_marketing_mix_decision',
      'bakery_repeat_measurement_decision',
    ]);
    expect(project.nodes.find((node) => node.id === 'bakery_initial_menu_preference')).toMatchObject({
      type: 'PREFERENCE',
      status: 'RESOLVED',
    });
    expect(project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'bakery_pricing_decision',
        target: 'bakery_location_decision',
        type: 'depends_on',
      }),
      expect.objectContaining({
        source: 'bakery_select_location_action',
        target: 'bakery_location_decision',
        type: 'satisfies',
      }),
    ]));
  });

  it('recreates the exact same resettable seed', () => {
    expect(createBakeryDemoProject()).toEqual(createBakeryDemoProject());
  });

  it('focuses the location decision before its dependent pricing and permit action', async () => {
    const previousDemoMode = process.env.GAPSWISE_DEMO_MODE;
    process.env.GAPSWISE_DEMO_MODE = 'true';
    try {
      const project = createBakeryDemoProject();
      const contextPack = buildContextPack({
        userId: 'bakery-demo-user',
        query: 'What needs my attention today?',
        project,
        profile: DEFAULT_USER_PROFILE,
        durableMemories: [],
        includeBroadContext: true,
      });

      const focus = await generateFocusAssessment(project, contextPack, DEFAULT_USER_PROFILE);

      expect(focus).toMatchObject({
        kind: 'decision',
        targetNodeId: 'bakery_location_decision',
        actionNodeId: 'bakery_location_decision',
      });
    } finally {
      if (previousDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
      else process.env.GAPSWISE_DEMO_MODE = previousDemoMode;
    }
  });
});
