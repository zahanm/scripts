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

blocklist = {"chill.institute"}
putio_rclone_mount = "putio"
media_root = "/volume1/media"


def run():
    check_rclone_installed()
    items = list_items("")
    print(f"Found {len(items)} items")
    for item in items:
        if item["Name"] not in blocklist:
            process_item(item)


def check_rclone_installed():
    subprocess.run(["which", "rclone"], check=True, stdout=subprocess.DEVNULL)


def list_items(path):
    proc = subprocess.run(
        ["rclone", "lsjson", f"{putio_rclone_mount}:{path}"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout)


def process_item(item):
    print()
    print(item["Name"])
    if not item["IsDir"] and is_video_mimetype(item["MimeType"]):
        offer_download(item["Name"], item["Path"], item["Size"])
    else:
        subitems = list_items(item["Path"])
        videos = [it for it in subitems if is_video_mimetype(it["MimeType"])]
        if len(videos) > 1:
            print("Mutiple videos!")
        elif len(videos) == 0:
            print("No video!")
        else:
            video = videos[0]
            offer_download(
                item["Name"], ospath.join(item["Path"], video["Path"]), video["Size"]
            )


def offer_download(name, path, size):
    answer = input(f"{human_readable_size(size)} | Download (y/n)?: ")
    if answer.lower() == "y":
        movie_name = input(f"Movie name?: ")
        assert len(movie_name) > 0
        dest = ospath.join(media_root, "Movies", movie_name)
        subprocess.run(
            [
                "rclone",
                "copy",
                "--progress",
                f"{putio_rclone_mount}:{path}",
                f"{dest}",
            ],
            check=True,
        )


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
