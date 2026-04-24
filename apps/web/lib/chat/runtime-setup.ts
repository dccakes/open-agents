import { discoverSkills } from "@open-agents/agent";
import { connectSandbox } from "@open-agents/sandbox";
import { getSessionById } from "@/lib/db/sessions";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { getSandboxSkillDirectories } from "@/lib/skills/directories";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
export { resolveChatModelSelection } from "@/lib/chat/model-selection";

type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;
type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

type ActiveSandboxState = NonNullable<SessionRecord["sandboxState"]>;

export type SessionRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionById>>
>;

async function loadGitHubTokenModule(): Promise<{
  getUserGitHubToken: (userId: string) => Promise<string | null>;
}> {
  return import("@/lib/github/token");
}

async function loadSessionSkills(
  sessionId: string,
  sandboxState: ActiveSandboxState,
  sandbox: ConnectedSandbox,
): Promise<DiscoveredSkills> {
  const cachedSkills = await getCachedSkills(sessionId, sandboxState);
  if (cachedSkills !== null) {
    return cachedSkills;
  }

  // Discover project-level skills from the sandbox working directory plus
  // global skills installed outside the repo working tree.
  // TODO: Optimize if this becomes a bottleneck (~20ms no skills, ~130ms with 5 skills)
  const skillDirs = await getSandboxSkillDirectories(sandbox);

  const discoveredSkills = await discoverSkills(sandbox, skillDirs);
  await setCachedSkills(sessionId, sandboxState, discoveredSkills);
  return discoveredSkills;
}

export async function createChatRuntime(params: {
  userId: string;
  sessionId: string;
  sessionRecord: SessionRecord;
}): Promise<{
  sandbox: ConnectedSandbox;
  skills: DiscoveredSkills;
}> {
  const { userId, sessionId, sessionRecord } = params;

  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    throw new Error("Sandbox state is required to create chat runtime");
  }

  const tokenModule = await loadGitHubTokenModule();
  const githubToken = await tokenModule.getUserGitHubToken(userId);

  const sandbox = await connectSandbox(sandboxState, {
    githubToken: githubToken ?? undefined,
    ports: DEFAULT_SANDBOX_PORTS,
  });

  const skills = await loadSessionSkills(sessionId, sandboxState, sandbox);

  return {
    sandbox,
    skills,
  };
}
