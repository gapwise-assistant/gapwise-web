export type ResolutionValidationVerdict = 'sufficient' | 'warning' | 'unavailable';

export interface ResolutionValidation {
  verdict: ResolutionValidationVerdict;
  reason: string;
  missingInformation: string[];
  suggestedRevision?: string;
  confidence: number;
}

export interface ResolutionValidationMetadata {
  verdict: ResolutionValidationVerdict;
  overridden: boolean;
  reason?: string;
  confidence?: number;
}

export interface ResolutionValidationSubmission {
  validationFingerprint?: string;
  validationOverride?: boolean;
}
