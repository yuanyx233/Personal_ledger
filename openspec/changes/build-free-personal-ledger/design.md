## Context

这是一个自用、单用户的加拿大个人账本。主要数据来源是同一用户在 RBC 与 BMO 的 chequing 和 credit card 账户；现金不要求自动化，但允许手工补录。目标不是替代银行，而是把只读流水持续同步为一份跨设备账本，并将日常人工工作压缩为处理少量异常：连接失效、信息不足的 e-Transfer、新商户分类纠错。

首版有四个硬约束：

1. 软件、银行连接和托管的当前经常性费用必须为 0；先使用 `workers.dev` 免费地址，未来购买域名只改变路由和访问配置。
2. 应用不得获取或保存网上银行用户名、密码或 MFA；银行连接只申请 Plaid Transactions 所需的只读能力。
3. 只同步 RBC/BMO 的 chequing 与 credit card，不把 savings、investment、loan 等账户带入账本。
4. 用户必须看得出每一笔分类是谁做的、依据是什么，并可以纠正当前交易或形成未来规则。

“全自动”在此定义为：正常连接状态下自动获取流水、处理更新、排除已确认的内部转账、分类并生成报表；需要银行重新授权或业务含义无法可靠判断时，系统明确提示用户处理，不静默猜测。

## Goals / Non-Goals

**Goals**

- 手机、平板和电脑通过同一 Web/PWA 查看同一份受保护账本。
- RBC 与 BMO 各建立尽可能少的 Plaid Item，并只启用 chequing 与 credit card。
- 正确处理 initial/incremental sync、pending 转 posted、modified、removed、重复 webhook 和断连修复。
- 将自动交易、CSV 导入交易与手工交易放在统一的数据模型中。
- 自动识别高置信度的本人账户间转账/信用卡还款；不把外部 e-Transfer 错删为内部转账。
- 提供透明、可纠错、有审计记录的商户分类。
- 提供月、季度、年维度的收入、净支出、净现金流、分类、商户、环比和同比分析。
- 提供完整导出，使用户不被 Plaid、Cloudflare 或本项目锁定。
- 免费额度接近或耗尽时安全失败，不自动进入付费方案，不丢失既有账本。

**Non-Goals**

- 不发起支付、转账、信用卡还款或修改任何银行数据。
- 不同步现金、savings、investment、loan、mortgage 或其他未明确启用的账户。
- 不做多人/家庭协作、预算规划、报税、投资收益、净资产或债务规划。
- 不读取 Amazon 订单明细，不拆分一笔交易；Amazon 只作为整笔商户交易分类。
- 不依赖付费 AI，也不使用模糊的生成式分类覆盖可解释规则。
- 首版不提供离线修改或缓存财务 API 数据；PWA 只缓存静态壳，避免共享设备留下账本快照。
- 不承诺银行连接永不需要人工重新授权，也不承诺所有 e-Transfer 都带有对方姓名或备注。

## Decisions

### 1. Runtime and deployment topology

采用 TypeScript monorepo，包含 React + Vite SPA、两个 Cloudflare Worker 入口和共享的领域模块；数据存储使用一个 Cloudflare D1 数据库。首版直接使用版本化 SQL migration 和 D1 prepared statements，不引入 ORM。

```text
Browser
  |
  | Cloudflare Access + verified Access JWT
  v
ledger-app.<account>.workers.dev
  |- static React/Vite SPA
  |- protected /api/*
  |- Plaid Link token exchange
  |- manual refresh and import/export
  |
  +-------------------+
                      v
                    D1 database
                      ^
  +-------------------+
  |
ledger-sync.<account>.workers.dev
  |- public POST /webhooks/plaid only
  |- Plaid webhook JWT verification
  |- scheduled catch-up sync
  |- no UI and no general-purpose public API
  |
  v
Plaid Transactions API <-> RBC / BMO
```

选择两个 Worker 而不是在受保护站点中为 webhook 绕过登录，是为了让整个应用 Worker 都处在 Cloudflare Access 后面，同时把 Plaid 必须访问的公网入口缩小到一个路由。两个入口共享相同的同步、校验和持久化代码，避免产生两套行为。

应用 Worker 与同步 Worker都可绑定相同 D1；只有确实需要调用 Plaid 的部署绑定拥有 Plaid secrets。Plaid access token 在写入 D1 前使用 AES-256-GCM 加密，每条记录使用随机 IV 并保存 `key_version`；加密密钥只存在于 Worker secret，绝不进入仓库、浏览器或日志。

免费计划是部署约束，而不是永久保证。配置不启用自动付费升级；应用记录匿名化用量与最近失败码，在免费额度不足时停止后台拉取并展示状态，手工录入、查看既有数据和导出仍应尽可能可用。

### 2. Authentication, session, and trust boundaries

`ledger-app` 由 Cloudflare Access 的 deny-by-default policy 保护，只允许一个明确配置的邮箱。Worker 不能只相信代理已鉴权；每个 HTML/API 请求都必须验证 `Cf-Access-Jwt-Assertion` 的签名、issuer、audience、expiry 和 email claim，并再次比对唯一允许邮箱。验证失败统一返回 403，不泄露配置细节。

所有应用 API 均为 same-origin，不开放通配 CORS。写请求额外校验 `Origin`、`Content-Type` 和短期 CSRF token；CSRF token 由受保护的 `/api/session` 返回并绑定当前 Access session。API 不使用 URL query 传递 secrets。

`ledger-sync` 不受 Access 保护，但只接受 `POST /webhooks/plaid`。它必须验证 Plaid `Plaid-Verification` JWT 的 ES256 签名、key id、issued-at 和 request-body hash，再进行 schema validation。其他路径返回 404；非法、超时或过大的请求在接触数据库前拒绝。

主要受保护资产是交易内容、Plaid access token、Plaid client secret、Access 配置和导出文件。主要威胁及控制如下：

| 威胁 | 控制 |
| --- | --- |
| 未授权访问账本/API | Access deny-by-default、Worker 内 JWT 二次验证、唯一邮箱 allowlist |
| 伪造或重放 webhook | Plaid JWT 验签、body hash、事件幂等键、时间窗口、乱序容忍 |
| access token 泄露 | AES-GCM 应用层加密、secret binding、密钥版本、日志脱敏 |
| SQL injection | 所有外部值做 schema validation，只用 prepared statements，不拼接 SQL |
| XSS/恶意商户文本 | React 默认转义、禁用任意 HTML、严格 CSP、输出编码 |
| CSRF/跨站调用 | same-origin、Origin/Fetch Metadata、CSRF token、无 wildcard CORS |
| 恶意 CSV/导出公式注入 | 文件大小/类型/列数限制、逐行解析、导出危险单元格转义 |
| 免费额度 DoS/全表扫描 | 索引、cursor pagination、查询日期上限、请求速率限制、任务退避 |

响应至少设置 CSP、HSTS、`frame-ancestors 'none'`、`X-Content-Type-Options: nosniff` 和严格 Referrer Policy。生产日志只允许内部 ID、事件类型、耗时和稳定错误码，不允许交易描述、姓名、账户 mask、token、CSV 内容或完整 webhook body。

### 3. Plaid connection contract

每个 RBC/BMO 登录连接对应一个 Plaid Item；连接时请求：

- `products: ["transactions"]`
- `country_codes: ["CA"]`
- `transactions.days_requested: 730`
- 账户过滤仅允许 `depository/checking` 与 `credit/credit card`
- 初次 Link token 必须传入固定的 `link_customization_name`；对应 Plaid Dashboard customization 必须启用 Account Select，并要求用户只勾选本产品范围内的账户。代码锁定 customization 名称，实际 pane 配置在 Sandbox/部署验证中确认
- 在同步响应中保留 `original_description`（如果机构提供）

不申请 Auth、Identity、Balance、Assets、Statements 或 Investments。Plaid Link 负责收集银行凭据和 MFA；本应用只接收短期 `public_token`，服务端立即交换为 `access_token` 并加密保存。

机构身份以 Plaid Item 返回的大小写敏感 `institution_id` 与环境中分别配置的 RBC/BMO 精确 allowlist 比对，不依赖可变化的显示名称。仓库内只保留安全失败的占位值；Sandbox 与后续获授权的 Production 阶段必须分别确认并替换对应 ID，两个 ID 不得相同。账户响应再次过滤，只持久化 `depository/checking` 与 `credit/credit card` 且具有三位 ISO currency 的账户；其他账户不写入 D1，若没有任何合规账户则拒绝该 Item。

Plaid Trial 当前按 Item 限制连接数量，而且删除 Item 不返还名额。因此连接页在创建前说明成本：同一机构断连或账户选择变化优先使用 update mode；不能通过“删除后重连”当作普通修复流程。RBC/BMO 各自默认只允许一个 active Item；额外连接必须明确确认。

### 4. Synchronization and idempotency

同步以 `/transactions/sync` cursor 为唯一增量协议。cursor 属于 Item，不属于单个账户。每次同步：

1. 从已保存 cursor 开始循环获取所有 page。
2. 在同一个逻辑同步批次中处理 `added`、`modified`、`removed`。
3. 如果任一 page 失败，不提交新 cursor；使用旧 cursor 重试整个批次。
4. 全部 page 成功后原子提交交易变更、账户状态和新 cursor。
5. 使用 Plaid transaction id 做唯一键；pending/posted 关系使用 Plaid 提供的关联 id，并保留审计状态，而不是按描述猜测去重。

Webhook 处理器只做验签、最小 schema 解析、幂等写入 `sync_events` 并快速返回；重复和乱序事件不得重复创建交易。scheduled handler 每 30 分钟扫描需要同步、上次失败或长时间未成功的 Item，补偿漏掉的 webhook。重试采用指数退避和上限，不进行无限热循环。

用户点击“立即同步”时，受保护的应用 Worker 先创建或复用幂等 sync run，再通过仅 Worker 间可访问的 `SyncService` RPC entrypoint 异步触发同一 TypeScript 同步执行器并返回进度/最新状态；RPC 只接收 connection/run 标识，不传 access token、lease token 或异常细节。同一 Item 同一时刻最多一个 lease，有并发请求时返回已有任务。若即时分发失败或执行预算不足，任务保留为 pending，由下一次 scheduled run 接续。

连接遇到 `ITEM_LOGIN_REQUIRED`、同意到期或账户选择变化时，状态变为 `ACTION_REQUIRED`，界面生成 update-mode Link token。update mode 成功后继续使用原 Item/access token，不做重复 public-token exchange。

### 5. Canonical data model

金额不用浮点数。`amount_minor` 存绝对最小货币单位，`direction` 为 `INFLOW` 或 `OUTFLOW`；同时保存原始提供方金额用于追溯。Plaid 的符号在 adapter 边界转换一次。日期保存为银行交易日期字符串，报表使用 `America/Toronto` 的日历边界。

核心表如下；实际列名和索引在实现任务中由 migration 固化：

| Entity | Key fields and invariants |
| --- | --- |
| `connections` | institution、Plaid item id、加密 token/IV/key version、cursor、status、last success、last error code、consent expiry；item id 唯一 |
| `accounts` | connection id、Plaid account id、display name、mask、type/subtype、currency、enabled；Plaid account id 唯一，只允许 checking/credit card |
| `transactions` | source、account、Plaid id、pending link、status、dates、amount/direction/currency、raw description、merchant、allowlisted payment metadata、category、categorization source/rule、internal-transfer flags、review flags、version/timestamps |
| `categories` | name、`INCOME`/`EXPENSE`/`TRANSFER`、system/active；系统类别不能被物理删除 |
| `merchant_rules` | normalized merchant exact key、category、priority、active、timestamps；首版不支持模糊 contains/regex |
| `category_audits` | transaction、old/new category/source/rule、reason、changed at；append-only |
| `transfer_matches` | debit transaction、credit transaction、confidence、decision source、status、timestamps；一笔交易最多一个 active match |
| `sync_events` | event hash、item、type、minimal payload、status、received/processed、error code；event hash 唯一 |
| `sync_run_requests` | connection、手工请求 idempotency key、复用的 sync run、创建时间；每个 connection/key 唯一，允许多个 key 映射到同一 active run |
| `import_batches` | source filename hash、content checksum、row counts、status、timestamps；原始文件不永久保存 |

`transactions.source` 为 `PLAID`、`MANUAL` 或 `CSV`；`status` 为 `PENDING`、`POSTED` 或 `REMOVED`。手工交易使用同一模型，但没有 Plaid id。所有更新使用 `version` 或 `updated_at` 做 optimistic concurrency，避免两个设备互相覆盖。

只保存产品需要的 Plaid 字段；不持久化完整 API response 或完整 webhook body。`payment_meta` 仅 allowlist 保存可能存在的 payer、payee、reference、method 等字段，而且 UI 必须将“未提供”与空字符串区分开。

### 6. Ledger semantics

报表只计入 `POSTED`、非 `REMOVED`、非内部转账的交易。pending 在交易页可见并标注，但不进入最终统计；posted 替代 pending 后，UI 只显示 posted 为正常交易，同时保留关系用于审计。

内部转账识别是独立于分类的决策：

- 只在当前用户已启用的账户之间匹配。
- 金额和币种必须相同、方向相反、交易日期在 3 天窗口内。
- 至少一侧描述/提供方类别必须表明 payment/transfer，并优先匹配 Plaid 提供的关联信息。
- 高置信度匹配自动标记为内部转账；候选不唯一、金额相近但不相等、或只有文本暗示时进入待确认，不能自动排除。
- 用户可以确认、拆除或忽略匹配，决定写入审计记录并优先于后续自动判断。

这能使 chequing 侧信用卡还款和 credit card 侧入账成对排除，但仍保留信用卡原始消费作为支出。

外部 Interac e-Transfer 不因包含 “transfer” 就被排除。只有与本人另一账户形成上述双边证据才是内部转账；否则按方向保留为收入或支出。若 Plaid 提供 payer、payee、reference 或 method，界面显示原值；未提供时不虚构对方信息，并将低置信度交易放入待确认。

退款作为 `INFLOW` 保留在原支出类别中，计算“净支出”时冲减该类别，而不是默认算成收入。用户仍可把特殊退款改为其他类别。

Amazon 与其他 marketplace 一样按整笔交易记一个类别，不做商品拆分。

### 7. Categorization and correction precedence

分类按以下优先级计算，优先级高者覆盖低者：

1. 当前交易的人工 override
2. active 的用户 merchant rule
3. Plaid Personal Finance Category 映射
4. `Unclassified`

商户规范化只做确定性处理：Unicode normalization、大小写统一、首尾/重复空白压缩，以及去除已明确列入规则的稳定终端编号。首版规则默认是 normalized merchant exact match；不使用模糊相似度、自由 regex 或无边界 contains，以免新商户被错误批量分类。

每笔交易显示分类 badge：`人工`、`我的规则`、`Plaid 自动` 或 `未分类`。详情展示原始描述、规范化商户、当前类别、规则名/来源和最近一次修改；交易页可按来源过滤，从而直接看到哪些商户由系统自动分类。

纠错操作提供两个明确选项：

- “只改这一笔”：写 transaction override，不影响其他交易。
- “以后这个商户都这样”：保存/更新 exact merchant rule，并修正当前交易；默认不静默回改历史交易。

每次自动/人工类别变化写入 append-only audit。新商户、未分类、低置信度 e-Transfer、歧义转账和规则冲突进入统一 review queue。review queue 支持逐笔处理，但首版不做没有预览的批量覆盖。

### 8. Reporting contract

默认时区为 `America/Toronto`，按 `posted_date` 落入自然月、自然季度和自然年。支持当前/上一周期以及自定义日期范围。所有 report endpoint 复用一套口径：

- `income`：收入类别的 inflow 减去同类 outflow。
- `net_spending`：支出类别的 outflow 减去同类 inflow（退款）。
- `net_cash_flow = income - net_spending`。
- 内部转账、removed 和 pending 始终排除。
- 环比/同比在前一周期为 0 时显示 `N/A`，不生成无穷百分比。

报表至少提供：总览指标、月度趋势、分类分布、商户排行、账户/类别/商户 drill-down，以及与上月/上季度/上年同口径比较。图表必须附可读数据表、明确单位和键盘可访问说明，不只靠颜色表达正负或分类。

不做汇率换算。CAD 默认展示；其他币种单独分组并明确标记，不能把 USD 数字直接加进 CAD 总数。未来如果需要汇率，必须作为新的明确需求设计数据来源和重算策略。

### 9. UI information architecture

界面采用 mobile-first 响应式布局。手机底部导航为“概览、交易、分析、设置”；桌面改为侧边导航，保持相同信息结构。

**概览**首先显示同步健康状态、最后成功时间和需要用户处理的数量；其次显示本月收入、净支出、净现金流及近 6 个月趋势。连接异常必须比装饰性图表更醒目。

**交易**在手机使用紧凑列表、桌面使用表格；筛选条件写入 URL，包含日期、账户、状态、类别、分类来源和 `needs review`。每行显示商户/描述、金额、账户、日期、pending 状态与分类来源 badge；详情抽屉提供原始字段、修改类别和转账决定。

**分析**提供月/季度/年切换、周期导航、现金流趋势、类别分布和商户排行。点击图表或表格行跳转到带同样筛选条件的交易页。

**设置**包含四块：RBC/BMO 连接和启用账户、类别与商户规则、手工录入/CSV 导入、完整导出。敏感操作（移除 Item、清空导入、删除手工交易）必须二次确认并说明影响。

所有页面都必须有 loading、empty、error、stale/offline 状态；网络失败不能把旧数据伪装成刚同步的数据。触控目标、焦点顺序、对比度和表单 label 以 WCAG 2.1 AA 为最低标准。首版不为了视觉效果引入动画或大面积卡片网格。

### 10. API boundaries

API 使用版本化 same-origin REST 路由 `/api/v1`。成功响应统一为 `{ "data": ..., "meta": ... }`，错误统一为 `{ "error": { "code": "...", "message": "...", "fieldErrors": ... } }`；message 适合用户阅读，内部异常和第三方 payload 不下发。

主要资源和动作：

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/session` | 返回当前身份、CSRF token 和应用时区 |
| `POST /api/v1/plaid/link-tokens` | 创建首次连接或 update-mode Link token |
| `POST /api/v1/plaid/items` | 幂等交换 public token 并保存 Item |
| `GET /api/v1/connections` | 连接、同意、同步状态 |
| `PATCH /api/v1/accounts/:id` | 启用/停用合规账户 |
| `GET /api/v1/transactions` | URL 可表达的过滤、排序和 cursor pagination |
| `POST /api/v1/transactions` | 新建手工交易 |
| `PATCH /api/v1/transactions/:id` | 纠正类别/字段，要求 version |
| `POST /api/v1/transactions/:id/transfer-decision` | 确认或拆除内部转账匹配 |
| `GET/POST/PATCH /api/v1/merchant-rules` | 查询和维护商户规则 |
| `GET /api/v1/categories` | 类别列表 |
| `GET /api/v1/reports/cash-flow` | 周期现金流与比较 |
| `GET /api/v1/reports/spending` | 类别/商户分布和 drill-down keys |
| `GET /api/v1/sync/status` | 每个 Item 的最近同步结果 |
| `POST /api/v1/sync-runs` | 触发幂等手工同步，返回任务状态 |
| `POST /api/v1/imports/csv` | 上传、校验和预览导入 |
| `POST /api/v1/imports/:id/commit` | 确认有效行并幂等写入 |
| `GET /api/v1/exports/transactions.csv` | 下载当前筛选交易 |
| `GET /api/v1/exports/data.json` | 下载完整可迁移数据 |

列表默认按 `posted_date DESC, id DESC`，使用 opaque cursor；page size 最大 100，含首尾日期的查询范围最大 730 天。过滤/排序字段必须 allowlist。普通 JSON 请求体最大 64 KiB；CSV preview 最大 5 MiB、10,000 行和 32 列；Plaid webhook 最大 256 KiB。创建连接、触发同步和提交 import 使用 idempotency key。连接交换只保存 public token 的 SHA-256 指纹和请求状态；不保存 public token，最终 connection 以唯一 idempotency key 关联请求，重复成功请求返回原结果，并发或 key/payload 冲突返回 409。写冲突返回 409 并带当前 version，校验失败返回 422，超出 body 上限返回 413，限流返回 429，第三方暂时失败返回稳定的 503 错误码。

应用 API 使用 Cloudflare Rate Limiting binding，按 Access session 与资源路由组合键在每个 Cloudflare location 限制为 60 次/分钟；公开 Plaid webhook 使用独立 binding，限制为 120 次/分钟/location。该 binding 是最终一致、按 location 的滥用缓解层，不承担精确计数、计费或幂等语义；`429` 响应带稳定错误码和 `Retry-After: 60`。

### 11. Import, export, and retention

CSV 导入采用“两阶段”：上传后只解析和预览，显示列映射、有效/无效/疑似重复行；用户确认后才写账本。首版支持日期、描述/商户、金额、方向、币种、账户显示名和类别；文件有严格大小、行数、编码和列数上限。使用 content checksum + canonical row fingerprint 防止同一批次重复提交；疑似重复不能静默删除，必须在预览中说明。

交易 CSV 导出与当前筛选一致；完整 JSON 导出包含账户显示信息、交易、类别、商户规则、转账决定和审计，但绝不包含 Plaid token、client secret、Access token、同步 webhook payload 或加密密钥。导出字段带 schema version，金额保持 integer minor unit 和 currency。

D1 migration 纳入版本控制。每次破坏性 schema 变更前先验证完整 JSON 导出和恢复脚本。D1 平台恢复能力只是辅助，不能替代用户可持有的开放格式导出。

### 12. Observability and acceptance evidence

系统记录结构化、无财务正文的事件：auth result、sync start/end、page count、added/modified/removed count、webhook verify result、import count、report latency 和稳定 error code。UI 显示每个 Item 的 `last_success_at`、当前状态和可执行修复动作，不依赖邮件通知。

实现验收至少需要：

- Plaid Sandbox 覆盖 initial sync、incremental added/modified/removed、pending→posted、duplicate/out-of-order webhook、断连 update mode。
- 规则/人工分类优先级、审计、不回改历史的测试。
- 内部转账正例和外部 e-Transfer/歧义反例。
- 报表 fixture 对 month/quarter/year、退款、pending、removed、transfer 和多币种口径逐项对账。
- API auth、CSRF、SQL injection、XSS 文本、恶意 CSV、导出公式注入和速率限制测试。
- 手机和桌面真实浏览器流程，包含键盘、空状态、失败和 stale 状态。
- 上线前用 RBC/BMO 实际数据做 14 天 shadow validation：抽样核对至少 30 笔交易，检查漏单/重复、pending 合并、信用卡还款和 e-Transfer 字段；未通过前不把分析结果视为可靠。

## Risks / Trade-offs

### Plaid/银行覆盖并非绝对稳定

RBC/BMO 登录、MFA、字段和同意续期可能变化。缓解方式是 update mode、显眼的连接健康状态、定时补偿同步、CSV fallback 和 14 天真实数据验证。无法缓解为“永不需要重新登录”，因此设计明确保留人工修复入口。

### Plaid Trial 的 Item 名额是稀缺资源

Trial 当前最多 10 个 Item，删除不会返还名额。默认每个机构一个 active Item，修复使用 update mode，并在创建额外 Item 前警告。若免费政策改变，完整导出和 CSV 导入是退出路径。

### 免费托管能力和条款会变化

Workers/D1 免费额度或 Access 能力可能调整。通过索引、增量 sync、cursor pagination、最小 webhook、无付费 AI 控制消耗；不配置自动付费升级。若免费层不再足够，先降级后台频率并保留导出，不擅自产生账单。

### e-Transfer 信息可能不完整

Plaid payment metadata 是可选字段，不能保证显示 payer/payee/reference。系统展示实际获得的信息，缺失就标记待确认，不通过文本生成“猜测姓名”。

### 内部转账自动匹配存在误判风险

过度排除会直接扭曲支出。设计只自动确认高置信度双边匹配，歧义进入 review queue，用户决定有审计且优先于算法。代价是极少数转账仍需确认。

### 两个 Worker 增加少量部署复杂度

换来的是清晰安全边界：应用完全受 Access 保护，公网只暴露单一验签 webhook。共享领域包、同一 D1 migration 和一致配置校验控制维护成本。

### 不做离线财务数据缓存

网络断开时只能显示连接失败/静态壳，不能浏览旧账。这样牺牲离线便利性，降低共享设备、Service Worker cache 和过期数据带来的隐私与正确性风险。

## Migration Plan

1. **Local/Sandbox**：创建 D1 local migration、fixture 和 Plaid Sandbox 数据；所有端到端验收先在假数据完成。
2. **Free preview**：部署两个 `workers.dev` Worker 和免费 D1；先配置 Cloudflare Access 唯一邮箱，再开放任何应用 API。此阶段仍只连 Plaid Sandbox。
3. **Trial connection**：确认 Plaid Trial 与所需 RBC/BMO connection 可用后，由用户本人通过 Link 各连接一次并只选 chequing/credit card；开发者和日志都看不到银行凭据。
4. **Shadow validation**：连续 14 天同步并与银行页面抽样核对；先处理漏单、重复、pending、还款和 e-Transfer 差异，再认可报表。
5. **Personal use**：通过验收后将应用作为主账本使用；每月做 JSON 完整导出，并保留最近一份可恢复副本。
6. **Optional domain**：用户购买域名后，只修改 Worker route、Access application、Plaid redirect URI/webhook URI 和 CSP allowlist；数据模型和应用 URL contract 不变。

回滚不影响银行：停止 Worker、在 Plaid 调用 Item removal/revoke、导出后删除 D1 即可。因为产品只有只读 Transactions 权限，不存在回滚银行写操作。任何 remote deployment、Plaid production connection 或 Item removal 都需要用户在实施阶段单独明确授权。

## Open Questions

没有阻止实现的产品问题。RBC/BMO 实际返回的 merchant、original description 和 e-Transfer metadata 质量只能在用户授权后的 14 天 shadow validation 中确认；验证结果若推翻这里的交易/分类假设，必须先更新本 OpenSpec 再继续实现。

## Primary Sources

- [Plaid Trial plan](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan)
- [Plaid billing and Item limits](https://plaid.com/docs/account/billing/)
- [Plaid Transactions](https://plaid.com/docs/transactions/)
- [Plaid Transactions API and optional payment metadata](https://plaid.com/docs/api/products/transactions/)
- [Plaid Link account filters](https://plaid.com/docs/api/link/)
- [Plaid update mode](https://plaid.com/docs/link/update-mode/)
- [Plaid Transactions Sync migration](https://plaid.com/docs/transactions/sync-migration/)
- [Plaid webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
- [Plaid webhook best practices](https://plaid.com/docs/api/webhooks/)
- [Cloudflare React + Vite on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Cloudflare Access for Workers and origin JWT validation](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/)
- [Cloudflare D1 Worker API and prepared statements](https://developers.cloudflare.com/d1/worker-api/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare `workers.dev` routing and Access](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
