import { config } from '../config/env.js';

function buildAuthHeaders(apiKey, { stream = true } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'enterprise-knowledge-qa/1.0'
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  headers.Accept = stream ? 'text/event-stream' : 'application/json';
  return headers;
}

function getProviderConfig(kind = 'llm') {
  if (kind === 'embedding') {
    return {
      provider: config.embeddingProvider,
      baseUrl: config.embeddingBaseUrl,
      apiKey: config.embeddingApiKey,
      modelName: config.embeddingModelName
    };
  }

  return {
    provider: config.llmProvider,
    baseUrl: config.llmBaseUrl,
    apiKey: config.llmApiKey,
    modelName: config.llmModelName
  };
}

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').replace(/\/$/, '');
}

function getChatUrl(provider, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (provider === 'alibaba' || provider === 'aliyun') return `${normalized}/v1/chat/completions`;
  if (provider === 'deepseek') return `${normalized}/chat/completions`;
  if (provider === 'ollama') return `${normalized}/api/chat`;
  return `${normalized}/v1/chat/completions`;
}

function getEmbeddingUrl(provider, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (provider === 'alibaba' || provider === 'aliyun') return `${normalized}/v1/embeddings`;
  if (provider === 'deepseek') return `${normalized}/embeddings`;
  if (provider === 'ollama') return `${normalized}/api/embeddings`;
  return `${normalized}/v1/embeddings`;
}

function extractChatContent(provider, result) {
  if (!result) return '';
  if (provider === 'ollama') return result?.message?.content || result?.response || '';
  return result?.choices?.[0]?.message?.content || result?.choices?.[0]?.delta?.content || result?.output?.text || result?.response || '';
}

function extractEmbedding(provider, result) {
  if (!result) return [];
  if (provider === 'ollama') return result?.embedding || result?.embeddings?.[0] || [];
  return result?.data?.[0]?.embedding || result?.embedding || result?.embeddings?.[0] || [];
}

async function requestJson(url, { apiKey, payload, timeoutMs = 300000 }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(apiKey, { stream: false }),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`大模型调用失败：${response.status} ${text}`);
    }
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('大模型调用超时，请检查模型服务是否正常');
    throw error;
  }
}

async function requestStream(url, { apiKey, provider, payload, timeoutMs = 300000, onChunk }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(apiKey, { stream: true }),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`大模型调用失败：${response.status} ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) return '';

    const decoder = new TextDecoder();
    let buffer = '';
    let fullAnswer = '';

    const handleJson = (data) => {
      const content = extractChatContent(provider, data);
      if (content) {
        fullAnswer += content;
        if (onChunk) onChunk(content);
      }
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed === '[DONE]') return;

      if (trimmed.startsWith('data:')) {
        const dataText = trimmed.slice(5).trim();
        if (!dataText || dataText === '[DONE]') return;
        try { handleJson(JSON.parse(dataText)); } catch { if (onChunk) onChunk(dataText); fullAnswer += dataText; }
        return;
      }

      try {
        handleJson(JSON.parse(trimmed));
      } catch {
        // ignore non-json fragments
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }

    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) handleLine(line);
    }

    return fullAnswer;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('大模型流式调用超时，请检查模型服务是否正常');
    throw error;
  }
}

export async function generateAnswer(prompt) {
  const { provider, baseUrl, apiKey, modelName } = getProviderConfig('llm');
  const chatUrl = getChatUrl(provider, baseUrl);

  console.log('[LLM] 准备调用大模型', { provider, model: modelName, promptLength: String(prompt || '').length });

  const payload = provider === 'ollama'
    ? { model: modelName, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: config.llmTemperature, num_predict: config.llmMaxTokens } }
    : { model: modelName, messages: [{ role: 'user', content: prompt }], temperature: config.llmTemperature, max_tokens: config.llmMaxTokens, stream: false };

  const result = await requestJson(chatUrl, { apiKey, payload });
  const answer = extractChatContent(provider, result);

  console.log('[LLM] 大模型调用完成', { provider, model: modelName, answerLength: String(answer || '').length });
  return answer;
}

export async function generateAnswerStream(prompt, onChunk) {
  const { provider, baseUrl, apiKey, modelName } = getProviderConfig('llm');
  const chatUrl = getChatUrl(provider, baseUrl);

  console.log('[LLM] 准备调用大模型 (流式)', { provider, model: modelName, promptLength: String(prompt || '').length });

  const payload = provider === 'ollama'
    ? { model: modelName, messages: [{ role: 'user', content: prompt }], stream: true, options: { temperature: config.llmTemperature, num_predict: config.llmMaxTokens } }
    : { model: modelName, messages: [{ role: 'user', content: prompt }], temperature: config.llmTemperature, max_tokens: config.llmMaxTokens, stream: true };

  const fullAnswer = await requestStream(chatUrl, { apiKey, provider, payload, onChunk });

  console.log('[LLM] 大模型流式调用完成', { provider, model: modelName, answerLength: String(fullAnswer || '').length });
  return fullAnswer;
}

export async function embedQuery(text) {
  const { provider, baseUrl, apiKey, modelName } = getProviderConfig('embedding');
  const embeddingUrl = getEmbeddingUrl(provider, baseUrl);

  console.log('[LLM] 准备调用向量模型', { provider, model: modelName, textLength: String(text || '').length });

  const payload = provider === 'ollama'
    ? { model: modelName, prompt: text }
    : { model: modelName, input: text, encoding_format: 'float' };
  const result = await requestJson(embeddingUrl, { apiKey, provider, payload, timeoutMs: 60000 });
  const embedding = extractEmbedding(provider, result);

  console.log('[LLM] 向量模型调用完成', { provider, model: modelName, embeddingLength: Array.isArray(embedding) ? embedding.length : 0 });
  return embedding;
}
