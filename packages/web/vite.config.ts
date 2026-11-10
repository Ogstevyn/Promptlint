import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// @promptlint/shared is compiled to CommonJS for Node consumers; the browser
// bundle compiles its TypeScript source directly instead.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@promptlint/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url))
    }
  },
  server: { port: 5173 }
});
