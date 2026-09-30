import "./styles.css";
import { api, ApiError } from "./api";
import { h } from "./dom";
import { navigate, onNavigate, parseRoute, type Route } from "./router";
import type { Creator, Post } from "./types";
import { renderCreators } from "./views/creators";
import { filtersFromParams, refreshTile, renderGallery, type GalleryState } from "./views/gallery";
import { openViewer, type Viewer } from "./views/viewer";
import { flushPendingViews } from "./views-queue";

const main = document.getElementById("main") as HTMLElement;

let galleryKey: string | null = null;
let gallery: GalleryState | null = null;
let galleryUrl = "/";
let viewer: Viewer | null = null;
let viewerPushed = false;
let closingFromRoute = false;

function postUrl(post: Post, media: number): string {
  return `/publication/${encodeURIComponent(post.id)}${media > 0 ? `?media=${media}` : ""}`;
}

function openInViewer(post: Post, mediaIndex: number, state: GalleryState, pushed: boolean): void {
  let index = state.posts.findIndex((p) => p.id === post.id);
  if (index < 0) {
    state.posts.unshift(post);
    index = 0;
  }
  viewerPushed = pushed;
  viewer?.close();
  viewer = openViewer({
    posts: state.posts,
    postIndex: index,
    mediaIndex: Math.min(mediaIndex, Math.max(0, post.media.length - 1)),
    onMove: (p, m) => history.replaceState(history.state, "", postUrl(p, m)),
    onChange: (p) => refreshTile(main.querySelector(".grid"), p, (pp, i) => openFromGallery(pp, i, state)),
    onClose: () => {
      viewer = null;
      const lastId = location.pathname.startsWith("/publication/")
        ? decodeURIComponent(location.pathname.slice("/publication/".length))
        : null;
      if (!closingFromRoute) {
        if (viewerPushed) history.back();
        else navigate(galleryUrl, true);
      }
      closingFromRoute = false;
      // Rendre le focus à la tuile (elle a pu être redessinée entre-temps).
      const tile = lastId ? main.querySelector<HTMLElement>(`.tile[data-post-id="${CSS.escape(lastId)}"] .tile-button`) : null;
      tile?.focus();
    },
  });
}

function openFromGallery(post: Post, mediaIndex: number, state: GalleryState): void {
  history.pushState({ viewer: true }, "", postUrl(post, mediaIndex));
  openInViewer(post, mediaIndex, state, true);
}

function setNav(route: Route): void {
  const section = route.name === "creators" ? "creators" : "gallery";
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-nav]")) {
    if (a.dataset["nav"] === section) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

async function showGallery(route: Extract<Route, { name: "gallery" | "creator" }>): Promise<GalleryState> {
  const key = location.pathname + location.search;
  if (galleryKey === key && gallery) return gallery;
  galleryKey = key;
  galleryUrl = key;

  let creator: Creator | undefined;
  if (route.name === "creator") {
    const creators = await api.creators();
    creator = creators.find((c) => c.id === route.id && (c.state === "active" || c.state === "paused"));
    if (!creator) {
      main.replaceChildren(h("h1", {}, "Créateur introuvable"), h("p", {}, "Ce créateur n'est plus suivi ou se trouve dans la corbeille. ", h("a", { href: "/createurs", "data-link": true }, "Gérer les créateurs")));
      gallery = null;
      return { filters: {}, posts: [], cursor: null, done: true, loading: false };
    }
  }
  const state = await renderGallery({
    root: main,
    filters: filtersFromParams(route.params, creator?.id),
    creator,
    onOpen: (post, index, s) => openFromGallery(post, index, s),
  });
  gallery = state;
  document.title = creator ? `${creator.handle}, memento` : "memento";
  return state;
}

async function render(): Promise<void> {
  const route = parseRoute(location);
  setNav(route);

  if (route.name === "post") {
    if (viewer && gallery) {
      const index = gallery.posts.findIndex((p) => p.id === route.id);
      if (index >= 0) {
        viewer.goTo(index, route.media);
        return;
      }
    }
    try {
      const post = await api.post(route.id);
      if (!gallery) {
        // Accès direct : la galerie du créateur sert de fond et de liste de navigation.
        galleryUrl = `/createur/${encodeURIComponent(post.creator.id)}`;
        history.replaceState(null, "", galleryUrl);
        const state = await showGallery({ name: "creator", id: post.creator.id, params: new URLSearchParams() });
        history.pushState({ viewer: true }, "", postUrl(post, route.media));
        openInViewer(post, route.media, state, true);
      } else {
        openInViewer(post, route.media, gallery, false);
      }
    } catch (e) {
      main.replaceChildren(h("h1", {}, "Publication introuvable"), h("p", {}, e instanceof ApiError ? e.message : "Chargement impossible."), h("p", {}, h("a", { href: "/", "data-link": true }, "Retour à la galerie")));
    }
    return;
  }

  if (viewer) {
    closingFromRoute = true;
    viewer.close();
  }

  if (route.name === "creators") {
    galleryKey = null;
    gallery = null;
    document.title = "Créateurs, memento";
    await renderCreators(main);
    return;
  }
  await showGallery(route);
}

onNavigate(() => void render());
void flushPendingViews();
void render();

