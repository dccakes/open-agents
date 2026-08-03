/**
 * Linear OAuth app and webhook secret.
 *
 * The three variables are a cohort: a deployment that configures the OAuth app
 * but omits the webhook secret turns `/api/linear/webhook` into a 500 at
 * request time, so the secret is production-required once the app is set up.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalRawString } from "@/lib/config/schemas";

export const linearEnv = defineEnvGroup({
  name: "linear",
  specs: {
    LINEAR_CLIENT_ID: {
      axis: "optional",
      description:
        "Linear OAuth client ID. Unset disables the Linear connection flow.",
      schema: optionalRawString,
    },
    LINEAR_CLIENT_SECRET: {
      axis: "optional",
      requiredWith: ["LINEAR_CLIENT_ID"],
      secret: true,
      description: "Linear OAuth client secret.",
      schema: optionalRawString,
    },
    LINEAR_WEBHOOK_SECRET: {
      axis: "optional",
      requiredWith: ["LINEAR_CLIENT_ID"],
      secret: true,
      description:
        "Shared secret for Linear webhook HMAC verification. Without it `/api/linear/webhook` answers 500.",
      schema: optionalRawString,
    },
  },
});

export interface LinearConfig {
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
}

export function getLinearConfig(): LinearConfig {
  const env = linearEnv.read();

  return {
    clientId: env.LINEAR_CLIENT_ID,
    clientSecret: env.LINEAR_CLIENT_SECRET,
    webhookSecret: env.LINEAR_WEBHOOK_SECRET,
  };
}
