<template>
  <div class="qa-page">
    <div class="qa-shell">
      <aside class="qa-sidebar">
        <div class="sidebar-head">
          <div class="sidebar-title-wrap">
            <el-icon class="sidebar-title-icon"><Menu /></el-icon>
            <div>
              <div class="sidebar-title">选择知识库</div>
              <div class="sidebar-subtitle">先选知识域，再开始问答</div>
            </div>
          </div>
        </div>

        <div class="kb-list" v-if="knowledgeDBs.length">
          <button
            v-for="item in knowledgeDBs"
            :key="item._id"
            class="kb-item"
            :class="{ selected: selectedKnowledgeDB && selectedKnowledgeDB._id === item._id }"
            @click="selectKnowledgeDB(item)"
            type="button"
          >
            <div class="kb-item-left">
              <div class="kb-icon">
                <el-icon><FolderOpened /></el-icon>
              </div>
              <div class="kb-text">
                <div class="kb-name">{{ item.name }}</div>
                <div class="kb-desc">{{ item.docCount || 0 }} 篇文档</div>
              </div>
            </div>
            <el-tag size="small" effect="plain" type="primary" class="kb-tag">{{ item.docCount || 0 }}</el-tag>
          </button>
        </div>

        <div v-else class="sidebar-empty">
          <el-empty description="暂无知识库" :image-size="78" />
        </div>
      </aside>

      <main class="qa-main">
        <header class="qa-header">
          <div class="qa-header-left">
            <span v-if="selectedKnowledgeDB" class="query-pill">
              <el-icon :size="16" color="#67c23a"><Search /></el-icon>
              正在查询：<strong>{{ selectedKnowledgeDB.name }}</strong>
            </span>
            <span v-else class="query-hint">请先从左侧选择一个知识库</span>
          </div>

          <div class="qa-header-actions">
            <el-button
              v-if="selectedKnowledgeDB"
              type="primary"
              size="small"
              plain
              round
              class="new-session-btn"
              @click="createNewSession"
            >
              <el-icon><Plus /></el-icon>
              新建会话
            </el-button>
          </div>
        </header>

        <transition name="banner-fade">
          <section v-if="mismatchHint || topRecommendedKb" class="mismatch-banner">
            <div class="mismatch-main">
              <div class="mismatch-icon">
                <el-icon><Warning /></el-icon>
              </div>
              <div class="mismatch-copy">
                <div class="mismatch-title">
                  {{ mismatchHint?.message || '系统检测到当前知识库相关性较低，已推荐更可能的知识库。' }}
                </div>
                <div
                  v-if="mismatchHint?.currentCategoryName || mismatchHint?.topMatchedDocument"
                  class="mismatch-meta"
                >
                  <span v-if="mismatchHint?.currentCategoryName">当前知识库：{{ mismatchHint.currentCategoryName }}</span>
                  <span v-if="mismatchHint?.currentCategoryScore !== undefined">匹配分：{{ Number(mismatchHint.currentCategoryScore || 0).toFixed(2) }}</span>
                  <span v-if="mismatchHint?.topMatchedDocument">最相关文档：{{ mismatchHint.topMatchedDocument }}</span>
                </div>
              </div>
            </div>

            <!-- <div v-if="topRecommendedKb" class="recommend-area">
              <div class="recommend-card">
                <div class="recommend-label">推荐知识库</div>
                <div class="recommend-name">{{ topRecommendedKb.name }}</div>
                <div v-if="topRecommendedKb.topTitle" class="recommend-doc">
                  最相关文档：{{ topRecommendedKb.topTitle }}
                </div>
              </div>
              <el-button
                size="small"
                type="warning"
                plain
                round
                class="switch-btn"
                @click="switchToRecommendedKnowledge(topRecommendedKb)"
              >
                切换
              </el-button>
            </div> -->
          </section>
        </transition>

        <section ref="messageRef" class="chat-area">
          <div v-if="!messages.length && !selectedKnowledgeDB" class="welcome-wrap">
            <div class="welcome-card">
              <div class="welcome-icon">
                <el-icon :size="72" color="#7c8ba1"><ChatDotSquare /></el-icon>
              </div>
              <h3>欢迎使用智能问答系统</h3>
              <p>请选择左侧知识库，输入问题后即可开始检索与回答。</p>
            </div>
          </div>

          <div v-if="messages.length" class="message-list">
            <ChatMessage v-for="(msg, i) in messages" :key="i" :message="msg" />
          </div>

          <div v-if="asking" class="typing-row">
            <el-avatar :size="36" :icon="Monitor" class="typing-avatar" />
            <div class="typing-bubble">
              <span v-if="!currentAnswer" class="typing-text">正在思考</span>
              <span v-else class="typing-answer">{{ currentAnswer }}</span>
              <span v-if="!currentAnswer" class="typing-dots">...</span>
            </div>
          </div>
        </section>

        <footer class="chat-input-panel">
          <div class="input-card">
            <el-input
              v-model="question"
              type="textarea"
              :rows="3"
              placeholder="请输入您的问题..."
              :disabled="!selectedKnowledgeDB || asking"
              @keydown.enter.exact.prevent="sendQuestion"
              resize="none"
              class="question-input"
            />

            <div class="input-footer">
              <div class="input-tip" v-if="selectedKnowledgeDB">
                当前知识库：<strong>{{ selectedKnowledgeDB.name }}</strong>
              </div>
              <div class="input-actions">
                <el-button
                  v-if="asking"
                  type="danger"
                  class="abort-btn"
                  round
                  @click="abortQuestion"
                >
                  终止对话
                </el-button>
                <el-button
                  type="primary"
                  :icon="ArrowRight"
                  :loading="asking"
                  :disabled="!selectedKnowledgeDB || !question.trim()"
                  @click="sendQuestion"
                  class="send-btn"
                  round
                >
                  发送
                </el-button>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Menu, FolderOpened, Search, ChatDotSquare, Monitor, ArrowRight, Plus, Warning } from '@element-plus/icons-vue';
import ChatMessage from '../components/ChatMessage.vue';
import { apiFetch, apiFetchStream } from '../api/http.js';

const question = ref('');
const messages = ref([]);
const asking = ref(false);
const messageRef = ref(null);
const selectedKnowledgeDB = ref(null);
const knowledgeDBs = ref([]);
const sessionId = ref('');
const currentAnswer = ref('');
const currentSources = ref([]);
const abortController = ref(null);
const mismatchHint = ref(null);
const recommendedKbs = ref([]);
const topRecommendedKb = ref(null);
const route = useRoute();
const lastQuestion = ref('');

function createNewSession() {
  messages.value = [];
  sessionId.value = '';
  currentAnswer.value = '';
  currentSources.value = [];
  mismatchHint.value = null;
  recommendedKbs.value = [];
  topRecommendedKb.value = null;
  question.value = '';
}

function getSessionStorageKey(categoryId) {
  return categoryId ? `qa-session-${categoryId}` : 'qa-session-global';
}

function persistSessionId(value) {
  if (!selectedKnowledgeDB.value) return;
  const key = getSessionStorageKey(selectedKnowledgeDB.value._id);
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function restoreSessionId(categoryId) {
  if (!categoryId) return '';
  return localStorage.getItem(getSessionStorageKey(categoryId)) || '';
}

function clearCurrentChatState() {
  messages.value = [];
  sessionId.value = '';
  currentAnswer.value = '';
  currentSources.value = [];
  mismatchHint.value = null;
  recommendedKbs.value = [];
  topRecommendedKb.value = null;
}

function abortQuestion() {
  if (abortController.value) {
    abortController.value();
    abortController.value = null;
  }
  asking.value = false;
  if (currentAnswer.value) {
    messages.value.push({
      role: 'ai',
      content: currentAnswer.value,
      sources: currentSources.value,
      interrupted: true
    });
  }
  currentAnswer.value = '';
  currentSources.value = [];
  scrollToBottom();
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messageRef.value) messageRef.value.scrollTop = messageRef.value.scrollHeight;
  });
};

async function loadKnowledgeDBs() {
  try {
    const result = await apiFetch('/category');
    if (result && result.data) {
      knowledgeDBs.value = result.data.list || result.data || [];
    }
  } catch (error) {
    console.error('加载知识库列表失败:', error);
  }
}

async function loadSessionHistory(sessionIdParam) {
  if (!sessionIdParam) return;
  try {
    const result = await apiFetch(`/chat/${sessionIdParam}`);
    if (result && result.data) {
      const session = result.data;
      if (session.history && Array.isArray(session.history)) {
        messages.value = session.history;
      }
      sessionId.value = sessionIdParam;
      scrollToBottom();
    }
  } catch (error) {
    console.error('加载会话历史失败:', error);
  }
}

function selectKnowledgeDB(item) {
  selectedKnowledgeDB.value = item;
  clearCurrentChatState();
  sessionId.value = restoreSessionId(item._id);
  question.value = lastQuestion.value || '';
}

function switchToRecommendedKnowledge(kb) {
  const matched = knowledgeDBs.value.find((item) => String(item._id) === String(kb.id) || item.name === kb.name);
  if (matched) {
    selectKnowledgeDB(matched);
    if (lastQuestion.value) {
      question.value = lastQuestion.value;
    }
  }
}

async function sendQuestion() {
  const q = question.value.trim();
  if (!q || asking.value || !selectedKnowledgeDB.value) return;

  lastQuestion.value = q;
  messages.value.push({ role: 'user', content: q });

  question.value = '';
  asking.value = true;
  currentAnswer.value = '';
  currentSources.value = [];
  mismatchHint.value = null;
  recommendedKbs.value = [];
  topRecommendedKb.value = null;
  abortController.value = null;
  scrollToBottom();

  try {
    const { promise, abort } = apiFetchStream('/qa/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q,
        categoryId: selectedKnowledgeDB.value._id,
        sessionId: sessionId.value
      })
    }, {
      onSources(sources) {
        currentSources.value = sources;
      },
      onMismatch(data) {
        mismatchHint.value = data || null;

        const matchedKnowledgeId = data?.answeredByKnowledgeId || data?.suggestedKnowledgeId;
        if (data?.autoSwitched && matchedKnowledgeId) {
          const matchedKnowledge = knowledgeDBs.value.find(
            (item) => String(item._id) === String(matchedKnowledgeId)
          );
          if (matchedKnowledge) {
            selectedKnowledgeDB.value = matchedKnowledge;
          }
          recommendedKbs.value = [];
          topRecommendedKb.value = null;
          return;
        }

        const recs = Array.isArray(data?.recommendedKnowledge) ? data.recommendedKnowledge : [];
        recommendedKbs.value = recs;
        topRecommendedKb.value = recs[0] || null;

        if (data?.shouldForceSwitch && topRecommendedKb.value) {
          switchToRecommendedKnowledge(topRecommendedKb.value);
        }
      },
      onChunk(chunk) {
        currentAnswer.value += chunk;
        scrollToBottom();
      },
      onDone(data) {
        const answerText = data.answer || currentAnswer.value;
        messages.value.push({
          role: 'ai',
          content: answerText,
          sources: data.sources || currentSources.value
        });
        if (data.sessionId) {
          sessionId.value = data.sessionId;
          persistSessionId(data.sessionId);
        }
        if (Array.isArray(data.recommendedKnowledge) && data.recommendedKnowledge.length) {
          recommendedKbs.value = data.recommendedKnowledge;
          topRecommendedKb.value = data.recommendedKnowledge[0] || null;
          if (!mismatchHint.value) {
            mismatchHint.value = {
              message: data.suggestedKnowledge ? `系统推荐更匹配的知识库：${data.suggestedKnowledge}` : '系统推荐了更匹配的知识库。',
              suggestedKnowledge: data.suggestedKnowledge || '',
              suggestedKnowledgeId: data.suggestedKnowledgeId || ''
            };
          }
        }
        if (answerText?.includes('根据当前知识库内容暂时无法确定')) {
          question.value = lastQuestion.value;
        }
        asking.value = false;
        abortController.value = null;
        currentAnswer.value = '';
        currentSources.value = [];
        scrollToBottom();
      },
      onError(err) {
        const msg = err.message || '抱歉，服务器出现异常，请稍后重试';
        const fallback = msg === 'fetch failed' ? '根据当前知识库内容暂时无法确定。' : msg;
        messages.value.push({
          role: 'ai',
          content: fallback
        });
        if (fallback === '根据当前知识库内容暂时无法确定。') {
          question.value = lastQuestion.value;
        }
        asking.value = false;
        abortController.value = null;
        currentAnswer.value = '';
        currentSources.value = [];
        scrollToBottom();
      }
    });

    abortController.value = abort;
    await promise;
  } catch (err) {
    messages.value.push({
      role: 'ai',
      content: err.message || '抱歉，服务器出现异常，请稍后重试'
    });
    asking.value = false;
    abortController.value = null;
    currentAnswer.value = '';
    currentSources.value = [];
    scrollToBottom();
  }
}

watch(selectedKnowledgeDB, (val) => {
  if (val?._id) sessionId.value = restoreSessionId(val._id);
});

onMounted(async () => {
  await loadKnowledgeDBs();

  const urlSessionId = route.query.sessionId;
  const urlCategoryId = route.query.categoryId;

  if (urlSessionId && urlCategoryId) {
    const kb = knowledgeDBs.value.find((item) => String(item._id) === String(urlCategoryId));
    if (kb) {
      selectedKnowledgeDB.value = kb;
      await loadSessionHistory(urlSessionId);
      persistSessionId(urlSessionId);
      return;
    }
  }
});
</script>

<style lang="scss" scoped>
.qa-page {
  background:
    radial-gradient(circle at top left, rgba(104, 194, 58, 0.1), transparent 30%),
    linear-gradient(180deg, #f7f9fc 0%, #eef3f9 100%);
}

.qa-shell {
  display: flex;
  min-height: calc(100vh - 70px);
  overflow: hidden;
}

.qa-sidebar {
  display: flex;
  flex-direction: column;
  width: 270px;
  min-width: 270px;
  background: rgba(255, 255, 255, 0.9);
  border-right: 1px solid rgba(226, 232, 240, 0.95);
  backdrop-filter: blur(12px);
  box-shadow: 8px 0 24px rgba(15, 23, 42, 0.03);
}

.sidebar-head {
  padding: 18px 16px 14px;
  border-bottom: 1px solid #edf2f7;
}

.sidebar-title-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sidebar-title-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, rgba(103, 194, 58, 0.14), rgba(64, 158, 255, 0.12));
  color: #2d7fe8;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 700;
  color: #1f2937;
}

.sidebar-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.kb-list {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
}

.kb-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fff;
  border: 1px solid #e5edf5;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}

.kb-item:hover {
  transform: translateY(-1px);
  border-color: #cfe0f6;
  box-shadow: 0 8px 20px rgba(64, 158, 255, 0.08);
}

.kb-item.selected {
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.1), rgba(103, 194, 58, 0.08));
  border-color: #b9d6fb;
  box-shadow: 0 10px 24px rgba(64, 158, 255, 0.12);
}

.kb-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.kb-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: #2d7fe8;
  background: rgba(45, 127, 232, 0.08);
}

.kb-text {
  min-width: 0;
}

.kb-name {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-desc {
  margin-top: 3px;
  font-size: 12px;
  color: #94a3b8;
}

.kb-tag {
  flex: 0 0 auto;
  border-radius: 999px;
}

.sidebar-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.qa-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.qa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(226, 232, 240, 0.95);
}

.query-pill,
.query-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 14px;
}

.query-pill {
  background: linear-gradient(135deg, rgba(103, 194, 58, 0.12), rgba(64, 158, 255, 0.08));
  color: #1f2937;
  border: 1px solid rgba(103, 194, 58, 0.18);
}

.query-pill strong {
  color: #1d4ed8;
}

.query-hint {
  color: #64748b;
  background: rgba(255, 255, 255, 0.6);
  border: 1px dashed #d9e4f1;
}

.qa-header-actions {
  flex: 0 0 auto;
}

.new-session-btn {
  box-shadow: 0 8px 18px rgba(64, 158, 255, 0.12);
}

.mismatch-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: linear-gradient(135deg, rgba(255, 251, 235, 0.98), rgba(255, 249, 235, 0.92));
  border-bottom: 1px solid #f3e2b2;
}

.mismatch-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.mismatch-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: #d97706;
  background: rgba(245, 158, 11, 0.12);
}

.mismatch-copy {
  min-width: 0;
}

.mismatch-title {
  font-size: 14px;
  font-weight: 600;
  color: #8a5b13;
  line-height: 1.5;
}

.mismatch-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: #a16c1a;
}

.recommend-area {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.recommend-card {
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid #f0dca7;
  border-radius: 14px;
  box-shadow: 0 8px 18px rgba(250, 204, 21, 0.08);
}

.recommend-label {
  font-size: 12px;
  color: #b45309;
  font-weight: 600;
}

.recommend-name {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 700;
  color: #7c4b00;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommend-doc {
  margin-top: 4px;
  font-size: 12px;
  color: #9a6a1e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch-btn {
  flex: 0 0 auto;
}

.chat-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
  scroll-behavior: smooth;
}

.welcome-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
}

.welcome-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 420px;
  padding: 28px 32px;
  text-align: center;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid #e4ecf5;
  border-radius: 24px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.06);
}

.welcome-card h3 {
  margin: 0;
  font-size: 22px;
  color: #1f2937;
}

.welcome-card p {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: #64748b;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.typing-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 16px;
}

.typing-avatar {
  flex: 0 0 auto;
  box-shadow: 0 8px 18px rgba(103, 194, 58, 0.18);
}

.typing-bubble {
  max-width: min(760px, 82%);
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #e4ecf5;
  border-radius: 18px 18px 18px 6px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.typing-text,
.typing-answer {
  font-size: 14px;
  line-height: 1.8;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
}

.typing-dots {
  margin-left: 4px;
  color: #60a5fa;
  letter-spacing: 3px;
}

.chat-input-panel {
  padding: 0 24px 18px;
}

.input-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e5edf5;
  border-radius: 24px;
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.08);
}

.question-input :deep(.el-textarea__inner) {
  min-height: 84px !important;
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.7;
  color: #1f2937;
  background: #f8fbff;
  border: 1px solid #dbe6f2;
  border-radius: 18px;
  box-shadow: none;
  resize: none;
}

.question-input :deep(.el-textarea__inner):focus {
  border-color: #67c23a;
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.12);
}

.input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.input-tip {
  font-size: 12px;
  color: #64748b;
}

.input-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.abort-btn,
.send-btn {
  min-width: 96px;
  box-shadow: 0 8px 18px rgba(64, 158, 255, 0.12);
}

.banner-fade-enter-active,
.banner-fade-leave-active {
  transition: all 0.2s ease;
}

.banner-fade-enter-from,
.banner-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 1200px) {
  .qa-sidebar {
    width: 250px;
    min-width: 250px;
  }
}

@media (max-width: 960px) {
  .qa-shell {
    flex-direction: column;
  }

  .qa-sidebar {
    width: 100%;
    min-width: 0;
    max-height: 190px;
    border-right: 0;
    border-bottom: 1px solid rgba(226, 232, 240, 0.95);
  }

  .kb-list {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .kb-item {
    min-width: 220px;
    margin-bottom: 0;
  }

  .chat-area {
    padding: 18px 16px;
  }

  .chat-input-panel {
    padding: 0 16px 16px;
  }

  .mismatch-banner {
    flex-direction: column;
    align-items: stretch;
  }

  .recommend-area {
    justify-content: space-between;
    width: 100%;
  }

  .recommend-card {
    min-width: 0;
    max-width: none;
    flex: 1;
  }
}

@media (max-width: 640px) {
  .qa-header {
    padding: 14px 16px;
    flex-direction: column;
    align-items: flex-start;
  }

  .qa-header-actions {
    width: 100%;
  }

  .new-session-btn {
    width: 100%;
  }

  .mismatch-banner {
    padding: 12px 16px;
  }

  .chat-area {
    padding: 14px 12px;
  }

  .input-card {
    padding: 12px;
    border-radius: 20px;
  }

  .input-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .input-actions {
    width: 100%;
    margin-left: 0;
  }

  .abort-btn,
  .send-btn {
    flex: 1;
  }

  .recommend-area {
    flex-direction: column;
    align-items: stretch;
  }

  .switch-btn {
    width: 100%;
  }

  .typing-bubble {
    max-width: 100%;
  }
}
</style>
