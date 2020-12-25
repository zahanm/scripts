import { execFileSync, execSync, spawn, spawnSync } from "child_process";
import { mkdir, open, readFile, writeFile } from "fs/promises";
import * as path from "path";

import { logWithTimestamp, pathExists } from "./utils";

const LOG_DIR = "/home/zahanm/log/fava-server/";

export async function updateFavaServer(
  opts: Record<string, any>,
  repo: string
) {
  await checkArgs(repo);
  const userId = execSync("id --user").toString().trim();
  const pidfile = `/tmp/fava-server-${userId}/server.pid`;
  await maybeKillOldServer(pidfile);
  if (checkForGitUpdates(repo)) {
    logWithTimestamp(`Updating ${repo}`);
    updateGitRepo(repo);
  } else {
    logWithTimestamp(`No updates to ${repo}`);
  }
  await spawnDetachedServer(repo, pidfile);
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
  logWithTimestamp("git fetch");
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
  logWithTimestamp(`local: ${localHEAD} remote: ${remoteHEAD}`);
  return localHEAD != remoteHEAD;
}

function updateGitRepo(repo: string) {
  logWithTimestamp("git merge origin/master --ff-only");
  spawnSync("git", ["merge", "origin/master"], { cwd: repo });
}

/**
 * Checks if the old server is running using the pidfile
 */
async function maybeKillOldServer(pidfile: string) {
  let oldPid: number | null = null;
  try {
    oldPid = parseInt((await readFile(pidfile)).toString());
  } catch (e) {
    // ignore the case where this file doesn't exist
    if (e.code !== "ENOENT") throw e;
  }
  if (oldPid != null) {
    logWithTimestamp(`kill ${oldPid}`);
    try {
      process.kill(oldPid);
    } catch (e) {
      if (e.code === "EPERM") throw e;
      // otherwise, the process doesn't exist - ie, it's not running
      logWithTimestamp("Old server died.");
    }
  }
}

async function spawnDetachedServer(repo: string, pidfile: string) {
  const out = await open(path.join(LOG_DIR, "out.log"), "a");
  const err = await open(path.join(LOG_DIR, "err.log"), "a");
  logWithTimestamp("Running: pipenv run fava personal.beancount --port 8080");
  logWithTimestamp(`Output to ${path.join(LOG_DIR, "{out,err}.log")}`);
  const fava = spawn(
    "pipenv",
    ["run", "fava", "personal.beancount", "--port", "8080"],
    {
      cwd: repo,
      detached: true,
      stdio: ["ignore", out.fd, err.fd],
    }
  );
  fava.unref();
  console.log(`PID: ${fava.pid}`);
  await writePidFile(pidfile, fava.pid);
}

async function writePidFile(pidfile: string, pid: number) {
  await maybeMkdir(path.dirname(pidfile));
  logWithTimestamp(`Pid file: ${pidfile}`);
  await writeFile(pidfile, pid.toString());
}

async function maybeMkdir(dir: string) {
  try {
    await mkdir(dir);
  } catch (e) {
    // Ignore the case where the directory already exists
    if (e.code != "EEXIST") throw e;
  }
}
