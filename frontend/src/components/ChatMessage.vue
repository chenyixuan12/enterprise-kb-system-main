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
          <div class="message-text">{{ message.content }}</div>

        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { User, Monitor } from '@element-plus/icons-vue';

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

.sources {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e6edf5;

  .sources-title {
    margin-bottom: 8px;
    font-size: 12px;
    color: #8592a6;
  }

  .sources-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .source-tag {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 100%;
    padding: 8px 12px;
    background: #f8fbff;
    border: 1px solid #dce7f3;
    border-radius: 10px;
    font-size: 12px;
    color: #4b5563;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      background: #eef6ff;
      border-color: #c9ddf6;
      transform: translateY(-1px);
    }
  }

  .source-snippet {
    color: #7b8794;
    line-height: 1.6;
  }

  .source-score {
    color: #4f8fe8;
    font-size: 11px;
  }
}
</style>
