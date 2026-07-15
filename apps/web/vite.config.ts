import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Official Workers integration: https://developers.cloudflare.com/workers/vite-plugin/
export default defineConfig({
  plugins: [react(), cloudflare()],
});
