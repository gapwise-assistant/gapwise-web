import { describe, expect, it } from 'vitest';
import { assessGapsV1Deterministically } from '@/lib/agents/gapAssessmentV1';
import { gapAssessmentV1Schema, validateGapAssessmentAgainstProject } from '@/lib/agents/gapContractV1';
import { CAREER_GAP_GOLDEN_SET } from '@/lib/evals/careerGapGoldenSet';
import { materializeCareerGapCase } from '@/lib/evals/careerGapFixture';

describe('GapAssessment V1 contract', () => {
  it('validates the deterministic adapter and its graph paths', () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    expect(() => validateGapAssessmentAgainstProject(assessment, input.project)).not.toThrow();
  });

  it('rejects an answered candidate that is not suppressed', () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    const first = assessment.candidates[0];
    const invalid = {
      ...assessment,
      candidates: assessment.candidates.map((candidate, index) => index === 0 ? {
        ...candidate,
        evidenceReview: { ...candidate.evidenceReview, answerability: 'answered' as const },
        suppressionReason: null,
      } : candidate),
      selectedGapId: first.gapId,
    };
    expect(gapAssessmentV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('rejects selecting a suppressed gap', () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[1]);
    const assessment = assessGapsV1Deterministically(input);
    const suppressed = assessment.candidates.find((candidate) => candidate.suppressionReason !== null);
    expect(suppressed).toBeDefined();
    expect(gapAssessmentV1Schema.safeParse({ ...assessment, selectedGapId: suppressed!.gapId }).success).toBe(false);
  });

  it('requires a selection whenever an actionable gap remains', () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    expect(gapAssessmentV1Schema.safeParse({ ...assessment, selectedGapId: null }).success).toBe(false);
  });
});
