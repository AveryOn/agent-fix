#!/usr/bin/env bash

set -euo pipefail

readonly workspace_root='/workspace'
readonly fixture_dependencies='/opt/fixture/node_modules'

if [[ "$(id -u)" == '0' ]]; then
  echo 'Docker sandbox must not run as root' >&2
  exit 70
fi

if [[ "${OPENAI_API_KEY:-}" != '' ]]; then
  echo 'OPENAI_API_KEY must not be available in the sandbox' >&2
  exit 71
fi

if [[ ! -d "${workspace_root}" ]]; then
  echo 'Workspace mount is missing' >&2
  exit 73
fi

if [[ ! -f "${workspace_root}/package.json" ]]; then
  echo 'Workspace package.json is missing' >&2
  exit 74
fi

if [[ ! -d "${fixture_dependencies}" ]]; then
  echo 'Fixture dependencies are missing from the image' >&2
  exit 75
fi

if [[ "$(node --version)" != v24.* ]]; then
  echo 'Docker sandbox requires Node.js 24' >&2
  exit 76
fi

command -v git >/dev/null
command -v rg >/dev/null
command -v npm >/dev/null

readonly operation="${1:-}"

case "${operation}" in
  test | typecheck | lint | build)
    ;;
  *)
    echo "Unsupported process operation: ${operation}" >&2
    exit 77
    ;;
esac

rm -rf "${workspace_root}/node_modules"
ln -s "${fixture_dependencies}" "${workspace_root}/node_modules"

exec npm run "${operation}"
