/**
 * Elasticsearch モック用のテストヘルパー
 * 単体テストでElasticsearch接続なしでConsumerをテストするため
 */

import { vi } from "vitest";
import type { Client } from "@elastic/elasticsearch";

/**
 * Elasticsearch クライアントのモック
 *
 * メモリ内にドキュメントを保持し、基本的な検索操作を模倣
 */
export class MockElasticsearch {
  private documents = new Map<string, Map<string, any>>();

  // インデックス操作
  index = vi.fn(
    async (params: {
      index: string;
      id: string;
      document: any;
    }): Promise<any> => {
      if (!this.documents.has(params.index)) {
        this.documents.set(params.index, new Map());
      }

      const indexDocs = this.documents.get(params.index)!;
      indexDocs.set(params.id, params.document);

      return {
        _index: params.index,
        _id: params.id,
        result: indexDocs.has(params.id) ? "updated" : "created",
      };
    },
  );

  // 削除操作
  delete = vi.fn(
    async (params: { index: string; id: string }): Promise<any> => {
      const indexDocs = this.documents.get(params.index);
      if (!indexDocs || !indexDocs.has(params.id)) {
        const error: any = new Error("Document not found");
        error.meta = { statusCode: 404 };
        throw error;
      }

      indexDocs.delete(params.id);

      return {
        _index: params.index,
        _id: params.id,
        result: "deleted",
      };
    },
  );

  // 検索操作
  search = vi.fn(
    async (params: {
      index: string;
      body?: any;
      query?: any;
    }): Promise<any> => {
      const indexDocs = this.documents.get(params.index);
      if (!indexDocs) {
        return {
          hits: {
            total: { value: 0 },
            hits: [],
          },
        };
      }

      // シンプルな全文検索の模倣
      const query = params.body?.query || params.query;
      const searchQuery = query?.multi_match?.query?.toLowerCase() || "";

      const hits = Array.from(indexDocs.entries())
        .filter(([id, doc]) => {
          if (!searchQuery) return true;

          const titleMatch = doc.title?.toLowerCase().includes(searchQuery);
          const contentMatch = doc.content?.toLowerCase().includes(searchQuery);

          return titleMatch || contentMatch;
        })
        .map(([id, doc]) => ({
          _index: params.index,
          _id: id,
          _source: doc,
          _score: 1.0,
        }));

      return {
        hits: {
          total: { value: hits.length },
          hits,
        },
      };
    },
  );

  // Ping (ヘルスチェック)
  ping = vi.fn(async (): Promise<boolean> => {
    return true;
  });

  // インデックス管理
  indices = {
    exists: vi.fn(async (): Promise<boolean> => {
      return true;
    }),
    create: vi.fn(async (): Promise<any> => {
      return { acknowledged: true };
    }),
    delete: vi.fn(async (): Promise<any> => {
      return { acknowledged: true };
    }),
    getMapping: vi.fn(async (): Promise<any> => {
      return {
        posts: {
          mappings: {
            properties: {
              id: { type: "integer" },
              title: { type: "text" },
              content: { type: "text" },
              author: { type: "keyword" },
              created_at: { type: "date" },
              updated_at: { type: "date" },
            },
          },
        },
      };
    }),
  };

  // クラスター管理
  cluster = {
    health: vi.fn(async (): Promise<any> => {
      return { status: "green" };
    }),
  };

  // ヘルパーメソッド（テスト用）
  clear(): void {
    this.documents.clear();
  }

  getAllDocuments(index: string): Map<string, any> {
    return this.documents.get(index) || new Map();
  }

  getDocumentCount(index: string): number {
    return this.documents.get(index)?.size || 0;
  }
}

/**
 * Elasticsearch クライアントのファクトリー関数
 */
export function createMockElasticsearch(): MockElasticsearch {
  return new MockElasticsearch();
}

/**
 * DDT用: Elasticsearch操作のテストケース
 */
export interface ElasticsearchTestCase {
  name: string;
  operation: "index" | "delete" | "search";
  index: string;
  id?: string;
  document?: any;
  query?: string;
  expectedResult: any;
}

export function generateElasticsearchTestCases(): ElasticsearchTestCase[] {
  const testDoc = {
    id: 1,
    title: "Test Post",
    content: "Test Content",
    author: "Test Author",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return [
    {
      name: "INDEX should store document",
      operation: "index",
      index: "posts",
      id: "1",
      document: testDoc,
      expectedResult: { result: "created" },
    },
    {
      name: "SEARCH with matching query should return documents",
      operation: "search",
      index: "posts",
      query: "Test",
      expectedResult: { hitCount: 1 },
    },
    {
      name: "SEARCH with non-matching query should return empty",
      operation: "search",
      index: "posts",
      query: "NonExistent",
      expectedResult: { hitCount: 0 },
    },
    {
      name: "DELETE should remove document",
      operation: "delete",
      index: "posts",
      id: "1",
      expectedResult: { result: "deleted" },
    },
  ];
}
