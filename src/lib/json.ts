/** Petits outils de lecture défensive des réponses JSON des plateformes (données non fiables). */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function obj(v: unknown): JsonObject | undefined {
  return isObject(v) ? v : undefined;
}

export function arr(v: unknown): Json[] {
  return Array.isArray(v) ? (v as Json[]) : [];
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function bool(v: unknown): boolean {
  return v === true;
}
