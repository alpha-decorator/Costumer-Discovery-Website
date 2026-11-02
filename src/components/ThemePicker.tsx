"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/components/I18nProvider";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { PALETTES, type PaletteId } from "@/lib/palette";

/** Top-bar button that opens a small menu of colour themes. Choosing one also switches to that theme's light or dark mode. */
export function ThemePicker() {
  const { lang } = useI18n();
  const { setTheme, palette: active, setPalette } = useWorkspace();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const label = lang === "hi" ? "थीम" : "Theme";

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const choose = (id: PaletteId, mode: "light" | "dark") => { setPalette(id); setTheme(mode); setOpen(false); };

  return <div className="fn-theme" ref={box}>
    <button className="icon-button fn-theme-button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((value) => !value)}><Icon name="palette" size={17} /></button>
    {open && <div className="fn-theme-menu" role="menu" aria-label={label}>
      <p className="eyebrow">{label}</p>
      {PALETTES.map((palette) => <button key={palette.id} role="menuitemradio" aria-checked={active === palette.id} className={`fn-theme-item${active === palette.id ? " on" : ""}`} onClick={() => choose(palette.id, palette.mode)}>
        <span className="fn-theme-swatch" style={{ background: `linear-gradient(135deg, ${palette.swatch[0]}, ${palette.swatch[1]} 60%, ${palette.swatch[2]})` }} />
        <span className="fn-theme-name" style={{ fontFamily: palette.font }}>{lang === "hi" ? palette.hi : palette.en}<small>{palette.tagline}</small></span>
        {active === palette.id && <span className="fn-theme-check">✓</span>}
      </button>)}
    </div>}
  </div>;
}
