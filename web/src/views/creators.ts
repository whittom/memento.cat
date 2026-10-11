import { api, ApiError } from "../api";
import { addChildren, fmtBytes, fmtDateTime, h, platformLabel, plural, setChildren, toast } from "../dom";
import type { Creator } from "../types";

/** Nombre maximal d'appels enchaînés pour une synchronisation manuelle (chaque appel a son propre budget). */
const MAX_SYNC_CALLS = 25;

const errorText =(e: unknown): string => (e instanceof ApiError ? e.message : "Action impossible. Vérifiez la connexion, puis réessayez.");

/** Page de gestion des créateurs suivis. */
export async function renderCreators(root: HTMLElement): Promise<void> {
  root.replaceChildren(h("h1", {}, "Créateurs suivis"), h("p", { class: "status", role: "status" }, "Chargement…"));
  let creators: Creator[];
  try {
    creators = await api.creators();
  } catch (e) {
    root.replaceChildren(h("h1", {}, "Créateurs suivis"), h("p", { class: "status" }, errorText(e)));
    return;
  }
  const refresh = () => void renderCreators(root);

  const followed = creators.filter((c) => c.state === "active" || c.state === "paused");
  const trashed = creators.filter((c) => c.state === "deleted");
  const purging = creators.filter((c) => c.state === "purging");

  setChildren(
    root,
    h("h1", {}, "Créateurs suivis"),
    addForm(refresh),
    purging.length > 0
      ? h(
          "section",
          { class: "panel panel-warning" },
          h("h2", {}, "Effacements à terminer"),
          h("ul", { class: "creator-list" }, ...purging.map((c) => purgingRow(c, refresh))),
        )
      : null,
    h(
      "section",
      { class: "panel" },
      h("h2", {}, followed.length > 0 ? plural(followed.length, "créateur", "créateurs") : "Aucun créateur suivi"),
      followed.length > 0
        ? h("ul", { class: "creator-list" }, ...followed.map((c) => creatorRow(c, refresh)))
        : h("p", { class: "muted" }, "Ajoutez un compte Bluesky, Mastodon ou Reddit ci-dessus. Ses nouvelles publications seront archivées toutes les 15 minutes."),
    ),
    trashed.length > 0
      ? h(
          "section",
          { class: "panel" },
          h("h2", {}, "Corbeille"),
          h("p", { class: "muted" }, "Ces créateurs sont masqués et ne sont plus synchronisés. Leurs archives sont conservées tant que vous ne les effacez pas."),
          h("ul", { class: "creator-list" }, ...trashed.map((c) => trashRow(c, refresh))),
        )
      : null,
  );
}

function addForm(refresh: () => void): HTMLElement {
  const error = h("p", { class: "form-error", role: "alert" });
  const platform = h(
    "select",
    { name: "platform", required: true },
    h("option", { value: "bluesky" }, "Bluesky"),
    h("option", { value: "mastodon" }, "Mastodon"),
    h("option", { value: "reddit" }, "Reddit"),
  );
  const placeholders: Record<string, string> = {
    bluesky: "exemple.bsky.social",
    mastodon: "nom@serveur.social",
    reddit: "nom d'utilisateur Reddit",
  };
  const handle = h("input", { name: "handle", required: true, autocomplete: "off", placeholder: placeholders["bluesky"] });
  platform.addEventListener("change", () => {
    handle.placeholder = placeholders[platform.value] ?? "";
  });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Suivre");
  return h(
    "form",
    {
      class: "panel add-form",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        error.textContent = "";
        submit.disabled = true;
        try {
          const { creator } = await api.addCreator(platform.value, handle.value);
          toast(`${creator.handle} est maintenant suivi`);
          refresh();
        } catch (err) {
          error.textContent = errorText(err);
        } finally {
          submit.disabled = false;
        }
      },
    },
    h("h2", {}, "Suivre un créateur"),
    h("div", { class: "add-fields" }, h("label", { class: "field" }, h("span", {}, "Plateforme"), platform), h("label", { class: "field field-grow" }, h("span", {}, "Identifiant"), handle), submit),
    error,
  );
}

function identity(c: Creator): HTMLElement {
  return h(
    "div",
    { class: "creator-id" },
    h("a", { href: `/createur/${encodeURIComponent(c.id)}`, "data-link": true, class: "creator-name" }, c.displayName || c.handle),
    h("span", { class: "muted" }, `${platformLabel(c.platform)}, ${c.handle}`),
  );
}

function syncLine(c: Creator): HTMLElement {
  if (c.state === "paused") return h("span", { class: "sync sync-paused" }, "Synchronisation désactivée");
  if (c.lastError) return h("span", { class: "sync sync-error" }, `Dernière synchronisation en échec : ${c.lastError}`);
  if (c.lastSuccessAt) return h("span", { class: "sync" }, `Synchronisé le ${fmtDateTime(c.lastSuccessAt)}`);
  return h("span", { class: "sync" }, "Première synchronisation à venir");
}

function creatorRow(c: Creator, refresh: () => void): HTMLElement {
  const progress = h("p", { class: "progress", role: "status" });
  const verifyBtn = h("button", { type: "button", class: "btn btn-quiet" }, "Vérifier les suppressions");
  verifyBtn.addEventListener("click", async () => {
    verifyBtn.disabled = true;
    let startedAt: string | null = null;
    let checked = 0;
    let deleted = 0;
    let purged = 0;
    try {
      for (;;) {
        const r = await api.verify(c.id, startedAt);
        startedAt = r.startedAt;
        checked += r.processed;
        deleted += r.deleted;
        purged += r.purged;
        progress.textContent = `Vérification : ${checked} publications, ${r.remaining} restantes`;
        if (r.remaining === 0 || r.processed === 0) break;
      }
      const parts = [
        deleted > 0 ? `${plural(deleted, "publication supprimée", "publications supprimées")} par l'auteur (copie conservée)` : null,
        purged > 0 ? `${plural(purged, "publication supprimée à la source effacée", "publications supprimées à la source effacées")} de l'archive` : null,
      ].filter(Boolean);
      progress.textContent = parts.length > 0 ? `Vérification terminée : ${parts.join(" ; ")}.` : "Vérification terminée : aucune suppression.";
      // Des publications effacées changent les compteurs : on redessine la page.
      if (purged > 0) refresh();
    } catch (e) {
      progress.textContent = `Vérification interrompue : ${errorText(e)} Relancez-la pour reprendre.`;
    } finally {
      verifyBtn.disabled = false;
    }
  });

  const syncBtn = h("button", { type: "button", class: "btn" }, "Synchroniser maintenant");
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    let archived = 0;
    try {
      for (let call = 0; call < MAX_SYNC_CALLS; call++) {
        progress.textContent = archived > 0 ? `Synchronisation : ${plural(archived, "publication archivée", "publications archivées")}…` : "Synchronisation en cours…";
        const r = await api.sync(c.id);
        archived += r.archived;
        // Sans progrès, relancer ne servirait à rien : on s'arrête et on l'indique.
        if (r.done) break;
        if (r.archived === 0) throw new Error("Aucune progression");
      }
      toast(archived > 0 ? `${c.handle} : ${plural(archived, "nouvelle publication archivée", "nouvelles publications archivées")}` : `${c.handle} : rien de nouveau`);
      refresh();
    } catch (e) {
      const cause = e instanceof ApiError ? e.message : "Synchronisation interrompue avant la fin.";
      progress.textContent = `${cause}${archived > 0 ? ` ${plural(archived, "publication archivée", "publications archivées")} avant l'arrêt.` : ""} Relancez pour reprendre.`;
      syncBtn.disabled = false;
    }
  });

  return h(
    "li",
    { class: "creator-row" },
    identity(c),
    h(
      "div",
      { class: "creator-numbers" },
      h("span", {}, plural(c.postCount ?? 0, "publication", "publications")),
      (c.unviewedCount ?? 0) > 0 ? h("span", { class: "mark mark-inline" }, plural(c.unviewedCount ?? 0, "non vu", "non vus")) : null,
      syncLine(c),
    ),
    h(
      "div",
      { class: "creator-buttons" },
      c.state === "active" ? syncBtn : null,
      h(
        "button",
        {
          type: "button",
          class: "btn btn-quiet",
          onclick: async () => {
            try {
              await api.setState(c.id, c.state === "active" ? "paused" : "active");
              toast(c.state === "active" ? "Synchronisation désactivée" : "Synchronisation réactivée");
              refresh();
            } catch (e) {
              toast(errorText(e));
            }
          },
        },
        c.state === "active" ? "Désactiver" : "Réactiver",
      ),
      verifyBtn,
      h("button", { type: "button", class: "btn btn-quiet", onclick: () => openDuplicatesDialog(c, refresh) }, "Supprimer les doublons…"),
      h("button", { type: "button", class: "btn btn-quiet btn-danger", onclick: () => openDeleteDialog(c, refresh) }, "Supprimer…"),
    ),
    progress,
  );
}

function trashRow(c: Creator, refresh: () => void): HTMLElement {
  return h(
    "li",
    { class: "creator-row" },
    h("div", { class: "creator-id" }, h("span", { class: "creator-name" }, c.displayName || c.handle), h("span", { class: "muted" }, c.deletedAt ? `${platformLabel(c.platform)}, mis à la corbeille le ${fmtDateTime(c.deletedAt)}` : platformLabel(c.platform))),
    h("div", { class: "creator-numbers" }, h("span", {}, plural(c.postCount ?? 0, "publication", "publications"))),
    h(
      "div",
      { class: "creator-buttons" },
      h(
        "button",
        {
          type: "button",
          class: "btn",
          onclick: async () => {
            try {
              await api.restore(c.id);
              toast(`${c.handle} restauré, synchronisation désactivée`);
              refresh();
            } catch (e) {
              toast(errorText(e));
            }
          },
        },
        "Restaurer",
      ),
      h("button", { type: "button", class: "btn btn-quiet btn-danger", onclick: () => openDeleteDialog(c, refresh, true) }, "Effacer définitivement…"),
    ),
  );
}

function purgingRow(c: Creator, refresh: () => void): HTMLElement {
  const progress = h("p", { class: "progress", role: "status" }, "L'effacement a été interrompu. Les données restantes sont masquées.");
  const resume = h("button", { type: "button", class: "btn btn-danger" }, "Reprendre l'effacement");
  resume.addEventListener("click", async () => {
    resume.disabled = true;
    await runPurge(c, undefined, progress);
    refresh();
  });
  return h("li", { class: "creator-row" }, h("div", { class: "creator-id" }, h("span", { class: "creator-name" }, c.handle)), h("div", { class: "creator-buttons" }, resume), progress);
}

async function runPurge(c: Creator, confirm: string | undefined, progress: HTMLElement): Promise<boolean> {
  try {
    let first = true;
    for (;;) {
      const r = await api.purge(c.id, first ? confirm : undefined);
      first = false;
      progress.textContent = r.done ? "Effacement terminé." : `Effacement en cours : ${plural(r.remaining, "publication restante", "publications restantes")}`;
      if (r.done) return true;
    }
  } catch (e) {
    progress.textContent = `Effacement interrompu : ${errorText(e)} Vous pourrez le reprendre depuis cette page.`;
    return false;
  }
}

function openDeleteDialog(c: Creator, refresh: () => void, physicalOnly = false): void {
  const dialog = h("dialog", { class: "dialog", "aria-labelledby": "delete-title" });
  const progress = h("p", { class: "progress", role: "status" });
  const stats = h("p", { class: "muted" }, "Calcul du volume à effacer…");
  const confirmInput = h("input", { autocomplete: "off", spellcheck: "false", "aria-describedby": "confirm-help" });
  const purgeBtn = h("button", { type: "button", class: "btn btn-danger", disabled: true }, "Effacer définitivement");
  confirmInput.addEventListener("input", () => {
    purgeBtn.disabled = confirmInput.value !== c.handle;
  });

  void api.stats(c.id).then(
    (s) => {
      stats.textContent = `Seront effacés : ${plural(s.posts, "publication", "publications")}, ${plural(s.media, "média", "médias")} (${fmtBytes(s.bytes)}).`;
    },
    () => {
      stats.textContent = "Volume inconnu.";
    },
  );

  purgeBtn.addEventListener("click", async () => {
    purgeBtn.disabled = true;
    confirmInput.disabled = true;
    const ok = await runPurge(c, confirmInput.value, progress);
    if (ok) {
      toast(`${c.handle} effacé définitivement`);
      dialog.close();
    }
    refresh();
  });

  const close = h("button", { type: "button", class: "btn btn-quiet", onclick: () => dialog.close() }, "Annuler");

  addChildren(
    dialog,
    h("h2", { id: "delete-title" }, `Supprimer ${c.displayName || c.handle}`),
    physicalOnly
      ? null
      : h(
          "section",
          { class: "choice" },
          h("h3", {}, "Mettre à la corbeille"),
          h("p", {}, "Arrête la synchronisation et masque ce créateur et ses publications. Tout reste stocké ; vous pourrez le restaurer."),
          h(
            "button",
            {
              type: "button",
              class: "btn",
              onclick: async () => {
                try {
                  await api.trash(c.id);
                  toast(`${c.handle} mis à la corbeille`);
                  dialog.close();
                  refresh();
                } catch (e) {
                  progress.textContent = errorText(e);
                }
              },
            },
            "Mettre à la corbeille",
          ),
        ),
    h(
      "section",
      { class: "choice choice-danger" },
      h("h3", {}, "Effacer définitivement"),
      h("p", {}, "Supprime le créateur, ses publications, ses médias et leurs fichiers. Cette action est irréversible."),
      stats,
      h("label", { class: "field" }, h("span", { id: "confirm-help" }, `Pour confirmer, tapez ${c.handle}`), confirmInput),
      purgeBtn,
    ),
    progress,
    h("div", { class: "dialog-foot" }, close),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Ménage des doublons d'un créateur (exigence 9.10) : la simulation, puis la confirmation, la progression et le
 * bilan dans une fenêtre de la page. Le Worker travaille par lots : la fenêtre rappelle l'API jusqu'à la fin.
 * Pas de `window.confirm` : certains navigateurs intégrés le ferment d'office, et le bilan resterait invisible.
 */
function openDuplicatesDialog(c: Creator, refresh: () => void): void {
  const dialog = h("dialog", { class: "dialog", "aria-labelledby": "dup-title" });
  const summary = h("p", { role: "status" }, "Recherche des doublons…");
  const result = h("p", { class: "progress", role: "status" });
  const applyBtn = h("button", { type: "button", class: "btn btn-danger", disabled: true }, "Supprimer les doublons");
  const close = h("button", { type: "button", class: "btn btn-quiet", onclick: () => dialog.close() }, "Annuler");
  let changed = false;

  // La simulation rappelle l'API tant que des empreintes visuelles restent à calculer (par lots, côté Worker).
  const simulate = async () => {
    for (;;) {
      const plan = await api.duplicates(c.id, false);
      if (plan.pendingFingerprints === 0) return plan;
      summary.textContent = `Analyse des images : ${plural(plan.pendingFingerprints, "image restante", "images restantes")}…`;
    }
  };

  void simulate().then(
    (plan) => {
      if (plan.done) {
        summary.textContent = "Aucun doublon : chaque média n'apparaît qu'une fois.";
        close.textContent = "Fermer";
        return;
      }
      const parts = [
        plan.postCount > 0 ? `${plural(plan.postCount, "fiche sera supprimée", "fiches seront supprimées")} : toutes ses images sont déjà dans une fiche plus ancienne.` : null,
        plan.count > 0
          ? `${plural(plan.count, "média en double sera relié", "médias en double seront reliés")} à sa première occurrence${plan.visualCount > 0 ? ` (dont ${plural(plan.visualCount, "quasi-doublon", "quasi-doublons")} : même image, autre encodage ; la meilleure est gardée)` : ""}, ${fmtBytes(plan.freeableBytes)} libérés.`
          : null,
      ].filter(Boolean);
      summary.textContent = `${parts.join(" ")} Seule la première occurrence de chaque média est conservée. La suppression est définitive.`;
      applyBtn.disabled = false;
    },
    (e: unknown) => {
      summary.textContent = errorText(e);
    },
  );

  applyBtn.addEventListener("click", async () => {
    applyBtn.disabled = true;
    close.disabled = true;
    let linked = 0;
    let deleted = 0;
    result.textContent = "Suppression en cours…";
    try {
      for (;;) {
        const r = await api.duplicates(c.id, true);
        if (r.pendingFingerprints > 0) {
          result.textContent = `Analyse des images : ${plural(r.pendingFingerprints, "image restante", "images restantes")}…`;
          continue;
        }
        linked += r.linked;
        deleted += r.deletedPosts;
        changed = true;
        result.textContent = `En cours : ${plural(linked, "média relié", "médias reliés")}, ${plural(deleted, "fiche supprimée", "fiches supprimées")}…`;
        if (r.done) break;
      }
      const text = `${plural(deleted, "fiche supprimée", "fiches supprimées")}, ${plural(linked, "média relié", "médias reliés")}.`;
      result.textContent = text;
      toast(`${c.handle} : ${text}`);
      close.textContent = "Fermer";
    } catch (e) {
      result.textContent = `${errorText(e)} Relancez pour reprendre.`;
      applyBtn.disabled = false;
    } finally {
      close.disabled = false;
    }
  });

  addChildren(dialog, h("h2", { id: "dup-title" }, `Doublons de ${c.displayName || c.handle}`), summary, applyBtn, result, h("div", { class: "dialog-foot" }, close));
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (changed) refresh(); // les compteurs changent ; le bilan reste dans la notification
  });
  document.body.append(dialog);
  dialog.showModal();
}
