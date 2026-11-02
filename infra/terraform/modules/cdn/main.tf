# One single-page app (the CRM workspace or the operator console) on its own host:
#
#   /api/*        the load balancer (the CRM API): never cached, every viewer header,
#                 cookie and query string forwarded, so calls from the app are
#                 same-origin and provider webhooks reach the API unchanged
#   /assets/*     Vite's content-hashed build output from the private S3 bucket, cached
#                 at the edge for up to a year
#   everything    the app from S3; a CloudFront Function rewrites client-side routes
#   else          (no file extension in the last path segment) to /index.html. Not a
#                 custom error response: that would also turn API 404s into the app.
#
# The bucket stays private: CloudFront reads it through Origin Access Control, and the
# bucket policy admits only this distribution. The Host header is forwarded to the load
# balancer so its host rule matches, and a secret origin header proves the request came
# through CloudFront. aws-deploy.sh uploads index.html with Cache-Control: no-cache and
# invalidates it after each release.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

locals {
  full_name   = "${var.name_prefix}-${var.name}"
  manage_dns  = var.route53_zone_id != null
  own_cert    = var.certificate_arn == null
  s3_origin   = "site"
  api_origin  = "api"
  bucket_name = "${local.full_name}-site-${var.bucket_suffix}"
}

# ─── Site bucket ─────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "site" {
  #checkov:skip=CKV_AWS_18:Server access logging needs a log bucket the operator chooses; CloudFront metrics are on.
  #checkov:skip=CKV_AWS_144:Build output is reproducible from git; cross-region replication adds nothing.
  #checkov:skip=CKV2_AWS_62:Nothing consumes object events on static build output.
  #checkov:skip=CKV_AWS_145:Public static build output, served to every visitor; SSE-S3 avoids a KMS grant for CloudFront.
  bucket        = local.bucket_name
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Versioned so a bad release can be rolled back object by object.
resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    id     = "old-releases"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.site]
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = local.full_name
  description                       = "${local.full_name} site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.site.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# ─── Certificate (us-east-1, as CloudFront requires) ────────────────────────

resource "aws_acm_certificate" "this" {
  count             = local.own_cert ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.hostname
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = local.own_cert && local.manage_dns ? {
    for o in aws_acm_certificate.this[0].domain_validation_options : o.domain_name => o
  } : {}
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = local.own_cert && local.manage_dns ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

locals {
  certificate_arn = local.own_cert ? (local.manage_dns ? aws_acm_certificate_validation.this[0].certificate_arn : aws_acm_certificate.this[0].arn) : var.certificate_arn
}

# ─── Distribution ────────────────────────────────────────────────────────────

resource "aws_cloudfront_function" "spa" {
  name    = "${local.full_name}-spa-routes"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for client-side routes"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      var last = uri.substring(uri.lastIndexOf("/") + 1);
      if (last.indexOf(".") === -1) {
        request.uri = "/index.html";
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_distribution" "this" {
  #checkov:skip=CKV_AWS_86:Access logging needs a log bucket the operator chooses; CloudWatch metrics are on.
  #checkov:skip=CKV_AWS_310:Origin failover needs a second copy of each origin; a single regional deployment has one.
  #checkov:skip=CKV_AWS_374:Geo restriction is a business decision per deployment.
  #checkov:skip=CKV2_AWS_47:Log4j protection comes from AWSManagedRulesKnownBadInputsRuleSet in the waf module when enable_waf is true.
  #checkov:skip=CKV2_AWS_32:The managed security-headers policy is attached to every behavior.
  #checkov:skip=CKV_AWS_68:The WAF web ACL is an input (web_acl_arn); aws-dev and aws-prod attach one.
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.full_name}: ${var.hostname}"
  aliases             = [var.hostname]
  price_class         = var.price_class
  web_acl_id          = var.web_acl_arn
  http_version        = "http2and3"
  default_root_object = "index.html"

  origin {
    origin_id                = local.s3_origin
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id   = local.api_origin
    domain_name = var.api_origin_domain_name
    # Proves to the load balancer that the request came through a distribution of this
    # deployment. CloudFront overwrites a viewer-supplied header of the same name.
    custom_header {
      name  = var.origin_header_name
      value = var.origin_header_value
    }
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = var.origin_read_timeout
      origin_keepalive_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id           = local.s3_origin
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = local.s3_origin
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.api_origin
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = local.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ─── DNS ─────────────────────────────────────────────────────────────────────

resource "aws_route53_record" "host" {
  for_each = local.manage_dns ? toset(["A", "AAAA"]) : toset([])
  zone_id  = var.route53_zone_id
  name     = var.hostname
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
