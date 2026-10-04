import { z } from 'zod';
import type { CurrentProfile } from './current-profile';
const brief=z.string().trim().min(1).max(80).refine(s=>!/[0-9０-９%％#*<>]/.test(s),'文字提示不得编造数值或包含标记');
export const visualCopySchema=z.object({headline:brief,notes:z.array(z.object({dishId:z.string(),text:brief}).strict()).max(500)}).strict();
export type VisualCopy=z.infer<typeof visualCopySchema>;
export function parseVisualCopy(content:string,ids:string[]):VisualCopy{
 const parsed=visualCopySchema.parse(JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));
 const actual=parsed.notes.map(n=>n.dishId);
 if(new Set(actual).size!==actual.length||actual.length!==ids.length||actual.some(id=>!ids.includes(id)))throw new Error('AI 菜品依据不完整');
 return parsed;
}
export interface DailyVisual {
 date:string;createdAt:string;source:string;simulation:boolean;
 status:'generating'|'ready'|'unconfigured'|'failed';profile:CurrentProfile;
 copy:VisualCopy|null;model:string|null;error:string|null;
}
