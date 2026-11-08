.PHONY: help up down logs build rebuild buildx dev install test lint typecheck check deploy-cameras setup-cameras deploy-rpi5

IMAGE ?= modellbahn-kamera-manager
REGISTRY ?= localhost
VERSION ?= latest

help:
	@echo "Modellbahn Kamera Manager"
	@echo "  make up              Container bauen & starten (http://localhost:8000)"
	@echo "  make down            Container stoppen"
	@echo "  make logs            Container-Logs folgen"
	@echo "  make rebuild         Neu bauen ohne Cache und starten"
	@echo "  make buildx          Multi-Arch-Image (amd64+arm64) bauen"
	@echo "  make install         npm-Abhängigkeiten installieren (Entwicklung)"
	@echo "  make dev             Backend + Frontend mit Hot-Reload"
	@echo "  make check           Lint, Typecheck und Tests"
	@echo "  make deploy-cameras  Kamera-Skripte auf alle Pis kopieren"
	@echo "  make setup-cameras   ... und Pakete auf den Pis installieren"
	@echo "  make deploy-rpi5     Manager auf den Raspberry Pi 5 deployen"

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build

rebuild:
	docker compose build --no-cache && docker compose up -d

buildx:
	docker buildx build --platform linux/amd64,linux/arm64 \
		-t $(REGISTRY)/$(IMAGE):$(VERSION) -f docker/Dockerfile .

install:
	npm ci && npm --prefix frontend ci

dev:
	npm run dev

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

check: lint typecheck test

deploy-cameras:
	scripts/deploy-cameras.sh

setup-cameras:
	scripts/deploy-cameras.sh --setup

deploy-rpi5:
	scripts/deploy-rpi5.sh
