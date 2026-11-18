import { describe, expect, it } from 'vitest';
import { WhisperAsr, whisperConfidence } from '.';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('Whisper speech to text', () => {
  it('sends the audio with a vocabulary hint and reads text, language and confidence', async () => {
    let form: FormData | null = null;
    const asr = new WhisperAsr('https://api.example/v1', 'k', 'whisper-large-v3', 1000, (async (
      _u: string,
      init: RequestInit,
    ) => {
      form = init.body as FormData;
      return json({
        text: ' Vous avez la robe en 42 ? ',
        language: 'french',
        segments: [{ avg_logprob: -0.1, no_speech_prob: 0.01 }],
      });
    }) as unknown as typeof fetch);
    const t = await asr.transcribe(Buffer.from([1, 2, 3]), 'audio/ogg');
    expect(t).toEqual({
      text: 'Vous avez la robe en 42 ?',
      confidence: expect.any(Number),
      language: 'fr',
    });
    expect(t?.confidence).toBeGreaterThan(0.85);
    expect((form as unknown as FormData).get('model')).toBe('whisper-large-v3');
    expect(String((form as unknown as FormData).get('prompt'))).toContain('Pikine');
  });

  it('is unsure about silence or a language it does not know', () => {
    expect(whisperConfidence([])).toBe(0);
    expect(whisperConfidence([{ avg_logprob: -1.5, no_speech_prob: 0.6 }])).toBeLessThan(0.6);
  });
});
