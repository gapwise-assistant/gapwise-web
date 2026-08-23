import { describe, expect, it } from 'vitest';
import { canonicalAskQuestions, chatPickerOptions, ChatSession, researchStatusFromRecords, restoreChatSessions } from '@/components/AskGapswise';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';

function chat(id: string, question: string, messagesCount = 1): ChatSession {
  return {
    id,
    title: question || 'New chat',
    createdAt: '2026-08-17T18:00:00.000Z',
    firstQuestion: question,
    sessionId: null,
    messages: messagesCount > 0 ? [{ id: `${id}_message`, role: 'user', text: question }] : [],
  };
}

describe('Ask chat picker', () => {
  it('keeps older chats available while a new unsent chat is active', () => {
    const options = chatPickerOptions(
      [chat('older-1', 'Review the first decision'), chat('older-2', 'Compare the alternatives')],
      chat('draft', '', 0),
    );

    expect(options.map((option) => option.id)).toEqual(['draft', 'older-1', 'older-2']);
    expect(options[0].label).toBe('New chat (unsent)');
    expect(options[2].title).toContain('Compare the alternatives');
  });

  it('restores database chats and their messages into chat sessions', () => {
    const restored = restoreChatSessions(
      [{
        id: 'chat_db',
        title: 'Stored chat',
        adkSessionId: 'session_db',
        target: { type: 'decision', id: 'decision_1', text: 'Choose the release path.' },
        createdAt: '2026-08-17T18:00:00.000Z',
        updatedAt: '2026-08-17T18:01:00.000Z',
      }],
      [{
        id: 'message_db',
        chatId: 'chat_db',
        role: 'user',
        text: 'Restore this question',
        sources: [],
        createdAt: '2026-08-17T18:00:01.000Z',
      }],
    );

    expect(restored).toEqual([expect.objectContaining({
      id: 'chat_db',
      firstQuestion: 'Restore this question',
      sessionId: 'session_db',
      target: { type: 'decision', id: 'decision_1', text: 'Choose the release path.' },
      messages: [expect.objectContaining({ id: 'message_db', text: 'Restore this question' })],
    })]);
  });
});

describe('Ask research persistence state', () => {
  it('restores saved and confirmed actions from persisted research records', () => {
    const status = researchStatusFromRecords([
      { assistantMessageId: 'assistant_saved', action: 'save' },
      { assistantMessageId: 'assistant_confirmed', action: 'use_as_answer', targetQuestionId: 'question_1', status: 'confirmed' },
      { assistantMessageId: 'assistant_decision', action: 'use_as_decision', targetDecisionId: 'decision_1', status: 'confirmed' },
      { assistantMessageId: 'assistant_pending', action: 'use_as_answer', targetQuestionId: 'question_2', status: 'pending' },
      { assistantMessageId: 'assistant_context', action: 'save_as_context', provenance: 'user_confirmed_ai_response' },
      { assistantMessageId: 'assistant_legacy' },
    ]);

    expect([...status.savedMessageIds]).toEqual(['assistant_saved', 'assistant_legacy']);
    expect([...status.savedContextMessageIds]).toEqual(['assistant_context']);
    expect([...status.confirmedAnswerMessageIds]).toEqual(['assistant_confirmed']);
    expect([...status.confirmedDecisionMessageIds]).toEqual(['assistant_decision']);
  });
});

describe('Ask answer targeting', () => {
  it('uses stored question IDs instead of grouping answer targets by display text', () => {
    const questions = canonicalAskQuestions([
      { id: 'question_a', text: 'What is the current status of the launch input?' },
      { id: 'question_b', text: 'What action should I take for the launch input?' },
      { id: 'question_a', text: 'A duplicate display copy for the same stored question.' },
    ]);

    expect(questions).toEqual([
      { id: 'question_a', text: 'What is the current status of the launch input?' },
      { id: 'question_b', text: 'What action should I take for the launch input?' },
    ]);
  });
});

describe('Source title sanitization', () => {
  it('never displays raw Ask chat filenames to the user', () => {
    expect(humanizeSourceTitle('Ask chat chat_123 message user_456.txt')).toBe('Conversation context');
    expect(humanizeSourceTitle('ask_chat_123_user_456.txt')).toBe('Conversation context');
    expect(humanizeSourceTitle('ask_session_turn.md')).toBe('Conversation context');
    expect(humanizeSourceTitle('clinicflow-project-plan.md')).toBe('Clinicflow Project Plan');
  });
});
