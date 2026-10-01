import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, CSP_DIRECTIVES, SECURITY_HEADERS, withSecurityHeaders } from "../src/security";
import html from "../web/index.html?raw";
import css from "../web/src/styles.css?raw";

/** Origines (schéma et hôte) des URL absolues présentes dans un texte. */
const externalOrigins = (text: string): string[] => [...new Set([...text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0].toLowerCase()))];

describe("politique de sécurité du contenu", () => {
  it("part de default-src 'none' et interdit le code en ligne et l'intégration dans un cadre", () => {
    expect(CSP_DIRECTIVES["default-src"]).toEqual(["'none'"]);
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CSP_DIRECTIVES["frame-ancestors"]).toEqual(["'none'"]);
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  });

  it("applique tous les en-têtes sans perdre le corps ni le statut", async () => {
    const res = withSecurityHeaders(new Response("corps", { status: 201, headers: { "content-type": "text/plain" } }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("corps");
    expect(res.headers.get("content-type")).toBe("text/plain");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });
});

describe("la galerie respecte la politique", () => {
  it("n'a aucun script en ligne, ni style ni gestionnaire d'événement en attribut", () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [tag, body] of scripts) {
      expect(tag, "un <script> doit avoir un src").toMatch(/\ssrc=/);
      expect(body?.trim(), "un <script> ne doit rien contenir").toBe("");
    }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("ne charge que des origines externes autorisées", () => {
    const allowed = new Set([...CSP_DIRECTIVES["style-src"] ?? [], ...CSP_DIRECTIVES["font-src"] ?? []]);
    // L'espace de noms SVG n'est pas une ressource chargée.
    const used = externalOrigins(html).filter((o) => o !== "http://www.w3.org");
    expect(used.length).toBeGreaterThan(0);
    for (const origin of used) expect(allowed.has(origin), origin).toBe(true);
    expect(externalOrigins(css)).toEqual([]);
  });
});
