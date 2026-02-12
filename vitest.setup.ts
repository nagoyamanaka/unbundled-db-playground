/**
 * Vitest Setup File
 * すべてのテストファイルの実行前に一度だけ実行される
 */

import { beforeAll, afterAll, afterEach } from "vitest";

// グローバルなテスト環境のセットアップ
beforeAll(() => {
  console.log("🧪 Starting Vitest test suite...");
});

// 各テスト後のクリーンアップ
afterEach(() => {
  // モックのクリア（必要に応じて）
});

// すべてのテスト終了後のクリーンアップ
afterAll(() => {
  console.log("✅ Vitest test suite completed");
});

// タイムゾーンを UTC に固定（時刻テストの安定化）
process.env.TZ = "UTC";

// 未処理のPromise拒否をキャッチ（テスト中のエラー検出）
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
