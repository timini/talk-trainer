# The slide renderer: LibreOffice and poppler, with a small Node server (server.mjs).
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-impress poppler-utils zip nodejs \
     fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs .
EXPOSE 8080
CMD ["node", "server.mjs"]
