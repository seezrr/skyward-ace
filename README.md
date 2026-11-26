# skyward-ace

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/seezrr/skyward-ace/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/seezrr/skyward-ace/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

# HALCYON

> CONCEPT: "Halcyon" — calm-but-thrilling arcade flight at golden hour. A small stylised plane crosses a procedural archipelago, threads glowing rings, catches island updrafts and outruns the sunset. Alto's Odyssey meets Wipeout-clean UI in 3D. The goal is simple: "I'll play one more run."

Halcyon is a self-contained browser flight game. There are no combat sorties, no downloads and no network calls: terrain, lagoons, ocean shaders, sky, clouds, islands, aircraft, lanterns, particles and every sound are generated at runtime. Three flights share one forgiving arcade flight model:

- **Ring Run** — chain glowing rings before the sun slips below the horizon. Close passes earn wind streaks; storm cells punish a lazy line.
- **Free Flight** — no timer. Gather sky lanterns, ride warm updrafts and watch the day turn to dusk and night.
- **Daily Seed** — one seeded course for everyone today, with your best score kept locally on this device.

The sky and sea move from golden hour through dusk to night. Camera modes are spring-armed chase, free orbit and a clean photo mode. Controls work with keyboard, mouse steering, gamepad and touch (virtual stick, optional tilt). Auto-level, invert-Y, volume, reduced motion and Low/Med/High quality are adjustable in Settings; dynamic resolution protects the frame rate.

## Run it

```sh
node serve.ts
# open http://localhost:8080 in a WebGL2 desktop browser
```

The browser only needs `game/index.html` and the files under `game/`; there is no build step. Append `?debug` for an FPS readout and test controls. To reproduce the hand-in output:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Controls

| Input | Action |
| --- | --- |
| W / S or ↑ / ↓ | Pitch down / up |
| A / D or ← / → | Roll left / right |
| Q / E | Rudder yaw |
| Shift / Ctrl | Throttle up / down |
| Space | Hold to boost (FOV kick) |
| C | Chase / free / photo camera |
| P or Esc | Pause |
| R | Soft restart |
| G | Toggle auto-level |
| V | Toggle mouse steering |
| M | Mute |
| 1 / 2 / 3 | Low / medium / high quality |

Gamepad: left stick steers, triggers adjust throttle, A boosts, B changes camera. On touch: drag the virtual stick, hold BOOST, or enable tilt in Settings.

---

<sub>Entered on [make.fun](https://make.fun/?ref=seezrr&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
