import type { Prereqs } from "../../shared/types";

const LABELS: Array<[keyof Prereqs, string]> = [
  ["node", "Node"], ["starbreaker", "StarBreaker"], ["p4k", "Data.p4k"], ["git", "Git"], ["gh", "GitHub (gh)"],
];

export function PrereqBar({ prereqs }: { prereqs: Prereqs }) {
  return (
    <div className="prereqs">
      <span className="lbl">Prérequis :</span>
      {LABELS.map(([k, label]) => (
        <span key={k} className={prereqs[k] ? "ok" : "ko"}>{prereqs[k] ? "✓" : "✗"} {label}</span>
      ))}
    </div>
  );
}
