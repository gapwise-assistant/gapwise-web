'use client';

import React from 'react';
import { Lightbulb } from 'lucide-react';
import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { Insight, InsightAction } from '@/types/insight';
import { detectInsights } from '@/lib/insights';
import { InsightReview } from '@/components/InsightReview';

interface InsightsPanelProps {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  hiddenInsightIds: string[];
  onAction: (insight: Insight, action: InsightAction) => void;
}

export const InsightsPanel: React.FC<InsightsPanelProps> = ({
  userId,
  project,
  memories,
  hiddenInsightIds,
  onAction,
}) => {
  const insights = detectInsights({ userId, project, memories })
    .filter((insight) => !hiddenInsightIds.includes(insight.id))
    .slice(0, 3);

  if (insights.length === 0) return null;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-300" />
          Insights
        </h2>
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
          {insights.length} to review
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {insights.map((insight) => (
          <InsightReview key={insight.id} insight={insight} onAction={onAction} />
        ))}
      </div>
    </section>
  );
};
