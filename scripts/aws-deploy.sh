#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-shot deployment to AWS:  scripts/aws-deploy.sh <aws-dev|aws-prod> <image-tag>
#
#   1. terraform apply the image registry (and the KMS key that encrypts it)
#   2. build the api image for $PLATFORM (linux/amd64 or linux/arm64), tag it with the
#      commit, push
#   3. terraform apply what the migrate task needs (network, database, task definition)
#   4. run the migrate task and wait for it (it must exit 0)
#   5. terraform apply everything else: cache, mail, storage, edge, CloudFront, the api
#   6. wait for the api service to become stable
#   7. build both single-page apps for their hosts (VITE_API_BASE_URL from the
#      `sites` output), upload them to their buckets, invalidate CloudFront
#
# Every provider without a platform key runs simulated; keys go in provider_secrets or
# by hand into <name_prefix>/providers (terraform output providers_secret_name).
#
# Needs: terraform, docker (buildx), the AWS CLI, python3, credentials for the target
# account, and infra/terraform/envs/<env>/terraform.tfvars (copy the .example).
#
# PLATFORM (the image platform) defaults from cpu_architecture in terraform.tfvars and
# must agree with it, because a mismatch builds fine but the tasks die at start with
# "exec format error":
#   cpu_architecture = "X86_64" (default)  PLATFORM=linux/amd64
#   cpu_architecture = "ARM64" (Graviton)  PLATFORM=linux/arm64
# Building linux/arm64 on an x86 machine (or the reverse) needs QEMU binfmt for buildx.
# The SPAs are platform independent static files.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ENV="${1:?usage: aws-deploy.sh <aws-dev|aws-prod> <image-tag>}"
TAG="${2:?usage: aws-deploy.sh <aws-dev|aws-prod> <image-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/infra/terraform/envs/$ENV"
# Image platform: follows cpu_architecture in terraform.tfvars unless PLATFORM is set,
# and must agree with it.
arch=$(sed -nE 's/^cpu_architecture *= *"([^"]+)".*/\1/p' "$DIR/terraform.tfvars" 2>/dev/null || true)
want=$([[ "${arch:-X86_64}" == ARM64 ]] && echo linux/arm64 || echo linux/amd64)
PLATFORM="${PLATFORM:-$want}"
if [[ "$PLATFORM" != "$want" ]]; then
  echo "PLATFORM=$PLATFORM does not match cpu_architecture=${arch:-X86_64} in terraform.tfvars (needs $want)"
  exit 2
fi

for bin in terraform docker aws python3; do command -v "$bin" >/dev/null || { echo "missing: $bin"; exit 1; }; done
[[ -f "$DIR/terraform.tfvars" ]] || { echo "create $DIR/terraform.tfvars from terraform.tfvars.example first"; exit 1; }
if [[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]]; then
  echo "note: the working tree has uncommitted changes; the images are built from it as-is"
fi

tf() { terraform -chdir="$DIR" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

region="${AWS_REGION:-$(sed -nE 's/^region *= *"([^"]+)".*/\1/p' "$DIR/terraform.tfvars")}"
[[ -n "$region" ]] || { echo "set region in terraform.tfvars (or AWS_REGION)"; exit 1; }
export AWS_REGION="$region"

echo "==> terraform init"
tf init -input=false >/dev/null

echo "==> 1/7 registry"
tf apply -input=false -auto-approve -var "image_tag=$TAG" -target=module.app.module.ecr

api_repo=$(tf output -json ecr_repositories | json "d['api']")
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${api_repo%%/*}" >/dev/null

echo "==> 2/7 api image ($TAG, $PLATFORM)"
docker buildx build --platform "$PLATFORM" -f "$ROOT/infra/docker/api.Dockerfile" -t "$api_repo:$TAG" --push "$ROOT"

echo "==> 3/7 database and the migrate task"
tf apply -input=false -auto-approve -var "image_tag=$TAG" -target=module.app.module.migrate

echo "==> 4/7 migrations"
"$ROOT/scripts/aws-run-task.sh" "$ENV" migrate

echo "==> 5/7 everything else"
tf apply -input=false -auto-approve -var "image_tag=$TAG"

echo "==> 6/7 waiting for the api service"
cluster=$(tf output -raw cluster_name)
read -r -a services <<<"$(tf output -json services | json "' '.join(d.values())")"
aws ecs wait services-stable --region "$region" --cluster "$cluster" --services "${services[@]}"

echo "==> 7/7 single-page apps"
sites=$(tf output -json sites)
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
for app in web console; do
  base=$(json "d['$app']['api_base_url']" <<<"$sites")
  bucket=$(json "d['$app']['bucket']" <<<"$sites")
  dist=$(json "d['$app']['distribution_id']" <<<"$sites")
  echo "--> $app (VITE_API_BASE_URL=$base)"
  docker buildx build -f "$ROOT/infra/docker/$app.Dockerfile" --target dist \
    --build-arg "VITE_API_BASE_URL=$base" \
    --build-arg "VITE_META_APP_ID=${VITE_META_APP_ID:-}" \
    --build-arg "VITE_META_WA_ES_CONFIG_ID=${VITE_META_WA_ES_CONFIG_ID:-}" \
    --build-arg "VITE_META_GRAPH_API_VERSION=${VITE_META_GRAPH_API_VERSION:-}" \
    --output "type=local,dest=$out/$app" "$ROOT"
  # Content-hashed assets first (cached for a year), then everything else, then
  # index.html last and never cached, so no visitor loads a page whose assets are missing.
  aws s3 sync "$out/$app/assets" "s3://$bucket/assets" --cache-control "public, max-age=31536000, immutable"
  aws s3 sync "$out/$app" "s3://$bucket" --exclude "assets/*" --exclude "index.html" --cache-control "public, max-age=300"
  aws s3 cp "$out/$app/index.html" "s3://$bucket/index.html" --cache-control "no-cache"
  aws s3 sync "$out/$app" "s3://$bucket" --delete --exclude "index.html" >/dev/null
  aws cloudfront create-invalidation --distribution-id "$dist" --paths "/*" --query 'Invalidation.Id' --output text >/dev/null
done

app_url=$(tf output -raw app_url)
console_url=$(tf output -raw console_url)
cat <<NEXT

Deployed $TAG to $ENV
  app      $app_url
  console  $console_url

1. Create the first operator, then sign in to the console and create plans:
     make aws-operator ENV=$ENV EMAIL=you@example.com
   (the demo seed, make demo, is for local stacks only).
2. Provider keys: every provider without one runs simulated. Put platform keys in
   provider_secrets (terraform.tfvars) or by hand into the secret named by
     terraform -chdir=infra/terraform/envs/$ENV output providers_secret_name
   then roll the api: re-run make aws-deploy, or
     aws ecs update-service --cluster $cluster --service ${services[0]} --force-new-deployment
3. Provider webhooks point at $app_url/api/v1/... (WhatsApp, Exotel, billing).
NEXT
