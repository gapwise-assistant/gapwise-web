import { NextResponse } from 'next/server';
import { analyzePdfFromGcs } from '@/lib/context/pdfAnalysis';
import { deleteContextSourceObject, uploadContextSourcePdf } from '@/lib/storage/gcsAssets';
import { StorageError } from '@/lib/storage/types';
import { DEMO_PDF_EXTRACTION } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { makeLocalDemoStorageUrl } from '@/lib/storage/assets';

export const runtime = 'nodejs';

function jsonError(error: unknown) {
  if (error instanceof StorageError) {
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'VALIDATION_ERROR'
            ? 400
            : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Context asset request failed.', code: 'UNAVAILABLE' },
    { status: 500 }
  );
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const userId = String(formData.get('userId') ?? '').trim();
    const sourceId = String(formData.get('sourceId') ?? '').trim();
    const filename = String(formData.get('filename') ?? '').trim();
    const file = formData.get('file');

    if (!userId) throw new StorageError('Missing userId.', 'UNAUTHENTICATED');
    if (!sourceId) throw new StorageError('Missing sourceId.', 'VALIDATION_ERROR');
    if (!filename) throw new StorageError('Missing filename.', 'VALIDATION_ERROR');
    if (!(file instanceof File)) throw new StorageError('Missing PDF file.', 'VALIDATION_ERROR');
    if (!isPdf(file)) throw new StorageError('Only PDF Context Inbox uploads are supported for Cloud Storage.', 'VALIDATION_ERROR');

    if (isDemoMode()) {
      return NextResponse.json({
        bucket: null,
        objectName: null,
        storageUrl: makeLocalDemoStorageUrl(`users/${userId}/sources/${sourceId}/${filename}`),
        extraction: DEMO_PDF_EXTRACTION,
        modelUsed: 'demo-fixture-v1',
        processedAt: new Date().toISOString(),
      });
    }

    const result = await uploadContextSourcePdf({
      userId,
      sourceId,
      filename,
      contentType: file.type || 'application/pdf',
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    try {
      const analysis = await analyzePdfFromGcs({
        sourceId,
        storageUrl: result.storageUrl,
        mimeType: file.type || 'application/pdf',
      });

      return NextResponse.json({
        ...result,
        extraction: analysis.extraction,
        modelUsed: analysis.modelUsed,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      return NextResponse.json(
        {
          ...result,
          error: error instanceof Error ? error.message : 'Gemini PDF extraction failed.',
          code: 'UNAVAILABLE',
        },
        { status: 503 }
      );
    }
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { storageUrl?: string };
    const storageUrl = body.storageUrl?.trim();
    if (!storageUrl) throw new StorageError('Missing storageUrl.', 'VALIDATION_ERROR');

    if (isDemoMode()) {
      if (!storageUrl.startsWith('local-demo://')) {
        throw new StorageError('Demo mode only deletes local demo asset metadata.', 'VALIDATION_ERROR');
      }
      return NextResponse.json({ ok: true });
    }

    await deleteContextSourceObject({ storageUrl });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
