export interface DockerState {
  containerId?: string;
  portBindings?: Record<number, number>;
}
