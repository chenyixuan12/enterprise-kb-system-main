<template>
  <div class="chat-history-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">对话历史</h1>
        <p class="page-subtitle">查看知识问答的历史会话与详情</p>
      </div>
      <el-button 
        type="primary" 
        :icon="Refresh" 
        :loading="loading"
        :disabled="loading"
        @click="debouncedLoadSessions"
      >
        刷新
      </el-button>
    </div>

    <div class="history-layout">
      <div class="session-list-panel">
        <div class="panel-title">历史会话</div>
        <div class="session-list">
          <div
            v-for="item in sessions"
            :key="item._id"
            class="session-item"
            :class="{ active: selectedSession?._id === item._id }"
            @click="selectSession(item)"
          >
            <div class="session-title">{{ item.title || '新的对话' }}</div>
            <div class="session-meta">
              <span>{{ formatDate(item.updatedAt) }}</span>
              <span>{{ item.messageCount || item.history?.length || 0 }} 条消息</span>
            </div>
            <div class="session-last">{{ item.lastQuestion || item.lastAnswer || '暂无内容' }}</div>
          </div>
          <el-empty v-if="!sessions.length" description="暂无对话历史" />
        </div>
      </div>

      <div class="session-detail-panel">
        <template v-if="selectedSession">
          <div class="detail-header">
            <div>
              <h2>{{ selectedSession.title || '会话详情' }}</h2>
              <p>{{ formatDate(selectedSession.updatedAt) }}</p>
            </div>
            <div class="detail-actions">
              <el-button type="primary" plain :icon="ChatDotRound" @click="continueSession(selectedSession)">
                继续对话
              </el-button>
              <el-button type="danger" plain :icon="Delete" @click="deleteSession(selectedSession)">删除会话</el-button>
            </div>
          </div>

          <div class="message-list">
            <div v-for="(msg, index) in selectedSession.history || []" :key="index" class="message-row" :class="msg.role">
              <div class="role-tag">{{ msg.role === 'user' ? '用户' : 'AI' }}</div>
              <div class="message-bubble">
                <div class="message-text">{{ msg.content }}</div>
                <div v-if="msg.role === 'assistant' && msg.sources?.length" class="source-list">
                  <span v-for="(source, sIndex) in msg.sources" :key="source.documentId || sIndex" class="source-chip">
                    {{ source.title || source.originalName || '来源' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <el-empty v-else description="请选择左侧会话查看详情" class="empty-state" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChatDotRound, Delete, Refresh } from '@element-plus/icons-vue';
import { apiFetch } from '../api/http.js';
import { ElMessage, ElMessageBox } from 'element-plus';

const router = useRouter();
const sessions = ref([]);
const selectedSession = ref(null);
const loading = ref(false);
let debounceTimer = null;

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function debounce(func, delay = 300) {
  return function (...args) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => func.apply(this, args), delay);
  };
}

async function loadSessions(showSuccess = false) {
  if (loading.value) return;
  
  loading.value = true;
  
  try {
    const res = await apiFetch('/chat');
    const newSessions = Array.isArray(res.data) ? res.data : [];
    
    sessions.value = newSessions;
    selectedSession.value = null;
    
    if (showSuccess) {
      ElMessage.success('刷新成功');
    }
  } catch (error) {
    ElMessage.error(error.message || '加载对话历史失败');
  } finally {
    loading.value = false;
  }
}

const debouncedLoadSessions = debounce(() => loadSessions(true));

function selectSession(item) {
  selectedSession.value = item;
}

function continueSession(item) {
  if (!item) return;
  const categoryId = item.categoryId?._id || item.categoryId || '';
  if (categoryId) {
    localStorage.setItem(`qa-session-${categoryId}`, item._id);
  } else {
    localStorage.setItem('qa-session-global', item._id);
  }

  router.push({
    path: '/backend/qa',
    query: {
      sessionId: item._id,
      categoryId
    }
  });
}

async function deleteSession(item) {
  try {
    await ElMessageBox.confirm('确定删除该对话会话吗？', '提示', { type: 'warning' });
    await apiFetch(`/chat/${item._id}`, { method: 'DELETE' });
    ElMessage.success('删除成功');
    await loadSessions();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

onMounted(() => {
  loadSessions(false);
});
</script>

<style scoped>
.chat-history-page {
  padding: 24px;
  height: 100%;
  background: #f5f7fa;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 14px;
}

.history-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 20px;
  min-height: calc(100vh - 160px);
}

.session-list-panel,
.session-detail-panel {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.panel-title {
  padding: 16px 20px;
  border-bottom: 1px solid #eef0f3;
  font-weight: 600;
  color: #111827;
}

.session-list {
  padding: 12px;
  max-height: calc(100vh - 220px);
  overflow: auto;
}

.session-item {
  padding: 14px;
  border-radius: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: 0.2s;
  margin-bottom: 10px;
  background: #fafafa;
}

.session-item:hover,
.session-item.active {
  border-color: #c7d2fe;
  background: #eef2ff;
}

.session-title {
  font-weight: 600;
  color: #111827;
  margin-bottom: 6px;
}

.session-meta {
  display: flex;
  justify-content: space-between;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 8px;
}

.session-last {
  color: #4b5563;
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.session-detail-panel {
  display: flex;
  flex-direction: column;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px;
  border-bottom: 1px solid #eef0f3;
}

.detail-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-header h2 {
  margin: 0;
  font-size: 18px;
  color: #111827;
}

.detail-header p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
}

.message-list {
  padding: 20px;
  overflow: auto;
  flex: 1;
}

.message-row {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
  align-items: flex-start;
}

.message-row.user {
  flex-direction: row-reverse;
}

.role-tag {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #7c3aed);
}

.message-row.user .role-tag {
  background: linear-gradient(135deg, #10b981, #059669);
}

.message-bubble {
  max-width: 78%;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 14px 16px;
}

.message-row.user .message-bubble {
  background: #eff6ff;
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: #1f2937;
  line-height: 1.7;
}

.source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.source-chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef2ff;
  color: #4338ca;
  font-size: 12px;
}

.empty-state {
  margin-top: 120px;
}

@media (max-width: 960px) {
  .history-layout {
    grid-template-columns: 1fr;
  }
}
</style>
