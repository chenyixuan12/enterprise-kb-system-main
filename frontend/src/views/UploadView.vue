<template>
  <div class="page upload-page">
    <header class="topbar hero-bar">
      <div>
        <div class="sub-title">文档上传</div>
        <h2>上传知识文档并自动入库</h2>
        <p>支持 TXT / PDF / Word / MD，上传后会自动解析并向量化。</p>
      </div>
      <div class="actions">
        <button @click="goQa">问答页</button>
        <button @click="goAdmin">管理首页</button>
        <button class="ghost" @click="logout">退出登录</button>
      </div>
    </header>

    <div class="card upload-panel">
      <div class="upload-grid">
        <div>
          <label class="field-label">文档标题</label>
          <input v-model="title" type="text" placeholder="不填则默认使用文件名" />
        </div>
        <div>
          <label class="field-label">知识库 ID</label>
          <input v-model="knowledgeBaseId" type="text" placeholder="可选，不填则为 null" />
        </div>
      </div>

      <div>
        <label class="field-label">选择文件</label>
        <input ref="fileInput" type="file" accept=".txt,.pdf,.docx,.md" @change="onPick" />
      </div>

      <div class="upload-actions">
        <button :disabled="!file || loading" @click="upload">
          {{ loading ? '上传中...' : '上传并入库' }}
        </button>
      </div>

      <p class="hint-box">
        <span>支持格式：TXT / PDF / Word / MD</span>
        <span>上传后会自动保存到 MongoDB</span>
      </p>

      <p v-if="error" class="error-text">{{ error }}</p>
      <pre>{{ message }}</pre>

      <div v-if="preview" class="preview-card">
        <div class="preview-title">解析正文预览</div>
        <div class="preview-content">{{ preview }}</div>
      </div>

      <div v-if="documentId" class="preview-card">
        <div class="preview-title">文档信息</div>
        <div class="preview-content">文档ID：{{ documentId }}\n状态：{{ status }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '../api/http.js';

const router = useRouter();
const file = ref(null);
const fileInput = ref(null);
const loading = ref(false);
const message = ref('请选择一个文件开始上传。');
const error = ref('');
const preview = ref('');
const documentId = ref('');
const status = ref('');
const title = ref('');
const knowledgeBaseId = ref('');
const pollTimer = ref(null);

function onPick(e) {
  file.value = e.target.files?.[0] || null;
}
function goQa() { router.push('/qa'); }
function goAdmin() { router.push('/admin'); }
function logout() { localStorage.removeItem('enterpriseUser'); router.push('/'); }

function resetFileInput() {
  if (fileInput.value) fileInput.value.value = '';
  file.value = null;
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

async function pollStatus(id) {
  stopPolling();
  pollTimer.value = window.setInterval(async () => {
    try {
      const result = await apiFetch(`/knowledge/${id}/status`);
      const data = result.data || {};
      status.value = data.status || 'unknown';
      preview.value = data.preview || preview.value;
      message.value = [
        `状态码：${result.code ?? 200}`,
        `消息：${result.message || '查询成功'}`,
        `文档ID：${data.documentId || id}`,
        `文档标题：${data.title || '-'}`,
        `文件名：${data.originalName || '-'}`,
        `文件类型：${data.fileType || '-'}`,
        `文件大小：${data.fileSize || '-'}`,
        `分块数量：${data.chunkCount ?? 0}`,
        `状态：${data.status || 'unknown'}`
      ].join('\n');

      if (data.status === 'processed' || data.status === 'failed') {
        stopPolling();
        window.dispatchEvent(new CustomEvent('document-uploaded'));
      }
    } catch (err) {
      stopPolling();
      console.error('轮询状态失败', err);
    }
  }, 2000);
}

async function upload() {
  try {
    loading.value = true;
    error.value = '';
    preview.value = '';
    documentId.value = '';
    status.value = '';
    stopPolling();

    const form = new FormData();
    form.append('file', file.value);
    if (title.value.trim()) form.append('title', title.value.trim());
    if (knowledgeBaseId.value.trim()) form.append('knowledgeBaseId', knowledgeBaseId.value.trim());

    const result = await apiFetch('/knowledge/upload', {
      method: 'POST',
      body: form
    });

    const data = result.data || {};
    documentId.value = result.documentId || data._id || '';
    status.value = data.status || 'processed';
    preview.value = data.preview || '';
    message.value = [
      `状态码：${result.code ?? 201}`,
      `消息：${result.message || '文件上传成功，文档已入库'}`,
      `文档ID：${documentId.value}`,
      `文件名：${data.originalName || file.value?.name || '-'}`,
      `文档标题：${data.title || '-'}`,
      `文件类型：${data.fileType || '-'}`,
      `文件大小：${data.fileSize || '-'}`,
      `本地路径：${data.localPath || '-'}`,
      `知识库ID：${data.knowledgeBaseId || 'null'}`,
      `分块数量：${data.chunkCount ?? 0}`,
      `vectorIds：${Array.isArray(data.vectorIds) ? data.vectorIds.join(', ') : '-'}`,
      `上传人ID：${data.uploadedBy || '-'}`,
      `状态：${data.status || 'processed'}`
    ].join('\n');

    resetFileInput();

    if (documentId.value) {
      await pollStatus(documentId.value);
    }
  } catch (err) {
    error.value = err.message || '上传失败';
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(() => {
  stopPolling();
});
</script>
