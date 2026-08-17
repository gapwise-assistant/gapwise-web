import { describe, expect, it } from 'vitest';
import { chatPickerOptions, ChatSession } from '@/components/AskGapswise';

function chat(id: string, question: string): ChatSession {
  return {
    id,
    title: question,
    createdAt: '2026-08-17T18:00:00.000Z',
    firstQuestion: question,
    sessionId: null,
    messages: [{ id: `${id}_message`, role: 'user', text: question }],
  };
}

describe('Ask chat picker', () => {
  it('keeps older chats available while a new unsent chat is active', () => {
    const options = chatPickerOptions(
      [chat('older-1', 'Review the first decision'), chat('older-2', 'Compare the alternatives')],
      chat('draft', ''),
    );

    expect(options.map((option) => option.id)).toEqual(['draft', 'older-1', 'older-2']);
    expect(options[0].label).toBe('New chat (unsent)');
    expect(options[2].title).toContain('Compare the alternatives');
  });
});
