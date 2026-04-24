import {
  defaultRegistry,
  type SandboxCapabilities,
  type SandboxProviderType,
} from "@open-agents/sandbox";
import { getServerSession } from "@/lib/session/get-server-session";

export interface SandboxProviderAvailability {
  type: SandboxProviderType;
  label: string;
  beta: boolean;
  capabilities: SandboxCapabilities;
  available: boolean;
  reasonUnavailable?: string;
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const providers: SandboxProviderAvailability[] = defaultRegistry
    .list()
    .map((provider) => ({
      type: provider.type,
      label: provider.label,
      beta: provider.beta ?? false,
      capabilities: provider.capabilities,
      available: provider.isAvailable(),
      reasonUnavailable: provider.reasonUnavailable(),
    }));

  return Response.json({ providers });
}
