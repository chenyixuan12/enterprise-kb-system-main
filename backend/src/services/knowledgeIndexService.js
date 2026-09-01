import crypto from 'crypto';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import KnowledgeChunk from '../models/KnowledgeChunk.js';
import { splitTextIntoChunks } from './documentService.js';
import { embedTexts } from './ollamaService.js';
import { deleteDocumentChunks, upsertChunks } from './chromaService.js';

// bge-large-zh-v1.5 上下文窗口为 512 token，切块适当调小，避免向量化时被截断。
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

function createContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 建立文档向量索引（切块 + 向量化 + 写入 Chroma）。
 * @param {string} documentId 文档 ID
 * @param {object} [options] 选项
 * @param {boolean} [options.manageStatus=true] 是否由本函数维护文档状态；
 *   后台队列调用时传入 false，由队列统一管理 pending/processing/processed/failed。
 */
export async function indexKnowledgeDocument(documentId, { manageStatus = true } = {}) {
  const document = await KnowledgeDocument.findById(documentId);
  if (!document) throw new Error(`知识文档不存在：${documentId}`);
  if (!document.categoryId) throw new Error('知识文档缺少所属知识库，无法建立索引');

  const chunks = splitTextIntoChunks(document.content, CHUNK_SIZE, CHUNK_OVERLAP);
  if (chunks.length === 0) throw new Error('知识文档正文为空，无法建立索引');

  if (manageStatus) document.status = 'pending';
  document.chunkCount = 0;
  document.vectorIds = [];
  document.errorMessage = '';
  await document.save();

  try {
    await deleteDocumentChunks(document._id);
    await KnowledgeChunk.deleteMany({ documentId: document._id });

    const chunkRecords = await KnowledgeChunk.insertMany(
      chunks.map((chunk) => ({
        documentId: document._id,
        categoryId: document.categoryId,
        chunkIndex: chunk.chunkIndex,
        title: document.title,
        content: chunk.content,
        contentHash: createContentHash(chunk.content),
        tokenCount: chunk.tokenCount,
        charCount: chunk.charCount,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        status: 'pending',
        metadata: { fileType: document.fileType, originalName: document.originalName }
      }))
    );

    const indexedChunks = [];
    const embeddingList = await embedTexts(chunkRecords.map((chunk) => chunk.content));
    if (
      embeddingList.length !== chunkRecords.length ||
      embeddingList.some((embedding) => !Array.isArray(embedding) || embedding.length === 0)
    ) {
      throw new Error('部分 Chunk 未生成有效向量');
    }

    chunkRecords.forEach((chunk, index) => {
      indexedChunks.push({
        ...chunk.toObject(),
        id: String(chunk._id),
        embedding: embeddingList[index]
      });
    });

    await upsertChunks(indexedChunks);

    // 索引成功后批量落库，避免每个 Chunk 一次 Mongo 写操作
    await KnowledgeChunk.bulkWrite(
      chunkRecords.map((chunk) => ({
        updateOne: {
          filter: { _id: chunk._id },
          update: { $set: { status: 'processed', vectorId: String(chunk._id) } }
        }
      })),
      { ordered: false }
    );

    document.chunkCount = indexedChunks.length;
    document.vectorIds = indexedChunks.map((chunk) => chunk.id);
    document.errorMessage = '';
    if (manageStatus) document.status = 'processed';
    await document.save();

    console.log('[KnowledgeIndex] 文档索引完成', {
      documentId: String(document._id),
      chunkCount: indexedChunks.length
    });

    return { document, chunkCount: indexedChunks.length };
  } catch (error) {
    if (manageStatus) {
      document.status = 'failed';
      document.errorMessage = String(error?.message || error);
      await document.save().catch(() => {});
    }
    console.error('[KnowledgeIndex] 文档索引失败', {
      documentId: String(document._id),
      message: error.message
    });
    throw error;
  }
}
