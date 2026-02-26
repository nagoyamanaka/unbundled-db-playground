#!/bin/bash

# 初回セットアップスクリプト
# プロジェクトを初めて実行する際に使用します

set -e

echo "🚀 Unbundled DB Playground - 初回セットアップ"
echo "=================================================="
echo ""

# カラー定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. 依存関係のインストール
echo "📦 Step 1: 依存関係のインストール..."
if [ ! -d "node_modules" ]; then
    echo "   npm install を実行します..."
    npm install
else
    echo -e "${GREEN}✅ node_modules は既に存在します${NC}"
fi

# 2. Dockerコンテナの起動
echo ""
echo "🐳 Step 2: Dockerコンテナの起動..."
echo "   前のコンテナをクリーンアップしています..."
docker compose down --volumes || true
echo "   Dockerシステムをクリーンアップしています..."
docker system prune -f --volumes
docker compose up -d

echo "⏳ コンテナの起動を待機中（30秒）..."
sleep 30

# 3. Elasticsearchのセットアップ
echo ""
echo "🔍 Step 3: Elasticsearchのセットアップ..."
npm run setup:elasticsearch

# 4. Debeziumのセットアップ
echo ""
echo "🔗 Step 4: Debeziumのセットアップ..."
npm run setup:debezium

# 5. 完了
echo ""
echo "=================================================="
echo -e "${GREEN}✅ 初回セットアップが完了しました！${NC}"
echo ""
echo "次のステップ："
echo ""
echo "1. ${YELLOW}ターミナル1${NC} で API Server を起動:"
echo "   npm run dev:api"
echo ""
echo "2. ${YELLOW}ターミナル2${NC} で Search Indexer を起動:"
echo "   npm run dev:search-indexer"
echo ""
echo "3. ${YELLOW}ターミナル3${NC} で Cache Updater を起動:"
echo "   npm run dev:cache-updater"
echo ""
echo "4. ${YELLOW}ターミナル4${NC} でテストデータを投入:"
echo "   npm run test:insert"
echo ""
echo "5. 統合テストを実行する場合:"
echo "   bash scripts/run-integration-tests.sh"
echo ""