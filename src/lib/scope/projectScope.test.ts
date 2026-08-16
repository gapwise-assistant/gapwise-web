import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { createProjectFromInput } from '@/lib/projects/createProject';
import {
  contextTargetForScope,
  emptyGeneralContext,
  mergeProjectsForEverything,
  projectForScope,
  resolveScope,
} from '@/lib/scope/projectScope';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { createDurableMemory } from '@/lib/memory/policy';
import { generateDailyBrief } from '@/lib/attention/generateBrief';

function addSource(project: ReturnType<typeof createGoldenDemoProject>, id: string, filename: string, content: string) {
  project.sources.push({
    id,
    filename,
    type: 'text',
    content,
    extracted_at: '2026-08-12T12:00:00Z',
    derived_node_ids: [],
    processing_status: 'completed',
  });
}

describe('global context scope', () => {
  it('defaults invalid or deleted project scope to Everything', () => {
    const projects = [createGoldenDemoProject()];
    expect(resolveScope(undefined, projects)).toEqual({ type: 'everything' });
    expect(resolveScope({ type: 'project', projectId: 'deleted' }, projects)).toEqual({ type: 'everything' });
  });

  it('does not restore an archived project as the active scope', () => {
    const archived = createGoldenDemoProject();
    archived.status = 'archived';

    expect(resolveScope({ type: 'project', projectId: archived.id }, [archived])).toEqual({ type: 'everything' });
  });

  it('retrieves across projects in Everything and excludes unrelated projects when focused', () => {
    const hackathon = createGoldenDemoProject();
    const jobSearch = createProjectFromInput(
      { name: 'Job Search', goal: 'Find a backend AI role.' },
      '2026-08-12T10:00:00Z'
    );
    addSource(hackathon, 'src_hackathon_scope', 'hackathon-plan.txt', 'Prepare the Gapswise demo narrative.');
    addSource(jobSearch, 'src_job_scope', 'job-search.txt', 'Reply to the backend AI recruiter.');

    const everything = mergeProjectsForEverything([hackathon, jobSearch]);
    const everythingPack = buildContextPack({
      userId: 'demo-user',
      query: 'Gapswise demo and backend AI recruiter',
      project: everything,
      profile: DEFAULT_USER_PROFILE,
    });
    const focusedPack = buildContextPack({
      userId: 'demo-user',
      query: 'backend AI recruiter',
      project: projectForScope({ type: 'project', projectId: hackathon.id }, [hackathon, jobSearch]),
      profile: DEFAULT_USER_PROFILE,
    });

    expect(everythingPack.relevantEvidence.map((item) => item.source_id)).toEqual(
      expect.arrayContaining(['src_hackathon_scope', 'src_job_scope'])
    );
    expect(focusedPack.relevantEvidence.map((item) => item.source_id)).not.toContain('src_job_scope');
  });

  it('keeps global durable memory available in project scope', () => {
    const project = createGoldenDemoProject();
    const memory = createDurableMemory('Remember that I prefer concise answers.')!;
    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'How should you answer me?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [memory],
    });

    expect(pack.userPreferences.map((item) => item.id)).toContain(memory.id);
  });

  it('keeps Today focused on the selected project', () => {
    const hackathon = createGoldenDemoProject();
    const jobSearch = createProjectFromInput(
      { name: 'Job Search', goal: 'Find a backend AI role.' },
      '2026-08-12T10:00:00Z'
    );
    addSource(jobSearch, 'src_recruiter_other_project', 'recruiter.txt', 'Recruiter offered a better-paying backend AI role.');

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project: hackathon,
      memories: [],
      period: '2026-08-12',
      force: true,
    });

    expect(brief.recommendations.map((item) => item.id)).not.toContain('rec_recruiter_src_recruiter_other_project');
  });

  it('assigns project-scoped context automatically and lets Everything choose project or general', () => {
    const hackathon = createGoldenDemoProject();
    const jobSearch = createProjectFromInput(
      { name: 'Job Search', goal: 'Find a backend AI role.' },
      '2026-08-12T10:00:00Z'
    );
    const general = emptyGeneralContext();

    expect(contextTargetForScope({ type: 'project', projectId: hackathon.id }, [hackathon, jobSearch], general).id)
      .toBe(hackathon.id);
    expect(contextTargetForScope({ type: 'everything' }, [hackathon, jobSearch], general, jobSearch.id).id)
      .toBe(jobSearch.id);
    expect(contextTargetForScope({ type: 'everything' }, [hackathon, jobSearch], general).id)
      .toBe(general.id);
  });
});
