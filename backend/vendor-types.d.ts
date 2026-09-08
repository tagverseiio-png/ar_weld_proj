/**
 * Type stubs for the in-process MindAR compile path.
 * The compiler src is vendored JS (backend/vendor/mind-ar, MIT) and
 * @napi-rs/canvas ships its own types only inside backend/node_modules,
 * so the root tsc run needs these ambient declarations.
 */

declare module "*offline-compiler.js" {
  export class OfflineCompiler {
    compileImageTargets(
      images: Array<{ width: number; height: number }>,
      progressCallback?: (percent: number) => void,
    ): Promise<unknown>;
    exportData(): Uint8Array;
  }
}

declare module "@napi-rs/canvas" {
  export interface NapiImage {
    width: number;
    height: number;
  }
  export function loadImage(path: string): Promise<NapiImage>;
  export function createCanvas(width: number, height: number): unknown;
}
