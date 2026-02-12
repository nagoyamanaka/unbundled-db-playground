/**
 * Search Indexer Consumer
 * Kafka (blogdb.public.posts) → Elasticsearch
 *
 * PostgreSQLの変更をリアルタイムでElasticsearchに反映
 */

import { Kafka } from "kafkajs";
import { Client } from "@elastic/elasticsearch";
import type { DebeziumChangeEvent } from "../types/index.js";

const kafka = new Kafka({
  clientId: "search-indexer",
  brokers: ["localhost:9092"],
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
});

const es = new Client({ node: "http://localhost:9200" });

async function main() {
  const consumer = kafka.consumer({ groupId: "search-indexer-group" });

  console.log("🚀 Starting Search Indexer Consumer...");

  try {
    await consumer.connect();
    console.log("✅ Connected to Kafka");

    await consumer.subscribe({
      topic: "blogdb.public.posts",
      fromBeginning: true, // 初回は最初から読む
    });
    console.log("📡 Subscribed to topic: blogdb.public.posts");

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) {
          console.warn("⚠️  Received empty message");
          return;
        }

        try {
          const changeEvent: DebeziumChangeEvent = JSON.parse(
            message.value.toString(),
          );

          const operation = changeEvent.payload.op;
          console.log(
            `\n📨 Received event: ${operation} (offset: ${message.offset})`,
          );

          switch (operation) {
            case "c": // Create
            case "r": // Read (snapshot)
            case "u": // Update
              await handleCreateOrUpdate(changeEvent);
              break;

            case "d": // Delete
              await handleDelete(changeEvent);
              break;

            default:
              console.warn(`⚠️  Unknown operation: ${operation}`);
          }
        } catch (error) {
          console.error("❌ Error processing message:", error);
          // エラーでも続行（プロダクションではDLQに送る等の対応が必要）
        }
      },
    });
  } catch (error) {
    console.error("❌ Fatal error in consumer:", error);
    process.exit(1);
  }
}

async function handleCreateOrUpdate(event: DebeziumChangeEvent) {
  const post = event.payload.after;

  if (!post) {
    console.warn('⚠️  No "after" data in event');
    return;
  }

  console.log(`  📝 Indexing post ${post.id}: "${post.title}"`);

  try {
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
  } catch (error) {
    console.error(`  ❌ Failed to index post ${post.id}:`, error);
  }
}

async function handleDelete(event: DebeziumChangeEvent) {
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
  } catch (error) {
    // 404エラーは無視（既に削除済み）
    if ((error as any).meta?.statusCode !== 404) {
      console.error(`  ❌ Failed to delete post ${post.id}:`, error);
    }
  }
}

// シグナルハンドリング（graceful shutdown）
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down consumer...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down consumer...");
  process.exit(0);
});

// メイン実行
main();
