import { api } from "./api";

/**
 * Marquages « consulté » en attente : conservés localement si l'envoi échoue,
 * puis renvoyés au prochain chargement.
 */
const KEY = "memento.pendingViews";

interface Pending { postId: string; position: number }

function load(): Pending[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as Pending[]) : [];
  } catch {
    return [];
  }
}

function save(items: Pending[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // stockage indisponible : on se contente de l'envoi immédiat
  }
}

export function markViewed(postId: string, position: number): void {
  api.setViewed("media", postId, true, position).catch(() => {
    const items = load();
    if (!items.some((i) => i.postId === postId && i.position === position)) {
      items.push({ postId, position });
      save(items);
    }
  });
}

export async function flushPendingViews(): Promise<void> {
  const items = load();
  if (items.length === 0) return;
  const failed: Pending[] = [];
  for (const i of items) {
    try {
      await api.setViewed("media", i.postId, true, i.position);
    } catch {
      failed.push(i);
    }
  }
  save(failed);
}
