import mongoose from 'mongoose';

// 知识文档模型：记录上传、解析与向量化状态
const knowledgeDocumentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: String, default: '' },
    // 浏览器计算出的完整文件 MD5，用于秒传和分片上传的唯一标识。
    uploadHash: { type: String, index: true, unique: true, sparse: true },
    localPath: { type: String, default: '' },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgeCategory',
      default: null
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    chunkCount: { type: Number, default: 0 },
    content: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'processing', 'processed', 'failed'], default: 'pending' },
    errorMessage: { type: String, default: '' },
    vectorIds: { type: [String], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model('KnowledgeDocument', knowledgeDocumentSchema);
