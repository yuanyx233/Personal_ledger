import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_WORKER_SECRET_NAMES,
  publicClientEnvSchema,
} from "../../packages/domain/src/environment";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

function parseExampleFile(contents: string): Record<string, string> {
  return Object.fromEntries(
    contents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const match = /^([A-Z0-9_]+)="([^"]*)"$/.exec(line);

        if (match?.[1] === undefined || match[2] === undefined) {
          throw new Error(`Invalid checked-in environment example line: ${line}`);
        }

        return [match[1], match[2]];
      }),
  );
}

async function readWorkspaceFile(relativePath: string): Promise<string> {
  return readFile(path.join(workspaceRoot, relativePath), "utf8");
}

describe("checked-in environment files", () => {
  it("keeps the browser example public and schema-valid", async () => {
    const values = parseExampleFile(await readWorkspaceFile("apps/web/.env.example"));

    expect(publicClientEnvSchema.parse(values)).toEqual(values);
    expect(Object.keys(values).every((key) => key.startsWith("VITE_"))).toBe(true);
  });

  it("uses obvious placeholders for every local app Worker secret", async () => {
    const values = parseExampleFile(await readWorkspaceFile("apps/web/.dev.vars.example"));

    expect(Object.keys(values).sort()).toEqual([...APP_WORKER_SECRET_NAMES].sort());
    expect(Object.values(values).every((value) => value.startsWith("REPLACE_ME_"))).toBe(true);
  });

  it("declares every production secret as required in its Worker config", async () => {
    const appConfig = await readWorkspaceFile("apps/web/wrangler.jsonc");

    expect(appConfig).toContain('"secrets"');

    for (const secretName of APP_WORKER_SECRET_NAMES) {
      expect(appConfig).toContain(`"${secretName}"`);
    }
  });
});
