import { sesClientOptions } from "../utils/aws";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import config from "../config";
import emailEventsService from "../services/email-events.service";
import logger from "../utils/logger";

let running = false;
let sqs: SQSClient | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Long-polls the SES events SQS queue and applies each event. A message is
// deleted only after it is processed; failures are left for SQS redrive to the
// DLQ (after maxReceiveCount). Runs on a single worker only.
export const startEventsConsumer = (): void => {
  if (!config.SES_EVENTS_QUEUE_URL) {
    logger.info("SES events consumer idle (SES_EVENTS_QUEUE_URL unset)");
    return;
  }
  sqs = new SQSClient(sesClientOptions(config.AWS_SES_REGION));
  running = true;
  logger.info("SES events consumer started");
  void loop();
};

export const stopEventsConsumer = (): void => {
  running = false;
};

async function loop(): Promise<void> {
  const queueUrl = config.SES_EVENTS_QUEUE_URL;
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
          await emailEventsService.processRaw(m.Body ?? "{}");
          await sqs.send(
            new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle })
          );
        } catch (err) {
          logger.warn(`SES event processing failed (left for DLQ): ${String(err)}`);
        }
      }
    } catch (err) {
      if (running) {
        logger.warn(`SQS receive failed: ${String(err)}`);
        await sleep(2000);
      }
    }
  }
}
