import { expect, it } from 'vitest';
import {
  compareCareerGapStrategies,
  deterministicCareerGapStrategy,
  formatCareerGapComparison,
} from '@/lib/evals/careerGapEvaluator';

it('generates the CareerGap strategy comparison report', async () => {
  const summaries = await compareCareerGapStrategies([deterministicCareerGapStrategy]);
  const report = formatCareerGapComparison(summaries);
  expect(summaries).toHaveLength(1);
  expect(report).toContain('Current TypeScript ranker through GapAssessment V1');

  if (process.env.CAREER_GAP_REPORT === '1') {
    console.log(`\n${report}\n`);
    for (const summary of summaries) {
      const failures = summary.caseScores.filter((score) => score.errors.length > 0);
      console.log(`${summary.strategyLabel}: ${failures.length} cases need review`);
      failures.forEach((failure) => console.log(`- ${failure.caseId}: ${failure.errors.join(' ')}`));
    }
  }
});
