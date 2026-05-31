import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.integration.setup.ts"],
    include: ["**/*.itest.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", ".worktrees/**"],
    fileParallelism: false,
    alias: {
      // server-only throws in non-Next.js runtimes; no-op it in tests.
      "server-only": new URL("./vitest.server-only-mock.ts", import.meta.url)
        .pathname,
    },
  },
});
