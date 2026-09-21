## Why

当前账本是为单一所有者、单一部署、单一地区（America/Toronto、CAD/USD、中文界面）构建的。所有者希望公开仓库，让其他人各自部署自己的实例 —— 每人一个 Cloudflare 账号、一个 D1、一份自己的数据。这条路线不需要多租户或账号密码：Cloudflare Access 加 `OWNER_EMAIL` 的现有鉴权对自托管天然适用，数据隔离由部署边界保证。

但仓库目前有四类障碍：没有开源许可证（法律上禁止 fork）、部署文档是所有者的运维日志而非安装指南、`wrangler.jsonc` 写死了生产 D1 标识、地区与语言被固化在类型层和展示层。

## What Changes

- 新增开源许可证，使 fork、修改与自行部署在法律上被允许。
- 新增面向自托管者的安装指南，覆盖从 Cloudflare 账号到首次登录的完整路径，包括 Zero Trust Access application 配置与各项密钥来源；所有者的发布记录与授权措辞从中剥离。
- `wrangler.jsonc` 的生产 `database_id` 改为占位符，部署流程要求自托管者填入自己的 D1 标识。
- 时区从 `z.literal("America/Toronto")` 改为可配置的 IANA 时区；前端编译期变量与 Worker 运行期变量必须一致，不一致时启动失败并给出明确错误。
- 货币从 `z.enum(["CAD", "USD"])` 放开为任意三位大写字母的 ISO 4217 代码。**次要单位仍固定为 1/100**，即仅支持两位小数货币；零位（JPY、KRW）与三位（KWD、BHD）货币显式不支持并在文档中声明。
- 前端引入界面语言切换，中文与英文两套语言包，移除 `apps/web/src` 中的硬编码中文字面量。
- **BREAKING**（仅对自托管者而非现有部署）：完整 JSON 备份的 `timezone` 字段不再是固定字面量。现有 v5 备份继续被接受；新实例产出的非 Toronto 备份无法被本变更之前的代码读取。

## Capabilities

### New Capabilities

- `self-hosting-deployment`: 开源许可、自托管安装指南、可复制的部署配置，以及所有者私有运维记录与公开文档的分离。
- `regional-configuration`: 可配置时区与放开的货币集合，含前后端配置一致性校验、备份格式兼容策略与不支持货币的显式边界。
- `interface-localization`: 中英双语界面、语言选择与持久化，以及数据库内英文分类名在各语言下的呈现规则。

### Modified Capabilities

无。`openspec/specs/` 当前为空，尚无已同步的主规范需要修改；本变更以新增 capability 形式覆盖上述行为。

## Impact

- **文档与仓库根**：新增 `LICENSE`、`docs/self-hosting.md`；`docs/free-preview-deployment.md` 剥离为所有者运维记录；`README.md` 需说明自托管路径与地区限制。
- **配置**：`apps/web/wrangler.jsonc`、`apps/web/.env.example`、`apps/web/.dev.vars.example`。
- **domain 层**：`environment.ts`、`api-contracts.ts`、`financial-reporting.ts`、`full-json-export.ts`、`subscriptions.ts` 的时区与货币约束；`csv-import.ts` 的货币推断。
- **前端**：`apps/web/src` 下 31 个文件、434 行含中文字面量；`analysis-period.ts`、`quick-entry-preferences.ts` 的固定时区；`Intl.NumberFormat("zh-CN")` 的固定 locale。
- **Worker**：`APP_TIMEZONE` 环境类型与 scheduled handler 的日期计算。
- **测试**：全部使用 Toronto/CAD 夹具的单元、Worker 集成与浏览器测试。

不改动：鉴权模型、D1 表结构（货币列已是通用的三位大写字母约束）、备份 `schemaVersion` 版本号、`/100` 次要单位换算。无新增运行时依赖预期（i18n 方案在 design 中决定）。不执行部署，不公开仓库 —— 两者均需另行明确授权。
