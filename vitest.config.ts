import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      // Only the logic we actually exercise — exclude pure-UI/config/prompt copy.
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["lib/prompts/role-templates.ts", "lib/prompts/topics.ts", "**/*.d.ts"],
      reporter: ["text", "html"],
      // Floors set just below current coverage so a regression trips CI; raise
      // as coverage grows. Current: lines 60 / funcs 65 / stmts 59 / branch 49.
      thresholds: {
        lines: 52,
        functions: 58,
        statements: 50,
        branches: 42,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
