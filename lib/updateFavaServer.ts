import {
  ChildProcess,
  execFileSync,
  execSync,
  spawn,
  spawnSync,
} from "child_process";
import { mkdir, open, readFile, writeFile } from "fs/promises";
import * as path from "path";

import { pathExists } from "./utils";

export async function updateFavaServer(
  opts: Record<string, any>,
  repo: string
) {
  await checkArgs(repo);
  if (!checkForGitUpdates(repo)) {
    console.error(`Quitting. No updates to ${repo}`);
    return;
  }
  const userId = execSync("id --user").toString().trim();
  const pidfile = `/tmp/fava-server-${userId}/server.pid`;
  const dataDir = path.dirname(pidfile);
  await maybeKillOldServer(pidfile);
  updateGitRepo(repo);
  await maybeMkdir(dataDir);
  const fava = await spawnDetachedServer(dataDir, repo);
  console.log(`PID: ${fava.pid}`);
  console.error(`Writing to: ${pidfile}`);
  await writeFile(pidfile, fava.pid.toString());
}

async function checkArgs(repo: string) {
  if (!(await pathExists(repo))) {
    throw new Error(`The folder does not exist: ${repo}.`);
  }
  if (!path.isAbsolute(repo)) {
    throw new Error(`Must provide absolute path for repo: ${repo}.`);
  }
}

/**
 * @returns whether there are updates to this repo
 */
function checkForGitUpdates(repo: string): boolean {
  console.error("git fetch");
  // need to run this in the pipenv since the dropbox remote helper is installed there
  spawnSync("pipenv", ["run", "git", "fetch"], {
    cwd: repo,
  });
  const localHEAD = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
  })
    .toString()
    .trim();
  const remoteHEAD = execFileSync("git", ["rev-parse", "@{u}"], {
    cwd: repo,
  })
    .toString()
    .trim();
  console.error(`local: ${localHEAD} remote: ${remoteHEAD}`);
  return localHEAD != remoteHEAD;
}

function updateGitRepo(repo: string) {
  console.error("git merge origin/master --ff-only");
  spawnSync("git", ["merge", "origin/master"], { cwd: repo });
}

async function maybeKillOldServer(pidfile: string) {
  let oldPid: number | null = null;
  try {
    oldPid = parseInt((await readFile(pidfile)).toString());
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
}

async function maybeMkdir(dir: string) {
  try {
    await mkdir(dir);
  } catch (e) {
    // Ignore the case where the directory already exists
    if (e.code != "EEXIST") throw e;
  }
}

async function spawnDetachedServer(
  dataDir: string,
  repo: string
): Promise<ChildProcess> {
  const out = await open(path.join(dataDir, "out.log"), "a");
  const err = await open(path.join(dataDir, "err.log"), "a");
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
      detached: true,
      stdio: ["ignore", out.fd, err.fd],
    }
  );
  fava.unref();
  return fava;
}
