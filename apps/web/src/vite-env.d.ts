/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_PATH: "/api/v1";
  readonly VITE_APP_TIMEZONE: string;
  readonly VITE_LEDGER_CURRENCIES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
