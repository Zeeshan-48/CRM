#!/usr/bin/env bash
# Fail if the Euron Open CRM tree contains anything that must never be published:
# cloud credentials, private keys, real account ids or resource ids, internal
# hostnames, bucket and database names, real email addresses, public IP addresses,
# the brand name outside the product name, committed env files. Runs in CI on every
# push.
#
#   scripts/check-sanitization.sh [dir]     (default: repo root)
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 2

EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo
  --exclude-dir=.terraform --exclude-dir=coverage --exclude-dir=samples --exclude=pnpm-lock.yaml
  --exclude=check-sanitization.sh --exclude=.gitleaks.toml --exclude=*.lock.hcl --exclude=*.tfstate*
  --exclude=*.png --exclude=*.jpg --exclude=*.webp --exclude=*.gif --exclude=*.mp4 --exclude=*.ico)

# Inside a git checkout, scan exactly the files git would commit (tracked plus
# untracked-but-not-ignored). That honors .gitignore by construction, so local
# state (deploy/compose/.env, terraform.tfstate, scratch dirs) is never in scope
# and nothing new slips past a hand-maintained exclude list. Outside git, fall
# back to a recursive grep with EXCLUDES.
FILES=()
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  while IFS= read -r -d '' f; do
    case "$f" in
      pnpm-lock.yaml | scripts/check-sanitization.sh | .gitleaks.toml | *.lock.hcl | \
        *.png | *.jpg | *.webp | *.gif | *.mp4 | *.ico) continue ;;
    esac
    [[ -f "$f" ]] && FILES+=("$f")
  done < <(git ls-files -z --cached --others --exclude-standard)
fi

failed=0
check() { # label, extended-regex, [allow-regex]
  local label="$1" pattern="$2" allow="${3:-}" hits
  if ((${#FILES[@]})); then
    hits="$(printf '%s\0' "${FILES[@]}" | xargs -0 grep -nIHE -- "$pattern" 2>/dev/null || true)"
  else
    hits="$(grep -rnIE "${EXCLUDES[@]}" -- "$pattern" . 2>/dev/null || true)"
  fi
  if [[ -n "$allow" && -n "$hits" ]]; then hits="$(grep -viE -- "$allow" <<<"$hits" || true)"; fi
  if [[ -n "$hits" ]]; then
    printf '\n\033[31m✗ %s\033[0m\n%s\n' "$label" "$(head -20 <<<"$hits")"
    failed=1
  fi
}

check "AWS access key id" '\b(AKIA|ASIA)[0-9A-Z]{16}\b'
check "Private key block" '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
# 000000000000 is the emulator's account, 123456789012 and 111122223333 the documentation placeholders;
# UUIDs, hashes and lockfile integrity strings carry long digit runs legitimately, and
# so do E.164 phone numbers (+919876543210), which a CRM is full of.
check "12-digit number (possible AWS account id)" '(^|[^0-9.])[0-9]{12}([^0-9]|$)' '000000000000|123456789012|111122223333|[0-9a-f]{8}-[0-9a-f]{4}|sha|integrity|\+[0-9]{12}([^0-9]|$)'
check "AWS resource id" '\b(ami|subnet|sg|vpc|pcx|rtb|igw|eni|vol|snap)-[0-9a-f]{8,17}\b' '-(0{8,17}|x+)\b'
check "RDS endpoint" '\.[a-z0-9]{12}\.[a-z0-9-]+\.rds\.amazonaws\.com'
check "Slack/GitHub/Stripe/OpenAI/Anthropic style token" '\b(xox[baprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[0-9A-Za-z]{36}|sk_live_[0-9A-Za-z]{24,}|sk-(proj-)?[A-Za-z0-9_-]{32,})\b'
# Model provider keys beyond the sk-... shapes above: Google AI (Gemini), Groq,
# Hugging Face and Replicate tokens. Fixtures in the tree (tests) must stay short or
# visibly fake.
check "Model provider key" '\b(AIza[0-9A-Za-z_-]{35}|gsk_[0-9A-Za-z]{40,}|hf_[0-9A-Za-z]{30,}|r8_[0-9A-Za-z]{30,})\b'
# Names of the private deployment this project was extracted from: company domains,
# bucket and database names, internal hosts, IP ranges, tunnel hosts and handles.
# Replace them with example.com, generic names and placeholders.
check "Internal hostname, resource or handle" \
  '(euron_crm|\bes-(dev|prod)-|ap-south-1[:/][0-9]{12}|[0-9]{12}[:/][a-z0-9:/-]*ap-south-1|(^|[^0-9.])(13\.206|15\.252)\.|raushansde|trycloudflare|cvog8ka0ww2g)'
# The company sites appear only in the README family block and its brand cards.
check "Company domain outside the README family block" \
  '([Ee]uron[Ss]ystems|EURONSYSTEMS|[Ee]uron\.one)' \
  '^(\./)?(README\.md|docs/assets/brand/[^:]+):'

# Email addresses: only the reserved example domains and TLDs (.test, .example, .invalid:
# RFC 2606) and localhost. Real people's and companies' addresses never belong in the tree.
check "Email address outside the reserved example domains" \
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b' \
  '@([A-Za-z0-9-]+\.)*example\.(com|test|org|net)\b|@([A-Za-z0-9-]+\.)+(test|example|invalid)\b|@localhost\b|@users\.noreply\.github\.com\b'

# Public IPv4 addresses. Allowed: private (10/8, 172.16/12, 192.168/16), loopback,
# link-local, CGNAT, unspecified/broadcast, multicast and reserved (224/3), the
# benchmarking range (198.18/15) and the documentation ranges (RFC 5737).
ip_hits() {
  local raw
  if ((${#FILES[@]})); then
    raw="$(printf '%s\0' "${FILES[@]}" | xargs -0 grep -onIHE -- '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' 2>/dev/null || true)"
  else
    raw="$(grep -ronIE "${EXCLUDES[@]}" -- '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' . 2>/dev/null || true)"
  fi
  [[ -z "$raw" ]] && return 0
  awk '{
    line = $0
    if (match(line, /([0-9]{1,3}\.){3}[0-9]{1,3}/) == 0) next
    ip = substr(line, RSTART, RLENGTH)
    split(ip, o, ".")
    if (o[1] > 255 || o[2] > 255 || o[3] > 255 || o[4] > 255) next
    # A zero-padded octet ("3.074.149.198") is SVG path data or a version, not an address.
    if (o[1] ~ /^0[0-9]/ || o[2] ~ /^0[0-9]/ || o[3] ~ /^0[0-9]/ || o[4] ~ /^0[0-9]/) next
    # Well-known public resolvers, used as the "public address" in SSRF guard tests.
    if (ip == "8.8.8.8" || ip == "8.8.4.4" || ip == "1.1.1.1" || ip == "1.0.0.1") next
    if (o[1] == 10 || o[1] == 127 || o[1] == 0 || o[1] >= 224) next
    if (o[1] == 198 && (o[2] == 18 || o[2] == 19)) next
    if (o[1] == 172 && o[2] >= 16 && o[2] <= 31) next
    if (o[1] == 192 && o[2] == 168) next
    if (o[1] == 169 && o[2] == 254) next
    if (o[1] == 100 && o[2] >= 64 && o[2] <= 127) next
    if (o[1] == 192 && o[2] == 0 && o[3] == 2) next
    if (o[1] == 198 && o[2] == 51 && o[3] == 100) next
    if (o[1] == 203 && o[2] == 0 && o[3] == 113) next
    print line
  }' <<<"$raw"
}
hits="$(ip_hits)"
if [[ -n "$hits" ]]; then
  printf '\n\033[31m✗ %s\033[0m\n%s\n' "Public IPv4 address" "$(head -20 <<<"$hits")"
  failed=1
fi

# House rule: the brand name appears only as part of the product and repository names
# ("Euron Open CRM", euron-open-crm, the euron-sde-team GitHub organisation), except in
# the README (title and family block), LICENSE, package.json (description) and the
# brand assets.
brand_hits() {
  local raw
  if ((${#FILES[@]})); then
    raw="$(printf '%s\0' "${FILES[@]}" | xargs -0 grep -nIHi -- 'euron' 2>/dev/null || true)"
  else
    raw="$(grep -rnIi "${EXCLUDES[@]}" -- 'euron' . 2>/dev/null || true)"
  fi
  [[ -z "$raw" ]] && return 0
  raw="$(grep -vE '^(\./)?(README\.md|LICENSE|package\.json|docs/assets/brand/[^:]*|docs/assets/banner\.svg):' <<<"$raw" || true)"
  [[ -z "$raw" ]] && return 0
  # Drop the allowed names from the text after "file:line:", then keep lines still naming the brand.
  awk '{
    i = index($0, ":"); j = index(substr($0, i + 1), ":"); pre = substr($0, 1, i + j); txt = substr($0, i + j + 1)
    gsub(/Euron Open CRM/, "", txt)
    gsub(/euron-open-crm/, "", txt)
    gsub(/euron-sde-team/, "", txt)
    if (tolower(txt) ~ /euron/) print $0
  }' <<<"$raw"
}
hits="$(brand_hits)"
if [[ -n "$hits" ]]; then
  printf '\n\033[31m✗ %s\033[0m\n%s\n' "Brand name outside product and repository names" "$(head -20 <<<"$hits")"
  failed=1
fi

# Env files: only *.example may be tracked.
if git rev-parse --git-dir >/dev/null 2>&1; then
  tracked="$(git ls-files -- '*.env' '.env' '.env.*' '**/.env' '**/.env.*' | grep -v '\.example$' || true)"
  if [[ -n "$tracked" ]]; then
    printf '\n\033[31m✗ Committed env file(s)\033[0m\n%s\n' "$tracked"
    failed=1
  fi
fi

if [[ $failed -eq 0 ]]; then
  echo "sanitization: clean"
else
  echo; echo "sanitization: FAILED (see above). Replace real values with placeholders."
fi
exit $failed
