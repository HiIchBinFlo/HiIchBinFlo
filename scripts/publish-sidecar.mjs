#!/usr/bin/env node
// Publishes the CodeWalkerBridge .NET sidecar as a self-contained, single-file
// executable and places it at src-tauri/binaries/codewalker-bridge-<target-triple>[.exe],
// matching Tauri's sidecar binary naming convention. Run automatically by
// `npm run tauri dev` / `npm run tauri build` (see tauri.conf.json's
// beforeDevCommand/beforeBuildCommand) - developers don't need to run this by hand.
//
// Requires the .NET 8 SDK. See sidecar/README.md.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sidecarProject = join(root, "sidecar", "CodeWalkerBridge");
const binariesDir = join(root, "src-tauri", "binaries");

// Map Rust's target triple vocabulary to .NET RID (Runtime Identifier).
const RID_BY_RUST_TARGET = {
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "x86_64-pc-windows-msvc": "win-x64",
  "aarch64-pc-windows-msvc": "win-arm64",
  "x86_64-apple-darwin": "osx-x64",
  "aarch64-apple-darwin": "osx-arm64",
};

function rustHostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/host:\s*(\S+)/);
  if (!match) throw new Error("Could not determine host triple from `rustc -vV`.");
  return match[1];
}

function main() {
  const targetTriple = process.env.FCSTUDIO_TARGET_TRIPLE || rustHostTriple();
  const rid = RID_BY_RUST_TARGET[targetTriple];
  if (!rid) {
    throw new Error(
      `No .NET RID mapping for Rust target "${targetTriple}". Add one to RID_BY_RUST_TARGET in ${import.meta.url}.`,
    );
  }

  const isWindows = rid.startsWith("win-");
  const publishDir = join(sidecarProject, "bin", "sidecar-publish", rid);

  console.log(`[publish-sidecar] Publishing CodeWalkerBridge for ${targetTriple} (RID ${rid})...`);
  execFileSync(
    "dotnet",
    [
      "publish",
      "-c",
      "Release",
      "-r",
      rid,
      "--self-contained",
      "true",
      "-p:PublishSingleFile=true",
      "-p:IncludeNativeLibrariesForSelfExtract=true",
      "-o",
      publishDir,
    ],
    { cwd: sidecarProject, stdio: "inherit" },
  );

  mkdirSync(binariesDir, { recursive: true });
  const sourceName = isWindows ? "codewalker-bridge.exe" : "codewalker-bridge";
  const destName = isWindows
    ? `codewalker-bridge-${targetTriple}.exe`
    : `codewalker-bridge-${targetTriple}`;
  const sourcePath = join(publishDir, sourceName);
  const destPath = join(binariesDir, destName);

  if (!existsSync(sourcePath)) {
    throw new Error(`Expected published binary at ${sourcePath} but it wasn't found.`);
  }
  copyFileSync(sourcePath, destPath);
  if (!isWindows) chmodSync(destPath, 0o755);

  console.log(`[publish-sidecar] Wrote ${destPath}`);
}

main();
