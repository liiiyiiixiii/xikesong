// A dish stays on the menu while any of its devices is enabled. Historical
// imports without a device mapping remain available. Retirement never deletes
// the underlying events, snapshots or confirmed plans.
export function menuDishFilter(configs: ReadonlyArray<{
    dishId: string;
    enabled: boolean;
}>) {
    const configured = new Set(configs.map(c => c.dishId));
    const active = new Set(configs.filter(c => c.enabled).map(c => c.dishId));
    return (dishId: string) => !configured.has(dishId) || active.has(dishId);
}
