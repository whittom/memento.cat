/** Calculs de la loupe de la visionneuse (purs, sans accès au DOM, testés dans test/zoom.test.ts). */

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** Taille d'affichage à la pleine résolution : un pixel d'image pour un pixel d'écran. */
export function fullResolutionSize(natural: Size, devicePixelRatio: number): Size {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: natural.width / ratio, height: natural.height / ratio };
}

/**
 * Position relative (0 à 1) d'un point de la zone d'affichage dans l'image ajustée (object-fit: contain).
 * Un point dans les marges autour de l'image est ramené au bord le plus proche.
 */
export function relativePointInContain(point: Point, area: Size, natural: Size): Point {
  if (natural.width <= 0 || natural.height <= 0 || area.width <= 0 || area.height <= 0) return { x: 0.5, y: 0.5 };
  const scale = Math.min(area.width / natural.width, area.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const offsetX = (area.width - width) / 2;
  const offsetY = (area.height - height) / 2;
  return { x: clamp((point.x - offsetX) / width, 0, 1), y: clamp((point.y - offsetY) / height, 0, 1) };
}

/** Défilement qui place le point relatif au centre de la zone, borné au contenu (jamais de vide au bord). */
export function scrollToCenter(point: Point, content: Size, area: Size): { left: number; top: number } {
  return {
    left: clamp(point.x * content.width - area.width / 2, 0, Math.max(0, content.width - area.width)),
    top: clamp(point.y * content.height - area.height / 2, 0, Math.max(0, content.height - area.height)),
  };
}
