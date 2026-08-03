import { getDeploymentConfig } from "@/lib/config/deployment";

export type OpenAgentsResourceProfile = "standard" | "hobby";

export function getOpenAgentsResourceProfile(): OpenAgentsResourceProfile {
  return getDeploymentConfig().resourceProfile;
}

export function isHobbyResourceProfile(): boolean {
  return getOpenAgentsResourceProfile() === "hobby";
}
