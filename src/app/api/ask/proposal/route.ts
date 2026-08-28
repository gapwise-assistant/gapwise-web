import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { persistAskProposal } from '@/lib/ask/conversationContext';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { normalizeAskContextProposals, type AskContextProposal } from '@/types/ask';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { boundedId } from '@/lib/ids/boundedId';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  action: z.enum(['add', 'dismiss']),
  chatId: z.string().trim().min(1).optional(),
  assistantMessageId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
});

function proposalHistoryEventId(
  project: Awaited<ReturnType<typeof persistAskProposal>> | undefined,
  assistantMessageId: string,
  proposalId: string,
): string | undefined {
  const sourceId = boundedId('ask_proposal', `${assistantMessageId}_${proposalId}`);
  return [...(project?.historyEvents ?? [])]
    .reverse()
    .find((event) => event.sourceId === sourceId)?.id;
}

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
    return errorResponse(new StorageError('This proposal belongs to another workspace scope.', 'PERMISSION_DENIED'), 403);
  }

  const storedProposals = normalizeAskContextProposals(message.contextProposals ?? message.proposals);
  const proposal = storedProposals.find((candidate) => candidate.id === parsed.data.proposalId);
  if (!proposal) return errorResponse(new Error('The proposed context update was not found.'), 404);

  if (proposal.confirmationStatus === 'added') {
    return NextResponse.json({ proposal });
  }

  let updatedProposal: AskContextProposal = {
    ...proposal,
    confirmationStatus: parsed.data.action === 'add' ? 'added' : 'dismissed',
    sourceMessageId: proposal.sourceMessageId ?? message.id,
  };

  const messageWithProposal = (nextProposal: AskContextProposal) => ({
    ...message,
    contextProposals: storedProposals.map((candidate) =>
      candidate.id === nextProposal.id ? nextProposal : candidate
    ),
    proposals: storedProposals.map((candidate) =>
      candidate.id === nextProposal.id ? nextProposal : candidate
    ),
  });

  try {
    let updatedProject: Awaited<ReturnType<typeof persistAskProposal>> | undefined;
    if (parsed.data.action === 'dismiss') {
      await storage.saveAskMessage(userId, messageWithProposal(updatedProposal));
    } else {
      // Mark the proposal as added before applying it so a completed graph
      // mutation and its durable proposal state cannot diverge on reload.
      await storage.saveAskMessage(userId, messageWithProposal(updatedProposal));
      try {
        updatedProject = await persistAskProposal({
          userId,
          projectId: parsed.data.projectId,
          assistantMessageId: message.id,
          proposal: updatedProposal,
        });
      } catch (error) {
        const pending: AskContextProposal = { ...updatedProposal, confirmationStatus: 'pending' };
        await storage.saveAskMessage(userId, messageWithProposal(pending));
        throw error;
      }
    }
    if (parsed.data.projectId) {
      try {
        const historyEventId = proposalHistoryEventId(
          updatedProject,
          message.id,
          updatedProposal.id ?? parsed.data.proposalId,
        );
        await createProjectSnapshot({
          userId,
          projectId: parsed.data.projectId,
          trigger: {
            type: parsed.data.action === 'add' ? 'ask_proposal_added' : 'ask_proposal_dismissed',
            askMessageId: message.id,
            proposalId: updatedProposal.id,
            ...(historyEventId ? { historyEventId } : {}),
          },
          label: parsed.data.action === 'add' ? 'Ask proposal added' : 'Ask proposal dismissed',
          summary: updatedProposal.text,
        });
      } catch (snapshotError) {
        // Snapshot observability must not make a completed proposal action fail.
        console.warn('[Project snapshots] proposal snapshot unavailable', snapshotError);
      }
    }
    return NextResponse.json({ proposal: updatedProposal });
  } catch (error) {
    if (error instanceof StorageError) return errorResponse(error, storageErrorStatus(error));
    return errorResponse(error, 503);
  }
}
