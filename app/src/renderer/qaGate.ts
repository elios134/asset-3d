// qaGate.ts — cœur PUR du gate de publication PAR-CLÉ (tranche 3).
// Remplace le feu vert QA global (tout-ou-rien) : chaque vaisseau a son verdict (conforme = 0 échec dur),
// et on n'autorise la publication que des clés dont le verdict est conforme. Un Redeemer cassé ne bloque
// donc plus la publication d'un Clipper bon. Aucune logique React ni I/O — testé isolément.

// Verdict par-clé à partir des lignes QA : conforme ssi 0 échec dur.
export function qaVerdicts(rows: Array<{ key: string; hard: number }>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of rows) out[r.key] = r.hard === 0;
  return out;
}

// Clés qui empêchent la publication : verdict non conforme OU absent (jamais passées en QA).
export function publishBlockers(pubKeys: string[], verdicts: Record<string, boolean>): string[] {
  return pubKeys.filter((k) => verdicts[k] !== true);
}

// Peut lancer l'analyse/publication ssi au moins une clé et aucun bloqueur.
export function canAnalyze(pubKeys: string[], verdicts: Record<string, boolean>): boolean {
  return pubKeys.length > 0 && publishBlockers(pubKeys, verdicts).length === 0;
}
