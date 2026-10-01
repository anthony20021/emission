"""
Transcrit les vidéos de media/videos en JSON horodaté mot par mot (media/transcripts).

Utilise faster-whisper (Whisper optimisé) avec word_timestamps : chaque mot prononcé
est stocké avec son instant de début et de fin. Le serveur de jeu s'en sert ensuite
pour savoir quels mots sont dits dans n'importe quel extrait de 20-30 s.

Usage :
    python transcribe.py                  # toutes les vidéos pas encore transcrites
    python transcribe.py --force          # retranscrit tout
    python transcribe.py chemin/video.mp4 # une vidéo précise
    python transcribe.py --model small    # modèle plus léger (plus rapide, moins précis)
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
VIDEOS_DIR = ROOT / "media" / "videos"
TRANSCRIPTS_DIR = ROOT / "media" / "transcripts"
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".webm", ".mov"}
FORMAT_VERSION = 1
SAMPLE_RATE = 16000

# Phrases que Whisper "hallucine" souvent sur de la musique ou du silence.
HALLUCINATIONS = re.compile(
    r"sous-titr|amara\.org|merci d'avoir regard|abonnez-vous|radio-canada|n'oubliez pas de vous abonner",
    re.IGNORECASE,
)


def log(message):
    print(message, flush=True)


def add_cuda_dll_dirs():
    """Sous Windows, rend visibles les DLL CUDA installées par pip (nvidia-cublas-cu12, nvidia-cudnn-cu12)."""
    if os.name != "nt":
        return
    try:
        import nvidia  # type: ignore
    except ImportError:
        return
    for base in nvidia.__path__:
        for bin_dir in Path(base).glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


def load_model(model_name, device):
    from faster_whisper import WhisperModel
    import ctranslate2
    import numpy as np

    if device in ("auto", "cuda") and ctranslate2.get_cuda_device_count() > 0:
        try:
            model = WhisperModel(model_name, device="cuda", compute_type="float16")
            # Le chargement des DLL CUDA ne se fait qu'à la première inférence : on teste tout de suite.
            segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="fr")
            list(segments)
            log(f"Modèle {model_name} chargé sur GPU (CUDA).")
            return model
        except Exception as error:  # DLL manquantes, VRAM insuffisante...
            if device == "cuda":
                raise
            log(f"GPU indisponible ({error}). Passage sur CPU.")
    elif device == "cuda":
        sys.exit("Aucun GPU CUDA détecté.")

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    log(f"Modèle {model_name} chargé sur CPU (plus lent).")
    return model


def load_audio(path):
    """Extrait la piste audio en mono 16 kHz (format attendu par Whisper), via PyAV : pas besoin de ffmpeg."""
    import av
    import numpy as np

    chunks = []
    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise ValueError("aucune piste audio")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(stream):
            frame.pts = None
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):
            chunks.append(resampled.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("piste audio vide")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def title_from_filename(path):
    name = path.stem.replace("_", " ")
    return re.sub(r"\s+", " ", name).strip()


def transcribe_file(model, model_name, video_path, output_path, language):
    started = time.time()
    segments_iter, info = model.transcribe(
        load_audio(video_path),
        language=language,
        word_timestamps=True,
        vad_filter=True,  # ignore musique et silences, limite les hallucinations
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,  # évite les boucles de répétition
        beam_size=5,
    )

    duration = info.duration
    segments = []
    word_count = 0
    last_report = 0.0
    for segment in segments_iter:
        text = segment.text.strip()
        if not segment.words or HALLUCINATIONS.search(text):
            continue
        words = [
            {
                "w": w.word.strip(),
                "s": round(w.start, 2),
                "e": round(w.end, 2),
                "p": round(w.probability, 2),
            }
            for w in segment.words
            if w.word.strip()
        ]
        if not words:
            continue
        segments.append({"start": words[0]["s"], "end": words[-1]["e"], "text": text, "words": words})
        word_count += len(words)

        if duration and segment.end - last_report >= 60:
            last_report = segment.end
            percent = min(100, segment.end / duration * 100)
            log(f"  {percent:5.1f} %  ({int(segment.end // 60)} min / {int(duration // 60)} min)")

    data = {
        "version": FORMAT_VERSION,
        "video": video_path.name,
        "title": title_from_filename(video_path),
        "language": info.language,
        "duration": round(duration, 2),
        "model": model_name,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "segments": segments,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(output_path)

    elapsed = time.time() - started
    speed = duration / elapsed if elapsed else 0
    log(f"  OK : {word_count} mots, {int(duration)} s de vidéo en {int(elapsed)} s (x{speed:.1f})")


def needs_transcription(video_path, output_path):
    if not output_path.exists():
        return True
    if output_path.stat().st_mtime < video_path.stat().st_mtime:
        return True
    try:
        return json.loads(output_path.read_text(encoding="utf-8")).get("version") != FORMAT_VERSION
    except (OSError, ValueError):
        return True


def main():
    parser = argparse.ArgumentParser(description="Transcrit les vidéos du jeu (mots horodatés).")
    parser.add_argument("videos", nargs="*", help="vidéos à transcrire (défaut : tout media/videos)")
    parser.add_argument("--model", default="large-v3-turbo", help="modèle Whisper (défaut : large-v3-turbo)")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--language", default="fr")
    parser.add_argument("--force", action="store_true", help="retranscrit même si le JSON existe déjà")
    args = parser.parse_args()

    if args.videos:
        videos = [Path(v).resolve() for v in args.videos]
    else:
        videos = sorted(p for p in VIDEOS_DIR.iterdir() if p.suffix.lower() in VIDEO_EXTENSIONS)

    todo = []
    for video in videos:
        if not video.exists():
            log(f"Introuvable : {video}")
            continue
        output = TRANSCRIPTS_DIR / f"{video.stem}.json"
        if args.force or needs_transcription(video, output):
            todo.append((video, output))

    if not todo:
        log(f"Rien à transcrire ({len(videos)} vidéo(s) déjà à jour dans {VIDEOS_DIR}).")
        return

    log(f"{len(todo)} vidéo(s) à transcrire.")
    add_cuda_dll_dirs()
    model = load_model(args.model, args.device)

    failures = 0
    for index, (video, output) in enumerate(todo, 1):
        log(f"[{index}/{len(todo)}] {video.name}")
        try:
            transcribe_file(model, args.model, video, output, args.language)
        except Exception as error:
            failures += 1
            log(f"  ERREUR : {error}")

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
