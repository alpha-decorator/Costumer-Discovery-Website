"use client";

import { useMemo, useState } from "react";
import outline from "@/lib/india-outline.json";

/** One place on the map: a city, or the centre of a state when only the state is known. */
export type MapPoint = { key: string; label: string; lat: number; lon: number; count: number; sentiment: number };

// India's outline (Natural Earth, public domain) drawn flat: longitude scaled by cos(22°) so the shape is not stretched.
const K = Math.cos((22 * Math.PI) / 180);
const SCALE = 14;
const project = (lon: number, lat: number): [number, number] => [(lon - 67.5) * K * SCALE + 12, (37.6 - lat) * SCALE + 12];
const PATH = (outline as { rings: number[][][] }).rings
  .map((ring) => `M${ring.map(([lon, lat]) => project(lon, lat).map((n) => n.toFixed(1)).join(",")).join("L")}Z`).join("");
const WIDTH = Math.ceil(project(97.6, 0)[0] + 12);
const HEIGHT = Math.ceil(project(0, 6.5)[1] + 12);

const toneOf = (score: number) => score > 0.15 ? "pos" : score < -0.15 ? "neg" : "neu";

/** A simple, light SVG map of India with one circle per place: size = number of interviews, colour = average opinion. */
export function IndiaMap({ points, label, describe }: { points: MapPoint[]; label: string; describe: (point: MapPoint) => string }) {
  const [hover, setHover] = useState<MapPoint | null>(null);
  const max = Math.max(1, ...points.map((point) => point.count));
  // Big circles first so small ones stay on top and can still be hovered.
  const ordered = useMemo(() => [...points].sort((a, b) => b.count - a.count), [points]);

  return <div className="fn-india">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      <path className="fn-india-land" d={PATH} />
      {ordered.map((point) => {
        const [x, y] = project(point.lon, point.lat);
        const r = 5 + 13 * Math.sqrt(point.count / max);
        return <g key={point.key} className={`fn-india-dot ${toneOf(point.sentiment)}${hover?.key === point.key ? " on" : ""}`}
          onMouseEnter={() => setHover(point)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(point)} onBlur={() => setHover(null)} tabIndex={0}>
          <circle cx={x} cy={y} r={r + 4} className="halo" />
          <circle cx={x} cy={y} r={r} />
          <title>{`${point.label}: ${describe(point)}`}</title>
        </g>;
      })}
    </svg>
    {hover && (() => {
      const [x, y] = project(hover.lon, hover.lat);
      return <div className="fn-india-tip" style={{ left: `${(x / WIDTH) * 100}%`, top: `${(y / HEIGHT) * 100}%` }} aria-hidden="true"><strong>{hover.label}</strong><span>{describe(hover)}</span></div>;
    })()}
  </div>;
}
