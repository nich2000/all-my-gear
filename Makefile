mod:
	#clear
	go get -u ./...
	go mod tidy -compat=1.25
	go mod vendor
	go fmt ./...

build:
	#clear
	go fmt ./...
	go build -o ./bin/app ./cmd/main.go

docker_build:
	docker buildx build -t nichalterego/all-my-gear:latest --platform=linux/amd64 .

docker_push:
	docker push nichalterego/all-my-gear:latest

docker_pull:
	docker pull nichalterego/all-my-gear:latest
