import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localD1State = fileURLToPath(new URL("../.wrangler/local-d1", import.meta.url));

rmSync(localD1State, { force: true, recursive: true });
process.stdout.write(`Reset local D1 state at ${localD1State}\n`);
