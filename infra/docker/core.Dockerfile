FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/core/go.mod services/core/go.sum ./
RUN go mod download
COPY services/core/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /astra ./cmd/astra

FROM alpine:3.23
RUN apk add --no-cache ca-certificates git && addgroup -S astra && adduser -S astra -G astra
COPY --from=build /astra /usr/local/bin/astra
USER astra
EXPOSE 8080
ENTRYPOINT ["astra"]
