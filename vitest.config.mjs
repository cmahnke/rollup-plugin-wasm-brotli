import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/*.{js,mjs,cjs,ts,mts,cts}"],
    exclude: [
      "**/test/fixtures/**",
      "**/test/helpers/**",
      "**/test/node_modules/**",
      "**/test/recipes/**",
      "**/test/output/**",
      "**/test/snapshots/**",
      "**/test/types.ts"
    ],
    resolveSnapshotPath: (testPath, snapExt) => path.join(path.dirname(testPath), "snapshots", path.basename(testPath) + snapExt)
  },
  resolve: {
    alias: [{ find: /^~package$/, replacement: path.resolve(process.cwd()) }]
  }
});
