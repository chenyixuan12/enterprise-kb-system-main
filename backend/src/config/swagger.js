import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '..');

// swagger-jsdoc 在 Windows 下对反斜杠 glob 支持不佳，统一转为正斜杠
function toSwaggerGlob(...segments) {
  return path.join(srcDir, ...segments).replace(/\\/g, '/');
}

const authDoc = `
## 鉴权约定（教学演示版）

本项目**不使用 JWT/Session**，登录后由前端在每次请求中携带以下自定义请求头：

| 请求头 | 说明 | 示例 |
|--------|------|------|
| \`x-user-id\` | 用户 MongoDB \`_id\` | \`674a1b2c3d4e5f6789012345\` |
| \`x-user-name\` | 用户名 | \`admin\` |
| \`x-user-role\` | 角色，\`admin\` 或 \`user\` | \`admin\` |

**流程：**
1. 调用 \`POST /api/auth/login\` 获取用户信息
2. 前端将用户信息存入 \`localStorage.enterpriseUser\`
3. Axios/Fetch 拦截器自动注入上述三个请求头

**注意：** 请求头可被客户端伪造，仅适用于教学演示；生产环境应改用 JWT 等标准鉴权方案。

**权限说明：**
- 标注 \`admin\` 的接口需 \`x-user-role: admin\`
- 未标注的接口通常无需登录，但部分操作会读取 \`x-user-id\` 记录操作者
`;

const sseDoc = `
## SSE 流式问答协议

\`POST /api/qa/ask\` 返回 \`text/event-stream\`，而非普通 JSON。

**请求：**
\`\`\`json
{
  "question": "如何申请年假？",
  "categoryId": "674a1b2c3d4e5f6789012345",
  "sessionId": "可选，续接已有会话"
}
\`\`\`

**响应事件类型：**

| 事件 | 数据格式 | 说明 |
|------|----------|------|
| \`sources\` | \`Source[]\` | 召回的参考文档列表 |
| \`mismatch\` | \`{ message, suggestedKnowledge, suggestedKnowledgeId, recommendedKnowledge }\` | 当前知识库与问题不匹配时提示切换 |
| \`chunk\` | \`string\` | LLM 生成的文本片段（流式） |
| \`done\` | \`{ answer, sessionId, sources, recommendedKnowledge, ... }\` | 生成完成 |
| \`error\` | \`{ message }\` | 发生错误 |

**SSE 原始格式示例：**
\`\`\`
event: sources
data: [{"documentId":"...","title":"员工手册","snippet":"..."}]

event: chunk
data: "根据"

event: done
data: {"answer":"完整答案","sessionId":"...","sources":[...]}
\`\`\`

**curl 调试示例：**
\`\`\`bash
curl -N -X POST http://localhost:3000/api/qa/ask \\
  -H "Content-Type: application/json" \\
  -H "x-user-id: YOUR_USER_ID" \\
  -H "x-user-name: admin" \\
  -H "x-user-role: admin" \\
  -d '{"question":"如何请假？","categoryId":"CATEGORY_ID"}'
\`\`\`
`;

const responseFormatDoc = `
## 响应格式说明

各模块响应 envelope 不完全统一，对接时请注意：

| 模块 | 成功格式 | 错误格式 |
|------|----------|----------|
| auth / users / chat | \`{ message, data }\` | \`{ message, error? }\` |
| knowledge / qa / admin | \`{ code, message, data }\` | \`{ code, message, error? }\` |
| category | \`{ code, msg, data }\` | \`{ code, msg }\` |
`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '企业知识库问答系统 API',
      version: '1.0.0',
      description: `企业内部知识库问答后端接口文档。\n\n${authDoc}\n\n${sseDoc}\n\n${responseFormatDoc}`
    },
    servers: [
      { url: 'http://localhost:3000', description: '本地开发' }
    ],
    tags: [
      { name: 'Health', description: '健康检查' },
      { name: 'Auth', description: '登录认证' },
      { name: 'Users', description: '用户管理（admin）' },
      { name: 'Knowledge', description: '知识文档管理' },
      { name: 'QA', description: '流式问答（SSE）' },
      { name: 'Chat', description: '会话历史' },
      { name: 'Admin', description: '管理后台统计' },
      { name: 'Category', description: '知识库分类' }
    ],
    components: {
      securitySchemes: {
        UserId: {
          type: 'apiKey',
          in: 'header',
          name: 'x-user-id',
          description: '登录用户的 MongoDB _id'
        },
        UserName: {
          type: 'apiKey',
          in: 'header',
          name: 'x-user-name',
          description: '登录用户名'
        },
        UserRole: {
          type: 'apiKey',
          in: 'header',
          name: 'x-user-role',
          description: '用户角色：admin 或 user'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            code: { type: 'integer' },
            msg: { type: 'string' },
            error: { type: 'string' }
          }
        },
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            username: { type: 'string' },
            nickname: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user'] },
            status: { type: 'string', enum: ['active', 'disabled'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'admin' },
            password: { type: 'string', example: 'your_password' }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: '登录成功' },
            data: {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                username: { type: 'string' },
                nickname: { type: 'string' },
                role: { type: 'string' }
              }
            }
          }
        },
        AskRequest: {
          type: 'object',
          required: ['question'],
          properties: {
            question: { type: 'string', example: '如何申请年假？' },
            categoryId: { type: 'string', description: '知识库分类 ID（可选）' },
            sessionId: { type: 'string', description: '会话 ID，用于续接对话（可选）' }
          }
        },
        Source: {
          type: 'object',
          properties: {
            documentId: { type: 'string' },
            title: { type: 'string' },
            originalName: { type: 'string' },
            fileType: { type: 'string' },
            snippet: { type: 'string' },
            categoryId: { type: 'string', nullable: true }
          }
        },
        Category: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['active', 'inactive'] },
            docCount: { type: 'integer' }
          }
        }
      }
    }
  },
  apis: [
    toSwaggerGlob('app.js'),
    toSwaggerGlob('routes', '*.js'),
    toSwaggerGlob('controllers', '*.js')
  ]
};

export const swaggerSpec = swaggerJsdoc(options);
