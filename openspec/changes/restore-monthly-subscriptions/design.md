## Context

现有 subscriptions / subscription_occurrences 表与备份仍存在，运行时和页面已删除。本需求独立于银行同步。用户已确认按月记账、取消日期追溯删除（包含当天）、恢复并设置新起始扣款日。

## Goals / Non-Goals

目标：订阅 CRUD 页面、自动每月入账、可追溯取消与恢复、账本统计一致、重试和并发安全。范围外：银行同步、候选识别、通知、自动取消商家服务。

## Decisions

- 设置页提供 `/subscriptions` 入口，沿用现有导航、表单和错误状态。表单填写名称、金额、CAD/USD、账户、支出类别、起始扣款日；编辑仅影响未来。取消表单解释包含当天及已生成支出的删除；恢复明确从新日期开始。
- 沿用既有计划和 occurrence；新增 nullable cancellation_effective_date。未来取消保持 ACTIVE 至生效日，scheduler 仅处理截止日前的扣款。恢复清除 cutoff，以新日期重设 anchor day；旧 YEARLY 数据兼容保留。
- GET/POST `/api/v1/subscriptions` 与 PATCH `/api/v1/subscriptions/:id`；PATCH 使用 EDIT/CANCEL/RESUME 区分输入并校验 version。创建携带稳定 UUID，网络重试不重复创建。
- 每 15 分钟 Cron 以 Toronto calendar date 生成到期 POSTED/MANUAL 支出。每次至多尝试 8 笔（即使并发失败也计入上限），控制为至多 42 条调度查询，兼容免费 D1 每次 50 条查询上限，保留游标以供下次续跑；页面展示未补齐状态。创建/恢复时同步运行该计划的有界补齐。
- D1 batch 原子提交 occurrence、transaction 与计划日期推进，每条写入受 plan version/status/date/cutoff 约束。唯一 `(subscription_id, scheduled_date)` 防重。恢复后若新日期与已删除 occurrence 相同，仅在该日期重新到期时恢复该笔，不复制记录；已有 POSTED occurrence 不重复计入。
- 取消在同一 batch 内将关联 transaction 标为 REMOVED，再更新 cutoff/status/version；现有 trigger 同步 occurrence NOT_CHARGED。删除以 scheduled_date 为准，保留审计关系，普通手记/CSV 不受影响。备份恢复保留 cutoff 与历史关系并兼容旧文件。
- 信任边界：沿用 owner Access、CSRF、请求限制、参数化 SQL、no-store；错误与调度日志仅记录安全代码和计数。

参考：[D1 batch 原子性](https://developers.cloudflare.com/d1/worker-api/d1-database/)；[Worker scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)。

## Risks / Trade-offs

- 历史支出删除影响统计 → 集成测试验证边界、报表、其他交易、回滚、重试和版本冲突。
- Cron 未部署时不能在关闭网站后执行 → 本次只实现和本地验证，正式启用须另行获得部署授权。
- 参考 D1 limits: https://developers.cloudflare.com/d1/platform/limits/ 。极长漏跑超出单次上限 → 保留 next date 并在后续任务续跑，不丢弃应记月份。
- 月底不存在对应日 → 当月最后一天扣款，下月恢复原 anchor day。

## Migration Plan

新增 0020 migration；先本地验证，发布时备份后迁移再发布 Worker/Cron。回滚应用不删除新增列和历史记录。

## Open Questions

无阻塞项。
