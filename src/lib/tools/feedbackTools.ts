import { QuestionFeedback } from '@/types/clarity';
import { getStorageProvider } from '@/lib/storage';
import { FirestoreFeedback } from '@/lib/storage/types';

export async function saveFeedback(userId: string, feedback: QuestionFeedback): Promise<void> {
  const record: FirestoreFeedback = {
    id: feedback.id,
    userId,
    question_id: feedback.question_id,
    node_id: feedback.node_id,
    rating: feedback.rating,
    answer: feedback.answer,
    status: 'ACTIVE',
    createdAt: feedback.timestamp,
    updatedAt: feedback.timestamp,
  };
  await getStorageProvider().saveFeedback(userId, record);
}

export async function getUpcomingEvents() {
  return [];
}
