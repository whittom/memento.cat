import { assertAccess } from "./access";
import { handleApi } from "./api";
import { runCollection } from "./collect";
import { MAINTENANCE_CRON, runMaintenance } from "./dedupe/maintenance";
import { readConfig } from "./lib/config";
import { HttpError, errorMessage } from "./lib/errors";
import { log } from "./lib/log";
import { withSecurityHeaders } from "./security";

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

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (controller.cron === MAINTENANCE_CRON) {
      ctx.waitUntil(
        runMaintenance(env).catch((e: unknown) => {
          log.error("maintenance interrompue", { error: errorMessage(e) });
        }),
      );
      return;
    }
    ctx.waitUntil(
      runCollection(env).catch((e: unknown) => {
        log.error("collecte interrompue", { error: errorMessage(e) });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
