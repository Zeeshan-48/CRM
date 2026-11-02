// Deterministic test configuration. Runs before any test file imports
// src/config, so these values are what the app sees. Never real secrets.
process.env.TZ = "UTC";
process.env.NODE_ENV = "test";
process.env.RAZORPAY_WEBHOOK_SECRET ||= "test_razorpay_webhook_secret";
process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_test_stripe_webhook_secret";
process.env.META_APP_SECRET ||= "test_meta_app_secret";
process.env.META_WEBHOOK_VERIFY_TOKEN ||= "test_meta_verify_token";
process.env.AWS_SES_FROM_EMAIL ||= "noreply@example.com";
