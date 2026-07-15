import { PRODUCT_NAME } from "@ledger/domain";

export function App() {
  return (
    <main className="workspace-shell">
      <p className="eyebrow">Workspace initialized</p>
      <h1>{PRODUCT_NAME}</h1>
      <p>受保护的个人账本正在本地构建中，尚未连接任何真实银行数据。</p>
    </main>
  );
}
