import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { answerQuestion, editAnsweredQuestion, reopenAnsweredQuestion } from '@/lib/questions/answerQuestion';
import { resolveGap } from '@/lib/tools/graphTools';

vi.mock('@/lib/storage', () => ({
  listProjects: vi.fn(),
  loadGeneralContext: vi.fn(),
  saveProject: vi.fn(),
  saveGeneralContext: vi.fn(),
  getStorageProvider: vi.fn(() => ({
    getUserMemoryProfile: vi.fn(async () => null),
  })),
}));

describe('answerQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveProject).mockImplementation(async (_userId, project) => project);
    vi.mocked(saveGeneralContext).mockImplementation(async (_userId, project) => project);
  });

  it('resolves the exact owning project and records the user answer', async () => {
    const unrelated = { ...createGoldenDemoProject(), id: 'project_unrelated', nodes: [] };
    const owner = createGoldenDemoProject();
    vi.mocked(listProjects).mockResolvedValue([unrelated, owner]);

    const result = await answerQuestion({
      userId: 'demo-user',
      nodeId: 'unknown_target_user',
      answer: 'The primary user is an independent hackathon builder.',
    });

    expect(result.ownerType).toBe('project');
    expect(result.projectId).toBe(owner.id);
    expect(result.context.nodes.find((node) => node.id === 'unknown_target_user')).toMatchObject({
      status: 'RESOLVED',
      confidence: 1,
    });
    expect(result.context.nodes.find((node) => node.id === result.createdNodeId)).toMatchObject({
      type: 'KNOWN',
      text: 'The primary user is an independent hackathon builder.',
      created_by: 'user',
    });
    expect(result.context.history.at(-1)).toMatchObject({
      answer: 'The primary user is an independent hackathon builder.',
      nodeId: 'unknown_target_user',
      projectId: owner.id,
    });
    expect(saveProject).toHaveBeenCalledWith('demo-user', result.context);
  });

  it('does not resolve a question outside the requested project scope', async () => {
    const owner = createGoldenDemoProject();
    vi.mocked(listProjects).mockResolvedValue([owner]);

    await expect(answerQuestion({
      userId: 'demo-user',
      projectId: 'another-project',
      nodeId: 'unknown_target_user',
      answer: 'This must not cross the project boundary.',
    })).rejects.toThrow('not found for the requested user and scope');
    expect(saveProject).not.toHaveBeenCalled();
  });

  it('stores an apartment budget answer as a constraint and resolves the budget question', async () => {
    const owner = createGoldenDemoProject();
    const budget = owner.nodes.find((node) => node.id === 'unknown_target_user')!;
    budget.text = 'What is your actual affordable monthly housing budget?';
    budget.impact = 0.9;
    vi.mocked(listProjects).mockResolvedValue([owner]);

    const result = await answerQuestion({
      userId: 'demo-user',
      projectId: owner.id,
      nodeId: budget.id,
      answer: "I don't want total housing-related costs above $1,750/month.",
    });

    const understanding = result.context.nodes.find((node) => node.id === result.createdNodeId);
    expect(understanding).toMatchObject({
      type: 'CONSTRAINT',
      text: 'Housing-related costs should stay at or below $1,750/month.',
      created_by: 'user',
    });
    expect(result.context.edges).toContainEqual(expect.objectContaining({
      source: understanding?.id,
      target: budget.id,
      type: 'resolves',
    }));
    expect(budget.status).toBe('OPEN');
    expect(result.context.nodes.find((node) => node.id === budget.id)?.status).toBe('RESOLVED');
  });

  it('rejects an answer when the question is already resolved', async () => {
    const project = createGoldenDemoProject();
    const node = project.nodes.find((item) => item.id === 'unknown_target_user')!;
    node.status = 'RESOLVED';
    vi.mocked(listProjects).mockResolvedValue([project]);

    await expect(answerQuestion({
      userId: 'demo-user',
      nodeId: node.id,
      answer: 'A duplicate answer.',
    })).rejects.toThrow('already been resolved');
  });

  it('edits the persisted answer and its understanding node in place', async () => {
    const owner = createGoldenDemoProject();
    const answered = resolveGap(
      owner,
      'unknown_target_user',
      'The primary user is an independent hackathon builder.'
    );
    const historyItem = answered.history.at(-1)!;
    vi.mocked(listProjects).mockResolvedValue([answered]);

    const result = await editAnsweredQuestion({
      userId: 'demo-user',
      projectId: answered.id,
      historyTimestamp: historyItem.timestamp,
      question: historyItem.question,
      previousAnswer: historyItem.answer,
      answer: 'The primary user is a focused technical founder.',
    });

    expect(result.context.history.at(-1)).toMatchObject({
      question: historyItem.question,
      answer: 'The primary user is a focused technical founder.',
    });
    expect(result.context.nodes).toContainEqual(expect.objectContaining({
      type: 'KNOWN',
      text: 'The primary user is a focused technical founder.',
    }));
    expect(result.context.nodes).not.toContainEqual(expect.objectContaining({
      type: 'KNOWN',
      text: 'The primary user is an independent hackathon builder.',
    }));
    expect(saveProject).toHaveBeenCalledWith('demo-user', result.context);
  });

  it('edits by the canonical history node when presentation wording changes', async () => {
    const owner = createGoldenDemoProject();
    const answered = resolveGap(
      owner,
      'unknown_target_user',
      'The primary user is an independent hackathon builder.',
    );
    const historyItem = answered.history.at(-1)!;
    const questionNode = answered.nodes.find((node) => node.id === historyItem.nodeId)!;
    questionNode.text = 'Which audience is the project serving?';
    vi.mocked(listProjects).mockResolvedValue([answered]);

    const result = await editAnsweredQuestion({
      userId: 'demo-user',
      projectId: answered.id,
      historyTimestamp: historyItem.timestamp,
      nodeId: questionNode.id,
      question: 'Which audience is the project serving?',
      previousAnswer: historyItem.answer,
      answer: 'The project serves focused technical founders.',
    });

    expect(result.context.history.filter((item) => item.nodeId === questionNode.id)).toHaveLength(1);
    expect(result.context.history.find((item) => item.nodeId === questionNode.id)).toMatchObject({
      answer: 'The project serves focused technical founders.',
      nodeId: questionNode.id,
    });
  });

  it('keeps editing older history records working through the legacy fallback', async () => {
    const owner = createGoldenDemoProject();
    const answered = resolveGap(
      owner,
      'unknown_target_user',
      'The primary user is an independent hackathon builder.',
    );
    const historyItem = answered.history.at(-1)!;
    const legacyQuestion = historyItem.question;
    const questionNode = answered.nodes.find((node) => node.id === historyItem.nodeId)!;
    delete historyItem.nodeId;
    questionNode.text = 'Which audience is the project serving?';
    vi.mocked(listProjects).mockResolvedValue([answered]);

    const result = await editAnsweredQuestion({
      userId: 'demo-user',
      projectId: answered.id,
      historyTimestamp: historyItem.timestamp,
      nodeId: questionNode.id,
      question: legacyQuestion,
      previousAnswer: historyItem.answer,
      answer: 'The project serves technical founders.',
    });

    expect(result.context.history.find((item) => item.timestamp === historyItem.timestamp)).toMatchObject({
      answer: 'The project serves technical founders.',
      nodeId: questionNode.id,
    });
  });

  it('reclassifies the linked understanding when an answer is edited', async () => {
    const owner = createGoldenDemoProject();
    const budget = owner.nodes.find((node) => node.id === 'unknown_target_user')!;
    budget.text = 'What is your actual affordable monthly housing budget?';
    const answered = resolveGap(owner, budget.id, "I don't want total housing-related costs above $1,750/month.");
    const historyItem = answered.history.at(-1)!;
    vi.mocked(listProjects).mockResolvedValue([answered]);

    const result = await editAnsweredQuestion({
      userId: 'demo-user',
      projectId: answered.id,
      historyTimestamp: historyItem.timestamp,
      question: historyItem.question,
      previousAnswer: historyItem.answer,
      answer: 'I prefer to keep housing costs comfortable and predictable.',
    });

    const linked = result.context.nodes.find((node) => node.id === answered.edges.find((edge) => edge.type === 'resolves' && edge.target === budget.id)?.source);
    expect(linked).toMatchObject({ type: 'PREFERENCE', text: 'I prefer to keep housing costs comfortable and predictable.' });
    expect(result.context.nodes.filter((node) => node.text.includes('housing costs comfortable')).length).toBe(1);
  });

  it('cancels a response and reopens the original question', async () => {
    const owner = createGoldenDemoProject();
    const answered = resolveGap(
      owner,
      'unknown_target_user',
      'The primary user is an independent hackathon builder.'
    );
    const historyItem = answered.history.at(-1)!;
    vi.mocked(listProjects).mockResolvedValue([answered]);

    const result = await reopenAnsweredQuestion({
      userId: 'demo-user',
      projectId: answered.id,
      historyTimestamp: historyItem.timestamp,
      question: historyItem.question,
      previousAnswer: historyItem.answer,
    });

    expect(result.context.nodes.find((node) => node.id === 'unknown_target_user')).toMatchObject({
      status: 'OPEN',
      confidence: 0.25,
    });
    const answerNode = result.context.nodes.find((node) => node.text.includes('independent hackathon builder'));
    expect(answerNode).toMatchObject({ created_by: 'user', status: 'DEPRECATED' });
    expect(result.context.edges).not.toContainEqual(expect.objectContaining({
      source: answerNode?.id,
      target: 'unknown_target_user',
      type: 'resolves',
    }));
    expect(result.context.history.at(-1)?.graph_diff_summary).toContain('Response cancelled');
    expect(saveProject).toHaveBeenCalledWith('demo-user', result.context);
  });
});
