import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseDay } from "../src/api/http";
import { checkRateLimit } from "../src/connectors/ratelimit";
import { Budget, countingDb } from "../src/lib/budget";
import { BudgetExhaustedError, RateLimitError } from "../src/lib/errors";
import { toFtsQuery } from "../src/storage/db";
import { creatorSegment, extensionFor, mediaKey, postPrefix, thumbKey } from "../src/storage/keys";

describe("clés R2", () => {
  it("range une publication par plateforme, créateur, année, mois et jour", () => {
    const prefix = postPrefix({ platform: "bluesky", creatorId: "bluesky:did:plc:abc", publishedAt: "2026-09-01T12:00:00.000Z", nativeId: "3kxyz" });
    expect(prefix).toBe("bluesky/did_plc_abc/2026/09/2026-09-01_3kxyz/");
    expect(mediaKey(prefix, 0, "jpg")).toBe(`${prefix}media_01.jpg`);
    expect(thumbKey(prefix, 9, "webp")).toBe(`${prefix}media_10.thumb.webp`);
    expect(creatorSegment("reddit:some-user")).toBe("some-user");
  });

  it("déduit l'extension du type MIME, puis de l'URL", () => {
    expect(extensionFor("image/jpeg", "https://x/y", "image")).toBe("jpg");
    expect(extensionFor(null, "https://i.redd.it/a.png", "image")).toBe("png");
    expect(extensionFor("application/octet-stream", "https://x/blob", "video")).toBe("mp4");
  });
});

describe("recherche et pagination", () => {
  it("transforme une saisie libre en requête FTS sûre", () => {
    expect(toFtsQuery('chat "noir')).toBe('"chat"* "noir"*');
    expect(toFtsQuery("   ")).toBeNull();
  });

  it("aller-retour du curseur, refus d'un curseur invalide", () => {
    const c = encodeCursor("2026-09-01T12:00:00.000Z", "reddit:t3_abc");
    expect(decodeCursor(c)).toEqual({ publishedAt: "2026-09-01T12:00:00.000Z", id: "reddit:t3_abc" });
    expect(() => decodeCursor("pas-un-curseur")).toThrow();
  });

  it("borne une période au jour inclus", () => {
    expect(parseDay("2026-09-30", true)).toBe("2026-10-01T00:00:00.000Z");
    expect(() => parseDay("30/09/2026")).toThrow();
  });
});

describe("quotas et budget", () => {
  it("lève RateLimitError sous le seuil (Reddit) et sur 429", () => {
    const low = new Response("", { headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "42" } });
    expect(() => checkRateLimit("reddit", low, 10)).toThrow(RateLimitError);
    const ok = new Response("", { headers: { "x-ratelimit-remaining": "80" } });
    expect(() => checkRateLimit("reddit", ok, 10)).not.toThrow();
    expect(() => checkRateLimit("bluesky", new Response("", { status: 429 }), 10)).toThrow(RateLimitError);
  });

  it("compte les requêtes D1, y compris chaque instruction d'un batch", async () => {
    const calls: string[] = [];
    const stmt = { bind: () => stmt, run: () => { calls.push("run"); return Promise.resolve({}); }, first: () => Promise.resolve(null) };
    const fake = { prepare: () => stmt, batch: (s: unknown[]) => { calls.push(`batch:${s.length}`); return Promise.resolve([]); } } as unknown as D1Database;
    const budget = new Budget(10, 3);
    const db = countingDb(fake, budget);
    await db.prepare("x").bind(1).run();
    await db.batch([db.prepare("a"), db.prepare("b")]);
    expect(budget.remainingQueries).toBe(0);
    expect(() => db.prepare("y").first()).toThrow(BudgetExhaustedError);
    expect(calls).toEqual(["run", "batch:2"]);
  });
});
