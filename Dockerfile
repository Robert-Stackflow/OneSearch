FROM node:22-bookworm-slim AS web
WORKDIR /source/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26-bookworm AS backend
WORKDIR /source
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/onesearch ./cmd/onesearch && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/backup-extract ./cmd/backup-extract

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /out/ /app/
COPY --from=web /source/dist/web /app/web
ENV ONESEARCH_MODE=production ONESEARCH_ADDR=0.0.0.0:3013 \
    ONESEARCH_DATA_DIR=/app/data ONESEARCH_STATIC_DIR=/app/web
EXPOSE 3013
ENTRYPOINT ["/app/onesearch"]
