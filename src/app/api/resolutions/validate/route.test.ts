import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { validateProjectResolution } from '@/lib/resolutions/resolutionValidation';
import { StorageError } from '@/lib/storage/types';

vi.mock('@/lib/auth/server', () => ({ requireAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/resolutions/resolutionValidation', () => ({ validateProjectResolution: vi.fn() }));

function request(body: unknown): Request {
  return new Request('http://localhost/api/resolutions/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/resolutions/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('owner-user');
    vi.mocked(validateProjectResolution).mockResolvedValue({
      validation: {
        verdict: 'sufficient',
        reason: 'The answer directly addresses the question.',
        missingInformation: [],
        confidence: 0.94,
      },
      fingerprint: 'resolution-fingerprint',
      project: {} as never,
      node: {} as never,
    });
  });

  it('loads trusted project context on the server and returns only validation data', async () => {
    const response = await POST(request({
      userId: 'owner-user',
      projectId: 'project_1',
      nodeId: 'question_1',
      proposedResponse: 'The appointment is confirmed for Friday at 9:00 AM.',
    }));

    expect(response.status).toBe(200);
    expect(validateProjectResolution).toHaveBeenCalledWith({
      userId: 'owner-user',
      projectId: 'project_1',
      nodeId: 'question_1',
      proposedResponse: 'The appointment is confirmed for Friday at 9:00 AM.',
    });
    await expect(response.json()).resolves.toEqual({
      validation: expect.objectContaining({ verdict: 'sufficient' }),
      fingerprint: 'resolution-fingerprint',
    });
  });

  it('rejects public-demo access before validation can run', async () => {
    vi.mocked(requireAuthenticatedUserId).mockRejectedValue(
      new StorageError('This action is unavailable in the public demo.', 'PERMISSION_DENIED'),
    );

    const response = await POST(request({
      userId: 'public-user',
      projectId: 'project_1',
      nodeId: 'question_1',
      proposedResponse: 'A response.',
    }));

    expect(response.status).toBe(403);
    expect(validateProjectResolution).not.toHaveBeenCalled();
  });

  it('rejects unbounded or incomplete input before loading project state', async () => {
    const response = await POST(request({
      userId: 'owner-user',
      projectId: 'project_1',
      nodeId: 'question_1',
      proposedResponse: '',
    }));

    expect(response.status).toBe(400);
    expect(validateProjectResolution).not.toHaveBeenCalled();
  });
});
