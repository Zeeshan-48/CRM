// One-time, idempotent AWS setup for the per-tenant sending-domain (BYOSD)
// event pipeline:
//   SES (per-tenant config sets) -> SNS topic -> SQS queue (+ DLQ) -> consumer
//
// Terraform (infra/terraform/modules/email) creates the same resources; this
// script is for deployments that do not use the Terraform in this repo.
//
// Creates the SNS topic, the SQS queue and its dead-letter queue, subscribes
// the queue to the topic (raw message delivery), and attaches a queue policy
// allowing the topic to send. Prints SES_EVENTS_SNS_TOPIC_ARN and
// SES_EVENTS_QUEUE_URL to paste into .env. Safe to re-run.
import {
  CreateTopicCommand,
  SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import config from "../src/config";
import { sesClientOptions } from "../src/utils/aws";

const TOPIC_NAME = "crm-ses-events";
const QUEUE_NAME = "crm-ses-events";
const DLQ_NAME = "crm-ses-events-dlq";

// Static SES keys when set, else the default AWS credential chain.
const sns = new SNSClient(sesClientOptions(config.AWS_SES_REGION));
const sqs = new SQSClient(sesClientOptions(config.AWS_SES_REGION));

async function queueArn(url: string): Promise<string> {
  const res = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] })
  );
  return res.Attributes?.QueueArn ?? "";
}

async function main() {

  // Topic (CreateTopic is idempotent: returns the existing ARN).
  const topic = await sns.send(new CreateTopicCommand({ Name: TOPIC_NAME }));
  const topicArn = topic.TopicArn ?? "";
  console.log("SNS topic:", topicArn);

  // DLQ first, then main queue with a redrive policy pointing at it.
  const dlq = await sqs.send(new CreateQueueCommand({ QueueName: DLQ_NAME }));
  const dlqArn = await queueArn(dlq.QueueUrl ?? "");

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUE_NAME,
      Attributes: {
        MessageRetentionPeriod: "1209600", // 14 days
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
      },
    })
  );
  const queueUrl = queue.QueueUrl ?? "";
  const qArn = await queueArn(queueUrl);
  console.log("SQS queue:", queueUrl);
  console.log("SQS DLQ:", dlq.QueueUrl);

  // Allow the SNS topic to send messages to the queue.
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "sns.amazonaws.com" },
        Action: "sqs:SendMessage",
        Resource: qArn,
        Condition: { ArnEquals: { "aws:SourceArn": topicArn } },
      },
    ],
  };
  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: { Policy: JSON.stringify(policy) },
    })
  );

  // Subscribe the queue to the topic with raw message delivery so the consumer
  // receives the SNS payload body directly.
  await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "sqs",
      Endpoint: qArn,
      Attributes: { RawMessageDelivery: "true" },
      ReturnSubscriptionArn: true,
    })
  );

  console.log("\nPaste into .env:");
  console.log(`SES_EVENTS_SNS_TOPIC_ARN=${topicArn}`);
  console.log(`SES_EVENTS_QUEUE_URL=${queueUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
