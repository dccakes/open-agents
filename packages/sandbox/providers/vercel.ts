import type { SandboxProviderDef } from "../provider";
import { defaultRegistry } from "../registry";
import { connectVercel } from "../vercel/connect";
import type { VercelState } from "../vercel/state";

export const vercelProvider: SandboxProviderDef<VercelState> = {
  type: "vercel",
  label: "Vercel",
  capabilities: {
    persistent: true,
    db: true,
    envInjection: true,
    credentialBrokering: true,
  },
  isAvailable: () => true,
  reasonUnavailable: () => undefined,
  create: (state, options) => connectVercel(state, options),
  connect: (state, options) => connectVercel(state, options),
};

defaultRegistry.register(vercelProvider);
