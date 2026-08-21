import { ContextSource } from '@/types/clarity';
import { CalendarEventSignal, DriveFileSignal, GmailMessageSignal } from '@/types/google';

function sourceBase(id: string, filename: string, content: string): Omit<ContextSource, 'type'> {
  const createdAt = new Date().toISOString();
  return {
    id,
    filename,
    content,
    extracted_at: createdAt,
    processed_at: createdAt,
    derived_node_ids: [],
    processing_status: 'completed',
    origin: 'connector',
    storage_url: undefined,
  };
}

export function calendarEventToSource(event: CalendarEventSignal): ContextSource {
  return {
    ...sourceBase(
      `gcal_${event.id}`,
      `calendar-${event.title}.txt`,
      `Calendar event: ${event.title}. Starts ${event.start}. Ends ${event.end}. ${event.description ?? ''}`.trim()
    ),
    type: 'note',
    mime_type: 'application/vnd.google.calendar.event',
    storage_url: event.sourceUrl,
    extraction_summary: 'Read-only Google Calendar event signal.',
  };
}

export function gmailMessageToSource(message: GmailMessageSignal): ContextSource {
  return {
    ...sourceBase(
      `gmail_${message.id}`,
      `gmail-${message.subject}.txt`,
      `Gmail from ${message.from}: ${message.subject}. ${message.snippet}`.trim()
    ),
    type: 'text',
    mime_type: 'message/rfc822',
    storage_url: message.sourceUrl,
    extraction_summary: 'Read-only Gmail message signal.',
  };
}

export function driveFileToSource(file: DriveFileSignal): ContextSource {
  return {
    ...sourceBase(`gdrive_${file.id}`, file.name, file.text),
    type: file.mimeType.includes('pdf') ? 'pdf' : 'text',
    mime_type: file.mimeType,
    storage_url: file.sourceUrl,
    extraction_summary: 'User-selected Google Drive file signal.',
  };
}
