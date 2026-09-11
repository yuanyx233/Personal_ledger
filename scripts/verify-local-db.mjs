import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const query = `
  SELECT
    (SELECT COUNT(*) FROM d1_migrations) AS migration_count,
    (SELECT COUNT(*) FROM connections WHERE id LIKE 'fixture-%') AS connection_count,
    (SELECT COUNT(*) FROM accounts WHERE id LIKE 'fixture-%') AS account_count,
    (SELECT COUNT(*) FROM transactions WHERE id LIKE 'transaction-fixture-%') AS transaction_count,
    (SELECT COUNT(*) FROM transactions
      WHERE id = 'transaction-fixture-income'
        AND source = 'MANUAL'
        AND status = 'POSTED'
        AND account_id IS NULL
        AND account_label = 'Fixture Chequing'
        AND category_id IS NOT NULL
        AND categorization_source = 'MANUAL') AS editable_manual_count,
    (SELECT COUNT(*) FROM categories
      WHERE id LIKE 'category-income-%' OR id LIKE 'category-expense-%') AS seeded_category_count,
    (SELECT COUNT(*) FROM categories
      WHERE system_key IN ('UNCLASSIFIED', 'TRANSFER')
        AND editable = 0
        AND active = 1) AS system_category_count,
    (SELECT SUM(amount_minor) FROM transactions WHERE direction = 'OUTFLOW') AS outflow_minor,
    (SELECT SUM(amount_minor) FROM transactions WHERE direction = 'INFLOW') AS inflow_minor
`;
const result = spawnSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    ".wrangler/local-d1",
    "--config",
    "apps/web/wrangler.jsonc",
    "--command",
    query,
    "--json",
  ],
  { cwd: workspace, encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const executions = JSON.parse(result.stdout);
const counts = executions[0]?.results?.[0];
const expected = {
  account_count: 1,
  connection_count: 1,
  editable_manual_count: 1,
  inflow_minor: 500000,
  migration_count: 11,
  outflow_minor: 1234,
  seeded_category_count: 8,
  system_category_count: 2,
  transaction_count: 2,
};

for (const [key, value] of Object.entries(expected)) {
  if (counts?.[key] !== value) {
    throw new Error(
      `Local D1 verification failed for ${key}: expected ${value}, got ${counts?.[key]}`,
    );
  }
}

process.stdout.write(`${JSON.stringify(counts)}\nLocal D1 verification passed.\n`);
