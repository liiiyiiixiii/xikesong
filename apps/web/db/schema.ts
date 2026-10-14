import { sql } from "drizzle-orm";
import { uniqueIndex, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
// Legacy tables remain an archive. The scale system never reads or writes them.
export const store = sqliteTable("store", { id:text("id").primaryKey(), revision:integer("revision").notNull().default(0), payload:text("payload").notNull() });

// Secrets stay out of business snapshots, reports and browser responses.
export const modelCredentials = sqliteTable("model_credentials", { id:text("id").primaryKey(), ciphertext:text("ciphertext"), suffix:text("suffix"), disabled:integer("disabled").notNull().default(0), updatedAt:text("updated_at").notNull() });

// Forecasting records are separate from the operational snapshot.
export const preferenceCatalog = sqliteTable("preference_catalog", { id:text("id").primaryKey(), source:text("source").notNull(), payload:text("payload").notNull() });
export const preferenceDaily = sqliteTable("preference_daily", { id:text("id").primaryKey(), source:text("source").notNull(), date:text("date").notNull(), itemId:text("item_id").notNull(), payload:text("payload").notNull() });
export const preferenceSnapshots = sqliteTable("preference_snapshots", { id:text("id").primaryKey(), source:text("source").notNull(), date:text("date").notNull(), itemId:text("item_id").notNull(), payload:text("payload").notNull() });
export const preferenceModels = sqliteTable("preference_models", { id:text("id").primaryKey(), source:text("source").notNull(), payload:text("payload").notNull() });
export const preferenceForecasts = sqliteTable("preference_forecasts", { id:text("id").primaryKey(), source:text("source").notNull(), date:text("date").notNull(), payload:text("payload").notNull() });
export const preferencePlans = sqliteTable("preference_plans", { id:text("id").primaryKey(), source:text("source").notNull(), date:text("date").notNull(), payload:text("payload").notNull() });
export const preferenceExecutions = sqliteTable("preference_executions", { id:text("id").primaryKey(), source:text("source").notNull(), date:text("date").notNull(), payload:text("payload").notNull() });
export const preferenceJobs = sqliteTable("preference_jobs", { id:text("id").primaryKey(), source:text("source").notNull(), status:text("status").notNull(), lease:text("lease").notNull(), updatedAt:text("updated_at").notNull(), error:text("error") });
export const preferenceEvaluations = sqliteTable("preference_evaluations", { id:text("id").primaryKey(), source:text("source").notNull(), payload:text("payload").notNull() });
export const preferenceBatches = sqliteTable("preference_batches", { id:text("id").primaryKey(), source:text("source").notNull(), payload:text("payload").notNull() });

// Device telemetry is independent of legacy business snapshots.
export const scaleConfigs=sqliteTable("scale_configs",{source:text("source").notNull(),id:text("id").notNull(),payload:text("payload").notNull()},t=>[primaryKey({columns:[t.source,t.id]})]);
export const scaleLatest=sqliteTable("scale_latest",{source:text("source").notNull(),scaleId:text("scale_id").notNull(),revision:integer("revision").notNull().default(0),operationId:text("operation_id").notNull(),payload:text("payload").notNull()},t=>[primaryKey({columns:[t.source,t.scaleId]})]);
export const scaleSamples=sqliteTable("scale_samples",{id:text("id").primaryKey(),source:text("source").notNull(),scaleId:text("scale_id").notNull(),sampledAt:text("sampled_at").notNull(),receivedAt:text("received_at").notNull(),payload:text("payload").notNull()},t=>[index("scale_samples_retention").on(t.receivedAt)]);
export const scaleEvents=sqliteTable("scale_events",{id:text("id").primaryKey(),source:text("source").notNull(),scaleId:text("scale_id").notNull(),dishId:text("dish_id").notNull(),at:text("at").notNull(),receivedAt:text("received_at").notNull(),kind:text("kind").notNull(),payload:text("payload").notNull()},t=>[index("scale_events_source_at").on(t.source,t.at)]);
export const scaleMinutes=sqliteTable("scale_minutes",{source:text("source").notNull(),scaleId:text("scale_id").notNull(),dishId:text("dish_id").notNull(),minute:text("minute").notNull(),payload:text("payload").notNull()},t=>[primaryKey({columns:[t.source,t.scaleId,t.dishId,t.minute]}),index("scale_minutes_retention").on(t.minute),index("scale_minutes_source_minute").on(t.source,t.minute)]);
export const scaleCredentials=sqliteTable("scale_credentials",{source:text("source").primaryKey(),tokenHash:text("token_hash").notNull(),createdAt:text("created_at").notNull()});
export const scaleSettings=sqliteTable("scale_settings",{source:text("source").primaryKey(),payload:text("payload").notNull()});

// Weight-only models have a separate namespace and cannot reuse legacy models.
export const weightCatalog=sqliteTable("weight_catalog",{id:text("id").primaryKey(),source:text("source").notNull(),payload:text("payload").notNull()});
export const weightDaily=sqliteTable("weight_daily",{id:text("id").primaryKey(),source:text("source").notNull(),date:text("date").notNull(),itemId:text("item_id").notNull(),payload:text("payload").notNull()});
export const weightSnapshots=sqliteTable("weight_snapshots",{id:text("id").primaryKey(),source:text("source").notNull(),date:text("date").notNull(),itemId:text("item_id").notNull(),payload:text("payload").notNull()});
export const weightModels=sqliteTable("weight_models",{id:text("id").primaryKey(),source:text("source").notNull(),payload:text("payload").notNull()});
export const weightForecasts=sqliteTable("weight_forecasts",{id:text("id").primaryKey(),source:text("source").notNull(),date:text("date").notNull(),payload:text("payload").notNull()});
export const weightPlans=sqliteTable("weight_plans",{id:text("id").primaryKey(),source:text("source").notNull(),date:text("date").notNull(),payload:text("payload").notNull()});
export const weightExecutions=sqliteTable("weight_executions",{id:text("id").primaryKey(),source:text("source").notNull(),date:text("date").notNull(),payload:text("payload").notNull()});
export const weightEvaluations=sqliteTable("weight_evaluations",{id:text("id").primaryKey(),source:text("source").notNull(),payload:text("payload").notNull()});
export const weightJobs=sqliteTable("weight_jobs",{id:text("id").primaryKey(),source:text("source").notNull(),status:text("status").notNull(),lease:text("lease").notNull(),updatedAt:text("updated_at").notNull(),error:text("error")});

// Local historical replay maintenance and transactional import receipts.
export const historyControl=sqliteTable("history_control",{id:text("id").primaryKey(),payload:text("payload").notNull()});
export const historyBatches=sqliteTable("history_batches",{datasetId:text("dataset_id").notNull(),batchId:text("batch_id").notNull(),checksum:text("checksum").notNull(),dishKey:text("dish_key").notNull(),importedAt:text("imported_at").notNull(),payload:text("payload").notNull()},t=>[primaryKey({columns:[t.datasetId,t.batchId]}),uniqueIndex("history_batch_dish").on(t.datasetId,t.dishKey)]);

// Per-bowl display batches and durable feedback to the main analysis layer.
export const freshnessRules=sqliteTable('freshness_rules',{dishId:text('dish_id').primaryKey(),payload:text('payload').notNull()});
export const freshnessBatches=sqliteTable('freshness_batches',{id:text('id').primaryKey(),scaleId:text('scale_id').notNull(),dishId:text('dish_id').notNull(),status:text('status').notNull(),startedAt:text('started_at').notNull(),closedAt:text('closed_at'),payload:text('payload').notNull()},t=>[index('freshness_closed').on(t.closedAt),uniqueIndex('freshness_active_scale').on(t.scaleId).where(sql`${t.status} = 'active'`)]);
export const freshnessDecisions=sqliteTable('freshness_decisions',{id:text('id').primaryKey(),at:text('at').notNull(),payload:text('payload').notNull()});

// Immutable daily numerical portrait, with separately retriable AI interpretation.
export const portraitArchives=sqliteTable('portrait_archives',{id:text('id').primaryKey(),date:text('date').notNull(),source:text('source').notNull(),createdAt:text('created_at').notNull(),payload:text('payload').notNull(),analysis:text('analysis'),status:text('status').notNull(),error:text('error'),retryAt:text('retry_at').notNull(),lease:text('lease')},t=>[uniqueIndex('portrait_archives_source_date').on(t.source,t.date)]);
export const intelligenceReports=sqliteTable('intelligence_reports',{id:text('id').primaryKey(),payload:text('payload'),leaseUntil:text('lease_until').notNull()});
