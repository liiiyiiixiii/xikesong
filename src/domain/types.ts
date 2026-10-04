export interface Catalog {
    id: string;
    name: string;
    category: string;
    unit: "g";
    pieceWeightG: number | null;
    launchDate: string;
}
export interface StoreDay {
    date: string;
    status: "open" | "closed";
    snapshotAt: string;
    finalAt: string;
}
export interface DishDay {
    date: string;
    dishId: string;
    status: "complete" | "partial" | "missing" | "not_launched" | "closed";
    take20: number | null;
    takeFinal: number | null;
    takeG: number | null;
    opening: number | null;
    replenished: number | null;
    waste: number | null;
    closing: number | null;
    supply: "adequate" | "stockout" | "unknown" | "not_launched" | "closed";
    stockoutMinutes: number | null;
    snapshotAt: string;
    finalAt: string;
    ageWaste?: number | null;
    closingWaste?: number | null;
    retainedKitchen?: number | null;
}
export interface Dataset {
    catalog: Catalog[];
    stores: StoreDay[];
    days: DishDay[];
}
