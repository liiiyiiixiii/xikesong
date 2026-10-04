import type { CurrentProfile } from './current-profile';
import type { AnalysisResult } from './contract';
export interface PortraitArchive {
 id:string;date:string;source:string;createdAt:string;late:boolean;
 profile:CurrentProfile;scenario:unknown|null;
 analysis:AnalysisResult|null;status:'pending'|'complete'|'unconfigured'|'failed';error:string|null;
}
export type ArchiveSummary=Omit<PortraitArchive,'profile'|'analysis'> & {asOf:string;version:string;modeledCount:number};
