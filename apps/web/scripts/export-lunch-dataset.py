"""Export the validated lunch package as JSON + flat analysis tables, without UI origin tags."""
import csv,json,shutil,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]; source=root/'data/demo-v1';out=root/'data/lunch-1200-1210';out.mkdir(exist_ok=True)
d=json.loads((source/'dataset.json').read_text());s=json.loads((source/'scene-manifest.v1.json').read_text());truth=json.loads((source/'validation-truth.json').read_text());r=json.loads((source/'validation-report.json').read_text());dishes={x['dishId']:x for x in d['dishes']};plates={x['plateId']:x for x in s['plates']};slots={x['slotId']:x for x in s['slots']}
def clock(ms):
 seconds=43200+ms/1000;return f'{int(seconds//3600):02}:{int(seconds//60%60):02}:{seconds%60:06.3f}'
def table(name,rows):
 with (out/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
for name in ['dataset.json','scene-manifest.v1.json','dishes.json']:shutil.copy2(source/name,out/name)
checks=out/'validation';checks.mkdir(exist_ok=True)
for name in ['validation-truth.json','validation-report.json']:shutil.copy2(source/name,checks/name)
live=root.parent/'restaurant-3d/docs/demo-v1/lunch-live-validation.json'
if live.exists():
 proof=json.loads(live.read_text())
 if proof.get('passed') and proof.get('sceneDigest')==d['sceneDigest']:shutil.copy2(live,checks/live.name)
main=sorted((p for p in s['plates'] if slots[p['slotId']]['trackId']=='track-main'),key=lambda p:slots[p['slotId']]['s0M'])
table('menu-96.csv',[dict(plateId=p['plateId'],slotId=p['slotId'],dishId=p['dishId'],name=dishes[p['dishId']]['name'],category=dishes[p['dishId']]['category'],fullG=dishes[p['dishId']]['fullG'],portionG=dishes[p['dishId']]['portionG']) for p in main])
net={w['plateId']:w['grossG']-dishes[plates[w['plateId']]['dishId']]['tareG'] for w in d['initialWeights']};op={e['operationId']:e for e in d['events'] if 'operationId' in e and e['layer']=='action'}
observations=[];actions=[]
for w in d['initialWeights']:
 p=plates[w['plateId']];observations.append(dict(localTime=clock(0),simTimeMs=0,plateId=p['plateId'],trackId=slots[p['slotId']]['trackId'],dishId=p['dishId'],name=dishes[p['dishId']]['name'],grossG=w['grossG'],netG=net[p['plateId']],deltaG=0,operationId='',kind='initial',quality='good'))
for e in sorted(d['events'],key=lambda e:e['applyTimeMs']):
 if e['eventType']!='weight.observed':continue
 p=plates[e['plateId']];dish=dishes[p['dishId']];next=e['grossG']-dish['tareG'];delta=next-net[p['plateId']];net[p['plateId']]=next;o=op.get(e.get('operationId'))
 observations.append(dict(localTime=clock(e['applyTimeMs']),simTimeMs=e['applyTimeMs'],plateId=p['plateId'],trackId=slots[p['slotId']]['trackId'],dishId=p['dishId'],name=dish['name'],grossG=e['grossG'],netG=next,deltaG=delta,operationId=e.get('operationId',''),kind=o['eventType'] if o else 'sample',quality=e['quality']))
 if o:actions.append(dict(localTime=clock(e['applyTimeMs']),simTimeMs=e['applyTimeMs'],operationId=o['operationId'],kind=o['eventType'],customerId=o.get('customerId',''),seatId=o.get('seatId',''),staffId=o.get('staffId',''),plateId=p['plateId'],dishId=p['dishId'],name=dish['name'],amountG=abs(delta),remainingG=next,taskId=o.get('taskId','')))
table('weights.csv',observations);table('weights-main.csv',[row for row in observations if row['trackId']=='track-main']);table('food-actions.csv',actions)
table('customers.csv',[dict(customerId=g['customerId'],seatId=g['seatId'],presentAtStart=g['seatedFromMs']==0,minutesDiningBeforeStart=round(g['elapsedDiningMs']/60000,2),seatedLocalTime=clock(g['seatedFromMs']),departLocalTime=clock(g['departAtMs']) if g['departAtMs'] is not None else '',profile=g['profile']) for g in truth['guests']])
occupancy=[]
for t in range(0,600001,5000):
 es=[e for e in d['events'] if e['applyTimeMs']<=t];occupancy.append(dict(localTime=clock(t),simTimeMs=t,seated=31+sum(e['eventType']=='customer.seat' for e in es)-sum(e['eventType']=='customer.depart' for e in es),inStore=31+sum(e['eventType']=='customer.enter' for e in es)-sum(e['eventType']=='customer.leave' for e in es)))
table('occupancy-5s.csv',occupancy);table('plate-mass-balance.csv',truth['plateBalances'])
text=f'''红考拉午高峰模拟数据集
数据包：{d['datasetId']}
场景摘要：{d['sceneDigest']}
日期与窗口：2026-10-12 12:00:00–12:10:00，Asia/Shanghai，600000 ms。
左侧营业：96 个承载位、96 个餐盘、96 种不同菜品、47 个餐位。
右侧备用：78 盘、33 席，停用，无顾客取餐/补菜。备用盘不计入96盘唯一性范围。
开场31人已就餐，85个主轨餐盘不是满盘；随后28人进店、12人离店，满座峰值47人，结束时仍有47人在店。
本包{r['takeActions']}次取餐、{r['refillActions']}次补菜；取用{r['counts']['takenG']}g、补充{r['counts']['refilledG']}g。初始缺少的重量不计入本窗口取用量。
结束时{r['openTasksAtEnd']}个供餐任务仍在准备或等待回厨，观察结束不等于关店。

文件：
- dataset.json：唯一运行输入，含初始顾客、初始重量、动作和称重事件。
- scene-manifest.v1.json：轨道、座位、行走路线及显式餐盘绑定。
- dishes.json / menu-96.csv：菜名、类别、盘满重量和典型一次夹取量，无来源标签。
- weights.csv：含零时刻初始行和每20秒采样；取餐/补菜生效时额外采样。
- weights-main.csv：仅左侧96盘的称重记录，适合直接用于本次营业分析。
- food-actions.csv：逐次夹取/补菜，精确至毫秒，关联顾客、座位、餐盘、重量。
- customers.csv：入座、离席与开场前已用餐时长。空白离席时间表示观察截止仍未离席。
- occupancy-5s.csv：五秒客流采样；精确峰值以验证记录逐事件时间线为准。
- plate-mass-balance.csv：每盘 initialG + refilledG - takenG = finalG。
- validation/：验证真值与检查报告；不要当作未来时刻的在线特征。

模型假设：这是固定种子生成的模拟营业截面，不是实采客流或销售记录。
老顾客开场前已用餐15–60分钟；离店者用餐至少45分钟，新客在窗口末仍就餐。
顾客包含均衡、偏肉、清淡、偏小吃四类偏好；取餐间隔、份量、所遇餐盘均有差异，离席前偏向水果和点心。
取餐必须等餐盘经过该座位；不足10g或餐盘正在被别人取用时跳过本次请求。
肉类/禽类等以夹取的生食原料重量计；本数据不把夹走重量当作吞咽重量，也不推算营收。
三名厨师分别有工位，供餐员负责补盘。15–20秒代表已预制库存的分装备餐，并非从生到熟的烹饪时间。
半盘触发准备，按厨师空闲时间排队，备好后须等餐盘回到供餐口；允许短暂缺货和跨窗口未完成任务。
人物沿已验证路线行走，1.2m/s；窄通道预约避免迎面穿插，进座前有至少24秒清理间隔。
重量是理想称重观测，本包未注入传感器漂移、故障、噪声或丢包，不能据此评价真实硬件识别准确率。
所有菜品模型为可辨识的简化三维造型；余量由业务快照驱动。

复现：先在主项目运行 python3 scripts/create-lunch-menu.py，再在3D项目 npm run scene:generate，最后主项目 npm run demo:generate && python3 scripts/export-lunch-dataset.py。
菜单检索参考（仅作为开发依据，不在界面或菜品清单逐项标注）：
https://sg.trip.com/moments/detail/xi-an-7-141712565/
https://www.sina.cn/news/detail/5297535352572112.html
未获得完整官方菜单，其余选用常见自助烧烤食品。菜名不重复，并不表示全部均为某家门店当天实际供应。
'''
(out/'README.txt').write_text(text)
zipPath=root/'data/hongkaola-lunch-1200-1210.zip'
with zipfile.ZipFile(zipPath,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(out.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(out.parent))
print(json.dumps({'datasetId':d['datasetId'],'zip':str(zipPath),'weightRows':len(observations),'foodActions':len(actions),'customers':len(truth['guests'])},ensure_ascii=False))
