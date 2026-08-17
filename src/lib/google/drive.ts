import { DriveFileSignal, GoogleIntegrationState } from '@/types/google';
import { assertCanRead } from '@/lib/google/auth';
import { driveFileToSource } from '@/lib/google/sourceMapper';

export function getDemoDriveFiles(): DriveFileSignal[] {
  return [
    {
      id: 'drive_cv_1',
      name: 'Martel AI CV.pdf',
      mimeType: 'application/pdf',
      text: 'CV last updated before the latest agentic AI project. Missing Gapwise and hackathon work.',
      folderId: 'career-folder',
      modifiedAt: '2026-06-01T10:00:00Z',
      sourceUrl: 'https://drive.google.com/file/d/drive_cv_1/view',
    },
    {
      id: 'drive_private_1',
      name: 'Private journal.txt',
      mimeType: 'text/plain',
      text: 'Private journal content should never be indexed unless explicitly selected.',
      folderId: 'private-folder',
      modifiedAt: '2026-08-01T10:00:00Z',
    },
  ];
}

export function retrieveDriveSignals(state: GoogleIntegrationState) {
  assertCanRead(state);
  const selectedIds = new Set(state.selectedDriveIds ?? []);
  const files = getDemoDriveFiles().filter((file) => selectedIds.has(file.id) || (file.folderId && selectedIds.has(file.folderId)));

  return {
    files,
    sources: files.map(driveFileToSource),
  };
}
