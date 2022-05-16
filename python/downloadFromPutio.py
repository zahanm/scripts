# list out folders on put.io root (take which folder to inspect as an argument)
# for each folder, offer to download
# ask for movie name
# rclone copy it into place

# TODO
# subtitles
# TV shows

import json
import subprocess
import os.path as ospath
import readline  # needed for input() to give more keyboard control
import argparse
from pathlib import PurePath

blocklist = {"chill.institute"}
putio_rclone_mount = "putio"
media_root = "/volume1/media"
ls_max_depth = 5


def run():
    argv = parse_args()
    check_rclone_installed()
    runner = Downloader(argv)
    runner.run()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="do not take any actions, just show what would happen",
    )
    return parser.parse_args()


def check_rclone_installed():
    subprocess.run(["which", "rclone"], check=True, stdout=subprocess.DEVNULL)


class Downloader:
    def __init__(self, argv) -> None:
        self.argv = argv

    def run(self):
        items = self.list_items("")
        print(f"Found {len(items)} items")
        root_items = [item for item in items if len(PurePath(item["Path"]).parts) <= 1]
        print(f"Found {len(root_items)} root items")
        for item in root_items:
            if item["Path"] not in blocklist:
                self.process_item(item)

    def list_items(self, path):
        proc = subprocess.run(
            [
                "rclone",
                "lsjson",
                "--max-depth",
                str(ls_max_depth),
                f"{putio_rclone_mount}:{path}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(proc.stdout)

    def process_item(self, item):
        print()
        print(item["Name"])
        if not item["IsDir"] and is_video_mimetype(item["MimeType"]):
            self.offer_actions(item["Name"], item["Path"], item["Size"])
        else:
            subitems = self.list_items(item["Path"])
            videos = [it for it in subitems if is_video_mimetype(it["MimeType"])]
            if len(videos) > 1:
                print("Mutiple videos!")
            elif len(videos) == 0:
                print("No video!")
            else:
                video = videos[0]
                self.offer_actions(
                    item["Name"],
                    ospath.join(item["Path"], video["Path"]),
                    video["Size"],
                )

    def offer_actions(self, name, path, size):
        answer = input(
            f"{human_readable_size(size)} | Action? Download (d), Delete (x), Skip (s): "
        )
        if answer.lower() == "d":
            movie_name = input(f"Movie name?: ")
            assert len(movie_name) > 0
            dest = ospath.join(media_root, "Movies", movie_name)
            call_args = [
                "rclone",
                "copy",
                "--progress",
                f"{putio_rclone_mount}:{path}",
                f"{dest}",
            ]
            if self.argv.dry_run:
                print("(dry-run)", " ".join(call_args))
            else:
                subprocess.run(call_args, check=True)
        elif answer.lower() == "x":
            print("Delete isn't implemented yet")


def is_video_mimetype(mtype: str):
    return mtype.startswith("video/")


def human_readable_size(size, decimal_places=2):
    """
    Ref https://stackoverflow.com/questions/1094841/get-human-readable-version-of-file-size
    """
    for unit in ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]:
        if size < 1024.0 or unit == "PiB":
            break
        size /= 1024.0
    return f"{size:.{decimal_places}f} {unit}"


if __name__ == "__main__":
    run()
