import {readKitchenSettings} from './kitchen-settings.ts';
import { bindingConfigSchema, deviceViewSchema, credentialViewSchema } from '@zhishan/contracts/v2/configuration';
import type { EndpointContext, OperationsServices } from './router.ts';
import { credentialRecord, OperationsError, type CredentialRow } from './security.ts';
import { canonical, decode, mutate, operationsMeta, type DevicePayload, type BindingPayload, type Row } from './records.ts';
import type { OperationsStore, Write } from './storage.ts';

type ConfiguredDevice = DevicePayload & { version: number };
async function deviceView(store: OperationsStore, device: ConfiguredDevice) {
  const row = device.bindingId ? await store.get<Row<BindingPayload>>('bindings', device.bindingId) : null;
  const binding = row ? decode(row) : null;
  return deviceViewSchema.parse({ scaleId: device.id, name: device.name, enabled: device.enabled, positionOrder: device.positionOrder,
    version: device.version ?? 0, measurement: device.measurement ? { ...device.measurement, locationFreshMs: device.measurement.locationFreshMs ?? null } : null,
    binding: binding ? { ...bindingConfigSchema.parse({ dishId: binding.dishId, dishName: binding.dishName, containerRef: binding.containerRef,
      tareG: binding.tareG, fullFoodG: binding.fullFoodG, foodOnly: binding.foodOnly }), id: binding.id, version: binding.version,
      validFrom: binding.validFrom, validTo: binding.validTo, freshnessBatchId: binding.freshnessBatchId } : null,
    createdAt: device.createdAt, updatedAt: device.updatedAt });
}
function credentialView(row: CredentialRow) {
  const payload = JSON.parse(row.payload);
  return credentialViewSchema.parse({ id: row.id, role: row.role, actor: payload.actor, scaleIds: payload.scaleIds, trackIds: payload.trackIds ?? [],
    disabled: !!row.disabled, expiresAt: row.expires_at });
}
export function projectionJob(bindingId: string, revision: number, now: string): Write {
  return { type: 'upsert', table: 'jobs', values: { id: `project:${bindingId}`, scope: 'measurement', status: 'pending', desired_revision: revision,
    lease_until: null, attempts: 0, payload: JSON.stringify({ bindingId, requestedAt: now }) } };
}
async function saveDevice(c: EndpointContext<'saveDevice'>) {
  const { store, body, params, now } = c;
  if (params.id !== body.scaleId) throw new OperationsError('INVALID_REQUEST');
  return mutate(c, 'device.save', body.requestId, { params, body }, async revision => {
    const existing = await store.get<Row<ConfiguredDevice>>('devices', params.id), before = existing ? decode(existing) : null;
    if ((before?.version ?? 0) !== body.expectedVersion) throw new OperationsError('VERSION_CONFLICT', before?.version ?? 0);
    const oldBinding = before?.bindingId ? await store.get<Row<BindingPayload>>('bindings', before.bindingId) : null;
    let binding = oldBinding ? decode(oldBinding) : null;
    if (binding) {
      const config = { dishId: binding.dishId, dishName: binding.dishName, containerRef: binding.containerRef,
        tareG: binding.tareG, fullFoodG: binding.fullFoodG, foodOnly: binding.foodOnly };
      if (canonical(config) !== canonical(body.binding)) throw new OperationsError('INVALID_TRANSITION');
      if (canonical(before?.measurement) !== canonical(body.measurement)) throw new OperationsError('INVALID_TRANSITION');
    }
    const writes: Write[] = [];
    if (!binding && body.binding) {
      binding = { ...body.binding, id: crypto.randomUUID(), scaleId: body.scaleId, validFrom: now, validTo: null, version: 0, freshnessBatchId: null, measurement: body.measurement };
      writes.push({ type: 'insert', table: 'bindings', values: { id: binding.id, scale_id: binding.scaleId, dish_id: binding.dishId,
        valid_from: now, valid_to: null, version: binding.version, payload: JSON.stringify(binding) } });
    }
    const device: ConfiguredDevice = { id: body.scaleId, name: body.name, enabled: body.enabled, positionOrder: body.positionOrder,
      measurement: body.measurement, bindingId: binding?.id ?? null, version: body.expectedVersion + 1, createdAt: before?.createdAt ?? now, updatedAt: now,
      diagnostics: before?.diagnostics ?? { countsSince: now, accepted: 0, duplicate: 0, rejected: 0, lastCode: null, fault: null } };
    writes.push({ type: 'upsert', table: 'devices', values: { id: device.id, enabled: Number(device.enabled), updated_at: now, payload: JSON.stringify(device) } });
    if (binding) writes.push(projectionJob(binding.id, revision + 1, now));
    const view = { scaleId: device.id, name: device.name, enabled: device.enabled, positionOrder: device.positionOrder, version: device.version,
      measurement: device.measurement, binding: binding ? { ...body.binding!, id: binding.id, version: binding.version,
        validFrom: binding.validFrom, validTo: binding.validTo, freshnessBatchId: binding.freshnessBatchId } : null, createdAt: device.createdAt, updatedAt: now };
    return { writes, response: { ...operationsMeta(store, now, revision + 1), device: deviceViewSchema.parse(view) } };
  });
}
async function issueCredential(c: EndpointContext<'issueCredential'>) {
  const { store, body, now } = c;
  if (body.expiresAt && Date.parse(body.expiresAt) <= Date.parse(now)) throw new OperationsError('INVALID_REQUEST');
  const record = await credentialRecord(body);
  return mutate(c, 'credential.issue', body.requestId, { ...body, token: record.token_hash }, async revision => {
    if (await store.get('credentials', body.id)) throw new OperationsError('ID_CONFLICT');
    for (const scaleId of body.scaleIds ?? []) if (!await store.get('devices', scaleId)) throw new OperationsError('NOT_FOUND');
    const tracks=(await readKitchenSettings(store)).config.tracks;
    for(const trackId of body.trackIds)if(!tracks.some(t=>t.id===trackId))throw new OperationsError('NOT_FOUND');
    return { writes: [{ type: 'insert', table: 'credentials', values: record }], response: { ...operationsMeta(store, now, revision + 1), credential: credentialView(record) } };
  });
}
export const configurationServices = {
  devices: async (c: EndpointContext<'devices'>) => ({ ...operationsMeta(c.store, c.now, await c.store.revision()),
    devices: await Promise.all((await c.store.list<Row<ConfiguredDevice>>('devices')).map(row => deviceView(c.store, decode(row)))) }),
  saveDevice,
  credentials: async (c: EndpointContext<'credentials'>) => ({ ...operationsMeta(c.store, c.now, await c.store.revision()),
    credentials: (await c.store.list<CredentialRow>('credentials')).map(credentialView) }),
  issueCredential,
  revokeCredential: async (c: EndpointContext<'revokeCredential'>) => mutate(c, 'credential.revoke', c.body.requestId, { params: c.params, body: c.body }, async revision => {
    const row = await c.store.get<CredentialRow>('credentials', c.params.id);
    if (!row) throw new OperationsError('NOT_FOUND');
    return { writes: [{ type: 'update', table: 'credentials', id: row.id, values: { disabled: 1 } }],
      response: { ...operationsMeta(c.store, c.now, revision + 1), credential: credentialView({ ...row, disabled: 1 }) } };
  }),
} satisfies OperationsServices;
