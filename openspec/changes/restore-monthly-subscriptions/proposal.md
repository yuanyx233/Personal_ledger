## Why

订阅管理随银行同步清理被移除，但用户需要独立管理每月订阅，并在忘记登记取消时追溯修正自动支出。用户已确认取消生效日期包含当天、可恢复订阅并选择新的开始日期。

## What Changes

- 恢复独立订阅管理页，支持添加、编辑、取消、恢复及查看自动记账记录。
- 按 Toronto 日期自动生成每月支出，支持月底日期、重复执行和漏跑补齐。
- 取消时选择生效日期，移除该日期起已有的关联支出；恢复仅从新日期开始。
- 保存取消日期并纳入完整备份与恢复，延续现有鉴权、CSRF 和版本冲突保护。

## Capabilities

### New Capabilities
- `subscription-management`: 每月自动支出、追溯取消、恢复及管理页面。

### Modified Capabilities

无已归档的主规范需要修改；本变更覆盖旧 change 中移除订阅和旧取消语义。

## Impact

React 页面与路由、domain 合约、D1 repository/migration、app Worker scheduled/API、备份恢复及测试。无新依赖，不恢复银行同步，不执行部署。
