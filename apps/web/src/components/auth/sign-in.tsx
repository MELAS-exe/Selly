'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import {
  createLocalKey,
  extensionSigner,
  forgetStoredKey,
  hasExtension,
  localKeySigner,
  MIN_PASSPHRASE,
  type NewKey,
  storedKey,
  storeKey,
  unlockStoredKey,
} from '@/lib/nostr-signers';
import { describeError } from '@/lib/onboarding';
import { signIn } from '@/lib/sign-in';
import type { NostrSessionResponse } from '@/lib/vendor-types';

type Mode = 'choose' | 'unlock' | 'create';

const arrow = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const inputClass =
  'peer w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#173B32] transition-colors rounded-none min-h-11';
const labelClass = 'block pv-sans text-[10px] uppercase tracking-widest text-black/50 mb-1';
const primaryButton =
  'relative overflow-hidden pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#173B32] bg-[#173B32] text-[#F6F4F0] py-4 px-8 w-full text-center min-h-12 hover:bg-transparent hover:text-[#173B32] transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

/**
 * Sign in with a Nostr key: a browser extension, the key saved on this device, or a new key made here.
 * `next` is already checked on the server: a path inside the dashboard.
 */
export function SignIn({ next }: { next: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read after mount: the server cannot know what the browser has.
  const [extension, setExtension] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Extensions inject window.nostr a moment after load.
    const check = () => setExtension(hasExtension());
    check();
    const t = setTimeout(check, 600);
    setSaved(storedKey() !== null);
    return () => clearTimeout(t);
  }, []);

  function finish(result: NostrSessionResponse) {
    router.replace(next ?? (result.vendor ? '/app' : '/app/onboarding'));
  }

  async function run(task: () => Promise<NostrSessionResponse>) {
    setBusy(true);
    setError(null);
    try {
      finish(await task());
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <div aria-live="assertive" role="alert" className="min-h-6">
        {error && (
          <p className="pv-sans text-sm text-[#a3214f] border border-[#a3214f]/30 px-4 py-3 mb-6">
            {error}
          </p>
        )}
      </div>

      {mode === 'choose' && (
        <ul className="border-t border-[#1111111f]">
          <li className="border-b border-[#1111111f]">
            <button
              type="button"
              disabled={busy || !extension}
              onClick={() => run(() => signIn(extensionSigner()))}
              className="group w-full text-left py-6 flex items-center justify-between gap-6 min-h-16 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>
                <span className="pv-serif text-2xl block">Nostr browser extension</span>
                <span className="pv-sans text-xs text-black/60">
                  {extension
                    ? 'Alby, nos2x or any NIP-07 signer'
                    : 'No extension found in this browser'}
                </span>
              </span>
              <span className="group-hover:translate-x-1 transition-transform">{arrow}</span>
            </button>
          </li>
          {saved && (
            <li className="border-b border-[#1111111f]">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode('unlock');
                }}
                className="group w-full text-left py-6 flex items-center justify-between gap-6 min-h-16 cursor-pointer"
              >
                <span>
                  <span className="pv-serif text-2xl block">Key saved on this device</span>
                  <span className="pv-sans text-xs text-black/60">
                    Unlock it with your passphrase
                  </span>
                </span>
                <span className="group-hover:translate-x-1 transition-transform">{arrow}</span>
              </button>
            </li>
          )}
          <li className="border-b border-[#1111111f]">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setMode('create');
              }}
              className="group w-full text-left py-6 flex items-center justify-between gap-6 min-h-16 cursor-pointer"
            >
              <span>
                <span className="pv-serif text-2xl block">Create a new key</span>
                <span className="pv-sans text-xs text-black/60">
                  Made in this browser. New to Selly? Start here.
                </span>
              </span>
              <span className="group-hover:translate-x-1 transition-transform">{arrow}</span>
            </button>
          </li>
        </ul>
      )}

      {mode === 'unlock' && (
        <UnlockForm
          busy={busy}
          onBack={() => setMode('choose')}
          onForget={() => {
            forgetStoredKey();
            setSaved(false);
            setMode('choose');
          }}
          onSubmit={(passphrase) =>
            run(async () => {
              // Unlocking is slow on purpose; sign in only once the key is open.
              const key = await unlockStoredKey(passphrase);
              return signIn(localKeySigner(key));
            })
          }
        />
      )}

      {mode === 'create' && (
        <CreateKeyForm
          busy={busy}
          onBack={() => setMode('choose')}
          onError={setError}
          onSubmit={(key, passphrase) =>
            run(async () => {
              await storeKey(key.secretKey, passphrase);
              return signIn(localKeySigner(key.secretKey));
            })
          }
        />
      )}
    </div>
  );
}

function UnlockForm({
  busy,
  onBack,
  onForget,
  onSubmit,
}: {
  busy: boolean;
  onBack: () => void;
  onForget: () => void;
  onSubmit: (passphrase: string) => void;
}) {
  const id = useId();
  const [passphrase, setPassphrase] = useState('');
  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(passphrase);
      }}
    >
      <div>
        <label htmlFor={id} className={labelClass}>
          Passphrase
        </label>
        <input
          id={id}
          type="password"
          autoComplete="current-password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={busy || passphrase.length === 0} className={primaryButton}>
        {busy ? 'Unlocking…' : 'Unlock and sign in'}
      </button>
      <div className="flex justify-between gap-6 pv-sans text-xs text-black/60">
        <button
          type="button"
          onClick={onBack}
          className="underline underline-offset-4 min-h-11 cursor-pointer"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onForget}
          className="underline underline-offset-4 min-h-11 cursor-pointer"
        >
          Forget this key on this device
        </button>
      </div>
    </form>
  );
}

function CreateKeyForm({
  busy,
  onBack,
  onError,
  onSubmit,
}: {
  busy: boolean;
  onBack: () => void;
  onError: (message: string | null) => void;
  onSubmit: (key: NewKey, passphrase: string) => void;
}) {
  const ids = { key: useId(), pass: useId(), again: useId(), ok: useId() };
  const [key, setKey] = useState<NewKey | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    createLocalKey().then(
      (k) => live && setKey(k),
      () => live && onError('Your browser could not create a key. Try another browser.'),
    );
    return () => {
      live = false;
    };
  }, [onError]);

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = again.length > 0 && again !== passphrase;
  const ready = !!key && saved && passphrase.length >= MIN_PASSPHRASE && passphrase === again;

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.nsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Copy did not work. Select the key and copy it by hand.');
    }
  }

  function download() {
    if (!key) return;
    const text = `Selly backup key. Keep it secret: anyone who has it can open your shop.\n\n${key.nsec}\n\nPublic key: ${key.npub}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selly-backup-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (key && ready) onSubmit(key, passphrase);
      }}
    >
      <div>
        <label htmlFor={ids.key} className={labelClass}>
          Your backup key
        </label>
        <output
          id={ids.key}
          className="block pv-sans text-xs break-all tnum border border-[#1111111f] bg-[#EAE7E0] px-4 py-3 min-h-12 select-all"
        >
          {key ? key.nsec : 'Creating your key…'}
        </output>
        <div className="flex gap-6 mt-2 pv-sans text-xs">
          <button
            type="button"
            onClick={copy}
            disabled={!key}
            className="underline underline-offset-4 min-h-11 cursor-pointer disabled:opacity-40"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!key}
            className="underline underline-offset-4 min-h-11 cursor-pointer disabled:opacity-40"
          >
            Download as a file
          </button>
        </div>
        <p className="pv-sans text-xs leading-relaxed text-black/60 mt-2">
          This key is your login. Save it in a password manager or write it down. Selly cannot
          recover it, and anyone who has it can open your shop.
        </p>
      </div>

      <label
        htmlFor={ids.ok}
        className="flex gap-4 items-start pv-sans text-sm cursor-pointer min-h-11"
      >
        <input
          id={ids.ok}
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-1 size-5 accent-[#173B32] shrink-0"
        />
        <span>I saved my backup key in a safe place.</span>
      </label>

      <div>
        <label htmlFor={ids.pass} className={labelClass}>
          Passphrase for this device
        </label>
        <input
          id={ids.pass}
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          aria-describedby={`${ids.pass}-hint`}
          className={inputClass}
        />
        <p
          id={`${ids.pass}-hint`}
          className={`pv-sans text-xs mt-1 ${tooShort ? 'text-[#a3214f]' : 'text-black/50'}`}
        >
          At least {MIN_PASSPHRASE} characters. It locks the key stored on this device.
        </p>
      </div>
      <div>
        <label htmlFor={ids.again} className={labelClass}>
          Repeat the passphrase
        </label>
        <input
          id={ids.again}
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          aria-invalid={mismatch}
          className={inputClass}
        />
        {mismatch && (
          <p className="pv-sans text-xs mt-1 text-[#a3214f]">The passphrases do not match.</p>
        )}
      </div>

      <button type="submit" disabled={busy || !ready} className={primaryButton}>
        {busy ? 'Creating your account…' : 'Create my account'}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="pv-sans text-xs text-black/60 underline underline-offset-4 min-h-11 self-start cursor-pointer"
      >
        Back
      </button>
    </form>
  );
}
