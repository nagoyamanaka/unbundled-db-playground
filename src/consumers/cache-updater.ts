/**
 * Cache Updater Consumer
 * Kafka (blogdb.public.posts) → Redis
 *
 * PostgreSQLの変更をRedisキャッシュに反映
 * Write-Through Cache パターンの実装
 */

import { Kafka } from "kafkajs";
import Redis from "ioredis";
import type { DebeziumChangeEvent } from "../types/index.js";

const kafka = new Kafka({
  clientId: "cache-updater",
  brokers: ["localhost:9092"],
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
});

const redis = new Redis({
  host: "localhost",
  port: 6380,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

const CACHE_TTL = 300; // 5分

async function main() {
  const consumer = kafka.consumer({ groupId: "cache-updater-group" });

  console.log("🚀 Starting Cache Updater Consumer...");

  try {
    await consumer.connect();
    console.log("✅ Connected to Kafka");

    await consumer.subscribe({
      topic: "blogdb.public.posts",
      fromBeginning: true,
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

  console.log(`  💾 Caching post ${post.id}: "${post.title}"`);

  try {
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

    // オプション: 著者別の投稿リストもキャッシュ
    await updateAuthorPostsList(post.author, post.id);
  } catch (error) {
    console.error(`  ❌ Failed to cache post ${post.id}:`, error);
  }
}

async function handleDelete(event: DebeziumChangeEvent) {
  const post = event.payload.before;

  if (!post) {
    console.warn('⚠️  No "before" data in delete event');
    return;
  }

  console.log(`  🗑️  Invalidating cache for post ${post.id}`);

  try {
    const cacheKey = `post:${post.id}`;
    await redis.del(cacheKey);

    console.log(`  ✅ Deleted post ${post.id} from cache`);

    // 著者別リストからも削除
    await removeFromAuthorPostsList(post.author, post.id);
  } catch (error) {
    console.error(`  ❌ Failed to delete cache for post ${post.id}:`, error);
  }
}

// 著者別の投稿ID一覧を更新（Sorted Set使用）
async function updateAuthorPostsList(author: string, postId: number) {
  try {
    const key = `author:${author}:posts`;
    // タイムスタンプをスコアにして追加
    await redis.zadd(key, Date.now(), postId.toString());
    // TTLも設定
    await redis.expire(key, CACHE_TTL);
    console.log(`  📋 Updated author list: ${author}`);
  } catch (error) {
    console.error(`  ⚠️  Failed to update author list:`, error);
  }
}

async function removeFromAuthorPostsList(author: string, postId: number) {
  try {
    const key = `author:${author}:posts`;
    await redis.zrem(key, postId.toString());
    console.log(`  📋 Removed from author list: ${author}`);
  } catch (error) {
    console.error(`  ⚠️  Failed to remove from author list:`, error);
  }
}

// シグナルハンドリング
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down consumer...");
  await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down consumer...");
  await redis.quit();
  process.exit(0);
});

// メイン実行
main();
