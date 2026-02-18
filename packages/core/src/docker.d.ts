import Docker from 'dockerode';
import type { ContainerSpec, Pod } from '@agentpod/shared';
export declare class DockerClient {
    private readonly docker;
    constructor(docker?: Docker);
    createContainer(pod: Pod, containerSpec: ContainerSpec, options: {
        networkName: string;
        domain: string;
    }): Promise<Docker.Container>;
    startContainer(id: string): Promise<void>;
    stopContainer(id: string): Promise<void>;
    removeContainer(id: string): Promise<void>;
    inspectContainer(id: string): Promise<Docker.ContainerInspectInfo>;
    getContainerLogs(id: string, options?: {
        tail?: number;
        stdout?: boolean;
        stderr?: boolean;
    }): Promise<string>;
    getContainerByPodId(podId: string): Promise<Docker.ContainerInfo | null>;
}
//# sourceMappingURL=docker.d.ts.map