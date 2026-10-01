import { api } from "../api";
import { fmtCatalogNo, fmtDate, fmtDateTime, h, platformLabel, setChildren, svgIcon, toast } from "../dom";
import type { Media, Post } from "../types";
import { markViewed } from "../views-queue";

export interface ViewerOptions {
  /** Publications voisines (ordre de la galerie), pour passer d'une publication à l'autre. */
  posts: Post[];
  postIndex: number;
  mediaIndex: number;
  /** Appelé à chaque changement de média (met à jour l'URL). */
  onMove: (post: Post, mediaIndex: number) => void;
  /** Appelé après un changement d'état consulté / non consulté. */
  onChange: (post: Post) => void;
  onClose: () => void;
}

export interface Viewer {
  close: () => void;
  goTo: (postIndex: number, mediaIndex: number) => void;
}

function recount(post: Post): void {
  post.unviewedCount = post.media.filter((m) => m.downloaded && !m.viewed).length;
}

/** Visionneuse plein écran : version complète, navigation dans le groupe puis entre publications. */
export function openViewer(opts: ViewerOptions): Viewer {
  const root = document.getElementById("viewer-root");
  if (!root) throw new Error("viewer-root manquant");
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let postIndex = opts.postIndex;
  let mediaIndex = opts.mediaIndex;

  const stage = h("div", { class: "viewer-stage" });
  const position = h("p", { class: "viewer-position", "aria-live": "polite" });
  const strip = h("ol", { class: "viewer-strip", "aria-label": "Éléments du groupe" });
  const info = h("div", { class: "viewer-info" });
  const actions = h("div", { class: "viewer-actions" });

  const prevBtn = h("button", { type: "button", class: "viewer-nav viewer-prev", "aria-label": "Précédent", onclick: () => step(-1) }, svgIcon("prev"));
  const nextBtn = h("button", { type: "button", class: "viewer-nav viewer-next", "aria-label": "Suivant", onclick: () => step(1) }, svgIcon("next"));
  const closeBtn = h("button", { type: "button", class: "viewer-close", "aria-label": "Fermer", onclick: () => close() }, svgIcon("close"));

  const dialog = h(
    "div",
    { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Visionneuse" },
    h("div", { class: "viewer-top" }, position, closeBtn),
    h("div", { class: "viewer-body" }, prevBtn, stage, nextBtn),
    strip,
    h("details", { class: "viewer-details" }, h("summary", {}, "Détails de la publication"), info, actions),
  );
  root.replaceChildren(dialog);
  document.body.classList.add("viewer-open");

  const current = (): Post | undefined => opts.posts[postIndex];

  function step(delta: number): void {
    const post = current();
    if (!post) return;
    const count = Math.max(1, post.media.length);
    const nextMedia = mediaIndex + delta;
    if (nextMedia >= 0 && nextMedia < count) {
      goTo(postIndex, nextMedia);
    } else if (delta > 0 && postIndex < opts.posts.length - 1) {
      goTo(postIndex + 1, 0);
    } else if (delta < 0 && postIndex > 0) {
      const prev = opts.posts[postIndex - 1];
      goTo(postIndex - 1, Math.max(0, (prev?.media.length ?? 1) - 1));
    }
  }

  function renderMedia(post: Post, media: Media | undefined): HTMLElement {
    if (!media) {
      return h("article", { class: "viewer-text" }, post.title ? h("h2", {}, post.title) : null, h("p", {}, post.text || "Publication sans texte"));
    }
    if (!media.downloaded || !media.url) {
      return h(
        "div",
        { class: "viewer-missing" },
        h("p", {}, "Ce média n'a pas été archivé (trop volumineux ou indisponible au moment de la capture)."),
        h("a", { href: media.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, "Ouvrir l'original"),
      );
    }
    if (media.kind === "image") {
      return h("img", {
        src: media.url,
        alt: media.description ?? "",
        width: media.width ?? undefined,
        height: media.height ?? undefined,
        decoding: "async",
      });
    }
    return h("video", {
      src: media.url,
      poster: media.thumbUrl ?? undefined,
      controls: true,
      playsinline: true,
      preload: "metadata",
      loop: media.kind === "gif",
      "aria-label": media.description ?? "Vidéo",
    });
  }

  function renderInfo(post: Post, media: Media | undefined): void {
    setChildren(
      info,
      post.status === "deleted"
        ? h("p", { class: "notice-deleted" }, `Supprimée par l'auteur (constaté le ${post.deletedSeenAt ? fmtDate(post.deletedSeenAt) : "?"}). Copie archivée conservée.`)
        : null,
      post.title ? h("h2", { class: "viewer-title" }, post.title) : null,
      post.text ? h("p", { class: "viewer-body-text" }, post.text) : null,
      media?.description ? h("p", { class: "viewer-alt" }, h("strong", {}, "Description du média : "), media.description) : null,
      h(
        "dl",
        { class: "viewer-meta" },
        h("dt", {}, "Fiche"),
        h("dd", { class: "catalog-no" }, fmtCatalogNo(post.catalogNo)),
        h("dt", {}, "Créateur"),
        h("dd", {}, `${post.creator.handle} (${platformLabel(post.creator.platform)})`),
        h("dt", {}, "Publiée"),
        h("dd", {}, fmtDateTime(post.publishedAt)),
        h("dt", {}, "Archivée"),
        h("dd", {}, fmtDateTime(post.capturedAt)),
      ),
      h("a", { class: "viewer-source", href: post.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, "Voir sur ", platformLabel(post.creator.platform), svgIcon("external")),
    );

    const mediaViewed = media?.viewed ?? false;
    setChildren(
      actions,
      media && media.downloaded
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-quiet",
              onclick: async () => {
                await api.setViewed("media", post.id, !media.viewed, media.position);
                media.viewed = !media.viewed;
                recount(post);
                opts.onChange(post);
                render();
                toast(media.viewed ? "Média marqué consulté" : "Média marqué non consulté");
              },
            },
            mediaViewed ? "Marquer ce média non consulté" : "Marquer ce média consulté",
          )
        : null,
      post.media.length > 1
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-quiet",
              onclick: async () => {
                const viewed = post.unviewedCount > 0;
                await api.setViewed("post", post.id, viewed);
                for (const m of post.media) m.viewed = viewed;
                recount(post);
                opts.onChange(post);
                render();
                toast(viewed ? "Publication marquée consultée" : "Publication marquée non consultée");
              },
            },
            post.unviewedCount > 0 ? "Marquer tout le groupe consulté" : "Marquer tout le groupe non consulté",
          )
        : null,
    );
  }

  function render(): void {
    const post = current();
    if (!post) return close();
    const media = post.media[mediaIndex];
    const count = post.media.length;

    stage.replaceChildren(renderMedia(post, media));
    setChildren(
      position,
      h("span", { class: "viewer-handle" }, post.creator.handle),
      h("span", {}, fmtDate(post.publishedAt)),
      count > 1 ? h("span", { class: "viewer-count" }, `${mediaIndex + 1}/${count}`) : null,
    );

    strip.hidden = count <= 1;
    strip.replaceChildren(
      ...post.media.map((m, i) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: `strip-item${i === mediaIndex ? " is-current" : ""}${m.viewed ? "" : " is-new"}`,
              "aria-label": `Élément ${i + 1} sur ${count}${m.viewed ? "" : ", non consulté"}`,
              "aria-current": i === mediaIndex ? "true" : undefined,
              onclick: () => goTo(postIndex, i),
            },
            m.thumbUrl || (m.kind === "image" && m.url)
              ? h("img", { src: m.thumbUrl ?? m.url ?? "", alt: "", loading: "lazy" })
              : h("span", {}, String(i + 1)),
          ),
        ),
      ),
    );

    const atStart = postIndex === 0 && mediaIndex === 0;
    const atEnd = postIndex === opts.posts.length - 1 && mediaIndex >= count - 1;
    prevBtn.disabled = atStart;
    nextBtn.disabled = atEnd;

    renderInfo(post, media);
    preloadNext();
  }

  function preloadNext(): void {
    const post = current();
    const next = post?.media[mediaIndex + 1] ?? opts.posts[postIndex + 1]?.media[0];
    if (next?.kind === "image" && next.url) {
      const img = new Image();
      img.src = next.url;
    }
  }

  function goTo(p: number, m: number): void {
    postIndex = p;
    mediaIndex = m;
    const post = current();
    const media = post?.media[m];
    if (post && media && media.downloaded && !media.viewed) {
      media.viewed = true;
      recount(post);
      markViewed(post.id, media.position);
      opts.onChange(post);
    }
    render();
    if (post) opts.onMove(post, m);
  }

  // --- Clavier, focus et gestes ---
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight") {
      step(1);
    } else if (e.key === "ArrowLeft") {
      step(-1);
    } else if (e.key === "Tab") {
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary, video[controls]")].filter(
        (el) => el.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  let startX = 0;
  let startY = 0;
  let tracking = false;
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  });
  stage.addEventListener("pointerup", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
  });

  document.addEventListener("keydown", onKey);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("viewer-open");
    root?.replaceChildren();
    trigger?.focus();
    opts.onClose();
  }

  goTo(postIndex, mediaIndex);
  closeBtn.focus();
  return { close, goTo };
}
