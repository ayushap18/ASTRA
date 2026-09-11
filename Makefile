.PHONY: setup test lint build core intelligence web smoke smoke-postgres schemas

web:
	cd apps/web && npm run dev

setup:
	cd services/core && go mod download
	cd services/intelligence && uv sync --locked
	cd apps/web && npm install

build:
	mkdir -p bin
	cd services/core && go build -trimpath -o ../../bin/astra ./cmd/astra
	cd services/core && go build -trimpath -o ../../bin/astra-verifier ./cmd/astra-verifier
	cd apps/web && npm run build

test:
	cd services/core && go test -race ./...
	cd services/intelligence && .venv/bin/python -m pytest -q
	cd apps/web && npm test

lint:
	cd services/core && go vet ./...
	cd services/intelligence && .venv/bin/ruff check app tests ../../scripts
	cd apps/web && npm run lint
	cd apps/web && npm run typecheck

core:
	cd services/core && go run ./cmd/astra

intelligence:
	cd services/intelligence && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

smoke: build
	python3 scripts/smoke.py

smoke-postgres: build
	python3 scripts/smoke.py --postgres

schemas:
	services/intelligence/.venv/bin/python scripts/export_schemas.py
