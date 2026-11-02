output "distribution_id" {
  description = "CloudFront distribution id (for invalidations)."
  value       = aws_cloudfront_distribution.this.id
}

output "domain_name" {
  description = "CloudFront domain name (CNAME target when the zone is not in Route53)."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "bucket_name" {
  description = "Bucket the built app is uploaded to."
  value       = aws_s3_bucket.site.id
}

output "certificate_validation_records" {
  description = "Records to publish by hand when the zone is not in Route53 and no certificate_arn was given."
  value = local.own_cert && !local.manage_dns ? [
    for o in aws_acm_certificate.this[0].domain_validation_options : { name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value }
  ] : []
}
