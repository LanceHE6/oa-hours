.PHONY: build frontend test run clean

# 构建时间（精准到分钟）
BUILD_TIME := $(shell date '+%Y-%m-%d %H:%M')

# 构建完整二进制（先构建前端，再编译 Go）
build: frontend
	go build -ldflags "-X 'main.buildTime=$(BUILD_TIME)'" -o oa-hours .

# 构建前端（生成 web/dist）
frontend:
	cd web && npm install --include=dev && npm run build

test:
	go test ./...

run: build
	./oa-hours

clean:
	rm -rf web/dist oa-hours
