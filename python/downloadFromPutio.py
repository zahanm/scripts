# pyright: strict

# list out folders on put.io root (take which folder to inspect as an argument)
# for each folder, offer to download
# ask for movie name
# rclone copy it into place

import json
import subprocess
import readline  # pyright: ignore [reportUnusedImport] -- needed for input() to give more keyboard control
import argparse
from pathlib import PurePath
from typing import List, NamedTuple, Optional, Union
import os.path
import re

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
        if not item.IsDir:
            if is_video(item):
                # It's just a video file in root directory.
                if self.looks_like_tv_episode(item):
                    self.process_tv_item(item, [item])
                else:
                    self.process_movie_item(item, item)
        else:
            # It's a directory, need to peek inside to see what's up.
            subitems = self.list_items_in(item.Path)
            videos = [it for it in subitems if is_video(it)]
            if len(videos) == 0:
                print(f"Skip {item.Name} -- no video!")
            elif len(videos) == 1:
                # Just a single video file in here, check if it's a TV episode
                if self.looks_like_tv_episode(item):
                    self.process_tv_item(item, videos)
                else:
                    video = videos[0]
                    self.process_movie_item(item, video)
            else:
                # Multiple video files in here, must be a TV show.
                self.process_tv_item(item, subitems)

    def offer_actions(self, name: str, size: int) -> str:
        print(name)
        answer = input(
            f"{human_readable_size(size)} | Action? Download (d) and/or Delete (x), Skip (s), Subtitles (z): "
        )
        return answer

    def process_movie_item(self, item: Item, video: Item):
        answer = self.offer_actions(item.Name, video.Size)
        if "d" in answer.lower():
            movie_name = self.ask_movie_name()
            dest = PurePath(media_root) / "Movies" / movie_name
            if os.path.exists(dest):
                print("You already have '{}'! Skipping download...".format(movie_name))
            else:
                self.enqueue_action(
                    DownloadAction(
                        source=f"{putio_rclone_mount}:{video.Path}", dest=f"{dest}"
                    )
                )
            self.maybe_dl_subs(item, dest)
        if "x" in answer.lower():
            self.enqueue_action(DeleteAction(path=f"{putio_rclone_mount}:{item.Path}"))
        elif answer.lower() == "z":
            movie_name = self.ask_movie_name()
            dest = PurePath(media_root) / "Movies" / movie_name
            self.maybe_dl_subs(item, dest)

    def ask_movie_name(self) -> str:
        movie_name = input(f"Movie name?: ")
        assert len(movie_name) > 0
        return movie_name

    def maybe_dl_subs(self, item: Item, dest: PurePath):
        if not item.IsDir:
            print("No subtitles")
            return
        subitems = self.list_items_in(item.Path)
        subs = [it for it in subitems if is_subtitles(it)]
        if len(subs) == 0:
            print("No subtitles")
            return
        print("Subtitles:")
        if len(subs) == 1:
            sub = subs[0]
            answer = input(f"{sub.Name} | Download? (y/n): ")
            if answer.lower() == "y":
                self.enqueue_action(
                    DownloadAction(
                        source=f"{putio_rclone_mount}:{sub.Path}", dest=f"{dest}"
                    )
                )
        else:
            # more than 1 subtitles file
            for ii, sub in enumerate(subs):
                print(f"{ii+1}. {sub.Name}")
            answer = input(f"Pick one (number), or skip (s): ")
            if answer.isdigit() and int(answer) <= len(subs):
                sub = subs[int(answer) - 1]
                self.enqueue_action(
                    DownloadAction(
                        source=f"{putio_rclone_mount}:{sub.Path}", dest=f"{dest}"
                    )
                )

    def looks_like_tv_episode(self, item: Item) -> bool:
        return bool(re.search(r"S\d+E\d+", item.Name, flags=re.IGNORECASE))

    def process_tv_item(self, item: Item, subitems: List[Item]):
        print(item.Name)
        print(f"Sub-items found: {len(subitems)}")
        top_level_items = [it for it in subitems if len(PurePath(it.Path).parts) == 2]
        videos = [it for it in subitems if is_video(it)]
        tv_show_name: Optional[str] = None
        dirs_w_videos = list(filter(self.has_nested_videos, top_level_items))
        if len(dirs_w_videos) == 0:
            # if there are no sub-directories with videos, treat this as one unit to download
            answer = self.offer_actions("Full folder", sum([it.Size for it in videos]))
            if "d" in answer.lower():
                # download all videos
                tv_show_name = self.maybe_ask_show_name(tv_show_name)
                dest = PurePath(media_root) / "TV Shows" / tv_show_name
                for it in videos:
                    self.enqueue_action(
                        DownloadAction(
                            source=f"{putio_rclone_mount}:{it.Path}",
                            dest=f"{dest}",
                        )
                    )
            if "x" in answer:
                # check if the choice was to delete
                self.enqueue_action(
                    DeleteAction(path=f"{putio_rclone_mount}:{item.Path}")
                )
            return
        # otherwise, offer download for each sub-dir w videos
        for tlitem in dirs_w_videos:
            # look for video files within this top-level folder
            nested_videos = [
                it for it in self.list_items_in(tlitem.Path) if is_video(it)
            ]
            assert len(nested_videos) > 0  # since this is a sub-dir w videos
            answer = self.offer_actions(
                tlitem.Name, sum([it.Size for it in nested_videos])
            )
            if "d" in answer.lower():
                # download all videos within this folder
                tv_show_name = self.maybe_ask_show_name(tv_show_name)
                dest = PurePath(media_root) / "TV Shows" / tv_show_name
                for it in nested_videos:
                    self.enqueue_action(
                        DownloadAction(
                            source=f"{putio_rclone_mount}:{it.Path}",
                            dest=f"{dest}",
                        )
                    )
            if "x" in answer:
                # check if the choice was to delete
                self.enqueue_action(
                    DeleteAction(path=f"{putio_rclone_mount}:{tlitem.Path}")
                )

    def has_nested_videos(self, item: Item) -> bool:
        """
        Used to filter to a list of items that contain nested videos in them
        """
        return (
            item.IsDir
            and len([it for it in self.list_items_in(item.Path) if is_video(it)]) > 0
        )

    def maybe_ask_show_name(self, name: Optional[str]) -> str:
        if name == None:
            name = input(f"TV show name?: ")
            assert len(name) > 0
        return name

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
        for ii, action in enumerate(self.actions):
            print()
            if isinstance(action, DownloadAction):
                print(
                    f"{ii+1}/{len(self.actions)}.",
                    " ".join(rclone_download_args(action.source, action.dest)),
                )
                subprocess.run(
                    rclone_download_args(action.source, action.dest) + dry_run_args,
                    check=True,
                )
            else:
                print(
                    f"{ii+1}/{len(self.actions)}.",
                    " ".join(rclone_delete_args(action.path)),
                )
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


def is_video(it: Item):
    return it.MimeType.startswith("video/")


def is_subtitles(it: Item) -> bool:
    return it.Name.endswith(".srt") and it.MimeType.startswith("text/")


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
