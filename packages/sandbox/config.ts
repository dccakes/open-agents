/**
 * The one place `@open-agents/sandbox` reads the environment.
 *
 * Providers take explicit options; this module only supplies the env-driven
 * defaults for callers that want them, so a host application can construct
 * providers with its own configuration instead. `scripts/check-env-boundary.ts`
 * keeps `process.env` out of the rest of the package.
 */

export interface DockerProviderConfig {
  /** Image used for new Docker sandboxes; `undefined` falls back to the built-in default. */
  sandboxImage?: string;
  /** The Docker provider is local-development only. */
  isDevelopment: boolean;
}

export interface DaytonaProviderConfig {
  /** Daytona is beta-gated behind `DAYTONA_BETA_ENABLED`. */
  betaEnabled: boolean;
  apiKey?: string;
  serverUrl?: string;
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}

export function getDockerProviderConfig(): DockerProviderConfig {
  return {
    sandboxImage: readEnv("DOCKER_SANDBOX_IMAGE"),
    isDevelopment: readEnv("NODE_ENV") === "development",
  };
}

export function getDaytonaProviderConfig(): DaytonaProviderConfig {
  const betaFlag = readEnv("DAYTONA_BETA_ENABLED");

  return {
    betaEnabled: betaFlag === "true" || betaFlag === "1",
    apiKey: readEnv("DAYTONA_API_KEY"),
    serverUrl: readEnv("DAYTONA_SERVER_URL"),
  };
}
