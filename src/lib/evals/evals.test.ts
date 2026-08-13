import { describe, expect, it } from 'vitest';
import { runEvaluationSuite } from '@/lib/evals/scenarios';

describe('Gapswise evaluation suite', () => {
  it('passes all deterministic milestone scenarios', () => {
    const report = runEvaluationSuite();
    const failed = report.filter((scenario) => !scenario.passed);
    expect(report).toHaveLength(15);
    expect(failed).toEqual([]);
  });
});
