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
  full and the minimal look. A progress bar shows where the track is; click
  it to jump, or go 15 seconds back or forward (handy for podcasts). Scroll the mouse wheel over the bar to change the system
  volume. When a player shares no artwork, a music-note cover in the
  theme's colours stands in.
- **Output device and headphones** — under "now playing", pick where the
  sound goes (headphones, speakers, a monitor) without opening Windows
  settings. With AirPods, the left and right earbud and the case show
  their battery, and the earbud that is in an ear lights up; other
  Bluetooth headsets show the battery Windows reports. When headphones
  connect, or an earbud goes in or out, the slim bar says so for a moment
  (can be turned off in Settings). AirPods data comes from their Bluetooth
  signal in 10 % steps, the same way MagicPods reads it.
- **Notes** — as many as you like, shown as cards, each with an optional
  title and saved as you type. Drag cards to reorder them and pin the
  important ones to the top.
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
  countdown, stopwatch, clock, date; for Smart you set the order and what it
  may show) and one of eleven themes, each with a dark
  and a light mode: Lagoon, Ember, Paper, Terminal, Aurora, Frost, Moss,
  Graphite, Sakura, Citrus and Island.
- **Island theme** — looks and behaves like Apple's Dynamic Island: an empty
  black notch while idle that springs open, artwork and a waveform in the
  artwork's colour while music plays, a short peek at each new track, and
  timers in orange. Always black, in either mode.
- **Only show when needed** — an optional switch that tucks the peninsula away
  while it has nothing but the clock to show; music, timers and pop-ups bring
  it back, and pointing at its spot opens it.

No accounts, no tracking. Everything is stored on your own computer; the
only thing that goes online is the update check.

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
