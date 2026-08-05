import { Router, Request, Response } from 'express';
import { questions } from '../data/questions';
import { addAnswerSubmission } from '../store/answersStore';
import { AnswerItem, AnswerSubmission } from '../types';

const router = Router();

function isValidAnswerItem(item: unknown): item is AnswerItem {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.questionId === 'number' &&
    typeof candidate.answer === 'string' &&
    candidate.answer.trim().length > 0
  );
}

// POST /answers — принять и сохранить ответы пользователя
router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<AnswerSubmission> | undefined;

  if (!body || !Array.isArray(body.answers) || body.answers.length === 0) {
    res.status(400).json({ error: 'Поле "answers" должно быть непустым массивом.' });
    return;
  }

  if (!body.answers.every(isValidAnswerItem)) {
    res.status(400).json({
      error: 'Каждый ответ должен содержать числовой "questionId" и непустую строку "answer".',
    });
    return;
  }

  const knownQuestionIds = new Set(questions.map((q) => q.id));
  const unknownIds = body.answers
    .map((item) => item.questionId)
    .filter((id) => !knownQuestionIds.has(id));

  if (unknownIds.length > 0) {
    res.status(400).json({ error: `Неизвестные questionId: ${unknownIds.join(', ')}` });
    return;
  }

  const stored = addAnswerSubmission({ answers: body.answers });

  res.status(201).json({ message: 'Ответы сохранены', submission: stored });
});

export default router;
