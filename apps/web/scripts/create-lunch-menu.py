"""Deterministic menu + explicit plate bindings; source evidence is not an official menu."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]; visual=root.parent/'restaurant-3d'
groups=[
('beef',360,35,'slice',0xa94337,'澳洲M4原切上脑|青柠雪花牛肋条|黑椒牛肉片|孜然牛肉|蒜香牛肉粒|韩式肥牛|麻辣牛肉|原切牛舌|酱香牛小排|藤椒牛肉|沙茶牛肉|洋葱牛肉'),
('pork',360,35,'belly',0xd77868,'原切五花肉|港式叉烧肉|芝士黄油五花肉|酸菜五花肉|泡菜五花肉|油泼辣子五花肉|蜜汁梅花肉|黑椒猪颈肉|蒜香排骨|香辣猪脆骨'),
('poultry',320,40,'chunk',0xe19a6d,'奥尔良鸡腿肉|香辣鸡翅中|蜜汁鸡翅根|黑椒鸡胸肉|孜然鸡胗|蒜香鸡软骨|照烧鸡腿肉|藤椒鸭胸肉'),
('seafood',320,40,'shrimp',0xe99d87,'鲜虾|蒜香鱿鱼圈|香辣鱿鱼须|巴沙鱼片|黑椒墨鱼仔|蒜蓉扇贝|青口贝|香煎多春鱼|孜然虾仁|柠檬龙利鱼'),
('processed',320,40,'sausage',0xc87b60,'原味烤肠|黑椒香肠|芝士肠|蟹柳|鱼豆腐|撒尿牛丸|墨鱼丸|亲亲肠'),
('vegetable',240,30,'vegetable',0x86ad48,'生菜|韭菜|西兰花|土豆片|红薯片|南瓜片|玉米段|莲藕片|山药片|茄子片|西葫芦片|彩椒块|洋葱圈|娃娃菜'),
('mushroom',200,25,'mushroom',0xcbb68e,'香菇|金针菇|杏鲍菇|白玉菇|口蘑|蟹味菇'),
('tofu',300,30,'cube',0xe7c991,'老豆腐|千页豆腐|豆皮卷|香干|腐竹|油豆腐'),
('snack',240,40,'snack',0xd79b48,'迷你菠萝堡|迷你牛肉汉堡|香酥鸡块|薯条|春卷|芝麻球|红糖糍粑|葱香小烧饼|蛋挞|榴莲披萨'),
('dessert',240,40,'cake',0xf4d9a6,'瑞士卷|奶油泡芙|果味华夫饼|巧克力布朗尼|芒果布丁|椰汁西米露'),
('fruit',400,50,'fruit',0xefb355,'红颜草莓|越南菠萝蜜|木瓜|西瓜|菠萝块|葡萄')]
trip='https://sg.trip.com/moments/detail/xi-an-7-141712565/'
sina='https://www.sina.cn/news/detail/5297535352572112.html'
brand1=set('澳洲M4原切上脑|青柠雪花牛肋条|原切五花肉|港式叉烧肉|迷你菠萝堡|瑞士卷|奶油泡芙|果味华夫饼|红颜草莓|越南菠萝蜜|木瓜|西瓜|榴莲披萨'.split('|'))
brand2=set('芝士黄油五花肉|酸菜五花肉|泡菜五花肉|油泼辣子五花肉'.split('|'))
overrides={'香辣鸡翅中':'wing','蜜汁鸡翅根':'wing','蒜香鱿鱼圈':'ring','香辣鱿鱼须':'tentacle','巴沙鱼片':'slice','柠檬龙利鱼':'slice','黑椒墨鱼仔':'tentacle','蒜蓉扇贝':'shell','青口贝':'shell','香煎多春鱼':'fish','蟹柳':'stick','鱼豆腐':'cube','撒尿牛丸':'ball','墨鱼丸':'ball','土豆片':'disc','红薯片':'disc','南瓜片':'wedge','玉米段':'corn','莲藕片':'lotus','山药片':'disc','茄子片':'disc','西葫芦片':'disc','洋葱圈':'ring','彩椒块':'chunk','韭菜':'stick','金针菇':'enoki','腐竹':'stick','豆皮卷':'roll','迷你菠萝堡':'burger','迷你牛肉汉堡':'burger','薯条':'fries','春卷':'roll','芝麻球':'ball','红糖糍粑':'cube','蛋挞':'tart','榴莲披萨':'pizza','瑞士卷':'swiss','奶油泡芙':'puff','果味华夫饼':'waffle','巧克力布朗尼':'brownie','芒果布丁':'pudding','椰汁西米露':'bowl','红颜草莓':'strawberry','越南菠萝蜜':'pod','木瓜':'wedge','西瓜':'watermelon','菠萝块':'chunk','葡萄':'grape'}
colors={'红颜草莓':0xda3e40,'西瓜':0xea5354,'葡萄':0x776595,'菠萝块':0xf7cf55,'木瓜':0xf39c50,'茄子片':0x755276,'西葫芦片':0xa6bd67,'巧克力布朗尼':0x57362a,'彩椒块':0xdd513e,'蟹柳':0xe67358,'巴沙鱼片':0xf1dcc2,'蒜香鱿鱼圈':0xe8cfbd,'生菜':0x66a53d,'韭菜':0x467e31,'西兰花':0x4b7f3a,'青口贝':0x4e7768,'红薯片':0xf0ad44,'南瓜片':0xec943d}
overrides.update({'青柠雪花牛肋条':'strip','蒜香牛肉粒':'cube','韩式肥牛':'roll','原切牛舌':'tongue','酱香牛小排':'rib','港式叉烧肉':'chunk','蒜香排骨':'rib','香辣猪脆骨':'cube','黑椒猪颈肉':'slice','黑椒鸡胸肉':'slice','蒜香鸡软骨':'cube','西兰花':'broccoli','杏鲍菇':'disc','白玉菇':'enoki','蟹味菇':'enoki','葱香小烧饼':'disc','香干':'cube','亲亲肠':'ball'})
colors.update({'澳洲M4原切上脑':0xb7443d,'青柠雪花牛肋条':0xc97158,'黑椒牛肉片':0x895346,'孜然牛肉':0xab683e,'蒜香牛肉粒':0xac5944,'韩式肥牛':0xe2a18b,'麻辣牛肉':0xb54832,'原切牛舌':0xc88383,'酱香牛小排':0x87513b,'藤椒牛肉':0xb58162,'沙茶牛肉':0x885b3c,'洋葱牛肉':0xb96e51,'港式叉烧肉':0xa8482f,'芝士黄油五花肉':0xe4b77e,'酸菜五花肉':0xc7ac79,'泡菜五花肉':0xd57648,'油泼辣子五花肉':0xb65435,'香干':0x9c6841,'白玉菇':0xeee8ce,'蟹味菇':0xb5a082,'老豆腐':0xf3e4ba,'千页豆腐':0xe6c58f,'西兰花':0x4f8b3e})
menu=[]
for category,full,portion,shape,color,names in groups:
 for name in names.split('|'):
  i=len(menu)+1; known=name in brand1|brand2
  menu.append(dict(dishId=f'dish-lunch-{i:03}',name=name,displayOrder=i,fullG=full,tareG=300,category=category,portionG=portion,preparationMs=20000 if category in ['snack','dessert'] else 15000,visual=dict(shape=overrides.get(name,shape),color=colors.get(name,color),variant=i),provenance=dict(kind='brand-visit' if known else 'buffet-reference',sourceUrl=(trip if name in brand1 else sina) if known else '',note='第三方探店提及；非官方完整菜单' if known else '常见自助烧烤补充，未确认该品牌供应')))
for dish in menu: dish.pop('provenance',None)
assert len(menu)==96 and len({d['name'] for d in menu})==96
(root/'data/demo-v1/dishes.json').write_text(json.dumps(menu,ensure_ascii=False,indent=2)+'\n')
bpath=visual/'public/data/plate-bindings.v1.json'; binding=json.loads(bpath.read_text()); scene=json.loads((visual/'public/data/scene-manifest.v1.json').read_text()); slots={s['slotId']:s for s in scene['slots']}
for track in scene['tracks']:
 plates=sorted((p for p in binding['plates'] if slots[p['slotId']]['trackId']==track['trackId']),key=lambda p:slots[p['slotId']]['s0M'])
 for i,p in enumerate(plates):p['dishId']=menu[i]['dishId']
binding['dishCatalog']=menu;binding['source']='apps/web/data/demo-v1/dishes.json · lunch-rush-96 · main unique; disabled backup reference display'
bpath.write_text(json.dumps(binding,ensure_ascii=False,indent=2)+'\n')
print({'uniqueMainDishes':len(menu)})
