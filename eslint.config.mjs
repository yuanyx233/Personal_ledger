import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flat config follows the current ESLint and typescript-eslint guidance:
// https://eslint.org/docs/latest/use/configure/configuration-files
// https://typescript-eslint.io/getting-started/typed-linting/
export default defineConfig([
  globalIgnores([
    "**/.wrangler/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
  ]),
  {
    files: ["**/*.{js,cjs,mjs}"],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [eslint.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },
]);
