import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import questionsRouter from './routes/questions';
import answersRouter from './routes/answers';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/questions', questionsRouter);
  app.use('/answers', answersRouter);

  // 404 — маршрут не найден
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Маршрут не найден' });
  });

  // Централизованная обработка ошибок
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}
