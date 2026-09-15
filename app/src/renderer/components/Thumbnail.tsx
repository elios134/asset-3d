import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

// Vignette vaisseau, chargée PARESSEUSEMENT (IntersectionObserver) via api.getThumbnail
// et mémorisée en module (pas de re-fetch au filtrage/scroll). Repli = silhouette.
// Cache partagé : name -> data URL | null (null = pas de vignette).
const cache = new Map<string, string | null>();

export function Thumbnail({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(() => cache.get(name) ?? null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (cache.has(name)) { setSrc(cache.get(name) ?? null); return; }
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      io.disconnect();
      api.getThumbnail(name)
        .then((d) => { cache.set(name, d); if (!cancelled) setSrc(d); })
        .catch(() => { cache.set(name, null); });
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [name]);

  return (
    <span ref={ref} className="thumbwrap">
      {src ? <img src={src} alt="" className="thumbimg" /> : <Icon name="ship" />}
    </span>
  );
}
