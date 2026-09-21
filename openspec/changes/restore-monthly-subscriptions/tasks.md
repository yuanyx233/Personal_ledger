## 1. Contracts and persistence

- [x] 1.1 Add and verify date/contract tests, cancellation migration, versioned/idempotent repository and atomic generation/cancellation/resume tests.
- [x] 1.2 Preserve cutoff in full export/restore and verify old backup compatibility and round-trip restoration.

## 2. Worker and interface

- [x] 2.1 Restore protected subscription APIs and scheduled generation; verify auth, validation, retries, reporting and safe failures.
- [x] 2.2 Add settings entry and subscription management page with create/edit/cancel/resume and clear inclusive cancellation wording; verify desktop/mobile flows and errors.

## 3. Verification

- [x] 3.1 Run relevant regression tests, typecheck, lint, build and browser screenshot review; update documentation and record evidence. Do not deploy without separate authorization.

## 验证与上线核对（2026-09-16）

- 用户已单独授权上线。检查发现生产版本 `89d65032-4549-4e12-ac53-1941b581e3e5` 已在 2026-09-12 发布，线上客户端资源 `index-Bj0ap81Y.js` / `index-BGah75CE.css` 与本次验证构建一致，因此未重复发布相同产物。
- 线上 `/subscriptions` 已登录加载成功，显示「添加订阅」；`/settings` 存在管理入口。未创建测试账目或订阅。
- 远程 D1 显示无待执行 migration；生产 Worker 版本同时包含 `fetch` 与 `scheduled` handler。Cloudflare 控制台显示 `*/15 * * * *` Cron 正常运行，最新检查的 10 次执行全部 `Success`。
- `npm run verify` 通过：328 个单元测试、152 个 Worker 集成测试、84 个浏览器测试通过，2 个预期移动端重复场景跳过；format、lint、typecheck、coverage 门槛和生产构建全部通过。
- 单元覆盖率边界排除 D1-only `subscriptions.ts`，该文件由真实 workerd/D1 集成套件覆盖；覆盖率门槛未降低。生产依赖 `npm audit --omit=dev` 报告 0 漏洞。
- 320/768/1024/1440 px 订阅列表与取消表单截图已人工检查，无横向溢出，含当天的取消语义、操作按钮和键盘焦点清晰。
- 当前版本的前一个部署版本为 `3cb35bc0-2080-425d-b4d6-b7664612ebd9`；回退应保留已应用的增量 D1 migration。
