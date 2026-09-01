import path from 'path';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import { indexKnowledgeDocument } from './knowledgeIndexService.js';
import { extractTextFromFile } from './documentService.js';

/**
 * 内存中的串行索引队列：
 * - 上传接口只创建文档并 enqueue，接口立刻返回；
 * - 队列逐个处理文档（Ollama / Chroma 均为单实例，串行最稳）；
 * - 服务重启后通过 resumeInterruptedIndexing() 恢复中断任务。
 */

let running = false;
const queue = new Set();
const active = new Set();

function log(message, extra = '') {
  console.log(`[IndexQueue] ${message}${extra ? ` | ${extra}` : ''}`);
}

function enqueue(documentId) {
  queue.add(String(documentId));
  drain();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.size > 0) {
      const [documentId] = queue;
      queue.delete(documentId);
      if (active.has(documentId)) continue;
      active.add(documentId);
      try {
        await processOne(documentId);
      } finally {
        active.delete(documentId);
      }
    }
  } finally {
    running = false;
  }
}

async function extractContentIfMissing(doc) {
  if (String(doc.content || '').trim()) return false;
  if (!doc.localPath) return false;

  const filePath = path.isAbsolute(doc.localPath)
    ? doc.localPath
    : path.resolve(process.cwd(), doc.localPath);
  const ext = String(doc.fileType || '').toLowerCase();

  try {
    const content = String(await extractTextFromFile(filePath, ext) || '').trim();
    if (!content) throw new Error('文件内容为空');
    doc.content = content;
    await doc.save();
    return true;
  } catch (error) {
    doc.status = 'failed';
    doc.errorMessage = `正文解析失败：${error?.message || error}`;
    await doc.save().catch(() => {});
    log('正文解析失败', `documentId=${String(doc._id)}, message=${doc.errorMessage}`);
    return false;
  }
}

async function processOne(documentId) {
  const doc = await KnowledgeDocument.findById(documentId);
  if (!doc) {
    log('文档不存在，跳过', `documentId=${documentId}`);
    return;
  }
  if (doc.status === 'processed' && doc.chunkCount > 0) {
    log('已索引完成，跳过', `documentId=${documentId}`);
    return;
  }

  doc.status = 'processing';
  doc.errorMessage = '';
  await doc.save().catch(() => {});
  log('开始建立索引', `documentId=${documentId}, title=${doc.title}`);

  try {
    await extractContentIfMissing(doc);
    if (!String(doc.content || '').trim()) {
      if (doc.status !== 'failed') {
        doc.status = 'failed';
        doc.errorMessage = '文档缺少正文内容，无法建立索引';
        await doc.save().catch(() => {});
      }
      return;
    }

    await indexKnowledgeDocument(documentId, { manageStatus: false });

    const updated = await KnowledgeDocument.findById(documentId);
    if (updated) {
      updated.status = 'processed';
      updated.errorMessage = '';
      await updated.save();
    }
    log('索引完成', `documentId=${documentId}, chunks=${updated?.chunkCount || 0}`);
  } catch (error) {
    const updated = await KnowledgeDocument.findById(documentId);
    if (updated) {
      updated.status = 'failed';
      updated.errorMessage = String(error?.message || error);
      await updated.save().catch(() => {});
    }
    log('索引失败', `documentId=${documentId}, message=${error?.message || error}`);
  }
}

/** 服务启动时调用：把中断在 pending/processing 的文档重新入队。 */
export async function resumeInterruptedIndexing() {
  const stuck = await KnowledgeDocument.find({ status: { $in: ['pending', 'processing'] } })
    .select('_id title')
    .lean();
  for (const doc of stuck) enqueue(doc._id);
  if (stuck.length) {
    log('已恢复中断的索引任务', `count=${stuck.length}`);
  }
  return stuck.length;
}

export function enqueueIndexing(documentId) {
  enqueue(documentId);
}

export function getQueueState() {
  return { queued: queue.size, processing: active.size };
}
