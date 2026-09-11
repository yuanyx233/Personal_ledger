# Personal Ledger

单用户个人账本：React/Vite 前端、一个受登录保护的 App Worker、一个 D1 数据库。

保留 CSV 预览与导入去重、手动记账、流水查询、分类与商户规则、按币种汇总、CSV/JSON 导出。没有 Plaid、银行同步、订阅定时生成、自动转账配对或独立审核队列。明确的信用卡还款在导入时自动归为 Transfer，其他转账由用户选择类别，不计入收入或支出。

主页显示本月收支和按类别划分的支出饼图，附每个类别的金额与占比，可点击查看交易明细；不同币种分开呈现，负净支出显示为净退款，不纳入饼图扇区。主页不再显示月度趋势对比。

CSV 提交时自动分类：优先采用文件中的明确类别和你的精确商户规则，再沿用已识别的同品牌商户规则或内置常见商户类别。Amazon 订单号、T&T 门店号等变化不需要逐笔设置。规则冲突或未知商户保留待分类；退款保留入账方向并冲减对应消费类别。分类与导入一并完成，不需要额外操作，重导不会改写既有分类。

记一笔时可勾选「分摊 / 报销抵扣」并填写抵扣金额。例如付款 300、抵扣 200，保留付款记录，个人消费统计为 100。另录收款时选择「这是分摊 / 报销回款」，回款部分不计入收入，也不会再次抵扣消费。EMT 不自动标记。已入账交易可在详情中修改或取消抵扣，JSON 备份和 CSV 导出会保留抵扣金额。

分析页的月视图可查看各类别净支出与占比，并在全部账户视图设置 Goal 月度预算上限。预算按类别和币种分别保存，从所选月份沿用至下一次设置，修改不影响更早月份；零表示不计划支出，取消表示不设上限。使用额扣除退款和报销抵扣，不含转账。完整 JSON 备份格式 v3 保留预算历史，也可恢复原有 v1/v2 备份。

## Workspace

- `apps/web`：前端页面和后端 API。
- `packages/domain`：校验、金额、CSV 与汇总逻辑。
- `packages/persistence`：D1 查询与备份恢复。

## 本地运行与检查

使用 Node.js `24.17.0`、npm `11.11.1`（见 `.nvmrc` / `.node-version`）。

`apps/web/.env.example` 只包含浏览器公共配置；`apps/web/.dev.vars.example` 只列登录与 CSRF 密钥占位符。真实密钥不入库。

```bash
npm ci
npm run verify
npm run db:migrate
npm run db:seed
npm run db:verify
```

本地 D1 使用被忽略的 `.wrangler/local-d1`，seed 为合成数据。以上数据库命令不操作远端。

## 历史数据与备份

旧流水、分类、历史转账结果和导入记录保留。旧 migration 和备份格式中的兼容表暂不删除；它们不再驱动银行同步或订阅任务。

在设置页下载完整 JSON。CSV 便于查看，但不能替代完整备份。恢复只写入一个尚不存在的独立本地目录：

```bash
npm run db:restore -- --input ./ledger-export.json --persist-to /tmp/ledger-restored-d1
```

远端迁移前置检查（不执行远端变更）：

```bash
npm run db:migrate:remote -- --input ./ledger-export.json --persist-to /tmp/ledger-preflight-d1
```

提交、部署、远端迁移及删除已部署的旧同步服务均需另行明确授权。本次代码精简不会修改线上资源。

参见[部署说明](./docs/free-preview-deployment.md)与[备份恢复说明](./docs/data-recovery-and-domain.md)。
