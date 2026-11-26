import { Queue } from "bullmq";
import logger from "../utils/logger";
import { createQueueConnection, isQueueEnabled } from "./connection";

export const WORKFLOW_DELIVERY_QUEUE_NAME = "crm-workflow-delivery";

export interface WorkflowEmailJobData {
  kind: "email";
  tenantId: string;
  leadId: string | null;
  contactId: string | null;
  targetName: string;
  company: string;
  templateName: string;
}

export interface WorkflowWhatsappJobData {
  kind: "whatsapp";
  tenantId: string;
  leadId: string | null;
  contactId: string | null;
  targetName: string;
  templateKey: string;
}

export type WorkflowDeliveryJobData = WorkflowEmailJobData | WorkflowWhatsappJobData;

let queue: Queue | null = null;

export const getWorkflowDeliveryQueue = (): Queue => {
  if (!queue) {
    queue = new Queue(WORKFLOW_DELIVERY_QUEUE_NAME, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: true,
        removeOnFail: 200,
      },
    });
  }
  return queue;
};

export const enqueueWorkflowDelivery = async (
  data: WorkflowDeliveryJobData
): Promise<boolean> => {
  if (!isQueueEnabled()) return false;
  try {
    await getWorkflowDeliveryQueue().add(`workflow-${data.kind}`, data);
    return true;
  } catch (err) {
    logger.warn(`[workflow-delivery-queue] enqueue failed (${data.kind}): ${String(err)}`);
    return false;
  }
};

export const closeWorkflowDeliveryQueue = async (): Promise<void> => {
  if (queue) {
    await queue.close();
    queue = null;
  }
};
