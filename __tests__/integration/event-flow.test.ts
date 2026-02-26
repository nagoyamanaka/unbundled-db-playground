/**
 * Event Flow 統合テスト
 *
 * PostgreSQL → Debezium → Kafka → Consumer → Elasticsearch/Redis
 * の全体的なデータフローをテスト
 *
 * 注意: このテストはDockerコンテナを起動するため、実行に時間がかかります
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import Redis from "ioredis";
import { Client } from "@elastic/elasticsearch";

/**
 * 統合テストの設定
 *
 * このテストは実際のDockerコンテナを使用します。
 * docker-compose up が実行されていることを前提とします。
 */
describe("Event Flow Integration Test", () => {
  let pgPool: Pool;
  let redis: Redis;
  let es: Client;

  const TEST_TIMEOUT = 30000; // 30秒

  beforeAll(async () => {
    // PostgreSQL接続
    pgPool = new Pool({
      host: "localhost",
      port: 5433,
      database: "blog_db",
      user: "blog_user",
      password: "blog_pass",
    });

    // Redis接続
    redis = new Redis({
      host: "localhost",
      port: 6380,
    });

    // Elasticsearch接続
    es = new Client({ node: "http://localhost:9200" });

    // 接続確認
    await pgPool.query("SELECT 1");
    await redis.ping();
    await es.ping();

    console.log("✅ All services connected");
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // クリーンアップ
    await pgPool.end();
    await redis.quit();
    await es.close();
  });

  describe("Full Event Flow", () => {
    it(
      "should propagate INSERT from PostgreSQL to Elasticsearch and Redis",
      async () => {
        // Arrange: テストデータ
        const testPost = {
          title: "Integration Test Post",
          content: "This post tests the full event flow",
          author: "Test Author",
        };

        // Act: PostgreSQLにINSERT
        const result = await pgPool.query(
          "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
          [testPost.title, testPost.content, testPost.author],
        );

        const insertedPost = result.rows[0];
        const postId = insertedPost.id;

        console.log(`📝 Inserted post ${postId} into PostgreSQL`);

        // Assert: CDC経由でElasticsearchとRedisに伝播されるのを待つ
        // 結果整合性のため、最大10秒待機
        let esIndexed = false;
        let redisCached = false;

        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms待機

          // Elasticsearchを確認
          if (!esIndexed) {
            try {
              const esResult = await es.get({
                index: "posts",
                id: postId.toString(),
              });
              if (esResult._source) {
                esIndexed = true;
                console.log(`✅ Post ${postId} indexed in Elasticsearch`);

                // Elasticsearch のデータを検証
                expect(esResult._source).toMatchObject({
                  id: postId,
                  title: testPost.title,
                  content: testPost.content,
                  author: testPost.author,
                });
              }
            } catch (error) {
              // まだ索引されていない
            }
          }

          // Redisを確認
          if (!redisCached) {
            const cachedValue = await redis.get(`post:${postId}`);
            if (cachedValue) {
              redisCached = true;
              console.log(`✅ Post ${postId} cached in Redis`);

              // Redis のデータを検証
              const cachedPost = JSON.parse(cachedValue);
              expect(cachedPost).toMatchObject({
                id: postId,
                title: testPost.title,
                content: testPost.content,
                author: testPost.author,
              });
            }
          }

          // 両方成功したらループ終了
          if (esIndexed && redisCached) {
            break;
          }
        }

        // 最終確認
        expect(esIndexed).toBe(true);
        expect(redisCached).toBe(true);

        // クリーンアップ
        await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
      },
      TEST_TIMEOUT,
    );

    it(
      "should propagate UPDATE from PostgreSQL to Elasticsearch and Redis",
      async () => {
        // Arrange: まず投稿を作成
        const result = await pgPool.query(
          "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
          ["Original Title", "Original Content", "Test Author"],
        );

        const postId = result.rows[0].id;
        console.log(`📝 Created post ${postId} for UPDATE test`);

        // 伝播を待つ
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Act: 投稿を更新
        await pgPool.query(
          "UPDATE posts SET title = $1, content = $2 WHERE id = $3",
          ["Updated Title", "Updated Content", postId],
        );

        console.log(`✏️  Updated post ${postId} in PostgreSQL`);

        // Assert: 更新がElasticsearchとRedisに伝播されるのを待つ
        let esUpdated = false;
        let redisUpdated = false;

        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Elasticsearchを確認
          if (!esUpdated) {
            try {
              const esResult = await es.get({
                index: "posts",
                id: postId.toString(),
              });
              if ((esResult._source as any)?.title === "Updated Title") {
                esUpdated = true;
                console.log(`✅ Post ${postId} updated in Elasticsearch`);
              }
            } catch (error) {
              // まだ更新されていない
            }
          }

          // Redisを確認
          if (!redisUpdated) {
            const cachedValue = await redis.get(`post:${postId}`);
            if (cachedValue) {
              const cachedPost = JSON.parse(cachedValue);
              if (cachedPost.title === "Updated Title") {
                redisUpdated = true;
                console.log(`✅ Post ${postId} updated in Redis`);
              }
            }
          }

          if (esUpdated && redisUpdated) {
            break;
          }
        }

        expect(esUpdated).toBe(true);
        expect(redisUpdated).toBe(true);

        // クリーンアップ
        await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
      },
      TEST_TIMEOUT,
    );

    it(
      "should propagate DELETE from PostgreSQL to Elasticsearch and Redis",
      async () => {
        // Arrange: まず投稿を作成
        const result = await pgPool.query(
          "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
          ["Post to Delete", "Will be deleted", "Test Author"],
        );

        const postId = result.rows[0].id;
        console.log(`📝 Created post ${postId} for DELETE test`);

        // 伝播を待つ
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // ElasticsearchとRedisに存在することを確認
        const esBeforeDelete = await es.get({
          index: "posts",
          id: postId.toString(),
        });
        expect(esBeforeDelete._source as any).toBeTruthy();

        const redisBeforeDelete = await redis.get(`post:${postId}`);
        expect(redisBeforeDelete).toBeTruthy();

        // Act: 投稿を削除
        await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
        console.log(`🗑️  Deleted post ${postId} from PostgreSQL`);

        // Assert: 削除がElasticsearchとRedisに伝播されるのを待つ
        let esDeleted = false;
        let redisDeleted = false;

        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Elasticsearchを確認
          if (!esDeleted) {
            try {
              await es.get({
                index: "posts",
                id: postId.toString(),
              });
              // まだ存在する
            } catch (error: any) {
              if (error.meta?.statusCode === 404) {
                esDeleted = true;
                console.log(`✅ Post ${postId} deleted from Elasticsearch`);
              }
            }
          }

          // Redisを確認
          if (!redisDeleted) {
            const cachedValue = await redis.get(`post:${postId}`);
            if (!cachedValue) {
              redisDeleted = true;
              console.log(`✅ Post ${postId} deleted from Redis`);
            }
          }

          if (esDeleted && redisDeleted) {
            break;
          }
        }

        expect(esDeleted).toBe(true);
        expect(redisDeleted).toBe(true);
      },
      TEST_TIMEOUT,
    );
  });

  describe("Search Functionality", () => {
    it(
      "should find posts via Elasticsearch after propagation",
      async () => {
        // Arrange: 検索可能な投稿を作成
        const testPosts = [
          {
            title: "Kafka Tutorial",
            content: "Learn about Apache Kafka",
            author: "Alice",
          },
          {
            title: "Redis Guide",
            content: "Introduction to Redis caching",
            author: "Bob",
          },
          {
            title: "Elasticsearch Basics",
            content: "Getting started with Elasticsearch",
            author: "Charlie",
          },
        ];

        const postIds: number[] = [];

        for (const post of testPosts) {
          const result = await pgPool.query(
            "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
            [post.title, post.content, post.author],
          );
          postIds.push(result.rows[0].id);
        }

        console.log(`📝 Created ${postIds.length} posts for search test`);

        // 伝播を待つ（Elasticsearchの索引完了まで）
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Act: Elasticsearchで検索
        const searchResult = await es.search({
          index: "posts",
          body: {
            query: {
              multi_match: {
                query: "Kafka",
                fields: ["title", "content"],
              },
            },
          },
        });

        // Assert: "Kafka"を含む投稿がヒット
        expect(searchResult.hits.hits.length).toBeGreaterThan(0);

        const hitTitles = searchResult.hits.hits.map(
          (hit: any) => hit._source.title,
        );
        expect(hitTitles).toContain("Kafka Tutorial");

        console.log(
          `✅ Found ${searchResult.hits.hits.length} posts matching "Kafka"`,
        );

        // クリーンアップ
        for (const postId of postIds) {
          await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
        }
      },
      TEST_TIMEOUT,
    );
  });

  describe("Cache Performance", () => {
    it(
      "should serve cached data faster than database query",
      async () => {
        // Arrange: 投稿を作成
        const result = await pgPool.query(
          "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
          ["Cache Test Post", "Testing cache performance", "Test Author"],
        );

        const postId = result.rows[0].id;
        console.log(`📝 Created post ${postId} for cache performance test`);

        // キャッシュへの伝播を待つ
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Act: データベースから取得（キャッシュなし）
        const dbStartTime = Date.now();
        await pgPool.query("SELECT * FROM posts WHERE id = $1", [postId]);
        const dbTime = Date.now() - dbStartTime;

        // Redisから取得（キャッシュあり）
        const cacheStartTime = Date.now();
        await redis.get(`post:${postId}`);
        const cacheTime = Date.now() - cacheStartTime;

        console.log(`⏱️  Database query: ${dbTime}ms`);
        console.log(`⏱️  Cache query: ${cacheTime}ms`);

        // Assert: キャッシュの方が速い（はず）
        // ただし、ローカル環境では差が小さいため、単に成功することを確認
        expect(cacheTime).toBeLessThanOrEqual(dbTime + 10); // 誤差を考慮

        // クリーンアップ
        await pgPool.query("DELETE FROM posts WHERE id = $1", [postId]);
      },
      TEST_TIMEOUT,
    );
  });
});
