import { GoogleGenAI } from '@google/genai';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

/** Lowest-cost Gemini model verified for project gapwise-505217/global. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const GEMINI_MODEL_PATTERN = /(?:^|\/)gemini-(\d+)\.(\d+)(?:[-/]|$)/i;

export function isEligibleGeminiModel(model: string): boolean {
  const match = model.trim().match(GEMINI_MODEL_PATTERN);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 5);
}

export function validateGeminiModel(model: string): string {
  const normalized = model.trim();
  if (!isEligibleGeminiModel(normalized)) {
    throw new StorageError(
      `GEMINI_MODEL must be Gemini 3.5 or newer for live AI paths; selected "${normalized || '(empty)'}".`,
      'CONFIGURATION_ERROR',
    );
  }
  return normalized;
}

export function getGoogleCloudProject(): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!project) {
    throw new StorageError('Gemini Vertex AI requires GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT.', 'CONFIGURATION_ERROR');
  }
  return project;
}

export function getGoogleCloudLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || 'global';
}

export function getConfiguredGeminiModel(): string {
  return validateGeminiModel(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
}

export function getVertexGenAIClient(): GoogleGenAI {
  assertExternalServicesAllowed('Vertex AI / Gemini');
  return new GoogleGenAI({
    vertexai: process.env.GOOGLE_GENAI_USE_VERTEXAI !== 'false',
    project: getGoogleCloudProject(),
    location: getGoogleCloudLocation(),
  });
}
