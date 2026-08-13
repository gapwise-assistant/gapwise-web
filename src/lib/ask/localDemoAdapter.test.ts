import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalDemoProjects } from '@/lib/demo/localFixtures';
import { loadProjectForScope } from '@/lib/storage';
import { loadDurableMemories } from '@/lib/memory/serverStore';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';

vi.mock('@/lib/storage', () => ({ loadProjectForScope: vi.fn() }));
vi.mock('@/lib/memory/serverStore', () => ({ loadDurableMemories: vi.fn(async () => []) }));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
  else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  vi.clearAllMocks();
});

describe('local demo Ask adapter', () => {
  it('returns deterministic scoped Markdown without leaking another project', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const jobSearch = createLocalDemoProjects().find((project) => project.id === 'job_search_demo')!;
    vi.mocked(loadProjectForScope).mockResolvedValue({
      project: jobSearch,
      scope: { type: 'project', projectId: jobSearch.id },
    });
    vi.mocked(loadDurableMemories).mockResolvedValue([]);

    const result = await askGapswiseLocally({
      userId: 'demo-user',
      projectId: jobSearch.id,
      message: 'What do you know about this project?',
    });

    expect(result.answer).toContain('## Job Search');
    expect(result.answer).toContain('Which companies should I prioritize?');
    expect(result.answer).not.toMatch(/4-minute demo|Collaborative Partner/i);
    expect(result.sessionId).toContain('job_search_demo');
  });

  it('falls back to hardcoded fixtures when local persistence is unavailable', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    vi.mocked(loadProjectForScope).mockRejectedValue(new Error('Local file is temporarily unavailable.'));

    const result = await askGapswiseLocally({
      userId: 'demo-user',
      projectId: 'job_search_demo',
      message: 'What should I focus on?',
    });

    expect(result.answer).toContain('Which companies should I prioritize?');
    expect(result.answer).not.toMatch(/primary target persona|4-minute demo scenario/i);
    expect(result.sessionId).toContain('job_search_demo');
    expect(result.sources.length).toBeGreaterThan(0);
  });
});
