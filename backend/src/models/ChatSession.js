import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    sources: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { _id: false }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeCategory', default: null },
    title: { type: String, default: '' },
    lastQuestion: { type: String, default: '' },
    lastAnswer: { type: String, default: '' },
    messageCount: { type: Number, default: 0 },
    history: { type: [chatMessageSchema], default: [] }
  },
  { timestamps: true }
);

chatSessionSchema.index({ userId: 1, updatedAt: -1 });
chatSessionSchema.index({ categoryId: 1, updatedAt: -1 });

export default mongoose.model('ChatSession', chatSessionSchema);
