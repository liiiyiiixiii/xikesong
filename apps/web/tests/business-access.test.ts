import test from 'node:test';
import assert from 'node:assert/strict';
import { businessAccess } from '../components/scales/business-access.ts';

test('unavailable history never leaves cached business writes enabled', () => {
  assert(businessAccess({loading:true}).scalesReadOnlyReason);
  const access=businessAccess({loading:false,error:'offline',data:{phase:null}});
  assert(access.scalesReadOnlyReason);
  assert(access.freshnessReadOnlyReason);
});

test('scenario freezes all operations even when its response marks simulation enabled', () => {
  const access=businessAccess({loading:false,data:{phase:'ready',mode:'scenario',simulation:{enabled:true}}});
  assert.equal(access.scenario,true);
  assert(access.scalesReadOnlyReason);
  assert(access.freshnessReadOnlyReason);
});

test('frozen imported history still permits a new freshness batch outside scenario mode', () => {
  const access=businessAccess({loading:false,data:{phase:'ready',mode:'history',simulation:{enabled:false}}});
  assert(access.scalesReadOnlyReason);
  assert.equal(access.freshnessReadOnlyReason,'');
});

test('live data and enabled non-scenario simulation keep their business controls', () => {
  for(const data of [{phase:null},{phase:'ready',mode:'history',simulation:{enabled:true}}]){
    const access=businessAccess({loading:false,data});
    assert.equal(access.scalesReadOnlyReason,'');
    assert.equal(access.freshnessReadOnlyReason,'');
  }
});
