#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { compress } from "brotli-unicode";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`
Usage:
  compress <input-file> [options]

Options:
  -o, --output <file>   Output file (default: <input>.txt)
  -h, --help            Show this help message

Examples:
  compress my-file.txt
  compress my-file.txt -o output
`);
}

function parseArgs(args: string[]): {
  input: string | null;
  output: string | null;
  help: boolean;
} {
  const result = {
    input: null as string | null,
    output: null as string | null,
    help: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg === "-o" || arg === "--output") {
      result.output = args[++i] ?? null;
    } else if (!arg.startsWith("-")) {
      result.input = arg;
    } else {
      console.error(`❌ Unknown option: ${arg}`);
      process.exit(1);
    }

    i++;
  }

  return result;
}

// ── Format file size ──────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (!opts.input) {
    console.error("❌ No input file specified.");
    printHelp();
    process.exit(1);
  }

  if (!existsSync(opts.input)) {
    console.error(`❌ File not found: ${opts.input}`);
    process.exit(1);
  }

  // Determine output path
  const outputPath = opts.output ?? `${opts.input}.txt`;

  console.log(`\n🗜️  Brotli-Unicode Compressor`);
  console.log(`${"─".repeat(40)}`);
  console.log(`📄 Input   : ${opts.input}`);
  console.log(`💾 Output  : ${outputPath}`);
  console.log(`${"─".repeat(40)}`);

  try {
    // Read file as Buffer → Uint8Array
    const inputBuffer = readFileSync(opts.input);
    const inputSize = inputBuffer.length;
    console.log(`📦 Original size : ${formatBytes(inputSize)}`);

    // Compress
    console.log("⏳ Compressing...");
    const startTime = Date.now();

    const compressed = await compress(new Uint8Array(inputBuffer));

    const elapsed = Date.now() - startTime;

    // Save result
    writeFileSync(outputPath, compressed, "utf-8");

    const outputSize = Buffer.byteLength(compressed, "utf-8");
    const ratio = ((1 - outputSize / inputSize) * 100).toFixed(1);

    console.log(`✅ Compressed size : ${formatBytes(outputSize)}`);
    console.log(`📉 Savings         : ${ratio}%`);
    console.log(`⏱️  Duration        : ${elapsed}ms`);
    console.log(`${"─".repeat(40)}`);
    console.log(`✨ Done! → ${outputPath}\n`);
  } catch (err) {
    console.error("❌ Error during compression:", err);
    process.exit(1);
  }
}

main();
