import { program } from "commander";

import { helloWorld } from "./lib/helloWorld";
import { copyAndroidRes } from "./lib/copyAndroidRes";
import { updateFavaServer } from "./lib/updateFavaServer";
import { downloadFromPutio } from "./lib/downloadFromPutio";

async function main() {
  program
    .name("scripts")
    .option("-x, --commit", "Take action that could commit changes.", false);

  program
    .command("hello-world")
    .description("Self-explanatory.")
    .action(async function () {
      await helloWorld();
    });

  program
    .command("copy-android-res <dest>")
    .description(
      "Take files on stdin, and copy them to destination folder based on source resolution."
    )
    .action(async function (dest: string) {
      await copyAndroidRes(program.opts(), dest);
    });

  program
    .command("update-fava-server <repo>")
    .description(
      "Checks for updates to the beancount repo, and relaunches the fava server."
    )
    .action(async function (repo: string) {
      await updateFavaServer(program.opts(), repo);
    });

  program
    .command(
      "download-from-putio <rss-feed-url> <download-timestamp-file> <tv-shows-dir>"
    )
    .description(".")
    .action(async function (
      feedUrl: string,
      downloadTsFile: string,
      tvShowsFolder: string
    ) {
      await downloadFromPutio(
        program.opts(),
        feedUrl,
        downloadTsFile,
        tvShowsFolder
      );
    });

  await program.parseAsync();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
