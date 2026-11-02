#!/usr/bin/env bash
# Run a one-off task on the API image, wait for it, print its logs, exit with its code.
#
#   scripts/aws-run-task.sh <aws-dev|aws-prod> migrate            apply pending migrations
#   scripts/aws-run-task.sh <aws-dev|aws-prod> migrate --status   list applied / pending
#   scripts/aws-run-task.sh <aws-dev|aws-prod> operator <email>   create the first operator
#
# `operator` runs on the migrate task definition (same image, database access) and
# prints a one-time password into the task's log stream; change it after first sign-in.
#
# The task definitions, subnets and security groups come from `terraform output run_task`.
# The migrate task connects as the database master user (PG_DATABASE_PASSWORD from
# <name_prefix>/database) and nothing else.
set -euo pipefail
ENV="${1:?usage: aws-run-task.sh <env> migrate [--status]}"
TASK="${2:?usage: aws-run-task.sh <env> migrate [--status]}"
shift 2
DIR="$(cd "$(dirname "$0")/.." && pwd)/infra/terraform/envs/$ENV"

region="${AWS_REGION:-$(sed -nE 's/^region *= *"([^"]+)".*/\1/p' "$DIR/terraform.tfvars" 2>/dev/null || true)}"
[[ -n "$region" ]] && export AWS_REGION="$region"

spec=$(terraform -chdir="$DIR" output -json run_task)
get() { python3 -c "import json,sys; d=json.load(sys.stdin); t=d['tasks'][sys.argv[1]]; print($1)" "$TASK" <<<"$spec"; }

case "$TASK" in
  migrate)
    if (($#)); then
      command=$(python3 -c 'import json,sys; print(json.dumps(["node","db/migrate.js"] + sys.argv[1:]))' "$@")
    else
      command='null'
    fi
    ;;
  operator)
    email="${1:?usage: aws-run-task.sh <env> operator <email>}"
    command=$(python3 -c 'import json,sys; print(json.dumps(["node","dist-scripts/scripts/bootstrap-operator.js","--email",sys.argv[1]]))' "$email")
    TASK=migrate
    ;;
  *) echo "unknown task: $TASK (migrate, operator)"; exit 2 ;;
esac

cluster=$(get "d['cluster']")
taskdef=$(get "t['task_definition']")
container=$(get "t['container']")
subnets=$(get "','.join(d['subnets'])")
groups=$(get "','.join(t['security_groups'])")

overrides='{}'
if [[ "$command" != null ]]; then
  overrides="{\"containerOverrides\":[{\"name\":\"$container\",\"command\":$command}]}"
fi

arn=$(aws ecs run-task --cluster "$cluster" --task-definition "$taskdef" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$groups],assignPublicIp=DISABLED}" \
  --overrides "$overrides" --query 'tasks[0].taskArn' --output text)
echo "started $TASK: $arn"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$arn"

code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].containers[0].exitCode' --output text)
reason=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].stoppedReason' --output text)
group=$(aws ecs describe-task-definition --task-definition "$taskdef" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
stream="$container/$container/${arn##*/}"
aws logs get-log-events --log-group-name "$group" --log-stream-name "$stream" --start-from-head \
  --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' || echo "(no logs in $group/$stream)"
echo "exit code: $code ($reason)"
[[ "$code" == "0" ]]
