import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzePdfFromGcs } from '@/lib/context/pdfAnalysis';
import { uploadContextSourcePdf } from '@/lib/storage/gcsAssets';
import { POST } from './route';

vi.mock('@/lib/context/pdfAnalysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/context/pdfAnalysis')>();
  return { ...actual, analyzePdfFromGcs: vi.fn() };
});
vi.mock('@/lib/storage/gcsAssets', () => ({
  uploadContextSourcePdf: vi.fn(),
  deleteContextSourceObject: vi.fn(),
}));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
  else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  vi.clearAllMocks();
});

describe('POST /api/storage/assets in demo mode', () => {
  it('returns local metadata and fixture extraction without GCS or Gemini', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const form = new FormData();
    form.set('userId', 'demo-user');
    form.set('sourceId', 'src_demo_pdf');
    form.set('filename', 'demo.pdf');
    form.set('file', new File([Buffer.from('%PDF demo')], 'demo.pdf', { type: 'application/pdf' }));

    const response = await POST(new Request('http://localhost/api/storage/assets', { method: 'POST', body: form }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.storageUrl).toMatch(/^local-demo:/);
    expect(body.extraction.summary).toContain('Gapswise hackathon presentation');
    expect(body.extraction.nodes).toHaveLength(2);
    expect(body.modelUsed).toBe('demo-fixture-v1');
    expect(uploadContextSourcePdf).not.toHaveBeenCalled();
    expect(analyzePdfFromGcs).not.toHaveBeenCalled();
  });
});
