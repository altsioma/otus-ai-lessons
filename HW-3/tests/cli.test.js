import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/config.js';
import { EXIT_CODES, runCli } from '../src/cli.js';

const MAIN = fileURLToPath(new URL('../main.js', import.meta.url));
// Пустой рабочий каталог: настоящий .env проекта не подхватывается.
const cwd = mkdtempSync(join(tmpdir(), 'task-agent-cli-'));

afterAll(() => rmSync(cwd, { recursive: true, force: true }));

// Порт 1 на loopback закрыт: процесс не обращается ни к настоящему Ollama, ни к модели.
const UNREACHABLE_OLLAMA = 'http://127.0.0.1:1';

function runMain(args, env = {}) {
  return spawnSync(process.execPath, [MAIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, OLLAMA_BASE_URL: UNREACHABLE_OLLAMA, ...env },
    timeout: 15_000,
  });
}

function memoryStream() {
  let text = '';
  return { write: (chunk) => { text += chunk; }, get text() { return text; } };
}

describe('main.js (отдельный процесс)', () => {
  it('без запроса печатает инструкцию и завершается с кодом 2', () => {
    const result = runMain([]);

    expect(result.status).toBe(EXIT_CODES.usage);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('npm start -- "<запрос на естественном языке>"');
  });

  it('без токенов доходит до модели и при недоступном Ollama печатает понятную ошибку с кодом 1', () => {
    const result = runMain(['покажи', 'статистику', 'задач']);

    expect(result.status).toBe(EXIT_CODES.resultError);
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'error',
      action: 'none',
      data: null,
      errors: ['Ollama не запущен или недоступен. Запустите сервер командой: ollama serve (адрес задаётся OLLAMA_BASE_URL).'],
    });
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it('при некорректной конфигурации печатает структурированную ошибку и завершается с кодом 3', () => {
    const result = runMain(['статистика'], { OLLAMA_BASE_URL: 'not-a-url' });

    expect(result.status).toBe(EXIT_CODES.setupError);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ status: 'error', action: 'none', data: null });
    expect(output.errors[0]).toContain('OLLAMA_BASE_URL');
  });
});

describe('runCli', () => {
  const config = { ollama: { baseUrl: 'http://ollama.test:11434', model: 'qwen3:8b' }, api: { baseUrl: 'http://api.test' } };

  function run(args, { state, createError } = {}) {
    const stdout = memoryStream();
    const stderr = memoryStream();
    const agent = { invoke: vi.fn().mockResolvedValue(state) };
    const createAgentImpl = vi.fn(() => {
      if (createError) throw createError;
      return { agent };
    });
    const promise = runCli(args, { stdout, stderr, loadConfigImpl: () => config, createAgentImpl });
    return { promise, stdout, stderr, agent, createAgentImpl };
  }

  it('объединяет аргументы в один запрос и печатает только финальный JSON', async () => {
    const response = { status: 'success', action: 'none', data: { message: 'Я умею управлять задачами.' }, errors: [] };
    const { promise, stdout, agent } = run(['что', 'ты', 'умеешь?'], { state: { messages: [], structuredResponse: response } });

    expect(await promise).toBe(EXIT_CODES.success);
    expect(agent.invoke).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'что ты умеешь?' }] });
    expect(stdout.text).toBe(`${JSON.stringify(response, null, 2)}\n`);
  });

  it('возвращает код 1 при итоговом status error', async () => {
    const response = { status: 'error', action: 'none', data: null, errors: ['Удаление задач не поддерживается'] };
    const { promise, stdout } = run(['удали', 'все', 'задачи'], { state: { messages: [], structuredResponse: response } });

    expect(await promise).toBe(EXIT_CODES.resultError);
    expect(JSON.parse(stdout.text)).toEqual(response);
  });

  it('без запроса не создаёт агента', async () => {
    const { promise, createAgentImpl, stdout } = run(['  ']);

    expect(await promise).toBe(EXIT_CODES.usage);
    expect(createAgentImpl).not.toHaveBeenCalled();
    expect(stdout.text).toBe('');
  });

  it('возвращает код 3 при ошибке конфигурации', async () => {
    const { promise, stdout } = run(['статистика'], { createError: new ConfigError('Некорректная конфигурация: OLLAMA_BASE_URL') });

    expect(await promise).toBe(EXIT_CODES.setupError);
    expect(JSON.parse(stdout.text).errors).toEqual(['Некорректная конфигурация: OLLAMA_BASE_URL']);
  });

  it('возвращает код 3 при ошибке инициализации без stack trace', async () => {
    const { promise, stdout, stderr } = run(['статистика'], { createError: new TypeError('boom') });

    expect(await promise).toBe(EXIT_CODES.setupError);
    expect(JSON.parse(stdout.text).errors).toEqual(['Не удалось инициализировать агента.']);
    expect(stderr.text).toContain('TypeError: boom');
    expect(stderr.text).not.toMatch(/\n\s+at /);
  });
});
