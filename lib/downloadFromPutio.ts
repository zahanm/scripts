import { open, readFile, stat } from "fs/promises";
import { URL } from "url";

import * as Parser from "rss-parser";

/**
 * This is going to use Rclone as the interface to Put.io. That means it needs to be set up locally as a prerequisite.
 * 1. Fetch showRSS.info feed
 * 2. Check if there are items newer than the last download
 * 3. Look for that item in Put.io, see if it's there yet
 * 3. Download that item using Rclone, and put it in the right folder
 */
export async function downloadFromPutio(
  opts: Record<string, any>,
  feedUrl: string,
  downloadTsFile: string
) {
  checkArgs(feedUrl);
  const allItems = await fetchShowRssFeed(feedUrl);
  const lastDownload = await getLastDownloadTime(downloadTsFile);
  const newItems = itemsNewerThan(allItems, lastDownload);
  newItems.forEach((item) => {
    console.log(`${item.title} -> ${item.link}`);
  });
}

function checkArgs(url: string) {
  new URL(url);
}

type TvFeed = {};
type TvItem = { "tv:show_name": string; "tv:raw_title": string };
type Item = Parser.Item & TvItem;

async function fetchShowRssFeed(feedURL: string): Promise<Item[]> {
  const parser = new Parser<TvFeed, TvItem>();
  const feed = await parser.parseURL(feedURL);
  console.log(`Got ${feed.items.length} items in the feed`);
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
