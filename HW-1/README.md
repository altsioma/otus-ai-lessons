# Мини-анкета

Учебное full-stack приложение "Мини-анкета". Backend отдаёт заранее заданный список вопросов и принимает ответы пользователя, храня их в памяти процесса (без базы данных). Frontend загружает вопросы, показывает форму, отправляет заполненные ответы и после успешной отправки показывает сообщение «Спасибо!».

## Стек технологий

- **Backend:** Node.js, TypeScript, Express
- **Frontend:** React, TypeScript, Vite
- **Инфраструктура:** Docker, Docker Compose, nginx (раздача frontend + прокси на backend)

## Структура проекта

```
.
├── backend/                     # Express API
│   ├── src/
│   │   ├── data/questions.ts    # статичный список вопросов
│   │   ├── routes/
│   │   │   ├── questions.ts     # GET /questions
│   │   │   └── answers.ts       # POST /answers
│   │   ├── store/answersStore.ts# in-memory хранилище ответов
│   │   ├── types.ts             # общие типы
│   │   ├── app.ts                # сборка Express-приложения
│   │   └── server.ts             # точка входа (запуск сервера)
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                    # React SPA
│   ├── src/
│   │   ├── api/client.ts        # getQuestions(), submitAnswers()
│   │   ├── components/
│   │   │   ├── SurveyForm.tsx   # форма анкеты
│   │   │   └── ThankYou.tsx     # экран "Спасибо!"
│   │   ├── types.ts
│   │   ├── App.tsx              # состояния: loading → form → thanks
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf               # раздача статики + прокси /api на backend
│   ├── package.json
│   └── vite.config.ts
│
├── docker-compose.yml           # backend + frontend в общей сети
├── .env.example                 # шаблон переменных окружения для Docker
├── PROMPTS.md                   # история промптов, использованных при разработке
└── README.md
```

## Установка зависимостей

Из корня каждого проекта:

```bash
cd backend && npm install
cd ../frontend && npm install
```

## Запуск backend

```bash
cd backend
npm run dev      # разработка (tsx watch), http://localhost:4000
npm run build    # компиляция TypeScript в dist/
npm start        # запуск собранного проекта (после npm run build)
```

## Запуск frontend

```bash
cd frontend
npm run dev       # разработка (Vite), http://localhost:5173
npm run build      # production-сборка в dist/
npm run preview    # предпросмотр production-сборки
```

Backend должен быть запущен параллельно. Адрес backend для frontend задаётся через `VITE_API_BASE_URL` (см. `frontend/.env`), по умолчанию `http://localhost:4000`.

## REST API

### GET /questions

Возвращает список вопросов анкеты (3–5 штук, заранее заданы на backend).

**Пример запроса:**

```bash
curl http://localhost:4000/questions
```

**Пример ответа (200 OK):**

```json
[
  { "id": 1, "text": "Как вас зовут?" },
  { "id": 2, "text": "Сколько вам лет?" },
  { "id": 3, "text": "Какой ваш любимый язык программирования?" },
  { "id": 4, "text": "Как часто вы пишете код?" }
]
```

### POST /answers

Принимает ответы пользователя и сохраняет их в памяти приложения.

**Тело запроса:**

```json
{
  "answers": [
    { "questionId": 1, "answer": "Александр" },
    { "questionId": 2, "answer": "30" }
  ]
}
```

**Пример запроса:**

```bash
curl -X POST http://localhost:4000/answers \
  -H "Content-Type: application/json" \
  -d '{"answers":[{"questionId":1,"answer":"Александр"},{"questionId":2,"answer":"30"}]}'
```

**Пример успешного ответа (201 Created):**

```json
{
  "message": "Ответы сохранены",
  "submission": {
    "id": "c0f01738-e4b2-4c19-9397-78ec55e2edfe",
    "submittedAt": "2026-07-14T18:51:33.364Z",
    "answers": [
      { "questionId": 1, "answer": "Александр" },
      { "questionId": 2, "answer": "30" }
    ]
  }
}
```

При некорректных данных (пустой массив ответов, неизвестный `questionId` и т.п.) возвращается `400 Bad Request` с телом вида `{"error": "..."}`.

## Пользовательский сценарий

1. Пользователь открывает frontend — приложение показывает индикатор загрузки и запрашивает вопросы через `GET /questions`.
2. Если backend недоступен — вместо формы показывается сообщение об ошибке.
3. После успешной загрузки отображается форма анкеты с текстовыми полями под каждый вопрос.
4. Пользователь заполняет все поля и нажимает "Отправить" — frontend вызывает `POST /answers`.
5. При успешном сохранении ответов экран переключается на сообщение **"Спасибо!"**.

## Локальный запуск (без Docker)

Backend (порт 4000):

```bash
cd backend
npm install
npm run dev
```

Frontend (порт 5173):

```bash
cd frontend
npm install
npm run dev
```

## Запуск через Docker

Требуется установленный Docker и Docker Compose.

```bash
docker compose up --build
```

После сборки и запуска:
- frontend будет доступен на `http://localhost:8080`;
- backend — на `http://localhost:4000` (проброшен для отладки, но frontend обращается к нему не через этот порт, а через собственный nginx-прокси по внутреннему имени Docker-сервиса `backend`).

Порты и адрес backend можно переопределить через `.env` в корне проекта (см. `.env.example`):

```bash
cp .env.example .env
```

### Остановка контейнеров

```bash
docker compose down
```

Флаг `-v` дополнительно удалит volume'ы, если они появятся в будущем:

```bash
docker compose down -v
```

## Как устроена Docker-инфраструктура

- **backend/Dockerfile** — многоэтапная сборка: на первом этапе компилируется TypeScript (`npm run build`), на втором — устанавливаются только production-зависимости и запускается `node dist/server.js`.
- **frontend/Dockerfile** — многоэтапная сборка: на первом этапе Vite собирает статический бандл React-приложения, на втором — `nginx:alpine` раздаёт эти файлы.
- **frontend/nginx.conf** — nginx отдаёт SPA и проксирует запросы `/api/*` на backend по имени Docker-сервиса `backend`, поэтому браузер обращается к API через тот же origin, что и сама страница (без CORS и без `localhost` внутри контейнера).
- **docker-compose.yml** — поднимает оба сервиса в общей сети `mini-survey-network`; frontend зависит от backend и обращается к нему по имени сервиса.
