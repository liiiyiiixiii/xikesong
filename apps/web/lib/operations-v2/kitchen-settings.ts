import type { KitchenSettings } from '@zhishan/contracts/v2/kitchen';
import { kitchenSettingsSchema } from '@zhishan/contracts/v2/kitchen';
import type { OperationsStore } from './storage.ts';
export async function readKitchenSettings(store: OperationsStore):Promise<KitchenSettings>{
 const row=await store.get<{payload:string}>('system','kitchen-settings');
 return row?kitchenSettingsSchema.parse(JSON.parse(row.payload)):{version:0,updatedAt:null,enabledAt:null,config:{automaticRefillEnabled:false,tracks:[]}};
}
