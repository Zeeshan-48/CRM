variable "endpoint" {
  description = "Emulator endpoint: http://localhost:4637 from the host, http://floci:4566 inside compose."
  type        = string
  default     = "http://localhost:4637"
}

variable "name_prefix" {
  description = "Must match the SES and SQS names in deploy/compose/compose.floci.yaml."
  type        = string
  default     = "open-crm-local"
}

variable "mail_domain" {
  description = "Sending domain registered in the emulator's SES (must match AWS_SES_FROM_EMAIL in deploy/compose/compose.floci.yaml)."
  type        = string
  default     = "crm.example.test"
}

variable "bucket_name" {
  description = "The CRM file bucket (CRM_S3_BUCKET in deploy/compose/compose.floci.yaml)."
  type        = string
  default     = "open-crm-local-files"
}

variable "app_origins" {
  description = "Browser origins of the local web app and console (CORS on the file bucket)."
  type        = list(string)
  default     = ["http://localhost:3570", "http://localhost:3580"]
}
