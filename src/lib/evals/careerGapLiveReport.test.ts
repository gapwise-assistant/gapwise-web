import { describe, expect, test } from 'vitest';
import { CAREER_GAP_GOLDEN_SET } from '@/lib/evals/careerGapGoldenSet';
import {
  evaluateCareerGapStrategy,
  formatCareerGapComparison,
} from '@/lib/evals/careerGapEvaluator';
import {
  chooseCheapestPassingCareerGapStrategy,
  getLiveCareerGapStrategies,
} from '@/lib/evals/careerGapLiveStrategy';

const runLive = process.env.RUN_LIVE_GAP_EVAL === 'true';

function caseLimit(): number {
  const parsed = Number.parseInt(process.env.CAREER_GAP_LIVE_MAX_CASES ?? '', 10);
  return Number.isFinite(parsed)
    ? Math.min(CAREER_GAP_GOLDEN_SET.length, Math.max(1, parsed))
    : 2;
}

function selectedCases() {
  const requested = new Set(
    (process.env.CAREER_GAP_LIVE_CASE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const filtered = requested.size
    ? CAREER_GAP_GOLDEN_SET.filter((goldenCase) => requested.has(goldenCase.id))
    : CAREER_GAP_GOLDEN_SET;
  return filtered.slice(0, caseLimit());
}

describe.skipIf(!runLive)('live ADK Career Gap profile comparison', () => {
  test('compares bounded profiles without bypassing contract validation', async () => {
    const cases = selectedCases();
    const summaries = [];
    for (const strategy of getLiveCareerGapStrategies()) {
      summaries.push(await evaluateCareerGapStrategy(strategy, cases));
    }

    console.info(`\n${formatCareerGapComparison(summaries)}\n`);
    for (const summary of summaries) {
      console.info(JSON.stringify({
        strategy: summary.strategyId,
        cases: summary.caseScores.map((score) => ({
          caseId: score.caseId,
          selectedGapId: score.selectedGapId,
          selectedConcept: score.selectedConcept,
          errors: score.errors,
        })),
      }, null, 2));
      expect(summary.rates.contractValidity, `${summary.strategyLabel} contract validity`).toBe(1);
      expect(summary.caseScores.every((score) => score.runtime !== undefined)).toBe(true);
    }

    if (cases.length === CAREER_GAP_GOLDEN_SET.length) {
      const winner = chooseCheapestPassingCareerGapStrategy(summaries);
      console.info(winner
        ? `Selected ${winner.summary.strategyLabel} by ${winner.basis}.`
        : 'No live configuration passed every Career Gap quality gate.');
      expect(winner, 'At least one live profile must pass before enabling live mode.').not.toBeNull();
    }
  }, 10 * 60_000);
});
