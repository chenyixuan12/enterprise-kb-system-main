import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 始终读取 backend/.env，避免从项目根目录启动时误加载根目录的 .env。
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export const config = {
  port: Number(process.env.SERVER_PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/db_enterprise_qa',
  mongodbConnectTimeout: Number(process.env.MONGODB_CONNECT_TIMEOUT || 30000),

  // JWT 签名鉴权
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  chromaBaseUrl: process.env.CHROMA_BASE_URL || 'http://127.0.0.1:8000',
  chromaTenant: process.env.CHROMA_TENANT || 'default_tenant',
  chromaDatabase: process.env.CHROMA_DATABASE || 'default_database',
  chromaCollection: process.env.CHROMA_COLLECTION || 'enterprise_knowledge_chunks',
  chromaTimeout: Number(process.env.CHROMA_TIMEOUT || 30000),

  // 大模型服务配置（支持 deepseek / alibaba / ollama）
  llmProvider: String(process.env.LLM_PROVIDER || 'deepseek').toLowerCase(),
  llmBaseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModelName: process.env.LLM_MODEL_NAME || 'deepseek-v4-pro',
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS || 2048),
  llmTemperature: Number(process.env.LLM_TEMPERATURE || 0.7),

  embeddingProvider: String(process.env.EMBEDDING_PROVIDER || 'openai').toLowerCase(),
  embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || '',
  embeddingApiKey: process.env.EMBEDDING_API_KEY || '',
  embeddingModelName: process.env.EMBEDDING_MODEL_NAME || 'text-embedding-v4',

  defaultUserPassword: process.env.DEFAULT_USER_PASSWORD || '123456',
  uploadFileDir: process.env.UPLOAD_FILE_DIR || './uploads',
  maxUploadSize: Number(process.env.MAX_UPLOAD_SIZE || 10485760)
};
