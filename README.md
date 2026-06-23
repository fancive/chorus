# Chorus / 对话场

> 一个由主持人控场的多角色 AI 对话空间。
> 和你想见的人物，在一个不会冷场的 AI 房间里对话。

用户、一个 **主持人（Host）** 和一个或多个 **角色（Role）** 在同一个房间里聊天：主持人控制节奏与转场，角色提供观点与个性，你可以随时发言或打断。AI 回复以打字机节奏流式呈现，结束后生成一份金句 / 立场对比的总结，并可生成只读分享链接。

设计文档见 [`docs/`](./docs)：[产品 PRD](./docs/mvp-prd.md) · [技术方案](./docs/tech-plan.md) · [部署](./docs/deploy.md)。

## 技术栈

- **Next.js 15** (App Router, RSC) + React 18 + Tailwind
- **SSE 流式** + `AbortController` 跨请求中断（barge-in）
- **Drizzle ORM** over **libSQL/SQLite**（本地文件，生产用 Turso）
- **OpenAI**（或任意 OpenAI 兼容端点）+ **Zod** 结构化输出
- **Zustand** 客户端状态 · **Vitest** 测试

## 快速开始

```bash
cp .env.example .env.local      # 填入 OPENAI_API_KEY（见下）
npm install
npm run db:migrate              # 在 ./chorus.db 上建表 + 索引
npm run dev                     # http://localhost:3000
```

> 缺少必需环境变量时，相关 API 会返回 `503 service_unavailable`（详细缺失项写在服务端日志里，不外泄）。

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是* | 除非所有 `CHORUS_PROVIDER_*` 都切走，否则必填 |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容端点（DashScope / Volcengine Ark 等） |
| `OPENAI_MODEL_HOST` / `_ROLE` / `_SUMMARY` | 否 | 各角色模型，默认 `gpt-4o-mini` |
| `CHORUS_PROVIDER_HOST` / `_ROLE` / `_SUMMARY` | 否 | provider 实现，默认 `openai` |
| `CHORUS_DB_PATH` | 否 | 本地 SQLite 路径，默认 `./chorus.db`（设了 `TURSO_*` 后忽略） |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | 生产 | 用 Turso 时两者都要设 |

完整模板见 [`.env.example`](./.env.example)。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` / `build` / `start` | 开发 / 构建 / 生产启动 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` / `test:watch` | Vitest |
| `npm run db:generate` | 由 schema 生成 SQL migration |
| `npm run db:migrate` | 应用 migration |
| `npm run db:studio` | Drizzle Studio |
| `npm run replay` | 回放调度决策（`scripts/replay-scheduler.ts`） |

## 架构速览

```
app/                   Next.js 路由
  api/room/[id]/turn   核心：SSE 流式回合（调度 → 发言 → 持久化）
  room/[id]            房间页 · summary 总结页 · share 分享页
lib/
  scheduler/run.ts     回合状态机：谁发言、流式、中断、持久化
  scheduler/runtime.ts 进程内 active-generation / turn-lock 注册表
  prompts/             主持人 / 角色 / 总结 prompt 与调度决策 schema
  transcript/          发给各 LLM 的消息投影
  db/                  Drizzle schema + repo
  client/              Zustand store · SSE 解析 · 打字机节奏
```

一个用户可见回合通常是 **两次 LLM 调用**：主持人「调度」决定下一个发言者，再由该发言者「发言」流式输出；冷启动由主持人开场。

## 已知约束（重要）

当前中断 / 抢占 / 防重调度依赖 `lib/scheduler/runtime.ts` 里的 **进程内内存态**（active-generation 与 turn-lock 两张 `Map`）。这意味着：

- **假设单实例长生命周期 Node 进程**。横向扩容 / serverless 多实例下，"中断请求落到 A 实例、SSE 跑在 B 实例" 会让打断静默失效。
- **Vercel serverless 可跑，但有取舍**：SSE 单连接有最长时长上限，且多实例下上面的中断假设不成立。低并发单用户基本不会撞到；面向多用户公开部署前，应把这两张 `Map` 换成 Redis 后端（`SETNX` 做锁 / Pub-Sub 派发中断），DB 换 Turso/Postgres。
- 重连 / 刷新 / 进程重启留下的 "streaming" 孤儿消息会在下次进房或下个回合开始时被自动 reconcile 成 "interrupted"，不会卡死会话。

生产部署步骤见 [`docs/deploy.md`](./docs/deploy.md)。
