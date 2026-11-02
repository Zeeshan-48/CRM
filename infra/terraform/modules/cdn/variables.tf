variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "name" {
  description = "Which app this distribution serves: web (the CRM workspace) or console (the operator console)."
  type        = string
}

variable "hostname" {
  description = "Public host of the app, e.g. \"crm.example.com\"."
  type        = string
}

variable "bucket_suffix" {
  description = "Suffix that makes the site bucket name globally unique (the account id)."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for the host. When set, the certificate is validated and the alias records are created automatically."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing ACM certificate in us-east-1 covering the host. Null requests a new one (validated automatically with route53_zone_id, otherwise publish the records from the outputs)."
  type        = string
  default     = null
}

variable "api_origin_domain_name" {
  description = "Load balancer DNS name, the origin of /api/*."
  type        = string
}

variable "origin_header_name" {
  description = "Name of the secret header CloudFront adds to every request to the load balancer."
  type        = string
  default     = "X-Origin-Verify"
}

variable "origin_header_value" {
  description = "Value of the secret origin header; the load balancer rule requires it."
  type        = string
  sensitive   = true
}

variable "web_acl_arn" {
  description = "WAF web ACL (CLOUDFRONT scope) to attach. Null attaches none."
  type        = string
  default     = null
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "origin_read_timeout" {
  description = "Seconds CloudFront waits for each packet from the load balancer (1-180). Above 60 needs a CloudFront quota increase first."
  type        = number
  default     = 60
  validation {
    condition     = var.origin_read_timeout >= 1 && var.origin_read_timeout <= 180
    error_message = "origin_read_timeout must be between 1 and 180."
  }
}
