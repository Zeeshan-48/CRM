import config from "../config";

/**
 * Client options shared by the SES and SQS clients. Static keys are used when
 * AWS_SES_ACCESS_KEY / AWS_SES_SECRET_KEY are set; otherwise the SDK's default
 * credential chain applies (the ECS task role in production). AWS_ENDPOINT_URL
 * points every client at a local emulator.
 */
export const sesClientOptions = (region: string) => ({
  region,
  ...(config.AWS_SES_ACCESS_KEY && config.AWS_SES_SECRET_KEY
    ? {
        credentials: {
          accessKeyId: config.AWS_SES_ACCESS_KEY,
          secretAccessKey: config.AWS_SES_SECRET_KEY,
        },
      }
    : {}),
  ...(config.AWS_ENDPOINT_URL ? { endpoint: config.AWS_ENDPOINT_URL } : {}),
});

/** SES is in use once a platform sender is configured. */
export const sesConfigured = (): boolean => Boolean(config.AWS_SES_FROM_EMAIL);
