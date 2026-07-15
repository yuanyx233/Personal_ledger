## Why

现有记账方式需要在每次消费后手工录入，且难以在所有设备上统一查看。需要一个自用、单用户、当前软件与托管成本为零的 Web/PWA，通过 RBC 与 BMO 流水自动形成可纠正、可追溯的账本，并提供月度和年度分析。

## What Changes

- 新建一个以免费 `workers.dev` 地址运行的响应式 Web/PWA，手机、平板和电脑使用同一份数据。
- 通过 Plaid Trial 以只读 Transactions 权限连接 RBC 与 BMO，并且只允许选择 chequing 与 credit card 账户。
- 自动同步 posted 与 pending 流水，处理 pending 转 posted、删除与重复事件，并在连接失效时引导使用 Plaid update mode 修复，而不是创建重复连接。
- 建立统一账本，支持手动录入现金或其他未同步交易；Amazon 等订单按整笔交易记录，不提供拆分记账。
- 自动排除自己的 chequing 与 credit card 之间的还款和其他内部转账；外部 Interac e-Transfer 保留为收支，信息不足时进入待确认队列。
- 提供透明的商户自动分类：显示分类来源和命中的规则，允许只改当前交易或保存未来商户规则，并保留变更审计信息。
- 提供按月、季度、年度的收入、支出、净现金流、分类占比、商户排行、环比和同比分析。
- 支持 CSV 导入以及 CSV/JSON 完整导出，确保 Plaid 或免费托管政策变化时数据仍可迁移。
- 使用单用户访问控制保护界面与 API；银行密码不进入应用，Plaid token 和应用 secrets 不暴露给浏览器或日志。
- 首版不包含 savings、investment、loan、预算规划、多用户、邮件通知、交易拆分和付费 AI。

## Capabilities

### New Capabilities

- `single-user-access`: 单用户身份验证、会话保护以及受保护的 Web/API 访问。
- `bank-account-sync`: RBC/BMO chequing 与 credit card 的选择、连接、增量同步、刷新和断连修复。
- `transaction-ledger`: 自动与手动交易的统一账本、状态处理、去重、转账排除和 e-Transfer 处理。
- `merchant-categorization`: 可解释的初始分类、商户规则、人工纠正、待确认队列和分类审计。
- `financial-reporting`: 月度、季度、年度的现金流、分类、商户和趋势分析。
- `data-portability`: CSV 导入、CSV/JSON 导出以及可恢复的数据备份出口。

### Modified Capabilities

<!-- No existing capabilities are modified. -->

## Impact

- 新建 Cloudflare Workers + React/Vite 应用、Cloudflare D1 数据库和定时同步处理器。
- 新增 Plaid Link、Transactions Sync、Transactions/Item webhooks 与 update mode 集成。
- 新增单用户访问策略、Plaid webhook 验签、secret 管理、输入校验、审计与速率限制。
- 新增交易、账户、连接、同步游标、分类规则、分类审计和导入批次等持久化数据。
- 依赖 Plaid 与 Cloudflare 当前免费计划；不得自动升级到付费计划，超出免费能力时应安全失败并保留手动录入与导出路径。
