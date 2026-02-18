import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { podConfigs, podEvents, pods, podStatus, tenants } from './db/schema.js';
import { CoreError } from './errors.js';
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
}
async function writeInitialFiles(dataDir, files) {
    for (const file of files) {
        const target = path.resolve(dataDir, file.path);
        const relative = path.relative(dataDir, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new CoreError('VALIDATION_ERROR', `initial file path escapes data dir: ${file.path}`, 400);
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, 'utf8');
    }
}
function toPod(row) {
    const now = new Date();
    return {
        ...row,
        desired_status: row.desired_status,
        actual_status: row.actual_status,
        created_at: row.created_at ?? now,
        updated_at: row.updated_at ?? now,
    };
}
function normalizeStatus(row) {
    if (!row) {
        return null;
    }
    const now = new Date();
    return {
        pod_id: row.pod_id,
        phase: row.phase,
        ready: row.ready ?? false,
        message: row.message ?? null,
        last_health_at: row.last_health_at ?? null,
        memory_mb: row.memory_mb ?? null,
        cpu_percent: row.cpu_percent ?? null,
        storage_mb: row.storage_mb ?? null,
        updated_at: row.updated_at ?? now,
    };
}
export class PodService {
    db;
    docker;
    adapters;
    platform;
    network;
    constructor(db, docker, adapters, platform) {
        this.db = db;
        this.docker = docker;
        this.adapters = adapters;
        this.platform = platform;
        this.network = platform.network ?? process.env.AGENTPOD_NETWORK ?? 'agentpod-net';
    }
    async generateSubdomain(name) {
        const base = slugify(name) || 'pod';
        for (let i = 0; i < 10; i += 1) {
            const suffix = randomBytes(3).toString('hex');
            const candidate = `${base}-${suffix}`;
            const [existing] = await this.db
                .select({ id: pods.id })
                .from(pods)
                .where(eq(pods.subdomain, candidate))
                .limit(1);
            if (!existing) {
                return candidate;
            }
        }
        return `${base}-${randomUUID().slice(0, 8)}`;
    }
    async create(input) {
        if (!input.tenantId || !input.name || !input.adapterId) {
            throw new CoreError('VALIDATION_ERROR', 'tenant_id, name, and adapter_id are required', 400);
        }
        const adapter = this.adapters.get(input.adapterId);
        if (!adapter) {
            throw new CoreError('VALIDATION_ERROR', `adapter not found: ${input.adapterId}`, 400);
        }
        const [tenant] = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.id, input.tenantId))
            .limit(1);
        if (!tenant) {
            throw new CoreError('NOT_FOUND', 'tenant not found', 404);
        }
        let config;
        try {
            config = adapter.configSchema.schema.parse({
                ...adapter.configSchema.defaults,
                ...(input.config ?? {}),
            });
        }
        catch (error) {
            if (error instanceof ZodError) {
                throw new CoreError('VALIDATION_ERROR', 'invalid config', 400, error.issues);
            }
            throw error;
        }
        const now = new Date();
        const id = randomUUID();
        const subdomain = await this.generateSubdomain(input.name);
        const gatewayToken = randomBytes(32).toString('hex');
        const dataDir = path.join(this.platform.dataDir, id);
        const pod = {
            id,
            tenant_id: input.tenantId,
            name: input.name,
            adapter_id: input.adapterId,
            subdomain,
            desired_status: 'running',
            actual_status: 'pending',
            container_id: null,
            gateway_token: gatewayToken,
            data_dir: dataDir,
            created_at: now,
            updated_at: now,
        };
        await mkdir(dataDir, { recursive: true });
        if (adapter.lifecycle.onBeforeCreate) {
            const result = await adapter.lifecycle.onBeforeCreate({
                pod,
                config,
                platform: {
                    domain: this.platform.domain,
                    dataDir,
                },
            });
            if (result.initialFiles && result.initialFiles.length > 0) {
                await writeInitialFiles(dataDir, result.initialFiles);
            }
        }
        await this.db.transaction(async (tx) => {
            await tx.insert(pods).values(pod);
            await tx.insert(podConfigs).values({
                pod_id: pod.id,
                config,
                updated_at: now,
            });
            await tx
                .insert(podStatus)
                .values({
                pod_id: pod.id,
                phase: 'pending',
                ready: false,
                message: 'Awaiting reconciler',
                updated_at: now,
            })
                .onConflictDoUpdate({
                target: podStatus.pod_id,
                set: {
                    phase: 'pending',
                    ready: false,
                    message: 'Awaiting reconciler',
                    updated_at: now,
                },
            });
            await tx.insert(podEvents).values({
                pod_id: pod.id,
                event_type: 'created',
                message: 'Pod created',
                created_at: now,
            });
        });
        return pod;
    }
    async list(tenantId) {
        const query = this.db
            .select({
            pod: pods,
            status: podStatus,
        })
            .from(pods)
            .leftJoin(podStatus, eq(podStatus.pod_id, pods.id));
        const rows = tenantId
            ? await query.where(eq(pods.tenant_id, tenantId))
            : await query;
        return rows.map((row) => ({
            ...toPod(row.pod),
            status: normalizeStatus(row.status),
        }));
    }
    async getById(id) {
        const [row] = await this.db
            .select({
            pod: pods,
            status: podStatus,
            config: podConfigs,
        })
            .from(pods)
            .leftJoin(podStatus, eq(podStatus.pod_id, pods.id))
            .leftJoin(podConfigs, eq(podConfigs.pod_id, pods.id))
            .where(eq(pods.id, id))
            .limit(1);
        if (!row) {
            throw new CoreError('NOT_FOUND', 'pod not found', 404);
        }
        return {
            ...toPod(row.pod),
            status: normalizeStatus(row.status),
            config: row.config?.config ?? null,
        };
    }
    async start(id) {
        await this.setDesiredStatus(id, 'running');
    }
    async stop(id) {
        await this.setDesiredStatus(id, 'stopped');
    }
    async delete(id) {
        await this.setDesiredStatus(id, 'deleted');
    }
    async setDesiredStatus(id, status) {
        const [updated] = await this.db
            .update(pods)
            .set({ desired_status: status, updated_at: new Date() })
            .where(eq(pods.id, id))
            .returning({ id: pods.id });
        if (!updated) {
            throw new CoreError('NOT_FOUND', 'pod not found', 404);
        }
        await this.db.insert(podEvents).values({
            pod_id: id,
            event_type: status === 'running' ? 'started' : status === 'stopped' ? 'stopped' : 'deleted',
            message: status === 'running'
                ? 'Pod requested to start'
                : status === 'stopped'
                    ? 'Pod requested to stop'
                    : 'Pod requested to delete',
            created_at: new Date(),
        });
    }
    getRuntimeContext() {
        return {
            network: this.network,
            domain: this.platform.domain,
        };
    }
    getDockerClient() {
        return this.docker;
    }
    getAdapterRegistry() {
        return this.adapters;
    }
}
//# sourceMappingURL=pod.js.map