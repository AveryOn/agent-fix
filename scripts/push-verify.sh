#!/bin/sh

set -eu

echo "[VERIFY:STAGE:RUN]"
  echo "[VERIFY:STAGE:INSTALL-DEPS]" && npm install
  echo "[VERIFY:STAGE:TYPECHECK]" && npm run typecheck
  echo "[VERIFY:STAGE:FORMAT]" && npm run format
  echo "[VERIFY:STAGE:FORMAT:CHECK]" && npm run format:check
  echo "[VERIFY:STAGE:LINT]" && npm run lint
  echo "[VERIFY:STAGE:LINT:FIX]" && npm run lint:fix
  echo "[VERIFY:STAGE:FORMAT]" && npm run format
  echo "[VERIFY:STAGE:BUILD]" && npm run build
  echo "[VERIFY:STAGE:TESTS]" && npm run test
