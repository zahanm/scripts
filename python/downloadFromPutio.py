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
from collections import namedtuple

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


DownloadAction = namedtuple("DownloadAction", ["source", "dest"])
DeleteAction = namedtuple("DeleteAction", ["path"])


class Downloader:
    def __init__(self, argv) -> None:
        self.argv = argv
        self.actions = []

    def run(self):
        self.all_items = self.rclone_list_hierarchy()
        print(f"Found {len(self.all_items)} items")
        root_items = [
            ii for ii in self.all_items if len(PurePath(ii["Path"]).parts) <= 1
        ]
        print(f"Found {len(root_items)} root items")
        for item in root_items:
            if item["Path"] not in blocklist:
                self.process_item(item)
        self.exec_actions()

    def rclone_list_hierarchy(self):
        proc = subprocess.run(
            rclone_ls_args(),
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(proc.stdout)

    def list_items_in(self, prefix):
        return [
            ii for ii in self.all_items if PurePath(ii["Path"]).is_relative_to(prefix)
        ]

    def process_item(self, item):
        print()
        print(item["Name"])
        if not item["IsDir"]:
            if is_video_mimetype(item["MimeType"]):
                # It's just a video file in root directory. Offer actions on it.
                self.offer_actions(item["Name"], item["Path"], item["Size"])
        else:
            # It's a directory, need to peek inside to see what's up.
            subitems = self.list_items_in(item["Path"])
            videos = [it for it in subitems if is_video_mimetype(it["MimeType"])]
            if len(videos) == 0:
                print("No video!")
            elif len(videos) == 1:
                # Just a single video file in here, must be a movie.
                video = videos[0]
                self.offer_actions(
                    item["Name"],
                    ospath.join(item["Path"], video["Path"]),
                    video["Size"],
                )
            else:
                # Multiple video files in here, must be a TV show.
                print("Mutiple videos!")

    def offer_actions(self, name, path, size):
        answer = input(
            f"{human_readable_size(size)} | Action? Download (d), Delete (x), Skip (s): "
        )
        if answer.lower() == "d":
            movie_name = input(f"Movie name?: ")
            assert len(movie_name) > 0
            dest = ospath.join(media_root, "Movies", movie_name)
            self.enqueue_action(
                DownloadAction(source=f"{putio_rclone_mount}:{path}", dest=f"{dest}")
            )
        elif answer.lower() == "x":
            # TODO this doesn't work, since it's just the video file being deleted, not the directory
            self.enqueue_action(DeleteAction(path=f"{putio_rclone_mount}:{path}"))
            print("Delete isn't implemented yet")

    def enqueue_action(self, action):
        self.actions.append(action)

    def exec_actions(self):
        print()
        print("Taking actions")
        for ii, action in enumerate(self.actions):
            if isinstance(action, DownloadAction):
                print(
                    f"{ii+1}.",
                    " ".join(rclone_download_args(action.source, action.dest)),
                )
            elif isinstance(action, DeleteAction):
                print(f"{ii+1}.", f"Delete {action.path}")
        print()
        answer = input("Continue? (y/n): ")
        if answer.lower() != "y":
            return
        for action in self.actions:
            print()
            if isinstance(action, DownloadAction):
                if self.argv.dry_run:
                    print("(dry run)")
                else:
                    subprocess.run(
                        rclone_download_args(action.source, action.dest), check=True
                    )
            elif isinstance(action, DeleteAction):
                print(f"Delete {action.path} -- not implemented yet")


def rclone_ls_args():
    return [
        "rclone",
        "lsjson",
        "--max-depth",
        str(ls_max_depth),
        f"{putio_rclone_mount}:",
    ]


def rclone_download_args(source, dest):
    return [
        "rclone",
        "copy",
        "--progress",
        source,
        dest,
    ]


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
