# Этап сборки
FROM golang:1.26 AS build

WORKDIR /app

COPY ./cmd ./cmd
#COPY ./internal ./internal
COPY ./vendor ./vendor
COPY ./www ./www
COPY ./go.mod .
COPY ./go.sum .

RUN CGO_ENABLED=0 GOOS=linux go build -mod vendor -a -installsuffix cgo -o server cmd/main.go

FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

ENV TZ=Europe/Moscow

WORKDIR /app

COPY --from=build /app/server .
COPY --from=build /app/www ./www

ENTRYPOINT ["./server"]
