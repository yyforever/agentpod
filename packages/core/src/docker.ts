import Docker from 'dockerode'
import type { ContainerSpec, Pod } from '@agentpod/shared'

function secondsToNanos(seconds: number): number {
  return seconds * 1_000_000_000
}

function buildTraefikLabels(
  pod: Pod,
  networkName: string,
  primaryPort: number,
  domain: string,
): Record<string, string> {
  return {
    'traefik.enable': 'true',
    'traefik.docker.network': networkName,
    [`traefik.http.routers.${pod.id}.rule`]: `Host(\`${pod.subdomain}.${domain}\`)`,
    [`traefik.http.routers.${pod.id}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${pod.id}.tls.certresolver`]: 'letsencrypt',
    [`traefik.http.services.${pod.id}.loadbalancer.server.port`]: String(primaryPort),
  }
}

export class DockerClient {
  private readonly docker: Docker

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker()
  }

  async createContainer(
    pod: Pod,
    containerSpec: ContainerSpec,
    options: { networkName: string; domain: string },
  ): Promise<Docker.Container> {
    const primaryPort =
      containerSpec.ports.find((port) => port.primary)?.container ??
      containerSpec.ports[0]?.container

    if (!primaryPort) {
      throw new Error(`No container port defined for pod ${pod.id}`)
    }

    const labels: Record<string, string> = {
      'agentpod.managed': 'true',
      'agentpod.pod-id': pod.id,
      'agentpod.adapter': pod.adapter_id,
      ...buildTraefikLabels(pod, options.networkName, primaryPort, options.domain),
    }

    const env = Object.entries(containerSpec.environment).map(
      ([key, value]) => `${key}=${value}`,
    )

    const exposedPorts = Object.fromEntries(
      containerSpec.ports.map((port) => [`${port.container}/${port.protocol}`, {}]),
    )

    const binds = containerSpec.volumes.map(
      (volume) => `${volume.source}:${volume.containerPath}`,
    )

    return this.docker.createContainer({
      Image: containerSpec.image,
      Cmd: containerSpec.command,
      Env: env,
      Labels: labels,
      User: containerSpec.user,
      ExposedPorts: exposedPorts,
      Healthcheck: {
        Test: containerSpec.healthCheck.command,
        Interval: secondsToNanos(containerSpec.healthCheck.intervalSeconds),
        Timeout: secondsToNanos(containerSpec.healthCheck.timeoutSeconds),
        Retries: containerSpec.healthCheck.retries,
        StartPeriod: secondsToNanos(containerSpec.healthCheck.startPeriodSeconds),
      },
      HostConfig: {
        Binds: binds,
        RestartPolicy: {
          Name: containerSpec.restartPolicy,
        },
        Memory: containerSpec.resources.memoryMb * 1024 * 1024,
        NanoCpus: Math.floor(containerSpec.resources.cpus * 1_000_000_000),
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [options.networkName]: {},
        },
      },
    })
  }

  async startContainer(id: string): Promise<void> {
    await this.docker.getContainer(id).start()
  }

  async stopContainer(id: string): Promise<void> {
    await this.docker.getContainer(id).stop()
  }

  async removeContainer(id: string): Promise<void> {
    await this.docker.getContainer(id).remove({ force: true })
  }

  async inspectContainer(id: string) {
    return this.docker.getContainer(id).inspect()
  }

  async getContainerLogs(
    id: string,
    options?: { tail?: number; stdout?: boolean; stderr?: boolean },
  ): Promise<string> {
    const logs = await this.docker.getContainer(id).logs({
      stdout: options?.stdout ?? true,
      stderr: options?.stderr ?? true,
      tail: options?.tail ?? 100,
    })

    return Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs)
  }

  async getContainerByPodId(podId: string) {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['agentpod.managed=true', `agentpod.pod-id=${podId}`],
      },
    })

    return containers[0] ?? null
  }
}
