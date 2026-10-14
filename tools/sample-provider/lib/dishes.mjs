import { originalMenu } from './menu-original.mjs';
// Decisions use the previous 30-day observed consumption ranking, not hidden demand.
// Duplicate positions are separated by at least 16 slots around the belt.
export const replacements={beef:'tofu-skin','shrimp-ball':'tofu',dumpling:'lettuce',noodle:'bean-curd-stick','sweet-potato':'watermelon',duck:'spinach'};
export const dishes=originalMenu.filter(d=>!Object.hasOwn(replacements,d.id));
export const bowls=originalMenu.map(slot=>{
 const dish=originalMenu.find(d=>d.id===(replacements[slot.id]??slot.id));
 return {...dish,demandIndex:dish.position-1,scaleId:slot.scaleId,position:slot.position};
});
