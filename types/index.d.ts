declare module "*.wasm" {
  export function loadWasm(imports?: WebAssembly.Imports): Promise<WebAssembly.Instance>;

  export function getWasmBytes(): Uint8Array;

  export default loadWasm;
}
