#!/bin/bash

# 統合テスト実行スクリプト
# このスクリプトは統合テストに必要な全ての前提条件を確認・セットアップします

set -e  # エラーが発生したら即座に終了

echo "🚀 Unbundled DB Playground - 統合テストセットアップ"
echo "=================================================="
echo ""

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Dockerコンテナのセットアップ
echo "📦 Step 1: Dockerコンテナのセットアップ..."
echo "   前のコンテナをクリーンアップしています..."
docker compose down --volumes || true
echo "   Dockerシステムをクリーンアップしています..."
docker system prune -f --volumes
echo -e "${YELLOW}⚠️  コンテナを起動します...${NC}"
docker compose up -d
echo "⏳ コンテナの起動を待機中（30秒）..."
sleep 30
echo -e "${GREEN}✅ Dockerコンテナが起動しました${NC}"

# 2. Elasticsearchの確認
echo ""
echo "🔍 Step 2: Elasticsearchインデックスの確認..."
if ! curl -s http://localhost:9200/posts/_mapping > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Elasticsearchインデックスが存在しません。作成します...${NC}"
    npm run setup:elasticsearch
else
    echo -e "${GREEN}✅ Elasticsearchインデックスは存在します${NC}"
fi

# 3. Debeziumコネクタの確認
echo ""
echo "🔗 Step 3: Debeziumコネクタの確認..."
if ! curl -s http://localhost:8083/connectors/postgres-connector/status | grep -q "RUNNING"; then
    echo -e "${YELLOW}⚠️  Debeziumコネクタが起動していません。セットアップします...${NC}"
    npm run setup:debezium
    sleep 5
else
    echo -e "${GREEN}✅ Debeziumコネクタは起動しています${NC}"
fi

# 4. Consumerの確認（プロセスチェック）
echo ""
echo "👂 Step 4: Consumerの確認..."
SEARCH_INDEXER_RUNNING=false
CACHE_UPDATER_RUNNING=false

if pgrep -f "search-indexer.ts" > /dev/null; then
    SEARCH_INDEXER_RUNNING=true
    echo -e "${GREEN}✅ Search Indexer Consumer は起動しています${NC}"
else
    echo -e "${RED}❌ Search Indexer Consumer が起動していません${NC}"
fi

if pgrep -f "cache-updater.ts" > /dev/null; then
    CACHE_UPDATER_RUNNING=true
    echo -e "${GREEN}✅ Cache Updater Consumer は起動しています${NC}"
else
    echo -e "${RED}❌ Cache Updater Consumer が起動していません${NC}"
fi

# 5. 統合テスト実行の判定
echo ""
echo "=================================================="
if [ "$SEARCH_INDEXER_RUNNING" = true ] && [ "$CACHE_UPDATER_RUNNING" = true ]; then
    echo -e "${GREEN}✅ すべての前提条件が満たされています！${NC}"
    echo ""
    echo "🧪 統合テストを実行します..."
    echo ""
    npx vitest integration
else
    echo -e "${RED}❌ Consumerが起動していないため、統合テストは失敗します${NC}"
    echo ""
    echo "以下のコマンドを別ターミナルで実行してください："
    echo ""
    echo "  ${YELLOW}ターミナル1:${NC} npm run dev:search-indexer"
    echo "  ${YELLOW}ターミナル2:${NC} npm run dev:cache-updater"
    echo ""
    echo "その後、このスクリプトを再実行してください："
    echo "  ${YELLOW}bash scripts/run-integration-tests.sh${NC}"
    echo ""
    exit 1
fi