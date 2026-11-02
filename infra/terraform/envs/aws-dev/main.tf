# ─────────────────────────────────────────────────────────────────────────────
# aws-dev: a full, cheaper copy of production. Two AZs with a single NAT, single-AZ
# database, one Redis node, one API task, no deletion protection, WAF on. Every
# provider runs simulated by default (simulate_providers = true).
#
# Everything is in ../../modules/deployment; this file only picks the sizes.
#   make aws-deploy ENV=aws-dev
# ─────────────────────────────────────────────────────────────────────────────
module "app" {
  source    = "../../modules/deployment"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name_prefix         = var.name_prefix
  domain              = var.domain
  console_domain      = var.console_domain
  route53_zone_id     = var.route53_zone_id
  certificate_arn     = var.certificate_arn
  cdn_certificate_arn = var.cdn_certificate_arn
  mail_domain         = var.mail_domain
  inbound_domain      = var.inbound_domain
  product_name        = var.product_name
  image_tag           = var.image_tag

  # Platform provider keys (AI, WhatsApp, Twilio, Razorpay, Stripe, ...). Empty keeps
  # every provider simulated and <name_prefix>/providers uncreated.
  provider_secrets   = var.provider_secrets
  simulate_providers = var.simulate_providers

  log_level = var.log_level
  # Anything else the API reads as a secret, as ECS secret references.
  api_extra_secrets     = var.api_extra_secrets
  api_extra_environment = var.api_extra_environment

  az_count                   = 2
  single_nat_gateway         = true
  enable_interface_endpoints = false

  enable_waf = true

  db_instance_class        = var.db_instance_class
  db_multi_az              = false
  db_backup_retention_days = 3
  deletion_protection      = false

  cache_node_type               = var.cache_node_type
  cache_node_count              = 1
  cache_snapshot_retention_days = 1

  kms_deletion_window_days    = 7
  secret_recovery_window_days = 0

  cpu_architecture = var.cpu_architecture

  api_cpu       = 512
  api_memory    = 1024
  api_min_count = 1
  api_max_count = 2

  log_retention_days      = 14
  flow_log_retention_days = 14
  alarm_email             = var.alarm_email
}
