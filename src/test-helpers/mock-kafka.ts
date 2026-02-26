/**
 * Kafka モック用のテストヘルパー
 * 単体テストでKafka接続なしでConsumerをテストするため
 */

import { vi } from "vitest";
import type { Consumer, EachMessagePayload, Kafka } from "kafkajs";

/**
 * Kafka メッセージのモック生成
 */
export function createMockKafkaMessage(payload: {
  key?: string;
  value: string;
  topic: string;
  partition?: number;
  offset?: string;
}): EachMessagePayload {
  return {
    topic: payload.topic,
    partition: payload.partition ?? 0,
    message: {
      key: payload.key ? Buffer.from(payload.key) : null,
      value: Buffer.from(payload.value),
      timestamp: Date.now().toString(),
      offset: payload.offset ?? "0",
      headers: {},
      attributes: 0,
    },
    heartbeat: vi.fn(),
    pause: vi.fn(),
  };
}

/**
 * Debezium CDC イベントのモック生成
 */
export function createMockDebeziumEvent(params: {
  op: "c" | "u" | "d" | "r"; // create, update, delete, read
  before?: any;
  after?: any;
  source?: {
    db?: string;
    schema?: string;
    table?: string;
  };
}) {
  return {
    schema: {},
    payload: {
      op: params.op,
      before: params.before ?? null,
      after: params.after ?? null,
      source: {
        version: "2.4.0.Final",
        connector: "postgresql",
        name: "blogdb",
        ts_ms: Date.now(),
        snapshot: "false",
        db: params.source?.db ?? "blog_db",
        schema: params.source?.schema ?? "public",
        table: params.source?.table ?? "posts",
        txId: 1,
        lsn: 1,
        xmin: null,
      },
      ts_ms: Date.now(),
      transaction: null,
    },
  };
}

/**
 * DDT (Data-Driven Testing) 用のテストケース生成
 * 複数のDebeziumイベントパターンをテストするため
 */
export interface DebeziumTestCase {
  name: string;
  event: ReturnType<typeof createMockDebeziumEvent>;
  expectedOperation: "index" | "delete" | "skip";
}

export function generateDebeziumTestCases(): DebeziumTestCase[] {
  return [
    {
      name: "CREATE event should trigger index",
      event: createMockDebeziumEvent({
        op: "c",
        after: {
          id: 1,
          title: "Test Post",
          content: "Test Content",
          author: "Test Author",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
      expectedOperation: "index",
    },
    {
      name: "UPDATE event should trigger index",
      event: createMockDebeziumEvent({
        op: "u",
        before: {
          id: 1,
          title: "Old Title",
          content: "Old Content",
          author: "Test Author",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        after: {
          id: 1,
          title: "New Title",
          content: "New Content",
          author: "Test Author",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
      expectedOperation: "index",
    },
    {
      name: "DELETE event should trigger delete",
      event: createMockDebeziumEvent({
        op: "d",
        before: {
          id: 1,
          title: "Test Post",
          content: "Test Content",
          author: "Test Author",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
      expectedOperation: "delete",
    },
    {
      name: "READ (snapshot) event should trigger index",
      event: createMockDebeziumEvent({
        op: "r",
        after: {
          id: 1,
          title: "Test Post",
          content: "Test Content",
          author: "Test Author",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
      expectedOperation: "index",
    },
  ];
}
