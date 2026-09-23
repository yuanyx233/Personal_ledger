import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Language } from "../../i18n";
import { LanguageProvider } from "../../i18n/LanguageProvider";
import { DataState } from "./DataState";

// The component reads its copy from the language catalogue, so it renders through
// the same provider the application mounts.
function render(node: ReactElement, language: Language = "zh-CN") {
  return renderToStaticMarkup(<LanguageProvider initial={language}>{node}</LanguageProvider>);
}

describe("shared data states", () => {
  it("renders four states with distinct accessible semantics", () => {
    const states = {
      empty: render(<DataState variant="empty" />),
      error: render(<DataState variant="error" />),
      loading: render(<DataState variant="loading" />),
      offline: render(<DataState variant="offline" />),
    };

    expect(states.loading).toContain('aria-busy="true"');
    expect(states.loading).toContain("正在读取账本");
    expect(states.empty).toContain("这里还没有数据");
    expect(states.error).toContain('role="alert"');
    expect(states.offline).toContain("当前处于离线状态");
    expect(states.offline).toContain("不会显示缓存的交易记录");
  });

  it("renders the same states in English", () => {
    expect(render(<DataState variant="loading" />, "en")).toContain("Reading the ledger");
    expect(render(<DataState variant="offline" />, "en")).toContain("You are offline");
  });

  it("escapes untrusted state copy and renders an optional recovery action", () => {
    const html = render(
      <DataState
        action={<button type="button">重新连接</button>}
        description={'<img src=x onerror="alert(1)">'}
        variant="error"
      />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("重新连接");
  });
});
