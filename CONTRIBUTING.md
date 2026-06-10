# Contributing to Hey Claude

Thanks for your interest! This project is intentionally tiny: **one Node file, one HTML file, zero dependencies, no build step**. Please keep it that way.

## Ground rules

1. **No dependencies.** `server.js` uses only Node stdlib; `public/index.html` is a single self-contained file. PRs adding npm packages or build tooling will be declined unless there's a very strong reason.
2. **No API keys by default.** Features requiring external accounts (e.g. Porcupine wake word, ElevenLabs voices) must be optional and off by default.
3. **Honest UX.** If a browser limitation exists (background tabs, mobile quirks), document it — don't hide it.
4. **Spanish + English.** UI strings are Spanish-first today; an i18n PR making them switchable is very welcome.

## Dev loop

```bash
bash start.sh                 # starts on :8765 against the parent folder
# edit public/index.html → reload browser
# edit server.js → restart start.sh
```

Quick server checks:

```bash
curl -s localhost:8765/status
curl -s -X POST localhost:8765/say -H 'Content-Type: application/json' -d '{"text":"hola"}'
curl -s -X POST localhost:8765/stop
```

## Good first issues

- i18n for UI strings (es/en toggle)
- Firefox/Safari STT fallback messaging
- Local Whisper STT option (server-side, opt-in)
- Porcupine WASM wake-word as opt-in pro path
- Theming (the palette lives in CSS `:root` variables)

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`…). One logical change per PR.
