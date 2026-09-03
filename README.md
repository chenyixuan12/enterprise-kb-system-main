# Enterprise AIKB

企业内部知识库智能问答系统。基于 RAG（检索增强生成）实现企业制度、产品指南等文档的可追溯问答，支持文档上传、语义切块、本地向量化、Chroma 检索、流式回答与引用来源展示。

**当前版本：V2（完整 RAG 主链路）**  
✅ 文档解析与索引 / 混合检索（BM25 + 向量 + RRF 融合） / 可选 Cross-Encoder 重排 / 答案证据判断与跨知识库自动路由 / 流式 SSE 问答 / 会话与日志 / Swagger 接口文档 / 角色权限管理

## 功能概览

- **知识库管理**：按分类管理企业知识库及其文档。
- **文档解析**：支持 `txt`、`md`、`pdf`、`docx` 文件上传，以及手动录入富文本内容。
- **自动索引**：文档入库后自动解析、按自然语义边界切块、生成 embedding 并写入向量库。
- **RAG 问答**：按当前选择的知识库召回相关 Chunk，将上下文交给大模型生成答案。
- **混合检索（BM25 + 向量 + RRF + 可选 Rerank）**：Chroma 稠密向量与 BM25 稀疏检索双路召回，先用 RRF 融合，再通过可选 Cross-Encoder 对候选片段重排，降低跨主题误召回并提升相关性。
- **答案证据判断**：通过稠密相似度、重排分数、关键词命中率、BM25 得分多维度判定当前知识库是否有可靠答案。
- **跨知识库自动路由**：当前知识库无可靠答案时，自动检索最相关的其他知识库并直接回答，无需手动切换。
- **来源追溯**：回答下方展示命中文档、文本片段与相关度。
- **流式输出**：通过 SSE 将大模型回答实时推送到前端。
- **会话与日志**：保存对话历史、问答日志与回答来源。
- **AI 补全**：编辑知识内容时可调用大模型辅助补全文本。
- **角色权限管理**：管理员与普通用户两级权限，支持用户管理。
- **Swagger 接口文档**：`/api-docs` 提供交互式 API 文档，支持在线测试。

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
问题 Embedding + BM25 分词
        │
        ├── Chroma 稠密向量召回（按 knowledge category 过滤）
        └── MongoDB Chunk BM25 稀疏召回
                │
                ▼
        RRF 融合排序 → TopK 候选
                │
                ▼
     ┌─ 可选 Cross-Encoder 重排 ─┐
     │（Aliyun DashScope / Jina / │
     │  Xinference 等）           │
     └──────────┬─────────────────┘
                │
                ▼
    答案证据判断（多维度阈值判定）
        │
        ├── 有可靠答案 → 当前知识库回答
        └── 无可靠答案 → 跨知识库自动路由 → 重新召回
                │
                ▼
        问题 + 上下文 → LLM 流式生成 → 来源片段展示
```

## 技术栈

### 前端

- Vue 3 + Vue Router 4
- Vite 8
- Element Plus 2
- Axios
- ECharts 6 + vue-echarts
- ESLint + Prettier
- Sass
- SparkMD5（文件分片上传校验）

### 后端与数据服务

- Node.js 20+ Express 5
- MongoDB 7 + Mongoose
- Chroma（向量数据库）
- Ollama（本地 Embedding 服务）
- 外部 LLM API（支持 DeepSeek / Alibaba / Ollama 等 OpenAI-compatible 接口）
- BM25 中文分词检索（segmentit）
- Cross-Encoder Rerank（支持 Aliyun DashScope / Jina / Xinference 等）
- Multer、`pdf-parse`、Mammoth（文件上传与文本解析）
- Swagger (swagger-jsdoc + swagger-ui-express) 接口文档
- Helmet + express-rate-limit 安全加固
- JSON Web Token 鉴权

## 项目结构

```text
enterprise-kb-system-main/
├─ frontend/                         # Vue 前端
│  └─ src/
│     ├─ views/                      # 页面级视图（10 个页面）
│     ├─ components/                 # 通用组件
│     └─ api/                        # HTTP / SSE 接口封装
├─ backend/                          # Express 后端
│  └─ src/
│     ├─ config/                     # 环境配置 / Swagger 定义
│     ├─ controllers/                # 分类控制器
│     ├─ models/                     # MongoDB 模型（User / Category / Document / Chunk / ChatSession / QALog）
│     ├─ routes/                     # API 路由
│     ├─ services/
│     │  ├─ documentService.js       # 文本提取与语义切块
│     │  ├─ knowledgeIndexService.js # 文档索引管线
│     │  ├─ knowledgeIndexQueue.js   # 索引队列调度
│     │  ├─ knowledgeUploadProcessor.js # 上传文件处理
│     │  ├─ chromaService.js         # Chroma 向量读写
│     │  ├─ bm25Service.js           # BM25 稀疏检索 + RRF 融合
│     │  ├─ rerankService.js         # Cross-Encoder 重排（Aliyun / Jina / 通用）
│     │  └─ ollamaService.js         # Embedding / LLM 调用
│     ├─ scripts/                    # reindexAll 等运维脚本
│     ├─ seed/                       # 种子数据初始化
│     └─ utils/                      # 鉴权 / 数据库连接
├─ chroma-data/                      # 本地 Chroma 数据目录（运行后生成）
├─ docs/                             # 项目文档与笔记
├─ docker-compose.yml                # 一键部署配置
├─ .env.example                      # Docker Compose 环境变量模板
└─ README.md
```

## 本地运行

> 若不想手动安装 Node / MongoDB / Ollama / Chroma，可直接使用 Docker 一键部署，见「[Docker 部署](#docker-部署)」。

### 1. 准备环境

确保本机已安装：

- Node.js 20+
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

# 浏览器跨域白名单。生产环境只填写实际前端域名，多个域名以英文逗号分隔。
CORS_ORIGINS=http://localhost:5173,http://localhost
# 生产环境默认关闭接口文档；仅在受控内网排障时设为 true。
API_DOCS_ENABLED=true

# MongoDB 连接地址
MONGODB_URI=mongodb://localhost:27017/db_enterprise_qa
MONGODB_CONNECT_TIMEOUT=30000

# JWT 签名密钥（必填，请使用足够长的随机字符串）
JWT_SECRET=please_change_me_to_a_long_random_string
# Token 有效期，默认 7 天
JWT_EXPIRES_IN=7d

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

# 回答生成模型（支持 deepseek / alibaba / ollama）
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your_api_key_here
LLM_MODEL_NAME=deepseek-v4-pro
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.7

# 重排（Rerank）配置（可选）：RRF 融合后对候选片段做交叉编码器精排
# RERANK_API_KEY 留空时复用 LLM_API_KEY（百炼场景同账号）
RERANK_ENABLED=false
RERANK_PROVIDER=aliyun
RERANK_BASE_URL=https://dashscope.aliyuncs.com
RERANK_API_KEY=
RERANK_MODEL_NAME=gte-rerank-v2
RERANK_THRESHOLD=0.3
RERANK_TIMEOUT=30000

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

### 7. 访问接口文档

后端启动后，访问 `http://localhost:3000/api-docs` 查看 Swagger 交互式 API 文档，支持在线测试。接口文档仅在 `API_DOCS_ENABLED=true` 时可用。

## Docker 部署

项目提供 `docker-compose.yml`，一键编排全部服务（MongoDB、Ollama、Chroma、后端、前端），无需本机安装 Node / Python / MongoDB 等运行时。

### 1. 环境要求

- 已安装 Docker Engine（20.10+）与 Docker Compose v2（`docker compose version` 可验证）。
- 首次构建需要能够访问 npm registry 与 Docker Hub 的网络。
- 建议至少 4GB 可用内存（Ollama 推理 + Chroma 向量库）。

### 2. 配置环境变量

复制根目录 `.env.example` 为 `.env`，填写真实配置：

```powershell
Copy-Item .env.example .env
```

打开 `.env`，重点填写以下项：

```env
# LLM API Key（必填，用于回答生成）
LLM_API_KEY=your_api_key_here
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL_NAME=deepseek-v4-pro

# MongoDB 管理员账号（必填，使用唯一账号和强密码）
MONGO_INITDB_ROOT_USERNAME=kbadmin
MONGO_INITDB_ROOT_PASSWORD=replace_with_a_long_random_password

# JWT 签名密钥（必填，上线前务必改成足够长的随机字符串）
JWT_SECRET=please_change_me_to_a_long_random_string
# Token 有效期，默认 7 天
JWT_EXPIRES_IN=7d

# 浏览器跨域白名单；生产环境填写实际前端域名
CORS_ORIGINS=http://localhost:5173,http://localhost
# 公网环境保持关闭；只在受控内网排障时设为 true
API_DOCS_ENABLED=false

# 本地 Ollama Embedding（Docker 内无需修改地址，compose 会自动替换为容器地址）
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://127.0.0.1:11434
EMBEDDING_MODEL_NAME=nomic-embed-text

# 重排（Rerank）配置（可选）：RERANK_API_KEY 留空时复用 LLM_API_KEY
RERANK_ENABLED=false
RERANK_PROVIDER=aliyun
RERANK_BASE_URL=https://dashscope.aliyuncs.com
RERANK_API_KEY=
RERANK_MODEL_NAME=gte-rerank-v2
RERANK_THRESHOLD=0.3
RERANK_TIMEOUT=30000

DEFAULT_USER_PASSWORD=123456
```

> 密码中不要包含 `@`、`:`、`/`、`?` 等 URL 特殊字符，否则 MongoDB 连接串会解析失败。
>
> `docker-compose.yml` 中的 `environment` 会覆盖 `.env` 里的容器内连接地址（如 `MONGODB_URI`、`CHROMA_BASE_URL`、`EMBEDDING_BASE_URL`），因此 `.env` 中这些项保持默认即可。

### 3. 构建并启动

在项目根目录执行：

```powershell
docker compose up -d --build
```

启动后依次等待 MongoDB、Ollama、Chroma 健康检查通过，再启动后端与前端。查看状态：

```powershell
docker compose ps
```

所有服务均变为 `healthy` 后即可访问：

- 前端页面：<http://localhost>
- 后端 API：<http://localhost:3000/health>（返回 `{"message":"ok"}` 即正常）
- 接口文档：<http://localhost:3000/api-docs>（仅 `API_DOCS_ENABLED=true` 时可用）

### 4. 拉取 Embedding 模型（首次必须）

进入 Ollama 容器拉取 embedding 模型，否则文档索引与问答检索会失败：

```powershell
docker compose exec ollama ollama pull nomic-embed-text
```

验证模型已就绪：

```powershell
docker compose exec ollama ollama list
```

### 5. 初始化种子数据（可选）

如需预置默认分类与管理员账号，可执行：

```powershell
docker compose exec backend npm run seed
```

默认管理员密码由 `.env` 中 `DEFAULT_USER_PASSWORD` 指定。

### 6. 常用运维命令

| 操作 | 命令 |
| --- | --- |
| 查看所有服务状态 | `docker compose ps` |
| 查看后端日志 | `docker compose logs -f backend` |
| 查看前端日志 | `docker compose logs -f frontend` |
| 重启单个服务 | `docker compose restart backend` |
| 更新代码后重新构建 | `docker compose up -d --build` |
| 停止全部服务 | `docker compose down` |
| 停止并清空数据卷（谨慎，会删除全部数据） | `docker compose down -v` |

### 7. 端口与数据持久化

| 服务 | 容器名 | 对外端口 | 说明 |
| --- | --- | --- | --- |
| 前端（nginx） | `enterprise-frontend` | `80`（唯一对外暴露） | 公网访问入口 |
| 后端（Node） | `enterprise-backend` | `127.0.0.1:3000` | 仅本机可访问，用于调试 |
| MongoDB | `enterprise-mongo` | 不映射 | 仅容器内网，已启用账号密码认证 |
| Ollama | `enterprise-ollama` | `127.0.0.1:11434` | 仅本机可访问 |
| Chroma | `enterprise-chroma` | `127.0.0.1:8000` | 仅本机可访问 |

数据卷由 Docker 持久化管理，`docker compose down` 不会删除数据；如需彻底清理使用 `docker compose down -v`。

### 8. 注意事项

- `.env` 中的 `LLM_API_KEY`、`MONGO_INITDB_ROOT_PASSWORD`、`JWT_SECRET` 属于敏感信息，请勿提交到 Git。
- 公网部署必须在负载均衡器或反向代理处终止 HTTPS，仅放行 `443`；如保留 `80`，只用于跳转 HTTPS。当前 Compose 提供应用 HTTP 服务，不负责证书签发和续期。
- 上传文件与 Chroma 数据属于运行数据，必须通过卷备份，不应提交到 Git。
- `CORS_ORIGINS` 只填写允许访问 API 的前端域名；`API_DOCS_ENABLED` 在公网环境保持 `false`。
- 更换 `EMBEDDING_MODEL_NAME` 后，旧向量不能混用，需清理 Chroma 数据卷并对所有文档重新索引。
- 首次 `docker compose up -d` 需要拉取多个基础镜像并构建前端，耗时较长属正常现象。
- 若前端部署在服务器上需改端口，修改 `docker-compose.yml` 中 `frontend.ports` 的宿主端口映射（如 `8080:80`）。

## 使用流程

1. 进入知识库管理页面，创建或选择知识库分类。
2. 上传文件或手动录入知识内容。
3. 后端自动执行：文本解析 → 切块 → Ollama embedding → MongoDB Chunk 保存 → Chroma 向量索引。
4. 在问答页选择对应知识库并提出问题。
5. 查看流式回答、命中的来源文档与片段。

## 当前版本的 RAG 定位

当前项目已实现完整的 Naive RAG 主链路，并在此基础上加入了：

```text
分类过滤 + Chroma 稠密检索 + BM25 稀疏检索 + RRF 融合 + 可选 Cross-Encoder 重排 + 证据判断 + 跨知识库自动路由
```

当前版本定位为 **V2（自适应 RAG 雏形）**，适合标准文本知识库问答场景。后续可按实际问题逐步演进：

- **V1 ✅ 已完成**：Naive RAG 主链路 + 文档解析/切块/向量化 + 混合检索 + 流式回答与来源追溯。
- **V2 ✅ 已实现自动路由**：当前知识库无可靠答案时，自动检索最相关的其他知识库并直接回答（保留跨知识库聚合评分与切换建议）。
- **V3（未做）**：Multi-Query RAG / Query Rewrite / HyDE，改善口语化、同义词和不完整问题的召回能力。
- **V4 ✅ 已完成**：独立 Cross-Encoder 重排 + 答案证据判断。
  - 支持 Aliyun DashScope / Jina / Xinference 等 OpenAI-compatible 重排服务。
  - 重排后通过稠密相似度、重排分数、关键词命中率、BM25 得分多维度判定是否值得回答。
  - 未配置重排服务或调用失败时自动回退为 RRF 排序。
- **V5（未做）**：多模态、GraphRAG 或 Agentic RAG。

## 常用脚本

### 根目录

```bash
npm run dev          # 并行启动前后端
npm run start        # 并行启动（后端生产 + 前端开发）
npm run build        # 构建前端
npm run seed         # 初始化种子数据
npm run deploy       # docker compose up -d --build
npm run deploy:stop  # docker compose down
npm run deploy:logs  # docker compose logs -f
```

### 前端

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建
npm run preview      # 预览构建产物
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复
npm run format       # Prettier 格式化
npm run format:check # Prettier 格式检查
```

### 后端

```bash
npm run dev          # 开发服务器（热重载）
npm start            # 生产启动
npm run seed         # 种子数据初始化
npm run reindex      # 全量重新索引所有文档
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复
npm run format       # Prettier 格式化
npm run format:check # Prettier 格式检查
```

## 注意事项

- `backend/.env` 中的 LLM API Key 属于敏感信息，不要提交到 Git、截图或粘贴到公开渠道。
- 更换 Embedding 模型后，旧向量不应继续混用；请清理或新建 Chroma Collection，并对所有文档重新建立索引。
- Chroma、Ollama、MongoDB 与后端需要同时运行，文档索引和问答检索才能正常工作。
- `chroma-data/`、上传文件和 `.env` 均属于本地运行数据，建议加入 `.gitignore`。

