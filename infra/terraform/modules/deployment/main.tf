# ─────────────────────────────────────────────────────────────────────────────
# One complete Euron Open CRM deployment: network, data, cache, keys, mail, file
# storage, the API on ECS Fargate, and the two single-page apps on S3 + CloudFront:
#
#   https://<domain>/*                  web      (the CRM workspace SPA, from S3)
#   https://<console_domain>/*          console  (the operator console SPA, from S3)
#   https://<either host>/api/*         api      (CloudFront -> load balancer -> ECS)
#
# The browser calls the API on the same host it loaded the app from, so API calls are
# same-origin, and provider webhooks (WhatsApp, Exotel, billing) and product ingest
# reach the API through the same edge. Each SPA is built for its host
# (VITE_API_BASE_URL = https://<host>/api/v1, the console's /api/v1/operator) and
# uploaded by scripts/aws-deploy.sh.
#
# The API is one ECS service of at least api_min_count tasks. Each task runs a node
# cluster; in each task exactly one cluster worker also runs the background jobs (the
# BullMQ scheduler on ElastiCache, which fires each recurring sweep once across all
# tasks, and the two SES SQS consumers). There is no separate worker service. A
# one-off task definition on the same image applies the SQL migrations
# (make aws-migrate; aws-deploy runs it before rolling the service).
#
# CloudFront adds a secret header (X-Origin-Verify) to every request it sends to the
# load balancer, the API listener rule requires it, and the load balancer only accepts
# CloudFront's address ranges, so neither the WAF nor the edge can be bypassed. The
# value is generated here and lives only in Terraform state; it is never an output.
#
# Every provider the API has no platform key for (AI, WhatsApp, Twilio, Exotel,
# Razorpay, Stripe) runs in its simulated mode or with the deterministic offline AI
# engine. Platform keys go in provider_secrets (or by hand into <prefix>/providers).
#
# envs/aws-dev and envs/aws-prod call this module with different sizes and safety
# switches; everything else is identical by construction.
# ─────────────────────────────────────────────────────────────────────────────
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region      = data.aws_region.current.region
  account_id  = data.aws_caller_identity.current.account_id
  hostnames   = { web = var.domain, console = var.console_domain }
  app_url     = "https://${var.domain}"
  console_url = "https://${var.console_domain}"
  mail_domain = coalesce(var.mail_domain, var.domain)
  api_image   = "${module.ecr.repository_urls["api"]}:${var.image_tag}"
  api_port    = 5066
  # Two proxy hops in front of the API: CloudFront, then the load balancer.
  trust_proxy = "2"
  # The RDS CA bundle baked into the api image (infra/docker/api.Dockerfile): with it,
  # PGSSLMODE=verify-full verifies the database certificate and host name.
  db_tls_environment = {
    PGSSLMODE           = "verify-full"
    NODE_EXTRA_CA_CERTS = "/app/certs/rds-global-bundle.pem"
  }
  sites = {
    web     = { host = var.domain, url = local.app_url, api_base_url = "${local.app_url}/api/v1" }
    console = { host = var.console_domain, url = local.console_url, api_base_url = "${local.console_url}/api/v1/operator" }
  }
}

# ─── Foundation ──────────────────────────────────────────────────────────────

module "network" {
  source                     = "../network"
  name_prefix                = var.name_prefix
  cidr_block                 = var.vpc_cidr
  az_count                   = var.az_count
  single_nat_gateway         = var.single_nat_gateway
  enable_interface_endpoints = var.enable_interface_endpoints
  flow_log_retention_days    = var.flow_log_retention_days
  logs_kms_key_arn           = module.kms.key_arn
}

module "kms" {
  source                  = "../kms"
  name_prefix             = var.name_prefix
  deletion_window_in_days = var.kms_deletion_window_days
  admin_principal_arns    = var.kms_admin_principal_arns
}

module "secrets" {
  source                     = "../secrets"
  name_prefix                = var.name_prefix
  kms_key_arn                = module.kms.key_arn
  recovery_window_in_days    = var.secret_recovery_window_days
  jwt_secret                 = var.jwt_secret
  credentials_encryption_key = var.credentials_encryption_key
  provider_secrets           = var.provider_secrets
}

module "database" {
  source                      = "../database"
  name_prefix                 = var.name_prefix
  vpc_id                      = module.network.vpc_id
  subnet_ids                  = module.network.private_subnet_ids
  kms_key_arn                 = module.kms.key_arn
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage
  max_allocated_storage       = var.db_max_allocated_storage
  multi_az                    = var.db_multi_az
  backup_retention_days       = var.db_backup_retention_days
  deletion_protection         = var.deletion_protection
  skip_final_snapshot         = !var.deletion_protection
  monitoring_interval         = var.db_monitoring_interval
  secret_recovery_window_days = var.secret_recovery_window_days
}

module "cache" {
  source                      = "../cache"
  name_prefix                 = var.name_prefix
  vpc_id                      = module.network.vpc_id
  subnet_ids                  = module.network.private_subnet_ids
  kms_key_arn                 = module.kms.key_arn
  node_type                   = var.cache_node_type
  node_count                  = var.cache_node_count
  snapshot_retention_days     = var.cache_snapshot_retention_days
  log_retention_days          = var.log_retention_days
  secret_recovery_window_days = var.secret_recovery_window_days
  alarm_topic_arn             = module.observability.alarm_topic_arn
}

module "email" {
  source          = "../email"
  name_prefix     = var.name_prefix
  domain          = local.mail_domain
  manage_dns      = var.route53_zone_id != null
  route53_zone_id = var.route53_zone_id
  dmarc_policy    = var.dmarc_policy
  kms_key_arn     = module.kms.key_arn
  inbound_domain  = var.inbound_domain
}

module "storage" {
  source                  = "../storage"
  bucket_name             = "${var.name_prefix}-files-${local.account_id}"
  kms_key_arn             = module.kms.key_arn
  cors_origins            = [local.app_url, local.console_url]
  noncurrent_version_days = var.storage_noncurrent_version_days
  force_destroy           = !var.deletion_protection
}

module "ecr" {
  source       = "../ecr"
  name_prefix  = var.name_prefix
  kms_key_arn  = module.kms.key_arn
  force_delete = !var.deletion_protection
}

# ─── Edge ────────────────────────────────────────────────────────────────────

# The load balancer is only ever reached by CloudFront, which owns the public names.
module "edge" {
  source                = "../edge"
  name_prefix           = var.name_prefix
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  hostnames             = local.hostnames
  route53_zone_id       = var.route53_zone_id
  certificate_arn       = var.certificate_arn
  create_dns_records    = false
  allow_only_cloudfront = true
  access_logs_bucket    = var.alb_access_logs_bucket
  deletion_protection   = var.deletion_protection
  idle_timeout          = var.alb_idle_timeout
}

# The secret CloudFront sends to the load balancer. Rotate with
#   terraform apply -replace='module.app.random_password.origin_verify'
# (CloudFront and the rule update in the same apply; requests in flight during the
# CloudFront propagation can see a short burst of 403s).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

locals {
  origin_header_name = "X-Origin-Verify"
}

module "waf" {
  count       = var.enable_waf ? 1 : 0
  source      = "../waf"
  providers   = { aws = aws.us_east_1 }
  name_prefix = var.name_prefix
}

module "cdn" {
  for_each               = local.sites
  source                 = "../cdn"
  providers              = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  name_prefix            = var.name_prefix
  name                   = each.key
  hostname               = each.value.host
  bucket_suffix          = local.account_id
  route53_zone_id        = var.route53_zone_id
  certificate_arn        = var.cdn_certificate_arn
  api_origin_domain_name = module.edge.dns_name
  origin_header_name     = local.origin_header_name
  origin_header_value    = random_password.origin_verify.result
  web_acl_arn            = var.enable_waf ? module.waf[0].web_acl_arn : null
  origin_read_timeout    = var.cdn_origin_read_timeout
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

# ─── API: environment, secrets, permissions ──────────────────────────────────

locals {
  # Database connection, shared by the api and the migrate task. The password comes
  # from <prefix>/database as an ECS secret.
  db_environment = merge(local.db_tls_environment, {
    PG_DATABASE_HOST = module.database.address
    PG_DATABASE_PORT = tostring(module.database.port)
    PG_DATABASE_USER = module.database.master_username
    PG_DATABASE      = module.database.database_name
  })

  simulate = tostring(var.simulate_providers)

  # Everything except secrets. Names are the ones apps/api/src/config/index.ts reads.
  api_environment = merge(local.db_environment, {
    NODE_ENV                 = "production"
    TZ                       = "UTC"
    PORT                     = tostring(local.api_port)
    LOG_LEVEL                = var.log_level
    BRAND_NAME               = var.product_name
    CRM_APP_URL              = local.app_url
    OPERATOR_APP_URL         = local.console_url
    APP_PUBLIC_URL           = local.app_url
    CORS_ORIGINS             = "${local.app_url},${local.console_url}"
    TRUST_PROXY              = local.trust_proxy
    PG_POOL_MAX              = tostring(var.db_pool_max)
    AWS_REGION               = local.region
    AWS_S3_BUCKET            = module.storage.bucket_name
    LOCAL_STORAGE_DIR        = "/tmp/local-storage"
    AWS_SES_REGION           = local.region
    AWS_SES_FROM_EMAIL       = module.email.from_address
    AWS_SES_FROM_NAME        = var.product_name
    SES_EVENTS_SNS_TOPIC_ARN = module.email.events_topic_arn
    SES_EVENTS_QUEUE_URL     = module.email.events_queue_url
    SES_INBOUND_QUEUE_URL    = module.email.inbound_queue_url
    SES_INBOUND_REGION       = local.region
    # Providers without a platform key are simulated either way; these force it even
    # when a key is present (aws-dev defaults to true, aws-prod to false).
    WHATSAPP_SIMULATE  = local.simulate
    TELEPHONY_SIMULATE = local.simulate
    EXOTEL_SIMULATE    = local.simulate
    RAZORPAY_SIMULATE  = local.simulate
    STRIPE_SIMULATE    = local.simulate
    BILLING_SIMULATE   = local.simulate
  }, var.api_extra_environment)

  # JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY, provider keys, PG_DATABASE_PASSWORD, REDIS_URL.
  api_secrets = concat(module.secrets.secret_refs, module.database.secret_refs, module.cache.secret_refs, var.api_extra_secrets)

  # The migrate task needs the database and nothing else.
  migrate_environment = merge(local.db_environment, {
    NODE_ENV = "production"
    TZ       = "UTC"
  })

  container_health = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.api_port}/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]

  ses_identity_arn      = "arn:aws:ses:${local.region}:${local.account_id}:identity/*"
  ses_configuration_arn = "arn:aws:ses:${local.region}:${local.account_id}:configuration-set/*"
}

# What the API does at runtime: files in its bucket, mail through SES (the platform
# identity plus the per-tenant sending domains it onboards, each with its own
# configuration set), and the two SES queues. Nothing else; the injected secrets are
# read by the execution role, not this one.
data "aws_iam_policy_document" "api" {
  source_policy_documents = [module.storage.access_policy_json]

  statement {
    sid       = "SendMail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [local.ses_identity_arn, local.ses_configuration_arn]
  }
  statement {
    sid = "TenantSendingDomains"
    actions = [
      "ses:CreateEmailIdentity", "ses:DeleteEmailIdentity", "ses:GetEmailIdentity",
      "ses:PutEmailIdentityMailFromAttributes", "ses:TagResource",
    ]
    resources = [local.ses_identity_arn, local.ses_configuration_arn]
  }
  statement {
    sid       = "TenantConfigurationSets"
    actions   = ["ses:CreateConfigurationSet", "ses:CreateConfigurationSetEventDestination", "ses:GetConfigurationSet"]
    resources = [local.ses_configuration_arn]
  }
  statement {
    sid       = "SesQueues"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"]
    resources = module.email.queue_arns
  }
}

# ─── Services ────────────────────────────────────────────────────────────────

module "api" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "api"
  image                = local.api_image
  command              = ["node", "--enable-source-maps", "dist/index.js"]
  container_port       = local.api_port
  environment          = local.api_environment
  secrets              = local.api_secrets
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  listener_arn         = module.edge.https_listener_arn
  lb_security_group_id = module.edge.security_group_id
  listener_priority    = 100
  host_headers         = values(local.hostnames)
  path_patterns        = ["/api/*"]
  # CloudFront in front: only requests carrying the secret header match.
  require_origin_header    = true
  origin_header_name       = local.origin_header_name
  origin_header_value      = random_password.origin_verify.result
  deregistration_delay     = 60
  health_check_path        = "/api/health"
  container_health_command = local.container_health
  connect_to_database      = true
  db_security_group_id     = module.database.security_group_id
  db_port                  = module.database.port
  connect_to_cache         = true
  cache_security_group_id  = module.cache.security_group_id
  cache_port               = module.cache.port
  kms_key_arn              = module.kms.key_arn
  has_task_policy          = true
  task_policy_json         = data.aws_iam_policy_document.api.json
  cpu                      = var.api_cpu
  cpu_architecture         = var.cpu_architecture
  memory                   = var.api_memory
  min_count                = var.api_min_count
  max_count                = var.api_max_count
  log_retention_days       = var.log_retention_days
  logs_kms_key_arn         = module.kms.key_arn
}

# ─── One-off task (make aws-migrate) ─────────────────────────────────────────

module "migrate" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "migrate"
  image                = local.api_image
  command              = ["node", "db/migrate.js"]
  environment          = local.migrate_environment
  secrets              = module.database.secret_refs
  create_service       = false
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  connect_to_database  = true
  db_security_group_id = module.database.security_group_id
  db_port              = module.database.port
  kms_key_arn          = module.kms.key_arn
  cpu                  = 256
  cpu_architecture     = var.cpu_architecture
  memory               = 512
  log_retention_days   = var.log_retention_days
  logs_kms_key_arn     = module.kms.key_arn
}

# ─── Observability ───────────────────────────────────────────────────────────

module "observability" {
  source                  = "../observability"
  name_prefix             = var.name_prefix
  alarm_email             = var.alarm_email
  alb_arn_suffix          = module.edge.arn_suffix
  ecs_cluster_name        = aws_ecs_cluster.this.name
  db_instance_identifier  = module.database.instance_identifier
  jobs_log_group_name     = module.api.log_group_name
  dead_letter_queue_names = module.email.dead_letter_queue_names
  services = {
    api = { service_name = module.api.service_name, load_balanced = true, target_group_arn_suffix = module.api.target_group_arn_suffix }
  }
}
