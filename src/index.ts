import { assertAccess } from "./access";
import { handleApi } from "./api";
import { runCollection } from "./collect";
import { readConfig } from "./lib/config";
import { HttpError, errorMessage } from "./lib/errors";
import { log } from "./lib/log";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      await assertAccess(request, readConfig(env));
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(await handleApi(request, env));
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status >= 500) log.error("erreur de configuration", { error: e.message, path: url.pathname });
        return withSecurityHeaders(Response.json({ error: e.message }, { status: e.status }));
      }
      log.error("erreur non gérée", { error: errorMessage(e), path: url.pathname, method: request.method });
      return withSecurityHeaders(Response.json({ error: "Erreur interne" }, { status: 500 }));
    }
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      runCollection(env).catch((e: unknown) => {
        log.error("collecte interrompue", { error: errorMessage(e) });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
