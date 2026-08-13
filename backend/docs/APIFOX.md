# 用 Apifox 导入本项目接口文档

**不必在 Apifox 里从零手写接口。** 文档唯一来源是后端代码中的 `@openapi` 注解；Swagger UI 与 Apifox 都应消费同一份 OpenAPI。

## 1. 启动后端

```bash
cd backend
npm run dev
```

确认可访问：

- 文档页面：http://localhost:3000/api-docs
- OpenAPI JSON：http://localhost:3000/api-docs.json

## 2. 导入到 Apifox（推荐：文件导入）

若 URL 导入出现「抓取 URL 数据报错」，多半是**后端未启动**，或 Apifox（尤其云端）**访问不到本机 localhost**。请改用文件导入：

1. 打开 Apifox → 创建或进入项目
2. 选择 **导入** → **OpenAPI / Swagger** → **文件导入**
3. 选择仓库内文件：

   ```
   backend/docs/openapi.json
   ```

   完整路径示例：`d:\A_practice\cursor\enterprise-kb-system-main\backend\docs\openapi.json`
4. 确认导入成功后，应能看到 Auth、Users、Knowledge、QA 等分组

### 可选：URL 导入（需本机后端已启动）

```bash
cd backend
npm run dev
```

浏览器先确认能打开：http://localhost:3000/api-docs.json  

再在 Apifox 填同一地址。若仍报错，继续用上面的**文件导入**即可。

后续接口变更时：改代码注解 → 在 `backend` 目录执行  
`node -e "import('./src/config/swagger.js').then(m=>import('fs').then(fs=>fs.writeFileSync('docs/openapi.json',JSON.stringify(m.swaggerSpec,null,2))))"`  
重新生成 `openapi.json`，再在 Apifox 中重新导入。不要手工改 Apifox 里的接口定义。

## 3. 配置环境变量（推荐）

在 Apifox 项目中新建环境，例如「本地开发」：

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `baseUrl` | `http://localhost:3000` | 服务根地址 |
| `userId` | 登录后返回的 `_id` | 对应请求头 `x-user-id` |
| `userName` | `admin` | 对应请求头 `x-user-name` |
| `userRole` | `admin` | 对应请求头 `x-user-role` |

建议在项目 **全局请求头** 或环境中绑定：

| Header | 值 |
|--------|-----|
| `x-user-id` | `{{userId}}` |
| `x-user-name` | `{{userName}}` |
| `x-user-role` | `{{userRole}}` |

先调用 `POST /api/auth/login`（body：`{"username":"admin","password":"123456"}`），把返回的 `data._id` / `username` / `role` 填进环境变量。

## 4. SSE 问答接口说明

`POST /api/qa/ask` 返回 `text/event-stream`，Apifox 普通请求视图可能无法完整展示流式事件。调试时可：

- 查看 Swagger 文档首页中的 SSE 协议说明
- 使用文档中的 `curl -N` 示例
- 或在前端问答页直接验证

## 5. 和 Swagger UI 的分工

| 工具 | 用途 |
|------|------|
| http://localhost:3000/api-docs | 浏览文档、基础 Try it out |
| Apifox（导入 OpenAPI） | 更顺手的调试、环境变量、Mock、团队协作 |
| 代码 `@openapi` 注解 | 唯一维护源，勿在 Apifox 里重复手写 |
