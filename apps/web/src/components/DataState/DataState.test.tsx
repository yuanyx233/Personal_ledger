import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataState } from "./DataState";

describe("shared data states", () => {
  it("renders four states with distinct accessible semantics", () => {
    const states = {
      empty: renderToStaticMarkup(<DataState variant="empty" />),
      error: renderToStaticMarkup(<DataState variant="error" />),
      loading: renderToStaticMarkup(<DataState variant="loading" />),
      offline: renderToStaticMarkup(<DataState variant="offline" />),
    };

    expect(states.loading).toContain('aria-busy="true"');
    expect(states.loading).toContain("正在读取账本");
    expect(states.empty).toContain("这里还没有数据");
    expect(states.error).toContain('role="alert"');
    expect(states.offline).toContain("当前处于离线状态");
    expect(states.offline).toContain("不会显示缓存的交易记录");
  });

  it("escapes untrusted state copy and renders an optional recovery action", () => {
    const html = renderToStaticMarkup(
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
