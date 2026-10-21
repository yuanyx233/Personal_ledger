import { describe, expect, it } from "vitest";

import { categoryDisplayName } from "./categoryName";
import { translate, type Language } from "./index";

const t =
  (language: Language) =>
  (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(language, key, values);

describe("category display names", () => {
  it("localises the immutable system categories", () => {
    const transfer = { editable: false, name: "Transfer", systemKey: "TRANSFER" } as const;
    expect(categoryDisplayName(transfer, t("zh-CN"))).toBe("转账");
    expect(categoryDisplayName(transfer, t("en"))).toBe("Transfer");
  });

  it("shows a seeded editable category exactly as stored", () => {
    const seeded = { editable: true, name: "Food & Dining", systemKey: null } as const;
    expect(categoryDisplayName(seeded, t("zh-CN"))).toBe("Food & Dining");
    expect(categoryDisplayName(seeded, t("en"))).toBe("Food & Dining");
  });

  it("never overwrites a name the owner chose", () => {
    const renamed = { editable: true, name: "餐饮", systemKey: null } as const;
    expect(categoryDisplayName(renamed, t("zh-CN"))).toBe("餐饮");
    expect(categoryDisplayName(renamed, t("en"))).toBe("餐饮");
  });

  it("leaves an editable category alone even when it carries a system key", () => {
    // Editable wins: the owner can rename it, so the stored name is authoritative.
    const editableTransfer = { editable: true, name: "我的转账", systemKey: "TRANSFER" } as const;
    expect(categoryDisplayName(editableTransfer, t("en"))).toBe("我的转账");
  });
});
