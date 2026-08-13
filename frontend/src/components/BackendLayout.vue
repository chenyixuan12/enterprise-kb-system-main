<template>
  <div class="backend-layout" :class="{ 'sidebar-collapsed': isCollapsed }">
    <Sidebar :collapsed="isCollapsed" @toggle="toggleSidebar"/>
    <div class="main-wrapper">
      <Navbar @toggle-sidebar="toggleSidebar"></Navbar>
      <div class="main-content">
        <router-view class="content-container"></router-view>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, provide } from 'vue'
import Sidebar from './Sidebar.vue'
import Navbar from './Navbar.vue'

const isCollapsed = ref(false)

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value
}

provide('sidebarCollapsed', isCollapsed)
</script>

<style lang="scss" scoped>
.backend-layout{
  width: 100%;
  min-height: 100vh;
  position: relative;
  
  &.sidebar-collapsed {
    .main-wrapper {
      margin-left: 64px;
    }
  }
  
  .main-wrapper {
    margin-left: 220px;
    min-height: 100vh;
    transition: margin-left 0.3s ease;
  }
  
  .main-content{
    background-color: #f0f2f5;
    padding: 90px 24px 24px 24px;
    min-height: calc(100vh - 70px);
  }
}
</style>
