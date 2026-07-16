import { randomUUID } from 'crypto';
import { AnswerSubmission, StoredAnswerSubmission } from '../types';

/**
 * In-memory хранилище ответов.
 * Данные живут только пока запущен процесс сервера.
 */
const answers: StoredAnswerSubmission[] = [];

export function addAnswerSubmission(
  submission: AnswerSubmission,
): StoredAnswerSubmission {
  const stored: StoredAnswerSubmission = {
    id: randomUUID(),
    submittedAt: new Date().toISOString(),
    answers: submission.answers,
  };

  answers.push(stored);
  return stored;
}

export function getAllAnswerSubmissions(): StoredAnswerSubmission[] {
  return answers;
}
