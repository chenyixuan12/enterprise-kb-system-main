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
        <div class="sidebar-item">
          <span class="sidebar-icon">▣</span>
          <span>数据概览</span>
        </div>
        <div class="sidebar-item">
          <span class="sidebar-icon">📁</span>
          <span>知识库管理</span>
        </div>
        <div class="sidebar-item">
          <span class="sidebar-icon">📄</span>
          <span>文档管理</span>
        </div>
        <div class="sidebar-item">
          <span class="sidebar-icon">👤</span>
          <span>用户管理</span>
        </div>
        <div class="sidebar-item active">
          <span class="sidebar-icon">💬</span>
          <span>智能问答</span>
        </div>
        <div class="sidebar-item bottom-item">
          <span class="sidebar-icon">◌</span>
          <span>对话历史</span>
        </div>
      </nav>
    </aside>

    <main class="enterprise-main">
      <header class="main-topbar">
        <div class="topbar-left">
          <span class="topbar-icon">☰</span>
          <span class="topbar-title">智能问答</span>
        </div>
        <div class="topbar-right">
          <div class="user-dot">{{ avatarText }}</div>
          <div class="user-meta">
            <div class="user-name">{{ currentUser.nickname || currentUser.username || '系统管理员' }}</div>
            <div class="user-role">{{ currentUser.role === 'admin' ? '管理员' : '普通用户' }}</div>
          </div>
        </div>
      </header>

      <section class="main-content-placeholder">
        <div class="placeholder-card">
          <div class="placeholder-title">右侧内容区预留</div>
          <div class="placeholder-text">
            这里可以继续放置和图2类似的表格、搜索框、上传按钮或统计图表。当前先保持空白，方便你后续接入文档管理、知识库管理和用户管理页面。
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const currentUser = ref(JSON.parse(localStorage.getItem('enterpriseUser') || '{}'));
const avatarText = computed(() => (currentUser.value.nickname || currentUser.value.username || '系')[0]);
</script>
