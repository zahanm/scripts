import { execSync, spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
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
  console.error(
    `Running: pipenv run fava personal.beancount --port 8080 --host=0.0.0.0`
  );
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
      // detached: true,
    }
  );
  console.log(`PID: ${fava.pid}`);
  const userId = execSync("id --user").toString().trim();
  const pidile = `/tmp/fava-server-${userId}/server.pid`;
  console.error(`Writing to: ${pidile}`);
  try {
    await mkdir(path.dirname(pidile));
  } catch (err) {
    // Handle the case where the directory already exists
    if (err.code != "EEXIST") throw err;
  }
  await writeFile(pidile, fava.pid.toString());
}
