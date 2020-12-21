import { stat, writeFile } from "fs/promises";
import { URL } from "url";
import { spawnSync } from "child_process";
import * as path from "path";
import { ok as assert } from "assert";

import * as Parser from "rss-parser";
import escapeStringRegexp = require("escape-string-regexp");
import { DateTime } from "luxon";

/**
 * This is going to use Rclone as the interface to Put.io. That means it needs to be set up locally as a prerequisite.
 * 1. Fetch showRSS.info feed
 * 2. Check if there are items newer than the last download
 * 3. Look for each item in Put.io, see if it's there yet
 * 4. Download that item using Rclone, and put it in the right folder
 */
export async function downloadFromPutio(
  opts: Record<string, any>,
  feedUrl: string,
  downloadTsFile: string,
  tvShowsFolder: string
) {
  checkArgs(feedUrl);
  const allItems = await fetchShowRssFeed(feedUrl);
  console.error(`Got ${allItems.length} items in the feed.`);
  const lastDownload = await getLastDownloadTime(downloadTsFile);
  console.error(`Finding items newer than ${lastDownload}.`);
  const newItems = itemsNewerThan(allItems, lastDownload);
  console.error(`${newItems.length} new items to download.`);
  const putioEntries = await lsPutio();
  for (const item of newItems) {
    const entry = findPutioEntry(putioEntries, item);
    if (entry) {
      console.error(`Found ${entry.Path} ${entry.IsDir}.`);
      const videoFile = await findVideoFile(entry);
      if (opts.commit) {
        await downloadItem(videoFile, item, tvShowsFolder);
      } else {
        console.error(`Would have downloaded ${videoFile.Path}`);
      }
    } else {
      console.error(`Could not find ${item.title}.`);
    }
  }
  if (newItems.length > 0 && opts.commit) {
    console.error(`Bumping the mtime on ${downloadTsFile}`);
    await bumpLastDownloadTime(downloadTsFile);
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

async function lsPutio(): Promise<PutioEntry[]> {
  const { stdout } = spawnSync("rclone", ["lsjson", "putio:"]);
  const out: PutioEntry[] = JSON.parse(stdout);
  return out;
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

async function findVideoFile(topLevel: PutioEntry): Promise<PutioEntry> {
  if (!topLevel.IsDir) {
    assert(
      topLevel.MimeType.startsWith("video/"),
      `Not a video file: ${topLevel.Path}`
    );
    return topLevel;
  }
  const { stdout } = spawnSync("rclone", ["lsjson", `putio:${topLevel.Path}`]);
  const contents: PutioEntry[] = JSON.parse(stdout);
  for (const entry of contents) {
    if (entry.MimeType.startsWith("video/")) {
      entry.Path = path.join(topLevel.Path, entry.Path);
      return entry;
    }
  }
  throw new Error(`Could not find video file for ${topLevel.Name}`);
}

async function downloadItem(
  entry: PutioEntry,
  item: Item,
  tvShowsFolder: string
) {
  const out = path.join(tvShowsFolder, item["tv:show_name"]);
  console.error(`rsync copy putio:'${entry.Path}' '${out}'`);
  spawnSync("rclone", ["copy", `putio:${entry.Path}`, out]);
  console.error(`Downloaded ${out}`);
}

async function bumpLastDownloadTime(downloadTsFile: string) {
  await writeFile(downloadTsFile, DateTime.local().toString());
}
