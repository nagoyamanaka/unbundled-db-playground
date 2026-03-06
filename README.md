# Unbundled Database Playground

DDIA（Designing Data-Intensive Applications）第12章で解説されている「解体されたデータベース（Unbundled Database）」アーキテクチャの実装例。

## 📖 概要

このプロジェクトは、以下のコンセプトを実践的に学ぶためのプレイグラウンドです：

- **Event-Driven Architecture** - イベント駆動アーキテクチャ
- **Change Data Capture (CDC)** - データベース変更の自動検知
- **Polyglot Persistence** - 目的に応じた複数のデータストア活用
- **CQRS** - 書き込みと読み取りの分離
- **結果整合性** - Eventual Consistency

## 🏗️ アーキテクチャ

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP
       ↓
┌─────────────┐
│  API Server │ (Express + TypeScript)
└──────┬──────┘
       │ Write
       ↓
┌─────────────┐      WAL        ┌──────────┐
│ PostgreSQL  │ ────────────→   │ Debezium │ (CDC)
└─────────────┘                 └────┬─────┘
                                     │
                                     ↓
                                ┌─────────┐
                                │  Kafka  │ (Event Log)
                                └────┬────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ↓                ↓                ↓
              ┌──────────┐    ┌──────────┐    ┌──────────┐
              │   Redis  │    │  Elastic │    │   ...    │
              │  (Cache) │    │  search  │    │ (Future) │
              └──────────┘    └──────────┘    └──────────┘
```

### データフロー

1. **書き込み**: API → PostgreSQL
2. **検知**: Debezium が PostgreSQL の WAL (Write-Ahead Log) を監視
3. **配信**: Debezium が Kafka に変更イベントを発行
4. **消費**: 複数の Consumer が Kafka からイベントを受信
   - Search Indexer → Elasticsearch に索引作成
   - Cache Updater → Redis にキャッシュ保存
5. **読み取り**: API が適切なデータストアから取得
   - キャッシュヒット → Redis
   - 検索クエリ → Elasticsearch
   - フォールバック → PostgreSQL

## 🛠️ 技術スタック

| コンポーネント   | 技術                 | 役割                   |
| ---------------- | -------------------- | ---------------------- |
| API Server       | Express + TypeScript | RESTful API            |
| Database (Write) | PostgreSQL 15        | 書き込み用データベース |
| CDC              | Debezium 2.4         | Change Data Capture    |
| Event Streaming  | Apache Kafka 7.5     | イベントログ           |
| Full-Text Search | Elasticsearch 8.11   | 全文検索エンジン       |
| Cache            | Redis 7              | キャッシュレイヤー     |
| Container        | Docker Compose       | オーケストレーション   |

**Zookeeperについて**:
Kafkaは内部的にZookeeperを使用して
ブローカーのメタデータ管理、トピック設定、
コンシューマグループの調整を行います。
直接操作することはありませんが、
Kafkaが動作するために必須のコンポーネントです。

## 🚀 セットアップ

### 前提条件

- Docker Desktop インストール済み
- Node.js 18+ インストール済み
- 空きメモリ 4GB以上推奨

### 1. リポジトリのクローン

```bash
git clone <your-repo-url>
cd unbundled-db-playground
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. Docker コンテナの起動

```bash
docker-compose up -d
```

すべてのコンテナが起動するまで1〜2分待ちます。

### 4. コンテナの状態確認

```bash
docker-compose ps
```

以下のサービスが `running` 状態になっていることを確認：

- `unbundled-postgres`
- `unbundled-kafka`
- `unbundled-zookeeper`
- `unbundled-debezium`
- `unbundled-elasticsearch`
- `unbundled-redis`
- `unbundled-kafka-ui`

### 5. Elasticsearch のセットアップ

```bash
npm run setup:elasticsearch
```

これにより `posts` インデックスが作成されます。

### 6. Debezium コネクタの登録

```bash
npm run setup:debezium
```

PostgreSQL → Kafka の CDC パイプラインが作成されます。

## 🎮 使い方

### ターミナルを3つ開く

#### ターミナル1: API Server

```bash
npm run dev:api
```

API が `http://localhost:3000` で起動します。

#### ターミナル2: Search Indexer Consumer

```bash
npm run dev:search-indexer
```

Kafka → Elasticsearch のストリーム処理が開始されます。

#### ターミナル3: Cache Updater Consumer

```bash
npm run dev:cache-updater
```

Kafka → Redis のストリーム処理が開始されます。

### テストデータの投入

別のターミナルで：

```bash
npm run test:insert
```

5件のサンプル投稿が作成されます。

### データフローの観察

#### 1. PostgreSQL に書き込み

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Post",
    "content": "This is a test",
    "author": "Taro"
  }'
```

#### 2. Kafka UI でイベント確認

ブラウザで `http://localhost:8080` を開き、`blogdb.public.posts` トピックを確認。

#### 3. 検索テスト（Elasticsearch）

```bash
curl "http://localhost:3000/search?q=Test"
```

数秒待つと、先ほど作成した投稿が検索結果に表示されます。

#### 4. キャッシュテスト（Redis）

```bash
# 1回目: DB から取得（遅い）
curl http://localhost:3000/posts/1

# 2回目: Cache から取得（速い）
curl http://localhost:3000/posts/1
```

レスポンスの `source` フィールドで、どこから取得したかを確認できます。

### 包括的な検索テスト

```bash
npm run test:search
```

## 📊 管理画面

| サービス      | URL                   | 用途                           |
| ------------- | --------------------- | ------------------------------ |
| API           | http://localhost:3000 | RESTful API                    |
| Kafka UI      | http://localhost:8080 | Kafka トピック・メッセージ確認 |
| Debezium API  | http://localhost:8083 | CDC ステータス確認             |
| Elasticsearch | http://localhost:9200 | 直接クエリ実行                 |

## 🧪 API エンドポイント

### ヘルスチェック

```bash
GET /health
```

### 投稿の作成

```bash
POST /posts
Content-Type: application/json

{
  "title": "タイトル",
  "content": "本文",
  "author": "著者名"
}
```

### 投稿の取得（ID指定）

```bash
GET /posts/:id
```

### 投稿の更新

```bash
PUT /posts/:id
Content-Type: application/json

{
  "title": "新しいタイトル",
  "content": "新しい本文"
}
```

### 投稿の削除

```bash
DELETE /posts/:id
```

### 全文検索

```bash
GET /search?q=<検索クエリ>
```

### 著者別一覧

```bash
GET /posts/by-author/:author
```

## 🔍 観察ポイント

### 1. 非同期性の体験

PostgreSQL に書き込んだ直後に検索しても、すぐにはヒットしません。
数秒後（Kafka → Consumer → Elasticsearch の処理が完了後）にヒットします。

### 2. キャッシュの効果

同じ投稿を2回取得すると、2回目は圧倒的に速くなります。
Consumer が自動でキャッシュを更新しているため、手動のキャッシュ無効化が不要です。

### 3. 複数データストアの協調

1つの書き込みが複数のデータストアに自動的に反映される様子を観察できます。

## 🎓 学習効果

このプロジェクトを通じて、以下を体験できます：

- ✅ Event Sourcing の基礎
- ✅ CDC (Change Data Capture) の仕組み
- ✅ Kafka を使ったイベントストリーミング
- ✅ Polyglot Persistence の実装
- ✅ 結果整合性 (Eventual Consistency) の理解
- ✅ CQRS パターンの実践

## 🔧 トラブルシューティング

### Debezium が動かない

```bash
# コネクタの状態確認
curl http://localhost:8083/connectors/postgres-connector/status

# コネクタを再登録
npm run setup:debezium
```

### Elasticsearch が起動しない

メモリ不足の可能性があります。Docker Desktop のメモリ割り当てを増やしてください。

### Kafka に接続できない

Kafka の起動完了を待ちます（初回は1〜2分かかります）。

```bash
docker-compose logs kafka
```

## 🚧 今後の拡張案

- [ ] PostgreSQL の読み取り専用レプリカ追加
- [ ] Kafka Streams による集計処理
- [ ] Grafana + Prometheus でメトリクス可視化
- [ ] 複数パーティションでのスケーリング
- [ ] Schema Registry 導入
- [ ] 障害復旧テスト（カオスエンジニアリング）

## 📚 参考資料

- [Designing Data-Intensive Applications (DDIA)](https://dataintensive.net/)
- [Debezium Documentation](https://debezium.io/documentation/)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Elasticsearch Guide](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)

## テスト

### Unit

```
npm run test:unit
```

### Integration

**docker compose down**でコンテナを止めること

```
npm run test:integration
```

## 📝 ライセンス

MIT

## 🤝 Flash Sale プロジェクトへの統合

このプロジェクトで学んだパターンは、Flash Sale システムに以下のように応用できます：

- Redis の在庫管理 → Kafka へイベント発行
- 注文履歴を PostgreSQL に永続化
- 在庫状況を Elasticsearch でリアルタイム検索
- ダッシュボード用の集計データ生成

詳細は Flash Sale プロジェクトの Phase 5 以降で実装予定。

---

## 📁 プロジェクト構造

```
unbundled-db-playground/
├── docker-compose.yml          # 全サービスの定義
├── package.json                # npm scripts
├── tsconfig.json               # TypeScript設定
├── README.md                   # このファイル
├── QUICKSTART.md               # 最速起動手順
├── ARCHITECTURE.md             # アーキテクチャ詳細
├── init-db/
│   └── 01-init.sql            # PostgreSQL初期化
└── src/
    ├── types/index.ts         # 型定義
    ├── api/server.ts          # Express API
    ├── consumers/
    │   ├── search-indexer.ts  # Kafka→Elasticsearch
    │   └── cache-updater.ts   # Kafka→Redis
    ├── setup/
    │   ├── setup-debezium.ts  # Debezium設定
    │   └── setup-elasticsearch.ts
    └── scripts/
        ├── test-insert.ts     # テストデータ投入
        └── test-search.ts     # 検索テスト
```

## 🎯 学習の次のステップ

0. **データフローベースになっているか確認**

1. **基礎理解**（このプロジェクト）
   - Event-Driven Architecture の基本
   - CDC の仕組み
   - Polyglot Persistence

2. **応用実装**（Flash Sale統合）
   - Outbox Pattern の実装
   - トランザクショナル整合性
   - イベントソーシング

3. **本番運用**（将来）
   - モニタリング・アラート
   - スケーリング戦略
   - 障害復旧手順

---

**楽しい学習を！** 🎉
