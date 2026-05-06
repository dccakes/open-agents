import "server-only";
import { randomBytes } from "crypto";
import { linearGraphQL } from "@/lib/linear/client";

const WEBHOOK_CREATE_MUTATION = `
  mutation WebhookCreate($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      success
      webhook {
        id
      }
    }
  }
`;

const WEBHOOK_DELETE_MUTATION = `
  mutation WebhookDelete($id: String!) {
    webhookDelete(id: $id) {
      success
    }
  }
`;

interface WebhookCreateResponse {
  webhookCreate: {
    success: boolean;
    webhook: {
      id: string;
    } | null;
  };
}

interface WebhookDeleteResponse {
  webhookDelete: {
    success: boolean;
  };
}

export async function registerLinearWebhook(
  token: string,
): Promise<{ webhookId: string; webhookSecret: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — cannot register Linear webhook",
    );
  }

  const webhookSecret = randomBytes(32).toString("hex");
  const webhookUrl = `${appUrl}/api/linear/webhook`;

  const execute = linearGraphQL(token);
  const result = await execute<WebhookCreateResponse>(WEBHOOK_CREATE_MUTATION, {
    input: {
      url: webhookUrl,
      resourceTypes: ["AgentSessionEvent"],
      allPublicTeams: true,
      secret: webhookSecret,
    },
  });

  if (!result?.webhookCreate?.success || !result?.webhookCreate?.webhook?.id) {
    throw new Error(
      "Linear webhook creation failed: success=false or webhook ID missing",
    );
  }

  return {
    webhookId: result.webhookCreate.webhook.id,
    webhookSecret,
  };
}

export async function deregisterLinearWebhook(
  token: string,
  webhookId: string,
): Promise<void> {
  try {
    const execute = linearGraphQL(token);
    await execute<WebhookDeleteResponse>(WEBHOOK_DELETE_MUTATION, {
      id: webhookId,
    });
  } catch (error) {
    console.error("Failed to deregister Linear webhook (non-critical):", error);
  }
}
