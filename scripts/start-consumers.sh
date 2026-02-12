#!/bin/bash

# Consumer起動スクリプト
# バックグラウンドでConsumerを起動します

echo "👂 Consumerをバックグラウンドで起動します..."
echo ""

# ログディレクトリ作成
mkdir -p logs

# Search Indexer起動
echo "🔍 Search Indexer を起動中..."
nohup npm run dev:search-indexer > logs/search-indexer.log 2>&1 &
SEARCH_PID=$!
echo "   PID: $SEARCH_PID"

# Cache Updater起動
echo "💾 Cache Updater を起動中..."
nohup npm run dev:cache-updater > logs/cache-updater.log 2>&1 &
CACHE_PID=$!
echo "   PID: $CACHE_PID"

# PIDをファイルに保存
echo "$SEARCH_PID" > logs/search-indexer.pid
echo "$CACHE_PID" > logs/cache-updater.pid

echo ""
echo "✅ Consumerが起動しました"
echo ""
echo "ログを確認:"
echo "  tail -f logs/search-indexer.log"
echo "  tail -f logs/cache-updater.log"
echo ""
echo "Consumerを停止:"
echo "  bash scripts/stop-consumers.sh"
echo ""