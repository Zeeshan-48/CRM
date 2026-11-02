output "kms_key_alias" {
  description = "Alias of the key that encrypts the secrets, the bucket and the topics."
  value       = module.kms.alias_name
}

output "app_secret_arn" {
  description = "The emulated app secret (JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY); compose uses deploy/compose/.env instead."
  value       = module.secrets.app_secret_arn
}

output "storage_bucket" {
  description = "The emulated CRM file bucket."
  value       = module.storage.bucket_name
}

output "mail_from" {
  description = "AWS_SES_FROM_EMAIL registered in the emulator's SES."
  value       = module.email.from_address
}

output "mail_configuration_set" {
  description = "SES configuration set of the platform identity."
  value       = module.email.configuration_set
}

output "ses_events_topic_arn" {
  description = "SES_EVENTS_SNS_TOPIC_ARN for the local stack."
  value       = module.email.events_topic_arn
}

output "ses_events_queue_url" {
  description = "SES_EVENTS_QUEUE_URL for the local stack."
  value       = module.email.events_queue_url
}
