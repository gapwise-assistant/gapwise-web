import { authFetch } from '@/lib/auth/client';
import type { ResolutionValidation, ResolutionValidationSubmission } from '@/types/resolutionValidation';

export interface ClientResolutionValidation {
  validation: ResolutionValidation;
  fingerprint: string;
}

export async function requestResolutionValidation(params: {
  userId: string;
  projectId: string;
  nodeId: string;
  proposedResponse: string;
}): Promise<ClientResolutionValidation> {
  const response = await authFetch('/api/resolutions/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await response.json().catch(() => ({})) as Partial<ClientResolutionValidation> & { error?: string };
  if (!response.ok || !body.validation || !body.fingerprint) {
    throw new Error(body.error ?? 'Resolution checking is unavailable.');
  }
  return body as ClientResolutionValidation;
}

export function validationSubmission(
  fingerprint: string | undefined,
  validationOverride = false,
): ResolutionValidationSubmission {
  return {
    ...(fingerprint ? { validationFingerprint: fingerprint } : {}),
    ...(validationOverride ? { validationOverride: true } : {}),
  };
}
