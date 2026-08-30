import type { Project } from '@/types/clarity';
import type { GoogleWorkspaceSignals } from '@/types/google';
import { authFetch } from '@/lib/auth/client';

export interface WorkspaceImportResult {
  project: Project;
  imported: number;
  skipped: number;
}

/** Imports connector sources through the same persisted Context Agent route as manual context. */
export async function importWorkspaceSignalsIntoProject(
  params: { userId: string; project: Project; signals: GoogleWorkspaceSignals },
  deps: { request?: typeof authFetch } = {},
): Promise<WorkspaceImportResult> {
  const request = deps.request ?? authFetch;
  let current = params.project;
  let imported = 0;
  let skipped = 0;

  for (const source of params.signals.derivedSources) {
    const existing = current.sources.find((candidate) => candidate.id === source.id);
    const unchanged = existing && existing.hash && source.hash
      ? existing.hash === source.hash
      : existing?.content === source.content;
    if (unchanged) {
      skipped += 1;
      continue;
    }
    const response = await request('/api/context/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: params.userId,
        projectId: current.id,
        ...(params.signals.calendarSyncRunId ? { calendarSyncRunId: params.signals.calendarSyncRunId } : {}),
        sourceId: source.id,
        filename: source.filename,
        content: source.content,
        type: source.type,
        mimeType: source.mime_type,
        sizeBytes: source.size_bytes,
        storageUrl: source.storage_url,
        hash: source.hash,
        origin: 'connector',
      }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; project?: Project; skipped?: boolean };
    if (!response.ok || !body.project) {
      throw new Error(body.error ?? `Connected source ${source.filename} could not be analyzed.`);
    }
    current = body.project;
    if (body.skipped) skipped += 1;
    else imported += 1;
  }

  if (params.signals.calendarSyncRunId && process.env.NODE_ENV !== 'production') {
    console.info('[Gapwise Calendar sync import]', {
      calendarSyncRunId: params.signals.calendarSyncRunId,
      projectId: current.id,
      imported,
      skipped,
    });
  }

  return { project: current, imported, skipped };
}
