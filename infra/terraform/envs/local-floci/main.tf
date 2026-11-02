# ─────────────────────────────────────────────────────────────────────────────
# Local environment on the Floci AWS emulator.
#
# The modules that build production run here unchanged; only the provider endpoints
# differ. `make up` applies this automatically (the compose `terraform` one-shot)
# before the API starts. By hand, against a running emulator (make up, or just floci):
#
#   terraform -chdir=infra/terraform/envs/local-floci init
#   terraform -chdir=infra/terraform/envs/local-floci apply
#
# Provisioned: the KMS key, the app secret, the CRM file bucket, the SES sending
# identity (verified through DKIM records in an emulated Route53 zone) and the SES
# events pipeline (SNS topic, SQS queue and dead-letter queue) the API long-polls.
# Postgres and Redis stay plain containers (deploy/compose).
# ─────────────────────────────────────────────────────────────────────────────

module "kms" {
  source                  = "../../modules/kms"
  name_prefix             = var.name_prefix
  deletion_window_in_days = 7
}

# Generated secrets are an AWS-deployment concern; locally compose reads
# deploy/compose/.env (make env). Created here anyway so the module is exercised.
module "secrets" {
  source                  = "../../modules/secrets"
  name_prefix             = var.name_prefix
  kms_key_arn             = module.kms.key_arn
  recovery_window_in_days = 0
}

# AWS_S3_BUCKET for the local stack. The emulator speaks plain HTTP, so the TLS-only
# bucket policy is left off here.
module "storage" {
  source        = "../../modules/storage"
  bucket_name   = var.bucket_name
  kms_key_arn   = module.kms.key_arn
  cors_origins  = var.app_origins
  force_destroy = true
  enforce_tls   = false
}

# The sending identity, verified the way it is on AWS: the emulator keeps a domain
# identity Pending until its DKIM CNAMEs exist in a Route53 zone, so the zone and the
# records are created here through the same email module production uses. Mail sent
# through the emulator is relayed to Mailpit (http://localhost:8086).
resource "aws_route53_zone" "mail" {
  #checkov:skip=CKV2_AWS_38:Emulator-only zone; never resolvable on the internet.
  #checkov:skip=CKV2_AWS_39:Emulator-only zone; there is no resolver to log.
  name          = var.mail_domain
  force_destroy = true
}

module "email" {
  source          = "../../modules/email"
  name_prefix     = var.name_prefix
  domain          = var.mail_domain
  manage_dns      = true
  route53_zone_id = aws_route53_zone.mail.zone_id
  dmarc_policy    = null
  kms_key_arn     = module.kms.key_arn
}
