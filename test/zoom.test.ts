import { describe, expect, it } from "vitest";
import { fullResolutionSize, relativePointInContain, scrollToCenter } from "../web/src/zoom";

describe("loupe : pleine résolution", () => {
  it("affiche un pixel d'image pour un pixel d'écran, selon la densité de l'écran", () => {
    expect(fullResolutionSize({ width: 3000, height: 2000 }, 1)).toEqual({ width: 3000, height: 2000 });
    expect(fullResolutionSize({ width: 3000, height: 2000 }, 2)).toEqual({ width: 1500, height: 1000 });
    expect(fullResolutionSize({ width: 3000, height: 2000 }, 1.5)).toEqual({ width: 2000, height: 1333.3333333333333 });
    expect(fullResolutionSize({ width: 100, height: 50 }, 0)).toEqual({ width: 100, height: 50 });
  });

  it("repère un clic dans l'image ajustée, marges comprises", () => {
    // Zone 1000x500, image 2000x2000 ajustée en 500x500, centrée : marges de 250 px de chaque côté.
    const area = { width: 1000, height: 500 };
    const natural = { width: 2000, height: 2000 };
    expect(relativePointInContain({ x: 500, y: 250 }, area, natural)).toEqual({ x: 0.5, y: 0.5 });
    expect(relativePointInContain({ x: 250, y: 0 }, area, natural)).toEqual({ x: 0, y: 0 });
    expect(relativePointInContain({ x: 750, y: 500 }, area, natural)).toEqual({ x: 1, y: 1 });
    expect(relativePointInContain({ x: 10, y: 250 }, area, natural).x).toBe(0);
    expect(relativePointInContain({ x: 990, y: 250 }, area, natural).x).toBe(1);
    expect(relativePointInContain({ x: 375, y: 125 }, area, natural)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("ne plante pas sur une image ou une zone de taille nulle", () => {
    expect(relativePointInContain({ x: 5, y: 5 }, { width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({ x: 0.5, y: 0.5 });
    expect(relativePointInContain({ x: 5, y: 5 }, { width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it("centre le défilement sur le point, borné au contenu", () => {
    const content = { width: 3000, height: 2000 };
    const area = { width: 1000, height: 500 };
    expect(scrollToCenter({ x: 0.5, y: 0.5 }, content, area)).toEqual({ left: 1000, top: 750 });
    expect(scrollToCenter({ x: 0, y: 0 }, content, area)).toEqual({ left: 0, top: 0 });
    expect(scrollToCenter({ x: 1, y: 1 }, content, area)).toEqual({ left: 2000, top: 1500 });
    expect(scrollToCenter({ x: 0.1, y: 0.9 }, content, area)).toEqual({ left: 0, top: 1500 });
  });

  it("ne défile pas quand l'image tient dans la zone", () => {
    expect(scrollToCenter({ x: 0.5, y: 0.5 }, { width: 400, height: 300 }, { width: 1000, height: 500 })).toEqual({ left: 0, top: 0 });
  });
});
