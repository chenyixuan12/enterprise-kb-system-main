<template>
  <el-dialog v-model="visible" title="上传文档" width="560px" @close="pauseUpload" @closed="resetForm">
    <el-form :model="form" :rules="rules" ref="formRef" label-width="96px" class="upload-form">
      <el-form-item label="选择知识库" prop="categoryId">
        <el-select v-model="form.categoryId" placeholder="请选择所属知识库" style="width: 100%" filterable :loading="isLoadingDBs">
          <el-option
            v-for="item in knowledgeDBsList"
            :key="item._id"
            :label="item.name"
            :value="item._id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="上传文件" prop="file">
        <el-upload
          ref="uploadRef"
          :file-list="fileList"
          :before-upload="beforeUpload"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
          :multiple="false"
          :auto-upload="false"
          :limit="1"
          accept=".txt,.md,.pdf,.docx"
          class="upload-demo"
        >
          <el-button type="primary">
            <el-icon><Upload /></el-icon>
            选择文件
          </el-button>
          <template #tip><div class="el-upload__tip">支持 .txt、.md、.pdf、.docx；大文件将按 5MB 分片上传。</div></template>
        </el-upload>
      </el-form-item>
      <el-form-item v-if="uploading || progress > 0" label="上传进度">
        <el-progress :percentage="progress" :status="uploadError ? 'exception' : undefined" />
        <div class="upload-status">{{ uploadStatus }}</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="uploading" @click="pauseUpload">暂停</el-button>
      <el-button type="primary" :loading="uploading" @click="onSubmitClick">{{ progress > 0 && progress < 100 ? '继续上传' : '上传' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import SparkMD5 from 'spark-md5';
import { http } from '../api/http.js';

const CHUNK_SIZE = 5 * 1024 * 1024;
const CONCURRENCY = 3;

const props = defineProps({
  modelValue: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue', 'uploaded']);
const knowledgeDBsList = ref([]);
const isLoadingDBs = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const formRef = ref();
const uploading = ref(false);
const fileList = ref([]);
const selectedFile = ref(null);
const progress = ref(0);
const uploadStatus = ref('');
const uploadError = ref(false);
let pauseRequested = false;

const form = reactive({
  categoryId: ''
});

onMounted(async () => {
  isLoadingDBs.value = true;
  try {
    const response = await http.get('/category', {
      params: { page: 1, pageSize: 9999 }
    });
    const data = response?.data?.data;
    knowledgeDBsList.value = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
  } catch (error) {
    ElMessage.error(error.message || '加载知识库列表失败');
  } finally {
    isLoadingDBs.value = false;
  }
});

const rules = {
  categoryId: [{ required: true, message: '请选择所属知识库', trigger: 'change' }]
};

function resetForm() {
  form.categoryId = '';
  fileList.value = [];
  selectedFile.value = null;
  progress.value = 0;
  uploadStatus.value = '';
  uploadError.value = false;
  if (formRef.value) formRef.value.clearValidate?.();
}

function handleFileChange(file, list) {
  fileList.value = list;
  selectedFile.value = file.raw;
}

function handleFileRemove(_file, list) {
  fileList.value = list;
  selectedFile.value = null;
}

function beforeUpload(file) {
  const allowedTypes = ['.txt', '.md', '.pdf', '.docx'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowedTypes.includes(ext)) {
    ElMessage.error('只支持上传 .txt、.md、.pdf、.docx 格式的文件');
    return false;
  }
  return true;
}

function onSubmitClick() {
  submitUpload();
}

async function submitUpload() {
  if (!formRef.value) {
    return;
  }
  try {
    await formRef.value.validate();
  } catch {
    ElMessage.warning('请完善表单信息');
    return;
  }

  if (!selectedFile.value) {
    ElMessage.warning('请选择要上传的文件');
    return;
  }

  try {
    uploading.value = true;
    pauseRequested = false;
    uploadError.value = false;
    const result = await uploadInChunks(selectedFile.value);
    if (!result) return;
    ElMessage.success(result.message || '上传成功');
    emit('uploaded', result.data);
    visible.value = false;
  } catch (error) {
    uploadError.value = true;
    ElMessage.error('上传失败：' + (error.message || '网络错误'));
  } finally {
    uploading.value = false;
  }
}

function pauseUpload() {
  pauseRequested = true;
  uploadStatus.value = '正在暂停，当前分片完成后可继续上传';
}

async function calculateFileHash(file) {
  const spark = new SparkMD5.ArrayBuffer();
  const total = Math.ceil(file.size / CHUNK_SIZE);
  for (let index = 0; index < total; index += 1) {
    if (pauseRequested) return null;
    const buffer = await file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE)).arrayBuffer();
    spark.append(buffer);
    progress.value = Math.round(((index + 1) / total) * 10);
    uploadStatus.value = `正在计算文件 MD5（${index + 1}/${total}）`;
  }
  return spark.end();
}

async function uploadInChunks(file) {
  const fileHash = await calculateFileHash(file);
  if (!fileHash) return null;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const check = (await http.post('/knowledge/upload/check', { fileHash, fileName: file.name, totalChunks })).data;
  if (check.data?.uploaded) return check;

  const uploaded = new Set(check.data?.uploadedChunks || []);
  const pending = Array.from({ length: totalChunks }, (_, index) => index).filter((index) => !uploaded.has(index));
  const completedBefore = uploaded.size;
  const updateProgress = () => {
    progress.value = 10 + Math.round((uploaded.size / totalChunks) * 85);
    uploadStatus.value = `正在上传分片：${uploaded.size}/${totalChunks}`;
  };
  updateProgress();

  let cursor = 0;
  async function worker() {
    while (!pauseRequested && cursor < pending.length) {
      const index = pending[cursor++];
      const chunk = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
      const body = new FormData();
      body.append('chunk', chunk, `${file.name}.part`);
      body.append('fileHash', fileHash);
      body.append('chunkIndex', String(index));
      body.append('totalChunks', String(totalChunks));
      await http.post('/knowledge/upload/chunk', body, { timeout: 120000 });
      uploaded.add(index);
      updateProgress();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  if (pauseRequested) {
    uploadStatus.value = `已暂停：已完成 ${uploaded.size}/${totalChunks} 个分片，点击“继续上传”即可断点续传`;
    return null;
  }
  // 文件在上传中被替换时避免错误合并；check 接口会保留服务端已成功的分片。
  if (uploaded.size !== totalChunks) throw new Error(`上传中断（已完成 ${uploaded.size - completedBefore} 个新分片）`);
  uploadStatus.value = '正在校验并合并分片…';
  progress.value = 96;
  const result = (await http.post('/knowledge/upload/merge', { fileHash, fileName: file.name, fileSize: file.size, totalChunks, categoryId: form.categoryId })).data;
  progress.value = 100;
  uploadStatus.value = '上传完成';
  return result;
}
</script>

<style scoped>
.upload-form {
  display: grid;
  gap: 4px;
}

.upload-demo {
  margin-top: 4px;
}

.upload-status { margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
