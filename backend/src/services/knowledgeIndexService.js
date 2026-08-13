import crypto from 'crypto';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import KnowledgeChunk from '../models/KnowledgeChunk.js';
import { splitTextIntoChunks } from './documentService.js';
import { embedQuery } from './ollamaService.js';
import { deleteDocumentChunks, upsertChunks } from './chromaService.js';

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

function createContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function indexKnowledgeDocument(documentId) {
  const document = await KnowledgeDocument.findById(documentId);
  if (!document) throw new Error(`知识文档不存在：${documentId}`);
  if (!document.categoryId) throw new Error('知识文档缺少所属知识库，无法建立索引');

  const chunks = splitTextIntoChunks(document.content, CHUNK_SIZE, CHUNK_OVERLAP);
  if (chunks.length === 0) throw new Error('知识文档正文为空，无法建立索引');

  document.status = 'pending';
  document.chunkCount = 0;
  document.vectorIds = [];
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
    for (const chunk of chunkRecords) {
      const embedding = await embedQuery(chunk.content);
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error(`Chunk ${chunk.chunkIndex + 1} 未生成有效向量`);
      }

      chunk.vectorId = String(chunk._id);
      chunk.status = 'processed';
      await chunk.save();
      indexedChunks.push({
        ...chunk.toObject(),
        id: String(chunk._id),
        embedding
      });
    }

    await upsertChunks(indexedChunks);

    document.chunkCount = indexedChunks.length;
    document.vectorIds = indexedChunks.map((chunk) => chunk.id);
    document.status = 'processed';
    await document.save();

    console.log('[KnowledgeIndex] 文档索引完成', {
      documentId: String(document._id),
      chunkCount: indexedChunks.length
    });

    return { document, chunkCount: indexedChunks.length };
  } catch (error) {
    document.status = 'failed';
    await document.save().catch(() => {});
    console.error('[KnowledgeIndex] 文档索引失败', {
      documentId: String(document._id),
      message: error.message
    });
    throw error;
  }
}
