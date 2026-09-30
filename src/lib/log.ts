type Fields = Record<string, unknown>;

/** Journaux JSON structurés, lisibles dans Workers Observability. */
export const log = {
  info(message: string, fields: Fields = {}): void {
    console.log(JSON.stringify({ level: "info", message, ...fields }));
  },
  warn(message: string, fields: Fields = {}): void {
    console.warn(JSON.stringify({ level: "warn", message, ...fields }));
  },
  error(message: string, fields: Fields = {}): void {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  },
};
