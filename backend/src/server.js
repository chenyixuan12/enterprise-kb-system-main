import app from './app.js';
import { connectMongo } from './utils/db.js';
import { config } from './config/env.js';

// 服务启动入口
async function bootstrap() {
  await connectMongo();
  app.listen(config.port, () => {
    console.log(`后端服务已启动，端口：${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error('服务启动失败：', error);
  process.exit(1);
});
