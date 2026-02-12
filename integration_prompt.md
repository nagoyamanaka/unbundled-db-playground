# Flash Sale × Unbundled DB 統合プロンプト

このドキュメントは、AI（Claude/ChatGPT等）に Flash Sale プロジェクトと Unbundled Database Playground を統合させる際に使用するプロンプトです。

---

## 📋 プロジェクト概要

### Flash Sale プロジェクト

**目的**: フラッシュセール（限定在庫の早い者勝ち販売）システム

**現在の構成**:

- フロントエンド: Next.js (React)
- バックエンド: Next.js API Routes
- データストア: Redis (高速インメモリストア)
- ドメイン層: DDD + クリーンアーキテクチャ
- コアロジック: 在庫引き当て（Allocation）、10分間の一時確保

**技術スタック**:

- TypeScript
- Redis (Lua スクリプトによるアトミック操作)
- Vitest (単体テスト)

**ファイル構成**:

```
flash-sale/
├── src/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── Allocation.ts
│   │   │   └── SalesStock.ts
│   │   └── repositories/
│   │       └── ISalesStockRepository.ts
│   ├── infrastructure/
│   │   └── InMemorySalesStockRepository.ts
│   └── app/api/
│       └── stocks/
│           ├── route.ts
│           └── [id]/
│               ├── route.ts
│               └── allocate/route.ts
└── __tests__/
```

---

### Unbundled DB Playground プロジェクト

**目的**: DDIA 第12章の「解体されたデータベース」アーキテクチャ学習。データフローベース

**現在の構成**:

- PostgreSQL (書き込み用DB)
- Debezium (CDC: Change Data Capture)
- Kafka (イベントログ)
- Elasticsearch (全文検索)
- Redis (キャッシュ)
- 複数の Consumer (Kafka → Elasticsearch/Redis)

**技術スタック**:

- TypeScript
- Express (API Server)
- KafkaJS (Kafka クライアント)
- Docker Compose

**ファイル構成**:

```
unbundled-db-playground/
├── docker-compose.yml
├── src/
│   ├── types/index.ts
│   ├── api/server.ts
│   ├── consumers/
│   │   ├── search-indexer.ts
│   │   └── cache-updater.ts
│   ├── setup/
│   │   ├── setup-debezium.ts
│   │   └── setup-elasticsearch.ts
│   └── scripts/
│       ├── test-insert.ts
│       └── test-search.ts
└── init-db/01-init.sql
```

---

## 🎯 統合の目的

Flash Sale の在庫管理システムに、Event-Driven Architecture を追加し、以下を実現する：

1. **在庫変更のイベント化**
   - 在庫確保 → `StockAllocatedEvent`
   - 在庫開放 → `StockReleasedEvent`
   - 購入確定 → `PurchaseCompletedEvent`

2. **複数データストアへの自動反映**
   - 注文履歴 → PostgreSQL
   - 在庫検索 → Elasticsearch
   - リアルタイム集計 → 将来拡張

3. **結果整合性の実装**
   - Redis（在庫管理）は強整合性
   - PostgreSQL/Elasticsearch は結果整合性（Eventual Consistency）

---

## 🏗️ 統合アーキテクチャ

### 統合後の全体像

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP
       ↓
┌─────────────────────────────────────┐
│  Flash Sale API (Next.js)           │
│  - 在庫確保 (POST /api/stocks/:id/allocate) │
│  - 在庫状態取得 (GET /api/stocks/:id)       │
└──────┬──────────────────────────────┘
       │
       ↓
┌─────────────┐         ┌──────────────┐
│    Redis    │         │ Outbox Table │
│  (在庫管理)  │  ──→   │ (PostgreSQL) │
│             │         │              │
│  強整合性    │         │ イベント一時保存 │
└─────────────┘         └──────┬───────┘
                               │
                               ↓
                        ┌──────────────┐
                        │ Event Relay  │
                        │ (Outbox → Kafka) │
                        └──────┬───────┘
                               │
                               ↓
                        ┌──────────────┐
                        │    Kafka     │
                        │ (イベントログ) │
                        └──────┬───────┘
                               │
                ┌──────────────┼──────────────┐
                ↓              ↓              ↓
         ┌──────────┐   ┌──────────┐  ┌──────────┐
         │PostgreSQL│   │Elasticsearch│ │Analytics │
         │ 注文履歴  │   │  在庫検索  │  │ 将来拡張  │
         └──────────┘   └──────────┘  └──────────┘
```

---

## 📝 統合の実装ステップ

### Phase 5: ドメインイベントの設計

**タスク**: Flash Sale の SalesStock エンティティにドメインイベント発行機能を追加

**作成するファイル**:

- `src/domain/events/DomainEvent.ts` - 基底イベント型
- `src/domain/events/StockEvents.ts` - 在庫関連イベント

**イベント定義例**:

```typescript
export interface StockAllocatedEvent extends DomainEvent {
  eventType: "StockAllocated";
  userId: string;
  productId: string;
  quantity: number;
  expiresAt: Date;
}

export interface StockReleasedEvent extends DomainEvent {
  eventType: "StockReleased";
  userId: string;
  productId: string;
  quantity: number;
  reason: "expired" | "cancelled" | "purchased";
}

export interface PurchaseCompletedEvent extends DomainEvent {
  eventType: "PurchaseCompleted";
  userId: string;
  productId: string;
  quantity: number;
  amount: number;
}
```

**SalesStock エンティティの修正**:

- `allocate()` メソッド内で `StockAllocatedEvent` を記録
- `release()` メソッド内で `StockReleasedEvent` を記録
- `getDomainEvents()` メソッドを追加

---

### Phase 6: Outbox Pattern の実装

**タスク**: Redis への書き込みとイベント保存をアトミックに実行

**作成するファイル**:

- `src/infrastructure/RedisOutboxRepository.ts`
- `src/infrastructure/PostgresOutboxRepository.ts` (代替案)

**Outbox Pattern の選択肢**:

**Option A: Redis Outbox (推奨)**

- Redis の Multi/Exec トランザクションを使用
- 在庫状態とイベントを同時に保存
- シンプルで高速

**Option B: PostgreSQL Outbox (本格派)**

- PostgreSQL に Outbox テーブルを作成
- トランザクショナル整合性を保証
- より本番に近い実装

**実装例 (Redis Outbox)**:

```typescript
async saveEventsWithStock(
  stock: SalesStock,
  events: DomainEvent[]
): Promise<void> {
  const multi = this.redis.multi();

  // 1. 在庫状態を保存
  multi.set(`stock:${stock.id}`, JSON.stringify(stock));

  // 2. イベントをOutboxに追加
  events.forEach(event => {
    multi.zadd(
      'outbox:events',
      event.occurredAt.getTime(),
      JSON.stringify(event)
    );
  });

  // アトミックに実行
  await multi.exec();
}
```

---

### Phase 7: Kafka 統合

**タスク**: Docker Compose に Kafka を追加し、イベントリレーを実装

**docker-compose.yml への追加**:

- Zookeeper
- Kafka
- Kafka UI (デバッグ用)

**作成するファイル**:

- `src/infrastructure/EventRelay.ts` - Outbox → Kafka

**イベントリレーの実装**:

```typescript
export class EventRelay {
  async start() {
    setInterval(async () => {
      await this.relayEvents();
    }, 100); // 100ms ごとにポーリング
  }

  private async relayEvents() {
    const producer = this.kafka.producer();

    // Outbox から未送信イベントを取得
    const events = await this.redis.zrangebyscore(
      "outbox:events",
      0,
      Date.now(),
    );

    for (const eventJson of events) {
      const event = JSON.parse(eventJson);

      // Kafka に送信
      await producer.send({
        topic: `stock.${event.eventType}`,
        messages: [
          {
            key: event.aggregateId,
            value: JSON.stringify(event),
          },
        ],
      });

      // 送信済みとしてマーク
      await this.redis.zrem("outbox:events", eventJson);
    }
  }
}
```

---

### Phase 8: Consumer の実装

**タスク**: Kafka イベントを消費し、各データストアに反映

**作成するファイル**:

- `src/consumers/OrderHistoryConsumer.ts` - PostgreSQL に注文履歴保存
- `src/consumers/StockSearchIndexer.ts` - Elasticsearch に在庫情報索引
- `src/consumers/AnalyticsConsumer.ts` (将来拡張)

**OrderHistoryConsumer の実装例**:

```typescript
export class OrderHistoryConsumer {
  async start() {
    const consumer = this.kafka.consumer({
      groupId: "order-history",
    });

    await consumer.subscribe({
      topics: ["stock.StockAllocated", "stock.PurchaseCompleted"],
    });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        const event = JSON.parse(message.value!.toString());

        if (event.eventType === "PurchaseCompleted") {
          // PostgreSQL に注文履歴を保存
          await this.saveOrder(event);
        }
      },
    });
  }
}
```

---

### Phase 9: API の拡張

**タスク**: 注文履歴取得、在庫検索などの Read API を追加

**新しいエンドポイント**:

- `GET /api/orders/user/:userId` - ユーザーの注文履歴
- `GET /api/stocks/search?q=...` - 在庫検索
- `GET /api/analytics/sales` - 売上分析（将来）

---

## 🧪 テスト戦略

### 統合後のテストシナリオ

**1. 在庫確保のエンドツーエンド**

```
1. POST /api/stocks/:id/allocate (在庫確保)
2. Redis に即座に反映 (強整合性)
3. Kafka にイベント発行
4. PostgreSQL に注文履歴保存 (数秒後)
5. Elasticsearch に在庫状況反映 (数秒後)
6. GET /api/orders/user/:userId で確認
```

**2. 結果整合性の確認**

```
1. 在庫確保直後に注文履歴 API を呼ぶ
   → まだ反映されていない（正常）
2. 3秒待つ
3. 再度注文履歴 API を呼ぶ
   → 反映されている（結果整合性）
```

**3. 障害復旧**

```
1. Consumer を停止
2. 在庫確保を実行
3. Kafka にイベントは溜まる
4. Consumer を再起動
5. 溜まったイベントを処理
   → データロスなし
```

---

## 📦 必要な依存関係

**Flash Sale プロジェクトに追加**:

```json
{
  "dependencies": {
    "kafkajs": "^2.2.4",
    "pg": "^8.11.3",
    "@elastic/elasticsearch": "^8.11.0"
  }
}
```

**docker-compose.yml の追加**:

- Kafka
- Zookeeper
- PostgreSQL (注文履歴用)
- Elasticsearch (在庫検索用)

---

## 🎯 AI への指示（実際に使用するプロンプト）

### プロンプトテンプレート

```
# 統合タスク: Flash Sale × Unbundled DB

## 背景
- Flash Sale: 在庫管理システム（Redis + DDD）
- Unbundled DB: Event-Driven Architecture のサンプル

## 目的
Flash Sale に Event-Driven Architecture を統合し、以下を実現：
1. 在庫変更をイベント化
2. Kafka 経由で複数データストアに自動反映
3. PostgreSQL に注文履歴、Elasticsearch に在庫検索

## Phase X の実装

【ここに具体的なフェーズ（Phase 5-9）を指定】

例:
## Phase 5: ドメインイベントの設計

タスク:
1. src/domain/events/DomainEvent.ts を作成
2. src/domain/events/StockEvents.ts を作成
3. SalesStock エンティティに getDomainEvents() を追加

実装してください。既存の SalesStock.ts の設計を崩さないように。

## 制約
- 既存の Flash Sale のドメインロジックは変更しない
- Redis の強整合性は維持
- TypeScript の型安全性を保つ
- テストコードも追加

## 参考
- Unbundled DB の実装: /path/to/unbundled-db-playground
- Flash Sale の実装: /path/to/flash-sale
```

---

## 🔍 統合時の注意点

### 1. ドメイン層の純粋性を保つ

**❌ やってはいけない**:

```typescript
// SalesStock エンティティ内で Kafka に直接送信
class SalesStock {
  allocate() {
    // ...
    kafka.send({ topic: 'stock.allocated', ... }); // NG!
  }
}
```

**✅ 正しいアプローチ**:

```typescript
// ドメインイベントを記録するだけ
class SalesStock {
  allocate() {
    // ...
    this.domainEvents.push(new StockAllocatedEvent(...));
  }
}

// インフラ層で Kafka に送信
// Repository が保存時にイベントを取得し、Outbox に保存
```

### 2. トランザクション境界の明確化

**強整合性が必要な部分**:

- Redis への在庫書き込み
- Outbox へのイベント保存
- → これらは同一トランザクション（Redis Multi/Exec）

**結果整合性で良い部分**:

- PostgreSQL への注文履歴保存
- Elasticsearch への在庫索引
- → Kafka 経由の非同期処理

### 3. 冪等性の保証

**Consumer は同じイベントを複数回受信する可能性がある**:

- イベント ID を使った重複排除
- UPSERT 操作の活用
- 冪等な設計（同じ操作を何度実行しても結果が同じ）

---

## 📚 参考資料

- DDIA 第12章「The Future of Data Systems」
- [Outbox Pattern 解説](https://microservices.io/patterns/data/transactional-outbox.html)
- [Kafka Connect vs カスタム Consumer](https://kafka.apache.org/documentation/#connect)
- Flash Sale プロジェクトの ADR (Architecture Decision Records)

---

## ✅ 統合完了の確認チェックリスト

### Phase 5: ドメインイベント

- [ ] DomainEvent.ts 作成
- [ ] StockEvents.ts 作成
- [ ] SalesStock にイベント発行機能追加
- [ ] ユニットテスト追加

### Phase 6: Outbox Pattern

- [ ] RedisOutboxRepository 作成
- [ ] トランザクショナルな保存を実装
- [ ] ユニットテスト追加

### Phase 7: Kafka 統合

- [ ] docker-compose.yml に Kafka 追加
- [ ] EventRelay 実装
- [ ] Kafka UI で動作確認

### Phase 8: Consumer 実装

- [ ] OrderHistoryConsumer 作成
- [ ] StockSearchIndexer 作成
- [ ] PostgreSQL テーブル設計
- [ ] Elasticsearch マッピング設計

### Phase 9: API 拡張

- [ ] 注文履歴 API 追加
- [ ] 在庫検索 API 追加
- [ ] E2E テスト追加

### 統合テスト

- [ ] 在庫確保 → 注文履歴反映の E2E テスト
- [ ] 結果整合性の確認
- [ ] 障害復旧テスト（Consumer 停止 → 再起動）

---

## 🎉 統合後の学習成果

この統合により、以下を実践的に学べます：

1. **Event Sourcing の実践**
   - ドメインイベントの設計
   - イベントストリームの構築

2. **Outbox Pattern**
   - トランザクショナル整合性
   - At-least-once デリバリー保証

3. **CQRS の実装**
   - 書き込み: Redis（在庫管理）
   - 読み取り: PostgreSQL（注文履歴）、Elasticsearch（検索）

4. **Polyglot Persistence**
   - 目的に応じたデータストアの使い分け
   - 複数 DB の協調動作

5. **分散システムの整合性**
   - 強整合性 vs 結果整合性
   - トレードオフの理解

---

このプロンプトを AI に渡すことで、段階的に Flash Sale と Unbundled DB を統合できます。
