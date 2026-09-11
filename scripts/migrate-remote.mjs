import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FULL_JSON_EXPORT_LIMITS, normalizeFullJsonExport } from "../packages/domain/dist/index.js";
import {
  RemoteMigrationGuardError,
  assertRecentFullJsonExport,
  detectDestructiveMigrationOperations,
  parseVerifiedRestoreCommandOutput,
} from "../packages/persistence/dist/index.js";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const restoreScript = fileURLToPath(
  new URL("../.wrangler/restore-json-export.mjs", import.meta.url),
);
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const config = "apps/web/wrangler.jsonc";
const USAGE =
  "Usage: npm run db:migrate:remote -- --input <recent-export.json> --persist-to <new-directory> [--execute]\n";

class RemoteMigrationCommandError extends Error {
  constructor(code) {
    super(code);
    this.name = "RemoteMigrationCommandError";
    this.code = code;
  }
}

function parseArguments(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === "--help") return { help: true };
  const values = new Map();
  let execute = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const key = arguments_[index];
    if (key === "--execute") {
      if (execute) throw new RemoteMigrationCommandError("INVALID_ARGUMENTS");
      execute = true;
      continue;
    }
    if (key !== "--input" && key !== "--persist-to") {
      throw new RemoteMigrationCommandError("INVALID_ARGUMENTS");
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--") || values.has(key)) {
      throw new RemoteMigrationCommandError("INVALID_ARGUMENTS");
    }
    values.set(key, value);
    index += 1;
  }
  const input = values.get("--input");
  const persistTo = values.get("--persist-to");
  if (!input || !persistTo || values.size !== 2) {
    throw new RemoteMigrationCommandError("INVALID_ARGUMENTS");
  }
  return { execute, help: false, input, persistTo };
}

function readFreshExport(rawInput) {
  const input = resolve(workspace, rawInput);
  if (!existsSync(input) || !statSync(input).isFile()) {
    throw new RemoteMigrationCommandError("INPUT_NOT_FOUND");
  }
  const bytes = readFileSync(input);
  if (bytes.byteLength > FULL_JSON_EXPORT_LIMITS.BYTES) {
    throw new RemoteMigrationCommandError("INPUT_TOO_LARGE");
  }
  let json;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RemoteMigrationCommandError("INPUT_ENCODING_INVALID");
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new RemoteMigrationCommandError("INPUT_JSON_INVALID");
  }
  let document;
  try {
    document = normalizeFullJsonExport(value);
  } catch {
    throw new RemoteMigrationCommandError("INPUT_SCHEMA_INVALID");
  }
  assertRecentFullJsonExport(document.exportedAt);
  return { bytes, input };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationSnapshot() {
  const filenames = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  if (filenames.length === 0) throw new RemoteMigrationCommandError("MIGRATION_SET_INVALID");
  const manifest = filenames.map((filename) => {
    const sql = readFileSync(resolve(migrationsDirectory, filename), "utf8");
    return {
      filename,
      operations: detectDestructiveMigrationOperations(sql),
      sha256: sha256(sql),
    };
  });
  return { digest: sha256(JSON.stringify(manifest)), manifest };
}

function run(command, arguments_, failureCode) {
  const result = spawnSync(command, arguments_, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (process.env.MIGRATION_GUARD_DEBUG === "1") {
      process.stderr.write(`${result.stdout}${result.stderr}`);
    }
    throw new RemoteMigrationCommandError(failureCode);
  }
  return result.stdout;
}

function parseRestoreOutput(output) {
  const firstLine = output.split("\n", 1)[0];
  let value;
  try {
    value = JSON.parse(firstLine);
  } catch {
    throw new RemoteMigrationCommandError("RESTORE_OUTPUT_INVALID");
  }
  return parseVerifiedRestoreCommandOutput(value);
}

function main() {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    if (arguments_.help) {
      process.stdout.write(USAGE);
      return;
    }
    const input = readFreshExport(arguments_.input);
    const before = migrationSnapshot();
    const restoreOutput = run(
      process.execPath,
      [restoreScript, "--input", input.input, "--persist-to", arguments_.persistTo],
      "RESTORE_GUARD_FAILED",
    );
    const restore = parseRestoreOutput(restoreOutput);
    const after = migrationSnapshot();
    if (before.digest !== after.digest) {
      throw new RemoteMigrationCommandError("MIGRATIONS_CHANGED");
    }

    if (arguments_.execute) {
      run(
        process.execPath,
        [wrangler, "d1", "migrations", "apply", "DB", "--remote", "--config", config],
        "REMOTE_MIGRATION_FAILED",
      );
    }

    process.stdout.write(
      `${JSON.stringify({
        destructiveMigrations: after.manifest
          .filter(({ operations }) => operations.length > 0)
          .map(({ filename, operations }) => ({ filename, operations })),
        exportSha256: sha256(input.bytes),
        migrationDigest: after.digest,
        remoteExecuted: arguments_.execute,
        restore,
        schemaVersion: 1,
        status: arguments_.execute ? "REMOTE_MIGRATION_APPLIED" : "READY",
      })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof RemoteMigrationCommandError || error instanceof RemoteMigrationGuardError
        ? error.code
        : "REMOTE_MIGRATION_GUARD_FAILED";
    process.stderr.write(`Remote migration guard failed: ${code}.\n`);
    process.exitCode = 1;
  }
}

main();
