import { runStream } from "./stream";
import type { PublishEvent, PublishOptions, PublishSummary } from "../shared/types";

// Construit les arguments de scripts/publish.mjs à partir des options UI.
// SÉCURITÉ : --confirm et --push (effets de bord : upload Release + écriture +
// push git) ne sont ajoutés QUE si confirm===true, c.-à-d. sur action user
// explicite (2e clic « Confirmer »). Sans confirm => dry-run pur.
export function publishArgs({ keys, confirm }: PublishOptions): string[] {
  if (!keys.length) throw new Error("Aucune clé à publier.");
  const args = [`--only=${keys.join(",")}`, "--json"];
  if (confirm) args.push("--confirm", "--push");
  return args;
}

type IpcSender = { send(channel: string, evt: unknown): void };

// Spawn publish.mjs en streamant ses événements NDJSON vers le renderer.
// Résout sur l'événement terminal "done" (dry-run ou réel).
export async function runPublish(
  sender: IpcSender,
  opts: PublishOptions,
  ctx: { cwd: string },
): Promise<PublishSummary> {
  const done = await runStream<PublishEvent>("scripts/publish.mjs", publishArgs(opts), {
    cwd: ctx.cwd,
    resultType: "done",
    onEvent: (evt) => sender.send("publish:event", evt),
  }).done;
  if (done.type !== "done") throw new Error("La publication n'a pas émis de résultat.");
  const { type: _t, ...summary } = done;
  return summary;
}
