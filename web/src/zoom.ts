/** Calculs de la loupe de la visionneuse (purs, sans accès au DOM, testés dans test/zoom.test.ts). */

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** Taille d'affichage à la pleine résolution : un pixel d'image pour un pixel d'écran. */
export function fullResolutionSize(natural: Size, devicePixelRatio: number): Size {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: natural.width / ratio, height: natural.height / ratio };
}

/** Rectangle réellement dessiné d'une image ajustée (object-fit: contain) et centrée dans la zone ; undefined si une taille est nulle. */
function containRect(area: Size, natural: Size): { x: number; y: number; width: number; height: number } | undefined {
  if (natural.width <= 0 || natural.height <= 0 || area.width <= 0 || area.height <= 0) return undefined;
  const scale = Math.min(area.width / natural.width, area.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  return { x: (area.width - width) / 2, y: (area.height - height) / 2, width, height };
}

/**
 * Position relative (0 à 1) d'un point de la zone d'affichage dans l'image ajustée (object-fit: contain).
 * Un point dans les marges autour de l'image est ramené au bord le plus proche.
 */
export function relativePointInContain(point: Point, area: Size, natural: Size): Point {
  const r = containRect(area, natural);
  if (!r) return { x: 0.5, y: 0.5 };
  return { x: clamp((point.x - r.x) / r.width, 0, 1), y: clamp((point.y - r.y) / r.height, 0, 1) };
}

/**
 * Vrai si le point (dans la zone d'affichage) tombe sur l'image dessinée, faux s'il est dans les marges
 * d'ajustement. Sans taille connue (image pas chargée), on répond vrai : on ne ferme jamais par erreur.
 */
export function isInsideContain(point: Point, area: Size, natural: Size): boolean {
  const r = containRect(area, natural);
  if (!r) return true;
  return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
}

/** Défilement qui place le point relatif au centre de la zone, borné au contenu (jamais de vide au bord). */
export function scrollToCenter(point: Point, content: Size, area: Size): { left: number; top: number } {
  return {
    left: clamp(point.x * content.width - area.width / 2, 0, Math.max(0, content.width - area.width)),
    top: clamp(point.y * content.height - area.height / 2, 0, Math.max(0, content.height - area.height)),
  };
}
