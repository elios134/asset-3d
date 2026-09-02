function parse(v: string | null): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(v ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function needsUpdate(published: string | null, local: string | null): boolean {
  const p = parse(published), l = parse(local);
  if (!p || !l) return false;
  if (l[0] !== p[0]) return l[0] > p[0];
  return l[1] > p[1];
}
