output "app_secret_arn" {
  description = "ARN of the <prefix>/app secret (JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY)."
  value       = aws_secretsmanager_secret.app.arn
}

output "providers_secret_name" {
  description = "Name of the <prefix>/providers secret, or null when no provider key was passed."
  value       = try(aws_secretsmanager_secret.providers[0].name, null)
}

output "secret_refs" {
  description = "ECS container `secrets` entries (JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY and each provider key): [{ name, valueFrom }]."
  value       = local.refs
}
