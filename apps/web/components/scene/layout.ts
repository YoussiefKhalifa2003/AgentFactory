export const GAP_X = 5.15;
export const GAP_Z = 5.45;
export const DESK_FOOTPRINT = { w: 2.2, d: 2.4 };

export function colsFor(n: number) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

export function deskSlots(count: number) {
  const cols = colsFor(Math.max(count, 1));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
  return { cols, rows };
}

export function deskPos(index: number, cols: number): [number, number, number] {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return [col * GAP_X, 0, 3.05 + row * GAP_Z];
}

export function hallSize(count: number) {
  const { cols, rows } = deskSlots(count);
  return {
    cols,
    rows,
    width: Math.max(cols * GAP_X, 8.2),
    depth: Math.max(rows * GAP_Z + 3.4, 10.5),
  };
}

export function hallShell(width: number, depth: number) {
  const thick = 0.22;
  const wallH = 4.7;
  const x0 = -2.35;
  const x1 = width + 1.2;
  const z0 = -1.08;
  const z1 = depth + 1.4;
  const midX = (x0 + x1) / 2;
  const midZ = (z0 + z1) / 2;
  const innerW = x1 - x0;
  const innerD = z1 - z0;
  return { thick, wallH, x0, x1, z0, z1, midX, midZ, innerW, innerD };
}

/** Locked 3/4 entrance postcard for the Floor strip. Same angle at every room size. */
export function dioramaView(width: number, depth: number) {
  const { x0, z0, z1, midX, innerW, innerD } = hallShell(width, depth);
  const pull = 4.8 + innerD * 0.12;
  return {
    position: [x0 + innerW * 0.22, 2.05, z1 + pull] as [number, number, number],
    lookAt: [midX + innerW * 0.08, 0.78, z0 + innerD * 0.4] as [number, number, number],
    fov: 28,
  };
}

export function overlapHits(count: number) {
  const { cols } = deskSlots(count);
  const hits: string[] = [];
  const boxes = Array.from({ length: count }, (_, i) => {
    const [x, , z] = deskPos(i, cols);
    return {
      id: String(i),
      minX: x - DESK_FOOTPRINT.w / 2,
      maxX: x + DESK_FOOTPRINT.w / 2,
      minZ: z - DESK_FOOTPRINT.d / 2,
      maxZ: z + DESK_FOOTPRINT.d / 2,
    };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
      if (overlap) hits.push(`${a.id}-${b.id}`);
    }
  }
  if (process.env.NODE_ENV !== "production" && hits.length) {
    console.warn("desk overlap", hits);
  }
  return hits;
}
