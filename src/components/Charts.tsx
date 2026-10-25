"use client";

import { useState, type PointerEvent } from "react";
import { signed } from "@/lib/customers";

/** Sentiment radar: every axis runs from -1 (centre) to +1 (outer ring). The filled shape is the main series; dashed is the comparison. */
export type RadarSeries = { name: string; values: number[]; dashed?: boolean; color?: string };

export function Radar({ labels, series }: { labels: string[]; series: RadarSeries[] }) {
  const center = 160, radius = 100, count = labels.length;
  const angle = (index: number) => -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const at = (index: number, scale: number) => `${(center + radius * scale * Math.cos(angle(index))).toFixed(1)},${(center + radius * scale * Math.sin(angle(index))).toFixed(1)}`;
  const point = (index: number, value: number) => at(index, (Math.max(-1, Math.min(1, value)) + 1) / 2);
  const rings = [0.25, 0.5, 0.75, 1];
  return <div className="fn-radar">
    <svg viewBox="0 0 320 320" role="img" aria-label={series.map((item) => item.name).join(", ")}>
      {rings.map((level) => <polygon key={level} className={level === 0.5 ? "fn-ring fn-ring-zero" : "fn-ring"} points={labels.map((_, index) => at(index, level)).join(" ")} />)}
      {labels.map((_, index) => <line key={index} className="fn-axis" x1={center} y1={center} x2={center + radius * Math.cos(angle(index))} y2={center + radius * Math.sin(angle(index))} />)}
      {series.map((item) => <polygon key={item.name} points={item.values.map((value, index) => point(index, value)).join(" ")} fill={item.dashed ? "none" : item.color ?? "var(--s1)"} fillOpacity={item.dashed ? 0 : 0.22} stroke={item.dashed ? "var(--muted)" : item.color ?? "var(--s1)"} strokeWidth={item.dashed ? 1.6 : 2.2} strokeDasharray={item.dashed ? "5 4" : undefined} strokeLinejoin="round" />)}
      {labels.map((label, index) => {
        const x = center + (radius + 30) * Math.cos(angle(index));
        const y = center + (radius + 30) * Math.sin(angle(index));
        const anchor = Math.cos(angle(index)) < -0.2 ? "end" : Math.cos(angle(index)) > 0.2 ? "start" : "middle";
        return <text key={label} className="fn-axis-label" x={x} y={y + 4} textAnchor={anchor}>{label}</text>;
      })}
    </svg>
    <ul className="fn-legend">{series.map((item) => <li key={item.name}><i className={item.dashed ? "dash" : ""} style={item.dashed ? undefined : { background: item.color ?? "var(--s1)" }} />{item.name}</li>)}</ul>
  </div>;
}

/** Sentiment over time. Hover or touch moves a marker along the line and shows the value for that customer. */
export function AreaLine({ points, label }: { points: Array<{ label: string; value: number }>; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 600, height = 230, left = 40, right = 14, top = 14, bottom = 30;
  const innerWidth = width - left - right, innerHeight = height - top - bottom;
  const x = (index: number) => points.length === 1 ? left + innerWidth / 2 : left + (index * innerWidth) / (points.length - 1);
  const y = (value: number) => top + ((1 - value) / 2) * innerHeight;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${x(points.length - 1).toFixed(1)},${y(-1)} L${x(0).toFixed(1)},${y(-1)} Z` : "";
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - box.left) / box.width) * width;
    let best = 0;
    points.forEach((_, index) => { if (Math.abs(x(index) - svgX) < Math.abs(x(best) - svgX)) best = index; });
    setHover(best);
  };
  const hovered = hover !== null ? points[hover] : null;
  return <div className="fn-area">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove}>
      {[1, 0, -1].map((level) => <g key={level}>
        <line className={level === 0 ? "fn-grid-line fn-grid-zero" : "fn-grid-line"} x1={left} x2={width - right} y1={y(level)} y2={y(level)} />
        <text className="fn-axis-text" x={left - 8} y={y(level) + 4} textAnchor="end">{level > 0 ? `+${level}` : level}</text>
      </g>)}
      {points.length > 0 && <path className="fn-area-fill" d={area} />}
      {points.length > 0 && <path className="fn-area-line" d={line} fill="none" />}
      {hover !== null && points[hover] && <>
        <line className="fn-grid-line" x1={x(hover)} x2={x(hover)} y1={top} y2={y(-1)} />
        <circle className="fn-area-dot" cx={x(hover)} cy={y(points[hover].value)} r={5} />
      </>}
      {points.length > 0 && <>
        <text className="fn-axis-text" x={x(0)} y={height - 8} textAnchor="start">{points[0].label}</text>
        {points.length > 1 && <text className="fn-axis-text" x={x(points.length - 1)} y={height - 8} textAnchor="end">{points[points.length - 1].label}</text>}
      </>}
    </svg>
    {hovered && hover !== null && <div className="fn-tip" style={{ left: `${(x(hover) / width) * 100}%` }}><strong>{signed(hovered.value)}</strong><span>{hovered.label}</span></div>}
  </div>;
}

/** Part of a whole, at most six parts. Each part has a hover title and a legend row with its count and share. */
export function Donut({ parts, centre, label }: { parts: Array<{ label: string; value: number; color: string }>; centre: string; label: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 60, circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div className="fn-donut">
    <svg viewBox="0 0 160 160" role="img" aria-label={label}>
      <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--line)" strokeWidth="20" />
      {total > 0 && parts.map((part) => {
        const length = (part.value / total) * circumference;
        const segment = <circle key={part.label} cx="80" cy="80" r={radius} fill="none" stroke={part.color} strokeWidth="20" strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)"><title>{`${part.label}: ${part.value}`}</title></circle>;
        offset += length;
        return segment;
      })}
      <text className="fn-donut-total" x="80" y="80" textAnchor="middle">{centre}</text>
    </svg>
    <ul className="fn-legend fn-legend-col">{parts.map((part) => <li key={part.label}><i style={{ background: part.color }} />{part.label} <b>{part.value}</b>{total > 0 && <small>{Math.round((part.value / total) * 100)}%</small>}</li>)}</ul>
  </div>;
}

/** A single value on the -1 to +1 scale, shown as a marker on a gradient (orange = negative, blue = positive). */
export function ScaleBar({ value }: { value: number }) {
  const position = Math.max(0, Math.min(100, (value + 1) * 50));
  return <div className="fn-scale" role="img" aria-label={`${signed(value)} on a scale from -1 to +1`}>
    <div className="fn-scale-track"><i style={{ left: `${position}%` }} /></div>
    <div className="fn-scale-ticks"><span>−1</span><span>0</span><span>+1</span></div>
  </div>;
}

/** Counts as horizontal bars. Every row keeps its number, so the bar is never the only reading. */
export function HBars({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const total = Math.max(1, rows.reduce((sum, row) => sum + row.value, 0));
  return <ul className="fn-hbars">
    {rows.map((row) => <li key={row.label}><span>{row.label}</span><span className="fn-hbar-track" aria-hidden="true"><i style={{ width: `${(row.value / total) * 100}%`, background: row.color }} /></span><b>{row.value}</b></li>)}
  </ul>;
}
