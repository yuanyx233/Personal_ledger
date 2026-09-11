## Why

用户需要按月了解每个消费板块花了多少钱，并为各板块设置预算上限、查看剩余额度。

## What Changes

- 在现有月度分析中补充类别支出占比。
- 增加 Goal 月度预算区，按支出类别和币种设置上限、展示个人净支出和超支状态。
- 默认从所选月份开始沿用预算，后续修改不影响更早月份；支持取消预算。
- 预算纳入数据库和完整 JSON 备份恢复。

## Capabilities

### New Capabilities
- `monthly-category-budgets`: 月度板块支出、预算设置、跨月生效和预算备份。

### Modified Capabilities

无。

## Impact

分析页、受保护的预算 API、domain 校验、D1 新增表、JSON 导出恢复及相应测试。复用现有报表统计口径，无新依赖，不操作线上资源。
