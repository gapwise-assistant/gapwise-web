import { GmailMessageSignal, GoogleIntegrationState } from '@/types/google';
import { assertCanRead } from '@/lib/google/auth';
import { gmailMessageToSource } from '@/lib/google/sourceMapper';

export function getDemoGmailMessages(): GmailMessageSignal[] {
  return [
    {
      id: 'demo_recruiter_1',
      subject: 'AI role with stronger compensation',
      from: 'recruiter@example.com',
      snippet: 'Saw your recent agentic AI work and wanted to ask if you are open to a better-paying role.',
      labels: ['INBOX', 'Opportunities'],
      receivedAt: '2026-08-10T09:00:00Z',
      sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/demo_recruiter_1',
    },
    {
      id: 'demo_newsletter_1',
      subject: 'Frontend jobs newsletter',
      from: 'jobs@example.com',
      snippet: 'A roundup of frontend openings and CSS-heavy roles.',
      labels: ['Promotions'],
      receivedAt: '2026-08-10T08:00:00Z',
    },
  ];
}

export function retrieveGmailSignals(state: GoogleIntegrationState, query: string) {
  assertCanRead(state);
  const selectedLabels = state.selectedLabels ?? [];
  const queryTerms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 3);
  const messages = getDemoGmailMessages().filter((message) => {
    const labelAllowed = selectedLabels.length === 0 || message.labels.some((label) => selectedLabels.includes(label));
    const text = `${message.subject} ${message.from} ${message.snippet}`.toLowerCase();
    const queryMatch = queryTerms.length === 0 || queryTerms.some((term) => text.includes(term));
    return labelAllowed && queryMatch;
  });

  return {
    messages,
    sources: messages.map(gmailMessageToSource),
  };
}
