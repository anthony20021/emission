"""
Télécharge des vidéos YouTube en mp4 dans media/videos, en boucle.

Colle une URL, la vidéo est téléchargée (480p max, pour économiser de la place)
puis compressée sur le GPU (NVENC), et le titre de la vidéo devient le titre affiché aux joueurs. Ligne vide ou "q" pour quitter.
À la fin, propose de lancer la transcription des nouvelles vidéos.

Usage :
    python download.py                 # mode boucle
    python download.py URL [URL ...]   # télécharge ces URL puis s'arrête
    python download.py --no-compress   # sans la compression GPU
"""

import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
VIDEOS_DIR = ROOT / "media" / "videos"
MAX_HEIGHT = 480


class SilentLogger:
    """yt-dlp écrit ses propres messages : on affiche les nôtres à la place."""

    def debug(self, message): pass
    def info(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def build_options():
    import imageio_ffmpeg

    return {
        # Meilleure vidéo mp4 <= MAX_HEIGHT + meilleur audio m4a, fusionnés en mp4 ; sinon le meilleur fichier disponible.
        "format": f"bv*[height<={MAX_HEIGHT}][ext=mp4]+ba[ext=m4a]/b[height<={MAX_HEIGHT}][ext=mp4]/b[height<={MAX_HEIGHT}]/b",
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


def compress(path):
    """Ré-encode la vidéo sur le GPU (NVENC) pour gagner de la place. Garde l'original si ça échoue ou ne réduit pas."""
    import imageio_ffmpeg

    tmp = path.with_name(path.stem + ".compressing.mp4")
    started = time.time()
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
        "-vf", f"scale=-2:'min({MAX_HEIGHT},ih)'",
        "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "32", "-b:v", "0", "-g", "50",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "64k", "-ac", "1",  # mono 64 kbit/s : largement assez pour la parole
        "-movflags", "+faststart", str(tmp),
    ]
    before = path.stat().st_size
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        print("  Compression GPU indisponible : vidéo gardée telle quelle.")
        return
    after = tmp.stat().st_size
    if after >= before:
        tmp.unlink()
        print("  Déjà légère : vidéo gardée telle quelle.")
        return
    tmp.replace(path)
    print(f"  Compressée : {before / 1e6:.0f} Mo -> {after / 1e6:.0f} Mo en {time.time() - started:.0f} s")


def download(url, options, do_compress=True):
    from yt_dlp import YoutubeDL

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        if "entries" in info:  # URL de playlist malgré noplaylist : on prend la première vidéo
            info = next(iter(info["entries"]))
        path = Path(ydl.prepare_filename(info)).with_suffix(".mp4")
    if do_compress:
        compress(path)
    duration = int(info.get("duration") or 0)
    print(f"  OK : {path.name} ({duration // 60} min {duration % 60:02d} s, {path.stat().st_size / 1e6:.0f} Mo)")
    if 0 < duration < 25:
        print("  Attention : moins de 25 s, la vidéo sera ignorée par le jeu.")
    return path


def main():
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    options = build_options()
    args = sys.argv[1:]
    do_compress = "--no-compress" not in args
    urls = [a for a in args if not a.startswith("--")]
    interactive = not urls
    downloaded = 0

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
            download(url, options, do_compress)
            downloaded += 1
        except Exception as error:
            message = str(error).replace("ERROR: ", "").strip()
            print(f"\n  Échec : {message}")

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
