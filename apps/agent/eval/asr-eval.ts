// Measures a speech-to-text service on labelled voice notes, before it is switched on (F9, section 8.5).
//
//   eval/asr/labels.json   [{ "file": "wo-001.ogg", "language": "wo", "text": "robe bu ñuul bi am nga ko ci 42" }, ...]
//   eval/asr/wo-001.ogg    the voice notes (webm, ogg or mp4), recorded by native speakers
//
//   ASR_URL=https://... ASR_API_KEY=... pnpm --filter @selly/agent asr-eval
//
// Reports the word error rate (WER) per language and how often the service says it is unsure.
// The voice notes are personal data: keep them out of git (eval/asr/ is ignored).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpAsr, MIN_ASR_CONFIDENCE } from '../src/asr';
import { normalise } from './grade';

/** Word error rate: word-level edit distance over the number of reference words. */
export function wer(reference: string, hypothesis: string): number {
  const words = (s: string) =>
    normalise(s)
      .replace(/[^\p{L}\p{N}' ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const r = words(reference);
  const h = words(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    prev = cur;
  }
  return (prev[h.length] as number) / r.length;
}

const typeOf = (file: string) =>
  file.endsWith('.ogg')
    ? 'audio/ogg'
    : file.endsWith('.mp4') || file.endsWith('.m4a')
      ? 'audio/mp4'
      : 'audio/webm';

async function main() {
  const url = process.env.ASR_URL;
  if (!url) throw new Error('Set ASR_URL (and ASR_API_KEY if the service needs one).');
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'asr');
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as {
    file: string;
    language: string;
    text: string;
  }[];
  const asr = new HttpAsr(url, process.env.ASR_API_KEY ?? '', 30_000);
  const byLang = new Map<string, { n: number; wer: number; unsure: number; failed: number }>();
  for (const l of labels) {
    const s = byLang.get(l.language) ?? { n: 0, wer: 0, unsure: 0, failed: 0 };
    s.n++;
    const t = await asr
      .transcribe(readFileSync(join(dir, l.file)), typeOf(l.file))
      .catch(() => null);
    if (!t) s.failed++;
    else {
      s.wer += wer(l.text, t.text);
      if (t.confidence < MIN_ASR_CONFIDENCE) s.unsure++;
    }
    byLang.set(l.language, s);
  }
  console.log('| Language | Notes | WER | Unsure (asks to write) | Failed |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const [lang, s] of byLang) {
    const ok = s.n - s.failed;
    console.log(
      `| ${lang} | ${s.n} | ${ok ? Math.round((100 * s.wer) / ok) : '-'} % | ${s.unsure} | ${s.failed} |`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
