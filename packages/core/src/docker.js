import Docker from 'dockerode';
function secondsToNanos(seconds) {
    return seconds * 1_000_000_000;
}
function buildTraefikLabels(pod, networkName, primaryPort, domain) {
    return {
        'traefik.enable': 'true',
        'traefik.docker.network': networkName,
        [`traefik.http.routers.${pod.id}.rule`]: `Host(\`${pod.subdomain}.${domain}\`)`,
        [`traefik.http.routers.${pod.id}.entrypoints`]: 'websecure',
        [`traefik.http.routers.${pod.id}.tls.certresolver`]: 'letsencrypt',
        [`traefik.http.services.${pod.id}.loadbalancer.server.port`]: String(primaryPort),
    };
}
export class DockerClient {
    docker;
    constructor(docker) {
        this.docker = docker ?? new Docker();
    }
    async createContainer(pod, containerSpec, options) {
        const primaryPort = containerSpec.ports.find((port) => port.primary)?.container ??
            containerSpec.ports[0]?.container;
        if (!primaryPort) {
            throw new Error(`No container port defined for pod ${pod.id}`);
        }
        const labels = {
            'agentpod.managed': 'true',
            'agentpod.pod-id': pod.id,
            'agentpod.adapter': pod.adapter_id,
            ...buildTraefikLabels(pod, options.networkName, primaryPort, options.domain),
        };
        const env = Object.entries(containerSpec.environment).map(([key, value]) => `${key}=${value}`);
        const exposedPorts = Object.fromEntries(containerSpec.ports.map((port) => [`${port.container}/${port.protocol}`, {}]));
        const binds = containerSpec.volumes.map((volume) => `${volume.source}:${volume.containerPath}`);
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
        });
    }
    async startContainer(id) {
        await this.docker.getContainer(id).start();
    }
    async stopContainer(id) {
        await this.docker.getContainer(id).stop();
    }
    async removeContainer(id) {
        await this.docker.getContainer(id).remove({ force: true });
    }
    async inspectContainer(id) {
        return this.docker.getContainer(id).inspect();
    }
    async getContainerLogs(id, options) {
        const logs = await this.docker.getContainer(id).logs({
            stdout: options?.stdout ?? true,
            stderr: options?.stderr ?? true,
            tail: options?.tail ?? 100,
        });
        return Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs);
    }
    async getContainerByPodId(podId) {
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: ['agentpod.managed=true', `agentpod.pod-id=${podId}`],
            },
        });
        return containers[0] ?? null;
    }
}
//# sourceMappingURL=docker.js.map