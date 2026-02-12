/**
 * Debezium Connector のセットアップスクリプト
 * PostgreSQL の変更をKafkaにストリームするためのコネクタを登録
 */

import { ConnectorStatus, ConnectorConfig } from "../types/index";

const DEBEZIUM_API = "http://localhost:8083";

async function setupDebeziumConnector() {
  console.log("🔧 Setting up Debezium PostgreSQL connector...");

  const connectorConfig = {
    name: "postgres-connector",
    config: {
      "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
      "database.hostname": "postgres",
      "database.port": "5432",
      "database.user": "blog_user",
      "database.password": "blog_pass",
      "database.dbname": "blog_db",
      "database.server.name": "blogdb",
      "table.include.list": "public.posts",
      "plugin.name": "pgoutput",
      "publication.autocreate.mode": "filtered",
      "slot.name": "debezium_slot",
      "topic.prefix": "blogdb",
      // スナップショットモード（初回起動時に既存データも取得）
      "snapshot.mode": "initial",
      // タイムゾーン設定
      "time.precision.mode": "connect",
      // トランザクションメタデータも取得
      "provide.transaction.metadata": "true",
    },
  };

  try {
    // 既存のコネクタを削除（存在する場合）
    try {
      await fetch(`${DEBEZIUM_API}/connectors/postgres-connector`, {
        method: "DELETE",
      });
      console.log("🗑️  Deleted existing connector");
      // 削除後、少し待つ
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      // 存在しない場合は無視
    }

    // 新しいコネクタを登録
    const response = await fetch(`${DEBEZIUM_API}/connectors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(connectorConfig),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create connector: ${error}`);
    }

    const result = (await response.json()) as ConnectorConfig;
    console.log("✅ Debezium connector created successfully!");
    console.log("📋 Connector info:", JSON.stringify(result, null, 2));

    // ステータス確認
    await checkConnectorStatus();
  } catch (error) {
    console.error("❌ Error setting up Debezium:", error);
    process.exit(1);
  }
}

async function checkConnectorStatus() {
  console.log("\n🔍 Checking connector status...");

  try {
    const response = await fetch(
      `${DEBEZIUM_API}/connectors/postgres-connector/status`,
    );
    const status = (await response.json()) as ConnectorStatus;

    console.log("📊 Connector Status:");
    console.log(`  - State: ${status.connector.state}`);
    console.log(`  - Worker ID: ${status.connector.worker_id}`);

    if (status.tasks && status.tasks.length > 0) {
      console.log("  - Tasks:");
      status.tasks.forEach((task: any, index: number) => {
        console.log(`    ${index}: ${task.state} (${task.worker_id})`);
      });
    }

    if (status.connector.state === "RUNNING") {
      console.log(
        "\n🎉 Connector is running! Changes to PostgreSQL will now be streamed to Kafka.",
      );
      console.log("📡 Topic: blogdb.public.posts");
    } else {
      console.warn("\n⚠️  Connector is not running. Check logs for errors.");
    }
  } catch (error) {
    console.error("❌ Error checking status:", error);
  }
}

// メイン実行
setupDebeziumConnector();
