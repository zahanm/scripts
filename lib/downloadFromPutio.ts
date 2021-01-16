import { stat, writeFile, readFile } from "fs/promises";
import { URL } from "url";
import { spawnSync } from "child_process";
import * as path from "path";
import { ok as assert } from "assert";

import * as Parser from "rss-parser";
import escapeStringRegexp = require("escape-string-regexp");
import { DateTime } from "luxon";
import * as csvParse from "csv-parse/lib/sync";

import { logWithTimestamp, pathExists } from "./utils";

/**
 * This is going to use Rclone as the interface to Put.io. That means it needs to be set up locally as a prerequisite.
 * 1. Fetch showRSS.info feed
 * 2. Check if there are items newer than the last download
 * 3. Look for each item in Put.io, see if it's there yet
 * 4. Download that item using Rclone, and put it in the right folder
 */
export async function downloadTvShowsFromPutio(
  opts: Record<string, any>,
  feedUrl: string,
  downloadTsFile: string,
  tvShowsFolder: string
) {
  checkArgs(feedUrl);
  const allItems = await fetchShowRssFeed(feedUrl);
  logWithTimestamp(`Got ${allItems.length} items in the feed.`);
  const lastDownload = await getLastDownloadTime(downloadTsFile);
  logWithTimestamp(`Finding items newer than ${lastDownload}.`);
  const newItems = itemsNewerThan(allItems, lastDownload);
  logWithTimestamp(`${newItems.length} new items to download.`);
  const putioEntries = await lsPutio(opts, /* root folder */ "");
  for (const item of newItems) {
    const entry = findPutioEntry(putioEntries, item);
    if (entry) {
      logWithTimestamp(`Found ${entry.Path} ${entry.IsDir}.`);
      const videoFile = await findVideoFile(opts, entry);
      if (opts.commit) {
        const outputFolder = path.join(tvShowsFolder, item["tv:show_name"]);
        await downloadItem(videoFile, outputFolder);
      } else {
        logWithTimestamp(`Would have downloaded ${videoFile.Path}`);
      }
    } else {
      logWithTimestamp(`Could not find ${item.title}.`);
    }
  }
  if (newItems.length > 0 && opts.commit) {
    logWithTimestamp(`Bumping the mtime on ${downloadTsFile}`);
    await bumpLastDownloadTime(downloadTsFile);
  }
}

/**
 * This takes a input file that is a TSV with movie folder / filename in column 1, and the destination folder name (ie, the film name with the year) in column 2.
 */
export async function downloadMoviesFromPutio(
  opts: Record<string, any>,
  inputFile: string,
  moviesFolder: string
) {
  const inputContents = await readFile(inputFile, { encoding: "utf8" });
  const records = csvParse(inputContents, { delimiter: "\t", trim: true });
  logWithTimestamp(`${records.length} movies to download.`);
  for (const record of records) {
    const remoteName = record[0];
    const movieName = record[1];
    logWithTimestamp(`${movieName}`);
    const localDest = path.join(moviesFolder, movieName);
    const remoteEntry = await getPutioEntryForPath(opts, remoteName);
    if (await pathExists(localDest)) {
      logWithTimestamp(`${localDest} is already downloaded.`);
      continue;
    }
    const videoEntry = await findVideoFile(opts, remoteEntry);
    if (opts.commit) {
      await downloadItem(videoEntry, localDest);
    } else {
      logWithTimestamp(
        `Would have downloaded ${videoEntry.Path}, to ${localDest}`
      );
    }
    await findAndDownloadSubtitles(opts, remoteEntry, localDest);
  }
}

function checkArgs(url: string) {
  new URL(url);
}

type TvFeed = {};
type TvItem = { "tv:show_name": string; "tv:raw_title": string };
type Item = Parser.Item & TvItem;

async function fetchShowRssFeed(feedURL: string): Promise<Item[]> {
  const parser = new Parser<TvFeed, TvItem>({
    customFields: {
      item: ["tv:show_name", "tv:raw_title"],
    },
  });
  const feed = await parser.parseURL(feedURL);
  return feed.items;
}

async function getLastDownloadTime(downloadTsFile: string): Promise<DateTime> {
  try {
    const stats = await stat(downloadTsFile);
    return DateTime.fromJSDate(stats.mtime);
  } catch (err) {
    if (err.code === "ENOENT") {
      return DateTime.local();
    } else {
      throw err;
    }
  }
}

function itemsNewerThan(items: Item[], ts: DateTime): Item[] {
  return items.filter((item) => {
    const dt = item.isoDate;
    if (dt != null) {
      return DateTime.fromISO(dt) > ts;
    } else {
      return false;
    }
  });
}

type PutioEntry = {
  Path: string;
  Name: string;
  IsDir: boolean;
  ModTime: string;
  MimeType: string;
};

async function getPutioEntryForPath(
  opts: Record<string, any>,
  remotePath: string
): Promise<PutioEntry> {
  const dir = path.dirname(remotePath);
  const name = path.basename(remotePath);
  const entries = await lsPutio(opts, dir);
  const entry = entries.find((entry) => {
    return name === entry.Name;
  });
  assert(entry, `${name} is not present in ${dir}.`);
  entry.Path = path.join(dir, name); // this removes the trailing slash if present
  return entry;
}

function findPutioEntry(
  putioEntries: PutioEntry[],
  item: Item
): PutioEntry | undefined {
  const words = item["tv:raw_title"].split(/\s/);
  const needle = new RegExp(
    words.map((word) => escapeStringRegexp(word)).join(".+")
  );
  return putioEntries.find((entry) => {
    return !!needle.exec(entry.Name);
  });
}

async function findVideoFile(
  opts: Record<string, any>,
  topLevel: PutioEntry
): Promise<PutioEntry> {
  if (!topLevel.IsDir) {
    assert(
      topLevel.MimeType.startsWith("video/"),
      `Not a video file: ${topLevel.Path}`
    );
    return topLevel;
  }
  const contents = await lsPutio(opts, topLevel.Path);
  for (const entry of contents) {
    if (entry.MimeType.startsWith("video/")) {
      entry.Path = path.join(topLevel.Path, entry.Path);
      return entry;
    }
  }
  throw new Error(`Could not find video file for ${topLevel.Name}`);
}

async function downloadItem(entry: PutioEntry, outputFolder: string) {
  logWithTimestamp(`rsync copy putio:'${entry.Path}' '${outputFolder}'`);
  spawnSync("rclone", ["copy", `putio:${entry.Path}`, outputFolder]);
  logWithTimestamp(`Downloaded ${outputFolder}`);
}

async function findAndDownloadSubtitles(
  opts: Record<string, any>,
  remoteDir: PutioEntry,
  localDest: string
) {
  if (!remoteDir.IsDir) {
    logWithTimestamp(
      `Cannot check for subtitles with just a file ${remoteDir}`
    );
    return;
  }
  const contents = await lsPutio(opts, remoteDir.Path, /* recursive */ true);
  const subtitleFiles = [];
  for (const entry of contents) {
    if (path.extname(entry.Name) === ".srt") {
      entry.Path = path.join(remoteDir.Path, entry.Path);
      subtitleFiles.push(entry);
    }
  }
  if (subtitleFiles.length < 1) {
    logWithTimestamp(`No subtitles ${remoteDir}`);
    return;
  }
  let enSubtitleFile;
  if (subtitleFiles.length === 1) {
    enSubtitleFile = subtitleFiles[0];
  } else {
    enSubtitleFile = subtitleFiles.find((entry) => {
      return /(^|\W)(english|en)\W/.exec(entry.Name);
    });
    if (!enSubtitleFile) {
      logWithTimestamp(`No subtitles ${remoteDir}`);
      return;
    }
  }
  logWithTimestamp(`English subtitles file found: ${enSubtitleFile.Path}`);
  if (opts.commit) {
    downloadItem(enSubtitleFile, localDest);
  }
}

async function lsPutio(
  opts: Record<string, any>,
  remotePath: string,
  recursive: boolean = false
): Promise<PutioEntry[]> {
  if (remotePath === ".") {
    // special-case the root directory that rclone doesn't understand
    remotePath = "";
  }
  const args = ["lsjson", `putio:${remotePath}`];
  if (recursive) {
    args.push("--recursive");
  }
  logWithTimestamp(`rclone ${args.join(" ")}`);
  const { stdout, stderr } = spawnSync("rclone", args);
  if (opts.debug) {
    console.error(stdout.toString());
    console.error(stderr.toString());
  }
  const out: PutioEntry[] = JSON.parse(stdout);
  return out;
}

async function bumpLastDownloadTime(downloadTsFile: string) {
  await writeFile(downloadTsFile, DateTime.local().toString());
}
