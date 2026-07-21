export interface DockerState {
  containerId?: string;
  /** Alias of containerId, used by shared resume-state utilities that look for sandboxId. */
  sandboxId?: string;
  portBindings?: Record<number, number>;
  /** Millisecond timestamp when this sandbox session should be considered stale. */
  expiresAt?: number;
}
