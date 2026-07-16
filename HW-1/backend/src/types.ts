export interface Question {
  id: number;
  text: string;
}

export interface AnswerItem {
  questionId: number;
  answer: string;
}

export interface AnswerSubmission {
  answers: AnswerItem[];
}

export interface StoredAnswerSubmission extends AnswerSubmission {
  id: string;
  submittedAt: string;
}
