import { AnswerItem, Question, SubmitAnswersResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Ошибка запроса: ${response.status}`;
    try {
      const data: unknown = await response.json();
      if (
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof (data as { error: unknown }).error === 'string'
      ) {
        message = (data as { error: string }).error;
      }
    } catch {
      // тело ответа не JSON — используем сообщение по умолчанию
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/** GET /questions — получить список вопросов анкеты */
export async function getQuestions(): Promise<Question[]> {
  const response = await fetch(`${API_BASE_URL}/questions`);
  return handleResponse<Question[]>(response);
}

/** POST /answers — отправить ответы пользователя */
export async function submitAnswers(answers: AnswerItem[]): Promise<SubmitAnswersResponse> {
  const response = await fetch(`${API_BASE_URL}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  return handleResponse<SubmitAnswersResponse>(response);
}
