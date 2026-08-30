import { describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { importWorkspaceSignalsIntoProject } from '@/lib/google/importWorkspaceSignals';
import type { ContextSource } from '@/types/clarity';

function source(id: string): ContextSource {
  return {
    id,
    filename: `${id}.txt`,
    type: 'note',
    content: `Connected context ${id}`,
    extracted_at: '2026-08-28T00:00:00.000Z',
    derived_node_ids: [],
    processing_status: 'completed',
  };
}

describe('connected workspace import', () => {
  it('skips existing sources and sends new sources through Context ingestion sequentially', async () => {
    const project = createProjectFromInput({ name: 'Pilot', goal: 'Launch the pilot.' });
    project.sources.push(source('existing'));
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as { sourceId: string };
      const updated = JSON.parse(JSON.stringify(project));
      updated.sources.push(source(input.sourceId));
      return new Response(JSON.stringify({ project: updated }), { status: 200 });
    });

    const result = await importWorkspaceSignalsIntoProject({
      userId: 'settings-user',
      project,
      signals: {
        calendarEvents: [], gmailMessages: [], driveFiles: [],
        derivedSources: [source('existing'), source('new-calendar-event')],
      },
    }, { request: request as typeof fetch });

    expect(result).toMatchObject({ imported: 1, skipped: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      projectId: project.id,
      sourceId: 'new-calendar-event',
      origin: 'connector',
    });
  });

  it('does not report success when Context ingestion rejects a source', async () => {
    const project = createProjectFromInput({ name: 'Pilot', goal: 'Launch the pilot.' });
    const request = vi.fn(async () => new Response(JSON.stringify({ error: 'Context Agent unavailable.' }), { status: 503 }));

    await expect(importWorkspaceSignalsIntoProject({
      userId: 'settings-user',
      project,
      signals: { calendarEvents: [], gmailMessages: [], driveFiles: [], derivedSources: [source('new-source')] },
    }, { request: request as typeof fetch })).rejects.toThrow('Context Agent unavailable.');
  });

  it('reprocesses a changed connector source while preserving its stable identity', async () => {
    const project = createProjectFromInput({ name: 'Pilot', goal: 'Launch the pilot.' });
    project.sources.push({ ...source('calendar-event'), hash: 'old-hash' });
    const changed = { ...source('calendar-event'), content: 'Connected context calendar-event updated', hash: 'new-hash' };
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as { sourceId: string; hash: string };
      expect(input.sourceId).toBe('calendar-event');
      expect(input.hash).toBe('new-hash');
      const updated = JSON.parse(JSON.stringify(project));
      updated.sources = [changed];
      return new Response(JSON.stringify({ project: updated }), { status: 200 });
    });

    const result = await importWorkspaceSignalsIntoProject({
      userId: 'settings-user',
      project,
      signals: { calendarEvents: [], gmailMessages: [], driveFiles: [], derivedSources: [changed] },
    }, { request: request as typeof fetch });

    expect(result).toMatchObject({ imported: 1, skipped: 0 });
    expect(result.project.sources).toEqual([changed]);
  });
});
