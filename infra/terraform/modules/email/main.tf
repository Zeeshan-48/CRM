# Email for the CRM:
#
#   - the platform sending identity (AWS_SES_FROM_EMAIL): sign-in, invite and password
#     reset mail and operator notices. DKIM-signed, with a custom MAIL FROM domain so
#     SPF aligns, and a configuration set that publishes send, delivery, bounce and
#     complaint counts to CloudWatch
#   - the event pipeline for per-tenant sending domains: the API creates one SES
#     configuration set per tenant that publishes to the events topic
#     (SES_EVENTS_SNS_TOPIC_ARN); the topic fans out to an SQS queue
#     (SES_EVENTS_QUEUE_URL, with a dead-letter queue) that the API long-polls
#   - optional inbound mail: an SES receipt rule for inbound_domain publishes to the
#     inbound topic, which feeds SES_INBOUND_QUEUE_URL. SES receives mail only in some
#     regions, and a region has one active receipt rule set: enabling inbound replaces
#     whatever rule set was active in this account and region.
#
# Topics are encrypted with the deployment key (the kms module lets SES use it), the
# queues with SQS-managed keys so SNS can deliver without key grants.
locals {
  mail_from_domain = "${var.mail_from_subdomain}.${var.domain}"
  manage_dns       = var.manage_dns
}

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = "${var.name_prefix}-mail"

  delivery_options {
    tls_policy = "REQUIRE"
  }
  reputation_options {
    reputation_metrics_enabled = true
  }
  sending_options {
    sending_enabled = true
  }
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

resource "aws_sesv2_email_identity" "domain" {
  email_identity         = var.domain
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# Delivery events as CloudWatch metrics (namespace AWS/SES), split by configuration set.
resource "aws_sesv2_configuration_set_event_destination" "cloudwatch" {
  count                  = var.enable_event_metrics ? 1 : 0
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "cloudwatch"
  event_destination {
    enabled              = true
    matching_event_types = ["SEND", "REJECT", "BOUNCE", "COMPLAINT", "DELIVERY", "DELIVERY_DELAY", "RENDERING_FAILURE"]
    cloud_watch_destination {
      dimension_configuration {
        dimension_name          = "configuration_set"
        dimension_value_source  = "MESSAGE_TAG"
        default_dimension_value = aws_sesv2_configuration_set.this.configuration_set_name
      }
    }
  }
}

data "aws_region" "current" {}

# ─── DNS (only when the zone is managed in Route53) ─────────────────────────

resource "aws_route53_record" "dkim" {
  count   = local.manage_dns ? 3 : 0
  zone_id = var.route53_zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mail_from_mx" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${data.aws_region.current.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count   = local.manage_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count   = local.manage_dns && var.dmarc_policy != null ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 600
  records = ["v=DMARC1; p=${var.dmarc_policy}; rua=mailto:${var.dmarc_report_address != null ? var.dmarc_report_address : "dmarc-reports@${var.domain}"}"]
}

data "aws_caller_identity" "current" {}

# ─── Event and inbound pipelines ─────────────────────────────────────────────

locals {
  pipelines = merge(
    { events = "SES delivery events of per-tenant configuration sets" },
    var.inbound_domain != null ? { inbound = "Mail received by SES for ${var.inbound_domain}" } : {},
  )
}

resource "aws_sns_topic" "this" {
  for_each          = local.pipelines
  name              = "${var.name_prefix}-ses-${each.key}"
  display_name      = each.value
  kms_master_key_id = var.kms_key_arn
}

data "aws_iam_policy_document" "topic" {
  for_each = local.pipelines
  statement {
    sid       = "SesPublish"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.this[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "this" {
  for_each = local.pipelines
  arn      = aws_sns_topic.this[each.key].arn
  policy   = data.aws_iam_policy_document.topic[each.key].json
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.pipelines
  name                      = "${var.name_prefix}-ses-${each.key}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "this" {
  for_each                   = local.pipelines
  name                       = "${var.name_prefix}-ses-${each.key}"
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 120
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 5
  })
}

data "aws_iam_policy_document" "queue" {
  for_each = local.pipelines
  statement {
    sid       = "FromTopic"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.this[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.this[each.key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "this" {
  for_each  = local.pipelines
  queue_url = aws_sqs_queue.this[each.key].id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}

# Raw delivery: the consumer reads the SES notification as the message body.
resource "aws_sns_topic_subscription" "this" {
  for_each             = local.pipelines
  topic_arn            = aws_sns_topic.this[each.key].arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.this[each.key].arn
  raw_message_delivery = true
}

resource "aws_ses_receipt_rule_set" "inbound" {
  count         = var.inbound_domain != null ? 1 : 0
  rule_set_name = "${var.name_prefix}-inbound"
}

resource "aws_ses_receipt_rule" "inbound" {
  count         = var.inbound_domain != null ? 1 : 0
  name          = "${var.name_prefix}-to-sns"
  rule_set_name = aws_ses_receipt_rule_set.inbound[0].rule_set_name
  recipients    = [var.inbound_domain]
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Require"
  sns_action {
    topic_arn = aws_sns_topic.this["inbound"].arn
    encoding  = "Base64"
    position  = 1
  }
  depends_on = [aws_sns_topic_policy.this]
}

resource "aws_ses_active_receipt_rule_set" "inbound" {
  count         = var.inbound_domain != null ? 1 : 0
  rule_set_name = aws_ses_receipt_rule_set.inbound[0].rule_set_name
}

resource "aws_route53_record" "inbound_mx" {
  count   = local.manage_dns && var.inbound_domain != null ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.inbound_domain
  type    = "MX"
  ttl     = 600
  records = ["10 inbound-smtp.${data.aws_region.current.region}.amazonaws.com"]
}
