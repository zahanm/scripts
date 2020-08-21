import { program } from "commander";
import { helloWorld } from "./lib/helloWorld";
import { copyAndroidRes } from "./lib/copyAndroidRes";

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

  await program.parseAsync();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
