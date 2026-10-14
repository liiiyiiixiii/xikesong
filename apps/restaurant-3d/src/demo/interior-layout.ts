/** Scenic equipment only; no extra seats, customers, weights or business tasks. */
export const kitchenFixtures = [
  { id: 'cold-store', kind: 'fridge', x: 1.1, z: .85, width: 1.35, depth: .95 },
  { id: 'wash', kind: 'sink', x: 3.3, z: .85, width: 2.4, depth: 1 },
  { id: 'cut', kind: 'prep', x: 6, z: .85, width: 2.5, depth: 1 },
  { id: 'raw-meat', kind: 'meat', x: 9, z: .85, width: 2.7, depth: 1 },
  { id: 'dry-store', kind: 'shelf', x: .85, z: 2.7, width: 1.1, depth: 1.4 },
  { id: 'plating', kind: 'island', x: 7, z: 3.65, width: 3.5, depth: .85 },
  { id: 'cooked-pickup', kind: 'pickup', x: 10.4, z: 3.65, width: 2.2, depth: .85 },
] as const;
export const kitchenChefs = [
  { id: 'scenic-chef-prep', x: 6, z: 1.72, angle: Math.PI, action: 'chop', station: 'cut' },
  { id: 'scenic-chef-marinade', x: 9, z: 1.72, angle: Math.PI, action: 'mix', station: 'raw-meat' },
  { id: 'scenic-chef-plating', x: 7, z: 2.88, angle: 0, action: 'plate', station: 'plating' },
] as const;
export const wallPlanters = [5.6, 8.2, 10.8, 13.4].map((z,i)=>({id:`wall-planter-${i+1}`,x:28.88,z,width:.22,depth:1}));

/** Staffed pickup point behind the existing mixed-service counter. */
export const mixedCounterStaff = {id:'scenic-mixed-counter-server',x:12.38,z:4.16};
