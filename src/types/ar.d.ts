declare module "mind-ar" {
  const x: unknown;
  export default x;
  export const MindARThree: new (args: unknown) => unknown;
}

declare module "mind-ar/dist/mindar-image-three.prod.js" {
  export const MindARThree: new (args: unknown) => unknown;
}

declare module "three" {
  export class VideoTexture {
    constructor(video: HTMLVideoElement);
    dispose(): void;
  }
  export class PlaneGeometry {
    constructor(w: number, h: number);
    dispose(): void;
  }
  export class MeshBasicMaterial {
    constructor(args: unknown);
    dispose(): void;
  }
  export class Mesh {
    constructor(geo: unknown, mat: unknown);
  }
}
