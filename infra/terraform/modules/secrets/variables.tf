variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK that encrypts the secrets. Null uses the AWS-managed key."
  type        = string
  default     = null
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. 0 deletes immediately (local and throwaway environments)."
  type        = number
  default     = 30
}

variable "jwt_secret" {
  description = "JWT_SECRET (at least 32 characters). Null generates one. Set only when moving an existing installation."
  type        = string
  default     = null
  sensitive   = true
  validation {
    condition     = var.jwt_secret == null || try(length(var.jwt_secret) >= 32, false)
    error_message = "jwt_secret must be at least 32 characters."
  }
}

variable "credentials_encryption_key" {
  description = "CREDENTIALS_ENCRYPTION_KEY (at least 32 characters). Null generates one. Pass it only when moving an existing installation, or the stored tenant credentials cannot be decrypted."
  type        = string
  default     = null
  sensitive   = true
  validation {
    condition     = var.credentials_encryption_key == null || try(length(var.credentials_encryption_key) >= 32, false)
    error_message = "credentials_encryption_key must be at least 32 characters."
  }
}

variable "provider_secrets" {
  description = "Platform provider keys to inject into the API, by environment variable name (e.g. OPENAI_API_KEY, TWILIO_AUTH_TOKEN). Only the keys present are injected; every other provider stays simulated. Values land in Terraform state: pass placeholders and replace them by hand to avoid that."
  type        = map(string)
  default     = {}
  sensitive   = true
  validation {
    condition = alltrue([for k in keys(var.provider_secrets) : contains([
      "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
      "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_KEY", "META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "WA_FORWARD_SECRET",
      "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_DEFAULT_FROM_NUMBER",
      "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
      "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
      "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
      "AWS_SES_ACCESS_KEY", "AWS_SES_SECRET_KEY", "AWS_S3_ACCESS_KEY", "AWS_S3_SECRET_KEY",
    ], k)])
    error_message = "provider_secrets keys must be provider environment variables the API reads (see infra/terraform/modules/secrets/variables.tf for the list)."
  }
}
