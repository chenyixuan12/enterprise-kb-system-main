import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import apiRouter from './routes/index.js';
import categoryRoutes from './routes/category.js';
import { swaggerSpec } from './config/swagger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 中间件：支持跨域、JSON 以及表单提交
// 关键：必须放在最前面，并且让 cors 中间件统一处理所有 OPTIONS 预检请求
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
// OpenAPI JSON：供 Apifox / Postman 等工具导入（文档仍以代码中的 @openapi 注解为准）
app.get('/api-docs.json', (_req, res) => {
  res.json(swaggerSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.use('/api', apiRouter);

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: 健康检查
 *     description: 用于确认后端服务是否正常运行
 *     responses:
 *       200:
 *         description: 服务正常
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: ok
 */
app.get('/health', (_req, res) => {
  res.json({ message: 'ok' });
});
//挂载知识库分类路由
app.use('/api/category', categoryRoutes);

export default app;
