/** Official v1 canonicalisation: omit root contentDigest; recursively sort keys. */
export function canonicalManifest(value:unknown):string {
 const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;
 const {contentDigest:_,...rest}=value as Record<string,unknown>;
 return JSON.stringify(sort(rest));
}
