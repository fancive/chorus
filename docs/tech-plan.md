# Chorus / 对话场 — 技术方案 (v1)

> 配套文档：[`mvp-prd.md`](./mvp-prd.md)
> 本文档回答"怎么实现"，不重复"做什么"。

---

## 0. 定位

- 概念级技术方案，不是详细设计；状态机、schema、接口写到"够开工"为止
- 范围：MVP v1 的实现选型与关键架构边界
- 决策原则：选最不容易在第一次真实打断时散架的方案，不追求 v2 一次到位

---

## 1. 部署与运行时

**决定：单实例长生命周期 Node 服务**。

- 候选部署：VPS / Fly.io / Railway / 自建。不上 Vercel serverless
- 理由：v1 强依赖 `AbortController + 流式中断 + partial 持久化`，serverless 多实例下做不干净
- 反过来约束：DB 选型、流式协议、状态机持久化都按"单进程内有内存状态可信"假设

> **若未来需要多实例**：DB 换 Postgres / 把 active stream 状态外放到 Redis / SSE 改 Pub-Sub。这是 v2 的事。

---

## 2. 数据存储

**决定：SQLite + Drizzle ORM**。

### 表结构（概念级，字段名实现时可调）

```text
users           id, nickname, browser_token, created_at
sessions        id, user_id, mode, role_config_json, status,
                ai_streak, last_user_at, created_at, ended_at
messages        id, session_id, actor (user|host|role),
                content, status (streaming|completed|interrupted),
                revision, created_at
generations     id, session_id, message_id, provider, model,
                purpose (scheduler|speaker|summary), status,
                started_at, ended_at
summaries       id, session_id, payload_json, created_at
```

### 关键约定

- `summaries` 是独立表，不是 `sessions` 的字段——后续要支持重新生成 / 版本化
- `messages.status` 包含 `interrupted`，partial 文本保留入库
- `generations` 记录每次 LLM 调用，便于成本统计和故障复盘
- `revision` 单调递增，前端按 revision 应用 SSE delta

---

## 3. 话轮调度状态机

**决定：粗粒度 room state machine 持久化，细粒度 token stream 仅在内存。**

### 状态

```
await_user            等待用户发言
scheduling            主持人正在决策下一发言者
speaking_host         主持人正在 streaming 发言
speaking_role         角色正在 streaming 发言
interrupting          检测到用户消息，正在中止 + flush partial
summarizing           正在生成总结
ended
```

### 事件

```
SESSION_STARTED
USER_MESSAGE
IDLE_TIMEOUT             冷场触发主持人接话
SCHEDULE_RESOLVED        scheduler 调用返回
STREAM_STARTED
STREAM_DELTA
STREAM_DONE
INTERRUPT_REQUESTED
STREAM_ABORTED
END_SESSION
SUMMARY_DONE
GENERATION_FAILED
```

### 转换规则

```
await_user
  -- USER_MESSAGE | IDLE_TIMEOUT --> scheduling

scheduling (短调用，主持人 LLM 输出 next_speaker)
  -- next_speaker=await_user --> await_user
  -- next_speaker=host       --> speaking_host
  -- next_speaker=role       --> speaking_role

speaking_host | speaking_role
  -- STREAM_DONE             --> scheduling
  -- INTERRUPT_REQUESTED     --> interrupting

interrupting
  -- STREAM_ABORTED + user msg persisted --> scheduling

scheduling | speaking_*
  -- END_SESSION             --> summarizing

summarizing
  -- SUMMARY_DONE            --> ended
```

### 硬规则（不交给 LLM）

- `ai_streak >= 3`：scheduler 强制返回 `await_user`，不再让 AI 连发
- 用户输入框始终激活；`USER_MESSAGE` 在任意 `speaking_*` 状态下立即触发 `INTERRUPT_REQUESTED`
- 用户超过 8 秒无响应（`last_user_at + 8s`）：`IDLE_TIMEOUT` 触发主持人接话

---

## 4. 流式协议与中断

**决定：API route + Server-Sent Events (SSE)，前端 `AbortController`。**

### 协议形态

- 客户端 POST `/api/room/[id]/turn`，请求体含可选 `interrupt_generation_id`
- 服务端返回 `text/event-stream`
- Event 类型：`schedule | message_start | delta | message_end | status_bar | error`

### 中断流程

```
1. 用户发新消息 → 前端 abort 当前 SSE fetch + 发起新 POST
2. 服务端读 interrupt_generation_id：
   - 调用 provider abort
   - flush partial token 进 messages 表（status=interrupted）
   - persist 用户消息
   - 进入 scheduling
3. 新 SSE 流响应新一轮调度结果
```

### 关键不变量

- 用户输入永远先写库再触发调度（绝不丢消息）
- partial assistant text 要么写入 `interrupted` 状态，要么完全丢弃（`< 20 字符或半个词`时丢）
- scheduler 看到 `interrupted=true` 标记会做相应应对（不强行恢复中断的话题）

---

## 5. 一致性原则

**核心一句话：`never emit to client before durably appended`。**

### Streaming 写入流程

```
1. 创建 assistant message row (status=streaming, content="", revision=0)
2. provider 推 token → 服务端 batch coalesce（每 50-100ms 或 N tokens）
3. transaction:
     - append batch 到 messages.content
     - revision++
4. 发 SSE { message_id, revision, delta }
5. STREAM_DONE 或 ABORTED：
     - tx flush 尾部
     - 更新 status = completed | interrupted
```

### 客户端约定

- 按 `revision` 单调应用 delta
- 刷新页面只信任 DB（不信任内存中已显示的 token）
- 进入房间发现某条 message 是 `streaming` 但无活跃 SSE 连接 → 显示"上次会话中断/已完成"

---

## 6. LLM Provider 抽象

**决定：Chorus 自己做轻 adapter，OpenClaw 仅做思路参考（不直接复用其 ProviderPlugin runtime）。**

### Adapter 接口（三件套）

```typescript
interface ChorusProvider {
  capabilities(): {
    structuredOutput: 'native' | 'tool' | 'prompt';
    streaming: boolean;
    maxContext: number;
  };

  generateJson<T>(args: {
    schema: JSONSchema;
    purpose: 'scheduler' | 'summary';
    messages: ChorusMessage[];
    abortSignal?: AbortSignal;
  }): Promise<T>;

  streamText(args: {
    messages: ChorusMessage[];
    purpose: 'speaker';
    abortSignal: AbortSignal;
  }): AsyncIterable<TokenDelta>;
}
```

### 结构化输出降级链

```
provider-native JSON schema    （首选）
  → single tool/function call  （备选）
  → prompt + parse + 1 retry   （兜底）
```

每个 provider adapter 内部声明用哪一档；`generateJson` 失败一次会自动 repair retry。

### 配置

- 通过环境变量切换：`CHORUS_PROVIDER_HOST`、`CHORUS_PROVIDER_ROLE`、`CHORUS_PROVIDER_SUMMARY` 可独立指定
- v1 默认主持人和角色用同一家 provider
- UI 不暴露选择

### 初始接入

参考 `~/dev/github.com/openclaw/openclaw` 的 provider 清单选 2-3 家先做。具体清单实现阶段定。

---

## 7. Transcript 与 Prompt 投影

**决定：一份 canonical transcript，按 actor 投影出不同 prompt view。**

### Canonical Transcript

DB 里 `messages` 表是唯一真相，每条带 actor (`user|host|role`) 和元数据。

### 投影规则

| Prompt View | 看到 | 不看到 |
|------------|------|------|
| Host (scheduler) | 全部消息 + 私有 control context（`next_speaker history`、`ai_streak`、`interrupted` 标记） | — |
| Host (speaker) | 全部消息 + scheduler 这次的 `reason` | — |
| Role (speaker) | 全部用户消息 + 主持人公开发言 + 自己历史发言 | scheduler JSON、interrupted 元数据、status_bar 提示 |

**关键**：角色看不到主持人的调度元数据（PRD §4.4 明确）。

---

## 8. 主持人 Prompt 三层结构

**决定：identity 共享，task 拆分，cold-start 单独 few-shot。**

```
[system]
host_identity              共享，定义主持人格、节奏感、字数控制

[user]                     scheduler / speaker 各自的 task instruction
host_scheduler_task   →    输出 JSON：{ next_speaker, reason, idle_reset, status_bar_hint }
host_speaker_task     →    输出自然语言（streaming）

cold-start (SESSION_STARTED) 用单独 few-shot 模板，避免开场白模板感太重
```

模式（访谈/对谈/教练）以**注入到 host_identity 的风格段**实现，不是切换整套 prompt。

---

## 9. 自定义角色：5 个维度

**决定**（PRD §3.2 占位的具体填充）：

| 维度 | 含义 | 影响什么 |
|------|------|--------|
| `relationship` | 和用户的站位（陌生人/朋友/长辈/师长/偶像/...） | 称谓、礼貌距离、共情方向 |
| `core_stance` | 认知框架/价值预设（实用主义/理想主义/怀疑主义/...） | 判断标准、辩论倾向 |
| `domain_lens` | 惯用知识域（产品/哲学/心理/技术/艺术/...） | 举例、类比、关注点 |
| `voice_tone` | 语体和语气（正式/口语/犀利/温柔/...） | 行文风格 |
| `initiative_level` | 主动引导 vs 被动回应 | 会不会反问、会不会带节奏 |

**不选**：`mood-state`（容易被对话本身的情绪覆盖而漂移）、`era`（容易变成 cosplay 而非稳定对话）。

UI 上每个维度提供 4-6 个选项卡片 + "随机一组"按钮 + 末尾"补充描述（可选）"自由文本框。

---

## 10. Next.js 项目结构

**决定：App Router + API route + SSE。不用 Server Actions + Suspense。**

### 目录骨架

```
app/
  page.tsx                       首页
  new/page.tsx                   建房流程
  room/[id]/page.tsx             房间页（SSR 拉历史快照 + client 订阅 stream）
  room/[id]/summary/page.tsx     总结页
  api/
    room/[id]/turn/route.ts      POST：触发一轮调度，返回 SSE
    room/[id]/end/route.ts       POST：结束并触发总结生成
    room/route.ts                POST：创建房间

lib/
  scheduler/                     状态机
  providers/                     ChorusProvider adapter
  prompts/                       host_identity / host_scheduler_task / ...
  db/                            Drizzle schema + queries
  transcript/                    canonical transcript + 投影

components/
  RoomView                       消息流 + 状态条 + 输入框
  StatusBar
  RoleAvatar                     首字母圆形头像
```

### 客户端状态

- Zustand store 管房间内 ephemeral UI：`activeGenerationId / displayedText / statusBar / inputLocked / pendingAbort`
- 历史消息走 SSR 初始 hydrate，后续 turn 增量从 SSE 拉

---

## 11. 关键不变量速查

1. **用户输入永不丢**：先写库，再触发调度
2. **partial 必入库**：先持久化再推前端，前端按 revision 单调应用
3. **角色不见调度元数据**：transcript 投影层把控
4. **scheduler 和 speaker 是两次独立 LLM 调用**：成本换稳定
5. **AI 连发不超过 3 轮**：硬规则，不让 LLM 决定
6. **summary 是 derived artifact**：独立表，可重生成

---

## 12. 实现阶段仍需决定

- 默认 provider 选哪家、模型档位、对应成本预算
- 主持人和 4 个内置角色的 system prompt 起手版本（建议在写代码前用真对话样本调一轮）
- 自定义角色 5 维度每个的具体选项清单（每维度 4-6 个选项）
- 部署方式（VPS / Fly / Railway 任选其一）+ 域名 / SSL
- 朋友试用阶段的极简身份方案（nickname + browser token 的具体实现）
- 错误恢复：provider 调用失败 / 网络断开 / 用户长时间离线后回来的体验

这些都不阻塞动工，但写代码时会逐个撞上。
