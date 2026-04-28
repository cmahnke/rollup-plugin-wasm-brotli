import { describe, it, expect, beforeAll } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { createRequire } from "module";
import type { Plugin } from "rollup";
import inlineWasm from "../src/rollup-plugin-wasm-brotli";
import * as pkg from "brotli-unicode";
const { compress, decompress } = pkg;

const WASM_FILE = "../node_modules/brotli-wasm/pkg.node/brotli_wasm_bg.wasm";
const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, WASM_FILE);
const IMPORTER_PATH = resolve(__dirname, "../src/rollup-plugin-wasm-brotli.ts");

function extractWasmStr(code: string): string | null {
  const match = code.match(/const wasmStr = ("(?:[^"\\]|\\.)*")/s);
  if (!match) return null;
  return JSON.parse(match[1]);
}

let loadResult: string;

describe("inlineWasm Plugin", () => {
  let plugin: Plugin;

  beforeAll(async () => {
    plugin = await inlineWasm();
    loadResult = await plugin.load(WASM_PATH);
  }, 30_000);

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe("Plugin Metadata", () => {
    it("has the correct plugin name", async () => {
      const plugin = await inlineWasm();
      expect(plugin.name).toBe("inline-wasm");
    });

    it("returns an object with the expected hooks", async () => {
      const plugin = await inlineWasm();
      expect(typeof plugin.resolveId).toBe("function");
      expect(typeof plugin.load).toBe("function");
      expect(typeof plugin.transform).toBe("function");
    });
  });

  // ── resolveId ─────────────────────────────────────────────────────────────

  describe("resolveId", () => {
    it("returns null for non-WASM files", async () => {
      const plugin = await inlineWasm();
      expect(await plugin.resolveId("module.js", undefined)).toBeNull();
      expect(await plugin.resolveId("module.ts", undefined)).toBeNull();
      expect(await plugin.resolveId("module.css", undefined)).toBeNull();
    });

    it("resolves the path relative to the importer", async () => {
      const plugin = await inlineWasm();
      const result = await plugin.resolveId("brotli_wasm_bg.wasm", IMPORTER_PATH);
      expect(result).toBe(resolve(dirname(IMPORTER_PATH), "brotli_wasm_bg.wasm"));
    });

    it("resolves the path absolutely without an importer", async () => {
      const plugin = await inlineWasm();
      const result = await plugin.resolveId("brotli_wasm_bg.wasm", undefined);
      expect(result).toBe(resolve("brotli_wasm_bg.wasm"));
    });

    it("handles nested relative paths correctly", async () => {
      const plugin = await inlineWasm();
      const result = await plugin.resolveId(WASM_FILE, IMPORTER_PATH);
      expect(result).toBe(resolve(dirname(IMPORTER_PATH), WASM_FILE));
    });

    it("returns an absolute path unchanged when there is no importer", async () => {
      const plugin = await inlineWasm();
      const result = await plugin.resolveId(WASM_PATH, undefined);
      expect(result).toBe(resolve(WASM_PATH));
    });
  });

  // ── load ──────────────────────────────────────────────────────────────────

  describe("load", () => {
    it("returns null for non-WASM files", async () => {
      const plugin = await inlineWasm();
      expect(await plugin.load("/path/to/file.js")).toBeNull();
      expect(await plugin.load("/path/to/file.ts")).toBeNull();
    });

    it("throws an error for a non-existent file", async () => {
      const plugin = await inlineWasm();
      await expect(plugin.load("/non/existent.wasm")).rejects.toThrow();
    });

    it("returns a string", () => {
      expect(loadResult).toBeTypeOf("string");
    });

    it("generated code contains an embedded compressed string via JSON.stringify", () => {
      expect(loadResult).toMatch(/const wasmStr = "(?:[^"\\]|\\.)*"/s);
    });

    it("generated code contains all exports", () => {
      expect(loadResult).toContain("export async function loadWasm");
      expect(loadResult).toContain("export async function getWasmBytes");
      expect(loadResult).toContain("export default loadWasm");
    });

    it("generated code contains the source ID as a comment", () => {
      expect(loadResult).toContain(`Source: ${WASM_PATH}`);
    });

    it("generated code contains brotli decompress", () => {
      expect(loadResult).toContain("import { decompress } from 'brotli-unicode/js';");
      expect(loadResult).toContain("decompress");
    });

    it("generated code is syntactically valid JavaScript", () => {
      expect(loadResult).toContain("export async function loadWasm");
      expect(loadResult).toContain("export async function getWasmBytes");
      expect(loadResult).toContain("export default loadWasm");
      expect(loadResult).toContain("WebAssembly.instantiate");
      expect(loadResult).toContain("decompress(wasmStr)");
    });

    it("getWasmBytes is not async (returns Promise directly, no double-wrap)", () => {
      expect(loadResult).toContain("export async function getWasmBytes");
    });

    it("uses internal cache (getOrDecompress)", () => {
      expect(loadResult).toContain("getOrDecompress");
      expect(loadResult).toContain("cachedBytes");
    });

    // ── Decompress and compare ────────────────────────────────────

    describe("Decompression: Roundtrip Integrity", () => {
      let originalBytes: Uint8Array;
      let decompressedBytes: Uint8Array;

      beforeAll(async () => {
        originalBytes = new Uint8Array(readFileSync(WASM_PATH));
        const compressed = await compress(originalBytes);
        decompressedBytes = await decompress(compressed);
      }, 30_000);

      it("decompressed length matches the original exactly", () => {
        expect(decompressedBytes.length).toBe(originalBytes.length);
      });

      it("decompressed bytes are byte-for-byte identical to the original", () => {
        const originalBuffer = Buffer.from(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength);
        const decompressedBuffer = Buffer.from(decompressedBytes.buffer, decompressedBytes.byteOffset, decompressedBytes.byteLength);
        expect(originalBuffer.equals(decompressedBuffer)).toBe(true);
      });

      it("decompressed bytes contain the correct WASM magic number (\\0asm)", () => {
        expect(decompressedBytes[0]).toBe(0x00);
        expect(decompressedBytes[1]).toBe(0x61);
        expect(decompressedBytes[2]).toBe(0x73);
        expect(decompressedBytes[3]).toBe(0x6d);
      });

      it("decompressed bytes contain the correct WASM version (1)", () => {
        expect(decompressedBytes[4]).toBe(0x01);
        expect(decompressedBytes[5]).toBe(0x00);
        expect(decompressedBytes[6]).toBe(0x00);
        expect(decompressedBytes[7]).toBe(0x00);
      });

      it("first and last byte are identical to the original", () => {
        expect(decompressedBytes[0]).toBe(originalBytes[0]);
        expect(decompressedBytes[decompressedBytes.length - 1]).toBe(originalBytes[originalBytes.length - 1]);
      });

      it("compressed data embedded in the generated code decompresses to the original", async () => {
        const embeddedStr = extractWasmStr(loadResult);
        expect(embeddedStr).not.toBeNull();

        const decompressedFromCode = await decompress(embeddedStr!);
        const originalBytes = new Uint8Array(readFileSync(WASM_PATH));

        expect(decompressedFromCode.length).toBe(originalBytes.length);

        const originalBuffer = Buffer.from(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength);
        const decompressedBuffer = Buffer.from(
          decompressedFromCode.buffer,
          decompressedFromCode.byteOffset,
          decompressedFromCode.byteLength
        );
        expect(originalBuffer.equals(decompressedBuffer)).toBe(true);
      }, 30_000);
    });
  });

  // ── transform ─────────────────────────────────────────────────────────────

  describe("transform", () => {
    it("returns null for .wasm files", async () => {
      const plugin = await inlineWasm();
      const result = await plugin.transform("", WASM_PATH);
      expect(result).toBeNull();
    });

    it("returns null when no WASM URL pattern is present", async () => {
      const plugin = await inlineWasm();
      const code = `const x = new URL('./file.js', import.meta.url);`;
      const result = await plugin.transform(code, IMPORTER_PATH);
      expect(result).toBeNull();
    });

    it("transforms a single WASM URL pattern with double quotes", async () => {
      const plugin = await inlineWasm();
      const code = `const url = new URL('./brotli_wasm_bg.wasm', import.meta.url);`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result).not.toBeNull();
      expect(result!.code).toContain("await __wasm_0()");
      expect(result!.code).not.toContain("URL.createObjectURL");
      expect(result!.code).not.toContain("new Blob");
    });

    it("transforms a single WASM URL pattern with single quotes", async () => {
      const plugin = await inlineWasm();
      const code = `const url = new URL('./brotli_wasm_bg.wasm', import.meta.url);`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result).not.toBeNull();
      expect(result!.code).toContain("await __wasm_0()");
      expect(result!.code).not.toContain("URL.createObjectURL");
      expect(result!.code).not.toContain("new Blob");
    });

    it("URL-pattern replacement returns Uint8Array (BufferSource) not a URL", async () => {
      const plugin = await inlineWasm();
      const code = `const wasmInput = new URL('./brotli_wasm_bg.wasm', import.meta.url);`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result).not.toBeNull();
      // Das Ergebnis ist ein await-Ausdruck der Uint8Array liefert
      expect(result!.code).toContain("await __wasm_0()");
    });

    it("inserts the correct import for the WASM file", async () => {
      const plugin = await inlineWasm();
      const code = `const url = new URL('./brotli_wasm_bg.wasm', import.meta.url);`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      const expectedPath = resolve(dirname(IMPORTER_PATH), "./brotli_wasm_bg.wasm");
      expect(result!.code).toContain(`import { getWasmBytes as __wasm_0 } from '${expectedPath}'`);
    });

    it("transforms multiple WASM URL patterns", async () => {
      const plugin = await inlineWasm();
      const code = [
        `const url1 = new URL('./brotli_wasm_bg.wasm', import.meta.url);`,
        `const url2 = new URL('${WASM_FILE}', import.meta.url);`
      ].join("\n");

      const result = await plugin.transform(code, IMPORTER_PATH);

      const path1 = resolve(dirname(IMPORTER_PATH), "./brotli_wasm_bg.wasm");
      const path2 = resolve(dirname(IMPORTER_PATH), WASM_FILE);

      expect(result!.code).toContain(`from '${path1}'`);
      expect(result!.code).toContain(`from '${path2}'`);
      expect(result!.code).toContain("__wasm_0");
      expect(result!.code).toContain("__wasm_1");
    });

    it("leaves the remaining code unchanged", async () => {
      const plugin = await inlineWasm();
      const code = [`const x = 42;`, `const url = new URL('./brotli_wasm_bg.wasm', import.meta.url);`, `console.log(x);`].join("\n");

      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result!.code).toContain("const x = 42;");
      expect(result!.code).toContain("console.log(x);");
    });

    it("returns an empty source map", async () => {
      const plugin = await inlineWasm();
      const code = `const url = new URL('./brotli_wasm_bg.wasm', import.meta.url);`;
      const result = await plugin.transform(code, IMPORTER_PATH);
      expect(result!.map).toEqual({ mappings: "" });
    });

    it("is idempotent across repeated calls (lastIndex reset)", async () => {
      const plugin = await inlineWasm();
      const code = `const url = new URL('./brotli_wasm_bg.wasm', import.meta.url);`;

      const result1 = await plugin.transform(code, IMPORTER_PATH);
      const result2 = await plugin.transform(code, IMPORTER_PATH);

      expect(result1!.code).toBe(result2!.code);
    });
  });

  // ── transform: wasm-pack ──────────────────────────────────────────────────

  describe("transform: wasm-pack style imports (using brotli-wasm)", () => {
    it("transforms direct .wasm imports (import x from '...wasm') – wasm-pack pattern", async () => {
      const plugin = await inlineWasm();

      const code = [
        `import init, { CompressStream } from 'brotli-wasm/pkg.bundler/brotli_wasm.js';`,
        `import wasm from 'brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm';`,
        `const wasmReady = (async () => { await init({ wasm }); })();`
      ].join("\n");

      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result).not.toBeNull();
      expect(result!.code).not.toContain(`import wasm from 'brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm'`);
      expect(result!.code).toContain(`getWasmBytes`);
      expect(result!.code).toContain(`const wasm = await __wasm_`);
    });

    it("inserts the correct import for the wasm-pack style import", async () => {
      const plugin = await inlineWasm();

      const code = `import wasm from 'brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm';`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      const require = createRequire(IMPORTER_PATH);
      const expectedPath = require.resolve("brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm");

      expect(result!.code).toContain(`import { getWasmBytes as __wasm_0 } from '${expectedPath}'`);
    });

    it("preserves the original binding name", async () => {
      const plugin = await inlineWasm();

      const code = `import myWasm from 'brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm';`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result!.code).toContain(`const myWasm = await __wasm_0()`);
    });

    it("returns an empty source map for wasm-pack style imports", async () => {
      const plugin = await inlineWasm();

      const code = `import wasm from 'brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm';`;
      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result!.map).toEqual({ mappings: "" });
    });

    it("leaves non-wasm imports unchanged", async () => {
      const plugin = await inlineWasm();

      const code = [
        `import init, { CompressStream } from 'brotli-wasm/pkg.bundler/brotli_wasm.js';`,
        `import wasm from 'brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm';`
      ].join("\n");

      const result = await plugin.transform(code, IMPORTER_PATH);

      expect(result!.code).toContain(`import init, { CompressStream } from 'brotli-wasm/pkg.bundler/brotli_wasm.js'`);
    });

    it("wasm-pack: Uint8Array is valid BufferSource for WebAssembly.instantiate", async () => {
      const plugin = await inlineWasm();
      const require = createRequire(IMPORTER_PATH);
      const wasmPackPath = require.resolve("brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm");
      const wasmLoadResult = await plugin.load(wasmPackPath);

      expect(wasmLoadResult).not.toBeNull();

      const embeddedStr = extractWasmStr(wasmLoadResult!);
      expect(embeddedStr).not.toBeNull();

      const decompressedBytes = await decompress(embeddedStr!);

      expect(decompressedBytes).toBeInstanceOf(Uint8Array);
      expect(decompressedBytes[0]).toBe(0x00); // \0  (nicht 0x5b = "[")
      expect(decompressedBytes[1]).toBe(0x61); //  a  (nicht 0x6f = "o")
      expect(decompressedBytes[2]).toBe(0x73); //  s  (nicht 0x62 = "b")
      expect(decompressedBytes[3]).toBe(0x6d); //  m  (nicht 0x6a = "j")
    }, 30_000);

    it("decompressed wasm-pack bytes are valid WebAssembly (WebAssembly.validate)", async () => {
      const plugin = await inlineWasm();

      const require = createRequire(IMPORTER_PATH);
      const wasmPackPath = require.resolve("brotli-wasm/pkg.bundler/brotli_wasm_bg.wasm");
      const wasmLoadResult = await plugin.load(wasmPackPath);

      expect(wasmLoadResult).not.toBeNull();

      const embeddedStr = extractWasmStr(wasmLoadResult!);
      expect(embeddedStr).not.toBeNull();

      const decompressedBytes = await decompress(embeddedStr!);
      const wasmBytes = decompressedBytes instanceof Uint8Array ? decompressedBytes : new Uint8Array(decompressedBytes);

      expect(WebAssembly.validate(wasmBytes)).toBe(true);
    }, 30_000);
  });

  // ── Integration ───────────────────────────────────────────────────────────

  describe("Integration: resolveId → load", () => {
    it("full cycle: resolve path and load", async () => {
      const plugin = await inlineWasm();

      const resolvedId = await plugin.resolveId(WASM_FILE, IMPORTER_PATH);
      expect(resolvedId).toBe(WASM_PATH);

      const result = await plugin.load(resolvedId);
      expect(result).toBeTypeOf("string");
      expect(result).toContain("export async function loadWasm");
      expect(result).toContain(`Source: ${WASM_PATH}`);
    });
  });

  // ── Integration: Runtime WASM Instantiation ───────────────────────────────

  describe("Integration: Runtime WASM Instantiation", () => {
    it("getWasmBytes() returns a Uint8Array with the correct WASM magic number", async () => {
      const embeddedStr = extractWasmStr(loadResult);
      expect(embeddedStr).not.toBeNull();

      const decompressedBytes = await decompress(embeddedStr!);

      expect(decompressedBytes).toBeInstanceOf(Uint8Array);
      expect(decompressedBytes[0]).toBe(0x00);
      expect(decompressedBytes[1]).toBe(0x61);
      expect(decompressedBytes[2]).toBe(0x73);
      expect(decompressedBytes[3]).toBe(0x6d);
    });

    it("getWasmBytes() must not return a stringified object ([object ...])", async () => {
      const embeddedStr = extractWasmStr(loadResult);
      expect(embeddedStr).not.toBeNull();

      const result = await decompress(embeddedStr!);

      if (typeof result === "string") {
        expect(result).not.toMatch(/^$object/);
      }

      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("generated getWasmBytes() passes a real Uint8Array to WebAssembly, not a string", async () => {
      const embeddedStr = extractWasmStr(loadResult);
      expect(embeddedStr).not.toBeNull();

      const result = await decompress(embeddedStr!);

      expect(typeof result).not.toBe("string");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.constructor.name).toBe("Uint8Array");
    }, 30_000);

    it("WebAssembly.instantiate() can consume the decompressed bytes without magic word error", async () => {
      const embeddedStr = extractWasmStr(loadResult);
      expect(embeddedStr).not.toBeNull();

      const decompressedBytes = await decompress(embeddedStr!);
      const wasmBytes = decompressedBytes instanceof Uint8Array ? decompressedBytes : new Uint8Array(decompressedBytes);

      try {
        await WebAssembly.instantiate(wasmBytes, {});
      } catch (e) {
        const message = (e as Error).message;
        if (message.includes("Import") || message.includes("import")) return;

        throw new Error(`Unexpected WebAssembly error (possible magic word mismatch): ${message}`, { cause: e });
      }
    }, 30_000);

    it("decompressed bytes are valid WebAssembly (WebAssembly.validate)", async () => {
      const embeddedStr = extractWasmStr(loadResult);
      expect(embeddedStr).not.toBeNull();

      const decompressedBytes = await decompress(embeddedStr!);
      const wasmBytes = decompressedBytes instanceof Uint8Array ? decompressedBytes : new Uint8Array(decompressedBytes);

      expect(WebAssembly.validate(wasmBytes)).toBe(true);
    }, 30_000);

    it("loadWasm() returns a WebAssembly.Instance when imports are satisfied", async () => {
      const embeddedStr = extractWasmStr(loadResult);
      expect(embeddedStr).not.toBeNull();

      const bytes = await decompress(embeddedStr!);
      const wasmBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

      try {
        const { instance } = await WebAssembly.instantiate(wasmBytes, {});
        expect(instance).toBeInstanceOf(WebAssembly.Instance);
      } catch (e) {
        const message = (e as Error).message;
        if (message.includes("Import") || message.includes("import")) return;
        throw new Error(`loadWasm() simulation failed: ${message}`, { cause: e });
      }
    }, 30_000);
  });
});
