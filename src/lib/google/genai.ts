import { GoogleGenAI } from '@google/genai';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

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
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function getVertexGenAIClient(): GoogleGenAI {
  assertExternalServicesAllowed('Vertex AI / Gemini');
  return new GoogleGenAI({
    vertexai: process.env.GOOGLE_GENAI_USE_VERTEXAI !== 'false',
    project: getGoogleCloudProject(),
    location: getGoogleCloudLocation(),
  });
}
