import { config } from '../config/env.js';

const DEFAULT_RERANK_TIMEOUT = 30000;

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').replace(/\/$/, '');
}

function isDashScopeProvider() {
  return ['aliyun', 'alibaba', 'dashscope'].includes(String(config.rerankProvider || '').toLowerCase());
}

function getRerankUrl() {
  const base = normalizeBaseUrl(config.rerankBaseUrl);
  if (isDashScopeProvider()) {
    // 百炼文本排序（Text-Rerank）专用接口
    return `${base}/api/v1/services/rerank/text-rerank/text-rerank`;
  }
  // 通用 OpenAI 兼容 rerank 端点（Jina / Xinference / 自建服务等）
  return `${base}/v1/rerank`;
}

function getApiKey() {
  // 未单独配置重排 Key 时复用 LLM 的 Key（百炼场景下通常同一账号）。
  return config.rerankApiKey || config.llmApiKey || '';
}

export function isRerankConfigured() {
  return Boolean(config.rerankEnabled && config.rerankModelName && getApiKey());
}

async function requestRerank(query, documents, topN) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.rerankTimeout || DEFAULT_RERANK_TIMEOUT);
  try {
    const payload = isDashScopeProvider()
      ? {
          model: config.rerankModelName,
          input: { query, documents },
          parameters: { top_n: topN, return_documents: false }
        }
      : {
          model: config.rerankModelName,
          query,
          documents,
          top_n: topN
        };

    const response = await fetch(getRerankUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`重排服务调用失败：${response.status} ${text}`);
    }
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('重排服务调用超时，请检查重排服务是否正常', { cause: error });
    throw error;
  }
}

function extractResults(data) {
  if (!data) return [];
  // 百炼：output.results[]；通用：results[]
  return isDashScopeProvider() ? (data?.output?.results || []) : (data?.results || []);
}

/**
 * 对 (query, candidates) 做逐对语义重排，返回按相关性降序的前 topK 条。
 * - 未配置重排服务时：原样返回前 topK 条（等价于 RRF 排序）。
 * - 调用失败时：同样降级返回前 topK 条，避免影响主链路。
 * 返回结果中的 score 会被覆盖为重排分数，供来源展示与证据判定使用。
 */
export async function rerankChunks(query, candidates, { topK = 5 } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return [];
  if (!isRerankConfigured() || list.length <= 1) return list.slice(0, topK);

  const documents = list.map((chunk) => String(chunk.content || '').slice(0, 1500));
  const data = await requestRerank(query, documents, topK);
  const results = extractResults(data);

  const reranked = results
    .map((item) => {
      const index = Number(item.index);
      const base = list[index];
      if (!base || !Number.isFinite(index) || index < 0 || index >= list.length) return null;
      const rerankScore = Number(item.relevance_score || 0);
      return { ...base, rerankScore, score: rerankScore };
    })
    .filter(Boolean)
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);

  return reranked.length > 0 ? reranked : list.slice(0, topK);
}
