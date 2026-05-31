import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.integration.setup.ts"], // reuses dotenv loader from Phase 3
    include: ["**/*.smoke.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", ".worktrees/**"],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
