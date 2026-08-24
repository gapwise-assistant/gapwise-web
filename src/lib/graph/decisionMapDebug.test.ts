import { describe, expect, it } from 'vitest';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionMapDebugTrace } from './decisionMapDebug';
import { calculateDecisionMapLayout, calculateDecisionMapMetrics } from './constellation';

describe('Decision Map debug trace', () => {
  it('records persisted graph interpretation, focus, visibility, story, and layout without changing the graph', () => {
    const project = createBakeryDemoProject();
    const before = JSON.stringify(project);
    const trace = buildDecisionMapDebugTrace(project, {
      filter: 'all',
      selectedNodeId: 'bakery_location_decision',
      focusMode: true,
      pathMode: true,
      focusAssessment: {
        kind: 'decision',
        title: 'Choose the bakery location',
        actionNodeId: 'bakery_location_decision',
        sourceNodeIds: ['bakery_location_decision'],
        sourceIds: ['bakery_launch_planning_notes'],
        score: 0.91,
        confidence: 0.8,
        whyNow: 'The permit depends on this decision.',
        nextAction: 'Record the location decision.',
      },
      renderer: {
        positions: calculateDecisionMapLayout(project),
        showSecondaryContext: false,
        zoom: 1,
        pan: { x: 0, y: 0 },
        viewport: { width: 1200, height: 700 },
        mapWidth: calculateDecisionMapMetrics(project).width,
        mapHeight: calculateDecisionMapMetrics(project).height,
      },
    });

    expect(trace.schemaVersion).toBe(1);
    expect(trace.rawProjectGraph).toMatchObject({
      projectId: project.id,
      totalNodes: project.nodes.length,
      totalEdges: project.edges.length,
      focusAssessment: { actionNodeId: 'bakery_location_decision' },
    });
    expect(trace.rawProjectGraph.nodes.find((node) => node.id === 'bakery_location_decision')).toMatchObject({
      type: 'DECISION',
      isCurrentFocusAction: true,
      sourceRefs: ['bakery_launch_planning_notes'],
    });
    expect(trace.semanticGraphInterpretation.nodes.find((node) => node.nodeId === 'bakery_pricing_decision')).toMatchObject({
      directPrerequisiteIds: expect.arrayContaining(['bakery_location_decision', 'bakery_products_decision']),
      blocked: true,
    });
    expect(trace.currentFocusAnalysis).toMatchObject({
      actionNode: { id: 'bakery_location_decision', type: 'DECISION', status: 'OPEN' },
      visibleInCurrentMap: true,
    });
    expect(trace.storyBackboneCandidates.suggestedBackbone.length).toBeLessThanOrEqual(8);
    expect(trace.collapseExpansionAnalysis.possibleSupportingClusters.some((cluster) => cluster.parentNodeId === 'bakery_location_decision')).toBe(true);
    expect(trace.whyThisMattersDebug.find((item) => item.selectedNodeId === 'bakery_location_decision')?.selectedPath?.goalNodeId).toBe('bakery_goal');
    expect(trace.filterVisibilityTrace.map((item) => item.filter)).toEqual(['all', 'unresolved', 'critical', 'assumptions']);
    expect(trace.layoutDiagnostics.nodes).toHaveLength(project.nodes.length);
    expect(trace.renderedStoryReadabilitySummary).toMatchObject({
      totalNodes: project.nodes.length,
      currentFocusActionNodeId: 'bakery_location_decision',
    });
    expect(JSON.stringify(project)).toBe(before);
  });
});
