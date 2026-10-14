import { aiEvidenceResponseSchema } from '@zhishan/contracts/v2/intelligence';
import { reportQuerySchema } from '@zhishan/contracts/v2/reports';
import { buildConfirmedReport } from './reports.ts';
import { operationsMeta } from './records.ts';
import { OperationsError, requirePermission } from './security.ts';
import type { EndpointContext, OperationsServices } from './router.ts';

/** A version-pinned tool payload for AI consumers. No model call, training write,
 * or legacy evidence is reachable through this adapter. */
async function aiEvidence(context: EndpointContext<'aiEvidence'>) {
  requirePermission(context.principal, 'staff');
  const { dataRevision, snapshotAt, ...query } = context.query;
  if (Date.parse(snapshotAt) > Date.parse(context.now)) throw new OperationsError('INVALID_REQUEST');
  const report = await buildConfirmedReport(context.store, reportQuerySchema.parse(query), snapshotAt);
  if (report.projectionStatus !== 'ready') throw new OperationsError('REPORT_REBUILDING');
  if (report.dataRevision !== dataRevision) throw new OperationsError('REPORT_REVISION_CHANGED');
  return aiEvidenceResponseSchema.parse({
    ...operationsMeta(context.store, context.now, Number(report.dataRevision.split(':').at(-1))),
    report, training: { enabled: false, reason: 'SEPARATE_BASIS' }, externalModelCalled: false,
  });
}
export const aiEvidenceServices = { aiEvidence } satisfies OperationsServices;
