#!/bin/sh

set -eu

echo "[VERIFY:TYPECHECK]"
npm run typecheck

echo "[VERIFY:FORMAT]"
npm run format:check

echo "[VERIFY:LINT]"
npm run lint

echo "[VERIFY:BUILD]"
npm run build

echo "[VERIFY:EVALUATIONS]"
npm run eval

echo "[VERIFY:TESTS]"
npm run test
