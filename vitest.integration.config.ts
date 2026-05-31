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
  },
});
