# ─── Identity ────────────────────────────────────────────────────────────────

variable "name_prefix" {
  description = "Prefix for every resource name, e.g. \"crm-prod\". Lowercase letters, digits and hyphens."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,23}$", var.name_prefix))
    error_message = "name_prefix must be 3-24 characters: lowercase letters, digits, hyphens, starting with a letter."
  }
}

variable "domain" {
  description = "Host of the CRM workspace app, e.g. \"crm.example.com\". Its /api/* is the API."
  type        = string
}

variable "console_domain" {
  description = "Host of the operator console, e.g. \"console.crm.example.com\". Its /api/* is the API as well."
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone serving both hosts. Enables fully automatic certificates and DNS. Without it, pass certificate_arn and cdn_certificate_arn and publish the records from the outputs."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional ACM certificate covering both hosts (for the load balancer, which CloudFront reaches with the viewer's Host). Required when route53_zone_id is null."
  type        = string
  default     = null
}

variable "cdn_certificate_arn" {
  description = "Existing ACM certificate in us-east-1 covering both hosts (for CloudFront). Required when route53_zone_id is null."
  type        = string
  default     = null
  validation {
    condition     = var.route53_zone_id != null || (var.certificate_arn != null && var.cdn_certificate_arn != null)
    error_message = "Set route53_zone_id (automatic certificates and DNS), or both certificate_arn (regional) and cdn_certificate_arn (us-east-1)."
  }
}

variable "mail_domain" {
  description = "Platform sending domain verified in SES (defaults to domain). Mail goes out as no-reply@<mail_domain>."
  type        = string
  default     = null
}

variable "inbound_domain" {
  description = "Domain whose mail SES receives for the CRM inbox (SES_INBOUND_QUEUE_URL), e.g. \"inbound.crm.example.com\". Null disables inbound mail. SES receives mail only in some regions, and enabling it replaces the account's active receipt rule set in the region."
  type        = string
  default     = null
}

variable "dmarc_policy" {
  description = "DMARC policy to publish for the mail domain (none, quarantine, reject), or null to leave DMARC alone."
  type        = string
  default     = "none"
}

variable "product_name" {
  description = "BRAND_NAME: the product name in emails, and the sender name (AWS_SES_FROM_NAME)."
  type        = string
  default     = "Open CRM"
}

variable "image_tag" {
  description = "Tag of the api image in ECR (make aws-deploy uses the git commit)."
  type        = string
}

# ─── Keys and providers ──────────────────────────────────────────────────────

variable "jwt_secret" {
  description = "JWT_SECRET (32+ characters). Null generates one. Set only when moving an existing installation."
  type        = string
  default     = null
  sensitive   = true
}

variable "credentials_encryption_key" {
  description = "CREDENTIALS_ENCRYPTION_KEY (32+ characters). Null generates one. Set only when moving an existing installation, or the stored tenant credentials cannot be decrypted."
  type        = string
  default     = null
  sensitive   = true
}

variable "provider_secrets" {
  description = "Platform provider keys injected into the API by variable name (OPENAI_API_KEY, TWILIO_AUTH_TOKEN, RAZORPAY_KEY_ID, ...). Missing providers stay simulated. Values land in Terraform state: pass placeholders and replace <prefix>/providers by hand to avoid that."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "simulate_providers" {
  description = "Force the simulated mode of WhatsApp, telephony (Twilio, Exotel, AI calling), Razorpay, Stripe and platform billing even when keys are present."
  type        = bool
  default     = false
}

# ─── Network ─────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "VPC CIDR."
  type        = string
  default     = "10.70.0.0/16"
}

variable "az_count" {
  description = "Availability zones (2 or 3)."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "One shared NAT gateway (cheaper) instead of one per AZ (resilient)."
  type        = bool
  default     = true
}

variable "enable_interface_endpoints" {
  description = "KMS and Secrets Manager interface endpoints (traffic stays off NAT)."
  type        = bool
  default     = false
}

variable "flow_log_retention_days" {
  description = "VPC flow log retention; 0 disables flow logs."
  type        = number
  default     = 30
}

# ─── Edge ────────────────────────────────────────────────────────────────────

variable "enable_waf" {
  description = "Attach a WAF web ACL to both CloudFront distributions."
  type        = bool
  default     = true
}

variable "cdn_origin_read_timeout" {
  description = "Seconds CloudFront waits for each packet from the load balancer (1-180). 60 is CloudFront's maximum without a quota increase."
  type        = number
  default     = 60
}

variable "alb_idle_timeout" {
  description = "Load balancer idle timeout in seconds: how long a connection may go without a byte in either direction."
  type        = number
  default     = 120
}

variable "alb_access_logs_bucket" {
  description = "Existing bucket for ALB access logs. Null disables them."
  type        = string
  default     = null
}

# ─── Data ────────────────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Initial storage (GiB)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling (GiB)."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Synchronous standby in a second AZ."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup (point-in-time recovery) retention."
  type        = number
  default     = 7
}

variable "db_monitoring_interval" {
  description = "Enhanced monitoring interval in seconds (0 disables)."
  type        = number
  default     = 60
}

variable "db_pool_max" {
  description = "PG_POOL_MAX: Postgres connections per cluster worker of an API task. Tasks x vCPUs x this must stay below the instance's max_connections."
  type        = number
  default     = 8
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "cache_node_count" {
  description = "Redis nodes: 1, or 2+ for a replica in another AZ with automatic failover."
  type        = number
  default     = 1
}

variable "cache_snapshot_retention_days" {
  description = "Daily Redis snapshots kept."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Protect the database and load balancer from deletion, keep a final snapshot, refuse to delete non-empty repositories and the file bucket."
  type        = bool
  default     = true
}

variable "kms_deletion_window_days" {
  description = "Waiting period before a scheduled KMS key deletion completes."
  type        = number
  default     = 30
}

variable "kms_admin_principal_arns" {
  description = "IAM principals allowed to administer the KMS key."
  type        = list(string)
  default     = []
}

variable "secret_recovery_window_days" {
  description = "Recovery window for deleted secrets."
  type        = number
  default     = 30
}

variable "storage_noncurrent_version_days" {
  description = "Days an overwritten or deleted file version is kept in the file bucket."
  type        = number
  default     = 30
}

# ─── Application ─────────────────────────────────────────────────────────────

variable "log_level" {
  description = "API LOG_LEVEL."
  type        = string
  default     = "info"
}

variable "cpu_architecture" {
  description = "CPU architecture of every task: X86_64 (default) or ARM64 (Graviton, about 20% cheaper per vCPU). ARM64 needs images built for linux/arm64: deploy with PLATFORM=linux/arm64 make aws-deploy (scripts/aws-deploy.sh), or the tasks fail to start with an exec format error."
  type        = string
  default     = "X86_64"
  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "api_cpu" {
  description = "API task CPU units. The node cluster forks one worker per vCPU."
  type        = number
  default     = 1024
}

variable "api_memory" {
  description = "API task memory (MiB)."
  type        = number
  default     = 2048
}

variable "api_min_count" {
  description = "Minimum API tasks."
  type        = number
  default     = 2
}

variable "api_max_count" {
  description = "Maximum API tasks."
  type        = number
  default     = 6
}

variable "api_extra_environment" {
  description = "Extra API environment variables, e.g. EMAIL_ACCOUNT_TPS or GOOGLE_CALENDAR_ENABLED. Never put secrets here."
  type        = map(string)
  default     = {}
}

variable "api_extra_secrets" {
  description = "Extra API secrets as ECS secret references, e.g. [{ name = \"WA_FORWARD_SECRET\", valueFrom = \"<secret arn>:WA_FORWARD_SECRET::\" }]. The execution role is granted read access to each one."
  type        = list(object({ name = string, valueFrom = string }))
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Address that receives alarm notifications."
  type        = string
  default     = null
}
