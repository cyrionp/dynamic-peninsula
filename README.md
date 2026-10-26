# Dynamic Peninsula

A small, open-source companion that hangs from the top edge of your Windows
screen. Hover it and it opens; move away and it tucks itself back in.

> **Status: early work in progress.** Media controls, named stopwatches and
> countdowns, notes, to-dos, settings and ten themes work. Still to come:
> system notifications and other polish —
> see [`PLAN.md`](PLAN.md) for the roadmap.

## Features

- **Media controls** — see what's playing and play / pause / skip, from any
  player Windows knows about (Spotify, Apple Music, browsers). While music
  plays, previous / play-pause / next sit right on the slim bar too, in the
  full and the minimal look. When a player shares no artwork, a music-note
  cover in the theme's colours stands in.
- **Notes** — as many as you like, shown as cards, each with an optional
  title and saved as you type.
- **To-do list** — add, tick off, delete.
- **Countdowns** — as many as you like, each with a name: either a length
  ("25 minutes") or a clock time ("until 18:30"). When one ends the
  peninsula drops down, rings and plays a short chime.
- **Stopwatches** — several independent, named stopwatches at once.
- **Move it anywhere** — drag the bar to any spot on any screen; near the top
  it docks again. Pick from four bar sizes and four open sizes, a minimal
  pill look and its opacity. **Lock** it from Settings and it ignores the
  mouse entirely, so you can click the windows underneath; unlock it from
  the tray icon's menu.
- **Launch at startup** — optional, switched on in Settings.
- **Settings & themes** — pick what the slim bar shows (smart, now playing,
  countdown, stopwatch, clock, date) and one of five themes: Lagoon, Ember,
  Paper, Terminal and Aurora.

No accounts, no tracking. Everything is stored on your own computer.

## Development

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # build a Windows installer
```

Built with [Tauri 2](https://tauri.app): a Rust backend with a web frontend.

## Releasing

Pushing a tag such as `v0.2.0` (or running it by hand) runs the Release workflow: it builds the
Windows setup `.exe` with that version, signs it for the updater and publishes
a GitHub Release with the installer and `latest.json`. The app's
**Settings → Updates → Check now** reads that file from the latest release.

One-time setup, since updates are signed:

1. Generate a key pair: `npx tauri signer generate -w ~/.tauri/dynamic-peninsula.key`
   (keep the private key safe; losing it means existing installs can't update).
   Without a local checkout, run it in a GitHub Codespace on this repository.
2. In the repository's **Settings → Secrets and variables → Actions**, add
   - secret `TAURI_SIGNING_PRIVATE_KEY`: the contents of the private key file,
   - secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password (skip if none),
   - variable `TAURI_UPDATER_PUBKEY`: the contents of the `.pub` file.

Then release with `git tag v0.2.0 && git push origin v0.2.0`, or from the
browser: **Actions → Release → Run workflow**, and enter the version.

## Roadmap

The work is split into phases in [`PLAN.md`](PLAN.md) — window shell, then
stopwatches, persistence, countdowns, media control, and polish.

## License

Licensed under either of

- Apache License, Version 2.0 ([`LICENSE-APACHE`](LICENSE-APACHE))
- MIT license ([`LICENSE-MIT`](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this project by you shall be dual licensed as above, without
any additional terms or conditions.
