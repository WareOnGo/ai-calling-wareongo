export type TranscriptTurn = { speaker: 'assistant' | 'user' | 'system' | 'unknown'; text: string };

/** Preserve the transcript text; only explicit speaker labels become chat turns. */
export function transcriptTurns(transcript: string): TranscriptTurn[] {
  const source = transcript.replace(/\r\n?/g, '\n').trim();
  if (!source) return [];
  // Prefer line boundaries so an utterance mentioning "user:" stays intact.
  // Older single-line exports sometimes put every labelled turn on one line.
  const collapsed = !source.includes('\n') && /^(assistant|user|agent|caller|system)[\t ]*:/i.test(source);
  const labels = [...source.matchAll(collapsed
    ? /(?:^|\s+)(assistant|user|agent|caller|system)[\t ]*:[\t ]*/gi
    : /^[\t ]*(assistant|user|agent|caller|system)[\t ]*:[\t ]*/gim)];
  if (!labels.length) return [{ speaker: 'unknown', text: source }];
  const turns: TranscriptTurn[] = [];
  const intro = source.slice(0, labels[0].index).trim();
  if (intro) turns.push({ speaker: 'unknown', text: intro });
  labels.forEach((label, index) => {
    const text = source.slice(label.index! + label[0].length, labels[index + 1]?.index ?? source.length).trim();
    if (!text) return;
    const role = label[1].toLowerCase();
    const speaker = role === 'agent' ? 'assistant' : role === 'caller' ? 'user' : role as 'assistant' | 'user' | 'system';
    turns.push({ speaker, text });
  });
  return turns;
}
