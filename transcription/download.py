"""
Télécharge des vidéos YouTube en mp4 dans media/videos, en boucle.

Colle une URL : la vidéo est téléchargée en H.264 (480p max), puis convertie en tâche de fond
au format léger du jeu (240p, voir compress.py). Le titre de la vidéo devient le titre affiché aux joueurs.
Ligne vide ou "q" pour quitter. À la fin, propose de lancer la transcription des nouvelles vidéos.

Usage :
    python download.py                 # mode boucle
    python download.py URL [URL ...]   # télécharge ces URL puis s'arrête
    python download.py --no-compress   # sans la conversion (garde le 480p)
"""

import queue
import subprocess
import sys
import threading
from pathlib import Path

from compress import cancel as cancel_compression, compress

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
VIDEOS_DIR = ROOT / "media" / "videos"
DOWNLOAD_HEIGHT = 480  # qualité de la source ; la conversion redescend ensuite en 240p


class SilentLogger:
    """yt-dlp écrit ses propres messages : on affiche les nôtres à la place."""

    def debug(self, message): pass
    def info(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def build_options():
    import imageio_ffmpeg

    return {
        # H.264 (avc1) en priorité : lisible par tous les navigateurs, contrairement à l'AV1 que YouTube propose
        # aussi en mp4 (et que yt-dlp préfère par défaut). Puis repli sur n'importe quel mp4, puis n'importe quoi.
        "format": (
            f"bv*[height<={DOWNLOAD_HEIGHT}][vcodec^=avc1]+ba[ext=m4a]"
            f"/bv*[height<={DOWNLOAD_HEIGHT}][ext=mp4]+ba[ext=m4a]"
            f"/b[height<={DOWNLOAD_HEIGHT}][ext=mp4]/b[height<={DOWNLOAD_HEIGHT}]/b"
        ),
        "merge_output_format": "mp4",
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        # Le nom du fichier = le titre affiché dans le jeu. restrictfilenames=False garde les accents.
        "outtmpl": str(VIDEOS_DIR / "%(title).150B.%(ext)s"),
        "windowsfilenames": True,
        "noplaylist": True,
        "noprogress": True,
        "quiet": True,
        "no_warnings": True,
        "logger": SilentLogger(),
        "progress_hooks": [progress],
        "overwrites": False,
    }


def progress(info):
    if info["status"] == "downloading":
        total = info.get("total_bytes") or info.get("total_bytes_estimate")
        if total:
            print(f"\r  Téléchargement : {info['downloaded_bytes'] / total * 100:5.1f} %", end="", flush=True)
    elif info["status"] == "finished":
        print("\r  Téléchargement : 100.0 %", flush=True)


def download(url, options, compress_queue=None):
    """Télécharge la vidéo ; la compression part en tâche de fond (compress_queue) pour enchaîner."""
    from yt_dlp import YoutubeDL

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        if "entries" in info:  # URL de playlist malgré noplaylist : on prend la première vidéo
            info = next(iter(info["entries"]))
        path = Path(ydl.prepare_filename(info)).with_suffix(".mp4")
    duration = int(info.get("duration") or 0)
    print(f"  OK : {path.name} ({duration // 60} min {duration % 60:02d} s, {path.stat().st_size / 1e6:.0f} Mo)")
    if 0 < duration < 25:
        print("  Attention : moins de 25 s, la vidéo sera ignorée par le jeu.")
    if compress_queue is not None:
        compress_queue.put((path, duration))
        print("  Conversion lancée en tâche de fond.")
    return path


def start_compressor(interactive):
    """Un seul encodage à la fois, en tâche de fond."""
    jobs = queue.Queue()

    def worker():
        while True:
            job = jobs.get()
            try:
                if job is None:
                    return
                compress(*job, quiet=interactive)
            finally:
                jobs.task_done()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    return jobs, thread


def main():
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    options = build_options()
    args = sys.argv[1:]
    do_compress = "--no-compress" not in args
    urls = [a for a in args if not a.startswith("--")]
    interactive = not urls
    downloaded = 0
    jobs = thread = None
    if do_compress:
        jobs, thread = start_compressor(interactive)

    print(f"Les vidéos arrivent dans : {VIDEOS_DIR}")
    while True:
        if interactive:
            try:
                url = input("\nURL YouTube (vide pour quitter) : ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if url.lower() in ("", "q", "quit", "exit"):
                break
        elif urls:
            url = urls.pop(0)
        else:
            break
        try:
            download(url, options, jobs)
            downloaded += 1
        except Exception as error:
            message = str(error).replace("ERROR: ", "").strip()
            print(f"\n  Échec : {message}")

    if jobs is not None:
        if jobs.unfinished_tasks:
            print(f"\nConversion en cours ({jobs.unfinished_tasks} vidéo(s))… Ctrl+C pour annuler.")
        try:
            jobs.join()
        except KeyboardInterrupt:
            cancel_compression()
            print("\nConversion interrompue : la vidéo en cours est gardée telle quelle.")
            return

    if downloaded and interactive:
        try:
            answer = input(f"\n{downloaded} vidéo(s) téléchargée(s). Lancer la transcription maintenant ? [O/n] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return
        if answer in ("", "o", "oui", "y", "yes"):
            subprocess.run([sys.executable, str(Path(__file__).with_name("transcribe.py"))])
    elif downloaded:
        print("Lance \"npm run transcribe\" pour préparer les nouvelles vidéos.")


if __name__ == "__main__":
    main()
