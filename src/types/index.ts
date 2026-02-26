// Post entity
export interface Post {
  id: number;
  title: string;
  content: string;
  author: string;
  created_at: Date;
  updated_at: Date;
}

type SnapshotFlag = "true" | "false" | "last";

// Debezium CDC Event Structure
export interface DebeziumChangeEvent {
  schema?: unknown;
  payload: {
    before: Post | null;
    after: Post | null;
    source: {
      version: string;
      connector: string;
      name: string;
      ts_ms: number;
      snapshot: SnapshotFlag;
      db: string;
      schema: string;
      table: string;
      lsn: string | number;
      txId: string | number;
      xmin: number | null;
    };
    op: "c" | "u" | "d" | "r"; // create, update, delete, read(snapshot)
    ts_ms: number;
    transaction?: {
      id: string;
      total_order: number;
      data_collection_order: number;
    } | null;
  };
}

// Kafka Message
export interface KafkaMessage {
  key: Buffer | null;
  value: Buffer | null;
  timestamp: string;
  offset: string;
  partition: number;
  headers?: Record<string, Buffer>;
}

// Debezium Connector Status Response
export interface ConnectorStatus {
  name: string;
  connector: {
    state: string;
    worker_id: string;
  };
  tasks: Array<{
    id: number;
    state: string;
    worker_id: string;
  }>;
}

// Debezium Connector Config Response
export interface ConnectorConfig {
  name: string;
  config: Record<string, string>;
}
