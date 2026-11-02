# PostgreSQL 16 for the CRM. The API connects with the PG_DATABASE_* variables, so the
# password is a plain environment variable injected by ECS from Secrets Manager. It is
# generated here (not an RDS-managed master secret): RDS rotates its managed secret
# every 7 days, and a running task that read the old value at start would then fail
# every new connection until it was restarted. Rotate this one deliberately: put a
# new value, apply, roll the service (see the comment on random_password.master).
resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.subnet_ids
}

# Ingress is added by the consumers (the ECS services and the migrate task)
# against this group, so access is granted per security group, never by CIDR.
resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "PostgreSQL; ingress only from application security groups"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-db" }
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name_prefix}-pg"
  family = "postgres${split(".", var.engine_version)[0]}"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }
}

data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count              = var.monitoring_interval > 0 ? 1 : 0
  name               = "${var.name_prefix}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  #checkov:skip=CKV_AWS_157:Multi-AZ is an input (aws-prod enables it; aws-dev trades it for cost).
  #checkov:skip=CKV_AWS_293:Deletion protection is an input (aws-prod enables it).
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.database_name
  username = var.master_username
  password = random_password.master.result

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period    = var.backup_retention_days
  backup_window              = "03:00-04:00"
  maintenance_window         = "sun:04:30-sun:05:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
  deletion_protection        = var.deletion_protection
  skip_final_snapshot        = var.skip_final_snapshot
  final_snapshot_identifier  = var.skip_final_snapshot ? null : "${var.name_prefix}-db-final"

  iam_database_authentication_enabled = true
  monitoring_interval                 = var.monitoring_interval
  monitoring_role_arn                 = var.monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arn
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql"]
}

# 40 characters from [A-Za-z0-9]: no character RDS refuses (/, ", @, space) and nothing
# a connection string would need to escape. Rotate with
#   terraform apply -replace='module.app.module.database.random_password.master'
# then force a new deployment of the api service.
resource "random_password" "master" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "password" {
  #checkov:skip=CKV2_AWS_57:Rotation is a Terraform replace plus a service roll (see random_password.master); a rotation Lambda would change it under running tasks.
  name                    = "${var.name_prefix}/database"
  description             = "PG_DATABASE_PASSWORD for the api and migrate tasks"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "password" {
  secret_id     = aws_secretsmanager_secret.password.id
  secret_string = jsonencode({ PG_DATABASE_PASSWORD = random_password.master.result })
}
