import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // グローバルにテストAPI（describe, it, expect等）を使えるようにする
    globals: true,

    // テスト環境（Node.js）
    environment: "node",

    // テストファイルのパターン
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],

    // 除外パターン
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],

    // タイムアウト設定
    testTimeout: 10000, // 10秒（統合テストを考慮）
    hookTimeout: 10000,

    // カバレッジ設定
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/scripts/**",
        "src/setup/**",
        "src/types/**",
      ],
      // カバレッジ目標（80%以上）
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },

    // 並列実行の設定
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },

    // セットアップファイル
    setupFiles: ["./vitest.setup.ts"],
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./__tests__"),
    },
  },
});
