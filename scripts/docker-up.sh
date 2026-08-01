#!/bin/sh

set -eu

ENVIRONMENT="${1:-}"

case "$ENVIRONMENT" in
  dev)
    ENV_FILE=".env.development"
    COMPOSE_FILE="docker-compose.development.yml"
    ;;
  prod)
    ENV_FILE=".env.production"
    COMPOSE_FILE="docker-compose.production.yml"
    ;;
  *)
    echo "Usage: $0 <dev|prod>" >&2
    exit 1
    ;;
esac

docker compose \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up --build
