// Icônes SVG (style lucide) inline — pas de dépendance externe.
const PATHS: Record<string, string> = {
  cube: "M12 2 2 7l10 5 10-5-10-5Z|M2 17l10 5 10-5|M2 12l10 5 10-5",
  ship: "M12 2C8 6 8 10 8 14l-2 6h12l-2-6c0-4 0-8-4-12Z",
  search: "M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0|m21 21-4.3-4.3",
  grid: "M3 3h7v7H3z|M14 3h7v7h-7z|M3 14h7v7H3z|M14 14h7v7h-7z",
  chart: "M3 3v18h18|m19 9-5 5-4-4-3 3",
  list: "M11 12H3|M16 6H3|M16 18H3|m19 10 3 3-3 3",
  upload: "M12 2v13|m5 9 7-7 7 7|M4 15h16v6H4z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3",
  check: "M20 6 9 17l-5-5",
  alert: "M12 9v4|M12 17h.01|M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-15 6.7L3 16|M3 21v-5h5",
  scan: "M3 7V5a2 2 0 0 1 2-2h2|M17 3h2a2 2 0 0 1 2 2v2|M21 17v2a2 2 0 0 1-2 2h-2|M7 21H5a2 2 0 0 1-2-2v-2|M7 12h10",
};

export function Icon({ name, stroke = "currentColor" }: { name: string; stroke?: string }) {
  const d = PATHS[name] ?? "";
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split("|").map((seg, i) => <path key={i} d={seg} />)}
    </svg>
  );
}
