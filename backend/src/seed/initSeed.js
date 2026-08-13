import mongoose from 'mongoose';
import { config } from '../config/env.js';
import User from '../models/User.js';
import KnowledgeDocument from '../models/KnowledgeDocument.js';

// 初始化测试数据：适合入门学习与本地调试
async function seed() {
  await mongoose.connect(config.mongodbUri);

  await Promise.all([User.deleteMany({}), KnowledgeDocument.deleteMany({})]);

  // 通过 User.create 触发 pre-save 钩子自动哈希密码
  const admin = await User.create({
    username: 'admin',
    password: config.defaultUserPassword,
    role: 'admin',
    nickname: '系统管理员'
  });

  const user = await User.create({
    username: 'user1',
    password: config.defaultUserPassword,
    role: 'user',
    nickname: '测试用户'
  });

  await KnowledgeDocument.insertMany([
    {
      title: '公司制度手册',
      filename: 'company_policy.txt',
      originalName: 'company_policy.txt',
      fileType: 'txt',
      content: '公司报销流程、请假流程、会议室预约规则等。',
      uploadedBy: admin._id,
      status: 'processed',
      vectorIds: ['seed_doc_1_0']
    },
    {
      title: 'IT 使用规范',
      filename: 'it_guideline.pdf',
      originalName: 'it_guideline.pdf',
      fileType: 'pdf',
      content: '密码安全、设备申请、软件安装规范。',
      uploadedBy: user._id,
      status: 'processed',
      vectorIds: ['seed_doc_2_0']
    }
  ]);

  console.log('初始化测试数据完成');
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
