import { ContextSource } from '@/types/clarity';

export type GoogleIntegrationName = 'calendar' | 'gmail' | 'drive';
export type GoogleIntegrationStatus = 'connected' | 'disconnected' | 'token_expired' | 'permission_denied';

export interface GoogleIntegrationState {
  name: GoogleIntegrationName;
  status: GoogleIntegrationStatus;
  readOnly: boolean;
  scopes: string[];
  connectedAt?: string;
  selectedLabels?: string[];
  selectedDriveIds?: string[];
  lastSyncAt?: string;
}

export interface CalendarEventSignal {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  sourceUrl?: string;
}

export interface SafeCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start?: string;
  end?: string;
  location?: string;
}

export interface GmailMessageSignal {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  labels: string[];
  receivedAt: string;
  sourceUrl?: string;
}

export interface DriveFileSignal {
  id: string;
  name: string;
  mimeType: string;
  text: string;
  folderId?: string;
  modifiedAt: string;
  sourceUrl?: string;
}

export interface GoogleWorkspaceSignals {
  calendarEvents: CalendarEventSignal[];
  gmailMessages: GmailMessageSignal[];
  driveFiles: DriveFileSignal[];
  derivedSources: ContextSource[];
}
