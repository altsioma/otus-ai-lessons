import { useEffect, useState } from 'react';
import { Question } from './types';
import { getQuestions } from './api/client';
import { SurveyForm } from './components/SurveyForm';
import { ThankYou } from './components/ThankYou';

type Screen = 'loading' | 'error' | 'form' | 'thanks';

function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      setScreen('loading');
      try {
        const data = await getQuestions();
        if (!cancelled) {
          setQuestions(data);
          setScreen('form');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : 'Не удалось загрузить вопросы.',
          );
          setScreen('error');
        }
      }
    }

    loadQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app">
      <h1>Мини-анкета</h1>

      {screen === 'loading' && <p>Загрузка вопросов...</p>}

      {screen === 'error' && <p className="app__error">Ошибка: {errorMessage}</p>}

      {screen === 'form' && (
        <SurveyForm questions={questions} onSuccess={() => setScreen('thanks')} />
      )}

      {screen === 'thanks' && <ThankYou />}
    </main>
  );
}

export default App;
