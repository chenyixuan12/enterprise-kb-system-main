import mongoose from 'mongoose';

const knowledgeChunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgeDocument',
      required: true,
      index: true
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgeCategory',
      required: true,
      index: true
    },
    chunkIndex: {
      type: Number,
      required: true,
      min: 0
    },
    title: {
      type: String,
      default: '',
      trim: true
    },
    content: {
      type: String,
      required: true,
      trim: true
    },
    contentHash: {
      type: String,
      required: true,
      index: true
    },
    vectorId: {
      type: String,
      default: '',
      index: true
    },
    tokenCount: {
      type: Number,
      default: 0,
      min: 0
    },
    charCount: {
      type: Number,
      default: 0,
      min: 0
    },
    startOffset: {
      type: Number,
      default: 0,
      min: 0
    },
    endOffset: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending',
      index: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  { timestamps: true }
);

knowledgeChunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });
knowledgeChunkSchema.index({ categoryId: 1, status: 1 });
knowledgeChunkSchema.index({ title: 'text', content: 'text' });

export default mongoose.models.KnowledgeChunk || mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
