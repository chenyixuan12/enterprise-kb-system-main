<template>
    <div class="navbar" :style="{ left: collapsed ? '64px' : '220px' }">
        <div class="nav-left">
            <el-button text @click="handleCollapse" class="collapse-btn">
                <el-icon><component :is="collapsed ? Expand : Fold" /></el-icon>
            </el-button>
            <h1 class="page-title">导航栏</h1>
        </div>
        <div class="nav-right">
            <el-dropdown @command="handleCommand">
                <div class="user-info">
                    <el-avatar :size="40">{{ avatarText }}</el-avatar>
                    <span class="user-name">{{ currentUser.nickname || currentUser.username || '系统管理员' }}</span>
                    <el-icon><ArrowDown /></el-icon>
                </div>
                <template #dropdown>
                    <el-dropdown-item command="logout">
                        <el-icon><SwitchButton /></el-icon>
                        退出登录
                    </el-dropdown-item>
                </template>
            </el-dropdown>
        </div>
    </div>
</template>
<script setup>
import { ArrowDown, Fold, Expand, SwitchButton } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router'
import { computed, ref, inject } from 'vue'
import { clearAuth, getStoredUser } from '../utils/auth.js'

const router = useRouter()
const currentUser = ref(getStoredUser() || {})

const avatarText = computed(() => (currentUser.value.nickname || currentUser.value.username || '系')[0])

// 注入折叠状态
const collapsed = inject('sidebarCollapsed', ref(false))

const emit = defineEmits(['toggle-sidebar'])

const handleLogout = () => {
  clearAuth()
  router.push('/')
}

const handleCommand=(command)=>{
    if(command === 'logout'){
        handleLogout()
    }
}

function handleCollapse(){
    emit('toggle-sidebar')
}
</script>
<style lang="scss" scoped>

.navbar{
    height: 70px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(0,21,41,0.08);
    border-bottom: 1px solid #e8e8e8;
    position: fixed;
    top: 0;
    right: 0;
    z-index: 1000;
    transition: left 0.3s ease;
    
    .nav-left {
        display: flex;
        align-items: center;
        gap: 16px;
        
        .collapse-btn {
            color: #606266;
            font-size: 20px;
            
            &:hover {
                color: #409eff;
            }
        }
        
        .page-title {
            font-size: 24px;
            font-weight: 700;
            color: #1f2937;
            margin: 0;
        }
    }
    
    .nav-right {
        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            padding: 6px 12px;
            border-radius: 6px;
            transition: background-color 0.2s;
            
            &:hover {
                background-color: #f5f7fa;
            }
            
            .user-name {
                color: #303133;
                font-size: 14px;
                font-weight: 500;
            }
        }
    }
}

</style>