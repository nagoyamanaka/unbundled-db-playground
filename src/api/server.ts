/**
 * API Server
 * エンドポイント:
 * - POST /posts - 新規投稿作成（PostgreSQLに書き込み）
 * - GET /posts/:id - 投稿取得（Redisキャッシュ → PostgreSQL）
 * - GET /search - 全文検索（Elasticsearch）
 * - GET /posts/by-author/:author - 著者別投稿一覧
 */

import express from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { Client } from "@elastic/elasticsearch";
import type { Post } from "../types/index.js";

const app = express();
app.use(express.json());

// PostgreSQL接続
const pg = new Pool({
  host: "localhost",
  port: 5433,
  database: "blog_db",
  user: "blog_user",
  password: "blog_pass",
});

// Redis接続
const redis = new Redis({
  host: "localhost",
  port: 6380,
});

// Elasticsearch接続
const es = new Client({ node: "http://localhost:9200" });

// ヘルスチェック
app.get("/health", async (req, res) => {
  try {
    const pgHealth = await pg.query("SELECT 1");
    const redisHealth = await redis.ping();
    const esHealth = await es.ping();

    res.json({
      status: "ok",
      services: {
        postgresql: pgHealth ? "ok" : "error",
        redis: redisHealth === "PONG" ? "ok" : "error",
        elasticsearch: esHealth ? "ok" : "error",
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: (error as Error).message,
    });
  }
});

// 新規投稿作成（PostgreSQLに書き込み）
app.post("/posts", async (req, res) => {
  const { title, content, author } = req.body;

  if (!title || !content || !author) {
    return res.status(400).json({
      error: "title, content, and author are required",
    });
  }

  try {
    console.log(`📝 Creating post: "${title}" by ${author}`);

    const result = await pg.query<Post>(
      "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
      [title, content, author],
    );

    const post = result.rows[0];

    console.log(`✅ Post created with ID: ${post.id}`);
    console.log(`⏳ Waiting for CDC to propagate changes to Kafka...`);

    res.status(201).json({
      post,
      note: "Changes will be propagated to Elasticsearch and Redis via Kafka",
    });
  } catch (error) {
    console.error("❌ Error creating post:", error);
    res.status(500).json({
      error: "Failed to create post",
      details: (error as Error).message,
    });
  }
});

// 投稿取得（キャッシュ優先）
app.get("/posts/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Redisキャッシュをチェック
    console.log(`🔍 Looking for post ${id} in cache...`);
    const cached = await redis.get(`post:${id}`);

    if (cached) {
      console.log(`🎯 Cache HIT for post ${id}`);
      const post = JSON.parse(cached);
      return res.json({
        post,
        source: "cache",
      });
    }

    console.log(`💾 Cache MISS for post ${id}, querying database...`);

    // 2. PostgreSQLから取得
    const result = await pg.query<Post>("SELECT * FROM posts WHERE id = $1", [
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Post not found",
      });
    }

    const post = result.rows[0];
    console.log(`✅ Found post ${id} in database`);

    // 3. キャッシュに保存（TTL: 60秒）
    // 注意: 通常はConsumerがキャッシュを更新するが、ここでも念のため保存
    await redis.setex(`post:${id}`, 60, JSON.stringify(post));
    console.log(`💾 Cached post ${id}`);

    res.json({
      post,
      source: "database",
    });
  } catch (error) {
    console.error(`❌ Error fetching post ${id}:`, error);
    res.status(500).json({
      error: "Failed to fetch post",
      details: (error as Error).message,
    });
  }
});

// 投稿更新
app.put("/posts/:id", async (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body;

  try {
    console.log(`✏️  Updating post ${id}...`);

    const result = await pg.query<Post>(
      `UPDATE posts 
       SET title = COALESCE($1, title), 
           content = COALESCE($2, content),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [title, content, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Post not found",
      });
    }

    const post = result.rows[0];
    console.log(`✅ Post ${id} updated`);

    res.json({
      post,
      note: "Changes will be propagated via Kafka",
    });
  } catch (error) {
    console.error(`❌ Error updating post ${id}:`, error);
    res.status(500).json({
      error: "Failed to update post",
      details: (error as Error).message,
    });
  }
});

// 投稿削除
app.delete("/posts/:id", async (req, res) => {
  const { id } = req.params;

  try {
    console.log(`🗑️  Deleting post ${id}...`);

    const result = await pg.query(
      "DELETE FROM posts WHERE id = $1 RETURNING id",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Post not found",
      });
    }

    console.log(`✅ Post ${id} deleted`);

    res.json({
      message: `Post ${id} deleted`,
      note: "Deletion will be propagated via Kafka",
    });
  } catch (error) {
    console.error(`❌ Error deleting post ${id}:`, error);
    res.status(500).json({
      error: "Failed to delete post",
      details: (error as Error).message,
    });
  }
});

// 全文検索（Elasticsearch）
app.get("/search", async (req, res) => {
  const { q } = req.query;

  if (!q || typeof q !== "string") {
    return res.status(400).json({
      error: 'Query parameter "q" is required',
    });
  }

  try {
    console.log(`🔍 Searching for: "${q}"`);

    const result = await es.search({
      index: "posts",
      body: {
        query: {
          multi_match: {
            query: q,
            fields: ["title^2", "content"], // titleに2倍の重み
            fuzziness: "AUTO", // タイポ許容
          },
        },
        highlight: {
          fields: {
            title: {},
            content: {},
          },
        },
      },
    });

    const hits = result.hits.hits.map((hit: any) => ({
      ...hit._source,
      score: hit._score,
      highlights: hit.highlight,
    }));

    console.log(`✅ Found ${hits.length} results`);

    res.json({
      total: result.hits.total,
      results: hits,
      source: "elasticsearch",
    });
  } catch (error) {
    console.error("❌ Error searching:", error);
    res.status(500).json({
      error: "Search failed",
      details: (error as Error).message,
    });
  }
});

// 著者別投稿一覧（Redis Sorted Set活用）
app.get("/posts/by-author/:author", async (req, res) => {
  const { author } = req.params;

  try {
    console.log(`👤 Fetching posts by author: ${author}`);

    // Redisから投稿IDリストを取得（新しい順）
    const postIds = await redis.zrevrange(`author:${author}:posts`, 0, -1);

    if (postIds.length === 0) {
      // キャッシュミス → PostgreSQLにフォールバック
      console.log(`💾 Cache miss, querying database...`);
      const result = await pg.query<Post>(
        "SELECT * FROM posts WHERE author = $1 ORDER BY created_at DESC",
        [author],
      );
      return res.json({
        posts: result.rows,
        source: "database",
      });
    }

    // 各投稿をキャッシュから取得
    const posts = await Promise.all(
      postIds.map(async (id) => {
        const cached = await redis.get(`post:${id}`);
        return cached ? JSON.parse(cached) : null;
      }),
    );

    console.log(`✅ Found ${posts.length} posts by ${author}`);

    res.json({
      posts: posts.filter((p) => p !== null),
      source: "cache",
    });
  } catch (error) {
    console.error(`❌ Error fetching posts by author:`, error);
    res.status(500).json({
      error: "Failed to fetch posts",
      details: (error as Error).message,
    });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log("\n📋 Available endpoints:");
  console.log("  GET    /health");
  console.log("  POST   /posts");
  console.log("  GET    /posts/:id");
  console.log("  PUT    /posts/:id");
  console.log("  DELETE /posts/:id");
  console.log("  GET    /search?q=<query>");
  console.log("  GET    /posts/by-author/:author");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await pg.end();
  await redis.quit();
  process.exit(0);
});
