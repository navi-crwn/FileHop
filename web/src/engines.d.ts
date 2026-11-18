/* Type shims for engines that ship without usable declarations. */

declare module 'libheif-js/libheif-wasm/libheif.js' {
  const factory: (options?: object) => Promise<unknown>;
  export default factory;
}

declare module '@jsquash/jxl/codec/dec/jxl_dec.js' {
  const factory: (options?: object) => Promise<unknown>;
  export default factory;
}

declare module '@jsquash/jxl/codec/enc/jxl_enc.js' {
  const factory: (options?: object) => Promise<unknown>;
  export default factory;
}

declare module '@jsquash/jxl/meta.js' {
  export const defaultOptions: Record<string, unknown>;
}

declare module 'gifenc' {
  type Rgba = [number, number, number, number];
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, w: number, h: number, o: { palette: Rgba[]; transparent?: boolean; transparentIndex?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Uint8ClampedArray, maxColors: number, o?: { format?: string; oneBitAlpha?: boolean | number }): Rgba[];
  export function applyPalette(rgba: Uint8ClampedArray, palette: Rgba[], format?: string): Uint8Array;
}

declare module 'utif2' {
  interface Ifd { width: number; height: number; t274?: number[]; [tag: string]: unknown }
  const UTIF: {
    decode(buf: ArrayBuffer): Ifd[];
    decodeImage(buf: ArrayBuffer, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };
  export default UTIF;
}
