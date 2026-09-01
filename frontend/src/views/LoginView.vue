<template>
  <div class="login-page">
    <div class="login-bg">
      <div class="bg-orb orb-1"></div>
      <div class="bg-orb orb-2"></div>
      <div class="bg-grid"></div>
      <ConstellationBackground />
    </div>

    <div class="login-shell">
      <div class="brand-panel">
        <div class="brand-badge">企业知识库</div>
        <h1>企业知识库问答系统</h1>
        <p class="brand-desc">知识问答与文档管理平台</p>

        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">01</div>
            <div>
              <h3>知识上传</h3>
              <p>支持文档上传、分类管理与知识入库</p>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">02</div>
            <div>
              <h3>专家问答</h3>
              <p>基于知识库文档进行智能对话与回答</p>
            </div>
          </div>
          <div class="feature-item">
            <div class="feature-icon">03</div>
            <div>
              <h3>管理后台</h3>
              <p>提供文档、分类、用户等完整管理能力</p>
            </div>
          </div>
        </div>
      </div>

      <div class="auth-card glass-card">
        <div class="card-topline"></div>
        <div class="card-header">
          <div class="card-icon-wrap">
            <div class="card-icon">KB</div>
          </div>
          <div>
            <h2>欢迎回来</h2>
            <p>登录后继续使用知识库问答系统</p>
          </div>
        </div>

        <form class="form" @submit.prevent="login">
          <label>用户名</label>
          <div class="input-wrap">
            <input v-model="form.username" placeholder="请输入用户名" autocomplete="username" />
          </div>

          <label>密码</label>
          <div class="input-wrap">
            <input v-model="form.password" type="password" placeholder="请输入密码" autocomplete="current-password" />
          </div>

          <button type="submit" :disabled="loading" class="login-btn">
            <span v-if="!loading">登录系统</span>
            <span v-else>登录中...</span>
          </button>
        </form>

        <transition name="fade">
          <p v-if="error" class="error-text">{{ error }}</p>
        </transition>

        <div class="hint-box">
          <div>
            <span class="hint-label">温馨提示</span>
            <span>请联系管理员获取账号</span>
          </div>
          <div>
            <span class="hint-label">登录安全</span>
            <span>凭证已加密传输，请勿泄露</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '../api/http.js';
import ConstellationBackground from '../components/ConstellationBackground.vue';
import { setAuth } from '../utils/auth.js';

const router = useRouter();
const loading = ref(false);
const error = ref('');
const form = reactive({
  username: '',
  password: ''
});

function clearQaSessionState() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('qa-session-') || key === 'qa-session-state')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

async function login() {
  try {
    loading.value = true;
    error.value = '';
    const result = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });

    clearQaSessionState();
    setAuth(result.data, {
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken
    });
    const redirectPath = result.data.role === 'admin' ? '/backend/dashboard' : '/backend/qa';
    router.push(redirectPath);
  } catch (err) {
    error.value = err.message || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.18), transparent 30%),
    radial-gradient(circle at bottom right, rgba(34, 197, 94, 0.16), transparent 28%),
    linear-gradient(135deg, #eef4ff 0%, #f8fbff 48%, #eef2ff 100%);
}

.login-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bg-orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(18px);
  opacity: 0.75;
}

.orb-1 {
  width: 220px;
  height: 220px;
  background: rgba(59, 130, 246, 0.18);
  top: 8%;
  left: 8%;
}

.orb-2 {
  width: 280px;
  height: 280px;
  background: rgba(168, 85, 247, 0.16);
  right: 6%;
  bottom: 10%;
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.4) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.22), transparent 78%);
}

.login-shell {
  position: relative;
  z-index: 1;
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 28px;
  align-items: center;
}

.brand-panel {
  color: #0f172a;
  padding: 24px 12px;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 10px 30px rgba(37, 99, 235, 0.08);
}

.brand-panel h1 {
  margin: 20px 0 12px;
  font-size: clamp(34px, 4vw, 58px);
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: -0.03em;
  color: #0f172a;
}

.brand-desc {
  max-width: 620px;
  margin: 0 0 28px;
  color: #475569;
  font-size: 18px;
  line-height: 1.8;
}

.feature-list {
  display: grid;
  gap: 16px;
  max-width: 680px;
}

.feature-item {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.16);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.06);
}

.feature-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.feature-item h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}

.feature-item p {
  margin: 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}

.auth-card {
  position: relative;
  width: 100%;
  max-width: 520px;
  justify-self: end;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 28px;
  padding: 28px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
  backdrop-filter: blur(16px);
}

.card-topline {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, #2563eb 0%, #60a5fa 45%, #8b5cf6 100%);
  margin-bottom: 22px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.card-icon-wrap {
  flex-shrink: 0;
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.25);
}

.card-icon {
  color: #fff;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.card-header h2 {
  margin: 0;
  font-size: 24px;
  color: #0f172a;
}

.card-header p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 14px;
}

.form {
  display: grid;
  gap: 10px;
}

.form label {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.input-wrap {
  position: relative;
}

.form input {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: 1px solid #dbe3f0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  font-size: 15px;
  outline: none;
  transition: all 0.2s ease;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.form input::placeholder {
  color: #94a3b8;
}

.form input:focus {
  border-color: rgba(37, 99, 235, 0.45);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
  transform: translateY(-1px);
}

.login-btn {
  margin-top: 10px;
  width: 100%;
  height: 52px;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: linear-gradient(135deg, #2563eb 0%, #4f46e5 50%, #7c3aed 100%);
  box-shadow: 0 16px 32px rgba(37, 99, 235, 0.28);
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
}

.login-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 20px 36px rgba(37, 99, 235, 0.34);
  filter: saturate(1.04);
}

.login-btn:active:not(:disabled) {
  transform: translateY(0);
}

.login-btn:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.error-text {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(254, 226, 226, 0.8);
  border: 1px solid rgba(248, 113, 113, 0.25);
  color: #dc2626;
  font-size: 14px;
}

.hint-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px dashed rgba(148, 163, 184, 0.35);
  color: #475569;
  font-size: 13px;
}

.hint-box > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.hint-label {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 960px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .brand-panel {
    padding: 8px 0 0;
  }

  .auth-card {
    max-width: 100%;
    justify-self: stretch;
  }
}

@media (max-width: 640px) {
  .login-page {
    padding: 16px;
  }

  .auth-card {
    padding: 22px;
    border-radius: 22px;
  }

  .brand-panel h1 {
    font-size: 30px;
  }

  .brand-desc {
    font-size: 15px;
  }

  .feature-item {
    grid-template-columns: 44px 1fr;
    padding: 14px;
  }

  .feature-icon {
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }

  .hint-box {
    grid-template-columns: 1fr;
  }
}
</style>
