/**
 * Elasticsearch のセットアップスクリプト
 * インデックスの作成とマッピング設定
 */

import { Client } from "@elastic/elasticsearch";

const client = new Client({ node: "http://localhost:9200" });

async function setupElasticsearch() {
  console.log("🔧 Setting up Elasticsearch...");

  const indexName = "posts";

  try {
    // インデックスが既に存在するか確認
    const exists = await client.indices.exists({ index: indexName });

    if (exists) {
      console.log(`🗑️  Deleting existing index: ${indexName}`);
      await client.indices.delete({ index: indexName });
    }

    // インデックス作成（マッピング設定付き）
    console.log(`📝 Creating index: ${indexName}`);
    await client.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              // 日本語対応のアナライザー（将来的に）
              default: {
                type: "standard",
              },
            },
          },
        },
        mappings: {
          properties: {
            id: {
              type: "integer",
            },
            title: {
              type: "text",
              fields: {
                keyword: {
                  type: "keyword",
                  ignore_above: 256,
                },
              },
            },
            content: {
              type: "text",
            },
            author: {
              type: "keyword",
            },
            created_at: {
              type: "date",
            },
            updated_at: {
              type: "date",
            },
          },
        },
      },
    });

    console.log("✅ Index created successfully!");

    // マッピング確認
    const mapping = await client.indices.getMapping({ index: indexName });
    console.log("\n📋 Index Mapping:");
    console.log(JSON.stringify(mapping, null, 2));

    // ヘルスチェック
    const health = await client.cluster.health();
    console.log("\n💚 Cluster Health:", health.status);
  } catch (error) {
    console.error("❌ Error setting up Elasticsearch:", error);
    process.exit(1);
  }
}

// メイン実行
setupElasticsearch();
