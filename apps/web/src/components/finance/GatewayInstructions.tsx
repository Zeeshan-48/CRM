/**
 * The payment-gateway "how to connect" panel is the shared InstructionsPanel;
 * re-exported here under its original name so the gateway cards keep importing
 * from the finance folder.
 */
export { NavPath, InstructionsPanel as GatewayInstructions } from "@/components/common/InstructionsPanel";
