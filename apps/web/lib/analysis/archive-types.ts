import type { CurrentProfile } from './current-profile';
import type { AnalysisResult } from './contract';
import type { SnapshotMetadata } from './snapshot-version';
export interface PortraitArchive {
 id:string;date:string;source:string;createdAt:string;late:boolean;
 archiveVersion:number;supersedesId:string|null;versions?:ArchiveVersionSummary[];
 profile:CurrentProfile;scenario:unknown|null;
 snapshot?:SnapshotMetadata;
 analysis:AnalysisResult|null;status:'pending'|'complete'|'unconfigured'|'failed';error:string|null;
}
export type ArchiveSummary=Omit<PortraitArchive,'profile'|'analysis'> & {asOf:string;version:string;modeledCount:number};

export type ArchiveVersionSummary=Pick<PortraitArchive,'id'|'archiveVersion'|'supersedesId'|'createdAt'|'status'>;
