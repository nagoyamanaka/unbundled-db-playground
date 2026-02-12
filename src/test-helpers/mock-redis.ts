/**
 * Redis モック用のテストヘルパー
 * 単体テストでRedis接続なしでConsumer/APIをテストするため
 */

import { vi } from "vitest";
import type Redis from "ioredis";

/**
 * Redis クライアントのモック
 *
 * メモリ内にデータを保持し、実際のRedisと同様の動作を模倣
 */
export class MockRedis {
  private data = new Map<string, string>();
  private expiry = new Map<string, number>();
  private sortedSets = new Map<string, Map<string, number>>();

  // 基本操作
  get = vi.fn(async (key: string): Promise<string | null> => {
    this.checkExpiry(key);
    return this.data.get(key) ?? null;
  });

  set = vi.fn(async (key: string, value: string): Promise<"OK"> => {
    this.data.set(key, value);
    return "OK";
  });

  setex = vi.fn(
    async (key: string, seconds: number, value: string): Promise<"OK"> => {
      this.data.set(key, value);
      this.expiry.set(key, Date.now() + seconds * 1000);
      return "OK";
    },
  );

  del = vi.fn(async (...keys: string[]): Promise<number> => {
    let count = 0;
    for (const key of keys) {
      if (this.data.delete(key)) {
        count++;
      }
      this.expiry.delete(key);
      this.sortedSets.delete(key);
    }
    return count;
  });

  // Sorted Set 操作
  zadd = vi.fn(
    async (key: string, score: number, member: string): Promise<number> => {
      if (!this.sortedSets.has(key)) {
        this.sortedSets.set(key, new Map());
      }
      const set = this.sortedSets.get(key)!;
      const isNew = !set.has(member);
      set.set(member, score);
      return isNew ? 1 : 0;
    },
  );

  zrem = vi.fn(async (key: string, member: string): Promise<number> => {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  });

  zrevrange = vi.fn(
    async (key: string, start: number, stop: number): Promise<string[]> => {
      const set = this.sortedSets.get(key);
      if (!set) return [];

      const sorted = Array.from(set.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([member]) => member);

      if (stop === -1) {
        return sorted.slice(start);
      }
      return sorted.slice(start, stop + 1);
    },
  );

  // その他の操作
  expire = vi.fn(async (key: string, seconds: number): Promise<number> => {
    if (!this.data.has(key) && !this.sortedSets.has(key)) {
      return 0;
    }
    this.expiry.set(key, Date.now() + seconds * 1000);
    return 1;
  });

  ping = vi.fn(async (): Promise<"PONG"> => {
    return "PONG";
  });

  quit = vi.fn(async (): Promise<"OK"> => {
    this.clear();
    return "OK";
  });

  // ヘルパーメソッド（テスト用）
  private checkExpiry(key: string): void {
    const expiryTime = this.expiry.get(key);
    if (expiryTime && Date.now() > expiryTime) {
      this.data.delete(key);
      this.sortedSets.delete(key);
      this.expiry.delete(key);
    }
  }

  clear(): void {
    this.data.clear();
    this.expiry.clear();
    this.sortedSets.clear();
  }

  // テスト用のデータ確認メソッド
  getAllData(): Map<string, string> {
    return new Map(this.data);
  }

  getAllSortedSets(): Map<string, Map<string, number>> {
    return new Map(this.sortedSets);
  }
}

/**
 * Redis クライアントのファクトリー関数
 */
export function createMockRedis(): MockRedis {
  return new MockRedis();
}

/**
 * DDT用: キャッシュ操作のテストケース
 */
export interface CacheTestCase {
  name: string;
  operation: "set" | "get" | "delete";
  key: string;
  value?: string;
  ttl?: number;
  expectedResult: any;
}

export function generateCacheTestCases(): CacheTestCase[] {
  return [
    {
      name: "SET should store value",
      operation: "set",
      key: "post:1",
      value: JSON.stringify({ id: 1, title: "Test" }),
      expectedResult: "OK",
    },
    {
      name: "GET should retrieve stored value",
      operation: "get",
      key: "post:1",
      expectedResult: JSON.stringify({ id: 1, title: "Test" }),
    },
    {
      name: "GET non-existent key should return null",
      operation: "get",
      key: "post:999",
      expectedResult: null,
    },
    {
      name: "DELETE should remove value",
      operation: "delete",
      key: "post:1",
      expectedResult: 1,
    },
  ];
}
