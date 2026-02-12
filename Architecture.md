# アーキテクチャ詳細

## データフロー図

```
                    ┌─────────────────────────────────────┐
                    │         User/Client                 │
                    └──────────────┬──────────────────────┘
                                   │ HTTP Request
                                   ↓
                    ┌─────────────────────────────────────┐
                    │      Express API Server             │
                    │      (TypeScript)                   │
                    │                                     │
                    │  POST /posts      GET /posts/:id    │
                    │  PUT /posts/:id   GET /search       │
                    │  DELETE /posts/:id                  │
                    └──────┬──────────────────────────────┘
                           │
                           │ Write
                           ↓
        ┌──────────────────────────────────────────┐
        │          PostgreSQL 15                   │
        │          (Source of Truth)               │
        │                                          │
        │  - posts table                           │
        │  - WAL (Write-Ahead Log) enabled         │
        │  - Logical replication slot              │
        └──────────────┬───────────────────────────┘
                       │
                       │ WAL Stream
                       ↓
        ┌──────────────────────────────────────────┐
        │          Debezium Connect                │
        │          (Change Data Capture)           │
        │                                          │
        │  - PostgreSQL Connector                  │
        │  - Monitors WAL                          │
        │  - Converts changes to events            │
        └──────────────┬───────────────────────────┘
                       │
                       │ Publish Events
                       ↓
        ┌──────────────────────────────────────────┐
        │          Apache Kafka                    │
        │          (Event Log / Message Broker)    │
        │                                          │
        │  Topic: blogdb.public.posts              │
        │  - Partitioned                           │
        │  - Replicated (in production)            │
        │  - Persisted                             │
        └────┬─────────────────────────────────┬───┘
             │                                 │
             │ Subscribe                       │ Subscribe
             ↓                                 ↓
┌────────────────────────┐      ┌────────────────────────┐
│  Search Indexer        │      │  Cache Updater         │
│  Consumer              │      │  Consumer              │
│  (TypeScript)          │      │  (TypeScript)          │
│                        │      │                        │
│  - Consumer Group:     │      │  - Consumer Group:     │
│    search-indexer      │      │    cache-updater       │
│  - Processes events    │      │  - Processes events    │
│  - Updates index       │      │  - Updates cache       │
└────────┬───────────────┘      └────────┬───────────────┘
         │                               │
         │ Index                         │ Set/Delete
         ↓                               ↓
┌────────────────────┐      ┌────────────────────────┐
│  Elasticsearch 8   │      │      Redis 7           │
│                    │      │                        │
│  Index: posts      │      │  Keys:                 │
│  - Full-text       │      │  - post:{id}           │
│    search          │      │  - author:{name}:posts │
│  - Highlighting    │      │                        │
│  - Fuzzy matching  │      │  TTL: 300s             │
└────────────────────┘      └────────────────────────┘
         ↑                               ↑
         │                               │
         │ Query                         │ Get
         │                               │
    ┌────┴───────────────────────────────┴────┐
    │         API Server (Read Path)          │
    │                                         │
    │  GET /search?q=...  → Elasticsearch    │
    │  GET /posts/:id     → Redis → Postgres │
    └─────────────────────────────────────────┘
```

## コンポーネント詳細

### 1. PostgreSQL (Write Store)

**役割**: システムの Single Source of Truth

- すべての書き込みはここに集約
- WAL (Write-Ahead Log) で変更を記録
- 論理レプリケーションスロット経由で Debezium に変更を通知

**設定**:

```sql
wal_level = logical
max_wal_senders = 10
max_replication_slots = 10
```

### 2. Debezium (CDC Engine)

**役割**: データベース変更の検知と配信

- PostgreSQL の WAL をリアルタイムで監視
- 変更を Kafka イベントに変換
- スナップショット機能で初期データも取得

**イベントフォーマット**:

```json
{
  "payload": {
    "op": "c", // c=create, u=update, d=delete, r=read
    "before": null,
    "after": {
      "id": 1,
      "title": "Example",
      "content": "...",
      "author": "Alice",
      "created_at": 1234567890,
      "updated_at": 1234567890
    },
    "source": {
      "version": "2.4.0.Final",
      "connector": "postgresql",
      "name": "blogdb",
      "ts_ms": 1234567890000,
      "db": "blog_db",
      "schema": "public",
      "table": "posts"
    }
  }
}
```

### 3. Apache Kafka (Event Log)

**役割**: イベントストリームの永続化と配信

- すべての変更イベントを時系列で保存
- 複数の Consumer が独立して消費可能
- 再処理（リプレイ）に対応

**トピック構成**:

- `blogdb.public.posts` - posts テーブルの変更イベント
- `debezium_configs` - Debezium の設定（内部）
- `debezium_offsets` - オフセット管理（内部）
- `debezium_statuses` - ステータス管理（内部）

### 4. Search Indexer Consumer

**役割**: Elasticsearch への索引作成

**処理フロー**:

1. Kafka からイベントを受信
2. イベントタイプ（create/update/delete）を判定
3. Elasticsearch の対応する操作を実行
4. コミット（次のイベントへ）

**冪等性**: 同じイベントを複数回処理しても結果は同じ

### 5. Cache Updater Consumer

**役割**: Redis キャッシュの自動更新

**処理フロー**:

1. Kafka からイベントを受信
2. Redis に post データを保存（TTL: 300s）
3. 著者別の投稿リスト（Sorted Set）も更新
4. コミット

**利点**: API が手動でキャッシュ無効化する必要がない

### 6. Elasticsearch (Search Store)

**役割**: 高速な全文検索

**機能**:

- 全文検索（title, content フィールド）
- ファジーマッチング（タイポ許容）
- ハイライト表示
- スコアリング（関連度順）

**インデックス構造**:

```json
{
  "mappings": {
    "properties": {
      "id": { "type": "integer" },
      "title": { "type": "text" },
      "content": { "type": "text" },
      "author": { "type": "keyword" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
```

### 7. Redis (Cache Store)

**役割**: 高速なデータアクセス

**データ構造**:

- String: `post:{id}` → JSON化した投稿データ
- Sorted Set: `author:{name}:posts` → 投稿IDリスト（タイムスタンプ順）

**TTL**: 300秒（5分）で自動削除

## データ整合性モデル

### Write Path（強整合性）

```
Client → API → PostgreSQL
                    ↓
               (Immediate)
                    ↓
                Response
```

PostgreSQL への書き込みは即座に反映され、強整合性を保証。

### Read Path（結果整合性）

```
PostgreSQL → Debezium → Kafka → Consumers → Datastores
   (Write)      ↓         ↓         ↓           ↓
              数ms      数ms    数百ms      数百ms
                                              (Total: ~1-2秒)
```

書き込み後、1〜2秒で他のデータストアに反映される（結果整合性）。

## スケーラビリティ

### 水平スケーリング

各コンポーネントは独立してスケール可能：

- **Kafka**: パーティション追加
- **Consumer**: インスタンス追加（Consumer Group で自動負荷分散）
- **Elasticsearch**: シャード追加
- **Redis**: クラスタ構成

### ボトルネック対策

- PostgreSQL の書き込み → Read Replica 追加
- Kafka のスループット → パーティション数増加
- Consumer の処理速度 → 並列度向上

## 障害対応

### Consumer ダウン時

- Kafka はイベントを保持（デフォルト7日間）
- Consumer 復旧後、未処理イベントから再開
- データロスなし

### Elasticsearch ダウン時

- 検索機能は停止
- PostgreSQL からのフォールバック可能
- 復旧後、Consumer が自動で再索引

### Redis ダウン時

- キャッシュミス → PostgreSQL から取得
- パフォーマンス低下のみ、機能は維持

## Future Enhancements

- [ ] Schema Registry で型安全性向上
- [ ] Kafka Streams で集計処理
- [ ] PostgreSQL Read Replica 追加
- [ ] Monitoring（Prometheus + Grafana）
- [ ] 分散トレーシング（Jaeger）
