# skyward-ace

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/seezrr/skyward-ace/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/seezrr/skyward-ace/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

SKYWARD ACE is a self-contained arcade flight game. Click a sortie and you are airborne over a low-poly archipelago with a target ring in view. Three missions share one forgiving flight model: protect a carrier fleet, thread a ring course for combo points, or free-fly for stunt scores. Everything is generated at runtime — terrain, ocean shaders, clouds, aircraft, explosions and all sound — with no external assets and no network requests. Append `?debug` to the page URL for an FPS readout and test controls.

## Run it

```sh
node serve.ts
# open http://localhost:8080 in desktop Chrome
```

The browser only needs `game/index.html` and the files under `game/`; there is no build step. To reproduce the hand-in output:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Controls: W/S or Up/Down pitch, A/D or Left/Right roll, Q/E rudder, Shift boost, Ctrl airbrake, Space autocannons, F homing missile, C camera, M mute, Esc pause, R restart.

---

<sub>Entered on [make.fun](https://make.fun/?ref=seezrr&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
