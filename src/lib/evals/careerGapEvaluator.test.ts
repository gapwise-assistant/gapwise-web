import { describe, expect, it } from 'vitest';
import { CAREER_GAP_GOLDEN_SET } from '@/lib/evals/careerGapGoldenSet';
import { CAREER_GAP_FIXED_NOW, materializeCareerGapCase } from '@/lib/evals/careerGapFixture';
import {
  deterministicCareerGapStrategy,
  evaluateCareerGapStrategy,
  scoreCareerGapCase,
  toAgentPlatformEvaluationDataset,
} from '@/lib/evals/careerGapEvaluator';

describe('CareerGap Golden Set v1', () => {
  it('contains 15 unique, hand-authored Northstar cases', () => {
    expect(CAREER_GAP_GOLDEN_SET).toHaveLength(15);
    expect(new Set(CAREER_GAP_GOLDEN_SET.map((goldenCase) => goldenCase.id)).size).toBe(15);
    expect(CAREER_GAP_GOLDEN_SET.every((goldenCase) => goldenCase.goldRationale.length > 30)).toBe(true);
  });

  it('materializes identical inputs and hashes from the same case', () => {
    const first = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const second = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    expect(first.fixedNow).toBe(CAREER_GAP_FIXED_NOW);
    expect(first.fixtureHash).toBe(second.fixtureHash);
    expect(first).toEqual(second);
  });

  it('materializes every typed mutation without changing the source demo fixture', () => {
    const materialized = CAREER_GAP_GOLDEN_SET.map(materializeCareerGapCase);
    expect(new Set(materialized.map((input) => input.fixtureHash)).size).toBe(15);
    expect(materialized.every((input) => input.project.id === 'career_conflict_demo')).toBe(true);
  });

  it('brings up the deterministic strategy on the first two cases', async () => {
    for (const goldenCase of CAREER_GAP_GOLDEN_SET.slice(0, 2)) {
      const input = materializeCareerGapCase(goldenCase);
      const result = await deterministicCareerGapStrategy.run(input);
      const score = scoreCareerGapCase(goldenCase, input, result);
      expect(score.contractValid).toBe(true);
      expect(score.answeredSuppressionCorrect).toBe(true);
      expect(score.genericQuestionsAvoided).toBe(true);
    }
  });

  it('produces a complete comparison summary without treating the baseline as gold', async () => {
    const summary = await evaluateCareerGapStrategy(deterministicCareerGapStrategy);
    expect(summary.caseScores).toHaveLength(15);
    expect(summary.rates.contractValidity).toBe(1);
    expect(summary.rates.answeredSuppression).toBe(1);
    expect(summary.rates.unrelatedCalendarInvariance).toBe(1);
    expect(Object.keys(summary.gates)).toEqual([
      'contractValidity',
      'answeredSuppression',
      'unrelatedCalendarInvariance',
      'forbiddenGenericQuestions',
      'topConceptAccuracy',
      'evidenceClassificationAccuracy',
      'criticalEvidenceCoverage',
    ]);
  });

  it('exports Vertex Evaluation cases with wrapped model references', () => {
    const dataset = toAgentPlatformEvaluationDataset(CAREER_GAP_GOLDEN_SET.slice(0, 2));
    expect(dataset.eval_cases).toHaveLength(2);
    expect(dataset.eval_cases[0].prompt.role).toBe('user');
    expect(dataset.eval_cases[0].reference.response.role).toBe('model');
    expect(dataset.eval_cases[0].career_gap_fixture_hash).toMatch(/^fnv1a:/);
    expect(dataset.eval_cases[0].career_gap_expectations.goldRationale).toBeTruthy();
  });
});
