// Imports de fichiers texte bruts (`?raw`), pris en charge par Vite et Vitest.
declare module "*?raw" {
  const content: string;
  export default content;
}
