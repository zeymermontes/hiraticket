# WhatsApp worker (whatsmeow, Go) — static binary in a distroless image.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /worker .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /worker /worker
ENTRYPOINT ["/worker"]
