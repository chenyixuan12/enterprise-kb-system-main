<template>
  <div class="message-wrapper" :class="{ 'is-user': isUser, 'is-ai': !isUser }">
    <template v-if="isUser">
      <div class="message-content user-content">
        <div class="bubble user-bubble">
          <div class="message-text">{{ message.content }}</div>
        </div>
        <div class="avatar user-avatar">
          <el-avatar :size="36" :icon="User" />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="message-content ai-content">
        <div class="avatar ai-avatar">
          <el-avatar :size="36" :icon="Monitor" class="ai-icon" />
        </div>
        <div class="bubble ai-bubble">
          <div v-if="message.answeredByKnowledgeName" class="bubble-kb-tag">
            <el-icon :size="12"><FolderOpened /></el-icon>
            依据「{{ message.answeredByKnowledgeName }}」回答
          </div>
          <div class="message-text">{{ message.content }}</div>
        </div>
     </div>
    </template>
  </div>
</template> 

<script setup>
import { computed } from 'vue';
import { User, Monitor, FolderOpened } from '@element-plus/icons-vue';

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
});

const isUser = computed(() => props.message.role === 'user');


</script>

<style lang="scss" scoped>
.message-wrapper {
  margin-bottom: 18px;
}

.message-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: min(82%, 760px);

  &.user-content {
    margin-left: auto;
    flex-direction: row-reverse;
  }

  &.ai-content {
    margin-right: auto;
  }
}

.avatar {
  flex: 0 0 auto;
  margin-top: 2px;

  :deep(.el-avatar) {
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
  }

  .ai-icon {
    background: linear-gradient(135deg, #4f8fe8 0%, #7fb5f3 100%);
    color: #fff;
  }
}

.bubble {
  position: relative;
  padding: 14px 16px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
  overflow-wrap: anywhere;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);

  .message-text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  &.user-bubble {
    color: #ffffff;
    background: linear-gradient(135deg, #5f9ef7 0%, #69c0a7 100%);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-bottom-right-radius: 6px;
  }

  &.ai-bubble {
    color: #243042;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid #e5edf5;
    border-bottom-left-radius: 6px;
  }
}

.bubble-kb-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  padding: 2px 10px;
  background: rgba(64, 158, 255, 0.08);
  border: 1px solid rgba(64, 158, 255, 0.2);
  border-radius: 999px;
  font-size: 12px;
  color: #2d7fe8;
}
</style>
