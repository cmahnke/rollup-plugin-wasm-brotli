import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import { dts } from "rollup-plugin-dts";

const configs = [
  {
    input: "src/rollup-plugin-wasm-brotli.ts",
    output: {
      file: "dist/rollup-plugin-wasm-brotli.js",
      format: "es"
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: "./tsconfig.json",
        compilerOptions: {
          outDir: "dist"
        }
      })
    ]
  },
  {
    input: "src/rollup-plugin-wasm-brotli.ts",
    output: {
      file: "dist/index.d.ts",
      format: "es"
    },
    plugins: [dts()]
  },
  {
    input: "src/compress.ts",
    output: {
      file: "dist/compress.mjs",
      format: "es"
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      typescript({
        tsconfig: "./tsconfig.json",
        compilerOptions: {
          outDir: "dist"
        }
      })
    ]
  }
];

export default configs;
