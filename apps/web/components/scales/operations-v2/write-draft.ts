import type {EndpointInput,EndpointName} from '@zhishan/contracts/operations-v2';
export interface WriteDraft<K extends EndpointName>{fingerprint:string;requestId:string;input:EndpointInput<K>}
/** A submitted body is immutable. A timeout retry and a second unchanged click use exactly the same request. */
export function prepareWrite<K extends EndpointName>(input:EndpointInput<K>,previous:WriteDraft<K>|null):WriteDraft<K>{
 const body=input.body&&typeof input.body==='object'?{...input.body,requestId:undefined}:input.body;
 const fingerprint=JSON.stringify({...input,body});
 if(previous?.fingerprint===fingerprint)return previous;
 const requestId=crypto.randomUUID();
 return {fingerprint,requestId,input:structuredClone({...input,body:{...body,requestId}}) as EndpointInput<K>};
}
