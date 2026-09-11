import { describe, it, expect } from "vitest";
import { publishArgs } from "./publish";

describe("publishArgs", () => {
  it("dry-run par défaut : --only + --json, PAS de --confirm/--push", () => {
    const args = publishArgs({ keys: ["DRAK_Clipper", "AEGS_Avenger_Titan"], confirm: false });
    expect(args).toEqual(["--only=DRAK_Clipper,AEGS_Avenger_Titan", "--json"]);
    expect(args).not.toContain("--confirm");
    expect(args).not.toContain("--push");
  });

  it("confirm===true : ajoute --confirm ET --push (effets de bord)", () => {
    const args = publishArgs({ keys: ["DRAK_Clipper"], confirm: true });
    expect(args).toEqual(["--only=DRAK_Clipper", "--json", "--confirm", "--push"]);
  });

  it("refuse une liste de clés vide (pas de publication globale accidentelle)", () => {
    expect(() => publishArgs({ keys: [], confirm: false })).toThrow(/clé/i);
  });
});
