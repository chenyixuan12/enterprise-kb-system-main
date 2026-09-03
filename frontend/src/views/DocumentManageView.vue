<template>
  <div class="document-manage">
    <div class="page-header">
      <h1 class="page-title">文档管理</h1>
      <div class="actions">
        <el-button type="primary" @click="openUploadDialog">
          <el-icon><Upload /></el-icon>
          上传文档
        </el-button>
        <el-button type="success" plain @click="openManualDialog">
          <el-icon><Edit /></el-icon>
          手动录入
        </el-button>
      </div>
    </div>

    <div class="search-bar">
      <el-input
        v-model="keyword"
        placeholder="搜索文档名称或原始文件名"
        :prefix-icon="Search"
        clearable
        style="width: 300px"
      />
      <el-select v-model="status" placeholder="选择状态筛选" clearable style="width: 180px">
        <el-option label="全部" value="" />
        <el-option label="等待索引" value="pending" />
        <el-option label="索引中" value="processing" />
        <el-option label="已处理" value="processed" />
        <el-option label="失败" value="failed" />
      </el-select>
      <el-button @click="handleSearch">
        <el-icon><Search /></el-icon>
        查询
      </el-button>
      <el-button @click="handleReset">
        <el-icon><Refresh /></el-icon>
        重置
      </el-button>
      <el-button @click="reload">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-card">
      <el-table :data="filteredDocs" style="width: 100%">
        <el-table-column prop="title" label="文档名称" min-width="280">
          <template #default="{ row }">
            <div class="doc-name-cell">
              <div class="doc-file-icon">{{ extIcon(row.fileType) }}</div>
              <div>
                <div class="doc-name">{{ row.title }}</div>
                <div class="doc-sub">{{ row.originalName }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="fileType" label="文件类型" width="120" />
        <el-table-column label="所属知识库" width="180">
          <template #default="{ row }">
            <span v-if="row.categoryId?.name">{{ row.categoryId.name }}</span>
            <span v-else-if="row.categoryId?.title">{{ row.categoryId.title }}</span>
            <span v-else class="text-gray-400">未分类</span>
          </template>
        </el-table-column>
        <el-table-column prop="fileSize" label="文件大小" width="120">
          <template #default="{ row }">{{ row.fileSize || '未知' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.status === 'failed' && row.errorMessage"
              :content="row.errorMessage"
              placement="top"
            >
              <el-tag :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
            </el-tooltip>
            <el-tag v-else :type="statusTagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上传时间" width="180">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openPreview(row)">预览</el-button>
            <el-button v-if="row.status === 'failed'" type="warning" link :loading="retryingId === row._id" @click="handleRetry(row)">重试</el-button>
            <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!filteredDocs.length" description="暂无文档，请先上传文件或手动录入" />
    </div>

    <UploadDialog
      v-model="uploadDialogVisible"
      :knowledgeDBs="knowledgeDBs"
      @uploaded="handleUploadSuccess"
    />

    <ManualKnowledgeDialog
      v-model="manualDialogVisible"
      :knowledgeDBs="knowledgeDBs"
      @uploaded="handleManualSuccess"
    />

    <el-dialog
      v-model="previewDialogVisible"
      :title="previewDoc?.title ? `预览 - ${previewDoc.title}` : '文档预览'"
      width="70%"
      destroy-on-close
      align-center
    >
      <div class="preview-meta" v-if="previewDoc">
        <span>原文件：{{ previewDoc.originalName || '-' }}</span>
        <span>文件类型：{{ previewDoc.fileType || '-' }}</span>
        <span>文件大小：{{ previewDoc.fileSize || '-' }}</span>
      </div>

      <FilePreview :doc="previewDoc" v-if="previewDoc" />

      <template #footer>
        <div class="preview-actions">
          <el-button type="primary" @click="previewDialogVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Search, Refresh, Upload, Edit } from '@element-plus/icons-vue';
import { apiFetch, http } from '../api/http.js';
import { ElMessage } from 'element-plus';
import UploadDialog from '../components/UploadDialog.vue';
import ManualKnowledgeDialog from '../components/ManualKnowledgeDialog.vue';
import FilePreview from '../components/FilePreview.vue';

const keyword = ref('');
const status = ref('');
const docs = ref([]);
const uploadDialogVisible = ref(false);
const manualDialogVisible = ref(false);
const knowledgeDBs = ref([]);
const previewDialogVisible = ref(false);
const previewDoc = ref(null);
const retryingId = ref(null);
const pollTimer = ref(null);

function extIcon(type) {
  const map = { txt: 'TXT', pdf: 'PDF', doc: 'DOC', docx: 'DOC', md: 'MD' };
  return map[type] || '文';
}

function statusText(statusValue) {
  const map = { pending: '等待索引', processing: '索引中', processed: '已处理', failed: '失败' };
  return map[statusValue] || '等待索引';
}

function statusTagType(statusValue) {
  const map = { pending: 'warning', processing: 'primary', processed: 'success', failed: 'danger' };
  return map[statusValue] || 'warning';
}

function hasPendingDocs() {
  return docs.value.some((item) => item.status === 'pending' || item.status === 'processing');
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

function ensurePolling() {
  stopPolling();
  if (!hasPendingDocs()) return;
  pollTimer.value = window.setInterval(() => {
    reload();
  }, 2000);
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function openUploadDialog() {
  uploadDialogVisible.value = true;
}

function openManualDialog() {
  manualDialogVisible.value = true;
}

async function openPreview(row) {
  previewDoc.value = row;
  previewDialogVisible.value = true;
}

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

function handleUploadSuccess(data) {
  if (data) {
    docs.value = [data, ...docs.value.filter((item) => item._id !== data._id)];
  }
  reload();
  window.dispatchEvent(new CustomEvent('document-uploaded'));
}

function handleManualSuccess(data) {
  if (data) {
    docs.value = [data, ...docs.value.filter((item) => item._id !== data._id)];
  }
  reload();
  window.dispatchEvent(new CustomEvent('document-uploaded'));
}

async function handleDelete(row) {
  try {
    await http.delete(`/knowledge/${row._id}`);
    await reload();
    ElMessage.success('删除成功');
  } catch {
    ElMessage.error('删除失败');
  }
}

async function handleRetry(row) {
  try {
    retryingId.value = row._id;
    await http.post(`/knowledge/${row._id}/retry`);
    ElMessage.success('已重新加入索引队列');
    await reload();
  } catch (error) {
    ElMessage.error(error.message || '重试失败');
  } finally {
    retryingId.value = null;
  }
}

const filteredDocs = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return docs.value.filter((item) => {
    const matchedText = !kw || [item.title, item.originalName, item.fileType].some((field) => String(field || '').toLowerCase().includes(kw));
    const matchedStatus = !status.value || item.status === status.value;
    return matchedText && matchedStatus;
  });
});

watch(
  previewDialogVisible,
  (visible) => {
    if (!visible) {
      previewDoc.value = null;
    }
  }
);

function handleSearch() {}

function handleReset() {
  keyword.value = '';
  status.value = '';
}

async function reload() {
  try {
    const response = await http.get('/knowledge');
    docs.value = response.data?.data || [];
    ensurePolling();
  } catch (error) {
    console.error('加载文档列表失败', error);
  }
}

function onDocumentUploaded() {
  reload();
}

onMounted(() => {
  reload();
  loadKnowledgeDBs();
  window.addEventListener('document-uploaded', onDocumentUploaded);
});

onBeforeUnmount(() => {
  stopPolling();
  window.removeEventListener('document-uploaded', onDocumentUploaded);
});
</script>

<style lang="scss" scoped>
.document-manage {
  width: 100%;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;

    .page-title {
      font-size: 24px;
      font-weight: 700;
      color: #1f2937;
      margin: 0;
    }

    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
  }

  .search-bar {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .table-card {
    background: #ffffff;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);

    .doc-name-cell {
      display: flex;
      align-items: center;
      gap: 12px;

      .doc-file-icon {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 12px;
        font-weight: 600;
      }

      .doc-name {
        font-size: 14px;
        font-weight: 500;
        color: #1f2937;
      }

      .doc-sub {
        font-size: 12px;
        color: #6b7280;
        margin-top: 2px;
      }
    }
  }

  .preview-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
    font-size: 13px;
    color: #6b7280;
  }
}
</style>
