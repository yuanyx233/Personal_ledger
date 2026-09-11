## Context

现有 React 分析页支持月/季/年及类别净支出，D1 报表已经扣除报销抵扣、退款并排除转账。新增预算复用这些口径。

## Goals / Non-Goals

Goals: 月度类别支出占比，按类别/币种持久化预算，剩余/超支展示，历史月份稳定，完整备份恢复。

Non-Goals: 存钱目标、推送提醒、预算结转、自动换汇、远端部署。

## Decisions

- 表 `category_budgets` 使用 category_id/currency/effective_month 复合主键，金额以分保存；null 表示从该月取消。读取所选月份之前最新设置，避免修改新月份时覆盖历史。
- GET `/api/v1/budgets?month=YYYY-MM` 返回生效设置；PUT 同一路径接收 categoryId/currency/effectiveMonth/amountMinor。复用现有访问验证、CSRF、请求体限额。仅活跃 EXPENSE 类别可写。
- Goal 区在月视图展示。使用全部账户的该月报表；有账户筛选时隐藏预算并解释须切回全部账户，避免拿单账户支出比较总预算。空月份也允许设置。
- 类别占比使用正净支出之和为分母；净退款显示“净退款”，无正支出时显示“—”。明确口径，避免负值扭曲比例。
- JSON 格式升至 v3，保留读取 v1/v2，并在无预算旧备份中补空集合。导出和恢复同样包括取消记录。
- 无预算时用户自行填写，绝不生成真实预算默认值。币种可从 CAD/USD 及已有交易/预算币种选择。

## Risks / Trade-offs

- 默认跨月沿用是已告知的假设，用户可继续调整需求；在表单中清楚说明生效范围。
- 写入某月只修改该月设置；已单独设置的后续月份保留，页面文案明确此行为。
- 数据库迁移需先于上线代码；此次只验证独立本地测试库。

## Migration Plan

新增 0019 表，不改交易。经明确上线授权后先备份再迁移。回滚应用时保留预算表与 v3 备份。

## References

- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)：复用 prepare/bind 与已有批量快照读取。
- [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html)：类别检查与预算写入在单条 INSERT SELECT / ON CONFLICT 中完成。
