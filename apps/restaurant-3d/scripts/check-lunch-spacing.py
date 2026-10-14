import json,math
from pathlib import Path
root=Path(__file__).resolve().parents[2]
s=json.loads((root/'web/data/demo-v1/scene-manifest.v1.json').read_text());d=json.loads((root/'web/data/demo-v1/dataset.json').read_text());seats={v['seatId']:v for v in s['seats']};guests={v['customerId']:{'seat':v['seatId'],'from':0,'to':600001} for v in d['initialCustomers']}
for e in d['events']:
 if e['eventType']=='customer.seat':guests[e['customerId']]={'seat':e['seatId'],'from':e['applyTimeMs'],'to':600001,'enter':e}
 if e['eventType']=='customer.depart':guests[e['customerId']]['to']=e['applyTimeMs']
 if e['eventType']=='customer.leave':guests[e['customerId']]['leave']=e
for g in guests.values():
 for key in ['enter','leave']:
  if key in g:
   e=g[key];path=e['path'];e['segments']=[math.hypot(b['x']-a['x'],b['z']-a['z']) for a,b in zip(path,path[1:])];e['length']=sum(e['segments'])
def loc(g,t):
 if g['from']<=t<g['to']:return seats[g['seat']]['position'],False
 for k in ['enter','leave']:
  e=g.get(k)
  if e and e['startTimeMs']<=t<e['applyTimeMs']:
   v=e['length']*(t-e['startTimeMs'])/(e['applyTimeMs']-e['startTimeMs'])
   for i,l in enumerate(e['segments']):
    if v<=l:
     a,b=e['path'][i:i+2];return {'x':a['x']+(b['x']-a['x'])*v/l,'z':a['z']+(b['z']-a['z'])*v/l},True
    v-=l
 return None
lowest=(999,None);bad=[]
for t in range(0,600001,200):
 rows=[(id,loc(g,t)) for id,g in guests.items()];rows=[(id,*p) for id,p in rows if p]
 for i,(id,a,moving) in enumerate(rows):
  for other,b,m2 in rows[i+1:]:
   if not(moving or m2):continue
   dist=math.hypot(a['x']-b['x'],a['z']-b['z'])
   if dist<lowest[0]:lowest=(dist,{'timeMs':t,'pair':[id,other]})
   if dist<.45 and len(bad)<12:bad.append({'timeMs':t,'distance':dist,'pair':[id,other]})
report={'sampleIntervalMs':200,'minimumMeters':lowest[0],'closestPair':lowest[1],'violations':bad};(root/'restaurant-3d/docs/demo-v1/lunch-spacing.json').write_text(json.dumps(report,indent=2)+'\n');print(report);assert not bad
