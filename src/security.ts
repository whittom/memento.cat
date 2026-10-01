/**
 * En-têtes de sécurité appliqués à toutes les réponses (galerie, API, médias).
 *
 * La politique de contenu part de `default-src 'none'` : tout est interdit sauf ce qui est listé.
 * La galerie n'a ni script ni style en ligne ; ses seules ressources externes sont les polices
 * Google (feuille de style sur fonts.googleapis.com, fichiers sur fonts.gstatic.com).
 * Toute nouvelle origine externe doit être ajoutée ici et dans la spec (conception, « Sécurité »).
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "https://fonts.googleapis.com"],
  "font-src": ["https://fonts.gstatic.com"],
  "img-src": ["'self'"],
  "media-src": ["'self'"],
  "connect-src": ["'self'"],
  "manifest-src": ["'self'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

export const CONTENT_SECURITY_POLICY = Object.entries(CSP_DIRECTIVES)
  .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
  .join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}
