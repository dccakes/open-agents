import { checkBotId } from "botid/server";
import { resolveBotIdAllowedHosts } from "@/lib/botid-allowed-hosts";

/**
 * Shared Vercel BotID server-side configuration.
 *
 * `extraAllowedHosts` tells BotID which frontend origins are permitted to
 * call the protected endpoints — Vercel preview / sandbox URLs plus any host
 * this deployment declares via `BOTID_EXTRA_ALLOWED_HOSTS`.
 */
export const botIdConfig = {
  advancedOptions: {
    extraAllowedHosts: resolveBotIdAllowedHosts(),
  },
};

export async function checkBotProtection() {
  if (process.env.NODE_ENV !== "production") {
    return {
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: true,
    };
  }

  return checkBotId(botIdConfig);
}
