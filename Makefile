.PHONY: build frontend test run clean

# 构建完整二进制（先构建前端，再编译 Go）
build: frontend
	go build -o oa-hours .

# 构建前端（生成 web/dist）
frontend:
	cd web && npm install --include=dev && npm run build

test:
	go test ./...

run: build
	./oa-hours

clean:
	rm -rf web/dist oa-hours
