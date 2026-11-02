output "app_url" {
  description = "Public URL of the CRM workspace app."
  value       = local.app_url
}

output "console_url" {
  description = "Public URL of the operator console."
  value       = local.console_url
}

output "cluster_name" {
  description = "ECS cluster."
  value       = aws_ecs_cluster.this.name
}

output "services" {
  description = "ECS service names."
  value       = { api = module.api.service_name }
}

output "ecr_repositories" {
  description = "Image repositories (api: the service and the migrate task)."
  value       = module.ecr.repository_urls
}

output "migrate_task_definition_arn" {
  description = "Task definition of the one-off migration task."
  value       = module.migrate.task_definition_arn
}

output "run_task" {
  description = "Everything `aws ecs run-task` needs for the one-off tasks (scripts/aws-run-task.sh)."
  value = {
    cluster = aws_ecs_cluster.this.name
    subnets = module.network.private_subnet_ids
    tasks = {
      migrate = { task_definition = module.migrate.task_definition_family, container = "migrate", security_groups = [module.migrate.security_group_id] }
    }
  }
}

output "sites" {
  description = "Per single-page app: its bucket, CloudFront distribution, URL and the VITE_API_BASE_URL it is built with (scripts/aws-deploy.sh)."
  value = {
    for k, s in local.sites : k => {
      url             = s.url
      api_base_url    = s.api_base_url
      bucket          = module.cdn[k].bucket_name
      distribution_id = module.cdn[k].distribution_id
      cdn_domain_name = module.cdn[k].domain_name
    }
  }
}

output "storage_bucket" {
  description = "AWS_S3_BUCKET: the CRM file bucket."
  value       = module.storage.bucket_name
}

output "redis_endpoint" {
  description = "Redis primary endpoint (the full REDIS_URL is in Secrets Manager)."
  value       = "${module.cache.primary_endpoint}:${module.cache.port}"
}

output "mail_configuration_set" {
  description = "SES configuration set of the platform identity."
  value       = module.email.configuration_set
}

output "mail_from" {
  description = "AWS_SES_FROM_EMAIL."
  value       = module.email.from_address
}

output "ses_queues" {
  description = "SES_EVENTS_SNS_TOPIC_ARN, SES_EVENTS_QUEUE_URL and SES_INBOUND_QUEUE_URL as configured on the API."
  value = {
    SES_EVENTS_SNS_TOPIC_ARN = module.email.events_topic_arn
    SES_EVENTS_QUEUE_URL     = module.email.events_queue_url
    SES_INBOUND_QUEUE_URL    = module.email.inbound_queue_url
  }
}

output "load_balancer_dns_name" {
  description = "Load balancer DNS name (the origin of /api/*; not a public entry point)."
  value       = module.edge.dns_name
}

output "certificate_validation_records" {
  description = "Load balancer certificate records to publish by hand when the zone is not in Route53."
  value       = module.edge.certificate_validation_records
}

output "cdn_dns_records" {
  description = "CNAME records to publish by hand when the zone is not in Route53."
  value       = [for k, s in local.sites : { type = "CNAME", name = s.host, value = module.cdn[k].domain_name }]
}

output "mail_dns_records" {
  description = "SES DKIM, MAIL FROM and inbound MX records to publish by hand when the zone is not in Route53."
  value       = module.email.dns_records
}

output "alarm_topic_arn" {
  description = "SNS topic receiving every alarm."
  value       = module.observability.alarm_topic_arn
}

output "providers_secret_name" {
  description = "Secrets Manager name holding the platform provider keys, or null when none was passed."
  value       = module.secrets.providers_secret_name
}
