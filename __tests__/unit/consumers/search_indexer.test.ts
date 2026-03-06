/**
 * Search Indexer Consumer の単体テスト
 * DDT (Data-Driven Testing) を活用して複数のシナリオをテスト
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockKafkaMessage,
  generateDebeziumTestCases,
  type DebeziumTestCase,
} from "@/test-helpers/mock-kafka";
import { createMockElasticsearch } from "@/test-helpers/mock-elasticsearch";
import type { DebeziumChangeEvent } from "@/types/index";

describe("Search Indexer Consumer", () => {
  // ReturnType<typeof 関数名>
  // その関数がreturn する値の型をそのまま型として取得する働き
  // 今回だとmockEs:MockElasticsearchになる
  // なぜMockElasticSearchと書かないか
  // -> メリットは型の追従性(DRY)
  let mockEs: ReturnType<typeof createMockElasticsearch>;

  beforeEach(() => {
    mockEs = createMockElasticsearch();
    // mockEs以外のグローバルモックがある場合or今後出る場合の保険として
    // 全てのvitestMockを初期化
    vi.clearAllMocks();
  });

  describe("Debezium Event Processing", () => {
    /**
     * DDT: 複数のDebeziumイベントパターンをテスト
     * CREATE/UPDATE/DELETE/READの各操作を網羅的に検証
     */
    const testCases = generateDebeziumTestCases();

    testCases.forEach((testCase: DebeziumTestCase) => {
      it(testCase.name, async () => {
        // Arrange: Kafkaメッセージを準備
        const message = createMockKafkaMessage({
          topic: "blogdb.public.posts",
          value: JSON.stringify(testCase.event),
        });

        const changeEvent: DebeziumChangeEvent = JSON.parse(
          message.message.value!.toString(),
        );

        // Act: イベントタイプに応じた処理を実行
        switch (testCase.expectedOperation) {
          case "index":
            await handleCreateOrUpdate(changeEvent, mockEs);
            break;
          case "delete":
            await handleDelete(changeEvent, mockEs);
            break;
          case "skip":
            // スキップ処理（何もしない）
            break;
        }

        // Assert: 期待される結果を検証
        if (testCase.expectedOperation === "index") {
          expect(mockEs.index).toHaveBeenCalledTimes(1);
          const post = changeEvent.payload.after;
          expect(mockEs.index).toHaveBeenCalledWith({
            index: "posts",
            id: post?.id.toString(),
            document: expect.objectContaining({
              id: post?.id,
              title: post?.title,
              content: post?.content,
              author: post?.author,
            }),
          });
        } else if (testCase.expectedOperation === "delete") {
          expect(mockEs.delete).toHaveBeenCalledTimes(1);
          const post = changeEvent.payload.before;
          expect(mockEs.delete).toHaveBeenCalledWith({
            index: "posts",
            id: post?.id.toString(),
          });
        }
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle Elasticsearch index errors gracefully", async () => {
      // Arrange: indexエラーを発生させる
      mockEs.index.mockRejectedValueOnce(new Error("Network error"));

      const event = generateDebeziumTestCases()[0].event;
      const changeEvent: DebeziumChangeEvent = event as any;

      // Act & Assert: エラーをキャッチして適切に処理
      await expect(async () => {
        await handleCreateOrUpdate(changeEvent, mockEs);
      }).rejects.toThrow("Network error");
    });

    it("should ignore 404 errors when deleting non-existent documents", async () => {
      // Arrange: 404エラーを模擬
      const error: any = new Error("Document not found");
      error.meta = { statusCode: 404 };
      mockEs.delete.mockRejectedValueOnce(error);

      const event = generateDebeziumTestCases()[2].event; // DELETE event
      const changeEvent: DebeziumChangeEvent = event as any;

      // Act: エラーを無視して処理
      await handleDelete(changeEvent, mockEs);

      // Assert: deleteは呼ばれたが、エラーは無視される
      expect(mockEs.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("Data Validation", () => {
    /**
     * DDT: 不正なデータのハンドリング
     */
    const invalidDataCases = [
      {
        name: 'should skip event with no "after" data',
        event: {
          payload: {
            op: "c" as const,
            before: null,
            after: null,
            source: {},
            ts_ms: Date.now(),
            transaction: null,
          },
        },
        shouldProcess: false,
      },
      {
        name: "should skip event with missing required fields",
        event: {
          payload: {
            op: "c" as const,
            before: null,
            after: {
              id: 1,
              // title, content, authorが欠けている
            },
            source: {},
            ts_ms: Date.now(),
            transaction: null,
          },
        },
        shouldProcess: false,
      },
    ];

    invalidDataCases.forEach((testCase) => {
      it(testCase.name, async () => {
        // Act: 不正なデータで処理を試みる
        await handleCreateOrUpdate(testCase.event as any, mockEs);

        // Assert: indexは呼ばれない（スキップされる）
        if (!testCase.shouldProcess) {
          expect(mockEs.index).not.toHaveBeenCalled();
        }
      });
    });
  });
});

/**
 * テスト対象の関数（実際のConsumerから抽出）
 * 実際の実装では、Consumerクラスからこれらのメソッドを分離してテスト可能にする
 */
async function handleCreateOrUpdate(
  event: DebeziumChangeEvent,
  es: ReturnType<typeof createMockElasticsearch>,
) {
  const post = event.payload.after;

  if (!post) {
    console.warn('⚠️  No "after" data in event');
    return;
  }

  // 必須フィールドの検証
  if (!post.id || !post.title || !post.content || !post.author) {
    console.warn("⚠️  Missing required fields in post data");
    return;
  }

  console.log(`  📝 Indexing post ${post.id}: "${post.title}"`);

  await es.index({
    index: "posts",
    id: post.id.toString(),
    document: {
      id: post.id,
      title: post.title,
      content: post.content,
      author: post.author,
      created_at: post.created_at,
      updated_at: post.updated_at,
    },
  });

  console.log(`  ✅ Indexed post ${post.id} to Elasticsearch`);
}

async function handleDelete(
  event: DebeziumChangeEvent,
  es: ReturnType<typeof createMockElasticsearch>,
) {
  const post = event.payload.before;

  if (!post) {
    console.warn('⚠️  No "before" data in delete event');
    return;
  }

  console.log(`  🗑️  Deleting post ${post.id} from index`);

  try {
    await es.delete({
      index: "posts",
      id: post.id.toString(),
    });

    console.log(`  ✅ Deleted post ${post.id} from Elasticsearch`);
  } catch (error: any) {
    // 404エラーは無視（既に削除済み）
    if (error.meta?.statusCode !== 404) {
      console.error(`  ❌ Failed to delete post ${post.id}:`, error);
      throw error;
    }
  }
}
