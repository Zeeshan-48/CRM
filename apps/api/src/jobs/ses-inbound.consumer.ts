import { sesClientOptions } from "../utils/aws";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import config from "../config";
import emailInboundService from "../services/email-inbound.service";
import logger from "../utils/logger";

let running = false;
let sqs: SQSClient | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Long-polls the inbound-email SQS queue (SES receipt rule -> SNS -> SQS) and
// ingests each received email into the unified inbox. Idle without a queue URL.
// Runs on the single jobs worker.
export const startInboundConsumer = (): void => {
  if (!config.SES_INBOUND_QUEUE_URL) {
    logger.info("Email inbound consumer idle (SES_INBOUND_QUEUE_URL unset)");
    return;
  }
  sqs = new SQSClient(sesClientOptions(config.SES_INBOUND_REGION));
  running = true;
  logger.info("Email inbound consumer started");
  void loop();
};

export const stopInboundConsumer = (): void => {
  running = false;
};

async function loop(): Promise<void> {
  const queueUrl = config.SES_INBOUND_QUEUE_URL;
  while (running && sqs) {
    try {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
        })
      );
      for (const m of res.Messages ?? []) {
        try {
          await emailInboundService.processRaw(m.Body ?? "{}");
          await sqs.send(
            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle })
          );
        } catch (err) {
          logger.warn(`email inbound processing failed (left for DLQ): ${String(err)}`);
        }
      }
    } catch (err) {
      if (running) {
        logger.warn(`inbound SQS receive failed: ${String(err)}`);
        await sleep(2000);
      }
    }
  }
}
