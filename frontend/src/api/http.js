import axios from 'axios';

const API_BASE = '/api';
const REQUEST_TIMEOUT = 120000;

function getAuthHeaders() {
  const user = JSON.parse(localStorage.getItem('enterpriseUser') || 'null');
  if (!user) return {};
  return {
    'x-user-id': user._id || '',
    'x-user-name': user.username || '',
    'x-user-role': user.role || 'user'
  };
}

function normalizeHeaders(headers = {}) {
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function buildErrorMessage(error, fallback = '请求失败') {
  const data = error?.response?.data;
  return data?.message || data?.error || error?.message || fallback;
}

export const http = axios.create({
  baseURL: API_BASE,
  timeout: REQUEST_TIMEOUT
});

http.interceptors.request.use(
  (config) => {
    const headers = {
      ...(config.headers || {}),
      ...getAuthHeaders()
    };

    const normalizedHeaders = normalizeHeaders(headers);
    const hasFormData = config.data instanceof FormData;

    if (hasFormData) {
      delete headers['Content-Type'];
      delete headers['content-type'];
      delete normalizedHeaders['content-type'];
    } else if (!normalizedHeaders['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    return {
      ...config,
      headers
    };
  },
  (error) => Promise.reject(error)
);

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return Promise.reject(new Error('请求超时，请稍后重试'));
    }
    return Promise.reject(new Error(buildErrorMessage(error, `请求失败(${error?.response?.status || '未知'})`)));
  }
);

export async function apiFetch(url, options = {}) {
  const { method = 'GET', headers = {}, body, ...rest } = options;
  const response = await http.request({
    url,
    method,
    headers,
    data: body,
    ...rest
  });
  return response.data;
}

export function apiFetchStream(url, options = {}, callbacks = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  // 创建取消函数
  const abort = () => {
    controller.abort();
    clearTimeout(timeoutId);
  };

  const promise = (async () => {
    try {
    const headers = {
      ...(options.headers || {}),
      ...getAuthHeaders()
    };

    if (!(options.body instanceof FormData)) {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    } else {
      delete headers['Content-Type'];
      delete headers['content-type'];
    }

    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      signal: controller.signal,
      headers
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errData = {};
      try {
        errData = await response.json();
      } catch {
        const text = await response.text();
        errData = text ? { message: text } : {};
      }
      throw new Error(errData?.message || errData?.error || `请求失败(${response.status})`);
    }

    // 优先用get方法，兜底用对象取值
   const contentType = response.headers.get?.('content-type') || response.headers['content-type'] || ''

    // 兼容后端返回 JSON 的情况：直接当作一次性结果处理
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (callbacks.onSources) {
        callbacks.onSources(data?.data?.sources || []);
      }
      if (callbacks.onDone) {
        callbacks.onDone({
          answer: data?.data?.answer || '',
          sessionId: data?.data?.sessionId || '',
          sources: data?.data?.sources || []
        });
      }
      return data;
    }

    if (!response.body) {
      throw new Error('当前浏览器不支持流式响应');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processBuffer = () => {
      while (buffer.includes('\n\n')) {
        const index = buffer.indexOf('\n\n');
        const rawEvent = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 2);

        if (!rawEvent) continue;

        let eventType = 'message';
        let dataStr = '';
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataStr += line.slice(5).trim();
          }
        }

        let parsedData;
        try {
          parsedData = JSON.parse(dataStr);
        } catch {
          parsedData = dataStr;
        }

        if (eventType === 'sources' && callbacks.onSources) {
          callbacks.onSources(parsedData);
        } else if (eventType === 'mismatch' && callbacks.onMismatch) {
          callbacks.onMismatch(parsedData);
        } else if (eventType === 'chunk' && callbacks.onChunk) {
          callbacks.onChunk(typeof parsedData === 'string' ? parsedData : String(parsedData || ''));
        } else if (eventType === 'done' && callbacks.onDone) {
          callbacks.onDone(parsedData);
        } else if (eventType === 'error' && callbacks.onError) {
          callbacks.onError(parsedData instanceof Object ? new Error(parsedData.message || '请求出错') : new Error(String(parsedData || '请求出错')));
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      processBuffer();
    }

    buffer += decoder.decode();
      processBuffer();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return; // 用户主动取消，不抛出错误
      }
      if (callbacks.onError) {
        callbacks.onError(error);
      } else {
        throw error;
      }
    }
  })();

  // 返回包含 promise 和 abort 函数的对象
  return { promise, abort };
}
