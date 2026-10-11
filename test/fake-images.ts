/**
 * Fausse liaison Cloudflare Images pour les tests : les fichiers d'image sont de petits JSON décrivant l'image ;
 * `output({ format: "rgb" })` rend des pixels calculés, de façon à régler l'écart d'empreinte et l'écart pixel à pixel.
 */

/**
 * Image simulée : le fichier est un petit JSON. `seed` fixe le motif ; `flip` inverse les premiers bits de
 * l'empreinte (écart d'empreinte voulu) ; `shift` décale tous les pixels de l'échantillon 48 × 48 (écart moyen voulu).
 */
export interface Fake { seed: number; flip?: number; shift?: number; w?: number; h?: number }
export const image = (f: Fake) => JSON.stringify({ w: 1000, h: 800, flip: 0, shift: 0, ...f });

function prng(seed: number) {
  let x = seed * 2654435761 >>> 0 || 1;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) >>> 16) / 65536;
}

/** Fausse liaison Images : pixels bruts (`rgb`) calculés à partir du JSON, dimensions par `info`. */
export function fakeImages() {
  let transforms = 0;
  const read = async (stream: ReadableStream<Uint8Array>) => JSON.parse(await new Response(stream).text()) as Required<Fake>;
  const images = {
    info: async (stream: ReadableStream<Uint8Array>) => {
      const f = await read(stream);
      return { format: "image/jpeg", fileSize: 1, width: f.w, height: f.h };
    },
    input: (stream: ReadableStream<Uint8Array>) => {
      let size = { width: 0, height: 0 };
      const handle = {
        transform: (t: { width: number; height: number }) => ((size = t), handle),
        output: async (o: { format: string }) => {
          transforms++;
          const f = await read(stream);
          if (o.format !== "rgb") return { response: () => new Response(new Uint8Array([1, 2, 3, 4])) };
          const grey = new Uint8Array(size.width * size.height);
          if (size.width === 17) {
            const rand = prng(f.seed);
            let bit = 0;
            for (let y = 0; y < 16; y++) {
              let v = 128;
              grey[y * 17] = v;
              for (let x = 1; x < 17; x++, bit++) {
                const up = (rand() < 0.5) !== bit < f.flip;
                v += up ? 5 : -5;
                grey[y * 17 + x] = v;
              }
            }
          } else {
            const rand = prng(f.seed + 1000);
            for (let i = 0; i < grey.length; i++) grey[i] = Math.min(255, 40 + Math.floor(rand() * 150) + f.shift);
          }
          const rgb = new Uint8Array(grey.length * 3);
          grey.forEach((v, i) => rgb.set([v, v, v], i * 3));
          return { response: () => new Response(rgb) };
        },
      };
      return handle;
    },
  };
  return { images: images as unknown as ImagesBinding, transforms: () => transforms };
}

