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
    if (error.name === 'AbortError') throw new Error('大模型调用超时，请检查模型服务是否正常', { cause: error });
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
    if (error.name === 'AbortError') throw new Error('大模型流式调用超时，请检查模型服务是否正常', { cause: error });
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

// bge 系列中文检索模型建议查询侧拼接检索指令，文档侧保持原文。
const BGE_QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关文章：';

function getQueryInstruction() {
  const model = String(config.embeddingModelName || '').toLowerCase();
  if (model.includes('bge')) return BGE_QUERY_INSTRUCTION;
  return '';
}

async function embed(text, { asQuery = false } = {}) {
  const { provider, baseUrl, apiKey, modelName } = getProviderConfig('embedding');
  const embeddingUrl = getEmbeddingUrl(provider, baseUrl);
  const input = asQuery ? `${getQueryInstruction()}${String(text || '')}` : String(text || '');

  console.log('[LLM] 准备调用向量模型', { provider, model: modelName, textLength: String(input || '').length });

  const payload = provider === 'ollama'
    ? { model: modelName, prompt: input }
    : { model: modelName, input, encoding_format: 'float' };
  const result = await requestJson(embeddingUrl, { apiKey, provider, payload, timeoutMs: 60000 });
  const embedding = extractEmbedding(provider, result);

  console.log('[LLM] 向量模型调用完成', { provider, model: modelName, embeddingLength: Array.isArray(embedding) ? embedding.length : 0 });
  return embedding;
}

// 文档侧向量：直接使用原文，不加前缀。
export async function embedDocument(text) {
  return embed(text, { asQuery: false });
}

// 查询侧向量：bge 系列模型拼接检索指令，其他模型保持原样。
export async function embedQuery(text) {
  return embed(text, { asQuery: true });
}

/**
 * 单次批量向量化请求。Ollama 使用 /api/embed（input 支持数组），
 * OpenAI 兼容接口使用同样的 input 数组。结果与传入文本一一对应；
 * 若响应数量对不上，返回 null 由上层回退成逐条调用。
 */
async function embedBatch(texts, { provider, baseUrl, apiKey, modelName, asQuery = false }) {
  const inputs = texts.map((text) => (asQuery ? `${getQueryInstruction()}${String(text)}` : String(text)));
  const payloadInput = inputs.length === 1 ? inputs[0] : inputs;

  let embeddings;
  if (provider === 'ollama') {
    const url = `${normalizeBaseUrl(baseUrl)}/api/embed`;
    const result = await requestJson(url, {
      apiKey,
      payload: { model: modelName, input: payloadInput },
      timeoutMs: 120000
    });
    embeddings = result?.embeddings;
  } else {
    const url = getEmbeddingUrl(provider, baseUrl);
    const result = await requestJson(url, {
      apiKey,
      payload: { model: modelName, input: payloadInput, encoding_format: 'float' },
      timeoutMs: 120000
    });
    const data = Array.isArray(result?.data) ? result.data : [];
    embeddings = data
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item?.embedding);
  }

  if (
    !Array.isArray(embeddings) ||
    embeddings.length !== texts.length ||
    embeddings.some((item) => !Array.isArray(item) || item.length === 0)
  ) {
    return null;
  }
  return embeddings;
}

/**
 * 批量向量化：按 provider 选择合适的批大小分批发请求，
 * 每批结果对齐到入参文本顺序，某批失败时只对该批逐条重试。
 * 用于文档索引阶段，避免大文件每个分片一次串行请求。
 */
export async function embedTexts(texts, { asQuery = false } = {}) {
  const list = Array.isArray(texts) ? texts.filter((text) => String(text || '').trim()) : [];
  if (list.length === 0) return [];

  const { provider, baseUrl, apiKey, modelName } = getProviderConfig('embedding');
  const batchSize = provider === 'ollama' ? 64 : 10;
  const output = new Array(list.length);

  const batches = [];
  for (let offset = 0; offset < list.length; offset += batchSize) {
    batches.push({ offset, texts: list.slice(offset, offset + batchSize) });
  }

  const runBatch = async (batch) => {
    console.log('[LLM] 批量向量化', {
      provider,
      model: modelName,
      batchSize: batch.texts.length,
      totalTexts: list.length,
      progress: `${batches.indexOf(batch) + 1}/${batches.length}`
    });
    const batchResult = await embedBatch(batch.texts, { provider, baseUrl, apiKey, modelName, asQuery });
    if (batchResult) {
      for (let i = 0; i < batch.texts.length; i += 1) {
        output[batch.offset + i] = batchResult[i];
      }
      return;
    }
    for (let i = 0; i < batch.texts.length; i += 1) {
      output[batch.offset + i] = await embed(batch.texts[i], { asQuery });
    }
  };

  // 云服务允许少量并发；本地 Ollama 对同一模型排队，2 路并发也足够安全。
  const concurrency = 2;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (cursor < batches.length) {
      const current = batches[cursor];
      cursor += 1;
      await runBatch(current);
    }
  });
  await Promise.all(workers);

  return output;
}
