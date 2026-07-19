# Tarkov Questing Companion

A simple desktop quest tracker for Escape from Tarkov. Tracks your **PvP and
PvE** quest progress — automatically from the game's own logs, or by hand — with
**Kappa** and **Lightkeeper** filters, prerequisite locking, and per-map / per-
trader browsing.

## Download

Grab the latest build from the **[Releases page](../../releases/latest)**, unzip
it anywhere, and run the `.exe` inside. No installer, nothing to set up.

> The app is unsigned, so the first time you run it Windows may show a blue
> "Windows protected your PC" screen. Click **More info → Run anyway**. This is
> normal for small indie apps without a (costly) code-signing certificate.

## Use

- **PvP / PvE toggle** (top-right of the title bar) switches between your two
  Tarkov profiles. Each mode has its own quest list and its own tracked
  progress; automatic tracking reads the game logs and files each completion
  under the mode it was earned in. The app opens on whichever mode your
  progress is in.
- **ALL / KAPPA / LIGHTKEEPER** tabs at the top filter the quest list to what's
  required for the Kappa container or the Lightkeeper.
- Click a **map** to expand it and see its picture; click a **trader** under it
  to see their quests (the trader portrait fades into the map picture).
- Click a **quest** to see its objectives and requirements (level, prerequisite
  quests, keys, items to hand in).
- Tick the **circle** next to a quest to mark it completed — it gets crossed
  out and faded.
- **Quest map** — maps that have one show a small **▣** button next to their
  name. It opens the map with a pin on every objective of your *unfinished*
  quests there, respecting the current tab filter. Click a pin and the quest and
  objective appear beside it; click it again to dismiss. Switch **floors** to see
  objectives inside multi-storey buildings like Dorms.
  Available for **Ground Zero, Factory, Customs, Woods, Shoreline, Interchange,
  Reserve, Streets of Tarkov and Lighthouse** — every map the artwork project
  covers. The Lab and The Labyrinth have no map artwork yet, so no button.
- **Settings → Display** has two toggles: *Hide completed quests* and *Hide
  locked quests*. With both on, the list shows only the quests you can take on
  right now (hiding locked ones needs automatic tracking). Maps and traders
  with nothing left to show disappear too; the x/y counters keep counting
  everything.

## Settings

- **MANUAL** (default): you tick quests yourself.
- **AUTOMATIC**: the app reads the EFT log files and marks quests as completed
  by itself — including quests you finished while the app was closed, as far
  back as your log files go. The game's install folder is found automatically
  (default `C:\Battlestate Games\EFT\Logs`, or via the registry if you
  installed elsewhere); you can also set the logs folder by hand.
  In this mode, quests whose prerequisite quests you haven't finished yet sink
  to the bottom of their list, faded, with a yellow **LOCKED** tag and a
  yellow **!** in the tick box — so you always see what you can actually take.
  A locked quest's details show the missing prerequisites in yellow.
- **RESET ALL PROGRESS**: clears every tick for the current mode. After a reset,
  automatic tracking only imports quests completed *after* the reset — use this
  after a wipe.
- **RE-SCAN ALL LOGS**: the inverse of a reset — re-reads your whole Tarkov log
  history and re-imports every completed quest it can still find, sorted by
  mode. Use it to undo a reset, or if a completed quest is missing. It only adds
  completions (your manual ticks are kept) and can only find quests still
  present in your logs; completions Tarkov has already deleted from its logs
  must be ticked by hand.
- **UPDATES**: the app checks GitHub for a newer release on launch. When one is
  available, **Settings → Updates** shows a *Download & Install* button — it
  downloads the new version and swaps it in when you restart. Your progress is
  never touched (it lives in `%APPDATA%`, not the app folder).

## Build from source

Requires [Node.js](https://nodejs.org). From the project folder:

```sh
npm install          # restore dependencies
npm start            # run in development
```

To produce a distributable Windows folder like the one on the Releases page:

```sh
npx electron-packager . --platform=win32 --arch=x64 --asar --overwrite --out dist
```

## Data & storage

Quest data comes from the free [tarkov.dev](https://tarkov.dev) API, fetched per
game mode (~510 PvP / ~506 PvE quests — the lists differ slightly). It's cached
in `quests_cache.json` so the app also works offline; use **Settings → Refresh**
after a game patch.

Your settings and progress are stored in your per-user data folder
(`%APPDATA%\Tarkov Questing Companion` on Windows), **not** in the app folder — so
updating or re-downloading the app never touches your progress.

## Credits

This app is a thin shell around other people's work. It would not exist without
any of the following, and the same list is in the app under **Settings → Credits**.

| What | Who | Licence |
|---|---|---|
| Quest data, map geometry, floor extents and landmark names | [tarkov.dev](https://tarkov.dev) by [the-hideout](https://github.com/the-hideout/tarkov-dev) | MIT |
| Map artwork — *Escape from Tarkov SVG Maps Project* | **Shebuka** — [tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| Bender typeface | [Jovanny Lemonad](https://www.behance.net/jovanny) | [SIL Open Font License 1.1](bender/Bender/FREE%20FONT%20LICENSE.txt) |
| Application framework | [Electron](https://www.electronjs.org) | MIT |
| Escape from Tarkov, trader portraits, location screenshots | [Battlestate Games](https://www.escapefromtarkov.com) | all rights reserved |

Full licence texts — including tarkov.dev's MIT notice — are in
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), which also ships inside the app.

**On the map artwork.** The SVGs are bundled **unmodified** and credited in the
map footer, in Settings, and here — as CC BY-NC-SA 4.0 requires. This app is free
and non-commercial, and it is a quest tracker: it draws quest objectives from
public quest data onto a static map, exactly as tarkov.dev's own map pages do. It
reads no game memory, renders nothing in-game, and knows nothing about live raids,
so it is not the "radar / ESP / cheat client" category the maps project explicitly
forbids. If Shebuka or the-hideout would prefer it not ship this artwork, open an
issue and it comes out.

**On the trader portraits and location screenshots.** These are Battlestate
Games' artwork, used here for identification in a free fan tool. Unofficial, not
affiliated with or endorsed by Battlestate Games. Same offer: a takedown request
gets acted on, not argued with.

Thank you to everyone above.
