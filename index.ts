import { program } from "commander";
import { helloWorld } from "./lib/helloWorld";

async function main() {
  program
    .name("scripts")
    .option("-d, --debug", "output extra debugging to stderr", false);

  program
    .command("hello-world")
    .description("Self-explanatory.")
    .action(async function () {
      await helloWorld();
    });

  await program.parseAsync();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
