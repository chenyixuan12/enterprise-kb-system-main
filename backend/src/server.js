import app from './app.js';
import { connectMongo } from './utils/db.js';
import { config } from './config/env.js';
import { resumeInterruptedIndexing } from './services/knowledgeIndexQueue.js';

// 服务启动入口
async function bootstrap() {
  await connectMongo();
  const count = await resumeInterruptedIndexing().catch((error) => {
    console.error('恢复中断索引任务失败：', error?.message || error);
    return 0;
  });
  app.listen(config.port, () => {
    console.log(`后端服务已启动，端口：${config.port}${count ? `，已恢复 ${count} 个待索引文档` : ''}`);
  });
}

bootstrap().catch((error) => {
  console.error('服务启动失败：', error);
  process.exit(1);
});
