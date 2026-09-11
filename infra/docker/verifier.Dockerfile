FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/core/go.mod services/core/go.sum ./
RUN go mod download
COPY services/core/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /astra-verifier ./cmd/astra-verifier

FROM alpine:3.23
RUN apk add --no-cache ca-certificates docker-cli
COPY --from=build /astra-verifier /usr/local/bin/astra-verifier
EXPOSE 8090
USER root
ENTRYPOINT ["astra-verifier"]
