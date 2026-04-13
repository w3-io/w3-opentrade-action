#!/bin/bash
set -o errexit
set -o nounset
set -o pipefail

# End-to-end test: OpenTrade action via standalone bridge server.
#
# Tests read operations against live Avalanche mainnet vaults.
# No KYC/whitelisting needed for reads.
#
# Requires:
#   - w3 CLI built (with bridge serve command)
#   - Node.js 24+
#   - Internet access (Avalanche RPC)
#
# Usage:
#   W3_CLI=/path/to/w3 ./test/workflows/opentrade-bridge-e2e.sh

W3_CLI="${W3_CLI:-../../protocol/target/debug/w3}"
BRIDGE_PORT="${BRIDGE_PORT:-$(( ${W3_HTTP_PORT:-8233} - 1 ))}"
AVAX_RPC="${AVAX_RPC:-https://api.avax.network/ext/bc/C/rpc}"

# XMMF vault on Avalanche (USD Money Market Fund)
VAULT="0x09Ca60Ca323a6313aE144778c3EbDfCCFBB5e5D2"

echo "=== OpenTrade E2E Test (Avalanche mainnet reads) ==="
echo "  Bridge CLI: $W3_CLI"
echo "  Port: $BRIDGE_PORT"
echo "  Vault: $VAULT (XMMF)"
echo ""

echo "[1/5] Starting bridge server..."
W3_CHAIN_RPC_AVALANCHE="$AVAX_RPC" \
  "$W3_CLI" bridge serve --port "$BRIDGE_PORT" &
BRIDGE_PID=$!

sleep 2
if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo "FAIL: Bridge server died on startup"
  exit 1
fi

if curl -sf "http://localhost:$BRIDGE_PORT/health" > /dev/null; then
  echo "  Bridge is healthy"
else
  echo "FAIL: Bridge health check failed"
  kill "$BRIDGE_PID" 2>/dev/null || true
  exit 1
fi

cleanup() {
  echo ""
  echo "Stopping bridge server (PID $BRIDGE_PID)..."
  kill "$BRIDGE_PID" 2>/dev/null || true
  wait "$BRIDGE_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Test 1: get-exchange-rate
echo ""
echo "[2/5] Testing get-exchange-rate..."
RESULT=$(W3_BRIDGE_URL="http://localhost:$BRIDGE_PORT" \
  INPUT_COMMAND=get-exchange-rate \
  INPUT_NETWORK=avalanche \
  INPUT_VAULT="$VAULT" \
  node dist/index.js 2>&1 || true)

if echo "$RESULT" | grep -q '"ok":true'; then
  echo "  PASS: Got exchange rate"
else
  echo "  FAIL: Expected exchange rate"
  echo "  Output: $RESULT"
  exit 1
fi

# Test 2: get-vault-info
echo ""
echo "[3/5] Testing get-vault-info..."
RESULT=$(W3_BRIDGE_URL="http://localhost:$BRIDGE_PORT" \
  INPUT_COMMAND=get-vault-info \
  INPUT_NETWORK=avalanche \
  INPUT_VAULT="$VAULT" \
  node dist/index.js 2>&1 || true)

if echo "$RESULT" | grep -q "XMMF\|poolType"; then
  echo "  PASS: Got vault info"
else
  echo "  FAIL: Expected vault info with XMMF"
  echo "  Output: $RESULT"
  exit 1
fi

# Test 3: get-pool-overview
echo ""
echo "[4/5] Testing get-pool-overview..."
RESULT=$(W3_BRIDGE_URL="http://localhost:$BRIDGE_PORT" \
  INPUT_COMMAND=get-pool-overview \
  INPUT_NETWORK=avalanche \
  INPUT_VAULT="$VAULT" \
  node dist/index.js 2>&1 || true)

if echo "$RESULT" | grep -q "totalAssets"; then
  echo "  PASS: Got pool overview"
else
  echo "  FAIL: Expected pool overview"
  echo "  Output: $RESULT"
  exit 1
fi

# Test 4: is-permitted (check a random address — should be false)
echo ""
echo "[5/5] Testing is-permitted..."
RESULT=$(W3_BRIDGE_URL="http://localhost:$BRIDGE_PORT" \
  INPUT_COMMAND=is-permitted \
  INPUT_NETWORK=avalanche \
  INPUT_VAULT="$VAULT" \
  INPUT_USER="0x0000000000000000000000000000000000000001" \
  node dist/index.js 2>&1 || true)

if echo "$RESULT" | grep -q '"ok":true'; then
  echo "  PASS: Got permission status"
else
  echo "  FAIL: Expected permission check result"
  echo "  Output: $RESULT"
  exit 1
fi

echo ""
echo "=== All E2E tests passed ==="
