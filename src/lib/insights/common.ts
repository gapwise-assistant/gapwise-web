import { Insight, InsightAction } from '@/types/insight';

const dismissedInsightIds = new Set<string>();

export function makeInsightId(parts: string[]): string {
  return parts.join('_').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

export function isDismissed(insightId: string): boolean {
  return dismissedInsightIds.has(insightId);
}

export function applyInsightAction(insight: Insight, action: InsightAction): Insight {
  if (action === 'dismiss' || action === 'not_relevant') {
    dismissedInsightIds.add(insight.id);
    return {
      ...insight,
      status: 'dismissed',
      suppress_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  if (action === 'changed') {
    return {
      ...insight,
      status: 'updated',
      updated_at: new Date().toISOString(),
    };
  }

  return {
    ...insight,
    status: 'confirmed',
    updated_at: new Date().toISOString(),
  };
}

export function clearDismissedInsightsForTests(): void {
  dismissedInsightIds.clear();
}
