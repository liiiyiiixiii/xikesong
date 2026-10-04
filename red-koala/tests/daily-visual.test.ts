import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVisualCopy } from '../lib/analysis/daily-visual.ts';
test('visual annotations cover exact dish IDs, and cannot replace numerical percentages',()=>{
 const copy={headline:'多种菜品构成群体取用倾向',notes:[{dishId:'a',text:'取用构成较长期略有增加'},{dishId:'b',text:'仍在积累有效样本'}]};
 assert.equal(parseVisualCopy(JSON.stringify(copy),['a','b']).notes.length,2);
 assert.throws(()=>parseVisualCopy(JSON.stringify(copy),['a','c']));
 assert.throws(()=>parseVisualCopy(JSON.stringify({...copy,notes:[copy.notes[0],copy.notes[0]]}),['a','b']));
 assert.throws(()=>parseVisualCopy(JSON.stringify({...copy,headline:'偏好占比80%'}),['a','b']));
});
