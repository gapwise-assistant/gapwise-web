import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { listProjects } from '@/lib/storage';
import { validateProjectResolution } from '@/lib/resolutions/resolutionValidation';

vi.mock('@/lib/google/genai', () => ({ getVertexGenAIClient: vi.fn() }));
vi.mock('@/lib/agents/modelPolicy', () => ({ getAgentModelConfig: vi.fn() }));
vi.mock('@/lib/runtime/demoMode', () => ({ isDemoMode: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  listProjects: vi.fn(),
  loadGeneralContext: vi.fn(),
}));

describe('resolution validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoMode).mockReturnValue(false);
    vi.mocked(getAgentModelConfig).mockReturnValue({
      role: 'partner',
      model: 'gemini-3.5-flash-lite',
      thinkingLevel: 'low',
      maxOutputTokens: 1024,
    });
    vi.mocked(listProjects).mockResolvedValue([createGoldenDemoProject()]);
  });

  it('returns a structured sufficient result and uses a bounded JSON validation call', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        verdict: 'sufficient',
        reason: 'The response directly records the answer.',
        missingInformation: [],
        confidence: 0.96,
      }),
    });
    vi.mocked(getVertexGenAIClient).mockReturnValue({ models: { generateContent } } as never);

    const result = await validateProjectResolution({
      userId: 'validation-user',
      projectId: 'hackathon_demo',
      nodeId: 'unknown_target_user',
      proposedResponse: 'Independent builders are the primary users.',
    });

    expect(result.validation).toMatchObject({ verdict: 'sufficient', confidence: 0.96 });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash-lite',
      config: expect.objectContaining({
        temperature: 0,
        maxOutputTokens: 384,
        responseMimeType: 'application/json',
      }),
    }));
    const prompt = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain('Target question or decision:');
    expect(prompt).toContain('Proposed response: Independent builders are the primary users.');
  });

  it('returns a warning without mutating the project when the response is insufficient', async () => {
    vi.mocked(getVertexGenAIClient).mockReturnValue({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            verdict: 'warning',
            reason: 'The response does not identify an outcome.',
            missingInformation: ['Name the selected audience.'],
            suggestedRevision: 'The primary audience is independent builders.',
            confidence: 0.91,
          }),
        }),
      },
    } as never);

    const projectBefore = createGoldenDemoProject();
    const result = await validateProjectResolution({
      userId: 'validation-user',
      projectId: projectBefore.id,
      nodeId: 'unknown_target_user',
      proposedResponse: 'I am not sure yet.',
    });

    expect(result.validation).toMatchObject({
      verdict: 'warning',
      missingInformation: ['Name the selected audience.'],
    });
    expect(projectBefore.nodes.find((node) => node.id === 'unknown_target_user')?.status).toBe('OPEN');
  });

  it('returns unavailable on validator failure and reuses an identical cached check', async () => {
    const generateContent = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'sufficient',
          reason: 'Specific answer.',
          missingInformation: [],
          confidence: 0.8,
        }),
      })
      .mockRejectedValueOnce(new Error('temporary validator failure'));
    vi.mocked(getVertexGenAIClient).mockReturnValue({ models: { generateContent } } as never);

    const params = {
      userId: 'validation-user',
      projectId: 'hackathon_demo',
      nodeId: 'unknown_target_user',
      proposedResponse: 'A stable, specific answer.',
    };
    const first = await validateProjectResolution(params);
    const second = await validateProjectResolution(params);

    expect(first.validation.verdict).toBe('sufficient');
    expect(second.validation).toEqual(first.validation);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('allows a temporary failure to be represented as unavailable', async () => {
    vi.mocked(getVertexGenAIClient).mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error('temporary validator failure')) },
    } as never);

    const result = await validateProjectResolution({
      userId: 'validation-user',
      projectId: 'hackathon_demo',
      nodeId: 'unknown_target_user',
      proposedResponse: 'A response that can still be saved.',
    });

    expect(result.validation).toMatchObject({
      verdict: 'unavailable',
      reason: 'Gapwise could not check this response right now.',
    });
  });
});
