import json,time,urllib.request
from pathlib import Path
base='http://127.0.0.1:4173/api/demo/lunch/'
req=urllib.request.Request(base+'control',data=b'{"action":"restart"}',headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:4173'})
a=json.load(urllib.request.urlopen(req));cycle=a['playback']['cycle'];start=time.monotonic();rows=[]
while True:
 d=json.load(urllib.request.urlopen(base+'state',timeout=15));elapsed=time.monotonic()-start
 assert d['datasetId']=='lunch-demo-20261004-v1' and len(d['plates'])==42
 assert d['customers']['count']==4+d['customers']['entered']-d['customers']['left']
 rows.append({'elapsed':round(elapsed,2),'playback':d['playback'],'customers':d['customers'],'grams':[p['remainingG'] for p in d['plates']]})
 if len(rows)%12==1:print(rows[-1]['elapsed'],d['playback'],d['customers'],flush=True)
 if elapsed>=602 and d['playback']['cycle']>cycle:break
 if elapsed>630:raise AssertionError('cycle did not advance')
 time.sleep(5)
out=Path(__file__).resolve().parents[1] / 'data/lunch-demo/playback-verification.json'
out.write_text(json.dumps({'passed':True,'wallSeconds':elapsed,'samples':rows},ensure_ascii=False,indent=2));print('PASS full realtime cycle',elapsed,flush=True)
