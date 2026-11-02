output "address" {
  description = "DB hostname."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "DB port."
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Database name."
  value       = aws_db_instance.this.db_name
}

output "instance_identifier" {
  description = "RDS instance identifier (CloudWatch dimension)."
  value       = aws_db_instance.this.identifier
}

output "password_secret_arn" {
  description = "Secrets Manager secret holding PG_DATABASE_PASSWORD."
  value       = aws_secretsmanager_secret.password.arn
}

output "secret_refs" {
  description = "ECS container `secrets` entry for PG_DATABASE_PASSWORD."
  value       = [{ name = "PG_DATABASE_PASSWORD", valueFrom = "${aws_secretsmanager_secret.password.arn}:PG_DATABASE_PASSWORD::" }]
}

output "security_group_id" {
  description = "DB security group; consumers add ingress rules against it."
  value       = aws_security_group.db.id
}

output "master_username" {
  description = "Master username (PG_DATABASE_USER)."
  value       = aws_db_instance.this.username
}
