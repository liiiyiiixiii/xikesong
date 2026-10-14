import Workbench from '@/components/scales/operations-v2/workbench';
import DemoKitchenScreen from '@/components/scales/operations-v2/demo-kitchen-screen';
export default async function KitchenPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const q=await searchParams;return q.mode==='demo'?<DemoKitchenScreen/>:<Workbench view="kitchenScreen"/>;}
