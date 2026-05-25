#!/bin/sh
set -eu

PORT="${PORT:-3101}"
BASE_DIR="${BASE_DIR:-/private/tmp/durian-paradise-test}"

mkdir -p "$BASE_DIR"
printf '[]\n' > "$BASE_DIR/orders.json"
printf '[]\n' > "$BASE_DIR/referrals.json"
printf '[]\n' > "$BASE_DIR/reviews.json"
printf '{\n  "events": []\n}\n' > "$BASE_DIR/analytics.json"

echo "Starting Durian Paradise test server on http://127.0.0.1:$PORT"
echo "Test data directory: $BASE_DIR"

PORT="$PORT" \
SITE_URL="http://127.0.0.1:$PORT" \
ENABLE_TEST_HELPERS=1 \
ORDERS_FILE_PATH="$BASE_DIR/orders.json" \
REFERRALS_FILE_PATH="$BASE_DIR/referrals.json" \
REVIEWS_FILE_PATH="$BASE_DIR/reviews.json" \
ANALYTICS_FILE_PATH="$BASE_DIR/analytics.json" \
node server.js
