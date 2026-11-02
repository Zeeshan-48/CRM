output "web_acl_arn" {
  description = "Web ACL ARN, attached to each CloudFront distribution."
  value       = aws_wafv2_web_acl.this.arn
}
