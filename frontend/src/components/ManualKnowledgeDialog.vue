<template>
  <el-dialog v-model="visible" title="手动录入知识" width="860px" @closed="resetForm">
    <el-form :model="form" :rules="rules" ref="formRef" label-width="96px" class="knowledge-form">
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

      <el-form-item label="标题" prop="title">
        <el-input v-model="form.title" placeholder="请输入知识标题" />
      </el-form-item>

      <el-form-item label="正文内容" prop="content">
        <div class="editor-wrap">
          <div class="editor-toolbar">
            <el-button-group>
              <el-button size="small" :type="isActiveFormat('bold') ? 'primary' : ''" @click="execCommand('bold')"><strong>B</strong></el-button>
              <el-button size="small" :type="isActiveFormat('italic') ? 'primary' : ''" @click="execCommand('italic')"><em>I</em></el-button>
              <el-button size="small" :type="isActiveFormat('insertUnorderedList') ? 'primary' : ''" @click="execCommand('insertUnorderedList')">• 列表</el-button>
              <el-button size="small" @click="execCommand('removeFormat')">清除格式</el-button>
            </el-button-group>
            <span class="editor-hint">支持富文本编辑、加粗、斜体、列表与 Tab AI 补全</span>
          </div>

          <div
            ref="editorRef"
            class="rich-editor"
            contenteditable="true"
            :data-placeholder="editorPlaceholder"
            @input="onEditorInput"
            @blur="onEditorBlur"
            @keydown.enter.exact.prevent="handleEnter"
            @keydown.tab.prevent="handleTabCompletion"
          ></div>

          <div class="editor-assistant-bar">
            <span v-if="aiCompleting">AI 正在补全中...</span>
            <span v-else>按 <kbd>Tab</kbd> 让 AI 继续补全当前内容</span>
          </div>

          <div class="editor-footer">
            <span>内容字数：{{ plainTextLength }}</span>
            <span>HTML 形式会保存到数据库中</span>
          </div>
        </div>
      </el-form-item>

      <el-form-item label="原始名称">
        <el-input v-model="form.originalName" placeholder="例如：制度说明.md" />
      </el-form-item>

      <el-form-item label="文件类型">
        <el-select v-model="form.fileType" placeholder="请选择文件类型" style="width: 100%">
          <el-option label="Markdown (.md)" value="md" />
          <el-option label="文本 (.txt)" value="txt" />
          <el-option label="PDF (.pdf)" value="pdf" />
          <el-option label="Word (.docx)" value="docx" />
        </el-select>
      </el-form-item>

      <el-form-item label="文件大小">
        <el-input v-model="form.fileSize" placeholder="例如：12 KB" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submitForm">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { http } from '../api/http.js';
import { ElMessage } from 'element-plus';

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
const loading = ref(false);
const aiCompleting = ref(false);
const editorRef = ref(null);
const editorPlaceholder = '请输入知识正文内容，支持富文本编辑...';
const plainTextLength = ref(0);
const abortController = ref(null);

const form = reactive({
  categoryId: '',
  title: '',
  content: '',
  originalName: '',
  fileType: 'md',
  fileSize: ''
});

onMounted(async () => {
  isLoadingDBs.value = true;
  try {
    const response = await http.get('/category', {
      params: { page: 1, pageSize: 100 }
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
  categoryId: [{ required: true, message: '请选择所属知识库', trigger: 'change' }],
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  content: [{ required: true, message: '请输入正文内容', trigger: 'blur' }]
};

function updatePlainTextLength() {
  const text = editorRef.value?.innerText || '';
  plainTextLength.value = text.trim().length;
}

function syncEditorToForm() {
  form.content = editorRef.value?.innerHTML || '';
  updatePlainTextLength();
}

function setEditorContent(html = '') {
  if (editorRef.value) {
    editorRef.value.innerHTML = html;
    syncEditorToForm();
  }
}

function getEditorSelectionRange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0);
}

function insertHtmlAtCursor(html) {
  const range = getEditorSelectionRange();
  if (!range || !editorRef.value) return;

  range.deleteContents();
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  const insertedNodes = Array.from(fragment.childNodes);
  const lastNode = insertedNodes[insertedNodes.length - 1] || null;
  range.insertNode(fragment);

  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  syncEditorToForm();
}

function buildCursorContext(beforeText, afterText) {
  return {
    beforeText: String(beforeText || '').slice(-500),
    afterText: String(afterText || '').slice(0, 200),
    plainTextLength: plainTextLength.value
  };
}

function getCursorContext() {
  const editor = editorRef.value;
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) {
    return buildCursorContext(editor?.innerText || '', '');
  }

  const range = selection.getRangeAt(0).cloneRange();
  const preRange = range.cloneRange();
  preRange.selectNodeContents(editor);
  preRange.setEnd(range.startContainer, range.startOffset);

  const postRange = range.cloneRange();
  postRange.selectNodeContents(editor);
  postRange.setStart(range.endContainer, range.endOffset);

  return buildCursorContext(preRange.toString(), postRange.toString());
}

function resetForm() {
  // 取消正在进行的 AI 补全请求
  if (abortController.value) {
    abortController.value();
    abortController.value = null;
  }
  form.categoryId = '';
  form.title = '';
  form.content = '';
  form.originalName = '';
  form.fileType = 'md';
  form.fileSize = '';
  plainTextLength.value = 0;
  aiCompleting.value = false;
  if (editorRef.value) editorRef.value.innerHTML = '';
  if (formRef.value) formRef.value.clearValidate?.();
}

watch(
  () => visible.value,
  async (val) => {
    if (!val) {
      resetForm();
      return;
    }
    await nextTick();
    editorRef.value?.focus?.();
  }
);

function onEditorInput() {
  syncEditorToForm();
}

function onEditorBlur() {
  syncEditorToForm();
}

function handleEnter() {
  document.execCommand('insertHTML', false, '<br><br>');
  syncEditorToForm();
}

function execCommand(command) {
  editorRef.value?.focus?.();
  document.execCommand(command, false, null);
  syncEditorToForm();
}

function isActiveFormat(command) {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

function normalizeCompletionText(text) {
  return String(text || '')
    .replace(/^\s+/, '')
    .replace(/^[，,。．\.：:；;、\-—]+\s*/, '')
    .trim();
}

async function handleTabCompletion() {
  if (aiCompleting.value) return;
  syncEditorToForm();

  const plainContent = editorRef.value?.innerText?.trim() || '';
  if (!plainContent) {
    ElMessage.warning('请先输入一些内容再使用 AI 补全');
    return;
  }

  const cursorContext = getCursorContext();
  aiCompleting.value = true;
  abortController.value = null;

  try {
    const result = await http.post('/knowledge/ai-complete', {
      title: form.title,
      content: form.content,
      categoryId: form.categoryId,
      cursorContext
    });

    const completion = normalizeCompletionText(result?.data?.data?.completion || result?.data?.completion || '');
    if (!completion) {
      console.warn('[AI Complete] empty response payload:', result?.data);
      ElMessage.info('AI 没有返回可补全内容');
      return;
    }

    insertHtmlAtCursor(completion.replace(/\n/g, '<br>'));
    ElMessage.success('AI 补全完成');
  } catch (error) {
    ElMessage.error('AI 补全失败：' + (error.message || '未知错误'));
  } finally {
    aiCompleting.value = false;
    abortController.value = null;
  }
}

async function submitForm() {
  if (!formRef.value) return;
  syncEditorToForm();
  try {
    await formRef.value.validate();
  } catch {
    ElMessage.warning('请完善表单信息');
    return;
  }

  if (!form.content?.trim()) {
    ElMessage.warning('请输入正文内容');
    return;
  }

  try {
    loading.value = true;
    const payload = {
      ...form,
      fileSize: form.fileSize || `${Math.max(1, Math.round(plainTextLength.value / 1024))} KB`
    };

    const response = await http.post('/knowledge/manual', payload);
    const result = response?.data;

    ElMessage.success(result?.message || '知识新增成功');
    emit('uploaded', result?.data);
    visible.value = false;
  } catch (error) {
    ElMessage.error('新增失败：' + (error.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(() => {
  try {
    document.execCommand('defaultParagraphSeparator', false, 'div');
  } catch {
    // ignore
  }
});
</script>

<style scoped>
.knowledge-form {
  display: grid;
  gap: 4px;
}

.editor-wrap {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  background: #f8fafc;
}

.editor-hint {
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
}

.rich-editor {
  min-height: 320px;
  padding: 14px 16px;
  outline: none;
  line-height: 1.75;
  font-size: 14px;
  color: #303133;
}

.rich-editor:empty:before {
  content: attr(data-placeholder);
  color: #c0c4cc;
}

.editor-assistant-bar {
  display: flex;
  justify-content: flex-end;
  padding: 6px 12px;
  border-top: 1px solid #ebeef5;
  color: #909399;
  font-size: 12px;
  background: #fffaf0;
}

.editor-assistant-bar kbd {
  padding: 1px 6px;
  border: 1px solid #dcdfe6;
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
}

.editor-footer {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  border-top: 1px solid #ebeef5;
  color: #909399;
  font-size: 12px;
  background: #fafafa;
}
</style>
