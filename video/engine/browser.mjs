// The Chromium that Playwright installed on this machine (playwright-core brings no browser of its own).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const candidates = [
  process.env.CHROME,
  process.env.LOCALAPPDATA &&
    join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'),
].filter(Boolean);

export async function launch(opts = {}) {
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chromium found: set CHROME to a chrome executable.');
  // HEADED=1: a real window paints more often than headless, so live takes get more frames. It opens off-screen.
  const headed = !!process.env.HEADED;
  return chromium.launch({
    executablePath,
    headless: !headed,
    // Same pixels every run: no GPU raster differences, fonts hinted the same way.
    args: [
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--autoplay-policy=no-user-gesture-required',
      ...(headed ? ['--window-position=-3000,0'] : []),
    ],
    ...opts,
  });
}
