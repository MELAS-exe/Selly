// Speech to text for customer voice notes (architecture.md sections 3.3, 7.5 and 8.2).
// Wolof quality must be measured before a provider is chosen (F9), so the MVP ships the interface,
// a provider that declines (the agent then asks for a written message), and a scripted one for tests.

export interface Transcript {
  text: string;
  /** 0 to 1. Below MIN_CONFIDENCE the agent asks for a written message. */
  confidence: number;
  language: 'fr' | 'wo' | 'en' | 'mixed' | 'unknown';
}

export interface AsrProvider {
  readonly name: string;
  transcribe(audio: Buffer, contentType: string, signal?: AbortSignal): Promise<Transcript | null>;
}

export const MIN_ASR_CONFIDENCE = 0.6;

/** No speech-to-text configured: every voice note gets « pouvez-vous l'écrire ? ». */
export class NoAsr implements AsrProvider {
  readonly name = 'none';
  async transcribe() {
    return null;
  }
}

/**
 * Any speech-to-text service behind a small HTTP contract, so the team can try Omnilingual ASR (F9)
 * or a commercial service without changing the agent:
 *
 *   POST <ASR_URL>   body: the audio bytes   content-type: audio/webm | audio/ogg | audio/mp4
 *   200 { "text": "...", "confidence": 0.0-1.0, "language": "fr" | "wo" | "en" | "mixed" | "unknown" }
 *
 * `scripts/asr-eval.ts` measures a service on labelled voice notes before it is switched on.
 */
export class HttpAsr implements AsrProvider {
  readonly name = 'http';
  constructor(
    private readonly url: string,
    private readonly apiKey = '',
    private readonly timeoutMs = 8_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(
    audio: Buffer,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<Transcript | null> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: new Uint8Array(audio),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Transcript>;
    if (typeof body.text !== 'string' || typeof body.confidence !== 'number') return null;
    const languages = ['fr', 'wo', 'en', 'mixed', 'unknown'] as const;
    return {
      text: body.text,
      confidence: Math.max(0, Math.min(1, body.confidence)),
      language: languages.includes(body.language as (typeof languages)[number])
        ? (body.language as Transcript['language'])
        : 'unknown',
    };
  }
}

export function asrFromEnv(env: NodeJS.ProcessEnv = process.env): AsrProvider {
  return env.ASR_URL ? new HttpAsr(env.ASR_URL, env.ASR_API_KEY ?? '') : new NoAsr();
}

export class ScriptedAsr implements AsrProvider {
  readonly name = 'scripted';
  constructor(private readonly result: Transcript | null) {}
  async transcribe() {
    return this.result;
  }
}

/** Short-lived holder for uploaded voice notes, so the turn can transcribe the bytes. */
export class AudioUploads {
  private readonly items = new Map<
    string,
    {
      conversationId: string;
      contentType: string;
      maxBytes: number;
      bytes?: Buffer;
      coreKey?: string;
      at: number;
    }
  >();
  constructor(private readonly ttlMs = 60 * 60_000) {}

  reserve(key: string, conversationId: string, contentType: string, maxBytes: number) {
    this.sweep();
    this.items.set(key, { conversationId, contentType, maxBytes, at: Date.now() });
  }
  get(key: string) {
    const it = this.items.get(key);
    if (!it || Date.now() - it.at > this.ttlMs) return null;
    return it;
  }
  complete(key: string, bytes: Buffer, coreKey: string) {
    const it = this.items.get(key);
    if (it) Object.assign(it, { bytes, coreKey });
  }
  private sweep() {
    const t = Date.now();
    for (const [k, v] of this.items) if (t - v.at > this.ttlMs) this.items.delete(k);
  }
}
