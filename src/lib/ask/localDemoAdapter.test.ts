import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalDemoProjects } from '@/lib/demo/localFixtures';
import { loadProjectForScope } from '@/lib/storage';
import { loadDurableMemories } from '@/lib/memory/serverStore';
import { askGapswiseLocally, generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';

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

  it('keeps Career Demo suggestions specific when local persistence is unavailable', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    vi.mocked(loadProjectForScope).mockRejectedValue(new Error('Local file is temporarily unavailable.'));

    const result = await generateLocalAskSuggestions({
      userId: 'demo-user',
      projectId: 'career_conflict_demo',
    });

    expect(result.top).toEqual([
      "Given Northstar's Product Engineer role is 70–80% frontend and I want backend or applied AI ownership, what would have to be true for this role to still be worth pursuing?",
      'What should I ask the Northstar recruiter to verify that the backend or applied AI path is real and manager-supported?',
      "For Northstar's $155k–$175k Product Engineer base range, what compensation details are still missing before I compare this opportunity?",
    ]);
    expect(result.other).toHaveLength(3);
  });
});
