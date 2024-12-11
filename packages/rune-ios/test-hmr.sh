#!/bin/bash

# Test HMR connectivity and message flow
# Usage: ./test-hmr.sh [dev-server-url]

DEV_SERVER_URL="${1:-http://localhost:8081}"

echo "🧪 Testing HMR setup for: $DEV_SERVER_URL"
echo ""

# Test 1: Check if dev server is accessible
echo "1️⃣ Testing HTTP connectivity..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${DEV_SERVER_URL}/main.js")
if [ "$HTTP_STATUS" = "200" ]; then
    echo "   ✅ Dev server is accessible (HTTP $HTTP_STATUS)"
else
    echo "   ❌ Dev server is not accessible (HTTP $HTTP_STATUS)"
    exit 1
fi

# Test 2: Check if bundle is available
echo ""
echo "2️⃣ Testing bundle availability..."
BUNDLE_SIZE=$(curl -s "${DEV_SERVER_URL}/main.js" | wc -c | tr -d ' ')
if [ "$BUNDLE_SIZE" -gt 1000 ]; then
    echo "   ✅ Bundle is available (${BUNDLE_SIZE} bytes)"
else
    echo "   ❌ Bundle is too small or missing (${BUNDLE_SIZE} bytes)"
    exit 1
fi

# Test 3: Check WebSocket endpoint
echo ""
echo "3️⃣ Testing WebSocket endpoint..."
WS_URL=$(echo "$DEV_SERVER_URL" | sed 's/http/ws/')/__rspack_hmr
echo "   Checking: $WS_URL"

# Try to connect with wscat if available
if command -v wscat &> /dev/null; then
    echo "   Testing connection with wscat..."
    timeout 3 wscat -c "$WS_URL" --execute 'console.log("connected")' 2>&1 | grep -q "connected" && {
        echo "   ✅ WebSocket endpoint is accessible"
    } || {
        echo "   ⚠️  Could not verify WebSocket (this is OK, server might not echo)"
    }
else
    echo "   ℹ️  wscat not installed, skipping WebSocket test"
    echo "   To install: npm install -g wscat"
fi

# Test 4: Check if HMR manifest endpoint exists
echo ""
echo "4️⃣ Testing HMR manifest endpoint..."
MANIFEST_URL="${DEV_SERVER_URL}/bundle/app.hot-update.json"
MANIFEST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$MANIFEST_URL")
if [ "$MANIFEST_STATUS" = "200" ]; then
    echo "   ✅ HMR manifest endpoint is ready"
    echo "   Manifest content:"
    curl -s "$MANIFEST_URL" | jq . 2>/dev/null || curl -s "$MANIFEST_URL"
elif [ "$MANIFEST_STATUS" = "404" ]; then
    echo "   ℹ️  HMR manifest not found (expected until first change)"
else
    echo "   ⚠️  Unexpected manifest status: HTTP $MANIFEST_STATUS"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Basic HMR setup looks good!"
echo ""
echo "Next steps:"
echo "1. Set RUNE_DEV_SERVER_URL in your Xcode scheme:"
echo "   RUNE_DEV_SERVER_URL = $DEV_SERVER_URL"
echo ""
echo "2. Build and run your iOS app"
echo ""
echo "3. Make a change to a source file and watch for:"
echo "   [RuneDevClient] ✅ WebSocket connected"
echo "   [RuneDevClient] Received message type: update"
echo "   [RuneRuntime] 🎉 Hot update applied successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
