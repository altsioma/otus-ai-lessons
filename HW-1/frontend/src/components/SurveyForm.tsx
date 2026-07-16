import { FormEvent, useState } from 'react';
import { AnswerItem, Question } from '../types';
import { submitAnswers } from '../api/client';

interface SurveyFormProps {
  questions: Question[];
  onSuccess: () => void;
}

export function SurveyForm({ questions, onSuccess }: SurveyFormProps) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(questionId: number, value: string) {
    setValues((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const answers: AnswerItem[] = questions.map((question) => ({
      questionId: question.id,
      answer: (values[question.id] ?? '').trim(),
    }));

    if (answers.some((item) => item.answer.length === 0)) {
      setError('Пожалуйста, ответьте на все вопросы.');
      return;
    }

    setSubmitting(true);
    try {
      await submitAnswers(answers);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить ответы.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="survey-form" onSubmit={handleSubmit}>
      {questions.map((question) => (
        <div className="survey-form__field" key={question.id}>
          <label htmlFor={`question-${question.id}`}>{question.text}</label>
          <input
            id={`question-${question.id}`}
            type="text"
            value={values[question.id] ?? ''}
            onChange={(event) => handleChange(question.id, event.target.value)}
            disabled={submitting}
          />
        </div>
      ))}

      {error && <p className="survey-form__error">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Отправка...' : 'Отправить'}
      </button>
    </form>
  );
}
