# FileHop in one image: the browser app is built with Node, embedded into the Go
# binary, and the binary runs alone on a distroless base.
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY web web
COPY tools tools
RUN npm run build

FROM golang:1.27-alpine AS go
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /filehop ./cmd/filehop

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /filehop /filehop
ENV FILEHOP_ADDR=:8080 FILEHOP_DB=/data/filehop.db
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/filehop"]
