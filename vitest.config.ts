import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", ".worktrees/**"],
    alias: {
      // server-only throws in non-Next.js runtimes; no-op it in tests.
      "server-only": new URL("./vitest.server-only-mock.ts", import.meta.url)
        .pathname,
    },
  },
});
