import { describe, expect, it } from "vitest";
import { mapFeedItem, parseAtUri } from "../src/connectors/bluesky/map";

const did = "did:plc:abc123";
const video = (cid: string) => `https://pds.example/blob/${cid}`;

function item(overrides: Record<string, unknown> = {}, post: Record<string, unknown> = {}) {
  return {
    post: {
      uri: `at://${did}/app.bsky.feed.post/3kxyz`,
      author: { did, handle: "exemple.bsky.social" },
      indexedAt: "2026-09-01T12:00:05.000Z",
      record: { text: "Bonjour", createdAt: "2026-09-01T12:00:00.000Z" },
      ...post,
    },
    ...overrides,
  };
}

describe("Bluesky : correspondance des publications", () => {
  it("découpe une URI at://", () => {
    expect(parseAtUri(`at://${did}/app.bsky.feed.post/3kxyz`)).toEqual({ did, collection: "app.bsky.feed.post", rkey: "3kxyz" });
  });

  it("normalise une publication texte", () => {
    const p = mapFeedItem(item(), did, video);
    expect(p).toMatchObject({
      id: "bluesky:3kxyz",
      creatorId: `bluesky:${did}`,
      nativeRef: `at://${did}/app.bsky.feed.post/3kxyz`,
      publishedAt: "2026-09-01T12:00:00.000Z",
      text: "Bonjour",
      title: null,
      sourceUrl: `https://bsky.app/profile/${did}/post/3kxyz`,
      media: [],
    });
  });

  it("ignore les republications et les publications d'un autre auteur", () => {
    expect(mapFeedItem(item({ reason: { $type: "app.bsky.feed.defs#reasonRepost" } }), did, video)).toBeNull();
    expect(mapFeedItem(item({}, { author: { did: "did:plc:autre" } }), did, video)).toBeNull();
  });

  it("ignore les citations d'un autre compte, garde celles de soi-même et celles avec médias propres", () => {
    const quote = (author: string | undefined, type = "app.bsky.embed.record#view") => ({
      embed: { $type: type, record: { $type: "app.bsky.embed.record#viewRecord", ...(author ? { author: { did: author } } : {}) } },
    });
    expect(mapFeedItem(item({}, quote("did:plc:autre")), did, video)).toBeNull();
    expect(mapFeedItem(item({}, quote(undefined)), did, video)).toBeNull();
    expect(mapFeedItem(item({}, { embed: { $type: "app.bsky.embed.record#view", record: { creator: { did: "did:plc:autre" } } } }), did, video)).toBeNull();
    expect(mapFeedItem(item({}, quote(did)), did, video)).not.toBeNull();
    const withOwnMedia = {
      embed: {
        $type: "app.bsky.embed.recordWithMedia#view",
        record: { record: { author: { did: "did:plc:autre" } } },
        media: { $type: "app.bsky.embed.images#view", images: [{ thumb: "https://cdn/t", fullsize: "https://cdn/f" }] },
      },
    };
    expect(mapFeedItem(item({}, withOwnMedia), did, video)?.media).toHaveLength(1);
  });

  it("garde le texte alternatif comme description et la miniature fournie", () => {
    const p = mapFeedItem(
      item({}, {
        embed: {
          $type: "app.bsky.embed.images#view",
          images: [
            { thumb: "https://cdn/t1", fullsize: "https://cdn/f1", alt: "Un chat", aspectRatio: { width: 1200, height: 800 } },
            { thumb: "https://cdn/t2", fullsize: "https://cdn/f2", alt: "" },
          ],
        },
      }),
      did,
      video,
    );
    expect(p?.media).toHaveLength(2);
    expect(p?.media[0]).toMatchObject({ kind: "image", sourceUrl: "https://cdn/f1", thumbUrl: "https://cdn/t1", description: "Un chat", width: 1200 });
    expect(p?.media[1]?.description).toBeNull();
  });

  it("extrait la vidéo d'une publication avec citation", () => {
    const p = mapFeedItem(
      item({}, {
        embed: {
          $type: "app.bsky.embed.recordWithMedia#view",
          media: { $type: "app.bsky.embed.video#view", cid: "bafyvid", thumbnail: "https://cdn/thumb", alt: "Démo" },
        },
      }),
      did,
      video,
    );
    expect(p?.media[0]).toMatchObject({ kind: "video", sourceUrl: "https://pds.example/blob/bafyvid", thumbUrl: "https://cdn/thumb", description: "Démo" });
  });

  it("ramène une date de création future à la date d'indexation", () => {
    const p = mapFeedItem(item({}, { record: { text: "", createdAt: "2030-01-01T00:00:00.000Z" } }), did, video);
    expect(p?.publishedAt).toBe("2026-09-01T12:00:05.000Z");
  });
});
