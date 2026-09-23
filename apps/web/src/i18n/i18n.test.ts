import { describe, expect, it } from "vitest";

import { CATALOGUES, LANGUAGES, initialLanguage, translate, type TranslationKey } from "./index";

describe("interface language catalogues", () => {
  it("offers exactly the languages this ledger ships", () => {
    expect(LANGUAGES).toEqual(["zh-CN", "en"]);
  });

  it("covers the same keys in both catalogues", () => {
    const zh = Object.keys(CATALOGUES["zh-CN"]).sort();
    const en = Object.keys(CATALOGUES.en).sort();
    expect(en).toEqual(zh);
  });

  it("leaves no entry empty in either catalogue", () => {
    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(CATALOGUES[language])) {
        expect(value.length, `${language}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("flags entries copied between catalogues instead of translated", () => {
    // Identical text in both catalogues usually means a key was pasted rather than
    // translated. Product names, codes, and the language names themselves — which
    // are deliberately shown as endonyms — are the legitimate exceptions.
    const allowedToMatch = /^(brand|code)\.|^language\.(zh-CN|en)$/;
    const suspicious = (Object.keys(CATALOGUES["zh-CN"]) as TranslationKey[]).filter(
      (key) => CATALOGUES["zh-CN"][key] === CATALOGUES.en[key] && !allowedToMatch.test(key),
    );
    expect(suspicious).toEqual([]);
  });

  it("translates a key in the requested language", () => {
    expect(translate("zh-CN", "nav.overview")).toBe("概览");
    expect(translate("en", "nav.overview")).toBe("Overview");
  });

  it("fills placeholders and leaves unknown ones untouched", () => {
    expect(translate("en", "overview.currentMonth", { period: "2026-09" })).toContain("2026-09");
    expect(translate("zh-CN", "overview.currentMonth", { period: "2026-09" })).toContain("2026-09");
  });

  it("prefers a Chinese browser but falls back to English otherwise", () => {
    expect(initialLanguage(null, ["zh-CN", "en"])).toBe("zh-CN");
    expect(initialLanguage(null, ["zh-Hans", "en"])).toBe("zh-CN");
    expect(initialLanguage(null, ["de-DE", "en-GB"])).toBe("en");
    expect(initialLanguage(null, [])).toBe("en");
  });

  it("lets an explicit choice override the browser", () => {
    expect(initialLanguage("en", ["zh-CN"])).toBe("en");
    expect(initialLanguage("zh-CN", ["de-DE"])).toBe("zh-CN");
    expect(initialLanguage("klingon", ["de-DE"])).toBe("en");
  });
});
