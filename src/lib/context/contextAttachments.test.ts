import { describe, expect, it } from 'vitest';
import { CONTEXT_ATTACHMENT_MAX_BYTES, validateContextAttachment } from '@/lib/context/contextAttachments';

const png1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

describe('Context attachment validation', () => {
  it('accepts supported text, PDF, image, and audio signatures', () => {
    expect(validateContextAttachment({
      type: 'text', filename: 'notes.md', mimeType: 'text/markdown', bytes: Buffer.from('# Notes'),
    })).toMatchObject({ mimeType: 'text/markdown', extension: '.md', sizeBytes: 7 });
    expect(validateContextAttachment({
      type: 'pdf', filename: 'brief.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7\n%%EOF'),
    }).mimeType).toBe('application/pdf');
    expect(validateContextAttachment({
      type: 'image', filename: 'brief.png', mimeType: 'image/png', bytes: png1x1,
    }).mimeType).toBe('image/png');
    expect(validateContextAttachment({
      type: 'voice', filename: 'note.webm', mimeType: 'audio/webm', bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    }).mimeType).toBe('audio/webm');
  });

  it('rejects empty, mismatched, corrupt, and oversized files', () => {
    expect(() => validateContextAttachment({ type: 'pdf', filename: 'brief.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) })).toThrow(/empty/);
    expect(() => validateContextAttachment({ type: 'image', filename: 'brief.png', mimeType: 'application/pdf', bytes: png1x1 })).toThrow(/unsupported MIME/);
    expect(() => validateContextAttachment({ type: 'pdf', filename: 'brief.pdf', mimeType: 'application/pdf', bytes: Buffer.from('not a pdf') })).toThrow(/readable PDF/);
    expect(() => validateContextAttachment({
      type: 'text', filename: 'notes.txt', mimeType: 'text/plain', bytes: Buffer.alloc(CONTEXT_ATTACHMENT_MAX_BYTES.text + 1, 0x61),
    })).toThrow(/larger than the supported limit/);
  });

  it('infers a safe MIME type only when the declared type is absent', () => {
    expect(validateContextAttachment({ type: 'voice', filename: 'note.wav', bytes: Buffer.from('RIFF0000WAVE') })).toMatchObject({
      mimeType: 'audio/wav', extension: '.wav',
    });
  });
});
