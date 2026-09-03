import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import apiRouter from './routes/index.js';
import categoryRoutes from './routes/category.js';
import { swaggerSpec } from './config/swagger.js';
import { config } from './config/env.js';

const app = express();

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: '请求过于频繁，请稍后再试' }
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('不允许的跨域来源'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (config.apiDocsEnabled) {
  app.get('/api-docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
}
app.use('/api/category', apiRateLimiter, categoryRoutes);
app.use('/api', apiRateLimiter, apiRouter);

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
export default app;
