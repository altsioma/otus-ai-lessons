import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('загружается без каких-либо токенов и подставляет значения по умолчанию', () => {
    const config = loadConfig({});

    expect(config.ollama).toEqual({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b', timeoutMs: 120_000 });
    expect(config.api.port).toBe(3000);
    expect(config.api.baseUrl).toBe('http://localhost:3000');
    expect(config).not.toHaveProperty('openai');
  });

  it('считает пустые строки незаданными значениями', () => {
    const config = loadConfig({ OLLAMA_BASE_URL: '', OLLAMA_MODEL: '  ', API_PORT: '' });

    expect(config.ollama.baseUrl).toBe('http://127.0.0.1:11434');
    expect(config.ollama.model).toBe('qwen3:8b');
    expect(config.api.port).toBe(3000);
  });

  it('читает значения из окружения', () => {
    const config = loadConfig({
      OLLAMA_BASE_URL: 'http://192.168.1.10:11434/',
      OLLAMA_MODEL: 'qwen3:4b',
      OLLAMA_TIMEOUT_MS: '30000',
      API_PORT: '4000',
      API_BASE_URL: 'http://127.0.0.1:4000/',
    });

    expect(config.ollama).toEqual({ baseUrl: 'http://192.168.1.10:11434', model: 'qwen3:4b', timeoutMs: 30_000 });
    expect(config.api).toEqual({ port: 4000, baseUrl: 'http://127.0.0.1:4000' });
  });

  it('игнорирует устаревшие переменные OpenAI', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'sk-old', OPENAI_MODEL: 'gpt-4.1-mini' });

    expect(config.ollama.model).toBe('qwen3:8b');
    expect(JSON.stringify(config)).not.toContain('sk-old');
  });

  it('строит API_BASE_URL из API_PORT, если URL не задан', () => {
    expect(loadConfig({ API_PORT: '8080' }).api.baseUrl).toBe('http://localhost:8080');
  });

  it.each([
    [{ API_PORT: 'abc' }],
    [{ API_PORT: '70000' }],
    [{ API_BASE_URL: 'not-a-url' }],
    [{ OLLAMA_BASE_URL: 'not-a-url' }],
    [{ OLLAMA_TIMEOUT_MS: '10' }],
  ])('отклоняет некорректные значения %o', (env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });
});
