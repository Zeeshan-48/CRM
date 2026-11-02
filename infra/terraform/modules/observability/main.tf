# Alarms (to an SNS topic, optionally e-mailed) and one dashboard for a deployment:
# per-service errors and health (load-balanced services), CPU and memory, plus the
# database, plus failed background jobs and the SES dead-letter queues. The cache
# module adds its own Redis alarms to the same topic.
data "aws_region" "current" {}

resource "aws_sns_topic" "alarms" {
  name              = "${var.name_prefix}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  region = data.aws_region.current.region

  lb_alarms = merge([
    for name, s in var.services : {
      "${name}-5xx" = {
        description = "${name}: 5xx responses from the tasks"
        namespace   = "AWS/ApplicationELB"
        metric      = "HTTPCode_Target_5XX_Count"
        stat        = "Sum"
        threshold   = 25
        period      = 300
        dimensions  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = s.target_group_arn_suffix }
      }
      "${name}-unhealthy" = {
        description = "${name}: tasks failing load balancer health checks"
        namespace   = "AWS/ApplicationELB"
        metric      = "UnHealthyHostCount"
        stat        = "Maximum"
        threshold   = 0
        period      = 60
        dimensions  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = s.target_group_arn_suffix }
      }
    } if s.load_balanced
  ]...)

  ecs_alarms = merge([
    for name, s in var.services : {
      "${name}-cpu" = {
        description = "${name}: CPU sustained above 85%"
        namespace   = "AWS/ECS"
        metric      = "CPUUtilization"
        stat        = "Average"
        threshold   = 85
        period      = 300
        dimensions  = { ClusterName = var.ecs_cluster_name, ServiceName = s.service_name }
      }
      "${name}-memory" = {
        description = "${name}: memory sustained above 85%"
        namespace   = "AWS/ECS"
        metric      = "MemoryUtilization"
        stat        = "Average"
        threshold   = 85
        period      = 300
        dimensions  = { ClusterName = var.ecs_cluster_name, ServiceName = s.service_name }
      }
    }
  ]...)

  service_alarms = merge(local.lb_alarms, local.ecs_alarms)

  db_alarms = {
    db-cpu = {
      description = "Database CPU sustained above 80%"
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      stat        = "Average"
      threshold   = 80
      period      = 300
      dimensions  = { DBInstanceIdentifier = var.db_instance_identifier }
      comparison  = "GreaterThanThreshold"
    }
    db-storage = {
      description = "Database free storage below 5 GiB"
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      stat        = "Minimum"
      threshold   = 5 * 1024 * 1024 * 1024
      period      = 300
      dimensions  = { DBInstanceIdentifier = var.db_instance_identifier }
      comparison  = "LessThanThreshold"
    }
    db-connections = {
      description = "Database connections above 80% of the configured ceiling"
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      stat        = "Maximum"
      threshold   = var.db_max_connections * 0.8
      period      = 300
      dimensions  = { DBInstanceIdentifier = var.db_instance_identifier }
      comparison  = "GreaterThanThreshold"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "service" {
  for_each            = local.service_alarms
  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dimensions
  period              = each.value.period
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "db" {
  for_each            = local.db_alarms
  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dimensions
  period              = each.value.period
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# ─── Failed background jobs ──────────────────────────────────────────────────
# The recurring jobs run inside the API tasks (one cluster worker per task owns them,
# apps/api/src/jobs) and publish no metrics themselves. A sweep that throws is logged
# as a plain-text line "job <name> failed: <error>" (jobs/scheduler.ts); a metric
# filter on the API log group counts those lines.
resource "aws_cloudwatch_log_metric_filter" "failed_jobs" {
  name           = "${var.name_prefix}-failed-jobs"
  log_group_name = var.jobs_log_group_name
  pattern        = "\"job\" \"failed:\""
  metric_transformation {
    name          = "FailedJobs"
    namespace     = "OpenCrm/${var.name_prefix}"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "failed_jobs" {
  alarm_name          = "${var.name_prefix}-failed-jobs"
  alarm_description   = "background jobs: more than ${var.failed_jobs_threshold} failed runs in 5 minutes (see the api log group)"
  namespace           = aws_cloudwatch_log_metric_filter.failed_jobs.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.failed_jobs.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.failed_jobs_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# Messages the SES consumers could not process after five attempts.
resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each            = toset(var.dead_letter_queue_names)
  alarm_name          = "${var.name_prefix}-${each.key}-messages"
  alarm_description   = "${each.key}: messages the API failed to process five times"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.key }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name_prefix
  dashboard_body = jsonencode({
    widgets = concat(
      [
        {
          type = "metric", x = 0, y = 0, width = 12, height = 6
          properties = {
            title = "API requests and errors", region = local.region, stat = "Sum", period = 60
            metrics = [
              ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix],
              [".", "HTTPCode_Target_4XX_Count", ".", "."],
              [".", "HTTPCode_Target_5XX_Count", ".", "."],
            ]
          }
        },
        {
          type = "metric", x = 12, y = 0, width = 12, height = 6
          properties = {
            title = "Latency p50 / p99", region = local.region, period = 60
            metrics = [
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p50" }],
              ["...", { stat = "p99" }],
            ]
          }
        },
        {
          type = "metric", x = 0, y = 12, width = 24, height = 6
          properties = {
            title = "Database", region = local.region, stat = "Average", period = 60
            metrics = [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_identifier],
              [".", "DatabaseConnections", ".", "."],
              [".", "ReadLatency", ".", "."],
              [".", "WriteLatency", ".", "."],
            ]
          }
        },
      ],
      [
        for i, name in sort(keys(var.services)) : {
          type = "metric", x = (i % 3) * 8, y = 6, width = 8, height = 6
          properties = {
            title = "${name}: CPU / memory", region = local.region, stat = "Average", period = 60
            metrics = [
              ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.services[name].service_name],
              [".", "MemoryUtilization", ".", ".", ".", "."],
            ]
          }
        }
      ],
    )
  })
}
