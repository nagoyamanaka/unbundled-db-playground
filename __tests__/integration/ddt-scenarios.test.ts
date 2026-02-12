/**
 * DDT活用型 統合テスト
 *
 * 複数のシナリオをデータ駆動でテストし、
 * 結果整合性の遅延時間も計測
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import Redis from "ioredis";
import { Client } from "@elastic/elasticsearch";

/**
 * DDT用: 統合テストケースの定義
 */
interface IntegrationTestCase {
  name: string;
  operation: "insert" | "update" | "delete";
  initialData?: {
    title: string;
    content: string;
    author: string;
  };
  updateData?: {
    title?: string;
    content?: string;
  };
  expectedInElasticsearch: boolean;
  expectedInRedis: boolean;
  maxWaitTimeMs: number;
}

/**
 * 統合テストケースの生成（DDT）
 */
function generateIntegrationTestCases(): IntegrationTestCase[] {
  return [
    {
      name: "INSERT should propagate to both Elasticsearch and Redis",
      operation: "insert",
      initialData: {
        title: "DDT Test Post 1",
        content: "Testing insert propagation",
        author: "DDT Tester",
      },
      expectedInElasticsearch: true,
      expectedInRedis: true,
      maxWaitTimeMs: 10000,
    },
    {
      name: "UPDATE should propagate changes to both datastores",
      operation: "update",
      initialData: {
        title: "Original Title",
        content: "Original Content",
        author: "DDT Tester",
      },
      updateData: {
        title: "Updated Title",
        content: "Updated Content",
      },
      expectedInElasticsearch: true,
      expectedInRedis: true,
      maxWaitTimeMs: 10000,
    },
    {
      name: "DELETE should remove data from both datastores",
      operation: "delete",
      initialData: {
        title: "To Be Deleted",
        content: "Will be removed",
        author: "DDT Tester",
      },
      expectedInElasticsearch: false,
      expectedInRedis: false,
      maxWaitTimeMs: 10000,
    },
  ];
}

describe("DDT Integration Test", () => {
  let pgPool: Pool;
  let redis: Redis;
  let es: Client;

  const TEST_TIMEOUT = 30000;

  beforeAll(async () => {
    pgPool = new Pool({
      host: "localhost",
      port: 5433,
      database: "blog_db",
      user: "blog_user",
      password: "blog_pass",
    });

    redis = new Redis({
      host: "localhost",
      port: 6379,
    });

    es = new Client({ node: "http://localhost:9200" });

    // 接続確認
    await pgPool.query("SELECT 1");
    await redis.ping();
    await es.ping();

    console.log("✅ All services connected for DDT tests");
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await pgPool.end();
    await redis.quit();
    await es.close();
  });

  describe("Event Propagation Scenarios (DDT)", () => {
    const testCases = generateIntegrationTestCases();

    testCases.forEach((testCase) => {
      it(
        testCase.name,
        async () => {
          let postId: number;

          // Arrange & Act: 操作に応じた処理
          if (testCase.operation === "insert") {
            // INSERT
            const result = await pgPool.query(
              "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
              [
                testCase.initialData!.title,
                testCase.initialData!.content,
                testCase.initialData!.author,
              ],
            );
            postId = result.rows[0].id;
            console.log(
              `📝 [${testCase.operation.toUpperCase()}] Post ${postId}`,
            );
          } else if (testCase.operation === "update") {
            // INSERT してから UPDATE
            const insertResult = await pgPool.query(
              "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
              [
                testCase.initialData!.title,
                testCase.initialData!.content,
                testCase.initialData!.author,
              ],
            );
            postId = insertResult.rows[0].id;

            // 伝播を待つ
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // UPDATE
            await pgPool.query(
              "UPDATE posts SET title = $1, content = $2 WHERE id = $3",
              [
                testCase.updateData!.title,
                testCase.updateData!.content,
                postId,
              ],
            );
            console.log(
              `✏️  [${testCase.operation.toUpperCase()}] Post ${postId}`,
            );
          } else if (testCase.operation === "delete") {
            // INSERT してから DELETE
            const insertResult = await pgPool.query(
              "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
              [
                testCase.initialData!.title,
                testCase.initialData!.content,
                testCase.initialData!.author,
              ],
            );
            postId = insertResult.rows[0].id;

            // 伝播を待つ
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // DELETE
            await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
            console.log(
              `🗑️  [${testCase.operation.toUpperCase()}] Post ${postId}`,
            );
          } else {
            throw new Error(`Unknown operation: ${testCase.operation}`);
          }

          // Assert: 結果整合性を確認
          const propagationResult = await waitForPropagation(
            postId,
            {
              expectedInElasticsearch: testCase.expectedInElasticsearch,
              expectedInRedis: testCase.expectedInRedis,
              maxWaitTimeMs: testCase.maxWaitTimeMs,
              updateData: testCase.updateData,
            },
            es,
            redis,
          );

          expect(propagationResult.esMatched).toBe(true);
          expect(propagationResult.redisMatched).toBe(true);

          console.log(
            `✅ Propagation completed in ${propagationResult.elapsedMs}ms`,
          );

          // クリーンアップ
          try {
            await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
          } catch (error) {
            // 既に削除済みの場合は無視
          }
        },
        TEST_TIMEOUT,
      );
    });
  });

  describe("Eventual Consistency Timing", () => {
    /**
     * DDT: 結果整合性の遅延時間を計測
     */
    const timingTestCases = [
      {
        name: "should measure INSERT propagation time",
        operation: "insert" as const,
        data: { title: "Timing Test 1", content: "Test", author: "Tester" },
      },
      {
        name: "should measure UPDATE propagation time",
        operation: "update" as const,
        data: { title: "Timing Test 2", content: "Test", author: "Tester" },
      },
    ];

    timingTestCases.forEach((testCase) => {
      it(
        testCase.name,
        async () => {
          // Arrange & Act
          const result = await pgPool.query(
            "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
            [testCase.data.title, testCase.data.content, testCase.data.author],
          );
          const postId = result.rows[0].id;

          if (testCase.operation === "update") {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await pgPool.query("UPDATE posts SET title = $1 WHERE id = $2", [
              "Updated " + testCase.data.title,
              postId,
            ]);
          }

          const startTime = Date.now();

          // Assert: 伝播時間を計測
          const propagationResult = await waitForPropagation(
            postId,
            {
              expectedInElasticsearch: true,
              expectedInRedis: true,
              maxWaitTimeMs: 15000,
            },
            es,
            redis,
          );

          const totalTime = Date.now() - startTime;

          console.log(`⏱️  Total propagation time: ${totalTime}ms`);
          console.log(`   - Elasticsearch: ${propagationResult.esTime}ms`);
          console.log(`   - Redis: ${propagationResult.redisTime}ms`);

          // 10秒以内に伝播されることを期待
          expect(totalTime).toBeLessThan(10000);

          // クリーンアップ
          await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
        },
        TEST_TIMEOUT,
      );
    });
  });
});

/**
 * ヘルパー関数: 結果整合性の完了を待つ
 */
async function waitForPropagation(
  postId: number,
  options: {
    expectedInElasticsearch: boolean;
    expectedInRedis: boolean;
    maxWaitTimeMs: number;
    updateData?: { title?: string; content?: string };
  },
  es: Client,
  redis: Redis,
): Promise<{
  esMatched: boolean;
  redisMatched: boolean;
  elapsedMs: number;
  esTime?: number;
  redisTime?: number;
}> {
  const startTime = Date.now();
  let esMatched = false;
  let redisMatched = false;
  let esTime: number | undefined;
  let redisTime: number | undefined;

  const maxIterations = Math.ceil(options.maxWaitTimeMs / 500);

  for (let i = 0; i < maxIterations; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Elasticsearch確認
    if (!esMatched) {
      try {
        const esResult = await es.get({
          index: "posts",
          id: postId.toString(),
        });

        if (options.expectedInElasticsearch) {
          // 存在することを期待
          if (esResult._source) {
            // UPDATE の場合は内容も確認
            if (options.updateData) {
              if (
                (esResult._source as any).title === options.updateData.title ||
                (esResult._source as any).content === options.updateData.content
              ) {
                esMatched = true;
                esTime = Date.now() - startTime;
              }
            } else {
              esMatched = true;
              esTime = Date.now() - startTime;
            }
          }
        }
      } catch (error: any) {
        if (error.meta?.statusCode === 404) {
          // 存在しないことを期待（DELETE の場合）
          if (!options.expectedInElasticsearch) {
            esMatched = true;
            esTime = Date.now() - startTime;
          }
        }
      }
    }

    // Redis確認
    if (!redisMatched) {
      const cachedValue = await redis.get(`post:${postId}`);

      if (options.expectedInRedis) {
        // 存在することを期待
        if (cachedValue) {
          // UPDATE の場合は内容も確認
          if (options.updateData) {
            const cachedPost = JSON.parse(cachedValue);
            if (
              cachedPost.title === options.updateData.title ||
              cachedPost.content === options.updateData.content
            ) {
              redisMatched = true;
              redisTime = Date.now() - startTime;
            }
          } else {
            redisMatched = true;
            redisTime = Date.now() - startTime;
          }
        }
      } else {
        // 存在しないことを期待（DELETE の場合）
        if (!cachedValue) {
          redisMatched = true;
          redisTime = Date.now() - startTime;
        }
      }
    }

    // 両方成功したらループ終了
    if (esMatched && redisMatched) {
      break;
    }
  }

  return {
    esMatched,
    redisMatched,
    elapsedMs: Date.now() - startTime,
    esTime,
    redisTime,
  };
}
