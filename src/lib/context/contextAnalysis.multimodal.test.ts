import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeContextItem } from '@/lib/context/contextAnalysis';
import { createProjectFromInput } from '@/lib/projects/createProject';

function model() {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({ summary: 'Media analyzed.', relevance: 'relevant', operations: [], relationships: [] }),
        modelVersion: 'gemini-test-version',
      }),
    },
  } as any;
}

describe('multimodal Context Agent input', () => {
  const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  });

  it.each([
    ['image', 'image/png'],
    ['voice', 'audio/webm'],
  ] as const)('passes a stored %s attachment as fileData with optional text context', async (type, mimeType) => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    const genAI = model();
    await analyzeContextItem({
      sourceId: `src_${type}`,
      filename: `source.${type === 'image' ? 'png' : 'webm'}`,
      content: 'Optional supporting context.',
      type,
      storageUrl: `gs://private-bucket/users/test-user/sources/src_${type}/source.${type === 'image' ? 'png' : 'webm'}`,
      mimeType,
      genAI,
    }, createProjectFromInput({ name: 'Media project', goal: 'Understand the attachment.' }));

    const request = genAI.models.generateContent.mock.calls[0][0];
    expect(request.contents[0].parts).toEqual(expect.arrayContaining([
      { fileData: { fileUri: expect.stringContaining(`/src_${type}/`), mimeType } },
      { text: expect.stringContaining('Optional supporting context.') },
    ]));
  });
});
