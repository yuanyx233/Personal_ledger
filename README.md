# Personal Ledger

A single-owner personal ledger: a React/Vite frontend, one login-protected App Worker, and one D1 database. Self-hostable — [deploy your own](./docs/self-hosting.md).

单用户个人账本：React/Vite 前端、一个受登录保护的 App Worker、一个 D1 数据库。可自行部署 —— 见[自托管指南](./docs/self-hosting.md)。

**[English](#english) · [中文](#中文)**

---

## English

### What it does

CSV preview and deduplicating import, entries by hand, transaction search, categories and merchant rules, totals separated by currency, monthly subscriptions posted automatically, and CSV/JSON export. There is no Plaid, no bank sync, no automatic transfer matching and no separate review queue. An explicit credit-card payment is categorised as a Transfer on import; you choose the category for other transfers, and neither counts as income or spending.

The overview shows this month's income and spending plus a pie of spending by category, with each category's amount and share, and each slice links to its entries. Currencies are shown separately, and a negative net is labelled a refund rather than drawn as a slice.

Entries are categorised as you import them: an explicit category in the file and your own exact merchant rules come first, then a recognised merchant of the same brand, then the built-in list of common merchants. Amazon order numbers and T&T store numbers do not need a rule each. Conflicts and unknown merchants are left unclassified. Refunds keep their direction and reduce the category they belong to. Re-importing never rewrites a category you already set.

When recording an entry you can mark a **shared cost or reimbursement offset** and enter the offset amount. Pay 300 and offset 200, and the payment is kept while your own spending counts as 100. When the money comes back, record it and mark it as returned: it is not counted as income and does not offset spending a second time. EMT transfers are not marked automatically. A posted entry's offset can be changed or removed from its detail page, and both the JSON backup and the CSV export carry it.

You can also mark an entry as **paid in instalments**, generating 2 to 60 monthly entries at once. Subscriptions are managed on their own page, reachable from the sidebar on desktop and from settings on mobile: create, edit, cancel and resume recurring charges. Cancelling takes an effective date **including that day**, and removes charges already posted on or after it. The Worker checks for due charges every 15 minutes.

Analysis shows net spending and share by category for a month, and lets you set monthly budget limits in the all-accounts view. A limit applies from the month you set it until you set it again; earlier months are unaffected. Zero means no planned spending, and removing a limit means no cap. Usage is net of refunds and reimbursement offsets, and excludes transfers.

### Running it yourself

See **[docs/self-hosting.md](./docs/self-hosting.md)** for the full path from an empty Cloudflare account to a running ledger.

Cloudflare Access is a **requirement**, not an option: the Worker verifies an Access JWT against a single owner email and has no fallback authentication.

The timezone and the currencies your accounts use are configuration, not constants. Any named IANA timezone works. Amounts are stored as hundredths, so currencies whose minor unit is not 1/100 — JPY, KRW, KWD and others — are rejected rather than silently misrecorded.

The interface is available in English and Simplified Chinese, chosen from your browser and switchable in settings.

### Workspace

- `apps/web` — frontend pages and the backend API.
- `packages/domain` — validation, money, CSV and reporting logic.
- `packages/persistence` — D1 queries, backup and restore.

### Local development

Node.js `24.17.0` and npm `11.11.1` (see `.nvmrc` / `.node-version`).

`apps/web/.env.example` holds public browser configuration only; `apps/web/.dev.vars.example` lists placeholders for the login and CSRF secrets. Real secrets are never committed.

```bash
npm ci
cp apps/web/.env.example apps/web/.env
npm run verify
npm run db:migrate
npm run db:seed
npm run db:verify
```

The local D1 lives in the ignored `.wrangler/local-d1` and the seed is synthetic. None of those commands touch a remote database.

### Backups

Download the full JSON backup from settings. CSV is readable but is not a backup. Restoring writes to a new directory that does not yet exist:

```bash
npm run db:restore -- --input ./ledger-export.json --persist-to /tmp/ledger-restored-d1
```

A restore refuses to proceed when the backup's timezone differs from the instance's, because the stored dates were computed in the backup's zone. Pass `--timezone` when moving a ledger deliberately.

The backup format is v5. Backups from v4 and earlier are not accepted; restore those with code from their own era rather than letting fields be dropped in silence.

### Licence

MIT. See [LICENSE](./LICENSE).

---

## 中文

### 它做什么

保留 CSV 预览与导入去重、手动记账、流水查询、分类与商户规则、按币种汇总、每月订阅自动记账、CSV/JSON 导出。没有 Plaid、银行同步、自动转账配对或独立审核队列。明确的信用卡还款在导入时自动归为 Transfer，其他转账由用户选择类别，不计入收入或支出。

主页显示本月收支和按类别划分的支出饼图，附每个类别的金额与占比，可点击查看交易明细；不同币种分开呈现，负净支出显示为净退款，不纳入饼图扇区。

CSV 提交时自动分类：优先采用文件中的明确类别和你的精确商户规则，再沿用已识别的同品牌商户规则或内置常见商户类别。Amazon 订单号、T&T 门店号等变化不需要逐笔设置。规则冲突或未知商户保留待分类；退款保留入账方向并冲减对应消费类别。重导不会改写既有分类。

记一笔时可勾选「分摊 / 报销抵扣」并填写抵扣金额。例如付款 300、抵扣 200，保留付款记录，个人消费统计为 100。另录收款时选择「这是分摊 / 报销回款」，回款部分不计入收入，也不会再次抵扣消费。EMT 不自动标记。已入账交易可在详情中修改或取消抵扣，JSON 备份和 CSV 导出会保留抵扣金额。

记一笔时也可勾选「分期付款」，一次生成 2–60 期按月账目。订阅管理页可创建、编辑、取消和恢复每月固定支出，取消按生效日**含当天**，并删除该日期起已记录的支出：桌面端侧边栏有独立入口，移动端从设置页进入。App Worker 每 15 分钟检查到期项并补记账目。

分析页的月视图可查看各类别净支出与占比，并在全部账户视图设置 Goal 月度预算上限。预算从所选月份沿用至下一次设置，修改不影响更早月份；零表示不计划支出，取消表示不设上限。使用额扣除退款和报销抵扣，不含转账。

### 自行部署

完整步骤见 **[docs/self-hosting.md](./docs/self-hosting.md)**（英文），涵盖从空的 Cloudflare 账号到账本可用的全过程。

Cloudflare Access 是**必需前置**而非可选项：Worker 只验证 Access JWT 并比对单一所有者邮箱，不存在回退鉴权。

时区和账户所用货币是配置项而非常量，任何 IANA 时区都可用。金额按百分之一存储，因此次要单位不是 1/100 的货币（JPY、KRW、KWD 等）会被拒绝，而不是静默记错。

界面支持中文与英文，按浏览器语言自动选择，也可在设置页切换。

### 目录结构

- `apps/web`：前端页面和后端 API。
- `packages/domain`：校验、金额、CSV 与汇总逻辑。
- `packages/persistence`：D1 查询与备份恢复。

### 本地运行与检查

使用 Node.js `24.17.0`、npm `11.11.1`（见 `.nvmrc` / `.node-version`）。

`apps/web/.env.example` 只包含浏览器公共配置；`apps/web/.dev.vars.example` 只列登录与 CSRF 密钥占位符。真实密钥不入库。

```bash
npm ci
cp apps/web/.env.example apps/web/.env
npm run verify
npm run db:migrate
npm run db:seed
npm run db:verify
```

本地 D1 使用被忽略的 `.wrangler/local-d1`，seed 为合成数据。以上命令不操作远端。

### 备份

在设置页下载完整 JSON。CSV 便于查看，但不能替代完整备份。恢复只写入一个尚不存在的独立目录：

```bash
npm run db:restore -- --input ./ledger-export.json --persist-to /tmp/ledger-restored-d1
```

若备份记录的时区与当前实例配置不同，恢复会在写入前拒绝 —— 因为库中日期是在备份那个时区下算出来的。确需迁移时传 `--timezone`。

备份格式为 v5。v4 及更早的备份不被接受；需要恢复时应使用与该版本兼容的历史代码，避免静默丢弃字段。

### 许可证

MIT，见 [LICENSE](./LICENSE)。
