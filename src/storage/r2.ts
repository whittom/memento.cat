import type { Budget } from "../lib/budget";

export interface StoredFile {
  stored: boolean;
  /** Raison si le fichier n'a pas été stocké. */
  reason?: "too-large" | "http-error";
  mimeType: string | null;
  bytes: number | null;
  /** Empreinte calculée par R2 (MD5 pour un envoi en une partie). */
  etag: string | null;
}

/**
 * Télécharge un fichier et l'écrit dans R2 sans le charger entièrement en mémoire
 * quand la taille est annoncée. Au-delà de maxBytes, le fichier n'est pas stocké.
 */
export async function storeRemoteFile(
  bucket: R2Bucket,
  budget: Budget,
  url: string,
  maxBytes: number,
  keyFor: (mime: string | null) => string,
): Promise<StoredFile & { key: string }> {
  const res = await budget.fetch(url, { redirect: "follow" });
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
  const finalKey = keyFor(mimeType);
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return { stored: false, reason: "http-error", mimeType, bytes: null, etag: null, key: finalKey };
  }

  const declared = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  const httpMetadata = mimeType ? { contentType: mimeType } : undefined;

  if (Number.isFinite(declared)) {
    if (declared > maxBytes) {
      await res.body.cancel();
      return { stored: false, reason: "too-large", mimeType, bytes: declared, etag: null, key: finalKey };
    }
    // Taille connue : flux direct vers R2.
    const stream = res.body.pipeThrough(new FixedLengthStream(declared));
    const obj = await bucket.put(finalKey, stream, { httpMetadata });
    return { stored: true, mimeType, bytes: declared, etag: obj.etag, key: finalKey };
  }

  // Taille inconnue : lecture bornée par maxBytes.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { stored: false, reason: "too-large", mimeType, bytes: null, etag: null, key: finalKey };
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buffer.set(c, offset);
    offset += c.byteLength;
  }
  const obj = await bucket.put(finalKey, buffer, { httpMetadata });
  return { stored: true, mimeType, bytes: total, etag: obj.etag, key: finalKey };
}

export async function putJson(bucket: R2Bucket, key: string, data: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

/**
 * Supprime jusqu'à `limit` objets sous un préfixe.
 * Renvoie vrai s'il reste des objets à supprimer.
 */
export async function deletePrefix(bucket: R2Bucket, prefix: string, limit = 1000): Promise<boolean> {
  const listed = await bucket.list({ prefix, limit });
  if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key));
  return listed.truncated;
}
