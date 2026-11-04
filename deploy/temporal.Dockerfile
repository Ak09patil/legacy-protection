# Temporal's single-binary server, persisting to /data. Private network only.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -sSL "https://temporal.download/cli/archive/latest?platform=linux&arch=amd64" | tar -xz -C /usr/local/bin temporal \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
EXPOSE 7233
ENTRYPOINT ["temporal", "server", "start-dev", "--ip", "0.0.0.0", "--port", "7233", "--headless", "--db-filename", "/data/temporal.db"]
