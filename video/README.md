# The demo video

A 3-minute film of Selly, in English, told through Sokhna (Maison Sokhna) and her customer Fatou. The story and
the voice-over are in [SCRIPT.md](SCRIPT.md). The voice-over and the music come later; this folder makes the
picture and the sound effects.

The film is a web page: ten scenes on one [GSAP](https://gsap.com) timeline (`film/`), with footage of the real app
recorded from the local stack (`clips/`). A renderer seeks the timeline frame by frame and hands the frames to
ffmpeg, so every render is identical and any moment can be checked on its own.

```
engine/
  capture.mjs   records the takes of the real app (takes.mjs) into clips/, with their timing marks
  takes.mjs     what each take does, at a person's pace: the photo, Fatou's chat and payment, the dashboard…
  reset.mjs     puts the demo shop back as it was before the takes (no sneakers, no order, empty assistant)
  render.mjs    renders film/ to out/film.mp4 (or one scene, a time range, or stills)
  sfx.mjs       synthesizes the sound effects and mixes them at the times the scenes asked for
film/
  index.html    the stage and its ten scenes; film.css, the look; kit.js, the moves; scenes.js, the timing
  runtime.js    the timeline, clip seeking, sound cues; opened as is, a preview with a scrubber
assets/         the sneakers photo Sokhna "takes" (the landing's sneaker on a plain background)
```

## What it needs

- Node 20+, ffmpeg on the PATH, and Playwright's Chromium (`CHROME` points at another Chrome if needed).
- `npm install` in this folder.
- For the takes, the local stack with the demo shop in English and the scripted assistant:
  - `pnpm dev:testwallet`, core, web, and the agent started with `LLM_PRIMARY=video` (no model, no API key:
    `apps/agent/src/engine/video.ts` answers the script's lines through the real tools, so the stock, the order and
    the payment are real rows).
  - Maison Sokhna seeded (`apps/core/scripts/demo-shop.mts`) and switched to English once
    (`pnpm --filter @selly/core exec tsx scripts/demo-shop-en.mts`).

## Making it

```bash
npm run capture                     # all takes, in story order (photo → customer → dashboard)
node engine/render.mjs --half --stills 3,45,119   # check moments without rendering
node engine/render.mjs              # out/film.mp4, 1920×1080, 30 fps
node engine/sfx.mjs out/film.mp4    # out/film.sfx.wav and out/film.final.mp4 (picture + effects)
```

- `film/index.html` opened in a browser plays the film with a scrubber (space, arrows, a button per scene).
- `--scene 6` renders one scene with its transitions; `--from 70 --to 80` a range; `--subs` burns in the
  voice-over lines (`LINES` in scenes.js).
- `node engine/sfx.mjs --gallery` writes every sound once to listen to them.
- The takes record their moments (`clips/marks.js`): a new capture moves the overlays with it. The sats amount the
  checkout showed is recorded too, so every figure on screen matches the clip.
- The check mark lands at 1:59, where the music stops (SCRIPT.md); no sound effect plays in the second before it.

## When the voice-over arrives

Scene start times and lengths are in `scenes.js` (`start`, `dur`), the subtitle lines in `LINES`. Fit them to the
recorded takes, render again, then lay the voice and the music over `out/film.sfx.wav` in the editor.
