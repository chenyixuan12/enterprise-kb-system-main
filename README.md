# Enterprise AIKB
# 当前版本：V1 — Naive RAG 主链路 + 轻量级 Hybrid Search + 规则 Reranking。
企业内部知识库智能问答系统。项目基于 RAG（检索增强生成）实现企业制度、产品指南等文档的可追溯问答，支持文档上传、语义切块、本地向量化、Chroma 检索、流式回答与引用来源展示。



## 功能概览

- **知识库管理**：按分类管理企业知识库及其文档。
- **文档解析**：支持 `txt`、`md`、`pdf`、`docx` 文件上传，以及手动录入富文本内容。
- **自动索引**：文档入库后自动解析、按自然语义边界切块、生成 embedding 并写入向量库。
- **RAG 问答**：按当前选择的知识库召回相关 Chunk，将上下文交给大模型生成答案。
- **轻量混合检索**：向量召回结合标题/正文关键词规则重排，降低跨主题误召回。
- **来源追溯**：回答下方展示命中文档、文本片段与相关度。
- **流式输出**：通过 SSE 将大模型回答实时推送到前端。
- **会话与日志**：保存对话历史、问答日志与回答来源。
- **知识库推荐**：当前库相关性低时提供候选知识库切换建议。
- **AI 补全**：编辑知识内容时可调用大模型辅助补全文本。

## RAG 架构

```text
上传文件 / 手动录入
        │
        ▼
文本解析（TXT / MD / PDF / DOCX）
        │
        ▼
语义边界切块（Chunk + Overlap）
        │
        ├── MongoDB：KnowledgeDocument / KnowledgeChunk 元数据
        │
        ▼
Ollama 本地 Embedding（nomic-embed-text）
        │
        ▼
Chroma：保存 Chunk 向量、文本与来源元数据

用户提问
        │
        ▼
问题 Embedding
        │
        ▼
Chroma TopK Chunk 检索（按 knowledge category 过滤）
        │
        ▼
标题/正文关键词轻量重排（Reranking）
        │
        ▼
问题 + 上下文 → LLM 流式生成 → 来源片段展示
```

## 技术栈

### 前端

- Vue 3
- Vite
- Element Plus
- Axios
- ECharts
- ESLint + Prettier

### 后端与数据服务

- Node.js + Express
- MongoDB + Mongoose
- Chroma（向量数据库）
- Ollama（本地 Embedding 服务）
- 外部 OpenAI-compatible LLM API（回答生成 / AI 补全）
- Multer、`pdf-parse`、Mammoth（文件上传与文本解析）

## 项目结构

```text
enterprise-kb-system-main/
├─ frontend/                         # Vue 前端
│  └─ src/
│     ├─ views/                      # 页面级视图
│     ├─ components/                 # 通用组件
│     └─ api/                        # HTTP / SSE 接口封装
├─ backend/                          # Express 后端
│  └─ src/
│     ├─ config/                     # 环境配置
│     ├─ models/                     # MongoDB 模型
│     ├─ routes/                     # API 路由
│     ├─ services/
│     │  ├─ documentService.js       # 文本提取与语义切块
│     │  ├─ knowledgeIndexService.js # 文档索引管线
│     │  ├─ chromaService.js         # Chroma 向量读写
│     │  └─ ollamaService.js         # Embedding / LLM 调用
│     └─ utils/
├─ chroma-data/                      # 本地 Chroma 数据目录（运行后生成）
└─ README.md
```

## 本地运行

### 1. 准备环境

确保本机已安装：

- Node.js 18+
- npm
- MongoDB
- Ollama
- Python 3.10+ 与 Miniconda / Conda（仅用于本地运行 Chroma）

### 2. 启动 MongoDB

确保 MongoDB 服务运行，并可通过默认地址连接：

```text
mongodb://localhost:27017
```

### 3. 启动 Ollama 与 Embedding 模型

安装 Ollama 后，拉取 embedding 模型：

```powershell
ollama pull nomic-embed-text
```

Windows 下 Ollama 通常会作为后台服务运行。若未运行，可执行：

```powershell
ollama serve
```

验证模型是否可用：

```powershell
ollama list
```

### 4. 启动 Chroma

使用 Conda 创建隔离环境：

```powershell
conda create -n chroma-rag python=3.11 -y
conda activate chroma-rag
pip install chromadb
```

在项目根目录启动服务：

```powershell
chroma run --host 127.0.0.1 --port 8000 --path .\chroma-data
```

保持此终端运行。另开一个终端验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v2/heartbeat
```

### 5. 配置后端环境变量

创建 `backend/.env`，参考以下配置。不要提交真实 API Key。

```env
SERVER_PORT=3000
NODE_ENV=development

MONGODB_URI=mongodb://localhost:27017/db_enterprise_qa
MONGODB_CONNECT_TIMEOUT=30000

# Chroma 本地服务
CHROMA_BASE_URL=http://127.0.0.1:8000
CHROMA_TENANT=default_tenant
CHROMA_DATABASE=default_database
CHROMA_COLLECTION=enterprise_knowledge_chunks
CHROMA_TIMEOUT=30000

# 本地 Embedding
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://127.0.0.1:11434
EMBEDDING_API_KEY=
EMBEDDING_MODEL_NAME=nomic-embed-text

# 回答生成模型：按供应商接口填写
LLM_PROVIDER=aliyun
LLM_BASE_URL=https://your-api-host/compatible-mode
LLM_API_KEY=your_api_key_here
LLM_MODEL_NAME=your_model_name
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.7

DEFAULT_USER_PASSWORD=123456
UPLOAD_FILE_DIR=./uploads
MAX_UPLOAD_SIZE=10485760
```

> `LLM_BASE_URL` 应只填写供应商文档要求的 **Base URL**，不要把 `/chat/completions` 写入其中；后端会自动补全请求路径。不同供应商的地址与模型名请以官方文档为准。

### 6. 安装依赖并启动

在项目根目录执行：

```powershell
npm install
npm run dev
```

该命令会并行启动：

- 后端：`http://localhost:3000`
- 前端：通常为 `http://localhost:5173`

也可以分别启动：

```powershell
cd backend
npm install
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

## 使用流程

1. 进入知识库管理页面，创建或选择知识库分类。
2. 上传文件或手动录入知识内容。
3. 后端自动执行：文本解析 → 切块 → Ollama embedding → MongoDB Chunk 保存 → Chroma 向量索引。
4. 在问答页选择对应知识库并提出问题。
5. 查看流式回答、命中的来源文档与片段。

## 当前版本的 RAG 定位

当前项目不是只包含“向量检索 + LLM”的纯 Naive RAG，而是：

```text
Naive RAG + 分类过滤 + 轻量 Hybrid Search + 规则型 Reranking
```

当前版本适合标准文本知识库问答场景。后续可按实际问题逐步演进：

- **V2：跨知识库 Router / Adaptive RAG**：通过全局 Chunk 检索与知识库聚合评分，提高知识库切换建议准确性。
- **V3：Multi-Query RAG / Query Rewrite / HyDE**：改善口语化、同义词和不完整问题的召回能力。
- **V4：独立 Reranker + Corrective RAG**：加入 Cross-Encoder 重排、相关性校验和低置信度重检索，降低错误召回与幻觉。
- **V5：多模态、GraphRAG 或 Agentic RAG**：根据图表、跨文档推理和多数据源需求选择性扩展。

## 常用脚本

### 根目录

```bash
npm run dev
```

### 前端

```bash
npm run dev
npm run build
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

### 后端

```bash
npm run dev
npm start
npm run seed
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## 注意事项

- `backend/.env` 中的 LLM API Key 属于敏感信息，不要提交到 Git、截图或粘贴到公开渠道。
- 更换 Embedding 模型后，旧向量不应继续混用；请清理或新建 Chroma Collection，并对所有文档重新建立索引。
- Chroma、Ollama、MongoDB 与后端需要同时运行，文档索引和问答检索才能正常工作。
- `chroma-data/`、上传文件和 `.env` 均属于本地运行数据，建议加入 `.gitignore`。
