output "app_url" {
  description = "Public URL of the CRM workspace app."
  value       = module.app.app_url
}

output "console_url" {
  description = "Public URL of the operator console."
  value       = module.app.console_url
}

output "cluster_name" {
  description = "ECS cluster."
  value       = module.app.cluster_name
}

output "services" {
  description = "ECS service names (api)."
  value       = module.app.services
}

output "ecr_repositories" {
  description = "Image repositories (api)."
  value       = module.app.ecr_repositories
}

output "migrate_task_definition_arn" {
  description = "One-off migration task definition."
  value       = module.app.migrate_task_definition_arn
}

output "run_task" {
  description = "Parameters for the one-off tasks (scripts/aws-run-task.sh)."
  value       = module.app.run_task
}

output "sites" {
  description = "Buckets, distributions and API base URLs of the two single-page apps (scripts/aws-deploy.sh)."
  value       = module.app.sites
}

output "storage_bucket" {
  description = "The CRM file bucket (AWS_S3_BUCKET)."
  value       = module.app.storage_bucket
}

output "redis_endpoint" {
  description = "Redis primary endpoint."
  value       = module.app.redis_endpoint
}

output "mail_configuration_set" {
  description = "SES configuration set."
  value       = module.app.mail_configuration_set
}

output "mail_from" {
  description = "AWS_SES_FROM_EMAIL."
  value       = module.app.mail_from
}

output "ses_queues" {
  description = "SES topic and queue settings of the API."
  value       = module.app.ses_queues
}

output "load_balancer_dns_name" {
  description = "Origin of /api/* behind CloudFront."
  value       = module.app.load_balancer_dns_name
}

output "certificate_validation_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.app.certificate_validation_records
}

output "cdn_dns_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.app.cdn_dns_records
}

output "mail_dns_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.app.mail_dns_records
}

output "providers_secret_name" {
  description = "Secret holding the platform provider keys (null when none was passed)."
  value       = module.app.providers_secret_name
}
