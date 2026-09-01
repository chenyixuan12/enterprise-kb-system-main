import mongoose from 'mongoose';
import { config } from '../config/env.js';
import KnowledgeDocument from '../models/KnowledgeDocument.js';
import { indexKnowledgeDocument } from '../services/knowledgeIndexService.js';
import { deleteCollection } from '../services/chromaService.js';

// 更换 embedding 模型后的全量重建脚本：
// 1. 删除旧 Chroma collection（新旧模型维度/语义不一致，不能混用）
// 2. 对全部文档重新切块、向量化并写入（写入时自动重建 collection）
async function reindexAll() {
  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: config.mongodbConnectTimeout
  });

  console.log('[Reindex] 开始重建索引，先删除旧 Chroma collection');
  try {
    await deleteCollection();
    console.log('[Reindex] 旧 collection 已删除，写入时将自动重建');
  } catch (error) {
    console.error('[Reindex] 删除旧 collection 失败:', error?.message || error);
  }

  const docs = await KnowledgeDocument.find({}).sort({ createdAt: 1 }).lean();
  console.log('[Reindex] 待重建文档数量:', docs.length);

  let success = 0;
  let failed = 0;
  for (const doc of docs) {
    try {
      const { chunkCount } = await indexKnowledgeDocument(doc._id);
      success += 1;
      console.log(`[Reindex] OK ${success} | ${doc.title} | chunks=${chunkCount}`);
    } catch (error) {
      failed += 1;
      console.error(`[Reindex] FAIL | ${doc.title} | ${error?.message || error}`);
    }
  }

  console.log(`[Reindex] 完成：成功 ${success}，失败 ${failed}`);
  await mongoose.disconnect();
}

reindexAll().catch(async (error) => {
  console.error('[Reindex] 重建流程异常:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
