import { api, ApiError } from "../api";
import { fmtCatalogNo, fmtDate, h, platformLabel, plural, svgIcon } from "../dom";
import { navigate } from "../router";
import type { Creator, Filters, Post } from "../types";

export interface GalleryState {
  filters: Filters;
  posts: Post[];
  cursor: string | null;
  done: boolean;
  loading: boolean;
}

export function filtersFromParams(params: URLSearchParams, creatorId?: string): Filters {
  return {
    creator: creatorId ?? params.get("creator") ?? undefined,
    platform: params.get("platform") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    unviewed: params.get("unviewed") === "1",
  };
}

function filtersToQuery(f: Filters, omitCreator: boolean): string {
  const q = new URLSearchParams();
  if (f.creator && !omitCreator) q.set("creator", f.creator);
  if (f.platform) q.set("platform", f.platform);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.q) q.set("q", f.q);
  if (f.status) q.set("status", f.status);
  if (f.unviewed) q.set("unviewed", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Index du premier média non consulté, sinon 0. */
export function firstUnviewed(post: Post): number {
  const i = post.media.findIndex((m) => m.downloaded && !m.viewed);
  return i >= 0 ? i : 0;
}

export function renderTile(post: Post, onOpen: (post: Post, index: number) => void): HTMLElement {
  const first = post.media[0];
  const isGroup = post.media.length > 1;
  const unviewed = post.unviewedCount;
  const allViewed = post.mediaCount > 0 && unviewed === 0;
  const thumbSrc = first ? (first.thumbUrl ?? (first.kind === "image" ? first.url : null)) : null;

  const state = post.mediaCount === 0 ? "text" : allViewed ? "viewed" : unviewed < post.media.length ? "partial" : "new";
  const label = [
    `Fiche ${fmtCatalogNo(post.catalogNo)}`,
    post.creator.handle,
    fmtDate(post.publishedAt),
    isGroup ? plural(post.media.length, "élément", "éléments") : null,
    state === "new" ? "non consulté" : state === "partial" ? plural(unviewed, "non vu", "non vus") : state === "viewed" ? "consulté" : null,
    post.status === "deleted" ? "supprimé par l'auteur" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const visual = thumbSrc
    ? h("img", {
        src: thumbSrc,
        alt: "",
        loading: "lazy",
        decoding: "async",
        width: first?.thumbWidth ?? first?.width ?? 320,
        height: first?.thumbHeight ?? first?.height ?? 320,
        onerror: (e: Event) => (e.target as HTMLElement).replaceWith(h("span", { class: "tile-missing" }, "Aperçu indisponible")),
      })
    : post.mediaCount === 0
      ? h("span", { class: "tile-text" }, post.title || post.text.slice(0, 220) || "Publication sans texte")
      : h("span", { class: "tile-missing" }, first?.downloaded ? "Aperçu indisponible" : "Média non téléchargé");

  const badges = h(
    "span",
    { class: "tile-badges" },
    isGroup ? h("span", { class: "badge badge-count" }, svgIcon("stack"), String(post.media.length)) : null,
    first && (first.kind === "video" || first.kind === "gif") ? h("span", { class: "badge badge-kind" }, svgIcon("play"), first.kind === "gif" ? "GIF" : "Vidéo") : null,
    post.status === "deleted" ? h("span", { class: "badge badge-deleted" }, "Supprimé") : null,
  );

  const mark =
    state === "new"
      ? h("span", { class: "mark mark-new" }, "Nouveau")
      : state === "partial"
        ? h("span", { class: "mark mark-partial" }, plural(unviewed, "non vu", "non vus"))
        : null;

  // La fiche : la vignette, puis le talon détachable (créateur, date, numéro d'inventaire).
  return h(
    "li",
    { class: `tile tile-${state}${isGroup ? " tile-group" : ""}`, "data-post-id": post.id },
    h(
      "div",
      { class: "tile-card" },
      h(
        "button",
        {
          type: "button",
          class: "tile-button",
          "aria-label": label,
          onclick: () => onOpen(post, firstUnviewed(post)),
        },
        h("span", { class: "tile-frame" }, visual),
        badges,
        mark,
      ),
      h(
        "p",
        { class: "tile-caption" },
        h("a", { class: "tile-handle", href: `/createur/${encodeURIComponent(post.creator.id)}`, "data-link": true, title: "Voir ce créateur" }, post.creator.handle),
        h(
          "span",
          { class: "tile-line" },
          h("time", { datetime: post.publishedAt }, fmtDate(post.publishedAt)),
          h("span", { class: "catalog-no", "aria-hidden": "true" }, fmtCatalogNo(post.catalogNo)),
        ),
      ),
    ),
  );
}

interface GalleryOptions {
  root: HTMLElement;
  filters: Filters;
  creator?: Creator;
  onOpen: (post: Post, index: number, state: GalleryState) => void;
}

/** Affiche la galerie filtrable ; renvoie l'état partagé avec la visionneuse. */
export async function renderGallery(opts: GalleryOptions): Promise<GalleryState> {
  const { root, filters, creator } = opts;
  const state: GalleryState = { filters, posts: [], cursor: null, done: false, loading: false };
  root.replaceChildren();

  const creators = await api.creators().catch(() => [] as Creator[]);
  const visibleCreators = creators.filter((c) => c.state === "active" || c.state === "paused");

  const applyFilters = (patch: Partial<Filters>) => {
    const next = { ...state.filters, ...patch };
    const base = creator ? `/createur/${encodeURIComponent(creator.id)}` : "/";
    navigate(`${base}${filtersToQuery(next, Boolean(creator))}`, true);
  };

  // --- En-tête ---
  const headed = creator ?? visibleCreators.find((c) => c.id === filters.creator);
  if (headed) {
    const unviewed = visibleCreators.find((c) => c.id === headed.id)?.unviewedCount ?? 0;
    root.append(
      h(
        "section",
        { class: "creator-head" },
        h("h1", {}, headed.displayName || headed.handle),
        h(
          "p",
          { class: "creator-meta" },
          `${platformLabel(headed.platform)}, ${headed.handle}`,
          headed.state === "paused" ? h("span", { class: "pill" }, "Synchronisation désactivée") : null,
        ),
        h(
          "div",
          { class: "creator-actions" },
          h(
            "button",
            {
              type: "button",
              class: "btn",
              disabled: unviewed === 0,
              onclick: async () => {
                await api.setViewed("creator", headed.id, true);
                applyFilters({});
              },
            },
            "Tout marquer consulté",
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-quiet",
              onclick: async () => {
                await api.setViewed("creator", headed.id, false);
                applyFilters({});
              },
            },
            "Tout marquer non consulté",
          ),
          h("a", { class: "btn btn-quiet", href: "/createurs", "data-link": true }, "Gérer les créateurs"),
        ),
      ),
    );
  } else {
    root.append(h("h1", { class: "visually-hidden" }, "Galerie"));
  }

  // --- Filtres ---
  let searchTimer: number | undefined;
  const activeCount = [filters.platform && !creator, filters.creator && !creator, filters.from, filters.to, filters.status, filters.unviewed].filter(Boolean).length;
  const wide = window.matchMedia("(min-width: 64rem)").matches;
  const form = h(
    "form",
    { class: "filters", role: "search", onsubmit: (e: Event) => e.preventDefault() },
    h(
      "label",
      { class: "field field-search" },
      h("span", {}, "Rechercher"),
      h("input", {
        type: "search",
        name: "q",
        value: filters.q ?? "",
        placeholder: "Titre, texte, description",
        oninput: (e: Event) => {
          const value = (e.target as HTMLInputElement).value;
          window.clearTimeout(searchTimer);
          searchTimer = window.setTimeout(() => applyFilters({ q: value || undefined }), 350);
        },
      }),
    ),
    h("details", { class: "filter-more", open: wide || activeCount > 0 },
    h("summary", {}, activeCount > 0 ? `Filtres (${activeCount})` : "Filtres"),
    h("div", { class: "filter-fields" },
    creator
      ? null
      : h(
          "label",
          { class: "field" },
          h("span", {}, "Créateur"),
          h(
            "select",
            { name: "creator", onchange: (e: Event) => applyFilters({ creator: (e.target as HTMLSelectElement).value || undefined }) },
            h("option", { value: "" }, "Tous"),
            ...visibleCreators.map((c) => h("option", { value: c.id, selected: c.id === filters.creator }, c.handle)),
          ),
        ),
    creator
      ? null
      : h(
          "label",
          { class: "field" },
          h("span", {}, "Plateforme"),
          h(
            "select",
            { name: "platform", onchange: (e: Event) => applyFilters({ platform: (e.target as HTMLSelectElement).value || undefined }) },
            h("option", { value: "" }, "Toutes"),
            h("option", { value: "bluesky", selected: filters.platform === "bluesky" }, "Bluesky"),
            h("option", { value: "mastodon", selected: filters.platform === "mastodon" }, "Mastodon"),
            h("option", { value: "reddit", selected: filters.platform === "reddit" }, "Reddit"),
          ),
        ),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Du"),
      h("input", { type: "date", value: filters.from ?? "", onchange: (e: Event) => applyFilters({ from: (e.target as HTMLInputElement).value || undefined }) }),
    ),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Au"),
      h("input", { type: "date", value: filters.to ?? "", onchange: (e: Event) => applyFilters({ to: (e.target as HTMLInputElement).value || undefined }) }),
    ),
    h(
      "label",
      { class: "field" },
      h("span", {}, "Statut"),
      h(
        "select",
        { onchange: (e: Event) => applyFilters({ status: (e.target as HTMLSelectElement).value || undefined }) },
        h("option", { value: "" }, "Toutes"),
        h("option", { value: "active", selected: filters.status === "active" }, "En ligne"),
        h("option", { value: "deleted", selected: filters.status === "deleted" }, "Supprimées par l'auteur"),
      ),
    ),
    h(
      "label",
      { class: "check" },
      h("input", { type: "checkbox", checked: Boolean(filters.unviewed), onchange: (e: Event) => applyFilters({ unviewed: (e.target as HTMLInputElement).checked }) }),
      h("span", {}, "Non consultés seulement"),
    ),
    )),
  );
  root.append(form);

  // --- Grille ---
  const grid = h("ul", { class: "grid", "aria-label": "Publications" });
  const status = h("p", { class: "status", role: "status" });
  const more = h("button", { type: "button", class: "btn more", hidden: true, onclick: () => void loadMore() }, "Afficher plus");
  root.append(grid, status, more);

  const open = (post: Post, index: number) => opts.onOpen(post, index, state);

  async function loadMore(): Promise<void> {
    if (state.loading || state.done) return;
    state.loading = true;
    status.textContent = "Chargement…";
    try {
      const page = await api.posts(state.filters, state.cursor);
      state.posts.push(...page.posts);
      state.cursor = page.nextCursor;
      state.done = page.nextCursor === null;
      grid.append(...page.posts.map((p) => renderTile(p, open)));
      status.textContent = "";
      if (state.posts.length === 0) {
        status.replaceChildren(emptyMessage(state.filters, visibleCreators.length));
      }
    } catch (e) {
      status.textContent = e instanceof ApiError ? e.message : "Impossible de charger les publications. Vérifiez la connexion, puis réessayez.";
    } finally {
      state.loading = false;
      more.hidden = state.done;
    }
  }

  const sentinel = h("div", { class: "sentinel", "aria-hidden": "true" });
  root.append(sentinel);
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void loadMore();
  }, { rootMargin: "800px" }).observe(sentinel);

  await loadMore();
  return state;
}

function emptyMessage(f: Filters, creatorCount: number): HTMLElement {
  if (creatorCount === 0) {
    return h("span", {}, "Aucun créateur suivi pour l'instant. ", h("a", { href: "/createurs", "data-link": true }, "Ajoutez un créateur"), " pour commencer l'archive.");
  }
  const filtered = f.q || f.from || f.to || f.status || f.unviewed || f.platform;
  return h(
    "span",
    {},
    filtered
      ? "Aucune publication ne correspond à ces filtres. Retirez un filtre pour élargir la recherche."
      : "Aucune publication archivée pour l'instant. La prochaine synchronisation a lieu dans moins de 15 minutes.",
  );
}

/** Met à jour une tuile après un changement d'état de consultation. */
export function refreshTile(grid: Element | null, post: Post, onOpen: (post: Post, index: number) => void): void {
  if (!grid) return;
  const tiles = [...grid.querySelectorAll<HTMLElement>(".tile")];
  const index = tiles.findIndex((t) => t.dataset["postId"] === post.id);
  const fresh = renderTile(post, onOpen);
  if (index >= 0) tiles[index]?.replaceWith(fresh);
}
