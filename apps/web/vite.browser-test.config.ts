import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Browser layout tests exercise the client shell only. Worker auth is covered in workerd integration
// tests, so this server intentionally has no Worker runtime or auth bypass configuration.
export default defineConfig({
  plugins: [react()],
});
