"""
Re-transcrit de façon indépendante un passage d'une vidéo (début -> fin en secondes) et affiche les mots en JSON.
Sert à vérifier que les extraits choisis par le jeu correspondent bien à ce qui est dit dans la vidéo.
Usage : python verify_clip.py <video> <debut> <fin> [modele]
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import transcribe as t  # noqa: E402


def main():
    video, start, end = Path(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
    model_name = sys.argv[4] if len(sys.argv) > 4 else "large-v3-turbo"
    t.add_cuda_dll_dirs()
    model = t.load_model(model_name, "auto")
    audio = t.load_audio(video)
    chunk = audio[int(start * t.SAMPLE_RATE): int(end * t.SAMPLE_RATE)]
    segments, _ = model.transcribe(chunk, language="fr", word_timestamps=True, vad_filter=True,
                                   condition_on_previous_text=False)
    words = [w.word.strip() for s in segments for w in (s.words or []) if w.word.strip()]
    print("@@" + json.dumps(words, ensure_ascii=False))


if __name__ == "__main__":
    main()
