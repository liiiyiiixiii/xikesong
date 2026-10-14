/** Read-only consumption of the main project's official generator and package. */
import {readFileSync,writeFileSync} from 'node:fs';
import {generateRush} from '../../web/lib/demo-v1/rush-generator';
import {validatePackage} from '../../web/lib/demo-v1/core';
import type {SceneManifest} from '../src/demo/layout';

const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const scene=read('public/data/scene-manifest.v1.json') as SceneManifest;
const candidate=await generateRush(scene,read('../web/data/demo-v1/dishes.json'),`read-only-candidate:${scene.layoutVersion}`);
const published=read('../web/data/demo-v1/dataset.json');
let publishedValidation:{passed:boolean;error?:string}={passed:false};
try {await validatePackage(scene,published);publishedValidation={passed:true};}
catch(error){publishedValidation.error=String(error);}
let http:{available:boolean;status?:number;matches?:boolean;error?:string}={available:false};
try {
 const response=await fetch('http://127.0.0.1:5173/api/demo/v1/manifest',{signal:AbortSignal.timeout(2500)});
 const body=await response.json();
 http={available:response.ok,status:response.status,matches:body.scene?.contentDigest===scene.contentDigest};
}catch(error){http.error=String(error);}
const result={checkedAt:new Date().toISOString(),sceneDigest:scene.contentDigest,layoutVersion:scene.layoutVersion,
 candidate:{mode:'official-generator-in-memory-only',published:false,report:candidate.report,truth:candidate.truth},
 published:{datasetId:published.datasetId,sceneDigest:published.sceneDigest,...publishedValidation},http,
 handoffComplete:publishedValidation.passed&&http.available&&http.matches===true,
 note:'Candidate validation is not a live HTTP acceptance. This script never modifies the main system package or business code.'};
writeFileSync(`docs/demo-v1/seating-${scene.layoutVersion.split('-').at(-1)}-integration.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
