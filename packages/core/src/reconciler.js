import { eq, inArray } from 'drizzle-orm';
import { podConfigs, podEvents, pods, podStatus } from './db/schema.js';
const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
function normalizePod(row) {
    const now = new Date();
    return {
        ...row,
        desired_status: row.desired_status,
        actual_status: row.actual_status,
        created_at: row.created_at ?? now,
        updated_at: row.updated_at ?? now,
    };
}
export class ReconcileService {
    db;
    docker;
    adapters;
    options;
    timer = null;
    constructor(db, docker, adapters, options) {
        this.db = db;
        this.docker = docker;
        this.adapters = adapters;
        this.options = options;
    }
    async reconcileOnce() {
        const rows = await this.db
            .select({
            pod: pods,
            config: podConfigs.config,
        })
            .from(pods)
            .leftJoin(podConfigs, eq(podConfigs.pod_id, pods.id))
            .where(inArray(pods.desired_status, ['running', 'stopped', 'deleted']));
        const result = {
            total: rows.length,
            success: 0,
            failed: 0,
            errors: [],
        };
        for (const row of rows) {
            try {
                await this.reconcilePod(row.pod, row.config ?? {});
                result.success += 1;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await this.writeActualStatus(row.pod.id, 'error', row.pod.container_id, message);
                await this.logEvent(row.pod.id, 'error', message);
                result.failed += 1;
                result.errors.push({ podId: row.pod.id, message });
            }
        }
        return result;
    }
    start(intervalMs = DEFAULT_RECONCILE_INTERVAL_MS) {
        if (this.timer) {
            return;
        }
        const run = async () => {
            try {
                await this.reconcileOnce();
            }
            catch (error) {
                console.error('Reconciler loop failed', error);
            }
        };
        void run();
        this.timer = setInterval(() => {
            void run();
        }, intervalMs);
    }
    stop() {
        if (!this.timer) {
            return;
        }
        clearInterval(this.timer);
        this.timer = null;
    }
    async logEvent(podId, eventType, message) {
        await this.db.insert(podEvents).values({
            pod_id: podId,
            event_type: eventType,
            message,
            created_at: new Date(),
        });
    }
    async writeActualStatus(podId, actualStatus, containerId, message) {
        const now = new Date();
        await this.db
            .update(pods)
            .set({
            actual_status: actualStatus,
            ...(containerId !== undefined ? { container_id: containerId } : {}),
            updated_at: now,
        })
            .where(eq(pods.id, podId));
        await this.db
            .insert(podStatus)
            .values({
            pod_id: podId,
            phase: actualStatus,
            ready: actualStatus === 'running',
            message: message ?? null,
            updated_at: now,
        })
            .onConflictDoUpdate({
            target: podStatus.pod_id,
            set: {
                phase: actualStatus,
                ready: actualStatus === 'running',
                message: message ?? null,
                updated_at: now,
            },
        });
    }
    async reconcilePod(podRow, config) {
        const pod = normalizePod(podRow);
        const adapter = this.adapters.get(pod.adapter_id);
        if (!adapter) {
            await this.writeActualStatus(pod.id, 'error', pod.container_id, 'Adapter not found');
            await this.logEvent(pod.id, 'error', `Adapter not found: ${pod.adapter_id}`);
            return;
        }
        const container = await this.docker.getContainerByPodId(pod.id);
        const hasContainer = container !== null;
        const containerId = container?.Id;
        if (pod.desired_status === 'running') {
            if (!hasContainer) {
                const spec = adapter.resolveContainerSpec(config, {
                    domain: this.options.domain,
                    dataDir: pod.data_dir,
                });
                const created = await this.docker.createContainer(pod, spec, {
                    networkName: this.options.network,
                    domain: this.options.domain,
                });
                await this.docker.startContainer(created.id);
                await this.writeActualStatus(pod.id, 'running', created.id);
                await this.logEvent(pod.id, 'created', `Container created: ${created.id}`);
                await this.logEvent(pod.id, 'started', 'Container started');
                return;
            }
            if (!containerId) {
                await this.writeActualStatus(pod.id, 'error', null, 'Container id missing');
                await this.logEvent(pod.id, 'error', 'Container id missing');
                return;
            }
            const inspect = await this.docker.inspectContainer(containerId);
            const dockerStatus = inspect.State?.Status;
            if (dockerStatus === 'running') {
                await this.writeActualStatus(pod.id, 'running', containerId);
                return;
            }
            await this.docker.startContainer(containerId);
            await this.writeActualStatus(pod.id, 'running', containerId);
            await this.logEvent(pod.id, dockerStatus === 'exited' ? 'restarted' : 'started', `Container transitioned from ${dockerStatus ?? 'unknown'} to running`);
            return;
        }
        if (pod.desired_status === 'stopped') {
            if (!hasContainer) {
                await this.writeActualStatus(pod.id, 'stopped', null);
                return;
            }
            if (!containerId) {
                await this.writeActualStatus(pod.id, 'error', null, 'Container id missing');
                await this.logEvent(pod.id, 'error', 'Container id missing');
                return;
            }
            const inspect = await this.docker.inspectContainer(containerId);
            const isRunning = inspect.State?.Running === true;
            if (isRunning) {
                await this.docker.stopContainer(containerId);
                await this.logEvent(pod.id, 'stopped', 'Container stopped by reconciler');
            }
            await this.writeActualStatus(pod.id, 'stopped', containerId);
            return;
        }
        if (pod.desired_status === 'deleted') {
            if (!hasContainer) {
                await this.writeActualStatus(pod.id, 'stopped', null);
                return;
            }
            if (!containerId) {
                await this.writeActualStatus(pod.id, 'error', null, 'Container id missing');
                await this.logEvent(pod.id, 'error', 'Container id missing');
                return;
            }
            if (adapter.lifecycle.onBeforeDelete) {
                await adapter.lifecycle.onBeforeDelete({
                    pod,
                    config,
                    platform: {
                        domain: this.options.domain,
                        dataDir: pod.data_dir,
                    },
                });
            }
            const inspect = await this.docker.inspectContainer(containerId);
            if (inspect.State?.Running) {
                await this.docker.stopContainer(containerId);
            }
            await this.docker.removeContainer(containerId);
            await this.writeActualStatus(pod.id, 'stopped', null);
            await this.logEvent(pod.id, 'deleted', 'Container removed by reconciler');
        }
    }
}
//# sourceMappingURL=reconciler.js.map