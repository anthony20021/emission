// Mise en forme de la transcription d'un extrait (lignes + surlignage des mots trouvés).

/** Index de token -> couleurs des joueurs qui ont trouvé ce mot. */
export function buildMarks(result, players) {
  const marks = new Map();
  for (const player of players) {
    for (const word of result?.scores[player.id]?.words ?? []) {
      for (const { from, to } of word.occurrences) {
        for (let k = from; k <= to; k++) {
          const colors = marks.get(k) ?? [];
          if (!colors.includes(player.color)) colors.push(player.color);
          marks.set(k, colors);
        }
      }
    }
  }
  return marks;
}

/** Regroupe les tokens par phrase. Whisper sépare les élisions ("l" + "'actualité") : on les recolle à l'affichage. */
export function buildLines(tokens) {
  const lines = [];
  tokens.forEach((token, index) => {
    let line = lines.at(-1);
    if (!line || line.seg !== token.seg) {
      line = { seg: token.seg, items: [] };
      lines.push(line);
    }
    const glue = line.items.length === 0 || /^['’\-,.!?;:…)]/.test(token.w);
    // Seul le mot est surligné, pas l'apostrophe ni la ponctuation autour.
    const [, lead, core, trail] = token.w.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
    line.items.push({ index, lead, core, trail, start: token.s, end: token.e, glue });
  });
  return lines;
}

export function markStyle(colors) {
  if (!colors?.length) return null;
  const background = colors.length === 1
    ? colors[0]
    : `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`;
  return { background };
}
