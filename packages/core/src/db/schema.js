import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp, } from 'drizzle-orm/pg-core';
export const tenants = pgTable('tenants', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export const pods = pgTable('pods', {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
        .notNull()
        .references(() => tenants.id),
    name: text('name').notNull(),
    adapter_id: text('adapter_id').notNull(),
    subdomain: text('subdomain').notNull().unique(),
    desired_status: text('desired_status').notNull().default('running'),
    actual_status: text('actual_status').notNull().default('pending'),
    container_id: text('container_id'),
    gateway_token: text('gateway_token').notNull(),
    data_dir: text('data_dir').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export const podConfigs = pgTable('pod_configs', {
    pod_id: text('pod_id')
        .primaryKey()
        .references(() => pods.id),
    config: jsonb('config').$type().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export const podStatus = pgTable('pod_status', {
    pod_id: text('pod_id')
        .primaryKey()
        .references(() => pods.id),
    phase: text('phase').notNull(),
    ready: boolean('ready').default(false),
    message: text('message'),
    last_health_at: timestamp('last_health_at', { withTimezone: true }),
    memory_mb: integer('memory_mb'),
    cpu_percent: real('cpu_percent'),
    storage_mb: integer('storage_mb'),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
export const podEvents = pgTable('pod_events', {
    id: serial('id').primaryKey(),
    pod_id: text('pod_id').references(() => pods.id),
    event_type: text('event_type').notNull(),
    message: text('message'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
//# sourceMappingURL=schema.js.map