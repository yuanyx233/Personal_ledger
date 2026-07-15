# Personal Ledger

一个遵循 OpenSpec 构建的单用户加拿大个人账本。当前仅包含本地 TypeScript workspace；尚未部署，也未连接任何真实银行数据。

## Workspace

- `apps/web`：React/Vite 客户端与受保护应用 Worker 入口
- `workers/sync`：独立的公网同步 Worker 入口
- `packages/domain`：两个 Worker 与客户端共享的领域包
- `packages/persistence`：使用 D1 prepared statements 的共享持久化边界

## Runtime

- Node.js `24.17.0`（见 `.nvmrc` / `.node-version`）
- npm `11.11.1`

## Configuration boundaries

- `apps/web/.env.example` 只包含会进入浏览器 bundle 的 `VITE_*` 公共配置。
- `apps/web/.dev.vars.example` 与 `workers/sync/.dev.vars.example` 只列出本地 secret 占位符；复制后的 `.dev.vars` 被 Git 忽略。
- 两个 `wrangler.jsonc` 的 `secrets.required` 是生产 Worker secret 名称清单；真实值只能通过 Cloudflare encrypted secrets 注入。

安装依赖后可运行 `npm run verify`，一次完成格式、lint、类型、覆盖率、真实浏览器和生产构建检查。

## Local D1 lifecycle

本地数据库固定使用被忽略的独立目录 `.wrangler/local-d1`，以下命令均不带 `--remote`，不会操作远端 D1。仓库内的 seed 只包含合成数据。

```bash
npm run db:migrate
npm run db:seed
npm run db:verify
```

如需只清除这份本地 D1 状态，并从空库重新执行 migration、seed 与查询校验：

```bash
npm run db:recreate
```

部署、Cloudflare 资源创建和 Plaid 连接均不属于本地初始化步骤，必须另行明确授权。
