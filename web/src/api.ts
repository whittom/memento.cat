import type { Creator, Filters, Post } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data && "error" in data ? String(data.error) : `Erreur ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const api = {
  creators: () => request<{ creators: Creator[] }>("/creators").then((r) => r.creators),
  addCreator: (platform: string, handle: string) => request<{ creator: Creator }>("/creators", post({ platform, handle })),
  setState: (id: string, state: "active" | "paused") =>
    request<{ creator: Creator }>(`/creators/${enc(id)}`, { method: "PATCH", body: JSON.stringify({ state }) }),
  // Corps JSON vide : l'API exige application/json sur toute requête qui modifie des données.
  trash: (id: string) => request<{ creator: Creator }>(`/creators/${enc(id)}?mode=logical`, { method: "DELETE", body: "{}" }),
  restore: (id: string) => request<{ creator: Creator }>(`/creators/${enc(id)}/restore`, post({})),
  stats: (id: string) => request<{ posts: number; media: number; bytes: number }>(`/creators/${enc(id)}/stats`),
  purge: (id: string, confirm?: string) =>
    request<{ remaining: number; done: boolean }>(`/creators/${enc(id)}/purge`, post({ confirm })),
  sync: (id: string) => request<{ archived: number; done: boolean }>(`/creators/${enc(id)}/sync`, post({})),
  verify: (id: string, startedAt: string | null) =>
    request<{ startedAt: string; processed: number; deleted: number; remaining: number }>(
      `/creators/${enc(id)}/verify`,
      post({ startedAt }),
    ),
  posts: (filters: Filters, cursor: string | null) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v === true) q.set(k, "1");
      else if (typeof v === "string" && v) q.set(k, v);
    }
    if (cursor) q.set("cursor", cursor);
    return request<{ posts: Post[]; nextCursor: string | null }>(`/posts?${q.toString()}`);
  },
  post: (id: string) => request<{ post: Post }>(`/posts/${enc(id)}`).then((r) => r.post),
  setViewed: (scope: "media" | "post" | "creator", id: string, viewed: boolean, position?: number) =>
    request<{ changed: number }>("/views", post({ scope, id, viewed, position })),
};
