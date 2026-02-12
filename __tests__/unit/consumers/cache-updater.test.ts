/**
 * Cache Updater Consumer の単体テスト
 * DDT (Data-Driven Testing) を活用してキャッシュ操作をテスト
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockKafkaMessage,
  generateDebeziumTestCases,
} from "@/test-helpers/mock-kafka";
import { createMockRedis } from "@/test-helpers/mock-redis";
import type { DebeziumChangeEvent } from "@/types/index";

const CACHE_TTL = 300; // 5分

describe("Cache Updater Consumer", () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    vi.clearAllMocks();
  });

  describe("Debezium Event Processing", () => {
    /**
     * DDT: 複数のDebeziumイベントパターンをテスト
     */
    const testCases = generateDebeziumTestCases();

    testCases.forEach((testCase) => {
      it(testCase.name, async () => {
        // Arrange
        const message = createMockKafkaMessage({
          topic: "blogdb.public.posts",
          value: JSON.stringify(testCase.event),
        });

        const changeEvent: DebeziumChangeEvent = JSON.parse(
          message.message.value!.toString(),
        );

        // Act
        switch (testCase.expectedOperation) {
          case "index":
            await handleCreateOrUpdate(changeEvent, mockRedis);
            break;
          case "delete":
            await handleDelete(changeEvent, mockRedis);
            break;
        }

        // Assert
        if (testCase.expectedOperation === "index") {
          const post = changeEvent.payload.after;
          expect(mockRedis.setex).toHaveBeenCalledTimes(1);
          expect(mockRedis.setex).toHaveBeenCalledWith(
            `post:${post?.id}`,
            CACHE_TTL,
            expect.any(String),
          );

          // 著者別リストも更新されるはず
          expect(mockRedis.zadd).toHaveBeenCalledWith(
            `author:${post?.author}:posts`,
            expect.any(Number),
            post?.id.toString(),
          );
        } else if (testCase.expectedOperation === "delete") {
          const post = changeEvent.payload.before;
          expect(mockRedis.del).toHaveBeenCalledWith(`post:${post?.id}`);
          expect(mockRedis.zrem).toHaveBeenCalledWith(
            `author:${post?.author}:posts`,
            post?.id.toString(),
          );
        }
      });
    });
  });

  describe("Cache Operations", () => {
    /**
     * DDT: キャッシュの基本操作をテスト
     */
    const cacheOperationCases = [
      {
        name: "should cache post with correct TTL",
        post: {
          id: 1,
          title: "Test Post",
          content: "Test Content",
          author: "Alice",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        expectedKey: "post:1",
        expectedTTL: CACHE_TTL,
      },
      {
        name: "should cache post with special characters in title",
        post: {
          id: 2,
          title: 'Test "Post" with <special> & characters',
          content: "Content with 改行\n and タブ\t",
          author: "Bob",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        expectedKey: "post:2",
        expectedTTL: CACHE_TTL,
      },
      {
        name: "should update author posts list",
        post: {
          id: 3,
          title: "Another Post",
          content: "More Content",
          author: "Charlie",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        expectedAuthorKey: "author:Charlie:posts",
        expectedMember: "3",
      },
    ];

    cacheOperationCases.forEach((testCase) => {
      it(testCase.name, async () => {
        // Arrange
        const event = {
          payload: {
            op: "c" as const,
            before: null,
            after: testCase.post,
            source: {},
            ts_ms: Date.now(),
            transaction: null,
          },
        };

        // Act
        await handleCreateOrUpdate(event as any, mockRedis);

        // Assert
        if (testCase.expectedKey) {
          expect(mockRedis.setex).toHaveBeenCalledWith(
            testCase.expectedKey,
            testCase.expectedTTL,
            expect.any(String),
          );

          // キャッシュされた値を検証
          const cachedValue = JSON.parse(
            (mockRedis.setex as any).mock.calls[0][2],
          );
          expect(cachedValue).toEqual(testCase.post);
        }

        if (testCase.expectedAuthorKey) {
          expect(mockRedis.zadd).toHaveBeenCalledWith(
            testCase.expectedAuthorKey,
            expect.any(Number),
            testCase.expectedMember,
          );
        }
      });
    });
  });

  describe("Author Posts List Management", () => {
    it("should maintain sorted set of author posts", async () => {
      // Arrange: 同じ著者の複数の投稿
      const posts = [
        { id: 1, author: "Alice", title: "Post 1" },
        { id: 2, author: "Alice", title: "Post 2" },
        { id: 3, author: "Alice", title: "Post 3" },
      ];

      // Act: 投稿を順番にキャッシュ
      for (const post of posts) {
        const event = {
          payload: {
            op: "c" as const,
            before: null,
            after: {
              ...post,
              content: "Test Content",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            source: {},
            ts_ms: Date.now(),
            transaction: null,
          },
        };
        await handleCreateOrUpdate(event as any, mockRedis);
      }

      // Assert: 著者別リストが正しく更新されている
      expect(mockRedis.zadd).toHaveBeenCalledTimes(3);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        "author:Alice:posts",
        CACHE_TTL,
      );
    });

    it("should remove post from author list on delete", async () => {
      // Arrange: 投稿を削除
      const post = {
        id: 1,
        title: "Test Post",
        content: "Test Content",
        author: "Alice",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const event = {
        payload: {
          op: "d" as const,
          before: post,
          after: null,
          source: {},
          ts_ms: Date.now(),
          transaction: null,
        },
      };

      // Act
      await handleDelete(event as any, mockRedis);

      // Assert
      expect(mockRedis.zrem).toHaveBeenCalledWith("author:Alice:posts", "1");
    });
  });

  describe("Error Handling", () => {
    it("should handle Redis connection errors", async () => {
      // Arrange: Redisエラーを模擬
      mockRedis.setex.mockRejectedValueOnce(new Error("Connection refused"));

      const event = generateDebeziumTestCases()[0].event;

      // Act & Assert
      await expect(async () => {
        await handleCreateOrUpdate(event as any, mockRedis);
      }).rejects.toThrow("Connection refused");
    });

    it('should skip event with no "after" data', async () => {
      // Arrange: "after"がnullのイベント
      const event = {
        payload: {
          op: "c" as const,
          before: null,
          after: null,
          source: {},
          ts_ms: Date.now(),
          transaction: null,
        },
      };

      // Act
      await handleCreateOrUpdate(event as any, mockRedis);

      // Assert: Redisは呼ばれない
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });
});

/**
 * テスト対象の関数（実際のConsumerから抽出）
 */
async function handleCreateOrUpdate(
  event: DebeziumChangeEvent,
  redis: ReturnType<typeof createMockRedis>,
) {
  const post = event.payload.after;

  if (!post) {
    console.warn('⚠️  No "after" data in event');
    return;
  }

  console.log(`  💾 Caching post ${post.id}: "${post.title}"`);

  const cacheKey = `post:${post.id}`;
  const cacheValue = JSON.stringify({
    id: post.id,
    title: post.title,
    content: post.content,
    author: post.author,
    created_at: post.created_at,
    updated_at: post.updated_at,
  });

  // TTL付きでキャッシュに保存
  await redis.setex(cacheKey, CACHE_TTL, cacheValue);

  console.log(`  ✅ Cached post ${post.id} (TTL: ${CACHE_TTL}s)`);

  // 著者別の投稿リストもキャッシュ
  await updateAuthorPostsList(redis, post.author, post.id);
}

async function handleDelete(
  event: DebeziumChangeEvent,
  redis: ReturnType<typeof createMockRedis>,
) {
  const post = event.payload.before;

  if (!post) {
    console.warn('⚠️  No "before" data in delete event');
    return;
  }

  console.log(`  🗑️  Invalidating cache for post ${post.id}`);

  const cacheKey = `post:${post.id}`;
  await redis.del(cacheKey);

  console.log(`  ✅ Deleted post ${post.id} from cache`);

  // 著者別リストからも削除
  await removeFromAuthorPostsList(redis, post.author, post.id);
}

async function updateAuthorPostsList(
  redis: ReturnType<typeof createMockRedis>,
  author: string,
  postId: number,
) {
  const key = `author:${author}:posts`;
  await redis.zadd(key, Date.now(), postId.toString());
  await redis.expire(key, CACHE_TTL);
  console.log(`  📋 Updated author list: ${author}`);
}

async function removeFromAuthorPostsList(
  redis: ReturnType<typeof createMockRedis>,
  author: string,
  postId: number,
) {
  const key = `author:${author}:posts`;
  await redis.zrem(key, postId.toString());
  console.log(`  📋 Removed from author list: ${author}`);
}
