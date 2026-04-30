# 部署到 Vercel + Turso

零成本路径。前提：你已经把仓库 push 到 GitHub。

## 1. 注册 Turso 并建库

```bash
brew install tursodatabase/tap/turso   # 或 curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup
turso db create chorus
turso db show chorus                   # 记下 url（libsql://chorus-xxx.turso.io）
turso db tokens create chorus          # 记下 token
```

Turso 免费档：9GB 存储 / 10 亿次读 / 2500 万次写 / 月。Chorus 这种用量基本用不完。

## 2. 应用 schema

把上一步的 url/token 填到本地 `.env.local`，然后：

```bash
TURSO_DATABASE_URL=libsql://chorus-xxx.turso.io \
TURSO_AUTH_TOKEN=eyJ... \
npm run db:migrate
```

## 3. Vercel 部署

```bash
npm i -g vercel
vercel link
```

在 Vercel 项目 Settings → Environment Variables 里加：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（如果用 DashScope/Ark 等 OpenAI 兼容端点）
- `OPENAI_MODEL_HOST` / `OPENAI_MODEL_ROLE` / `OPENAI_MODEL_SUMMARY`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

> **不要**设 `CHORUS_DB_PATH`：当 `TURSO_DATABASE_URL` 存在时它会被忽略，但留着容易混淆。

然后 push 到 main，Vercel 自动 build + deploy。或者：

```bash
vercel --prod
```

## 4. 验证

打开分配的域名（`chorus-xxx.vercel.app`），创建房间。如果 env 配错，会看到 503 + JSON 列出缺什么。

## 限制 / 注意事项

- **SSE 函数时长**：Vercel Hobby 上每次 turn 函数最多 30s，Pro 是 60s。Chorus 一次 turn 通常 5-15s，但被打断重试 / 多轮辩论的 streaming 累计可能逼近上限。如果触顶，升级 Pro 或换 Fly.io。
- **冷启动**：Vercel serverless 第一次访问会冷启 ~1s。
- **Turso 暂停**：Turso 数据库不会自动暂停（跟 Neon/Supabase 不同），所以也不会有"唤醒"的延迟。
- **in-memory 锁**：`lib/scheduler/runtime.ts` 里的 `turnLocks` 和 `active` Map 是 process-local 的。Vercel serverless 多实例时锁会失效。但单浏览器单用户的 Chorus 在低并发下基本不会撞这个。如果以后有真正多人并发，需要把锁迁到 Redis（参考 codex review）。
- **better-sqlite3 已经移除**，本地 dev 用 libSQL file 模式（看 `lib/db/index.ts`），不需要重新安装 native 依赖。
