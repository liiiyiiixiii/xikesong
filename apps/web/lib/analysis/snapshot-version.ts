import type { CurrentProfile } from './current-profile';

/** The legacy portrait algorithm's name contains v2; its data is still the legacy delta ledger. */
export interface SnapshotMetadata {
  basis: 'legacy_delta_v1';
  source: string;
  algorithmVersion: string;
  asOf: string;
  fingerprint: string;
  currentFingerprint: string | null;
  currentness: 'current' | 'outdated' | 'unknown' | 'unchecked';
  checkedAt: string | null;
  includesV2Ledger: false;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export async function profileFingerprint(source: string, profile: CurrentProfile): Promise<string> {
  const evidence = JSON.stringify(canonical({ basis: 'legacy_delta_v1', source, profile }));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(evidence));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

/** Compare the same cutoff; never replace the saved numerical model or a confirmed prep plan. */
export async function snapshotMetadata(source: string, saved: CurrentProfile, loadCurrent?: (asOf: string) => Promise<CurrentProfile>): Promise<SnapshotMetadata> {
  const metadata: SnapshotMetadata = { basis: 'legacy_delta_v1', source, algorithmVersion: saved.version, asOf: saved.asOf,
    fingerprint: await profileFingerprint(source, saved), currentFingerprint: null, currentness: 'unchecked', checkedAt: null, includesV2Ledger: false };
  if (!loadCurrent) return metadata;
  metadata.checkedAt = new Date().toISOString();
  try {
    const current = await loadCurrent(saved.asOf);
    if (Date.parse(current.asOf) !== Date.parse(saved.asOf)) throw new Error('Snapshot cutoff changed');
    metadata.currentFingerprint = await profileFingerprint(source, current);
    metadata.currentness = metadata.currentFingerprint === metadata.fingerprint ? 'current' : 'outdated';
  } catch {
    metadata.currentness = 'unknown';
  }
  return metadata;
}
