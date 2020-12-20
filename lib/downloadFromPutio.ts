import Parser = require("rss-parser");
import { URL } from "url";

/**
 * This is going to use Rclone as the interface to Put.io. That means it needs to be set up locally as a prerequisite.
 * 1. Fetch showRSS.info feed
 * 2. Check if there are items newer than the last download
 * 3. Look for that item in Put.io, see if it's there yet
 * 3. Download that item using Rclone, and put it in the right folder
 */
export async function downloadFromPutio(
  opts: Record<string, any>,
  feedUrl: string
) {
  checkArgs(feedUrl);
  await fetchShowRssFeed(feedUrl);
}

function checkArgs(url: string) {
  new URL(url);
}

async function fetchShowRssFeed(feedURL: string) {
  const parser = new Parser();
  const feed = await parser.parseURL(feedURL);
  feed.items.forEach((item) => {
    console.log(`${item.title} -> ${item.link}`);
  });
}
