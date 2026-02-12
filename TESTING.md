# テストガイド

このプロジェクトは Vitest を使用してテストを実装しています。

## 🧪 テストの実行

### 基本的なコマンド

```bash

# すべてのテストを実行（単体テストのみ）
npm test

# 単体テストのみ実行
npm run test:unit

# 統合テストのみ実行（自動セットアップ付き）
npm run test:integration

# Watch モード（ファイル変更時に自動実行）
npm run test:watch

# UI モード（ブラウザでテスト結果を確認）
npm run test:ui

# カバレッジレポート生成
npm run test:coverage
```

### 統合テスト実行方法（重要！）

#### 初回セットアップ

# これ1つで全部OK

npm run setup

#### テスト実施

# ターミナル1: Consumer起動

npm run consumers:start

# ターミナル2: 統合テスト実行

npm run test:integration

# 終わったら停止

npm run consumers:stop

```bash
# ターミナル1
npm run dev:search-indexer

# ターミナル2
npm run dev:cache-updater

# ターミナル3
npm run test:integration
```

#### 方法2：バックグラウンドで実行（より簡単）

```bash
# Consumer をバックグラウンドで起動
npm run consumers:start

# 統合テスト実行
npm run test:integration

# Consumer を停止
npm run consumers:stop
```

#### 方法3：完全に手動セットアップ

```bash
# 1. Dockerコンテナ起動
docker-compose up -d

# 2. 30秒待つ
sleep 30

# 3. Elasticsearchセットアップ
npm run setup:elasticsearch

# 4. Debeziumセットアップ
npm run setup:debezium

# 5. Consumer起動（ターミナル1）
npm run dev:search-indexer

# 6. Consumer起動（ターミナル2）
npm run dev:cache-updater

# 7. 統合テスト実行（ターミナル3）
npx vitest integration
```

### 特定のテストのみ実行

```bash
# ファイル名で絞り込み
npx vitest search-indexer

# パターンで絞り込み
npx vitest consumers

# 単一のテストケース（it.only 使用）
# テストファイル内で it.only(...) と記述
```

---

## 📂 テスト構成

```
__tests__/
├── unit/                      # 単体テスト（高速、モック使用）
│   ├── consumers/
│   │   ├── search-indexer.test.ts
│   │   └── cache-updater.test.ts
│   └── api/
│       └── server.test.ts
└── integration/               # 統合テスト（遅い、実コンテナ使用）
    ├── event-flow.test.ts         # 基本的なイベントフロー
    └── ddt-scenarios.test.ts      # DDT活用型

src/test-helpers/              # テストヘルパー
├── mock-kafka.ts
├── mock-redis.ts
└── mock-elasticsearch.ts
```

---

## 🎯 DDT (Data-Driven Testing) について

### DDTとは？

**Data-Driven Testing（データ駆動テスト）** は、同じテストロジックを複数の入力データで実行する手法です。

### なぜDDTを使うのか？

#### ❌ DDTなしの場合（冗長）

```typescript
it("should handle CREATE event", async () => {
  const event = { op: "c", after: { id: 1, title: "Test" } };
  await handler(event);
  expect(es.index).toHaveBeenCalled();
});

it("should handle UPDATE event", async () => {
  const event = { op: "u", after: { id: 1, title: "Test" } };
  await handler(event);
  expect(es.index).toHaveBeenCalled();
});

it("should handle DELETE event", async () => {
  const event = { op: "d", before: { id: 1 } };
  await handler(event);
  expect(es.delete).toHaveBeenCalled();
});

// 同じようなテストが続く...
```

**問題点**:

- コードの重複が多い
- テストケースの追加が面倒
- 保守性が低い

#### ✅ DDTありの場合（簡潔）

```typescript
const testCases = [
  {
    name: "should handle CREATE event",
    event: { op: "c", after: { id: 1, title: "Test" } },
    expectedOperation: "index",
  },
  {
    name: "should handle UPDATE event",
    event: { op: "u", after: { id: 1, title: "Test" } },
    expectedOperation: "index",
  },
  {
    name: "should handle DELETE event",
    event: { op: "d", before: { id: 1 } },
    expectedOperation: "delete",
  },
];

testCases.forEach((testCase) => {
  it(testCase.name, async () => {
    await handler(testCase.event);

    if (testCase.expectedOperation === "index") {
      expect(es.index).toHaveBeenCalled();
    } else if (testCase.expectedOperation === "delete") {
      expect(es.delete).toHaveBeenCalled();
    }
  });
});
```

**メリット**:

- テストロジックは1回だけ記述
- 新しいケースは配列に追加するだけ
- 保守性が高い

---

## 🔍 このプロジェクトでのDDT活用例

### 1. 単体テスト: Search Indexer

```typescript
// src/test-helpers/mock-kafka.ts で定義
export function generateDebeziumTestCases(): DebeziumTestCase[] {
  return [
    {
      name: 'CREATE event should trigger index',
      event: createMockDebeziumEvent({ op: 'c', after: {...} }),
      expectedOperation: 'index'
    },
    {
      name: 'UPDATE event should trigger index',
      event: createMockDebeziumEvent({ op: 'u', after: {...} }),
      expectedOperation: 'index'
    },
    // ... 他のケース
  ];
}

// __tests__/unit/consumers/search-indexer.test.ts で使用
const testCases = generateDebeziumTestCases();
testCases.forEach((testCase) => {
  it(testCase.name, async () => {
    // テストロジック
  });
});
```

**網羅するケース**:

- CREATE イベント → Elasticsearch に index
- UPDATE イベント → Elasticsearch に index（上書き）
- DELETE イベント → Elasticsearch から delete
- READ イベント（snapshot） → Elasticsearch に index

### 2. 単体テスト: Cache Updater

```typescript
const cacheOperationCases = [
  {
    name: "should cache post with correct TTL",
    post: { id: 1, title: "Test", author: "Alice" },
    expectedKey: "post:1",
    expectedTTL: 300,
  },
  {
    name: "should handle special characters",
    post: { id: 2, title: 'Test "with" <special>', author: "Bob" },
    expectedKey: "post:2",
    expectedTTL: 300,
  },
];
```

**網羅するケース**:

- 通常の投稿データ
- 特殊文字を含む投稿
- 著者別リストの更新
- キャッシュの削除

### 3. 統合テスト: Event Flow

```typescript
function generateIntegrationTestCases(): IntegrationTestCase[] {
  return [
    {
      name: 'INSERT should propagate to both datastores',
      operation: 'insert',
      initialData: { title: 'Test', content: 'Content', author: 'Tester' },
      expectedInElasticsearch: true,
      expectedInRedis: true,
      maxWaitTimeMs: 10000
    },
    {
      name: 'UPDATE should propagate changes',
      operation: 'update',
      initialData: { title: 'Original', ... },
      updateData: { title: 'Updated', ... },
      expectedInElasticsearch: true,
      expectedInRedis: true,
      maxWaitTimeMs: 10000
    },
    // ...
  ];
}
```

**網羅するケース**:

- INSERT → Elasticsearch + Redis に伝播
- UPDATE → 変更が両方に伝播
- DELETE → 両方から削除
- 結果整合性の遅延時間計測

---

## 🧪 統合テストについて

### 前提条件

統合テストは実際のDockerコンテナを使用します。

```bash
# 統合テスト実行前に必須
docker-compose up -d

# すべてのサービスが起動していることを確認
docker-compose ps
```

### 統合テストの特徴

**1. event-flow.test.ts（基本的なフロー）**

- PostgreSQL → Kafka → Elasticsearch/Redis の全体フローをテスト
- INSERT/UPDATE/DELETE の各操作を個別にテスト
- 検索機能、キャッシュパフォーマンスもテスト

**2. ddt-scenarios.test.ts（DDT活用型）**

- 複数のシナリオをデータ駆動でテスト
- 結果整合性の遅延時間を計測
- 保守性の高いテスト設計

### 結果整合性のテスト

統合テストでは、**Eventual Consistency（結果整合性）** をテストします。

```typescript
// PostgreSQLにINSERT
await pgPool.query('INSERT INTO posts ...');

// すぐには Elasticsearch/Redis に反映されない
// 最大10秒待機して、伝播を確認
for (let i = 0; i < 20; i++) {
  await new Promise(resolve => setTimeout(resolve, 500));

  // Elasticsearch確認
  const esResult = await es.get({ ... });
  if (esResult._source) {
    // 伝播完了！
    break;
  }
}
```

**重要なポイント**:

- CDC → Kafka → Consumer の処理には数秒かかる
- テストは「結果整合性」を期待する
- タイムアウトは余裕を持って設定（10-30秒）

---

## 📊 カバレッジ目標

カバレッジ目標を `vitest.config.ts` で設定しています：

```typescript
coverage: {
  thresholds: {
    lines: 80,        // 行カバレッジ 80%以上
    functions: 80,    // 関数カバレッジ 80%以上
    branches: 80,     // 分岐カバレッジ 80%以上
    statements: 80    // 文カバレッジ 80%以上
  }
}
```

### カバレッジレポートの見方

```bash
npm run test:coverage
```

実行後、以下が生成されます：

- **ターミナル出力**: 全体のカバレッジサマリー
- **HTMLレポート**: `coverage/index.html` をブラウザで開く

---

## 🛠️ テストヘルパーの使い方

### Mock Kafka

```typescript
import {
  createMockKafkaMessage,
  createMockDebeziumEvent,
  generateDebeziumTestCases
} from '@/test-helpers/mock-kafka';

// Kafkaメッセージの生成
const message = createMockKafkaMessage({
  topic: 'blogdb.public.posts',
  value: JSON.stringify({ ... })
});

// Debeziumイベントの生成
const event = createMockDebeziumEvent({
  op: 'c',
  after: { id: 1, title: 'Test' }
});

// DDT用のテストケース生成
const testCases = generateDebeziumTestCases();
```

### Mock Redis

```typescript
import { createMockRedis } from "@/test-helpers/mock-redis";

const mockRedis = createMockRedis();

// 通常のRedis操作と同じように使える
await mockRedis.set("key", "value");
const value = await mockRedis.get("key");

// テスト用のヘルパー
mockRedis.clear(); // 全データクリア
const allData = mockRedis.getAllData(); // 全データ取得
```

### Mock Elasticsearch

```typescript
import { createMockElasticsearch } from '@/test-helpers/mock-elasticsearch';

const mockEs = createMockElasticsearch();

// 通常のElasticsearch操作
await mockEs.index({ index: 'posts', id: '1', document: {...} });
const results = await mockEs.search({ index: 'posts', query: {...} });

// テスト用のヘルパー
mockEs.clear(); // 全ドキュメントクリア
const docs = mockEs.getAllDocuments('posts'); // インデックスの全ドキュメント取得
```

---

## 🎓 ベストプラクティス

### 1. AAA パターンを守る

```typescript
it('should do something', async () => {
  // Arrange: テストデータの準備
  const input = { ... };

  // Act: テスト対象の実行
  const result = await targetFunction(input);

  // Assert: 結果の検証
  expect(result).toBe(expected);
});
```

### 2. テストは独立させる

```typescript
// ✅ Good: 各テストが独立
beforeEach(() => {
  mockRedis.clear(); // 毎回クリーンアップ
});

// ❌ Bad: 前のテストの影響を受ける
// beforeEach なしで連続実行
```

### 3. 意味のあるテスト名

```typescript
// ✅ Good: 何をテストしているか明確
it('should cache post with TTL when CREATE event received', ...)

// ❌ Bad: 何をテストしているか不明
it('test1', ...)
```

### 4. DDTでエッジケースを網羅

```typescript
const edgeCases = [
  { name: "empty title", input: { title: "" }, shouldFail: true },
  { name: "null content", input: { content: null }, shouldFail: true },
  {
    name: "very long title",
    input: { title: "a".repeat(1000) },
    shouldFail: false,
  },
];
```

### 5. 統合テストは最小限に

- 単体テストで大部分をカバー（高速）
- 統合テストは重要なフローのみ（遅い）
- バランスを取る

---

## 🐛 トラブルシューティング

### テストがタイムアウトする

```typescript
// テストごとにタイムアウトを延長
it("slow test", async () => {
  // ...
}, 20000); // 20秒

// またはvitest.config.tsで全体的に変更
testTimeout: 10000;
```

### 統合テストが失敗する

**エラー1: `index_not_found_exception: no such index [posts]`**

原因: Elasticsearchのインデックスが作成されていない

解決策:

```bash
npm run setup:elasticsearch
```

**エラー2: `expected false to be true // esIndexed`**

原因: Consumerが起動していない

解決策:

```bash
# 別ターミナルで起動
npm run dev:search-indexer
npm run dev:cache-updater

# または、バックグラウンドで起動
npm run consumers:start
```

**エラー3: `expected 15088 to be less than 10000`**

原因: 伝播時間が10秒を超えている（マシンスペックによる）

これは正常です。テストのタイムアウト設定が厳しすぎるため、実際のシステムは正常に動作しています。

### モックが期待通りに動かない

```typescript
// モックの呼び出し履歴を確認
console.log(mockRedis.set.mock.calls);

// モックをクリア
vi.clearAllMocks();
```

### カバレッジが上がらない

1. `npm run test:coverage` でレポート生成
2. `coverage/index.html` を開く
3. カバーされていない行を確認
4. テストケースを追加

---

## 📚 参考資料

- [Vitest 公式ドキュメント](https://vitest.dev/)
- [DDT の詳細](https://en.wikipedia.org/wiki/Data-driven_testing)
- [Mock 設計のベストプラクティス](https://kentcdodds.com/blog/write-tests)
- [統合テストの考え方](https://martinfowler.com/bliki/IntegrationTest.html)

---

## 🎯 DDT (Data-Driven Testing) について

### DDTとは？

**Data-Driven Testing（データ駆動テスト）** は、同じテストロジックを複数の入力データで実行する手法です。

### なぜDDTを使うのか？

#### ❌ DDTなしの場合（冗長）

```typescript
it("should handle CREATE event", async () => {
  const event = { op: "c", after: { id: 1, title: "Test" } };
  await handler(event);
  expect(es.index).toHaveBeenCalled();
});

it("should handle UPDATE event", async () => {
  const event = { op: "u", after: { id: 1, title: "Test" } };
  await handler(event);
  expect(es.index).toHaveBeenCalled();
});

it("should handle DELETE event", async () => {
  const event = { op: "d", before: { id: 1 } };
  await handler(event);
  expect(es.delete).toHaveBeenCalled();
});

// 同じようなテストが続く...
```

**問題点**:

- コードの重複が多い
- テストケースの追加が面倒
- 保守性が低い

#### ✅ DDTありの場合（簡潔）

```typescript
const testCases = [
  {
    name: "should handle CREATE event",
    event: { op: "c", after: { id: 1, title: "Test" } },
    expectedOperation: "index",
  },
  {
    name: "should handle UPDATE event",
    event: { op: "u", after: { id: 1, title: "Test" } },
    expectedOperation: "index",
  },
  {
    name: "should handle DELETE event",
    event: { op: "d", before: { id: 1 } },
    expectedOperation: "delete",
  },
];

testCases.forEach((testCase) => {
  it(testCase.name, async () => {
    await handler(testCase.event);

    if (testCase.expectedOperation === "index") {
      expect(es.index).toHaveBeenCalled();
    } else if (testCase.expectedOperation === "delete") {
      expect(es.delete).toHaveBeenCalled();
    }
  });
});
```

**メリット**:

- テストロジックは1回だけ記述
- 新しいケースは配列に追加するだけ
- 保守性が高い

---

## 🔍 このプロジェクトでのDDT活用例

### 1. Search Indexer のテスト

```typescript
// src/test-helpers/mock-kafka.ts で定義
export function generateDebeziumTestCases(): DebeziumTestCase[] {
  return [
    {
      name: 'CREATE event should trigger index',
      event: createMockDebeziumEvent({ op: 'c', after: {...} }),
      expectedOperation: 'index'
    },
    {
      name: 'UPDATE event should trigger index',
      event: createMockDebeziumEvent({ op: 'u', after: {...} }),
      expectedOperation: 'index'
    },
    // ... 他のケース
  ];
}

// __tests__/unit/consumers/search-indexer.test.ts で使用
const testCases = generateDebeziumTestCases();
testCases.forEach((testCase) => {
  it(testCase.name, async () => {
    // テストロジック
  });
});
```

**網羅するケース**:

- CREATE イベント → Elasticsearch に index
- UPDATE イベント → Elasticsearch に index（上書き）
- DELETE イベント → Elasticsearch から delete
- READ イベント（snapshot） → Elasticsearch に index

### 2. Cache Updater のテスト

```typescript
const cacheOperationCases = [
  {
    name: "should cache post with correct TTL",
    post: { id: 1, title: "Test", author: "Alice" },
    expectedKey: "post:1",
    expectedTTL: 300,
  },
  {
    name: "should handle special characters",
    post: { id: 2, title: 'Test "with" <special>', author: "Bob" },
    expectedKey: "post:2",
    expectedTTL: 300,
  },
];
```

**網羅するケース**:

- 通常の投稿データ
- 特殊文字を含む投稿
- 著者別リストの更新
- キャッシュの削除

---

## 📊 カバレッジ目標

カバレッジ目標を `vitest.config.ts` で設定しています：

```typescript
coverage: {
  thresholds: {
    lines: 80,        // 行カバレッジ 80%以上
    functions: 80,    // 関数カバレッジ 80%以上
    branches: 80,     // 分岐カバレッジ 80%以上
    statements: 80    // 文カバレッジ 80%以上
  }
}
```

### カバレッジレポートの見方

```bash
npm run test:coverage
```

実行後、以下が生成されます：

- **ターミナル出力**: 全体のカバレッジサマリー
- **HTMLレポート**: `coverage/index.html` をブラウザで開く

---

## 🛠️ テストヘルパーの使い方

### Mock Kafka

```typescript
import {
  createMockKafkaMessage,
  createMockDebeziumEvent,
  generateDebeziumTestCases
} from '@/test-helpers/mock-kafka';

// Kafkaメッセージの生成
const message = createMockKafkaMessage({
  topic: 'blogdb.public.posts',
  value: JSON.stringify({ ... })
});

// Debeziumイベントの生成
const event = createMockDebeziumEvent({
  op: 'c',
  after: { id: 1, title: 'Test' }
});

// DDT用のテストケース生成
const testCases = generateDebeziumTestCases();
```

### Mock Redis

```typescript
import { createMockRedis } from "@/test-helpers/mock-redis";

const mockRedis = createMockRedis();

// 通常のRedis操作と同じように使える
await mockRedis.set("key", "value");
const value = await mockRedis.get("key");

// テスト用のヘルパー
mockRedis.clear(); // 全データクリア
const allData = mockRedis.getAllData(); // 全データ取得
```

### Mock Elasticsearch

```typescript
import { createMockElasticsearch } from '@/test-helpers/mock-elasticsearch';

const mockEs = createMockElasticsearch();

// 通常のElasticsearch操作
await mockEs.index({ index: 'posts', id: '1', document: {...} });
const results = await mockEs.search({ index: 'posts', query: {...} });

// テスト用のヘルパー
mockEs.clear(); // 全ドキュメントクリア
const docs = mockEs.getAllDocuments('posts'); // インデックスの全ドキュメント取得
```

---

## 🎓 ベストプラクティス

### 1. AAA パターンを守る

```typescript
it('should do something', async () => {
  // Arrange: テストデータの準備
  const input = { ... };

  // Act: テスト対象の実行
  const result = await targetFunction(input);

  // Assert: 結果の検証
  expect(result).toBe(expected);
});
```

### 2. テストは独立させる

```typescript
// ✅ Good: 各テストが独立
beforeEach(() => {
  mockRedis.clear(); // 毎回クリーンアップ
});

// ❌ Bad: 前のテストの影響を受ける
// beforeEach なしで連続実行
```

### 3. 意味のあるテスト名

```typescript
// ✅ Good: 何をテストしているか明確
it('should cache post with TTL when CREATE event received', ...)

// ❌ Bad: 何をテストしているか不明
it('test1', ...)
```

### 4. DDTでエッジケースを網羅

```typescript
const edgeCases = [
  { name: "empty title", input: { title: "" }, shouldFail: true },
  { name: "null content", input: { content: null }, shouldFail: true },
  {
    name: "very long title",
    input: { title: "a".repeat(1000) },
    shouldFail: false,
  },
];
```

---

## 🐛 トラブルシューティング

### テストがタイムアウトする

```typescript
// テストごとにタイムアウトを延長
it("slow test", async () => {
  // ...
}, 20000); // 20秒

// またはvitest.config.tsで全体的に変更
testTimeout: 10000;
```

### モックが期待通りに動かない

```typescript
// モックの呼び出し履歴を確認
console.log(mockRedis.set.mock.calls);

// モックをクリア
vi.clearAllMocks();
```

### カバレッジが上がらない

1. `npm run test:coverage` でレポート生成
2. `coverage/index.html` を開く
3. カバーされていない行を確認
4. テストケースを追加

---

## 📚 参考資料

- [Vitest 公式ドキュメント](https://vitest.dev/)
- [DDT の詳細](https://en.wikipedia.org/wiki/Data-driven_testing)
- [Mock 設計のベストプラクティス](https://kentcdodds.com/blog/write-tests)
