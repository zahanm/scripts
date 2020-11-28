import { execSync, spawn } from "child_process";
import { mkdir, open, readFile, writeFile } from "fs/promises";
import * as path from "path";

import { pathExists } from "./utils";

export async function updateFavaServer(
  opts: Record<string, any>,
  repo: string
) {
  if (!(await pathExists(repo))) {
    throw new Error(`The folder does not exist: ${repo}.`);
  }
  if (!path.isAbsolute(repo)) {
    throw new Error(`Must provide absolute path for repo: ${repo}.`);
  }
  const userId = execSync("id --user").toString().trim();
  const pidile = `/tmp/fava-server-${userId}/server.pid`;
  const dataDir = path.dirname(pidile);
  let oldPid: number | null = null;
  try {
    oldPid = parseInt((await readFile(pidile)).toString());
  } catch (e) {
    throw e;
  }
  if (oldPid != null) {
    console.error(`kill ${oldPid}`);
    try {
      process.kill(oldPid);
    } catch (e) {
      if (e.code === "EPERM") throw e;
      // otherwise, the process doesn't exist - ie, it's not running
      console.error("Old server died.");
    }
  }
  console.error(
    `Running: pipenv run fava personal.beancount --port 8080 --host=0.0.0.0`
  );
  try {
    await mkdir(dataDir);
  } catch (e) {
    // Handle the case where the directory already exists
    if (e.code != "EEXIST") throw e;
  }
  const out = await open(path.join(dataDir, "out.log"), "a");
  const err = await open(path.join(dataDir, "err.log"), "a");
  const fava = spawn(
    "pipenv",
    [
      "run",
      "fava",
      "personal.beancount",
      "--port",
      "8080",
      "--host",
      "0.0.0.0",
    ],
    {
      cwd: repo,
      detached: true,
      stdio: ["ignore", out.fd, err.fd],
    }
  );
  fava.unref();
  console.log(`PID: ${fava.pid}`);
  console.error(`Writing to: ${pidile}`);
  await writeFile(pidile, fava.pid.toString());
}
