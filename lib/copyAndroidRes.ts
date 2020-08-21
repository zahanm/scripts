import * as readline from "readline";
import * as path from "path";
import { spawnSync } from "child_process";

import { pathExists } from "./utils";

export async function copyAndroidRes(opts: Record<string, any>, dest: string) {
  if (!(await pathExists(dest))) {
    throw new Error(`Must provide valid folder: ${dest}.`);
  }
  if (!path.isAbsolute(dest)) {
    throw new Error(`Must provide absolute path to ${dest}.`);
  }
  const rl = readline.createInterface({ input: process.stdin });
  for await (const filename of rl) {
    if (!path.isAbsolute(filename)) {
      console.log(`Non-absolute path ${filename}, skipping.`);
      continue;
    }
    const resDir = path.basename(path.dirname(filename));
    if (!resDir.match(/[lmh]dpi$/)) {
      console.log(`No resource directory for ${filename}, skipping.`);
      continue;
    }
    const outDir = path.join(dest, resDir);
    if (!(await pathExists(outDir))) {
      console.log(`No resource directory at ${outDir}, skipping.`);
      continue;
    }
    const out = path.join(outDir, path.basename(filename));
    console.log(`cp ${filename} ${out}`);
    if (opts.commit) {
      const { error } = spawnSync("cp", [filename, out]);
      if (error) {
        console.error(error);
        process.exit(1);
      }
    }
  }
}
