import { transcriptTurns } from '@/lib/transcript';

const SPEAKERS = { assistant: 'AI agent', user: 'Caller', system: 'System', unknown: 'Transcript' };

export function Transcript({ text }: { text: string }) {
  return <ol className="transcript transcript-chat" aria-label="Call transcript">
    {transcriptTurns(text).map((turn, index) => <li className={`transcript-turn transcript-turn-${turn.speaker}`} key={index}>
      <span className="transcript-speaker">{SPEAKERS[turn.speaker]}</span>
      <p className="transcript-bubble" dir="auto">{turn.text}</p>
    </li>)}
  </ol>;
}
