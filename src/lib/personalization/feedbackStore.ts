import { FeedbackEvent } from '@/types/feedback';

const FEEDBACK_PREFIX = 'gapwise_feedback_';

export function loadFeedbackEvents(userId: string): FeedbackEvent[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(`${FEEDBACK_PREFIX}${userId}`);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as FeedbackEvent[];
  } catch {
    return [];
  }
}

export function saveFeedbackEvents(userId: string, events: FeedbackEvent[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${FEEDBACK_PREFIX}${userId}`, JSON.stringify(events));
}

export function appendFeedbackEvent(userId: string, events: FeedbackEvent[], event: FeedbackEvent): FeedbackEvent[] {
  const updated = [event, ...events];
  saveFeedbackEvents(userId, updated);
  return updated;
}

export function activeSuppressionEvents(events: FeedbackEvent[], now = new Date()): FeedbackEvent[] {
  return events.filter((event) => {
    if (!event.suppress_until) return false;
    return new Date(event.suppress_until).getTime() > now.getTime();
  });
}
