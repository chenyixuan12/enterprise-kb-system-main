<template>
  <div class="enterprise-layout">
    <aside class="enterprise-sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon">企</div>
        <div>
          <div class="brand-title">企业知识库</div>
          <div class="brand-subtitle">智能问答平台</div>
        </div>
      </div>

      <nav class="sidebar-menu">
        <div class="sidebar-item active">
          <span class="sidebar-icon">▣</span>
          <span>数据概览</span>
        </div>
        <div class="sidebar-item" @click="goDoc">
          <span class="sidebar-icon">📄</span>
          <span>文档管理</span>
        </div>
        <div class="sidebar-item" @click="goUpload">
          <span class="sidebar-icon">⬆</span>
          <span>文档上传</span>
        </div>
        <div class="sidebar-item" @click="goQa">
          <span class="sidebar-icon">💬</span>
          <span>智能问答</span>
        </div>
        <div class="sidebar-item bottom-item" @click="logout">
          <span class="sidebar-icon">◌</span>
          <span>退出登录</span>
        </div>
      </nav>
    </aside>

    <main class="enterprise-main">
      <header class="main-topbar">
        <div class="topbar-left">
          <span class="topbar-icon">☰</span>
          <span class="topbar-title">数据概览</span>
        </div>
        <div class="topbar-right">
          <div class="user-dot">{{ avatarText }}</div>
          <div class="user-meta">
            <div class="user-name">{{ currentUser.nickname || currentUser.username || '系统管理员' }}</div>
            <div class="user-role">{{ currentUser.role === 'admin' ? '管理员' : '普通用户' }}</div>
          </div>
        </div>
      </header>

      <section class="admin-content">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">用户总数</div>
            <div class="stat-value">{{ dashboard.userCount }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">管理员数</div>
            <div class="stat-value">{{ dashboard.adminCount }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">文档总数</div>
            <div class="stat-value">{{ dashboard.docCount }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">已处理文档</div>
            <div class="stat-value">{{ dashboard.processedCount }}</div>
          </div>
        </div>

        <div class="card chart-card">
          <div class="section-title">统计图表</div>
          <div class="grid charts-grid">
            <div ref="userChart" class="chart"></div>
            <div ref="docChart" class="chart"></div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts';
import { apiFetch } from '../api/http.js';
import { clearAuth, getStoredUser } from '../utils/auth.js';

const router = useRouter();
const currentUser = ref(getStoredUser() || {});
const avatarText = computed(() => (currentUser.value.nickname || currentUser.value.username || '系')[0]);
const dashboard = reactive({ userCount: 0, adminCount: 0, docCount: 0, processedCount: 0, docStatus: [], userRoleStats: [] });
const userChart = ref(null);
const docChart = ref(null);

function goQa() { router.push('/qa'); }
function goUpload() { router.push('/upload'); }
function goDoc() { router.push('/documents'); }
function logout() { clearAuth(); router.push('/'); }

onMounted(async () => {
  const result = await apiFetch('/admin/dashboard');
  Object.assign(dashboard, result.data);
  renderCharts();
});

function renderCharts() {
  const userIns = echarts.init(userChart.value);
  userIns.setOption({
    tooltip: {},
    xAxis: { type: 'category', data: dashboard.userRoleStats.map((item) => item.name) },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: dashboard.userRoleStats.map((item) => item.value), barWidth: 36, itemStyle: { color: '#2563eb' } }]
  });

  const docIns = echarts.init(docChart.value);
  docIns.setOption({
    tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['38%', '70%'], data: dashboard.docStatus, label: { formatter: '{b}: {c}' } }]
  });
}
</script>
