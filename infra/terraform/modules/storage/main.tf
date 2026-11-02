# The bucket for CRM files (AWS_S3_BUCKET): lead documents, attachments, call
# recordings, imports and exports. Private, encrypted with the deployment key,
# versioned, TLS only, every form of public access blocked. The API reads and writes
# it with its task role and hands browsers short-lived presigned URLs, so the bucket
# carries a CORS rule for the app origins and nothing else.
resource "aws_s3_bucket" "this" {
  #checkov:skip=CKV_AWS_18:Server access logging needs a log bucket the operator chooses; CloudTrail data events are the alternative.
  #checkov:skip=CKV_AWS_144:Cross-region replication is a disaster-recovery decision per deployment (versioning is on).
  #checkov:skip=CKV2_AWS_62:Nothing consumes object events; the API records every upload itself.
  bucket        = var.bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "housekeeping"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_cors_configuration" "this" {
  count  = length(var.cors_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.this.id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "tls_only" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
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

resource "aws_s3_bucket_policy" "this" {
  count      = var.enforce_tls ? 1 : 0
  bucket     = aws_s3_bucket.this.id
  policy     = data.aws_iam_policy_document.tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.this]
}

# What the API needs on the bucket, for its task role.
data "aws_iam_policy_document" "access" {
  statement {
    sid       = "Objects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
  }
  statement {
    sid       = "List"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.this.arn]
  }
  statement {
    sid       = "ObjectKey"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [var.kms_key_arn]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["s3.*.amazonaws.com"]
    }
  }
}
