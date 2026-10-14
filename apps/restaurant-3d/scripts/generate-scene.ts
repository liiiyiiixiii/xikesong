import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateGeometry } from '../src/demo/validation.ts';
import { canonicalManifest } from '../src/demo/digest.ts';
import { buildGeometry } from '../src/demo/layout.ts';
const manifest=buildGeometry();
// Main system owns dish IDs. This file is explicit placement input, never inferred from array indices or labels.
const bindingPath='public/data/plate-bindings.v1.json';
if(existsSync(bindingPath)){
 const bindings=JSON.parse(readFileSync(bindingPath,'utf8'));
 manifest.plates=bindings.plates;manifest.dishCatalog=bindings.dishCatalog;manifest.bindingSource=bindings.source;
}
const ids=new Set<string>(),slots=new Set<string>();
for(const p of manifest.plates){if(ids.has(p.plateId)||slots.has(p.slotId)||!manifest.slots.some(s=>s.slotId===p.slotId)||!manifest.dishCatalog.some(d=>d.dishId===p.dishId))throw Error('Invalid plate binding');ids.add(p.plateId);slots.add(p.slotId);}
const validation=validateGeometry(manifest);if(validation.errors.length)throw Error(validation.errors.join('; '));
manifest.contentDigest='sha256:'+createHash('sha256').update(canonicalManifest(manifest)).digest('hex');
writeFileSync('public/data/scene-manifest.v1.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({layoutVersion:manifest.layoutVersion,contentDigest:manifest.contentDigest,tracks:manifest.tracks.map(t=>({id:t.trackId,lengthM:t.lengthM,slots:manifest.slots.filter(s=>s.trackId===t.trackId).length})),seats:manifest.seats.length,plates:manifest.plates.length,navigation:manifest.navigation},null,2));
