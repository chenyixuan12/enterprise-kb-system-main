import mongoose from 'mongoose';

const qaLogSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, default: '' },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeCategory' },
  categoryName: { type: String, default: '' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sources: { type: [String], default: [] },
  sessionId: { type: String, default: '' },
  responseTime: { type: Number, default: 0 }, // 响应时间（毫秒）
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  errorMessage: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('QALog', qaLogSchema);
