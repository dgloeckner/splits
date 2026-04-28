.PHONY: build test vet lint run fmt clean

GO ?= go
BIN := splits

build:
	$(GO) build -o $(BIN) ./cmd/splits

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

lint: vet
	@command -v staticcheck >/dev/null || $(GO) install honnef.co/go/tools/cmd/staticcheck@latest
	staticcheck ./...

fmt:
	$(GO) fmt ./...

run:
	$(GO) run ./cmd/splits

clean:
	rm -f $(BIN) $(BIN).exe coverage.out coverage.html
