## Context

这是一个自用、单用户的加拿大个人账本。主要数据来源是同一用户在 RBC 与 BMO 的 chequing 和 credit card 账户；现金不要求自动化，但允许手工补录。目标不是替代银行，而是把只读流水持续同步为一份跨设备账本，并将日常人工工作压缩为处理少量异常：连接失效、信息不足的 e-Transfer、新商户分类纠错。

2026-08 的确认需求将日常入口调整为 **manual-first**：由于当前不采用需要额外申请/授权的银行自动同步，用户在 iPhone 上每次消费后即时记录；若长时间漏记，再导入 RBC/BMO 可取得的银行流水补齐；订阅由用户确认一次后按计划自动生成。既有 Plaid 实现保留为可选、只读能力，但不再是个人使用就绪或正确报表的前提。

首版有四个硬约束：

1. 软件、银行连接和托管的当前经常性费用必须为 0；先使用 `workers.dev` 免费地址，未来购买域名只改变路由和访问配置。
2. 应用不得获取或保存网上银行用户名、密码或 MFA；银行连接只申请 Plaid Transactions 所需的只读能力。
3. 只同步 RBC/BMO 的 chequing 与 credit card，不把 savings、investment、loan 等账户带入账本。
4. 用户必须看得出每一笔分类是谁做的、依据是什么，并可以纠正当前交易或形成未来规则。

“全自动”在此定义为：正常连接状态下自动获取流水、处理更新、排除已确认的内部转账、分类并生成报表；需要银行重新授权或业务含义无法可靠判断时，系统明确提示用户处理，不静默猜测。

## Goals / Non-Goals

**Goals**

- 手机、平板和电脑通过同一 Web/PWA 查看同一份受保护账本。
- iPhone 从主屏幕直达 `/add`，普通消费通常只输入金额与商户/描述，十几秒内完成。
- 已确认订阅按计划生成实际交易，并提供可检查、暂停、取消和纠正单次未发生的管理界面。
- 漏记后导入银行 CSV 时，高置信度唯一匹配自动合并到既有手工/订阅交易，其余逐笔确认。
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
- 不为快捷录入开放无认证、共享密钥或 Access Bypass 写入口。
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
  |- scheduled subscription occurrence generation
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

订阅到期生成使用受保护 app Worker 自身的 `scheduled()` 入口和同一 D1 binding，不增加第三个公开服务，也不依赖 Plaid secrets 或 sync Worker 的配置校验。Cron 仍按 UTC 触发，但业务 due date 始终先转换为 `America/Toronto` calendar date；唯一 occurrence key 保证重试安全。新增逻辑不得扩大任何 Worker 的 HTTP surface。

应用 Worker 与同步 Worker都可绑定相同 D1；只有确实需要调用 Plaid 的部署绑定拥有 Plaid secrets。Plaid access token 在写入 D1 前使用 AES-256-GCM 加密，每条记录使用随机 IV 并保存 `key_version`；加密密钥只存在于 Worker secret，绝不进入仓库、浏览器或日志。

免费计划是部署约束，而不是永久保证。配置不启用自动付费升级；应用记录匿名化用量与最近失败码，在免费额度不足时停止后台拉取并展示状态，手工录入、查看既有数据和导出仍应尽可能可用。

### 2. Authentication, session, and trust boundaries

`ledger-app` 由 Cloudflare Access 的 deny-by-default policy 保护，只允许一个明确配置的邮箱。Worker 不能只相信代理已鉴权；每个 HTML/API 请求都必须验证 `Cf-Access-Jwt-Assertion` 的签名、issuer、audience、expiry 和 email claim，并再次比对唯一允许邮箱。验证失败统一返回 403，不泄露配置细节。

所有应用 API 均为 same-origin，不开放通配 CORS。写请求额外校验 `Origin`、`Content-Type` 和短期 CSRF token；CSRF token 由受保护的 `/api/session` 返回并绑定当前 Access session。API 不使用 URL query 传递 secrets。

快捷录入不改变认证边界。Cloudflare Access application/policy/global session duration 由远程控制面管理而非仓库代码；在另行授权的配置步骤中目标设为最多一个月，以减少可信个人设备的登录提示，同时保持唯一邮箱 policy、Worker 内 JWT 二次验证和可撤销 cookie。SPA 的 API fetch 添加 Cloudflare 文档要求的 `X-Requested-With: XMLHttpRequest`，把过期 subrequest 转成可识别的重新登录状态；绝不在 `localStorage` 保存 Access/service token。

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
| 快捷录入/类别名称注入 | strict schema、长度/控制字符限制、React text rendering、prepared statements、显式创建确认 |
| 订阅重复生成或竞态 | subscription+scheduled-date 唯一键、version guard、D1 atomic batch、bounded catch-up |
| 银行 CSV 暴露账户号 | RBC adapter 明确忽略 column B；preview、持久化、导出与日志均不投影该值 |
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

app Worker 的每日 scheduled invocation 以当前 Toronto date 查询 active 且 `next_charge_date <= today` 的订阅。每份计划每次最多 catch up 24 个 occurrence；超过上限时停止该计划并记录稳定 action-required code，不通过无限循环追赶。每个 due date 先以 `(subscription_id, scheduled_date)` 唯一约束占位，再在同一 D1 batch 中创建 `POSTED/MANUAL` transaction、完成 occurrence、推进 plan version/next date。任何语句失败都回滚整组，下一次调度可安全重试；occurrence 关系是订阅来源的唯一事实来源。

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
| `categories` | name、`INCOME`/`EXPENSE`/`TRANSFER`、system/active；owner 可维护 `INCOME`、`EXPENSE` 或自定义 `TRANSFER` 类别，系统类别不能被物理删除 |
| `merchant_rules` | normalized merchant exact key、category、priority、active、timestamps；首版不支持模糊 contains/regex |
| `subscriptions` | owner-confirmed name/merchant key、account label、amount/currency、category、monthly/yearly cadence、anchor day、next charge date、active/paused/cancelled、last error、version/timestamps |
| `subscription_occurrences` | subscription、scheduled date、canonical transaction、generated/not-charged status、owner decision/timestamps；subscription+scheduled date 唯一 |
| `category_audits` | transaction、old/new category/source/rule、reason、changed at；append-only |
| `transfer_matches` | debit transaction、credit transaction、confidence、decision source、status、timestamps；一笔交易最多一个 active match |
| `transfer_match_audits` | transfer match、owner action、old/new status、reason、changed at；append-only |
| `sync_events` | event hash、item、type、minimal payload、status、received/processed、error code；event hash 唯一 |
| `sync_run_requests` | connection、手工请求 idempotency key、复用的 sync run、创建时间；每个 connection/key 唯一，允许多个 key 映射到同一 active run |
| `import_batches` | source filename hash、content checksum、row counts、status、timestamps；原始文件不永久保存 |

`transactions.source` 保持为 `PLAID`、`MANUAL` 或 `CSV`；`status` 为 `PENDING`、`POSTED` 或 `REMOVED`。订阅到期交易也是 `MANUAL` 且必须带 occurrence relation；UI 从该关系展示订阅来源。CSV import row 可以关联一个既有 `MANUAL` canonical transaction 作为 reconciliation evidence，而不创建第二笔。所有更新使用 `version` 或 `updated_at` 做 optimistic concurrency，避免两个设备互相覆盖。

类别新增 normalized name 唯一键；display name 保留用户大小写，创建时做 Unicode normalization、trim/repeated-whitespace collapse 与控制字符/长度校验。已有 active/inactive/system 类别都参与唯一性检查，避免 `Restaurant`、` restaurant ` 等重复统计口径。

只保存产品需要的 Plaid 字段；不持久化完整 API response 或完整 webhook body。`payment_meta` 仅 allowlist 保存可能存在的 payer、payee、reference、method 等字段，而且 UI 必须将“未提供”与空字符串区分开。

### 6. Ledger semantics

报表只计入 `POSTED`、非 `REMOVED`、非内部转账的交易。pending 在交易页可见并标注，但不进入最终统计；posted 替代 pending 后，UI 只显示 posted 为正常交易，同时保留关系用于审计。

快捷录入仍调用 canonical `POST /transactions`，但 category 变为 optional。服务端先尝试 active exact merchant rule；没有命中时以 `Unclassified` 创建同一笔 `POSTED/MANUAL` 交易并返回 `categoryConfirmationRequired=true`。UI 随即停留在同页确认，不为了等待类别而创建临时草稿或第二笔交易；若用户选择稍后，现有 review queue 接管。默认日期由客户端按 Toronto 计算并由服务端 calendar-date schema 再验证，默认 `RBC Credit`/CAD/OUTFLOW 只是可编辑输入，不是权限边界。

订阅 occurrence 直接生成带 occurrence 关系的 `POSTED/MANUAL`，因此从 due date 起进入实际报表。若实际未扣款，owner 对 occurrence 执行 `NOT_CHARGED` 决定：canonical transaction 变为 `REMOVED`，保留 occurrence/audit 关系，不改变 plan 的 next date 或状态。暂停/取消只阻止尚未 claim 的未来 due date；编辑金额、账户、类别、cadence 或 next date 不回改历史 occurrence。

首版 subscription candidate detector 有意保守：只看 `POSTED`、非内部转账的 outflow，按 exact account label/id、currency、exact normalized merchant 和 exact amount cluster；monthly candidate 至少 3 次且相邻间隔 25–35 天，yearly candidate 至少 2 次且间隔 350–380 天。同额反向 refund 在 7 天内配对后不作为 recurring evidence，已经被 active/paused/cancelled plan 覆盖的 cluster 不再提示。任何缺失 merchant、多 cluster 重叠、金额变化或 cadence 模糊都不猜测，只允许 owner manual create。

内部转账识别是独立于分类的决策：

- 只在当前用户已启用的账户之间匹配。
- 金额和币种必须相同、方向相反、交易日期在 3 天窗口内。
- 至少一侧描述/提供方 payment method 必须表明 payment/transfer；Plaid `payment_meta.payment_method` 只要实际提供非空值就作为提供方转账证据，不维护自造枚举 allowlist。
- 只有唯一候选且具备提供方 payment method，或明确付款文本同时得到 chequing↔credit-card 账户类型印证时，才作为高置信度内部转账自动标记。
- 候选不唯一、金额相近但不相等、缺少证据，或两个同类账户之间只有文本暗示时进入待确认，不能自动排除。
- 用户可以确认、拆除或忽略匹配，决定写入审计记录并优先于后续自动判断。

转账决定接口使用交易 id 作为资源路径，并在严格请求体中只携带 `matchId`、
`action`（`CONFIRM`、`BREAK` 或 `IGNORE`）和当前 `version`；审计 reason 由服务端按 action 固定生成。
`CONFIRM` 接受自动确认、待复核或先前被 owner 拆除/忽略的匹配，`BREAK` 只接受自动确认或 owner 已确认匹配，
`IGNORE` 只接受待复核候选；路径交易必须是该 match 的一侧。成功决定与 append-only audit
在同一 D1 batch 中提交，竞争 version 返回 409，非法状态转换返回稳定的 409 conflict。
确认一个歧义候选时，系统清除与其任一侧重叠的其他算法候选，避免留下重复待办。

自动候选的 upsert 与失效候选清理放在交易同步提交的同一个 D1 batch 中，并位于 cursor/run 成功更新之前；账户启停也在同一原子更新中触发重算。重复计算保留未变化 match 的 id、时间戳和 version，且自动逻辑只改写 `AUTO_CONFIRMED`/`PENDING_REVIEW`，不覆盖 owner 决定。

这能使 chequing 侧信用卡还款和 credit card 侧入账成对排除，但仍保留信用卡原始消费作为支出。

外部 Interac e-Transfer 不因包含 “transfer” 就被排除。只有与本人另一账户形成上述双边证据才是内部转账；否则按方向保留为收入或支出。若 Plaid 提供 payer、payee、reference 或 method，界面显示原值；未提供时不虚构对方信息，并将低置信度交易放入待确认。

如果 owner 已无法可靠回忆一组历史 e-Transfer 的具体用途，可以显式把选定记录逐笔归入一个 editable custom `TRANSFER` 类别。该人工分类保留原始方向和审计，但和系统 Transfer 一样不进入 income 或 net spending；它不是内部转账匹配，也不得产生未来商户规则。后续新 e-Transfer 仍按原规则进入待确认，等待 owner 手动处理。

e-Transfer 识别只接受有词边界的 `INTERAC`、`E-TRANSFER`/`ETRANSFER` 显式文本或同义 payment method；普通 `TRANSFER`、`PAYMENT` 或 `ACH` 单独出现不构成 Interac e-Transfer 证据。仍未分类且没有 `AUTO_CONFIRMED`/`CONFIRMED` 本人账户匹配的记录保留原方向，并以 `UNCERTAIN_E_TRANSFER` 标记待确认；自动匹配、账户启停及 owner 转账决定在同一原子写入中重算该系统标记，不覆盖人工、规则或 Plaid 分类结果。

交易读模型只投影 `payer`、`payee`、`referenceNumber` 和 `paymentMethod` 四个 nullable 字段，不透传持久化 JSON 或其他 payment metadata。`null` 明确表示 Plaid 未提供，实际提供的空字符串仍原样保留，供界面与“未提供”状态区分。

退款作为 `INFLOW` 保留在原支出类别中，计算“净支出”时冲减该类别，而不是默认算成收入。用户仍可把特殊退款改为其他类别。

Amazon 与其他 marketplace 一样按整笔交易记一个类别，不做商品拆分。

### 7. Categorization and correction precedence

分类按以下优先级计算，优先级高者覆盖低者：

1. 当前交易的人工 override
2. active 的用户 merchant rule
3. Plaid Personal Finance Category 映射
4. `Unclassified`

商户规范化只做确定性处理：Unicode normalization、大小写统一、首尾/重复空白压缩，以及去除已明确列入规则的稳定终端编号。首版规则默认是 normalized merchant exact match；不使用模糊相似度、自由 regex 或无边界 contains，以免新商户被错误批量分类。

“类别建议”与“自动分类”分开：未知 quick-entry transaction 保存后，`GET /transactions/:id/category-suggestions` 只返回最多两个 active/editable category。优先取同一 normalized merchant 的已确认规则/历史（若存在则正常应已自动命中），其次取 owner 最近确认频率与稳定 taxonomy order；suggestion 只携带 category id/name 和可解释 reason，不产生数据库写入。用户点击建议或搜索结果时复用 future exact-rule correction，因此当前交易与知识规则原子更新。不存在的名称必须先调用 strict category create，再以返回 id 纠正当前交易；UI 有明确二次确认，409 conflict 引导选择既有类别。

为避免“聪明”匹配误伤，描述知识库继续由 owner-confirmed exact normalized keys 构成；银行 description 缺少 merchant 字段时 adapter 以合并后的 description 作为 display merchant/normalization 输入。只有用户确认形成的 exact rule 可以免确认应用，advisory suggestion 本身不能升级为规则。

每笔交易显示分类 badge：`人工`、`我的规则`、`Plaid 自动` 或 `未分类`。详情展示原始描述、规范化商户、当前类别、规则名/来源和最近一次修改；交易页可按来源过滤，从而直接看到哪些商户由系统自动分类。

纠错操作提供两个明确选项：

- “只改这一笔”：写 transaction override，不影响其他交易。
- “以后这个商户都这样”：保存/更新 exact merchant rule，并修正当前交易；默认不静默回改历史交易。

每次自动/人工类别变化写入 append-only audit。新商户、未分类、低置信度 e-Transfer、歧义转账和规则冲突进入统一 review queue。review queue 支持逐笔处理，但首版不做没有预览的批量覆盖。

“只改这一笔”复用 `PATCH /api/v1/transactions/:id`，并以严格的
`{ categoryId, version }` 请求体与手工交易字段编辑分流。它适用于 Plaid、CSV 和手工来源，
只接受 active、editable 的 owner category；成功后将分类来源设为 `MANUAL`、清除命中规则和已解决的
review 状态并递增 optimistic version。已处于相同最终状态的重复请求返回当前交易且不递增 version，
竞争写返回 409，失效、系统或不存在的类别返回 422。交易类别、分类来源或规则标识的任何实际变化
由 D1 trigger 在同一数据库更新中追加 old/new category、source、rule、服务端 reason 和时间戳；
`category_audits` 的 UPDATE/DELETE 均由数据库 trigger 拒绝。

“以后这个商户都这样”使用 `PUT /api/v1/transactions/:id/merchant-rule` 和同样严格的
`{ categoryId, version }` 请求体。服务端只使用交易已持久化的 deterministic
`normalized_merchant` 创建或更新唯一 exact rule；没有可用规范化商户的交易拒绝该动作。
规则写入以服务端读取到的 rule version 做 optimistic guard，并与当前交易改为 `RULE` 来源、
清除 review 状态放在同一 D1 batch；竞争的交易或规则版本返回 409。响应返回更新后的交易、规则及
`historicalTransactionsChanged: 0`，数据库语句只允许更新路径中的当前交易。既有同商户历史交易
保持不变，之后进入账本的新交易才由 7.3 的 exact active-rule 查询自动命中。

规则设置 API 使用 `GET/POST /api/v1/merchant-rules` 与
`PATCH /api/v1/merchant-rules/:id`；停用是 versioned `active: false` 更新，不物理删除。
`GET /api/v1/merchant-rule-previews` 接收 allowlisted `displayMerchant` 与 `categoryId` query，
以同一 normalization 算法返回规范化键、可能冲突的现有 exact rule、匹配历史数量、分类冲突数量和
固定的 `historicalTransactionsChanged: 0`，且不写数据库。列表使用 `updated_at, id` opaque cursor。
创建遇到相同规范化键、更新导致键碰撞时返回 409；更新 version 竞争返回 409。所有创建、更新与停用
响应都附带当前规则影响计数，但首版规则管理 SQL 绝不包含历史交易 UPDATE。

统一待确认队列使用只读 `GET /api/v1/review-queue`，将未分类商户、信息不足的 e-Transfer、
`PENDING_REVIEW` 歧义内部转账和 active exact rule 与历史交易当前分类不一致的规则冲突投影为
discriminated union。分类待办以交易为资源，歧义转账以 match 为资源，规则冲突同时返回交易和命中规则；
队列查询本身不写数据库。人工 `MANUAL` override 不视为规则冲突；已经带有未分类或 e-Transfer
review 标记的交易也不重复投影为规则冲突。歧义转账与分类待办可以并存，因为二者需要不同的 owner
决策。列表按 `posted_date DESC, item_id DESC` 排序，使用与可选 `type` 筛选绑定的 opaque cursor；
响应 count snapshot 始终返回完整未解决队列的四类数量与总数，不因当前筛选或分页而改变。

### 8. Reporting contract

默认时区为 `America/Toronto`，按 `posted_date` 落入自然月、自然季度和自然年。支持当前/上一周期以及自定义日期范围。所有 report endpoint 复用一套口径：

- `income`：收入类别的 inflow 减去同类 outflow。
- `net_spending`：支出类别的 outflow 减去同类 inflow（退款）。
- `net_cash_flow = income - net_spending`。
- 内部转账、removed 和 pending 始终排除。
- 环比/同比在前一周期为 0 时显示 `N/A`，不生成无穷百分比。

报表至少提供：总览指标、月度趋势、分类分布、商户排行、账户/类别/商户 drill-down，以及与上月/上季度/上年同口径比较。图表必须附可读数据表、明确单位和键盘可访问说明，不只靠颜色表达正负或分类。

不做汇率换算。CAD 默认展示；其他币种单独分组并明确标记，不能把 USD 数字直接加进 CAD 总数。未来如果需要汇率，必须作为新的明确需求设计数据来源和重算策略。

报表查询使用 allowlisted `grain=MONTH|QUARTER|YEAR|CUSTOM`。自然周期分别要求
`period=YYYY-MM`、`period=YYYY-Qn` 或 `period=YYYY`；自定义周期只接受 `dateFrom`/`dateTo`，
含首尾最多 730 天。自然周期解析为 `America/Toronto` 的日历起止日期；由于账本持久化的是银行
date-only `posted_date`，查询按解析后的 inclusive date boundary 执行，不用 Worker 当前 UTC 时间推断归属。
共享 cash-flow population 只读取 `POSTED` 且没有 `AUTO_CONFIRMED`/`CONFIRMED` 内部转账匹配的交易，
再按 category kind 与 currency 独立使用 integer minor units 计算指标。

每个指标的环比/同比返回当前值、基期值、integer minor-unit 绝对变化，以及整数
`percentageChangeBasisPoints`（`10000 = 100%`）；基期为 0 时该字段为 `null`，由 UI 显示 `N/A`。
对可能为负的净指标，百分比以基期绝对值为分母，使变化方向由绝对变化的符号决定。自然周期比较上一
自然周期和去年同周期；CUSTOM 的上一周期是紧邻的等长 inclusive range，去年同期将两个边界各向前
一年并把闰日夹取到目标月末。

`GET /api/v1/reports/spending` 复用上述 period grammar，并只接受 allowlisted
`accountId`、`categoryId`、`currency`、exact `normalizedMerchant`、`merchantMissing=true` 和
`merchantLimit`（默认 20，范围 1–100）筛选；`normalizedMerchant` 与 `merchantMissing` 互斥。
响应按 currency 返回 section。每个 section 的 `netSpendingMinor` 与 category distribution 都只使用
`EXPENSE` 类别，并以 outflow 减 inflow 计算，因此退款可以使行值或 section 值为负；category rows
按净支出降序、category id 稳定排序并精确相加为该 section 的净支出。未分类记录不冒充支出类别，仍由
review queue 处理。merchant ranking 使用相同 expense population，按 exact normalized merchant key
分组；没有 normalized merchant 的记录组成显式 missing-merchant 组。排行按净支出降序和稳定 key 排序，
只返回 `merchantLimit` 行，同时返回未截断的 merchant group 总数。

每个 category/merchant row 返回可直接序列化为 `GET /api/v1/transactions` query 的 `drillDown` keys：
解析后的 date boundaries、currency、可选 account/category/exact merchant 或 missing-merchant 条件，以及
allowlisted `reportMetric=NET_SPENDING`。该交易筛选固定为 `POSTED`、category kind `EXPENSE`、且没有
`AUTO_CONFIRMED`/`CONFIRMED` 内部转账匹配；它仍保留原始 direction/amount，使调用方以 outflow 减
inflow 对 drill-down rows 求和时与展示行精确一致。普通交易查询和 drill-down 共用同一 strict parser、
prepared-statement repository 与 cursor scope；未知、重复、互斥或与 report metric 冲突的参数在查询前
返回 422，外部筛选值不得进入 SQL fragment。

`GET /api/v1/reports/cash-flow` 使用同一 period grammar 和
`accountId`/`categoryId`/`currency`/exact merchant filters；这些筛选原样应用于 current、previous
period 和 previous year 三个范围。响应以 `sections[]` 为唯一 monetary 容器，每个 section 明确携带
一个 ISO currency、current 的 income/net spending/net cash flow，以及该 currency 的 previous-period
和 previous-year metric comparisons。若某币种只出现在基期，current 值显式为 0；若只出现在 current，
基期值显式为 0 且百分比为 `null`。接口不得返回跨币种 `total`、`grandTotal` 或默认 CAD 汇总字段；
`currency=CAD` 只筛掉其他币种，绝不换算。spending endpoint 同样只返回逐币种 sections，因此任何
需要同时展示 CAD/USD 的 UI 必须保留独立单位和数值。

两个 report endpoint 的 `meta.freshness` 使用同一 server-generated snapshot：`generatedAt`、固定首版
60 分钟 freshness window、整体 `isStale`，以及所有至少有一个 enabled account 的 connection 列表。
每条 connection 元数据只返回内部 id、institution display name、sanitized health status/next action、
`lastSuccessAt` 和逐连接 `stale`；不含 account mask、cursor、provider error、token 或交易文本。最后成功时间
为空、早于 `generatedAt - 60 minutes`，或连接处于 `ACTION_REQUIRED`/`ERROR`/`DISCONNECTED` 时视为 stale；
有近期成功记录的 `SYNCING` connection 不因正在同步而单独标 stale。没有 enabled account 的 connection
不影响报表 freshness。任一纳入连接 stale 时整体 `isStale=true`，UI 必须显示警告和实际 last-success 值，
不能把报表暗示为已完整同步。

### 9. UI information architecture

界面采用 mobile-first 响应式布局。手机底部导航为“概览、交易、分析、设置”；桌面改为侧边导航，保持相同信息结构。

manual-first 修订新增主动作“记一笔”及独立 `/add` route：手机底部导航使用五个等宽项目并把“记一笔”置于中心，桌面侧栏使用同名普通导航项。PWA manifest 的 `start_url` 固定 `/add`、`scope` 为 `/`、`display` 为 `standalone`，并提供 192/512 PNG 与 Apple touch icon；HTML 使用 `viewport-fit=cover`。这只缩短打开路径，不改变 Access cookie 或 Service Worker 的 network-only 财务策略。

`/add` 首屏按触摸顺序只突出金额、商户/描述和账户；账户默认 `RBC Credit`，摘要行显示 Toronto 今天、CAD、支出并可展开修改完整字段。字段字号至少 16px，触控目标至少 44px。提交成功且规则已分类时清空金额/描述并把焦点返回金额；未知商户已经成功保存为 unclassified 后，同一页立即显示最多两个建议按钮和“其他类别”搜索，焦点移动到 confirmation heading。建议选择、已有类别搜索、新类别二次确认和“稍后确认”均使用原生 button/form/fieldset 语义；失败保留当前输入，不将金额、商户或草稿写入 browser storage。

**概览**首先显示同步健康状态、最后成功时间和需要用户处理的数量；其次显示本月收入、净支出、净现金流及近 6 个月趋势。连接异常必须比装饰性图表更醒目。

概览并行读取 strict-schema validated connection read model、`review-queue?pageSize=1` 的全量 count，以及按
Toronto 当前月份计算的 cash-flow reports。六个月趋势不发六次请求：只请求当前月、前两月、前四月，分别
使用每份报告的 current 与 previous-period reference 还原连续六个月。所有读取显式 `cache: no-store`，失败
只显示共享 error/retry state；连接 action-required（可有多条）和实际 last-success time 排在 review count、
本月指标与趋势之前。指标和趋势始终按 currency 独立 section/table 呈现，不生成跨币种总计。

**交易**在手机使用紧凑列表、桌面使用表格；筛选条件写入 URL，包含日期、账户、状态、类别、分类来源和 `needs review`。每行显示商户/描述、金额、账户、日期、pending 状态与分类来源 badge；详情抽屉提供原始字段、修改类别和转账决定。

交易页以当前 `location.search` 为唯一筛选来源，补齐 `pageSize=25` 与 `POSTED_DATE_DESC` API 默认值但不把
默认值强写回地址。应用筛选时只替换受控字段并清除 cursor，保留 report drill-down 的
`normalizedMerchant`/`merchantMissing`/`reportMetric` 等合法参数；next cursor 写入 URL，previous 使用浏览器历史。
响应必须通过 `transactionListResponseSchema`。同一数据在小屏呈现 semantic list、桌面呈现 table；商户/描述
只作为 React text node，金额保留 currency，badge 分别表达 ledger source、lifecycle status 和
categorization source，不能仅靠颜色。当前 read model 没有 category display name，因此 UI 不显示内部 category
id 冒充名称；高级 URL 筛选可保留 account/category id，待 taxonomy read endpoint 提供正式名称后再生成选项。

交易详情使用 `/transactions/:id` 独立路由并保留“交易”主导航语义。它并行读取 strict-schema validated
transaction detail、完整 category taxonomy 和 session CSRF token（token 仅用于写入且不持久化）；原始描述、
allowlisted payment metadata、pending/posted lifecycle、当前 category/source/rule、review reason、category audit
和 transfer match 均以文本与语义化 definition list/timeline 呈现。类别选择器只允许 active、editable owner
category；“只改这一笔”调用 versioned transaction PATCH，“以后这个商户都这样”调用 versioned exact-rule PUT，
并明确说明历史交易不会变化。写入成功后重新读取详情以展示数据库追加的 audit；409/422/网络失败不做乐观伪成功。
transfer decision 按 match 当前状态显示 confirm/break/ignore 可用动作，提交 match version，成功后同样重新读取。

待确认工作台使用 `/transactions/review` 子路由和 strict `reviewQueueResponseSchema`，URL 中仅保存 allowlisted
`type` 与 cursor，顶部四类计数始终来自未过滤 snapshot。每个卡片只操作其自身 transaction 或 transfer match：
未分类商户、信息不足 e-Transfer 和规则冲突提供同样明确的单笔 override/future exact-rule 两种作用域；歧义转账
提供 confirm/ignore。未分类卡片显示交易 `posted_date`，不虚构银行 CSV 未提供的时分；界面显示实际 payment metadata、
命中规则与成对交易，写入后重新读取队列并让已解决项消失。
首版没有 select-all、批量按钮或隐式历史 UPDATE；每张卡都重复说明 future rule 不改变历史交易。

`GET /api/v1/categories` 返回完整、按 kind/name/id 稳定排序的 owner/system taxonomy read model；响应包含 id、
正式名称、kind、system key、editable/active、timestamps/version。UI 用正式名称展示当前类别，同时以 editable/active
约束纠错目标，绝不允许客户端把 system category 当作可编辑 owner category 提交。

**分析**提供月/季度/年切换、周期导航、现金流趋势、类别分布和商户排行。点击图表或表格行跳转到带同样筛选条件的交易页。

分析页以当前 URL 为查询状态：`grain=MONTH|QUARTER|YEAR|CUSTOM`，自然周期使用对应的
`period`，自定义周期使用 `dateFrom`/`dateTo`，可选 `accountId` 来自连接 read model 中已启用账户。
缺少或非法的 URL 周期在客户端安全回退到 Toronto 当前自然月，但不会把默认值强写回地址；切换粒度、
应用自定义日期或账户筛选时清除不再适用的参数。自然周期提供上一期/下一期导航，自定义周期明确显示
起止日期并通过表单应用。现金流与 spending report 以严格响应 schema、`cache: no-store` 并行读取，
任一失败只进入共享 error/retry state，不能混用部分新旧结果。

趋势保持与当前分析粒度一致：月视图展示截至所选月份的连续六个月，季度视图展示截至所选季度的连续
四个季度，年视图固定展示所选年一月至十二月（没有该币种交易的月份补零），自定义视图展示去年同期、
紧邻上一等长周期和当前周期。为避免月/季度视图逐点请求，客户端复用 cash-flow response 的 current 与
previous-period reference；年视图请求偶数月的六份月报来还原完整十二个月。所有趋势点仍按 currency
独立成组，不生成跨币种汇总。

指标同时显示上一周期与去年同期的绝对变化及百分比；服务端百分比为 `null` 时固定显示 `N/A`。
现金流趋势、类别分布和商户排行使用轻量比例条作为视觉辅助，并始终附同一数据的语义化 table；正负值、
类别和币种同时以文字、符号和数值表达，不只依赖颜色。类别和商户行的交易链接只序列化服务端返回的
`drillDown` keys，再补交易页稳定默认排序，不由客户端重建报表口径。freshness stale 时在所有财务内容前
展示每个异常连接的实际 last-success 值。

**设置**包含四块：RBC/BMO 连接和启用账户、类别与商户规则、手工录入/CSV 导入、完整导出。敏感操作（移除 Item、清空导入、删除手工交易）必须二次确认并说明影响。

订阅管理使用独立 `/subscriptions` route，并从概览待办与设置中可达；主导航沿用“设置”语义，不挤占手机底部的高频记账入口。页面 active plans 优先，逐条展示名称、金额/币种、账户、类别、cadence、next charge date 与最近 occurrence；paused/cancelled 以文字状态区分。表单支持 candidate confirm、manual create、versioned edit/pause/resume/cancel。单次“未发生”必须解释只移除该次实际支出、不自动取消计划。所有操作成功后重新读取 server state，不做无法回滚的乐观伪成功。

连接区并行读取 connection/category/rule read models，只在用户点击“连接”或“修复”时请求一次性 Link token
并按 Plaid 官方 Web SDK 要求直接从
`https://cdn.plaid.com/link/v2/stable/link-initialize.js` 懒加载 SDK；不自行托管、不把 Link token 或
public token 写入本地存储。`Plaid.create({ token })` 成功后，INITIAL flow 才以新的 idempotency key 将
public token 交给 `/plaid/items`，UPDATE flow 保留原 Item/access token 并只刷新 connection read model。
Link handler 在成功、退出或组件卸载后 destroy。生产 CSP 只为 Link 增加官方要求的 Plaid script/frame/connect
来源与 style 行为，普通账本 API 仍保持 same-origin；来源：`https://plaid.com/docs/link/web/`。

每个连接按实际状态显示 last success、next action、启用账户开关和单连接“立即同步”。账户开关提交当前
version，成功后重新读取；手工同步使用每次用户动作生成的独立 idempotency key，显示 QUEUED/RUNNING/
RETRY_WAIT/SUCCEEDED/FAILED/PAUSED 文字状态，不把创建成功冒充同步完成。连接 RBC/BMO 的按钮仍遵守每机构
默认一个 active Item 和额外 Item 明示确认；首版设置页不提供 Item removal。

分类与规则区把 category taxonomy 作为规则目标和手工录入目标展示；快捷录入允许显式创建唯一 owner expense category，其他 taxonomy 编辑仍不开放。规则创建先调用无写入 preview，展示 exact normalized key、现有冲突、匹配数量和
`historicalTransactionsChanged: 0`，用户再明确保存。规则列表支持 versioned 类别修改与停用，停用按钮明确
说明历史交易不会重分类；不提供无预览的批量修改。

完整手工录入仍提交日期、描述、金额、方向、币种、账户显示名和 active editable 类别；`/add` 快捷录入只要求金额与商户/描述，默认 Toronto today、CAD、OUTFLOW、`RBC Credit`，其余字段可展开修改。成功后显示稳定 transaction id；若没有 exact rule，则交易已按 Unclassified 保存并立即显示最多两个建议及“其他类别…”搜索/显式创建流程。CSV 导入先在浏览器读取用户明确选择的文件、提取 header 供 generic mapping 或识别 RBC native adapter，并以 Base64 调用 preview；页面显示全量 counts、有界 preview rows、所有 action-required `reviewRows`、行错误和是否截断。每个 `SUSPECTED_EXISTING` 或 `SUSPECTED_SAME_FILE` 行必须逐行选择合并/作为新交易/跳过后才能 commit，commit 使用新 idempotency key；invalid 和未决定行不能由客户端强制提交。原始文件内容、preview 与 commit 结果都不进入 local/session storage。

导出区使用普通同源下载链接直接请求 CSV 与完整 JSON，浏览器不解析或缓存响应。CSV 链接代表当前全账本默认
筛选；从交易页进入的筛选导出仍由交易 URL 另行序列化。JSON 文案明确其可恢复用途与敏感性。设置页所有写入
共享 session-bound CSRF、strict response schema、loading/error/success 状态；局部写入失败只影响对应区块。

所有页面都必须有 loading、empty、error、stale/offline 状态；网络失败不能把旧数据伪装成刚同步的数据。触控目标、焦点顺序、对比度和表单 label 以 WCAG 2.1 AA 为最低标准。首版不为了视觉效果引入动画或大面积卡片网格。

这些状态复用同一 `DataState` 语义组件：loading 使用 `aria-busy`，error/action-required 使用 alert，empty、
stale、offline 使用 polite status；stale 必须显示实际最后成功时间，offline 固定说明不会显示缓存交易。
浏览器监听 online/offline 事件，断网时保留当前页面标题和导航，但用 offline state 替换数据区。

Service Worker 只对同源 navigation 使用 network-first app-shell 策略，只对带 content hash 的
`/assets/*` script/style/font/image 使用 network-first static cache。`/api/*`、`/exports/*`、所有非 GET、
跨域和未版本化资源固定 network-only，并以 `cache: no-store` 发起；即使上游误配缓存头也不会进入 Cache
Storage。候选响应仍须成功且不含 `no-store`、`no-cache` 或 `private` 才能写入。离线时只可返回无账本数据的
应用壳或最小离线 HTML，不能缓存或回放 API、导出、交易快照；Worker API/导出响应的 `Cache-Control:
no-store` 保持为独立第二层防护。

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
| `POST /api/v1/transactions` | 新建完整或 quick 手工交易；category 可选，返回是否需要确认 |
| `PATCH /api/v1/transactions/:id` | 纠正类别/字段，要求 version |
| `GET /api/v1/transactions/:id/category-suggestions` | 返回最多两个只读、可解释的 active category 建议 |
| `PUT /api/v1/transactions/:id/merchant-rule` | 保存 exact future rule 并只修正当前交易，要求 version |
| `POST /api/v1/transactions/:id/transfer-decision` | 确认、拆除或忽略内部转账匹配，要求 match id 与 version |
| `GET/POST /api/v1/merchant-rules` | cursor 查询或创建 exact merchant rule |
| `PATCH /api/v1/merchant-rules/:id` | versioned 更新或停用 merchant rule |
| `GET /api/v1/merchant-rule-previews` | 无写入地预览 exact key、已有规则和历史冲突数量 |
| `GET /api/v1/review-queue` | 查询四类未解决待办、完整分类计数和 cursor pagination |
| `GET/POST /api/v1/categories` | 类别列表；显式创建唯一 editable owner category |
| `GET /api/v1/subscription-candidates` | 只读查询尚未确认的高置信度 recurring evidence |
| `GET/POST /api/v1/subscriptions` | 查询或创建 owner-confirmed subscription plans |
| `PATCH /api/v1/subscriptions/:id` | versioned 修改、暂停、恢复或取消 plan |
| `PATCH /api/v1/subscription-occurrences/:id` | versioned 标记单次 generated occurrence 未发生 |
| `GET /api/v1/reports/cash-flow` | 周期现金流与比较 |
| `GET /api/v1/reports/spending` | 类别/商户分布和 drill-down keys |
| `GET /api/v1/sync/status` | 每个 Item 的最近同步结果 |
| `POST /api/v1/sync-runs` | 触发幂等手工同步，返回任务状态 |
| `POST /api/v1/imports/csv` | 上传、校验和预览导入 |
| `POST /api/v1/imports/:id/commit` | 确认有效行并幂等写入 |
| `GET /api/v1/exports/transactions.csv` | 下载当前筛选交易 |
| `GET /api/v1/exports/data.json` | 下载完整可迁移数据 |

列表默认按 `posted_date DESC, id DESC`，使用 opaque cursor；page size 最大 100，含首尾日期的查询范围最大 730 天。过滤/排序字段必须 allowlist。普通 JSON 请求体最大 64 KiB；CSV preview 最大 5 MiB、4,000 行和 32 列；Plaid webhook 最大 256 KiB。创建连接、触发同步和提交 import 使用 idempotency key。连接交换只保存 public token 的 SHA-256 指纹和请求状态；不保存 public token，最终 connection 以唯一 idempotency key 关联请求，重复成功请求返回原结果，并发或 key/payload 冲突返回 409。写冲突返回 409 并带当前 version，校验失败返回 422，超出 body 上限返回 413，限流返回 429，第三方暂时失败返回稳定的 503 错误码。

应用 API 使用 Cloudflare Rate Limiting binding，按 Access session 与资源路由组合键在每个 Cloudflare location 限制为 60 次/分钟；公开 Plaid webhook 使用独立 binding，限制为 120 次/分钟/location。该 binding 是最终一致、按 location 的滥用缓解层，不承担精确计数、计费或幂等语义；`429` 响应带稳定错误码和 `Retry-After: 60`。

新增 contract 继续使用 strict Zod request/response schemas、统一 success/error envelope、prepared statements 和 same-origin CSRF。Quick create 的 `categoryId` 是 additive optional field；既有完整设置表单仍可传 category。Category create 只接受 `{ name, kind: "EXPENSE" }` 的首版 quick-flow contract。Subscription create/update 输入使用 integer-compatible decimal amount boundary conversion、ISO date、allowlisted cadence/status 和 optimistic version；服务端不接受客户端提供 occurrence transaction id、generated timestamp 或 next-version 值。

### 11. Import, export, and retention

CSV 导入采用“两阶段”：上传后只解析和预览，显示列映射、有效/无效/疑似重复行；用户确认后才写账本。首版支持日期、描述/商户、金额、方向、币种、账户显示名和类别；文件有严格大小、行数、编码和列数上限。使用 content checksum + canonical row fingerprint 防止同一批次重复提交；疑似重复不能静默删除，必须在预览中说明。

RBC native adapter 只在 header set 精确等于 `Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$` 时启用。它在 domain boundary 把 M/D/YYYY 转 ISO、把唯一非空 currency column 的 signed decimal 转为 absolute minor units + direction、把两个 description 安全合并，并把 Visa/Chequing 分别映射为 `RBC Credit`/`RBC Debit`。`Account Number` 与 `Cheque Number` 都不是匹配或持久化字段；尤其 column B 在 adapter 之后不能出现在 preview row、staging、日志、错误、fingerprint、checksum 或 export。RBC batch checksum 由 adapter version、非敏感 target account label 与 ordered canonical rows 计算，不 hash 原始 bytes，因此仅账户号变化不能改变 checksum。两个 currency column 同时有值或同时无值是 row error。

`POST /api/v1/imports/csv` 延续所有浏览器写请求的严格 JSON/CSRF 契约，请求体为
`{ fileName, contentBase64, mapping? }`。generic mode 的 `mapping` 以 canonical field 指向 exact CSV header name，
必须显式提供 `postedDate`、`description`、`amount`、`direction`、`currency` 和 `accountLabel`；只有 exact RBC header detection 可以省略 mapping，
可选 `merchant` 与 `category`；映射目标不得重复，未知请求字段或缺失/重复 CSV header 均返回 422。
Base64 只是为了在 JSON 安全边界内无损传递原始字节，不是持久化格式；解码后的 CSV 最大 5 MiB，
外层 JSON 另有覆盖 Base64 膨胀的固定请求上限。只接受可选 UTF-8 BOM 的严格 UTF-8、逗号分隔和
RFC 4180 风格双引号/双引号转义；解析器以有界 chunk 增量解码并单遍处理，不使用整文件
`split`。最多 4,000 个数据行、32 列，单元格和映射字段也有固定长度上限；超限、未闭合引号或
无效 UTF-8 在接触数据库前拒绝。

日期只接受真实的 ISO `YYYY-MM-DD`，金额只接受非负且最多两位小数并一次转换为 integer minor
units，方向只接受 `INFLOW|OUTFLOW`，首版导入币种只接受 `CAD|USD`。可选类别值只接受 active、
editable owner category 的 exact id 或 exact name，系统类别、停用类别和未知值为行级错误。预览为每行
返回稳定字段错误。没有 provider transaction id 时，每行 fingerprint 由 canonical business key 加该 key 在文件中的 occurrence ordinal 生成，因此同日同商户同金额的两笔都保留独立身份；后出现的相同行标成 `SUSPECTED_SAME_FILE` 供 owner 决定，不能静默删除。与现有账本的相似记录另标 `SUSPECTED_EXISTING`。

预览在 `import_batches`/`import_rows` staging 表中保存 canonical mapped row、fingerprint、错误和
30 分钟 expiry，原始 CSV 字节与原始文件名不落库。API 返回全量 valid/invalid/duplicate counts、
有界的前 100 行普通预览、全部 action-required `reviewRows`（仍受总行数 4,000 上限约束）、`rowsTruncated` 和 `ledgerTransactionsCreated: 0`。过期 preview 不能提交；
重复 preview checksum 可复用未过期结果。preview 阶段允许 staging 写入，但绝不写
`transactions`、分类审计、规则或转账决定，这就是该接口的 no-ledger-write 保证。

existing-ledger reconciliation 在 preview 时只产生 evidence，commit 时才改变关联。`AUTO_MERGE_EXISTING` 必须同时满足：canonical account label、currency、direction、amount 完全相同；候选 source 为 `MANUAL`；候选唯一且目标尚未被其他 committed import row 对账；并且 normalized merchant exact 相同且 posted date 相差不超过 3 天、双方命中同一 owner-confirmed exact rule 且日期在三天内，或 normalized description exact 相同且日期相同。若 transaction 关联 subscription occurrence，则还要求 canonical merchant exact、同一 calendar month 且实际日期距 scheduled date 不超过 3 天。少一项、多个候选、普通 CSV/PLAID target、金额变化或只有类别相同都降为 `SUSPECTED_EXISTING`。导入侧和目标侧必须全局一对一，提交时重新验证候选/版本，避免两个行或两个设备竞争同一 transaction。

commit 对 `AUTO_MERGE_EXISTING` 不创建 transaction，只把 `import_rows.transaction_id` 指向既有 canonical id，并记录 resolution/outcome `AUTO_MERGED` 与非敏感 evidence；保留既有 category/rule/manual description/source/version。owner 手工选择现有 transaction 时记录 resolution/outcome `OWNER_MERGED`。响应与 UI 显示 imported-new/auto-merged/owner-merged/skipped 摘要。歧义行继续要求显式选择，不能借“高置信度”静默删除。相同 import 重试重建同一 merge result。

`POST /api/v1/imports/:id/commit` 要求合法 `Idempotency-Key` header，并使用严格请求体
`{ version, reviewDecisions }`；每个 decision 只含 staging `rowNumber`、`IMPORT_NEW|MERGE_EXISTING|SKIP` 与合并时的 candidate transaction id/version。所有 `SUSPECTED_EXISTING` 和 `SUSPECTED_SAME_FILE` 行必须恰好有一个明确 decision，未知行、重复 decision、对非 review 行作 decision 或缺失 decision 均返回 422 且不写账本。`VALID` 行固定导入，`INVALID` 固定跳过；相同可见值本身不是固定跳过理由。

commit 只接受仍未过期、status 为 `PREVIEWED` 且 version 匹配的 batch；过期、stale version、
已经由其他 key 提交或并发占用均返回稳定 409。状态 guard、CSV transaction insert、按
canonical fingerprint 的冲突消解、`import_rows.transaction_id`/结果更新与 batch 最终
`COMMITTED`/version 更新必须在一个 D1 atomic batch 中完成，任何 guard/category/source 校验失败
都不得留下部分 transaction。CSV 新交易使用提交时的 active exact merchant rule；若没有显式 owner
category 或 exact rule，则归入系统 `Unclassified` 并进入 review。显式 category 在 commit 时再次验证
为 active/editable，避免 preview 后类别变化造成越权或错误分类。

首次成功响应返回 batch 的 content checksum、不可逆 source filename hash、committed time、version，
以及所有 staging 行的稳定 outcome（`IMPORTED_NEW`、`AUTO_MERGED`、`OWNER_MERGED`、`SKIPPED_INVALID` 或 `SKIPPED_DUPLICATE`）、关联
transaction id 与 duplicate evidence；这既是逐行结果也是可恢复的 source provenance。原始文件名仍
不落库，只持久化对 NFKC/trim 后文件名的 SHA-256。相同 batch + 相同 idempotency key 的重试从
持久化 batch/row 结果重建原响应并标记 `meta.replayed=true`，不重复建账；相同 batch 的不同 key 或
同一 key 被其他 batch 使用返回 409。commit request 最大 512 KiB，decision 最多 4,000 个。4,000 行上限为 D1 Free 每日 100,000 rows-written 保留索引、preview row、状态更新和正常同步余量；若部署指标显示单批写入仍接近额度，必须继续降低上限而不是升级付费计划。

交易 CSV 导出与当前筛选一致。`GET /api/v1/exports/transactions.csv` 接受交易列表相同的
`accountId`、`categoryId`、`categorizationSource`、`currency`、`dateFrom`、`dateTo`、
`merchantMissing`、`needsReview`、`normalizedMerchant`、`reportMetric`、`source`、`status` 和
`sort`，但拒绝 pagination-only 的 `cursor`/`pageSize`、未知键与重复键；日期范围仍含首尾最多
730 天。列表与导出必须调用同一个 prepared-statement filter builder，导出只改变投影并以同一
allowlisted sort 维持稳定顺序。导出一次最多 10,000 行，repository 读取第 10,001 行作为超限证据；
超限时返回 413 JSON error，不能返回截断文件。序列化后的 UTF-8 文件最多 16 MiB，超限也在发送
任何 CSV body 前返回 413。

CSV 固定使用 UTF-8、RFC 4180 双引号规则和 CRLF 行结束符，首行稳定为：
`transaction_id,posted_date,authorized_date,status,direction,amount_minor,amount,currency,account_id,account,description,merchant,normalized_merchant,category_id,category,categorization_source,category_rule_id,category_rule_merchant,plaid_pfc_primary,plaid_pfc_detailed,plaid_pfc_confidence,source,needs_review,review_reason`。
`amount_minor` 是无损往返的权威非负整数，`amount` 是当前 CAD/USD cents 模型下固定两位小数的
可读表示，方向保持在独立 `direction` 列；account/category/rule 同时携带稳定 id 与导出时显示值，
Plaid 分类 provenance 只投影 allowlisted PFC 字段。`null` 显示值输出为空单元格，boolean 使用
`true|false`。成功下载直接返回 CSV body（不包 JSON success envelope），并设置
`Content-Type: text/csv; charset=utf-8`、受控日期文件名的 `Content-Disposition: attachment` 和
`Cache-Control: no-store`；投影不读取 Plaid transaction/access token、连接 secret、Access/CSRF、
webhook 或加密材料。

所有 string cell 在 RFC 4180 quoting 前执行可逆 spreadsheet neutralization：原值首字符为
`=`, `+`, `-`, `@`, tab 或 carriage return 时添加一个 ASCII apostrophe；原值本来以 apostrophe
开头时将第一个 apostrophe 加倍。对应 restore 规则先把双 apostrophe 还原为单 apostrophe，否则只在
apostrophe 后紧跟上述危险字符时移除新增 apostrophe。这样既不会让公式 marker 成为 CSV 单元格首字符，
也能逐字符恢复原始文本（包括原生 apostrophe、逗号、双引号和换行）。

完整 JSON 导出使用 `GET /api/v1/exports/data.json`，只接受无 query parameter 的 `GET`，成功时直接
返回 JSON 文件（不包 API success envelope），并设置
`Content-Type: application/json; charset=utf-8`、受控日期文件名的
`Content-Disposition: attachment` 和 `Cache-Control: no-store`。repository 必须以一次 D1
transactional `batch()`、显式列 allowlist 和稳定 id 顺序读取完整快照；不得逐表执行彼此独立的读取。

新增 subscription 数据后，当前完整导出为 v2 strict object：
`{ exportKind: "PERSONAL_LEDGER_FULL", schemaVersion: 2, exportedAt, timezone, recordCounts, data }`。
`recordCounts` 与 `data` 中十二个数组逐项对应；在 v1 的十个集合基础上增加：

- `subscriptions`：portable plan fields、status、next charge date、last safe error code、times/version；不含 scheduler lease。
- `subscriptionOccurrences`：plan、scheduled date、canonical transaction、generated/not-charged status、owner decision time/version。

其余 `data` 固定包含：

- `connections`：只含内部关系 id、institution id/name、created/updated time 和 version；这是 restore
  重建 provider-neutral 本地连接所需的显示/关系数据，不含 provider Item、状态或同步状态。
- `accounts`：内部 id/connection id、display name、type/subtype、currency、enabled、times 和 version。
- `categories`、`merchantRules`：完整 owner/system taxonomy 和 exact rule 的关系字段、状态、times/version。
- `transactions`：稳定关系 id、source/provider transaction identity、pending/import provenance、状态/日期、
  非负 integer `amountMinor`、direction/currency、ledger description/merchant、allowlisted payment metadata、
  分类 provenance、review 状态、times/version；不含 provider decimal duplicate。
- `categoryAudits`、`transferMatches`、`transferMatchAudits`：分类与转账决定的稳定关系、结构化 evidence、
  原/新状态与 append-only times/version。
- `importBatches`、`importRows`：只含已 `COMMITTED` batch 及其 canonical row、校验结果、不可逆
  content/source filename hash、关联 transaction 和 times/version；未提交 preview staging、原始文件名与
  commit idempotency key 不属于可恢复账本，不能导出。

所有对象和嵌套对象都由版本化 strict schema 校验，未知字段使生成失败。JSON `null` 保留缺失语义，金额
只使用 integer minor units + currency，时间使用带 offset 的 ISO timestamp，ledger date 使用 ISO date。
导出投影绝不读取或输出 Plaid access/public token、client secret、provider account/item secret identity、
账户 mask、Access assertion/cookie、CSRF secret、token encryption key/IV、同步 cursor/run/request、webhook
payload 或日志。自动化测试既检查 strict schema，也用带辨识度的 secret fixture 验证输出内容和键名均不泄漏。

每个集合最多 50,000 条，所有集合合计最多 100,000 条，序列化 UTF-8 文件最多 32 MiB。查询每个集合
读取上限加一条作为超限证据；任一单集合、总记录数或最终字节数超限均在发送文件 body 前返回 413 JSON
error，绝不静默截断或返回部分快照。任何 batch、映射或 schema 校验失败均返回 500 且不返回局部数据。

本地恢复使用 `npm run db:restore -- --input <export.json> --persist-to <new-directory>`。命令固定调用
当前仓库的 Wrangler、`DB` binding、migration 目录和 `--local`；不接受 database/config/remote 等可改变
目标的参数。`--persist-to` 必须显式提供、不得是默认 `.wrangler/local-d1`，并且目标路径在开始时必须
不存在；这同时证明恢复目标是独立空库并避免误覆盖现有本地或远程数据库。失败时保留隔离目录供检查，
不自动删除或重试到其他目标。

命令在创建目标前先以 32 MiB 上限和 fatal UTF-8 解码读取文件，再通过 versioned strict schema、record counts、
集合内唯一 id、全部外键关系、source identity、account type/subtype、system category、pending relationship
无环等恢复前校验。未知 schema version、未知字段、悬空关系、重复 id 或秘密字段在任何数据库写入前失败。
随后只对新目标应用当前 ordered migrations；migration 自带的 `TRANSFER`/`UNCLASSIFIED` system categories
必须与导出逐字段一致，editable seed categories 在无业务记录的 pristine target 中清除后由导出版本重建。

restore 必须继续接受既有 v1 export，并把缺失的 subscription collections 解释为空；新生成 export 只输出 v2。恢复 SQL 只由固定 allowlisted INSERT 模板组成。所有外部 string/JSON 先编码为 UTF-8 hex 并以
`CAST(X'...' AS TEXT)` 写入，整数/boolean/null 分别做类型化编码，不把原始输入拼成 SQL token。
transactions 按 pending dependency 拓扑排序，其他集合按 connection/account、category/rule、transaction、
category audit、transfer match/audit、committed import batch/row 的外键顺序写入。provider-neutral connection
使用唯一 `restored-local-item:<id>`、不可解密的非空占位 ciphertext/IV、`DISCONNECTED` 状态和空 cursor；
account 使用 `restored-local-account:<id>` 且无 mask。这样恢复库可以离线查询和报表，但不能误触发银行同步。
import commit idempotency/preview expiry 使用 `restored-local-import:<id>` 与 committed time 合成，不恢复原秘密或
临时 staging 状态。

Wrangler 负责 `d1 execute --file` 的原子导入；SQL 文件不包含 D1 不支持的手写 `BEGIN/COMMIT`。成功后命令
必须执行 `PRAGMA foreign_key_check`，并将当前 schema 的 portable collection count、category/rule/audit/transfer/import/subscription
关系完整性和按 currency 的全账本 `income`/`netSpending`/`netCashFlow` integer totals 与源导出本地计算值
逐项比较。任一差异使命令非零退出，只有全部一致才输出 machine-readable recovery evidence 和成功提示。

D1 migration 纳入版本控制。唯一文档化的远程 migration 入口是
`npm run db:migrate:remote -- --input <recent-export.json> --persist-to <new-directory>`；它默认仅执行门禁检查，
不连接远端。只有另行获得远程变更授权后显式附加 `--execute`，同一个进程才会在门禁成功后调用固定的
`wrangler d1 migrations apply DB --remote --config apps/web/wrangler.jsonc`，且不接受 database、config、remote
或其他透传参数。

门禁要求导出的 `exportedAt` 不早于 24 小时且不得超过当前时间 5 分钟，先记录所有 ordered `.sql`
migration 的 filename/content SHA-256 manifest digest，再调用上述 local restore 命令恢复到显式提供、开始时不存在
且不是默认 `.wrangler/local-d1` 的隔离目录。restore 子进程必须零退出，并返回与输入 schema version 对应的 strict machine-readable
evidence；其中 foreign-key/relationship violation 必须为零，portable collection counts 和按 currency report totals
必须是合法整数结构。门禁随后重新计算 migration digest，防止恢复与远程执行之间 migration 集合被修改。

作为可审计提示，门禁在去除 SQL comments/string literals 后识别并列出 data-destructive statement：
`DROP TABLE`、`ALTER TABLE ... DROP COLUMN`、`DELETE`、`UPDATE`、`REPLACE`/`INSERT OR REPLACE`、`TRUNCATE`
和 `PRAGMA writable_schema`。无论本次集合是否识别到这些 token，远程入口都要求新鲜 export/restore evidence；
因此分类器漏掉新语法不会绕过恢复门禁。检查模式输出 migration digest、破坏性 migration 文件名、export
digest 和 restore evidence 后以零退出结束；任一校验、恢复、digest 或远程命令失败均非零退出，且绝不退回到
直接 remote 调用。D1 平台恢复能力只是辅助，不能替代用户可持有的开放格式导出。

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
