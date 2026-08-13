import mongoose from 'mongoose';

// 知识库分类模型
const categorySchema = new mongoose.Schema({
  // 分类名称（对应你的三大知识库）
  name: {
    type: String,
    required: true,
    unique: true, // 名称不重复
    trim: true
  },
  // 分类描述（可选，补充说明）
  description: String,
  // 状态：可用/不可用（对应课题要求）
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active' // 默认可用
  },
  // 创建时间
  createTime: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.models.KnowledgeCategory || mongoose.model('KnowledgeCategory', categorySchema);