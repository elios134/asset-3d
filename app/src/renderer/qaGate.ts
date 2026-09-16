// qaGate.ts — cœur PUR du contrôle QA au moment de publier.
// La QA est ADVISORY (jamais bloquante) : on calcule un verdict par clé et on signale les
// clés non conformes ou sans verdict pour les marquer dans l'UI, mais on n'empêche JAMAIS
// la publication — c'est l'utilisateur qui décide (la prod manuelle fait foi). Aucune logique
// React ni I/O — testé isolément.

// Verdict par-clé à partir des lignes QA : conforme ssi 0 échec dur.
export function qaVerdicts(rows: Array<{ key: string; hard: number }>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of rows) out[r.key] = r.hard === 0;
  return out;
}

// Clés À VÉRIFIER (avertissement, jamais un blocage) : uniquement celles EXPLICITEMENT non
// conformes (QA lancée et échec dur). L'absence de verdict n'est PAS signalée : la QA est
// optionnelle — ne pas l'avoir lancée n'est pas une anomalie.
export function keysToVerify(pubKeys: string[], verdicts: Record<string, boolean>): string[] {
  return pubKeys.filter((k) => verdicts[k] === false);
}

// On peut lancer l'analyse/publication dès qu'au moins une clé est sélectionnée.
// La QA n'entre PAS dans cette décision : elle informe, elle ne bloque pas.
export function canAnalyze(pubKeys: string[]): boolean {
  return pubKeys.length > 0;
}
