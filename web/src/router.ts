export type Route =
  | { name: "gallery"; params: URLSearchParams }
  | { name: "creator"; id: string; params: URLSearchParams }
  | { name: "post"; id: string; media: number }
  | { name: "creators" };

export function parseRoute(location: Location): Route {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(location.search);
  const creator = /^\/createur\/(.+)$/.exec(path);
  if (creator?.[1]) return { name: "creator", id: decodeURIComponent(creator[1]), params };
  const post = /^\/publication\/(.+)$/.exec(path);
  if (post?.[1]) return { name: "post", id: decodeURIComponent(post[1]), media: Math.max(0, Number(params.get("media") ?? 0) || 0) };
  if (path === "/createurs") return { name: "creators" };
  return { name: "gallery", params };
}

type Listener = () => void;
const listeners: Listener[] = [];

export function onNavigate(fn: Listener): void {
  listeners.push(fn);
}

export function navigate(url: string, replace = false): void {
  if (replace) history.replaceState(history.state, "", url);
  else history.pushState(null, "", url);
  for (const fn of listeners) fn();
}

/** Redessine la vue courante à partir de l'API, même si l'adresse n'a pas changé. */
export function refreshView(): void {
  window.dispatchEvent(new Event("memento:refresh"));
}

window.addEventListener("popstate", () => {
  for (const fn of listeners) fn();
});

/** Intercepte les liens internes marqués data-link. */
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest("a[data-link]");
  if (!(a instanceof HTMLAnchorElement)) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute("href") ?? "/");
});
