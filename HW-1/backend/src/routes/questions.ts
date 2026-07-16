import { Router, Request, Response } from 'express';
import { questions } from '../data/questions';

const router = Router();

// GET /questions — вернуть список вопросов анкеты
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json(questions);
});

export default router;
