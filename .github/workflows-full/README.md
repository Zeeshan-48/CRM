# Full CI pipeline (opt-in)

These workflows are the complete quality pipeline for Euron Open CRM. They are kept
here, outside `.github/workflows/`, so they do **not** run on the upstream repository.
Only the [`checks`](../workflows/checks.yml) workflow (lint, typecheck, unit tests,
build, the API integration tests on Postgres + Redis, the sanitization scan, Terraform
fmt and validate) runs there.

| Workflow | What it runs |
| --- | --- |
| [`ci.yml`](ci.yml) | Lint, typecheck, unit tests, build and the sanitization scan, then the API integration tests on Postgres 16 and Redis 7 service containers (migrated and seeded first) |
| [`security.yml`](security.yml) | gitleaks (full history), CodeQL (JavaScript/TypeScript), `pnpm audit` |
| [`terraform.yml`](terraform.yml) | `terraform fmt` and `validate` for every environment, tflint, checkov |
| [`docker.yml`](docker.yml) | Multi-arch builds of the api, web and console images (pushed to GHCR on tags) |
| [`e2e.yml`](e2e.yml) | The full stack on the local AWS emulator with every provider simulated (`make up`, `make demo`): health and sign-in smoke calls, then the browser tests (`pnpm e2e`, when `e2e/tests` exists) |

To enable them in your fork, move them into `.github/workflows/` (ci.yml overlaps with
checks.yml; keep one of the two):

```bash
git mv .github/workflows-full/*.yml .github/workflows/
```

Every gate is also runnable locally:
`make lint typecheck test test-integration e2e tf-validate tf-lint tf-security sanitize`.
