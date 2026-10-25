# Dynamic Peninsula

A small, open-source companion that hangs from the top edge of your Windows
screen. Hover it and it opens; move away and it tucks itself back in.

> **Status: early work in progress.** The window shell (top-center, transparent,
> always on top) and tray icon work. Persistence and media control are still
> being built —
> see [`PLAN.md`](PLAN.md) for the roadmap.

## Planned features

- **Media controls** — see what's playing and play / pause / skip, from any
  player Windows knows about (Spotify, Apple Music, browsers).
- **Quick notes** — one box, saved as you type.
- **To-do list** — add, tick off, delete.
- **Countdown** — set a duration and watch it run down.
- **Countdown to a time** — "how long until 18:30".
- **Multiple stopwatches** — several independent timers at once.

No accounts, no tracking. Everything is stored on your own computer.

## Development

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # build a Windows installer
```

Built with [Tauri 2](https://tauri.app): a Rust backend with a web frontend.

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
