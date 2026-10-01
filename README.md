# Mot Dit !

Jeu à 2 joueurs en ligne. On affiche le nom d'une émission, chaque joueur parie sur **3 mots**,
puis un extrait de **20 à 30 secondes** se lance chez les deux joueurs en même temps.
Chaque mot prononcé dans l'extrait rapporte **1 point** (3 points max par manche).

- Front : Vue 3 + Vite
- Serveur : Express + Socket.IO (WebSocket)
- Transcription : [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (Whisper `large-v3-turbo`, horodatage mot par mot)

## Installation

Prérequis : Node.js 20+ et Python 3.10+. Un GPU NVIDIA est conseillé pour la transcription, mais pas obligatoire.

```bash
npm install
```

## Ajouter des émissions

0. (Optionnel) Télécharge des vidéos YouTube en mp4 avec `npm run download` : colle une URL, la vidéo arrive dans
   `media/videos/` (480p max, titre YouTube = titre du jeu), puis le script propose de lancer la transcription.
   Il tourne en boucle : une URL après l'autre, ligne vide pour quitter. Respecte les droits des contenus que tu télécharges.
1. Dépose les vidéos dans `media/videos/` (`.mp4`, `.webm`, `.m4v`, `.mov`).
   **Le nom du fichier est le titre affiché aux joueurs** : `Quotidien - 12 mars.mp4` devient « Quotidien - 12 mars ».
2. Lance la transcription :

```bash
npm run transcribe
```

La première fois, cette commande crée l'environnement Python (`transcription/.venv`), installe faster-whisper
(et CUDA si un GPU NVIDIA est détecté), puis télécharge le modèle (~1,6 Go). Ensuite, seules les nouvelles vidéos
ou celles qui ont été modifiées sont transcrites. Sur le GPU de cette machine, la vidéo de démo a été transcrite
~55× plus vite que le temps réel (une heure d'émission ≈ 1 à 2 minutes). Sur CPU, c'est beaucoup plus lent.

Options utiles :

```bash
npm run transcribe -- --force               # tout retranscrire
npm run transcribe -- --model small         # plus rapide, moins précis (CPU)
npm run transcribe -- "media/videos/X.mp4"  # une seule vidéo
```

Chaque vidéo donne un fichier `media/transcripts/<nom>.json`. Tu peux y corriger le champ `title` ou un mot mal transcrit.
Une vidéo de démo (`Exemple - Journal TV.mp4`, voix de synthèse) est fournie : supprime-la quand tu as tes propres émissions.

Pour vérifier que les extraits tirés par le jeu correspondent bien à l'audio, lance `npm run check-clip` : il tire un
extrait au hasard, re-transcrit à part le son découpé et compare avec les mots que le jeu croit entendre.

## Jouer

```bash
npm run dev      # développement : http://localhost:5173
```

Pour jouer à deux sur le même réseau, l'autre joueur ouvre l'adresse « Network » affichée par Vite (ex. `http://192.168.x.x:5173`).
Pour tester seul, ouvre deux onglets : chaque onglet est un joueur différent.

En production :

```bash
npm run build
npm start        # http://localhost:3000 (variable PORT pour changer)
```

Déroulé : pseudo → « Créer une partie » → partage du code (ou du lien d'invitation) → l'hôte règle le nombre
de manches, le temps de choix et le filtre des mots courants, puis lance la partie. Le tchat reste disponible tout du long.
Si un joueur recharge sa page ou perd la connexion, il retrouve sa place (il a 60 s pour revenir).

## Comment ça marche

**Transcription (une seule fois, hors jeu).** faster-whisper transcrit chaque vidéo avec `word_timestamps=True` :
chaque mot est stocké avec son instant de début et de fin. Un filtre VAD ignore la musique et les silences,
ce qui évite les « hallucinations » de Whisper. Le jeu n'a donc rien à transcrire en direct : il sait déjà ce qui est
dit à chaque seconde de chaque émission.

**Choix de l'extrait** (`server/clips.js`). L'extrait commence au début d'une phrase et se termine de préférence à la
fin d'une phrase. Sa durée est tirée au hasard entre 20 et 30 s, et il faut au moins 1,2 mot par seconde pour éviter
les génériques. Dans une même partie, le jeu évite de reprendre la même émission ou un passage déjà joué.
L'extrait n'est révélé aux joueurs qu'une fois les mots verrouillés.

**Comparaison des mots** (`shared/words.js`). Le jeu étant oral, on ignore ce qui ne s'entend pas :

| Le joueur écrit | Compte si l'émission dit… |
| --- | --- |
| `Été`, `ete` | « été » (accents, majuscules et ponctuation ignorés) |
| `chat` | « chats » (pluriel en s/x) |
| `actualité` | « l'actualité » (élisions) |
| `aujourdhui`, `tapis-rouge` | « aujourd'hui », « tapis rouge » (expressions jusqu'à 4 mots) |
| `vingt`, `22` | « 20 », « 22 », « vingt-deux » (nombres) |

Un mot dit plusieurs fois rapporte quand même 1 seul point. Avec le filtre activé, les mots trop courants
(« le », « est », « euh », « voilà »…) sont refusés : la liste `STOPWORDS` se modifie en haut de `shared/words.js`.

**Synchronisation.** Le serveur décide de tout (phases, chrono, points). Chaque client mesure le décalage de son
horloge avec le serveur, précharge la vidéo au bon moment, puis lance la lecture à l'instant fixé par le serveur.
Seules les vidéos sont servies publiquement : les transcriptions restent côté serveur, donc impossible de tricher en les lisant.

## Structure

```
client/          Front Vue (écrans : accueil, salon, choix, extrait, résultats, fin + tchat)
server/          Express + Socket.IO : salons, déroulé des manches, choix des extraits
shared/words.js  Normalisation et comparaison des mots (serveur + client)
transcription/   Script Python faster-whisper
scripts/         npm run transcribe (installe Python/venv au besoin)
media/videos/    Tes émissions
media/transcripts/  Transcriptions générées
test/            npm test
```

## Limites connues

- Whisper fait parfois des erreurs, surtout quand plusieurs personnes parlent en même temps. Les résultats montrent
  la transcription de l'extrait pour que les joueurs voient ce que le jeu a « entendu ».
- Les homophones qui ne s'écrivent pas pareil (« vert » / « verre », « cheval » / « chevaux ») ne sont pas confondus.
