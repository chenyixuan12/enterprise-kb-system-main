import axios from 'axios';
import { clearAuth, getAuthHeaders, getRefreshToken, setAuth } from '../utils/auth.js';

const API_BASE = '/api';
const REQUEST_TIMEOUT = 120000;

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

function handleUnauthorized() {
  clearAuth();
  if (window.location.pathname !== '/') {
    window.location.href = '/';
  }
}

function applyAuthUpdate(data) {
  if (!data) return;
  const user = {
    _id: data._id,
    username: data.username,
    nickname: data.nickname,
    role: data.role,
    tokenVersion: data.tokenVersion
  };
  setAuth(user, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken
  });
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
    const data = response.data?.data;
    if (!data?.accessToken) return false;

    const existingUser = JSON.parse(localStorage.getItem('enterpriseUser') || 'null') || {};
    setAuth(
      existingUser,
      {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken
      }
    );
    return true;
  } catch {
    handleUnauthorized();
    return false;
  }
}

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
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        originalRequest.headers = {
          ...(originalRequest.headers || {}),
          ...getAuthHeaders()
        };
        return http.request(originalRequest);
      }
      handleUnauthorized();
    }

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

      const contentType = response.headers.get?.('content-type') || response.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data?.data?.accessToken) {
          applyAuthUpdate(data.data);
        }
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
            const chunkText = typeof parsedData === 'string'
              ? parsedData
              : (parsedData && typeof parsedData.chunk === 'string' ? parsedData.chunk : String(parsedData || ''));
            callbacks.onChunk(chunkText);
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
        return;
      }
      if (callbacks.onError) {
        callbacks.onError(error);
      } else {
        throw error;
      }
    }
  })();

  return { promise, abort };
}
