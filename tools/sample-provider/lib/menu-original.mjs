// Canonical 42-dish menu shared by live simulation and the versioned historical generator.
export const originalMenu = [
 ["beef","牛肉"], ["shrimp","鲜虾"], ["potato","土豆"],
 ["tofu","豆腐"], ["mushroom","香菇"], ["lettuce","生菜"],
 ["meatball","丸子"], ["kelp","海带"], ["lotus","藕片"],
 ["watermelon","西瓜"], ["bun","小馒头"], ["noodle","面条"],
 ["pork-belly","五花肉"], ["lamb","羊肉"], ["chicken","鸡肉"],
 ["duck","鸭肉"], ["fish","鱼片"], ["squid","鱿鱼"],
 ["scallop","扇贝"], ["mussel","青口贝"], ["crab-stick","蟹棒"],
 ["fish-ball","鱼丸"], ["shrimp-ball","虾丸"], ["quail-egg","鹌鹑蛋"],
 ["egg","鸡蛋"], ["tofu-skin","豆皮"], ["frozen-tofu","冻豆腐"],
 ["bean-curd-stick","腐竹"], ["konjac","魔芋"], ["glass-noodle","粉丝"],
 ["rice-cake","年糕"], ["dumpling","水饺"], ["rice","米饭"],
 ["corn","玉米"], ["pumpkin","南瓜"], ["sweet-potato","红薯"],
 ["carrot","胡萝卜"], ["radish","白萝卜"], ["broccoli","西兰花"],
 ["cabbage","白菜"], ["spinach","菠菜"], ["baby-cabbage","娃娃菜"],
].map(([id,name],index)=>({
 id,name,scaleId:`sim-${index+1}`,position:index+1,tareG:300,fullG:1000,
 category: ["beef","pork-belly","lamb","chicken","duck"].includes(id)?"meat":
 ["shrimp","fish","squid","scallop","mussel"].includes(id)?"seafood":
 ["meatball","crab-stick","fish-ball","shrimp-ball","quail-egg","egg"].includes(id)?"protein":
 ["bun","noodle","glass-noodle","rice-cake","dumpling","rice"].includes(id)?"staple":
 ["watermelon","pineapple","orange"].includes(id)?"fruit":"vegetable",
}));
