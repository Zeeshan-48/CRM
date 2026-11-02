variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Environment tag."
  type        = string
  default     = "prod"
}

variable "extra_tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}

variable "name_prefix" {
  description = "Prefix for every resource name, 3-24 lowercase characters (e.g. \"crm-prod\")."
  type        = string
}

variable "domain" {
  description = "Host of the CRM workspace app, e.g. crm.example.com. Its /api/* is the API."
  type        = string
}

variable "console_domain" {
  description = "Host of the operator console, e.g. console.crm.example.com."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for both hosts (automatic certificates and DNS)."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional certificate covering both hosts, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "cdn_certificate_arn" {
  description = "Existing us-east-1 certificate covering both hosts, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "mail_domain" {
  description = "SES sending domain (defaults to domain)."
  type        = string
  default     = null
}

variable "inbound_domain" {
  description = "Domain whose mail SES receives for the CRM inbox. Null disables inbound mail."
  type        = string
  default     = null
}

variable "image_tag" {
  description = "Image tag to deploy (make aws-deploy passes the git commit)."
  type        = string
}

variable "product_name" {
  description = "BRAND_NAME shown in emails and as the sender name."
  type        = string
  default     = "Open CRM"
}

variable "alarm_email" {
  description = "Alarm notification address."
  type        = string
  default     = null
}

variable "provider_secrets" {
  description = "Platform provider keys by variable name (OPENAI_API_KEY, TWILIO_AUTH_TOKEN, ...), stored in <name_prefix>/providers and in state. Prefer placeholders replaced by hand."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "simulate_providers" {
  description = "Force simulated WhatsApp, telephony, Razorpay, Stripe and platform billing even with keys present."
  type        = bool
  default     = false
}

variable "api_extra_environment" {
  description = "Extra API environment. Never secrets."
  type        = map(string)
  default     = {}
}

variable "api_extra_secrets" {
  description = "Extra ECS secrets for the API, e.g. [{ name = \"WA_FORWARD_SECRET\", valueFrom = \"<secret arn>:WA_FORWARD_SECRET::\" }]."
  type        = list(object({ name = string, valueFrom = string }))
  default     = []
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.m7g.large"
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton). ARM64 needs linux/arm64 images: PLATFORM=linux/arm64 make aws-deploy."
  type        = string
  default     = "X86_64"
}

variable "log_level" {
  description = "API LOG_LEVEL."
  type        = string
  default     = "info"
}
