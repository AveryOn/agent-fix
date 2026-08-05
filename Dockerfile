FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV CI=true
ENV FORCE_COLOR=0
ENV npm_config_color=false

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    git \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/agent-fix

COPY package.json package-lock.json ./

RUN npm ci --ignore-scripts

WORKDIR /opt/fixture

COPY fixtures/billing-duplicate-payment/package.json \
  fixtures/billing-duplicate-payment/package-lock.json \
  ./

RUN npm ci --ignore-scripts

COPY scripts/docker-sandbox-entrypoint.sh \
  /usr/local/bin/docker-sandbox-entrypoint

RUN chmod 0555 /usr/local/bin/docker-sandbox-entrypoint \
  && groupadd --gid 10001 agentfix \
  && useradd \
    --uid 10001 \
    --gid 10001 \
    --no-create-home \
    --shell /usr/sbin/nologin \
    agentfix

WORKDIR /workspace

USER agentfix:agentfix

ENTRYPOINT ["docker-sandbox-entrypoint"]
