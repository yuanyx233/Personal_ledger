import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const HAN = /[一-鿿]/;

// The interface reads every string from the language catalogue. A Chinese literal
// in a component means a string that the English interface cannot render, so this
// fails the build rather than letting one slip back in.
function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "apps/web/src"], { cwd: workspace, encoding: "utf8" })
    .split("\n")
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !file.includes(".test.") &&
        // The catalogues themselves hold the Chinese copy, by definition.
        !file.startsWith("apps/web/src/i18n/"),
    );
}

describe("interface copy lives in the catalogue", () => {
  it("has no Chinese literal left in the browser source", () => {
    const offenders = sourceFiles().flatMap((file) => {
      const lines = readFileSync(`${workspace}${file}`, "utf8").split("\n");
      return lines
        .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
        .filter(({ text }) => HAN.test(text));
    });

    expect(offenders).toEqual([]);
  });

  it("checks a non-empty set of files, so the guard cannot pass by finding nothing", () => {
    expect(sourceFiles().length).toBeGreaterThan(20);
  });
});
