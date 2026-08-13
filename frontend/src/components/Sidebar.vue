<template>
    <el-aside :width="collapsed ? '64px' : '220px'" class="sidebar-container">
      <div class="sidebar-brand">
        <el-icon class="brand-icon" :size="40" color="#409eff">
          <Reading />
        </el-icon>
        <div class="brand-text" v-show="!collapsed">
          <h2 class="brand-title">企业知识库</h2>
        </div>
      </div>
      <el-menu
        router
        :default-active="activePath"
        class="sidebar-menu"
        :collapse="collapsed"
        background-color="#2c3e50"
        text-color="#b8c7ce"
        active-text-color="#409eff"
      >
        <el-menu-item
          v-for="menuItem in sideList"
          :key="menuItem.id"
          :index="menuItem.path"
        >
          <el-icon>
            <component :is="icons[menuItem.meta.icon]" />
          </el-icon>
          <template #title>{{ menuItem.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { computed, inject } from 'vue'

import { PieChart, DataLine, Document, ChatDotRound, Reading, ChatLineSquare } from '@element-plus/icons-vue'

const icons = {
  PieChart,
  DataLine,
  Document,
  ChatDotRound,
  Reading,
  ChatLineSquare
}

const allMenuItems = [
  {
    id: '01',
    title: '数据概览',
    meta: { icon: 'PieChart' },
    path: '/backend/dashboard',
    roles: ['admin']
  },
  {
    id: '02',
    title: '知识库管理',
    meta: { icon: 'DataLine' },
    path: '/backend/konwledgedb',
    roles: ['admin']
  },
  {
    id: '03',
    title: '文档管理',
    meta: { icon: 'Document' },
    path: '/backend/documents',
    roles: ['admin']
  },
  {
    id: '04',
    title: '用户管理',
    meta: { icon: 'Reading' },
    path: '/backend/users',
    roles: ['admin']
  },
  {
    id: '05',
    title: '知识问答',
    meta: { icon: 'ChatDotRound' },
    path: '/backend/qa',
    roles: ['admin', 'user']
  },
  {
    id: '06',
    title: '对话历史',
    meta: { icon: 'ChatLineSquare' },
    path: '/backend/chatHistory',
    roles: ['admin', 'user']
  },
]

const currentUser = computed(() => {
  const userStr = localStorage.getItem('enterpriseUser')
  return userStr ? JSON.parse(userStr) : {}
})

const sideList = computed(() => {
  const userRole = currentUser.value.role || 'user'
  if (userRole === 'admin') {
    return allMenuItems
  }
  return allMenuItems.filter(item => item.roles.includes('user'))
})

const route = useRoute()
const activePath = computed(() => route.path)

// 接收父组件传递的折叠状态
const collapsed = inject('sidebarCollapsed', computed(() => false))
</script>

<style scoped lang="scss">
.sidebar-container {
  background-color: #2c3e50;
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  z-index: 1001;
  overflow-x: hidden;
  transition: width 0.3s ease;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  height: 70px;
  padding: 0 20px;
  background-color: #ffffff;
  border-bottom: 1px solid #e8e8e8;
  gap: 12px;
  justify-content: center;

  .brand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .brand-text {
    .brand-title {
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
    }
  }
}

.sidebar-menu {
  border-right: none;
  border: none;
  height: calc(100vh - 81px);

  :deep(.el-menu-item) {
    height: 50px;
    line-height: 50px;
    font-size: 14px;
    margin: 4px 8px;
    border-radius: 6px;

    &:hover {
      background-color: #34495e !important;
    }

    &.is-active {
      background-color: #34495e !important;
      border-left: 3px solid #409eff;
    }

    .el-icon {
      width: 20px;
      height: 20px;
      margin-right: 10px;
    }
  }
}
</style>
