# sandbox-provider-docker Specification

## Purpose

Register Docker as a non-persistent local sandbox provider that exposes localhost-reachable service URLs.

## Requirements

### Requirement: Docker provider implements sandbox runtime contract
The Docker provider SHALL implement the shared sandbox runtime contract for command execution, file operations, lifecycle operations, and preview URL resolution.

#### Scenario: Execute command in Docker sandbox
- **WHEN** a sandbox session is created with provider `docker` and a command is executed
- **THEN** the command runs inside the Docker container and returns stdout/stderr/exit status

### Requirement: Docker provider exposes localhost-reachable service URLs
The Docker provider SHALL map sandbox ports to host ports and return a reachable `localhost:<port>` URL for preview requests.

#### Scenario: Resolve mapped port URL
- **WHEN** code requests preview URL for port `3000` in a Docker sandbox with mapped ports
- **THEN** the provider returns the mapped localhost URL for that port

### Requirement: Docker provider scope is distinct from Docker Compose infrastructure
The system MUST treat Docker Compose support infrastructure as distinct from Docker sandbox provider runtime support.

#### Scenario: Compose stack present without Docker provider
- **WHEN** local Docker Compose dependencies are running but Docker provider runtime is not registered
- **THEN** provider selection does not expose `docker` as available

### Requirement: Docker provider is non-persistent
The Docker provider MUST declare `persistent=false` and close semantics MUST stop and clean up session containers.

#### Scenario: Close Docker session
- **WHEN** a Docker-backed session is terminated
- **THEN** the sandbox container is stopped and no reconnect path is offered for that container instance

### Requirement: Docker provider returns actionable startup errors
The Docker provider MUST fail session creation with actionable error messages when required local Docker dependencies are unavailable.

#### Scenario: Docker daemon unavailable
- **WHEN** a user creates a Docker-backed session while Docker Engine is unreachable
- **THEN** session creation fails with an error that identifies Docker availability as the cause
