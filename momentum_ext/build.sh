#!/usr/bin/env bash
set -e

# Momentum Firefox Extension Packaging Script
echo "=========================================="
echo " Packaging Momentum Firefox Extension"
echo "=========================================="

DIST_NAME="momentum-extension"
rm -f "${DIST_NAME}.zip" "${DIST_NAME}.xpi"

echo "Compressing extension files..."
zip -r "${DIST_NAME}.zip" \
  manifest.json \
  newtab.html \
  background.js \
  css/ \
  js/ \
  assets/ \
  icons/ \
  -x "*.DS_Store*" -x "__MACOSX*" -x "*.git*"

# Also generate .xpi format (identical archive format for Firefox)
cp "${DIST_NAME}.zip" "${DIST_NAME}.xpi"

FILESIZE_ZIP=$(ls -lh "${DIST_NAME}.zip" | awk '{print $5}')
FILESIZE_XPI=$(ls -lh "${DIST_NAME}.xpi" | awk '{print $5}')

echo ""
echo "✅ Build completed successfully!"
echo "📦 Output Zip: ${DIST_NAME}.zip (${FILESIZE_ZIP})"
echo "📦 Output XPI: ${DIST_NAME}.xpi (${FILESIZE_XPI})"
echo "=========================================="
