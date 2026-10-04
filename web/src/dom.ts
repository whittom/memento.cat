type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Crée un élément. Les attributs on* reçoivent des écouteurs ; false/null les omettent. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function svgIcon(name: "stack" | "play" | "close" | "prev" | "next" | "external" | "zoom-in" | "zoom-out" | "duplicate"): SVGSVGElement {
  const paths: Record<string, string> = {
    stack: "M4 7h11v11H4z M7 4h13v13",
    play: "M8 5v14l11-7z",
    close: "M6 6l12 12M18 6L6 18",
    prev: "M15 5l-7 7 7 7",
    next: "M9 5l7 7-7 7",
    external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
    "zoom-in": "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5M10.5 7.5v6M7.5 10.5h6",
    "zoom-out": "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5M7.5 10.5h6",
    duplicate: "M9 9h11v11H9z M5 15V4h11",
  };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", paths[name] ?? "");
  svg.append(path);
  return svg;
}

const dateFmt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" });

export const fmtDate = (iso: string): string => dateFmt.format(new Date(iso));
export const fmtDateTime = (iso: string): string => dateTimeFmt.format(new Date(iso));

/** Numéro d'inventaire du catalogue, sur quatre chiffres au moins : « n° 0042 ». */
export const fmtCatalogNo = (n: number): string => `n° ${String(n).padStart(4, "0")}`;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} ${units[i]}`;
}

export const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("fr-CA")} ${n > 1 ? many : one}`;

let toastTimer: number | undefined;
export function toast(message: string): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 4000);
}

const PLATFORM_LABELS: Record<string, string> = { bluesky: "Bluesky", reddit: "Reddit", mastodon: "Mastodon" };
export const platformLabel = (p: string): string => PLATFORM_LABELS[p] ?? p;

const present = (children: Child[]): (Node | string)[] =>
  children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false);

/** replaceChildren qui ignore les enfants absents. */
export function setChildren(el: Element, ...children: Child[]): void {
  el.replaceChildren(...present(children));
}

/** append qui ignore les enfants absents. */
export function addChildren(el: Element, ...children: Child[]): void {
  el.append(...present(children));
}
