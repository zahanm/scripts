import { stat } from "fs/promises";
import { URL } from "url";
import { spawnSync } from "child_process";

import * as Parser from "rss-parser";
import escapeStringRegexp = require("escape-string-regexp");

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
  downloadTsFile: string
) {
  checkArgs(feedUrl);
  const allItems = await fetchShowRssFeed(feedUrl);
  console.error(`Got ${allItems.length} items in the feed.`);
  const lastDownload = await getLastDownloadTime(downloadTsFile);
  const newItems = itemsNewerThan(allItems, lastDownload);
  console.error(`${newItems.length} new items to download.`);
  const putioEntries = await lsPutio();
  for (const item of newItems.slice(0, 1)) {
    const entry = findPutioEntry(putioEntries, item);
    if (entry) {
      console.error(`Found ${entry.Path} ${entry.IsDir}.`);
    } else {
      console.error(`Could not find ${item.title}.`);
    }
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

async function getLastDownloadTime(downloadTsFile: string): Promise<Date> {
  try {
    const stats = await stat(downloadTsFile);
    return stats.mtime;
  } catch (err) {
    if (err.code === "ENOENT") {
      return new Date(0);
    } else {
      throw err;
    }
  }
}

function itemsNewerThan(items: Item[], ts: Date): Item[] {
  return items.filter((item) => {
    const dt = items[0].isoDate;
    if (dt != null) {
      return new Date(dt) > ts;
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

async function downloadItem() {}
