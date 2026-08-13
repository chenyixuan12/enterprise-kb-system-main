<template>
  <div ref="previewEl" class="file-preview">
    <div v-if="showToolbar" class="preview-toolbar">
      <span class="preview-hint">Ctrl + 滚轮 缩放</span>
      <el-button-group>
        <el-button size="small" :icon="ZoomOut" title="缩小" @click="zoomOut" />
        <el-button size="small" title="重置为 100%" @click="resetScale">{{ displayScale }}%</el-button>
        <el-button size="small" :icon="ZoomIn" title="放大" @click="zoomIn" />
      </el-button-group>
      <el-button size="small" title="适应窗口" @click="fitToWindow">
        <el-icon><Aim /></el-icon>
        适应窗口
      </el-button>
      <el-button
        v-if="canFullscreen"
        size="small"
        :icon="isFullscreen ? Close : FullScreen"
        :title="isFullscreen ? '退出全屏' : '全屏预览'"
        @click="toggleFullscreen"
      >
        {{ isFullscreen ? '退出全屏' : '全屏' }}
      </el-button>
    </div>

    <!-- PDF / 图片：直接内嵌原始文件 -->
    <template v-if="mode === 'native'">
      <div v-if="fileType === 'pdf'" ref="scrollEl" class="preview-scroll">
        <iframe :src="fileUrl" class="preview-iframe" :style="zoomStyle" title="PDF 预览"></iframe>
      </div>
      <div v-else ref="scrollEl" class="preview-scroll preview-image-scroll">
        <div class="preview-image-pad">
          <img
            :src="fileUrl"
            :alt="doc?.originalName || '图片预览'"
            class="preview-image"
            :style="imageStyle"
            @load="onImageLoad"
          />
        </div>
      </div>
    </template>

    <!-- Word：转成 HTML 预览（保留文档里的图片） -->
    <template v-else-if="mode === 'word'">
      <div v-if="loading" class="preview-tip">正在解析 Word 文档…</div>
      <div v-else-if="wordHtml" ref="scrollEl" class="preview-scroll">
        <iframe :srcdoc="wordHtml" class="preview-iframe" :style="zoomStyle" title="Word 预览"></iframe>
      </div>
      <el-empty v-else description="当前文档暂无可预览内容" />
    </template>

    <!-- Markdown / 纯文本：渲染可读文本（保留内容中的图片） -->
    <template v-else-if="mode === 'text'">
      <div v-if="loading" class="preview-tip">正在加载文件内容…</div>
      <div v-else-if="textContent" ref="scrollEl" class="preview-scroll preview-text-scroll">
        <div class="preview-doc" :class="{ 'is-markdown': fileType === 'md' }" :style="textZoomStyle" v-html="renderedHtml"></div>
      </div>
      <el-empty v-else description="当前文档暂无可预览内容" />
    </template>

    <!-- 无法内嵌的类型：提供原文件下载 -->
    <template v-else-if="mode === 'download'">
      <div class="preview-download">
        <el-empty :description="`${fileType.toUpperCase()} 文件不支持在线预览，请下载后查看`">
          <el-button type="primary" @click="downloadFile">
            <el-icon><Download /></el-icon>
            下载原文件
          </el-button>
        </el-empty>
      </div>
    </template>

    <el-empty v-else description="当前文档暂无可预览内容" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Download, ZoomIn, ZoomOut, FullScreen, Close, Aim } from '@element-plus/icons-vue';

const props = defineProps({
  doc: { type: Object, default: null }
});

const textContent = ref('');
const wordHtml = ref('');
const loading = ref(false);
const scale = ref(1);
const isFullscreen = ref(false);
const imageNatural = ref({ width: 0, height: 0 });
const imageLoaded = ref(false);
let imageTouched = false;
let fetchController = null;

const previewEl = ref(null);
const scrollEl = ref(null);

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;

const docId = computed(() => props.doc?._id || '');
const fileType = computed(() => String(props.doc?.fileType || '').toLowerCase());
const fileUrl = computed(() => (docId.value ? `/api/knowledge/${docId.value}/file` : ''));
const wordPreviewUrl = computed(() => (docId.value ? `/api/knowledge/${docId.value}/preview` : ''));

const isImage = computed(
  () => mode.value === 'native' && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(fileType.value)
);

const mode = computed(() => {
  const type = fileType.value;
  if (!type) return 'text';
  if (type === 'pdf' || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(type)) return 'native';
  if (type === 'docx' || type === 'doc') return 'word';
  if (type === 'md' || type === 'txt') return 'text';
  return 'download';
});

const showToolbar = computed(() => mode.value !== 'download');
const canFullscreen = computed(() => mode.value === 'native' || mode.value === 'word' || mode.value === 'text');

const displayScale = computed(() => `${Math.round(scale.value * 100)}`);

// PDF / Word iframe：用原生 zoom 缩放，内容会随之重排
const zoomStyle = computed(() => ({ zoom: String(scale.value) }));

// 文本预览：同样用原生 zoom，整个文档等比缩放
const textZoomStyle = computed(() => ({ zoom: String(scale.value) }));

// 图片：用明确像素尺寸，100% = 原始像素大小
const imageStyle = computed(() => {
  if (!imageNatural.value.width || !imageNatural.value.height) {
    return { maxWidth: '100%', maxHeight: '62vh', height: 'auto', width: 'auto' };
  }
  const s = scale.value;
  return {
    width: `${Math.round(imageNatural.value.width * s)}px`,
    height: `${Math.round(imageNatural.value.height * s)}px`,
    maxWidth: 'none',
    maxHeight: 'none'
  };
});

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value) || 1));
}

function markImageTouched() {
  if (isImage.value) imageTouched = true;
}

function zoomIn() {
  scale.value = clampScale(scale.value + SCALE_STEP);
  markImageTouched();
}

function zoomOut() {
  scale.value = clampScale(scale.value - SCALE_STEP);
  markImageTouched();
}

function resetScale() {
  scale.value = 1;
  markImageTouched();
}

function computeImageFit() {
  const container = scrollEl.value;
  const natural = imageNatural.value;
  if (!container || !natural.width || !natural.height) return;
  const availWidth = Math.max(1, container.clientWidth - 32);
  const availHeight = Math.max(1, container.clientHeight - 32);
  scale.value = clampScale(Math.min(availWidth / natural.width, availHeight / natural.height));
}

function fitToWindow() {
  if (isImage.value && imageNatural.value.width) {
    computeImageFit();
    return;
  }
  scale.value = 1;
}

function attachWheelZoom(el) {
  if (!el || el.__previewWheelAttached) return;
  el.__previewWheelAttached = true;
  el.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
        scale.value = clampScale(scale.value + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
        markImageTouched();
      }
    },
    { passive: false }
  );
}

// 图片加载后：记录原始尺寸，并在首次打开时自动“适应窗口”（保证能看全图）
function onImageLoad() {
  const img = scrollEl.value?.querySelector('img');
  if (!img) return;
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) return;

  imageNatural.value = { width: naturalWidth, height: naturalHeight };
  imageLoaded.value = true;

  nextTick(() => requestAnimationFrame(() => {
    if (!imageTouched) computeImageFit();
  }));
}

function toggleFullscreen() {
  if (!previewEl.value) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  previewEl.value.requestFullscreen?.().catch(() => {});
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
  // 进入全屏后容器尺寸变化，重新计算图片适应尺寸
  if (isFullscreen.value && isImage.value && imageLoaded.value && !imageTouched) {
    nextTick(() => requestAnimationFrame(computeImageFit));
  }
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === '=') {
    event.preventDefault();
    zoomIn();
    markImageTouched();
  } else if ((event.ctrlKey || event.metaKey) && event.key === '-') {
    event.preventDefault();
    zoomOut();
    markImageTouched();
  } else if ((event.ctrlKey || event.metaKey) && event.key === '0') {
    event.preventDefault();
    resetScale();
    markImageTouched();
  }
}

function getAuthHeaders() {
  const user = JSON.parse(localStorage.getItem('enterpriseUser') || 'null');
  if (!user) return {};
  return {
    'x-user-id': user._id || '',
    'x-user-name': user.username || '',
    'x-user-role': user.role || 'user'
  };
}

async function fetchFileText() {
  if (!docId.value) return;
  if (props.doc?.content) {
    textContent.value = props.doc.content;
    return;
  }
  if (!fileUrl.value) return;

  loading.value = true;
  fetchController = new AbortController();
  try {
    const response = await fetch(fileUrl.value, {
      signal: fetchController.signal,
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      textContent.value = '';
      if (data?.message) throw new Error(data.message);
      return;
    }
    const text = await response.text();
    textContent.value = text || '';
  } catch (error) {
    if (error.name !== 'AbortError') {
      textContent.value = '';
    }
  } finally {
    loading.value = false;
  }
}

async function fetchWordHtml() {
  if (!wordPreviewUrl.value) return;

  loading.value = true;
  fetchController = new AbortController();
  try {
    const response = await fetch(wordPreviewUrl.value, {
      signal: fetchController.signal,
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      wordHtml.value = '';
      return;
    }
    const data = await response.json();
    wordHtml.value = data?.data?.html || '';
  } catch (error) {
    if (error.name !== 'AbortError') {
      wordHtml.value = '';
    }
  } finally {
    loading.value = false;
  }
}

function downloadFile() {
  if (fileUrl.value) window.open(fileUrl.value, '_blank');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveImageSrc(src = '') {
  const trimmed = src.trim();
  if (/^(https?:|data:|\/)/.test(trimmed)) return trimmed;
  return `${window.location.origin}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

function inlineMarkdown(text = '') {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, src) => `<img src="${resolveImageSrc(src)}" alt="${alt}" />`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function renderMarkdown(text = '') {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let codeLines = [];
  let listStack = [];

  const flushList = (type) => {
    while (listStack.length) {
      const current = listStack.pop();
      if (current === type) {
        html.push(`</${type}>`);
        break;
      }
      html.push(`</${current}>`);
    }
  };

  const closeAllLists = () => {
    while (listStack.length) html.push(`</${listStack.pop()}>`);
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    if (/^```/.test(line)) {
      if (!inCode) {
        flushList('ul');
        flushList('ol');
        inCode = true;
        codeLines = [];
      } else {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      closeAllLists();
      const level = line.match(/^#{1,6}/)[0].length;
      const content = inlineMarkdown(line.replace(/^#{1,6}\s*/, ''));
      html.push(`<h${level}>${content}</h${level}>`);
    } else if (/^\s*>\s?/.test(line)) {
      closeAllLists();
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
    } else if (/^\s*[-*+]\s+/.test(line)) {
      flushList('ol');
      if (!listStack.includes('ul')) {
        html.push('<ul>');
        listStack.push('ul');
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*[-*+]\s+/, ''))}</li>`);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      flushList('ul');
      if (!listStack.includes('ol')) {
        html.push('<ol>');
        listStack.push('ol');
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
    } else if (!line.trim()) {
      closeAllLists();
    } else {
      closeAllLists();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeAllLists();
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);

  return html.join('\n');
}

const renderedHtml = computed(() => {
  if (fileType.value === 'md') {
    return renderMarkdown(textContent.value);
  }
  return escapeHtml(textContent.value).replace(/\n/g, '<br />');
});

watch(
  () => [docId.value, fileType.value],
  () => {
    textContent.value = '';
    wordHtml.value = '';
    imageNatural.value = { width: 0, height: 0 };
    imageLoaded.value = false;
    imageTouched = false;
    scale.value = 1;
    if (mode.value === 'text') fetchFileText();
    else if (mode.value === 'word') fetchWordHtml();
  },
  { immediate: true }
);

watch(
  () => scrollEl.value,
  (el) => {
    attachWheelZoom(el);
  },
  { flush: 'post' }
);

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  fetchController?.abort();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('keydown', onKeydown);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
</script>

<style scoped>
.file-preview {
  width: 100%;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.preview-hint {
  font-size: 12px;
  color: #9ca3af;
  margin-right: auto;
}

.preview-scroll {
  width: 100%;
  height: 65vh;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f9fafb;
  overscroll-behavior: contain;
}

.preview-image-scroll {
  display: flex;
}

.preview-text-scroll {
  background: #ffffff;
}

.preview-iframe {
  width: 100%;
  height: 65vh;
  border: none;
  background: #ffffff;
  transform-origin: top left;
}

.preview-image-pad {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 65vh;
  padding: 16px;
}

.preview-image {
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  transition: width 0.15s ease, height 0.15s ease;
}

.preview-doc {
  padding: 16px 20px;
  font-size: 14px;
  line-height: 1.7;
  color: #111827;
  word-break: break-word;
  transform-origin: top left;
}

.preview-doc.is-markdown {
  font-family: inherit;

  :deep(h1) { font-size: 22px; margin: 18px 0 10px; }
  :deep(h2) { font-size: 19px; margin: 16px 0 8px; }
  :deep(h3) { font-size: 16px; margin: 14px 0 8px; }
  :deep(h4),
  :deep(h5),
  :deep(h6) { font-size: 14px; margin: 12px 0 6px; }
  :deep(p) { margin: 8px 0; }
  :deep(img) { max-width: 100%; height: auto; border-radius: 6px; margin: 8px 0; }
  :deep(pre) { background: #f3f4f6; border-radius: 8px; padding: 12px; overflow: auto; }
  :deep(code) { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-size: 13px; }
  :deep(pre code) { background: transparent; padding: 0; }
  :deep(blockquote) { border-left: 4px solid #e5e7eb; margin: 8px 0; padding: 4px 12px; color: #6b7280; }
  :deep(ul),
  :deep(ol) { padding-left: 22px; margin: 8px 0; }
  :deep(a) { color: #2563eb; text-decoration: none; }
  :deep(a:hover) { text-decoration: underline; }
}

.preview-tip {
  padding: 24px;
  text-align: center;
  color: #6b7280;
}

.preview-download {
  padding: 24px 0;
}

/* 全屏时扩大预览区域 */
.file-preview:fullscreen {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: #ffffff;
  overflow: hidden;
}

.file-preview:fullscreen .preview-toolbar {
  margin-bottom: 12px;
}

.file-preview:fullscreen .preview-scroll {
  flex: 1;
  height: auto;
  min-height: 0;
}

.file-preview:fullscreen .preview-iframe {
  height: 100%;
}

.file-preview:fullscreen .preview-image-pad {
  min-height: 100%;
}
</style>
