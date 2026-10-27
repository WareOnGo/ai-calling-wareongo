import { expect, it } from 'vitest';
import { transcriptTurns } from './transcript';

it('separates multilingual turns and preserves message line breaks', () => {
  expect(transcriptTurns("assistant: Hello! आपकी property available है?\r\nuser: Yes, it is.\r\nPlease call tomorrow.\r\nassistant: ठीक है।")).toEqual([
    { speaker: 'assistant', text: 'Hello! आपकी property available है?' },
    { speaker: 'user', text: 'Yes, it is.\nPlease call tomorrow.' },
    { speaker: 'assistant', text: 'ठीक है।' },
  ]);
});
it('reads older inline role labels and retains repeated turns', () => {
  expect(transcriptTurns('assistant: Hello user: yes user: Yes again assistant: Thank you.')).toEqual([
    { speaker: 'assistant', text: 'Hello' }, { speaker: 'user', text: 'yes' },
    { speaker: 'user', text: 'Yes again' }, { speaker: 'assistant', text: 'Thank you.' },
  ]);
});
it('does not interpret speaker words inside a multiline utterance', () => {
  expect(transcriptTurns('assistant: Type user: in the notes, please.\nuser: okay')).toEqual([
    { speaker: 'assistant', text: 'Type user: in the notes, please.' }, { speaker: 'user', text: 'okay' },
  ]);
});
it('preserves unlabelled text without guessing a speaker', () => {
  expect(transcriptTurns('Please contact the user: tomorrow.')).toEqual([{ speaker: 'unknown', text: 'Please contact the user: tomorrow.' }]);
  expect(transcriptTurns('Recording begins.\nUSER: Hello <script>literal text</script>')).toEqual([
    { speaker: 'unknown', text: 'Recording begins.' }, { speaker: 'user', text: 'Hello <script>literal text</script>' },
  ]);
});
it('handles role casing, aliases, system notes and empty turns', () => {
  expect(transcriptTurns('AGENT : Hi\ncaller: Hello\nsystem: Recording stopped\nassistant:  ')).toEqual([
    { speaker: 'assistant', text: 'Hi' }, { speaker: 'user', text: 'Hello' }, { speaker: 'system', text: 'Recording stopped' },
  ]);
  expect(transcriptTurns(' \n ')).toEqual([]);
});
