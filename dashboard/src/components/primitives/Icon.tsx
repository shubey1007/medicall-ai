import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

// Lucide 0.447 UMD exposes icons as tuple arrays: ["svg", attrs, children].
// We build SVG markup recursively from that tree. This wrapper matches the
// design bundle's primitives.jsx behaviour and avoids pulling in the
// (~500+ icon) lucide-react package.

type LucideNode = [string, Record<string, string | number>, LucideNode[]] | string;

interface LucideGlobal {
  icons?: Record<string, LucideNode | { icon?: LucideNode; toSvg?: (opts: Record<string, unknown>) => string }>;
}

function buildSvg(node: LucideNode, rootAttrs?: Record<string, string | number>): string {
  if (!Array.isArray(node)) return "";
  const [tag, attrs = {}, children = []] = node;
  const merged = { ...attrs, ...(rootAttrs ?? {}) };
  const attrStr = Object.entries(merged)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  const inner = Array.isArray(children) ? children.map((c) => buildSvg(c)).join("") : "";
  return `<${tag} ${attrStr}>${inner}</${tag}>`;
}

function kebabToPascal(s: string): string {
  return s
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export default function Icon({ name, size = 16, strokeWidth = 2, className = "", style }: IconProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lucide = (window as unknown as { lucide?: LucideGlobal }).lucide;
    const icons = lucide?.icons ?? {};
    const pascal = kebabToPascal(name);
    const iconNode = icons[pascal] ?? icons[name];
    el.innerHTML = "";
    if (!iconNode) return;
    if (Array.isArray(iconNode)) {
      el.innerHTML = buildSvg(iconNode as LucideNode, {
        width: size,
        height: size,
        "stroke-width": strokeWidth,
      });
      return;
    }
    if (typeof (iconNode as { toSvg?: unknown }).toSvg === "function") {
      el.innerHTML = (iconNode as { toSvg: (opts: Record<string, unknown>) => string }).toSvg({
        "stroke-width": strokeWidth,
        width: size,
        height: size,
      });
      return;
    }
    const nested = (iconNode as { icon?: LucideNode }).icon;
    if (nested && Array.isArray(nested)) {
      el.innerHTML = buildSvg(nested, {
        width: size,
        height: size,
        "stroke-width": strokeWidth,
      });
    }
  }, [name, size, strokeWidth]);

  return <span ref={ref} className={`ic ${className}`} style={style} />;
}
