# One WAF web ACL (CLOUDFRONT scope, so it must be created in us-east-1: pass that
# provider) shared by the app and console distributions:
#
#   - AWS managed common rule set and known-bad-inputs rule set
#   - a per-IP rate limit for everything except provider callbacks (WhatsApp, Exotel
#     and billing webhooks) and product ingest, which arrive from a few provider or
#     server addresses in bursts and authenticate with signatures or tokens instead
#
# Body rules that would block legitimate CRM content only count: email templates and
# campaign bodies are HTML (CrossSiteScripting_BODY), imports and attachments pass the
# 8 KB body inspection limit (SizeRestrictions_BODY), and notes and messages routinely
# hold URLs and paths (GenericLFI_BODY, GenericRFI_BODY, EC2MetaDataSSRF_BODY). The API
# never renders stored content unescaped, opens a path or fetches a URL from a body.
resource "aws_wafv2_web_acl" "this" {
  #checkov:skip=CKV2_AWS_31:WAF logging needs a Firehose or bucket the operator chooses; sampled requests and metrics are on.
  name  = "${var.name_prefix}-edge"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        dynamic "rule_action_override" {
          for_each = ["SizeRestrictions_BODY", "CrossSiteScripting_BODY", "GenericLFI_BODY", "GenericRFI_BODY", "EC2MetaDataSSRF_BODY"]
          content {
            name = rule_action_override.value
            action_to_use {
              count {}
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5_minutes
        aggregate_key_type = "IP"
        scope_down_statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = "^/api/v1/(wa/webhooks|telephony/webhooks|operator/webhooks|ingest)(/|$)"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-edge"
    sampled_requests_enabled   = true
  }
}
