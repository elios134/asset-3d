export type Selection = Map<string, { exterior: boolean; interior: boolean }>;

export function toggleLevel(sel: Selection, key: string, level: "exterior" | "interior"): Selection {
  const next = new Map(sel);
  const cur = next.get(key) ?? { exterior: false, interior: false };
  next.set(key, { ...cur, [level]: !cur[level] });
  return next;
}

export function selectionCount(sel: Selection): number {
  let n = 0;
  for (const v of sel.values()) if (v.exterior || v.interior) n++;
  return n;
}
