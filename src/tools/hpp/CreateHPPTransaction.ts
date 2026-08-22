import {WorldpayAPI} from "@/api/worldpay";
import {MCPTool} from "@/tools/mcp-tool";
import {hppSchema} from "@/schemas/schemas";
import {z} from "zod";
import {logger} from "@/utils/logger";
import {MCPResponse, ToolCallResponse, ToolCallResponseError} from "@/utils/mcp-response";
import {CallToolResult} from "@modelcontextprotocol/sdk/types";

export class CreateHPPTransaction extends MCPTool {
  constructor(api: WorldpayAPI) {
    super(
      api,
      "create_hosted_payment",
      "Create Hosted Payment",
      "Create a hosted payment page link to send to customers",
      hppSchema.shape,
      {title: "Create Hosted Payment", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    );
  }

  async execute(args: z.infer<typeof hppSchema>): Promise<CallToolResult> {
    try {
      const response = await this.api.createHostedPayment(args);
      return new ToolCallResponse(MCPResponse.text(response));
    } catch (error) {
      logger.error(`Hosted error: ${(error as Error).message}`);
      return new ToolCallResponseError(MCPResponse.text(`Hosted Payment failed: ${(error as Error).message}`));
    }
  }
}
