# pyright: strict

# list out folders on put.io root (take which folder to inspect as an argument)
# for each folder, offer to download
# ask for movie name
# rclone copy it into place

# TODO
# type "argv" and "item"
# TV shows
# subtitles

import json
import subprocess
import readline  # pyright: ignore [reportUnusedImport] -- needed for input() to give more keyboard control
import argparse
from pathlib import PurePath
from typing import List, NamedTuple, Optional, Union

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


class DownloadAction(NamedTuple):
    source: str
    dest: str


class DeleteAction(NamedTuple):
    path: str


Action = Union[DownloadAction, DeleteAction]


class Item(NamedTuple):
    Path: str
    Name: str
    Size: int
    MimeType: str
    IsDir: bool
    ModTime: str
    ID: Optional[str] = None


class Downloader:
    actions: List[Action]

    def __init__(self, argv: argparse.Namespace) -> None:
        self.argv = argv
        self.actions = []

    def run(self):
        self.all_items = self.rclone_list_hierarchy()
        print(f"Found {len(self.all_items)} items")
        root_items = [ii for ii in self.all_items if len(PurePath(ii.Path).parts) <= 1]
        print(f"Found {len(root_items)} root items")
        for item in root_items:
            if item.Path not in blocklist:
                self.process_item(item)
        self.exec_actions()

    def rclone_list_hierarchy(self) -> List[Item]:
        proc = subprocess.run(
            rclone_ls_args(),
            check=True,
            capture_output=True,
            text=True,
        )
        return [Item(**ii) for ii in json.loads(proc.stdout)]

    def list_items_in(self, prefix: str):
        # PurePath(ii["Path"]).is_relative_to(prefix) only works on Py >= 3.9
        return [ii for ii in self.all_items if ii.Path.startswith(prefix)]

    def process_item(self, item: Item):
        print()
        print(item.Name)
        if not item.IsDir:
            if is_video_mimetype(item.MimeType):
                # It's just a video file in root directory. Offer actions on it.
                self.offer_actions(item.Path, item.Path, item.Size)
        else:
            # It's a directory, need to peek inside to see what's up.
            subitems = self.list_items_in(item.Path)
            print(f"Sub-items found: {len(subitems)}")
            videos = [it for it in subitems if is_video_mimetype(it.MimeType)]
            if len(videos) == 0:
                print("Skip -- No video!")
            elif len(videos) == 1:
                # Just a single video file in here, must be a movie.
                video = videos[0]
                self.offer_actions(
                    item.Path,
                    video.Path,
                    video.Size,
                )
            else:
                # Multiple video files in here, must be a TV show.
                print("Skip -- Mutiple videos!")

    def offer_actions(self, item_path: str, video_path: str, size: int):
        answer = input(
            f"{human_readable_size(size)} | Action? Download (d), Delete (x), Skip (s): "
        )
        if answer.lower() == "d":
            movie_name = input(f"Media name?: ")
            assert len(movie_name) > 0
            dest = PurePath(media_root) / "Movies" / movie_name
            self.enqueue_action(
                DownloadAction(
                    source=f"{putio_rclone_mount}:{video_path}", dest=f"{dest}"
                )
            )
        elif answer.lower() == "x":
            self.enqueue_action(DeleteAction(path=f"{putio_rclone_mount}:{item_path}"))

    def enqueue_action(self, action: Action):
        self.actions.append(action)

    def exec_actions(self):
        print()
        if len(self.actions) == 0:
            print("Nothing to do!")
            return
        print("Taking actions...")
        for ii, action in enumerate(self.actions):
            if isinstance(action, DownloadAction):
                print(
                    f"{ii+1}.",
                    " ".join(rclone_download_args(action.source, action.dest)),
                )
            else:
                print(f"{ii+1}.", " ".join(rclone_delete_args(action.path)))
        print()
        answer = input("Continue? (y/n): ")
        if answer.lower() != "y":
            return
        dry_run_args = ["--dry-run"] if self.argv.dry_run else []
        for action in self.actions:
            print()
            if isinstance(action, DownloadAction):
                subprocess.run(
                    rclone_download_args(action.source, action.dest) + dry_run_args,
                    check=True,
                )
            else:
                subprocess.run(
                    rclone_delete_args(action.path) + dry_run_args, check=True
                )


def rclone_ls_args():
    return [
        "rclone",
        "lsjson",
        "--max-depth",
        str(ls_max_depth),
        f"{putio_rclone_mount}:",
    ]


def rclone_download_args(source: str, dest: str):
    return [
        "rclone",
        "copy",
        "--progress",
        source,
        dest,
    ]


def rclone_delete_args(path: str):
    return [
        "rclone",
        "purge",
        path,
    ]


def is_video_mimetype(mtype: str):
    return mtype.startswith("video/")


def human_readable_size(size: float, decimal_places: int = 2):
    """
    Ref https://stackoverflow.com/questions/1094841/get-human-readable-version-of-file-size
    """
    for unit in ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]:
        if size < 1024.0 or unit == "PiB":
            break
        size /= 1024.0
    return (
        f"{size:.{decimal_places}f} {unit}"  # pyright: ignore [reportUnboundVariable]
    )


if __name__ == "__main__":
    run()
