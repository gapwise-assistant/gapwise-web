import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { answerQuestion, editAnsweredQuestion } from '@/lib/questions/answerQuestion';
import { resolveGap } from '@/lib/tools/graphTools';

vi.mock('@/lib/storage', () => ({
  listProjects: vi.fn(),
  loadGeneralContext: vi.fn(),
  saveProject: vi.fn(),
  saveGeneralContext: vi.fn(),
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
      type: 'DECISION',
      text: 'The primary user is an independent hackathon builder.',
      created_by: 'user',
    });
    expect(result.context.history.at(-1)).toMatchObject({
      answer: 'The primary user is an independent hackathon builder.',
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

  it('edits the persisted answer and its decision node in place', async () => {
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
      type: 'DECISION',
      text: 'The primary user is a focused technical founder.',
    }));
    expect(result.context.nodes).not.toContainEqual(expect.objectContaining({
      type: 'DECISION',
      text: 'The primary user is an independent hackathon builder.',
    }));
    expect(saveProject).toHaveBeenCalledWith('demo-user', result.context);
  });
});
