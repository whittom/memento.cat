import { describe, expect, it } from "vitest";
import { isRemoved, mapMedia, mapSubmission, pickThumb } from "../src/connectors/reddit/map";

const base = {
  name: "t3_abc",
  id: "abc",
  created_utc: 1767225600,
  title: "Titre",
  selftext: "Texte",
  permalink: "/r/test/comments/abc/titre/",
};

describe("Reddit : correspondance des publications", () => {
  it("normalise une publication", () => {
    const p = mapSubmission({ kind: "t3", data: base }, "reddit:auteur");
    expect(p).toMatchObject({
      id: "reddit:t3_abc",
      nativeRef: "t3_abc",
      nativeId: "abc",
      title: "Titre",
      text: "Texte",
      publishedAt: "2026-01-01T00:00:00.000Z",
      sourceUrl: "https://www.reddit.com/r/test/comments/abc/titre/",
    });
  });

  it("extrait une galerie dans l'ordre, avec légendes et miniatures", () => {
    const media = mapMedia({
      ...base,
      is_gallery: true,
      gallery_data: { items: [{ media_id: "m2", caption: "Deuxième" }, { media_id: "m1" }] },
      media_metadata: {
        m1: { status: "valid", e: "Image", s: { u: "https://i.redd.it/m1.jpg", x: 2000, y: 1500 }, p: [{ u: "https://preview/m1-108", x: 108, y: 81 }, { u: "https://preview/m1-320", x: 320, y: 240 }] },
        m2: { status: "valid", e: "AnimatedImage", s: { mp4: "https://i.redd.it/m2.mp4", gif: "https://i.redd.it/m2.gif", x: 400, y: 300 }, p: [] },
      },
    });
    expect(media.map((m) => [m.kind, m.sourceUrl, m.description])).toEqual([
      ["gif", "https://i.redd.it/m2.mp4", "Deuxième"],
      ["image", "https://i.redd.it/m1.jpg", null],
    ]);
    expect(media[1]?.thumbUrl).toBe("https://preview/m1-320");
  });

  it("extrait une vidéo hébergée et une image simple", () => {
    const vid = mapMedia({ ...base, is_video: true, media: { reddit_video: { fallback_url: "https://v.redd.it/x/DASH_720.mp4", width: 1280, height: 720 } } });
    expect(vid[0]).toMatchObject({ kind: "video", sourceUrl: "https://v.redd.it/x/DASH_720.mp4", width: 1280 });
    const img = mapMedia({ ...base, post_hint: "image", url: "https://i.redd.it/photo.png" });
    expect(img[0]).toMatchObject({ kind: "image", sourceUrl: "https://i.redd.it/photo.png" });
  });

  it("n'extrait rien d'un lien externe", () => {
    expect(mapMedia({ ...base, post_hint: "link", url: "https://example.com" })).toEqual([]);
  });

  it("choisit une miniature d'au moins 320 px, sinon la plus grande", () => {
    expect(pickThumb([{ u: "a", x: 108, y: 1 }, { u: "b", x: 640, y: 1 }, { u: "c", x: 320, y: 1 }])?.u).toBe("c");
    expect(pickThumb([{ u: "a", x: 108, y: 1 }, { u: "b", x: 216, y: 1 }])?.u).toBe("b");
  });

  it("reconnaît une publication supprimée ou retirée", () => {
    expect(isRemoved({ author: "[deleted]" })).toBe(true);
    expect(isRemoved({ author: "x", removed_by_category: "moderator" })).toBe(true);
    expect(isRemoved({ author: "x", selftext: "[removed]" })).toBe(true);
    expect(isRemoved({ author: "x", selftext: "ok", removed_by_category: null })).toBe(false);
  });
});
