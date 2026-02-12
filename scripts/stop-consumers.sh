#!/bin/bash

# Consumer停止スクリプト

echo "🛑 Consumerを停止します..."
echo ""

if [ -f logs/search-indexer.pid ]; then
    SEARCH_PID=$(cat logs/search-indexer.pid)
    if kill -0 $SEARCH_PID 2>/dev/null; then
        kill $SEARCH_PID
        echo "✅ Search Indexer (PID: $SEARCH_PID) を停止しました"
    else
        echo "⚠️  Search Indexer (PID: $SEARCH_PID) は既に停止しています"
    fi
    rm logs/search-indexer.pid
else
    echo "⚠️  Search Indexer のPIDファイルが見つかりません"
fi

if [ -f logs/cache-updater.pid ]; then
    CACHE_PID=$(cat logs/cache-updater.pid)
    if kill -0 $CACHE_PID 2>/dev/null; then
        kill $CACHE_PID
        echo "✅ Cache Updater (PID: $CACHE_PID) を停止しました"
    else
        echo "⚠️  Cache Updater (PID: $CACHE_PID) は既に停止しています"
    fi
    rm logs/cache-updater.pid
else
    echo "⚠️  Cache Updater のPIDファイルが見つかりません"
fi

echo ""
echo "✅ Consumerの停止処理が完了しました"