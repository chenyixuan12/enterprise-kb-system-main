import fs from 'fs/promises';
import path from 'path';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import { extractTextFromFile, splitTextIntoChunks } from './documentService.js';

function logInfo(message, extra = '') {
  console.log(`[UploadWorker] ${message}${extra ? ` | ${extra}` : ''}`);
}

function logError(message, error) {
  console.error(`[UploadWorker][Error] ${message}`, error?.message || error);
}

async function safeDeleteFile(filePath) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

export async function processKnowledgeUpload(documentId) {
  const doc = await KnowledgeDocument.findById(documentId);
  if (!doc) {
    throw new Error(`文档不存在：${documentId}`);
  }

  const savedFilePath = path.resolve(process.cwd(), doc.localPath || '');

  try {
    logInfo('开始后台处理文档', `documentId=${documentId}, title=${doc.title}, type=${doc.fileType}`);
    logInfo('读取文件路径', savedFilePath);

    // 检查文件是否存在
    try {
      await fs.access(savedFilePath);
    } catch {
      throw new Error(`文件不存在：${savedFilePath}`);
    }

    const ext = String(doc.fileType || '').toLowerCase();
    logInfo('开始解析文件', `ext=${ext}`);
    
    const content = await extractTextFromFile(savedFilePath, ext);
    if (!content || !content.trim()) {
      doc.status = 'failed';
      doc.errorMessage = '文件内容为空';
      await doc.save();
      logError('文件内容为空', doc.title);
      return;
    }

    logInfo('文件解析完成', `文本长度=${content.length}`);
    const chunks = splitTextIntoChunks(content, 500, 100);
    if (!chunks.length) {
      doc.status = 'failed';
      doc.errorMessage = '文件分块失败';
      await doc.save();
      logError('文件分块失败', doc.title);
      return;
    }

    doc.content = content;
    doc.chunkCount = chunks.length;
    doc.status = 'processed';
    await doc.save();
    logInfo('后台处理完成', `documentId=${documentId}`);
  } catch (error) {
    const errorMsg = error.message || String(error);
    logError('后台处理失败', `documentId=${documentId}, error=${errorMsg}`);
    if (doc) {
      doc.status = 'failed';
      doc.errorMessage = errorMsg;
      await doc.save().catch(() => {});
    }
    await safeDeleteFile(savedFilePath);
    throw error;
  }
}
