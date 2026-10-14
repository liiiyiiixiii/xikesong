import type { SceneManifest } from './layout';

export type PlatePlacement = Pick<SceneManifest, 'plates' | 'dishCatalog'> & { source: string };

/** Physical placement only: never manufactures weight readings or business events. */
export function fillPlatePositions(scene: SceneManifest, previous: PlatePlacement): PlatePlacement {
  const slots = scene.slots.filter(slot => slot.usable);
  const dishes = [...previous.dishCatalog].sort((a, b) => a.dishId.localeCompare(b.dishId));
  if (!dishes.length) throw Error('A main-system dish catalog is required');
  const occupied = new Set<string>(), identities = new Set<string>();
  const plates = previous.plates.map(plate => {
    if (!slots.some(slot => slot.slotId === plate.slotId) || !dishes.some(dish => dish.dishId === plate.dishId)
      || occupied.has(plate.slotId) || identities.has(plate.plateId)) throw Error(`Invalid existing plate binding: ${plate.plateId}`);
    occupied.add(plate.slotId); identities.add(plate.plateId);
    return { ...plate };
  });
  for (const track of scene.tracks) {
    const positions = slots.filter(slot => slot.trackId === track.trackId);
    for (const [index, slot] of positions.entries()) {
      if (occupied.has(slot.slotId)) continue;
      const plateId = `plate-filled-${slot.slotId}`;
      if (identities.has(plateId)) throw Error(`Plate identity collision: ${plateId}`);
      plates.push({ plateId, slotId: slot.slotId, dishId: dishes[index % dishes.length].dishId,
        diameterM: scene.plateDimensions.diameterM, heightM: scene.plateDimensions.heightM });
      occupied.add(slot.slotId); identities.add(plateId);
    }
  }
  return { source: 'main-system:data/demo-v1/dishes.json; every usable position filled on both tracks; legacy kitchen centre pitch; physical placement only', dishCatalog: previous.dishCatalog, plates };
}
