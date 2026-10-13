"""
Convertit les vidéos dans un format léger, lisible par tous les navigateurs :
H.264 "Main" 240p (débit plafonné), son AAC mono 64 kbit/s, index en début de fichier (faststart).
Un extrait de 25 s pèse alors ~1 Mo : il charge vite même avec une petite connexion.

Encodage sur le GPU NVIDIA (NVENC) s'il est disponible, sinon sur le CPU (libx264).
Les horodatages ne changent pas : les transcriptions existantes restent valables.

Optionnel : quand ffmpeg est installé sur le serveur, il découpe et réencode lui-même chaque extrait
(voir server/clipcut.js). Convertir la bibliothèque sert alors surtout à gagner de la place.

Usage (demande confirmation avant de remplacer les fichiers, sauf --yes) :
    python compress.py                  # convertit les vidéos de media/videos pas encore au bon format
    python compress.py --force          # reconvertit tout
    python compress.py --yes            # sans demander confirmation
    python compress.py chemin/video.mp4 # une vidéo précise
"""

import os
import subprocess
import sys
import time
from pathlib import Path

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
VIDEOS_DIR = ROOT / "media" / "videos"
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".webm", ".mov"}

TARGET_HEIGHT = 240
VIDEO_KBPS = 250  # débit visé
VIDEO_MAX_KBPS = 350  # plafond : le débit ne dépasse jamais ça, même sur les scènes agitées
AUDIO_KBPS = 64

# Encodage en cours, pour pouvoir l'annuler proprement depuis le fil principal (Ctrl+C).
_current = {"process": None, "tmp": None}


def _encoders():
    rate = ["-b:v", f"{VIDEO_KBPS}k", "-maxrate", f"{VIDEO_MAX_KBPS}k", "-bufsize", f"{VIDEO_MAX_KBPS * 2}k"]
    nvenc = ["-c:v", "h264_nvenc", "-preset", "p5", "-profile:v", "main", "-rc", "vbr", "-cq", "30", *rate]
    x264 = ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-crf", "28", *rate]
    return [
        ("GPU", ["-hwaccel", "cuda"], nvenc),  # décodage + encodage sur le GPU
        ("GPU", [], nvenc),  # décodage CPU si le GPU ne sait pas décoder la source
        ("CPU", [], x264),  # pas de GPU NVIDIA
    ]


def _command(path, tmp, input_args, video_args):
    import imageio_ffmpeg

    return [
        imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
        *input_args, "-i", str(path),
        "-map", "0:v:0", "-map", "0:a:0",
        "-vf", f"scale=-2:'min({TARGET_HEIGHT},ih)'", "-fpsmax", "30",
        *video_args, "-g", "50", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ac", "1",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats", str(tmp),
    ]


def probe(path):
    """Codec, hauteur, durée et débit d'une vidéo (via PyAV, déjà installé pour la transcription)."""
    import av

    with av.open(str(path)) as container:
        video = container.streams.video[0] if container.streams.video else None
        audio = container.streams.audio[0] if container.streams.audio else None
        duration = (container.duration or 0) / 1_000_000
    return {
        "vcodec": video.codec_context.name if video else None,
        "height": video.codec_context.height if video else 0,
        "acodec": audio.codec_context.name if audio else None,
        "duration": duration,
        "kbps": path.stat().st_size * 8 / 1000 / duration if duration else 0,
    }


def is_light(info):
    return (
        info["vcodec"] == "h264"
        and info["acodec"] == "aac"
        and info["height"] <= TARGET_HEIGHT
        and info["kbps"] <= (VIDEO_MAX_KBPS + AUDIO_KBPS) * 1.25
    )


def compress(path, duration=0, quiet=False):
    """Convertit `path` au format léger, en place. Garde l'original si la conversion échoue.
    quiet=True (tâche de fond) : une ligne par palier de 10 % au lieu d'un pourcentage qui se réécrit."""
    path = Path(path)
    tmp = path.with_name(path.stem + ".compressing.mp4")
    label = f"  [{path.stem[:40]}] " if quiet else "  "
    try:
        info = probe(path)
    except Exception as error:
        print(f"{label}Vidéo illisible, ignorée : {error}")
        return False
    duration = duration or info["duration"]
    stat = path.stat()
    started = time.time()

    used, errors = None, ""
    for name, input_args, video_args in _encoders():
        process = subprocess.Popen(_command(path, tmp, input_args, video_args),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        _current.update(process=process, tmp=tmp)
        _watch_progress(process, duration, started, quiet, path.stem)
        process.wait()
        errors = process.stderr.read()
        _current.update(process=None, tmp=None)
        if process.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            used = name
            break
        tmp.unlink(missing_ok=True)

    if not quiet:
        print("\r" + " " * 60 + "\r", end="")
    if not used:
        print(f"{label}Conversion échouée : vidéo gardée telle quelle.")
        if errors.strip():
            print("  " + errors.strip().splitlines()[-1][:200])
        return False

    after = tmp.stat().st_size
    if is_light(info) and after >= stat.st_size:
        tmp.unlink()
        print(f"{label}Déjà au bon format : vidéo gardée telle quelle.")
        return True
    tmp.replace(path)
    # Même date qu'avant : la transcription existante n'est pas considérée comme périmée.
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    print(f"{label}Convertie ({used}) : {stat.st_size / 1e6:.0f} Mo -> {after / 1e6:.1f} Mo "
          f"en {time.time() - started:.0f} s")
    return True


def cancel():
    """Arrête l'encodage en cours et supprime le fichier temporaire (appelé sur Ctrl+C)."""
    process, tmp = _current["process"], _current["tmp"]
    if process and process.poll() is None:
        process.kill()
        process.wait()
    if tmp:
        Path(tmp).unlink(missing_ok=True)


def _watch_progress(process, duration, started, quiet, name):
    last_step = -1
    for line in process.stdout:
        if not duration or not line.startswith("out_time_us="):
            continue
        try:
            done = int(line.split("=")[1]) / 1e6
        except ValueError:
            continue
        ratio = max(0.0, min(1.0, done / duration))
        elapsed = time.time() - started
        eta = f", reste ~{int(elapsed / ratio - elapsed)} s" if ratio > 0.02 else ""
        if quiet:
            step = int(ratio * 10)
            if last_step < step < 10:
                last_step = step
                print(f"  [{name[:40]}] Compression : {step * 10:3d} %{eta}", flush=True)
        else:
            print(f"\r  Compression : {ratio * 100:5.1f} %{eta}   ", end="", flush=True)


def main():
    args = sys.argv[1:]
    force = "--force" in args
    files = [Path(a).resolve() for a in args if not a.startswith("--")]
    if not files:
        files = sorted(p for p in VIDEOS_DIR.iterdir()
                       if p.suffix.lower() in VIDEO_EXTENSIONS and ".compressing" not in p.name)

    todo = []
    for path in files:
        try:
            if force or not is_light(probe(path)):
                todo.append(path)
        except Exception as error:
            print(f"Illisible, ignorée : {path.name} ({error})")
    if not todo:
        print(f"Rien à convertir : {len(files)} vidéo(s) déjà au bon format ({TARGET_HEIGHT}p, H.264).")
        return

    print(f"{len(todo)} vidéo(s) à convertir en {TARGET_HEIGHT}p H.264 :")
    for path in todo:
        print(f"  - {path.name}")
    if "--yes" not in args:
        print("Les fichiers d'origine seront REMPLACÉS (impossible de revenir en arrière).")
        try:
            answer = input("Continuer ? [o/N] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            answer = ""
        if answer not in ("o", "oui", "y", "yes"):
            print("Annulé : aucune vidéo modifiée.")
            return
    failures = 0
    try:
        for index, path in enumerate(todo, 1):
            print(f"[{index}/{len(todo)}] {path.name}")
            if not compress(path):
                failures += 1
    except KeyboardInterrupt:
        cancel()
        print("\nConversion annulée : la vidéo en cours est gardée telle quelle.")
        sys.exit(1)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
