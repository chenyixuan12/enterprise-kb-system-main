import { Router } from 'express';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import multer from 'multer';
import mongoose from 'mongoose';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import { requireRole, getRequestUser } from '../utils/auth.js';
import { generateAnswer } from '../services/ollamaService.js';
import { docxToPreviewHtml } from '../services/documentService.js';
import { enqueueIndexing } from '../services/knowledgeIndexQueue.js';
import { deleteDocumentChunks } from '../services/chromaService.js';
import KnowledgeChunk from '../models/KnowledgeChunk.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
console.log('[KnowledgeRoutes] uploadsDir:', uploadsDir);
const allowedExts = new Set(['txt', 'pdf', 'docx', 'md']);
const maxSizeBytes = 10 * 1024 * 1024;
const chunkSizeBytes = 5 * 1024 * 1024;
const chunksDir = path.join(uploadsDir, '.chunks');

console.log('[KnowledgeRoutes] module loaded');

function decodeUtf8Filename(encodedName) {
  try {
    if (encodedName && !/[\u4e00-\u9fa5]/.test(encodedName)) {
      const decoded = decodeURIComponent(escape(encodedName));
      if (/[\u4e00-\u9fa5]/.test(decoded)) return decoded;
    }
    return encodedName;
  } catch {
    return encodedName;
  }
}

function buildSafeStoredFilename(originalName = '') {
  const decodedName = decodeUtf8Filename(originalName);
  const ext = path.extname(decodedName).toLowerCase();
  const safeExt = ext && /^[.a-z0-9]+$/i.test(ext) ? ext : '';
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSizeBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace('.', '').toLowerCase();
    if (!allowedExts.has(ext)) return cb(new Error('仅支持 txt、pdf、docx、md 文件上传'));
    cb(null, true);
  }
});

// 单个分片始终受限于 5MB；完整文件不进入 Node 的内存。
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: chunkSizeBytes + 1024 },
  fileFilter: (_req, _file, cb) => cb(null, true)
});

function logInfo(message, extra = '') {
  console.log(`[Upload] ${message}${extra ? ` | ${extra}` : ''}`);
}

function logError(message, error) {
  console.error(`[Upload][Error] ${message}`, error?.stack || error?.message || error);
}

function buildFileSizeText(sizeInBytes) {
  const sizeKb = Math.max(1, Math.round(Number(sizeInBytes || 0) / 1024));
  return `${sizeKb} KB`;
}

function isValidFileHash(fileHash) {
  return typeof fileHash === 'string' && /^[a-f0-9]{32}$/i.test(fileHash);
}

function getChunkDirectory(fileHash) {
  return path.join(chunksDir, fileHash.toLowerCase());
}

function getChunkPath(fileHash, chunkIndex) {
  return path.join(getChunkDirectory(fileHash), `${chunkIndex}.part`);
}

async function getUploadedChunkIndexes(fileHash) {
  try {
    const entries = await fs.readdir(getChunkDirectory(fileHash), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d+\.part$/.test(entry.name))
      .map((entry) => Number(entry.name.replace('.part', '')))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function removeChunks(fileHash) {
  await fs.rm(getChunkDirectory(fileHash), { recursive: true, force: true });
}

/**
 * 保存上传的文件记录并入队后台索引，接口立即返回。
 * 文件正文解析、切块、向量化均在队列中异步完成。
 */
async function saveUploadedFile({ savedPath, originalName, fileSize, title, categoryId, uploadedBy, uploadHash }) {
  const ext = path.extname(originalName).replace('.', '').toLowerCase();

  const doc = await KnowledgeDocument.create({
    title,
    filename: path.basename(savedPath),
    originalName,
    fileType: ext,
    fileSize: buildFileSizeText(fileSize),
    localPath: path.relative(process.cwd(), savedPath),
    categoryId,
    chunkCount: 0,
    content: '',
    uploadedBy: uploadedBy || null,
    uploadHash,
    status: 'pending',
    errorMessage: '',
    vectorIds: []
  });

  enqueueIndexing(doc._id);
  logInfo('文档已保存并入队后台索引', `documentId=${doc._id}, title=${title}`);

  return KnowledgeDocument.findById(doc._id).populate('categoryId', '_id name').lean();
}

/** 已存在的文档：已完成的秒传，未完成/失败的重启索引。 */
async function reuseOrRestartIndex(existing) {
  if (existing.status === 'processed' && Number(existing.chunkCount || 0) > 0) {
    return false;
  }
  await KnowledgeDocument.updateOne(
    { _id: existing._id },
    { $set: { status: 'pending', errorMessage: '' } }
  );
  enqueueIndexing(existing._id);
  return true;
}

async function safeDeleteFile(filePath) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

function normalizeCategoryId(categoryId) {
  if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
    return new mongoose.Types.ObjectId(categoryId);
  }
  return null;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMatchScore(text, keywords) {
  const normalized = normalizeText(text);
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (normalized.includes(kw)) score += 1;
  }
  return score;
}

function scoreDocument(doc, keywords, categoryId) {
  let score = 0;
  const title = normalizeText(doc.title);
  const originalName = normalizeText(doc.originalName);
  const content = normalizeText(doc.content || '');

  if (categoryId && String(doc.categoryId || '') === String(categoryId)) score += 2;
  score += buildMatchScore(title, keywords) * 8;
  score += buildMatchScore(originalName, keywords) * 5;
  score += buildMatchScore(content, keywords) * 2;

  return score;
}

/**
 * @openapi
 * /api/knowledge/ai-complete:
 *   post:
 *     tags: [Knowledge]
 *     summary: AI 内容补全
 *     description: 根据已有正文和光标上下文，由 LLM 续写知识文档内容。仅管理员可用。
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               cursorContext: { type: string, description: '光标附近上下文' }
 *               categoryId: { type: string }
 *     responses:
 *       200:
 *         description: 补全成功
 *       400:
 *         description: 正文不能为空
 *       403:
 *         description: 无权限
 *       502:
 *         description: LLM 服务异常
 */
router.post('/ai-complete', requireRole('admin'), async (req, res) => {
  try {
    const { title = '', content = '', cursorContext = null, categoryId = '' } = req.body || {};
    const parsedCursorContext = typeof cursorContext === 'string'
      ? (() => {
          try {
            return JSON.parse(cursorContext);
          } catch {
            return { raw: cursorContext };
          }
        })()
      : (cursorContext || {});

    const beforeText = String(parsedCursorContext?.beforeText || '').trim();
    const afterText = String(parsedCursorContext?.afterText || '').trim();
    const plainTextLength = Number(parsedCursorContext?.plainTextLength || 0);

    if (!String(content || '').trim()) {
      return res.status(400).json({ code: 400, message: '正文内容不能为空' });
    }

    const prompt = `你是企业知识库写作助手，任务是“续写”而不是“改写”。请严格基于给定内容，在当前光标处继续补全文本。

标题：${title || '未填写'}
所属分类：${categoryId || '未指定'}
正文总长度：${plainTextLength}

当前光标前文本：
${beforeText || '（空）'}

当前光标后文本：
${afterText || '（空）'}

当前完整正文：
${content}

输出要求：
1. 只输出可直接插入到光标处的续写内容。
2. 不要输出标题、序号前缀、解释、说明、分析或多余寒暄。
3. 不要重复“当前光标前文本”的内容。
4. 如果是句子中间，直接续写；如果更适合段落或列表，也可以继续写，但不要另起无关话题。
5. 尽量避免以逗号、句号、冒号、连接词或空白开头。`;

    const rawCompletion = String(await generateAnswer(prompt) || '');
    const completion = rawCompletion
      .replace(/^\s+/, '')
      .replace(/^[，,。．\.：:；;、\-—]+\s*/, '')
      .trim();

    console.log('[AI Complete] raw length:', rawCompletion.length, 'clean length:', completion.length, 'preview:', rawCompletion.slice(0, 120));

    return res.json({
      code: 200,
      message: '补全成功',
      data: { completion, rawCompletion }
    });
  } catch (error) {
    logError('AI补全失败', error);
    const statusCode = /api key|authorization|model|connect|fetch|timeout/i.test(error?.message || '') ? 502 : 500;
    return res.status(statusCode).json({ code: statusCode, message: 'AI补全失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge:
 *   get:
 *     tags: [Knowledge]
 *     summary: 获取知识文档列表
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *         description: 按知识库分类筛选
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/', async (req, res) => {
  const { categoryId } = req.query;
  const filter = {};
  if (categoryId) filter.categoryId = categoryId;
  const docs = await KnowledgeDocument.find(filter).sort({ createdAt: -1 }).populate('categoryId', '_id name').lean();
  res.json({ data: docs });
});

/**
 * @openapi
 * /api/knowledge/{id}:
 *   get:
 *     tags: [Knowledge]
 *     summary: 获取知识文档详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 查询成功
 *       404:
 *         description: 文档不存在
 *       500:
 *         description: 服务器错误
 */
router.get('/:id', async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ code: 404, message: '文档不存在' });
    res.json({ code: 200, message: '查询成功', data: doc });
  } catch (error) {
    res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/{id}/status:
 *   get:
 *     tags: [Knowledge]
 *     summary: 获取文档处理状态
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 查询成功，返回 status、chunkCount、preview 等
 *       404:
 *         description: 文档不存在
 *       500:
 *         description: 服务器错误
 */
router.get('/:id/status', async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ code: 404, message: '文档不存在' });
    res.json({
      code: 200,
      message: '查询成功',
      data: {
        documentId: String(doc._id),
        status: doc.status,
        title: doc.title,
        originalName: doc.originalName,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        chunkCount: doc.chunkCount,
        errorMessage: doc.errorMessage || '',
        preview: (doc.content || '').replace(/\s+/g, ' ').trim().slice(0, 500)
      }
    });
  } catch (error) {
    res.status(500).json({ code: 500, message: '查询失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/{id}/retry:
 *   post:
 *     tags: [Knowledge]
 *     summary: 重新建立文档索引
 *     description: 对 failed / pending / processing 状态的文档重置后重新入队索引。仅管理员可操作。
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 已重新入队
 *       403:
 *         description: 无权限
 *       404:
 *         description: 文档不存在
 *       500:
 *         description: 服务器错误
 */
router.post('/:id/retry', requireRole('admin'), async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ code: 404, message: '文档不存在' });

    doc.status = 'pending';
    doc.errorMessage = '';
    doc.chunkCount = 0;
    await doc.save();

    enqueueIndexing(doc._id);
    return res.json({ code: 200, message: '已重新加入索引队列', documentId: String(doc._id) });
  } catch (error) {
    logError('重新建立索引失败', error);
    res.status(500).json({ code: 500, message: '重新建立索引失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/{id}/file:
 *   get:
 *     tags: [Knowledge]
 *     summary: 获取文档原始文件
 *     description: 返回上传时保存的原始文件（pdf / docx / md / txt / 图片），用于前端按文件类型预览
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 文件内容
 *       404:
 *         description: 文件不存在
 *       500:
 *         description: 服务器错误
 */
router.get('/:id/file', async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ code: 404, message: '文档不存在' });

    let filePath = '';
    if (doc.localPath) {
      filePath = path.isAbsolute(doc.localPath)
        ? doc.localPath
        : path.resolve(process.cwd(), doc.localPath);
    }
    if (!filePath) {
      filePath = path.join(uploadsDir, doc.filename || '');
    }

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ code: 404, message: '原始文件不存在' });
    }

    const mimeMap = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      md: 'text/markdown; charset=utf-8',
      txt: 'text/plain; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp'
    };
    const ext = path.extname(doc.filename || doc.originalName || '').replace('.', '').toLowerCase();
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const inlineExts = new Set(['pdf', 'md', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
    const disposition = inlineExts.has(ext) ? 'inline' : 'attachment';
    const safeOriginalName = String(doc.originalName || doc.filename || 'file').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
    const encodedName = encodeURIComponent(safeOriginalName);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    res.sendFile(filePath);
  } catch (error) {
    logError('获取原始文件失败', error);
    res.status(500).json({ code: 500, message: '获取原始文件失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/{id}/preview:
 *   get:
 *     tags: [Knowledge]
 *     summary: 获取文档可视化预览（docx 转 HTML，保留内嵌图片）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: HTML 预览内容
 *       404:
 *         description: 文件不存在
 *       500:
 *         description: 服务器错误
 */
router.get('/:id/preview', async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ code: 404, message: '文档不存在' });

    let filePath = '';
    if (doc.localPath) {
      filePath = path.isAbsolute(doc.localPath)
        ? doc.localPath
        : path.resolve(process.cwd(), doc.localPath);
    }
    if (!filePath) {
      filePath = path.join(uploadsDir, doc.filename || '');
    }

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ code: 404, message: '原始文件不存在' });
    }

    if (String(doc.fileType || '').toLowerCase() === 'docx') {
      const html = await docxToPreviewHtml(filePath);
      return res.json({ code: 200, message: '预览生成成功', data: { html } });
    }

    return res.json({ code: 200, message: '预览生成成功', data: { html: '' } });
  } catch (error) {
    logError('生成文档预览失败', error);
    res.status(500).json({ code: 500, message: '生成文档预览失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/{id}:
 *   delete:
 *     tags: [Knowledge]
 *     summary: 删除知识文档
 *     description: 仅管理员可操作，同时删除本地文件
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 *       403:
 *         description: 无权限
 *       404:
 *         description: 文档不存在
 *       500:
 *         description: 服务器错误
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const doc = await KnowledgeDocument.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: '文档不存在' });
    await deleteDocumentChunks(doc._id).catch((error) => logError('删除 Chroma 向量失败', error));
    await KnowledgeChunk.deleteMany({ documentId: doc._id });
    await safeDeleteFile(path.resolve(doc.localPath || ''));
    res.json({ message: '删除成功', data: doc });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/manual:
 *   post:
 *     tags: [Knowledge]
 *     summary: 手动录入知识文档
 *     description: 仅管理员可操作，直接以文本形式创建文档
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content, categoryId]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               categoryId: { type: string }
 *               originalName: { type: string }
 *               fileType: { type: string }
 *               fileSize: { type: string }
 *     responses:
 *       201:
 *         description: 知识新增成功
 *       400:
 *         description: 参数错误
 *       403:
 *         description: 无权限
 *       500:
 *         description: 服务器错误
 */
router.post('/manual', requireRole('admin'), async (req, res) => {
  try {
    logInfo('进入手动录入接口');

    const currentUser = getRequestUser(req);
    const { title, content, categoryId, originalName, fileType, fileSize } = req.body || {};

    if (!title?.trim()) return res.status(400).json({ code: 400, message: '标题不能为空' });
    if (!content?.trim()) return res.status(400).json({ code: 400, message: '正文内容不能为空' });
    if (!categoryId) return res.status(400).json({ code: 400, message: '所属知识库为必选项' });

    const normalizedCategoryId = normalizeCategoryId(categoryId);
    if (!normalizedCategoryId) return res.status(400).json({ code: 400, message: '所属知识库格式不正确' });

    const safeTitle = title.trim();
    const safeOriginalName = originalName?.trim() || `${safeTitle}.md`;
    const safeFileType = fileType?.trim() || 'md';
    const safeFileSize = fileSize?.trim() || `${Math.max(1, Math.round(Buffer.byteLength(content, 'utf8') / 1024))} KB`;
    const safeContent = content.trim();

    const doc = await KnowledgeDocument.create({
      title: safeTitle,
      filename: safeOriginalName,
      originalName: safeOriginalName,
      fileType: safeFileType,
      fileSize: safeFileSize,
      localPath: '',
      categoryId: normalizedCategoryId,
      chunkCount: 0,
      content: safeContent,
      uploadedBy: currentUser.userId || null,
      status: 'pending',
      errorMessage: '',
      vectorIds: []
    });

    enqueueIndexing(doc._id);

    const populatedDoc = await KnowledgeDocument.findById(doc._id).populate('categoryId', '_id name').lean();

    return res.status(201).json({
      code: 201,
      message: '知识已保存，正在后台建立索引',
      documentId: String(doc._id),
      data: { ...populatedDoc, _id: String(populatedDoc._id) }
    });
  } catch (error) {
    logError('手动新增知识失败', error);
    return res.status(500).json({ code: 500, message: '知识新增失败', error: error.message });
  }
});

/**
 * @openapi
 * /api/knowledge/upload:
 *   post:
 *     tags: [Knowledge]
 *     summary: 上传知识文档
 *     description: |
 *       支持 txt、pdf、docx、md 格式，单文件最大 10MB。
 *       使用 multipart/form-data，字段 file 为文件，title 和 categoryId 为表单字段。
 *       无需 admin 权限，但会记录 x-user-id 作为上传者。
 *     security:
 *       - UserId: []
 *         UserName: []
 *         UserRole: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, categoryId]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               title:
 *                 type: string
 *                 description: 文档标题，默认取文件名
 *               categoryId:
 *                 type: string
 *                 description: 所属知识库分类 ID（必填）
 *     responses:
 *       201:
 *         description: 文件上传成功，文档已入库
 *       400:
 *         description: 文件或分类参数错误
 *       500:
 *         description: 服务器错误
 */
/**
 * 查询文件是否已经完成，或返回已经成功保存的分片索引，供刷新页面后续传。
 */
router.post('/upload/check', async (req, res) => {
  try {
    const { fileHash, fileName, totalChunks } = req.body || {};
    if (!isValidFileHash(fileHash)) return res.status(400).json({ code: 400, message: 'fileHash 必须是 32 位 MD5' });
    if (!fileName || !Number.isInteger(Number(totalChunks)) || Number(totalChunks) <= 0) {
      return res.status(400).json({ code: 400, message: 'fileName 和 totalChunks 参数不正确' });
    }
    const existing = await KnowledgeDocument.findOne({ uploadHash: fileHash.toLowerCase() }).lean();
    if (existing) {
      const restarted = await reuseOrRestartIndex(existing);
      return res.json({
        code: 200,
        message: restarted ? '文件已存在，正在重新建立索引' : '文件已存在，已秒传',
        data: { uploaded: true, documentId: String(existing._id), uploadedChunks: [], restarted }
      });
    }
    const uploadedChunks = (await getUploadedChunkIndexes(fileHash)).filter((index) => index < Number(totalChunks));
    return res.json({ code: 200, message: '可继续上传', data: { uploaded: false, uploadedChunks } });
  } catch (error) {
    logError('检查分片上传状态失败', error);
    return res.status(500).json({ code: 500, message: '检查上传状态失败', error: error.message });
  }
});

/** 保存一个分片。重复提交同一索引是幂等的，适合网络重试。 */
router.post('/upload/chunk', chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { fileHash, chunkIndex, totalChunks } = req.body || {};
    const index = Number(chunkIndex);
    const total = Number(totalChunks);
    if (!isValidFileHash(fileHash) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total || total <= 0) {
      return res.status(400).json({ code: 400, message: '分片参数不正确' });
    }
    if (!req.file) return res.status(400).json({ code: 400, message: '请提供分片文件' });
    if (req.file.size > chunkSizeBytes) return res.status(413).json({ code: 413, message: '单个分片不能超过 5MB' });

    const chunkDir = getChunkDirectory(fileHash);
    await fs.mkdir(chunkDir, { recursive: true });
    const targetPath = getChunkPath(fileHash, index);
    try {
      await fs.access(targetPath);
    } catch {
      const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, req.file.buffer);
      await fs.rename(temporaryPath, targetPath);
    }
    return res.status(201).json({ code: 201, message: '分片上传成功', data: { chunkIndex: index } });
  } catch (error) {
    logError('上传分片失败', error);
    return res.status(500).json({ code: 500, message: '上传分片失败', error: error.message });
  }
});

/** 验证、合并分片，然后复用原有的知识文档解析和索引流程。 */
router.post('/upload/merge', async (req, res) => {
  let savedPath = '';
  try {
    const { fileHash, fileName, fileSize, totalChunks, categoryId: rawCategoryId, title: rawTitle } = req.body || {};
    const total = Number(totalChunks);
    if (!isValidFileHash(fileHash) || !fileName || !Number.isInteger(total) || total <= 0 || !Number.isFinite(Number(fileSize)) || Number(fileSize) < 0) {
      return res.status(400).json({ code: 400, message: '合并参数不正确' });
    }
    const decodedOriginalName = decodeUtf8Filename(fileName);
    const ext = path.extname(decodedOriginalName).replace('.', '').toLowerCase();
    if (!allowedExts.has(ext)) return res.status(400).json({ code: 400, message: '仅支持 txt、pdf、docx、md 文件上传' });
    const categoryId = normalizeCategoryId(rawCategoryId);
    if (!categoryId) return res.status(400).json({ code: 400, message: '所属知识库为必选项' });

    const existing = await KnowledgeDocument.findOne({ uploadHash: fileHash.toLowerCase() }).lean();
    if (existing) {
      const restarted = await reuseOrRestartIndex(existing);
      await removeChunks(fileHash);
      return res.json({
        code: 200,
        message: restarted ? '文件已存在，正在重新建立索引' : '文件已存在，已秒传',
        documentId: String(existing._id),
        data: { ...existing, _id: String(existing._id), restarted }
      });
    }

    const uploadedIndexes = await getUploadedChunkIndexes(fileHash);
    const missingChunks = Array.from({ length: total }, (_, index) => index).filter((index) => !uploadedIndexes.includes(index));
    if (missingChunks.length) return res.status(409).json({ code: 409, message: '仍有分片未上传完成', data: { missingChunks } });

    await fs.mkdir(uploadsDir, { recursive: true });
    savedPath = path.join(uploadsDir, buildSafeStoredFilename(decodedOriginalName));
    const hash = createHash('md5');
    const output = await fs.open(savedPath, 'w');
    try {
      for (let index = 0; index < total; index += 1) {
        const chunk = await fs.readFile(getChunkPath(fileHash, index));
        hash.update(chunk);
        await output.write(chunk);
      }
    } finally {
      await output.close();
    }
    if (hash.digest('hex').toLowerCase() !== fileHash.toLowerCase()) {
      await safeDeleteFile(savedPath);
      savedPath = '';
      return res.status(400).json({ code: 400, message: '文件校验失败，请重新上传' });
    }

    const currentUser = getRequestUser(req);
    const title = String(rawTitle || '').trim() || path.basename(decodedOriginalName, path.extname(decodedOriginalName));
    let doc;
    try {
      doc = await saveUploadedFile({ savedPath, originalName: decodedOriginalName, fileSize: Number(fileSize), title, categoryId, uploadedBy: currentUser.userId, uploadHash: fileHash.toLowerCase() });
    } catch (error) {
      // 并发的 merge 请求可能刚好创建了同一 MD5 文档，直接将其视为秒传成功。
      if (error?.code === 11000) {
        doc = await KnowledgeDocument.findOne({ uploadHash: fileHash.toLowerCase() }).populate('categoryId', '_id name').lean();
        if (doc) {
          await safeDeleteFile(savedPath);
          savedPath = '';
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    await removeChunks(fileHash);
    return res.status(201).json({
      code: 201,
      message: '文件上传成功，正在后台建立索引',
      documentId: String(doc._id),
      data: { ...doc, _id: String(doc._id) }
    });
  } catch (error) {
    if (savedPath && !error.documentId) await safeDeleteFile(savedPath);
    if (error.documentId) await removeChunks(req.body?.fileHash).catch(() => {});
    logError('合并分片失败', error);
    return res.status(error.statusCode || 500).json({ code: error.statusCode || 500, message: error.message || '合并分片失败', documentId: error.documentId, error: error.message });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  let savedPath = '';
  try {
    logInfo('开始处理上传请求');
    logInfo('请求体字段', `keys=${Object.keys(req.body || {}).join(',')}`);

    const file = req.file;
    if (!file) {
      logError('未接收到文件');
      return res.status(400).json({ code: 400, message: '请先上传文件' });
    }

    const decodedOriginalName = decodeUtf8Filename(file.originalname);
    const ext = path.extname(decodedOriginalName).replace('.', '').toLowerCase();
    if (!allowedExts.has(ext)) {
      logError('文件类型不被允许', ext);
      return res.status(400).json({ code: 400, message: '仅支持 txt、pdf、docx、md 文件上传' });
    }

    const currentUser = getRequestUser(req);
    const title = req.body?.title?.trim() || path.basename(decodedOriginalName, path.extname(decodedOriginalName));
    const categoryId = normalizeCategoryId(req.body?.categoryId || null);

    if (!categoryId) {
      return res.status(400).json({ code: 400, message: '所属知识库为必选项' });
    }

    try {
      await fs.access(uploadsDir);
    } catch {
      await fs.mkdir(uploadsDir, { recursive: true });
    }

    const storedFilename = buildSafeStoredFilename(decodedOriginalName);
    savedPath = path.join(uploadsDir, storedFilename);
    await fs.writeFile(savedPath, file.buffer);

    // 正文解析与向量化统一在后台队列中完成，接口立即返回
    const doc = await KnowledgeDocument.create({
      title,
      filename: storedFilename,
      originalName: decodedOriginalName,
      fileType: ext,
      fileSize: buildFileSizeText(file.size),
      localPath: path.relative(process.cwd(), savedPath),
      categoryId,
      chunkCount: 0,
      content: '',
      uploadedBy: currentUser.userId || null,
      status: 'pending',
      errorMessage: '',
      vectorIds: []
    });

    enqueueIndexing(doc._id);
    logInfo(`文档已保存到MongoDB并进入后台索引队列，文档ID：${doc._id}`);

    const populatedDoc = await KnowledgeDocument.findById(doc._id).populate('categoryId', '_id name').lean();

    return res.status(201).json({
      code: 201,
      message: '文件上传成功，正在后台建立索引',
      documentId: String(doc._id),
      data: {
        ...populatedDoc,
        _id: String(populatedDoc._id)
      }
    });
  } catch (error) {
    if (savedPath) {
      await safeDeleteFile(savedPath);
    }
    logError('上传流程发生异常', error);
    return res.status(500).json({ code: 500, message: '数据库写入失败', error: error.message });
  }
});

export default router;
