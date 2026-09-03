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
## 鉴权约定

调用 \`POST /api/auth/login\` 后，从响应中取得 \`accessToken\` 和 \`refreshToken\`。除登录、刷新令牌和健康检查以外的接口都需要携带：

\`Authorization: Bearer <accessToken>\`

访问令牌默认有效期为 30 分钟，失效后调用 \`POST /api/auth/refresh\` 使用 refresh token 换取新令牌。管理员接口还要求令牌中的角色为 \`admin\`。
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
  -H "Authorization: Bearer ACCESS_TOKEN" \\
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
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '登录接口返回的 access token'
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
