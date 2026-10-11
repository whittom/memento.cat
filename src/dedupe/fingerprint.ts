/**
 * Empreinte visuelle d'une image (exigence 9.11, reprise de L10.10 et L10.13 de memento-local). memento-local
 * décode avec `sharp`, qu'un Worker ne peut pas charger : ici, la liaison Cloudflare Images réduit l'image hors du
 * Worker et rend directement ses pixels bruts (`format: "rgb"`). Le Worker ne fait que de petits calculs
 * (17 × 16 ou 48 × 48 pixels), sans décodage.
 */

/** Taille maximale d'une image acceptée par la liaison Images. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const WIDTH = 17;
const HEIGHT = 16;
export const FINGERPRINT_BITS = (WIDTH - 1) * HEIGHT;
/** En dessous, ou au-dessus de FINGERPRINT_BITS moins cette valeur, l'image est quasi unie : empreinte non fiable. */
const MIN_SET_BITS = 16;

export type Fingerprint = Uint8Array;

/** Ce qu'il faut pour lire une image : la liaison, le magasin, la clé, son type et sa taille. */
export interface ImageSource {
  images: ImagesBinding | undefined;
  bucket: R2Bucket;
  key: string;
  mimeType: string | null;
  bytes?: number | null;
}

/** Une image fixe que la liaison peut lire : pas de GIF (animé), de SVG, de vidéo, ni de fichier de plus de 20 Mo. */
export function canAnalyse(s: Pick<ImageSource, "images" | "mimeType" | "bytes">): boolean {
  if (!s.images || !s.mimeType?.startsWith("image/")) return false;
  if (s.mimeType === "image/gif" || s.mimeType === "image/svg+xml") return false;
  return s.bytes == null || s.bytes <= MAX_SOURCE_BYTES;
}

/**
 * L'image réduite à `width` × `height` (déformée au besoin, comme `fit: "fill"` de sharp), en niveaux de gris,
 * un octet par pixel. La liaison Images applique l'orientation EXIF. null si l'image ne peut pas être lue.
 */
export async function greyPixels(s: ImageSource, width: number, height: number): Promise<Uint8Array | null> {
  if (!canAnalyse(s) || !s.images) return null;
  try {
    const source = await s.bucket.get(s.key);
    if (!source) return null;
    const result = await s.images
      .input(source.body as ReadableStream<Uint8Array>)
      .transform({ width, height, fit: "squeeze" })
      .output({ format: "rgb" });
    const rgb = new Uint8Array(await result.response().arrayBuffer());
    if (rgb.length !== width * height * 3) return null;
    const grey = new Uint8Array(width * height);
    for (let i = 0; i < grey.length; i++) {
      // Luminance (Rec. 601), comme la conversion en niveaux de gris de sharp.
      grey[i] = Math.round(0.299 * (rgb[i * 3] ?? 0) + 0.587 * (rgb[i * 3 + 1] ?? 0) + 0.114 * (rgb[i * 3 + 2] ?? 0));
    }
    return grey;
  } catch {
    return null;
  }
}

/** Empreinte (32 octets) d'une image : chaque pixel est comparé à son voisin de droite (1 s'il est plus sombre). */
export async function fingerprintOf(s: ImageSource): Promise<Fingerprint | null> {
  const data = await greyPixels(s, WIDTH, HEIGHT);
  return data ? fingerprintFromGrey(data) : null;
}

/** Empreinte d'une image déjà réduite à 17 × 16 en niveaux de gris ; null si elle est quasi unie. */
export function fingerprintFromGrey(data: Uint8Array): Fingerprint | null {
  if (data.length < WIDTH * HEIGHT) return null;
  const packed = new Uint8Array(FINGERPRINT_BITS / 8);
  let set = 0;
  let index = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH - 1; x++, index++) {
      if ((data[y * WIDTH + x] ?? 0) < (data[y * WIDTH + x + 1] ?? 0)) {
        packed[index >> 3] = (packed[index >> 3] ?? 0) | (1 << (index & 7));
        set++;
      }
    }
  }
  return set < MIN_SET_BITS || set > FINGERPRINT_BITS - MIN_SET_BITS ? null : packed;
}

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, n) => {
  let bits = 0;
  for (let v = n; v > 0; v >>= 1) bits += v & 1;
  return bits;
});

/** Empreinte en hexadécimal (64 caractères), telle qu'elle est conservée en base. */
export const toHex = (print: Fingerprint): string => [...print].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Empreinte relue de la base ; null si la valeur est absente, vide ou mal formée. */
export function fromHex(hex: string | null | undefined): Fingerprint | null {
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null;
  return Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** Nombre de bits qui diffèrent entre deux empreintes. */
export function distance(a: Fingerprint, b: Fingerprint): number {
  let bits = 0;
  for (let i = 0; i < a.length; i++) bits += POPCOUNT[(a[i] ?? 0) ^ (b[i] ?? 0)] ?? 0;
  return bits;
}

/**
 * Second regard sur une paire que l'empreinte laisse dans le doute (L10.13) : les deux images réduites à 48 × 48 en
 * niveaux de gris, écart moyen par pixel (0 à 255). Une image sombre ou peu contrastée fait varier l'empreinte entre
 * deux encodages, mais pas cet écart. Mesuré sur l'archive de memento-local : 0,1 à 3,2 pour une même image, 20 et
 * plus pour deux photos différentes.
 */
export const CONFIRM_MAX_BITS = 24;
export const CONFIRM_MAX_PIXEL_DIFF = 6;
const SIDE = 48;

export type PixelSample = Uint8Array;

export const pixelSampleOf = (s: ImageSource): Promise<PixelSample | null> => greyPixels(s, SIDE, SIDE);

export function pixelDifference(a: PixelSample, b: PixelSample): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

/** Écart toléré entre les rapports largeur/hauteur de deux images. */
const ASPECT_TOLERANCE = 0.02;

export interface Dimensions {
  width: number | null;
  height: number | null;
}

export const pixelCount = (d: Dimensions): number => (d.width ?? 0) * (d.height ?? 0);

export const sameAspect = (a: Dimensions, b: Dimensions): boolean =>
  !!a.width && !!a.height && !!b.width && !!b.height && Math.abs(a.width / a.height / (b.width / b.height) - 1) <= ASPECT_TOLERANCE;

/** Dimensions lues par la liaison (appel gratuit) ; null si l'image est illisible. */
export async function dimensionsOf(s: ImageSource): Promise<Dimensions | null> {
  if (!canAnalyse(s) || !s.images) return null;
  try {
    const source = await s.bucket.get(s.key);
    if (!source) return null;
    const info = await s.images.info(source.body as ReadableStream<Uint8Array>);
    return "width" in info && info.width > 0 && info.height > 0 ? { width: info.width, height: info.height } : null;
  } catch {
    return null;
  }
}
