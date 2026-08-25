import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { persistAskProposal } from '@/lib/ask/conversationContext';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { normalizeAskContextProposals, type AskContextProposal } from '@/types/ask';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  action: z.enum(['add', 'dismiss']),
  chatId: z.string().trim().min(1).optional(),
  assistantMessageId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
});

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : 'Ask proposal action failed.',
  }, { status });
}

function storageErrorStatus(error: StorageError): number {
  if (error.code === 'PERMISSION_DENIED') return 403;
  if (error.code === 'VALIDATION_ERROR') return 400;
  return 503;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(new Error('Invalid JSON body.'), 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(new Error('Invalid Ask proposal request.'), 400);

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    return errorResponse(error, 401);
  }

  const storage = getStorageProvider();
  const [chats, messages] = await Promise.all([
    storage.getAskChats(userId),
    storage.getAskMessages(userId),
  ]);
  const message = messages.find((candidate) => candidate.id === parsed.data.assistantMessageId);
  const chat = chats.find((candidate) => candidate.id === message?.chatId);

  if (!message || message.role !== 'assistant' || !chat) {
    return errorResponse(new StorageError('The Ask message was not found.', 'PERMISSION_DENIED'), 403);
  }
  if (parsed.data.chatId && parsed.data.chatId !== message.chatId) {
    return errorResponse(new StorageError('This proposal belongs to another chat.', 'PERMISSION_DENIED'), 403);
  }
  if ((chat.projectId ?? undefined) !== (parsed.data.projectId ?? undefined)) {
    return errorResponse(new StorageError('This proposal belongs to another project scope.', 'PERMISSION_DENIED'), 403);
  }

  const storedProposals = normalizeAskContextProposals(message.contextProposals ?? message.proposals);
  const proposal = storedProposals.find((candidate) => candidate.id === parsed.data.proposalId);
  if (!proposal) return errorResponse(new Error('The proposed context update was not found.'), 404);

  if (proposal.confirmationStatus === 'added' || proposal.confirmationStatus === 'dismissed') {
    return NextResponse.json({ proposal });
  }

  let updatedProposal: AskContextProposal = {
    ...proposal,
    confirmationStatus: parsed.data.action === 'add' ? 'added' : 'dismissed',
    sourceMessageId: proposal.sourceMessageId ?? message.id,
  };

  try {
    if (parsed.data.action === 'add') {
      await persistAskProposal({
        userId,
        projectId: parsed.data.projectId,
        assistantMessageId: message.id,
        proposal: updatedProposal,
      });
    }

    await storage.saveAskMessage(userId, {
      ...message,
      contextProposals: storedProposals.map((candidate) =>
        candidate.id === updatedProposal.id ? updatedProposal : candidate
      ),
      proposals: storedProposals.map((candidate) =>
        candidate.id === updatedProposal.id ? updatedProposal : candidate
      ),
    });
    return NextResponse.json({ proposal: updatedProposal });
  } catch (error) {
    if (error instanceof StorageError) return errorResponse(error, storageErrorStatus(error));
    return errorResponse(error, 503);
  }
}
