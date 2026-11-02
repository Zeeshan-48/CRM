# Euron Open CRM: developer entry points. `make` lists every target.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE_DIR := deploy/compose
FLOCI       := docker compose --env-file $(COMPOSE_DIR)/.env -f $(COMPOSE_DIR)/compose.yaml -f $(COMPOSE_DIR)/compose.floci.yaml
AWS_LOCAL   := docker compose --env-file $(COMPOSE_DIR)/.env --env-file $(COMPOSE_DIR)/.env.aws -f $(COMPOSE_DIR)/compose.yaml -f $(COMPOSE_DIR)/compose.aws.yaml
TF_IMAGE    := hashicorp/terraform:1.16.6
TFLINT      := docker run --rm -v $(CURDIR)/infra/terraform:/data -v open-crm-tflint:/plugins -e TFLINT_PLUGIN_DIR=/plugins -w /data ghcr.io/terraform-linters/tflint:v0.64.0
TF_ENVS     := local-floci aws-dev aws-prod
# Use a local terraform when installed, otherwise the pinned container.
TF          := $(shell command -v terraform >/dev/null 2>&1 && echo terraform || echo docker run --rm -v $(CURDIR)/infra/terraform:/infra -w /infra $(TF_IMAGE))
TF_ROOT     := $(shell command -v terraform >/dev/null 2>&1 && echo infra/terraform || echo /infra)
ENV         ?= aws-dev
TAG         ?= $(shell git rev-parse --short=12 HEAD 2>/dev/null || echo dev)
# Integration tests: a throwaway database next to the compose one (or whatever answers
# on CRM_PG_PORT), recreated, migrated and seeded on every run.
PG_PORT     := $${CRM_PG_PORT:-5532}
TEST_DB     ?= crm_test
TEST_PG     := PG_DATABASE_HOST=127.0.0.1 PG_DATABASE_PORT=$(PG_PORT) PG_DATABASE_USER=crm PG_DATABASE_PASSWORD=crm PG_DATABASE=$(TEST_DB)

.PHONY: help env up up-aws down logs ps demo lint typecheck test test-integration e2e build \
        sanitize tf-fmt tf-validate tf-lint tf-security aws-plan aws-deploy aws-migrate aws-operator clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\n"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ─── Local ───────────────────────────────────────────────────────────────────

env: ## Generate deploy/compose/.env with random local-only secrets
	@scripts/gen-local-env.sh

up: env ## Start everything on emulated AWS (Floci), provisioned by the same Terraform as production
	$(FLOCI) up -d --build --wait
	@echo ""
	@echo "  app      http://localhost:$${CRM_WEB_PORT:-3570}"
	@echo "  console  http://localhost:$${CRM_CONSOLE_PORT:-3580}  (operator console)"
	@echo "  api      http://localhost:$${CRM_API_PORT:-5066}/api/health"
	@echo "  mail     http://localhost:$${CRM_MAILPIT_PORT:-8086}  (everything SES sends)"
	@echo "  aws      http://localhost:$${CRM_FLOCI_PORT:-4637}  (Floci: S3, SES, SQS, SNS, KMS)"
	@echo ""
	@echo "  Every provider (WhatsApp, Twilio, Exotel, Razorpay, Stripe, billing) runs simulated"
	@echo "  and AI uses the offline engine. Next: make demo   (two demo tenants and an operator)"

up-aws: env ## Start the stack against real AWS resources (needs deploy/compose/.env.aws)
	@test -f $(COMPOSE_DIR)/.env.aws || { echo "copy $(COMPOSE_DIR)/.env.aws.example to .env.aws first"; exit 1; }
	$(AWS_LOCAL) up -d --build --wait

down: ## Stop the stack and delete its volumes
	-$(FLOCI) down -v --remove-orphans
	-test -f $(COMPOSE_DIR)/.env.aws && $(AWS_LOCAL) down -v --remove-orphans

logs: ## Tail logs (SERVICE=api|web|console|migrate|floci|terraform|...)
	$(FLOCI) logs -f --tail 100 $(SERVICE)

ps: ## Show stack status
	$(FLOCI) ps -a

demo: ## Seed the demo: plans, an operator and two demo tenants with leads, deals and activity (FORCE=1 wipes first)
	@pw=$$(grep '^CRM_DEMO_PASSWORD=' $(COMPOSE_DIR)/.env | cut -d= -f2-); \
	$(FLOCI) exec -T -e DEMO_PASSWORD="$$pw" api node dist-scripts/scripts/seed.js $(if $(FORCE),--force,)
	@echo ""
	@echo "  app      http://localhost:$${CRM_WEB_PORT:-3570}   (workspace logins: printed above)"
	@echo "  console  http://localhost:$${CRM_CONSOLE_PORT:-3580}   (operator login: printed above)"
	@echo "  Every demo account signs in with CRM_DEMO_PASSWORD from $(COMPOSE_DIR)/.env."

# ─── Quality ─────────────────────────────────────────────────────────────────

lint: ## Lint every package
	pnpm lint

typecheck: ## Typecheck every package
	pnpm typecheck

test: ## Unit tests (every package; no database needed)
	pnpm test

test-integration: ## API integration tests: recreate, migrate and seed $(TEST_DB), then run them
	@scripts/test-db.sh $(TEST_DB)
	DATABASE_URL= $(TEST_PG) pnpm db:migrate
	DATABASE_URL= $(TEST_PG) pnpm --filter @open-crm/api demo:seed
	DATABASE_URL= $(TEST_PG) REDIS_URL= pnpm --filter @open-crm/api test:integration

e2e: up demo ## Browser end-to-end tests (Playwright) against the Floci stack (skipped while e2e/tests is absent)
	@if [ -d e2e/tests ]; then pnpm e2e; else echo "no browser tests yet (e2e/tests is absent)"; fi

build: ## Build every package
	pnpm build

sanitize: ## Scan committable files for credentials, account ids, internal names, real emails and IPs
	@scripts/check-sanitization.sh

# ─── Terraform ───────────────────────────────────────────────────────────────

tf-fmt: ## Format all Terraform (CHECK=1: only check)
	$(TF) fmt -recursive $(if $(CHECK),-check -diff,) $(TF_ROOT)

tf-validate: ## terraform fmt -check, then validate every environment (no backend, no credentials)
	$(TF) fmt -recursive -check $(TF_ROOT)
	@for env in $(TF_ENVS); do \
	  echo "== $$env"; \
	  $(TF) -chdir=$(TF_ROOT)/envs/$$env init -backend=false -input=false -no-color >/dev/null && \
	  $(TF) -chdir=$(TF_ROOT)/envs/$$env validate -no-color || exit 1; \
	done

tf-lint: ## tflint every module and environment (plugins cached in a docker volume)
	$(TFLINT) --init
	$(TFLINT) --recursive --format compact

tf-security: ## checkov policy scan of the Terraform (any unskipped finding fails)
	docker run --rm -v $(CURDIR)/infra/terraform:/tf bridgecrew/checkov:3.3.30 -d /tf --config-file /tf/.checkov.yaml --framework terraform --quiet --compact

# ─── AWS ─────────────────────────────────────────────────────────────────────

aws-plan: ## terraform plan for ENV (aws-dev | aws-prod); needs terraform.tfvars and AWS credentials
	terraform -chdir=infra/terraform/envs/$(ENV) init -input=false
	terraform -chdir=infra/terraform/envs/$(ENV) plan -var image_tag=$(TAG)

aws-deploy: ## One shot: registry, image, infrastructure, migrations, rollout, both SPAs (ENV=aws-dev|aws-prod)
	@scripts/aws-deploy.sh $(ENV) $(TAG)

aws-migrate: ## Run database migrations as a one-off ECS task (ENV=...)
	@scripts/aws-run-task.sh $(ENV) migrate

aws-operator: ## Create the first operator on AWS (ENV=... EMAIL=you@example.com); prints a one-time password
	@test -n "$(EMAIL)" || { echo "usage: make aws-operator ENV=aws-prod EMAIL=you@example.com"; exit 1; }
	@scripts/aws-run-task.sh $(ENV) operator "$(EMAIL)"

clean: ## Remove build output
	rm -rf apps/*/dist apps/api/dist-scripts packages/*/dist .turbo e2e/.report e2e/.results
