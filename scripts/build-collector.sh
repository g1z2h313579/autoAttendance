#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
./node_modules/.bin/esbuild src/collector/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/collector.mjs
/usr/bin/swiftc -O src/collector/power-listener.swift -o dist/power-listener
