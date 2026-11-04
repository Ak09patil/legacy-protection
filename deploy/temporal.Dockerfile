# Temporal's single-binary server, persisting to /data. Private network only.
FROM temporalio/temporal:latest
EXPOSE 7233
ENTRYPOINT ["temporal", "server", "start-dev", "--ip", "0.0.0.0", "--port", "7233", "--headless", "--db-filename", "/data/temporal.db"]
