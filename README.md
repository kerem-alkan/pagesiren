<p align="center">
  <img src="docs/logo.svg" width="96" alt="PageSiren logo">
</p>
<h1 align="center">PageSiren</h1>
<p align="center">
  <strong>A siren for web pages.</strong><br>
  Tell it which pages you care about. It stays quiet until something real changes, and then you can't miss it.
</p>
<p align="center">Created by <a href="https://github.com/kerem-alkan"><strong>Kerem Alkan</strong></a></p>
<p align="center">
  <a href="https://github.com/kerem-alkan/pagesiren/actions/workflows/ci.yml"><img alt="Tests" src="https://github.com/kerem-alkan/pagesiren/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-brightgreen">
  <img alt="Dependencies: 0" src="https://img.shields.io/badge/dependencies-0-brightgreen">
</p>
<p align="center"><a href="README.tr.md">Türkçe</a></p>

<p align="center">
  <img src="docs/demo.gif" width="760" alt="Adding a sold-out page to PageSiren; when the page changes, a red alarm window shows exactly what changed">
</p>

## Try it

You need [Node.js 22 or newer](https://nodejs.org) and Chrome, Edge or Brave.

```bash
npx github:kerem-alkan/pagesiren
```

The dashboard opens at `http://127.0.0.1:47431/`. Paste an address and press **Add**. That's all.

To keep it installed:

```bash
npm install -g github:kerem-alkan/pagesiren
```

Then start it any time with `pagesiren`. In **Settings** you can make it start when you log in.

## What people watch

Restocks and limited drops, tickets and resale, appointment slots, course seats, visa and government pages, job posts, "coming soon" pages: any page where you would otherwise keep pressing refresh.

## Why PageSiren

- **Few false alarms.** Cookie banners, login pop-ups, FAQ boxes, account names, rotating ads, "3 minutes ago" and plain counters are filtered out, and a change has to survive two reads in a row.
- **It knows which way a change goes.** New content, or a "sold out" that disappears, raises the alarm. Something selling out doesn't wake you up. It recognizes "sold out" in more than 15 languages. Want every change instead? Tick one box.
- **Pages behind a login work.** It reads with a real browser that keeps its own profile. Press **Open** on a watch, log in once, and later reads stay logged in. If the session drops, it tells you.
- **Hard to miss.** A blinking red window on top of everything, with a siren. If you want it on your phone too: Telegram, Discord, ntfy or any webhook.
- **Honest about what it can't see.** Bot check, login wall, unreadable page: the watch turns orange and says why. A stale watch never looks green. If reading stops altogether, the siren goes off about that too.
- **Local and free.** No account, no cloud, no telemetry, no limit on watches. Your pages, sessions and settings stay on your computer.
- **Light.** Zero dependencies. The program itself uses about 70 MB; its browser opens only while reading and closes when idle. Pages that don't need JavaScript can be read with no browser at all.

## What it will not do

PageSiren only tells you. It does not buy, add to a cart, log in for you, fill in forms or hold seats. It does not solve captchas or get around bot protection or queues: it shows itself as a normal browser, with no disguise, and when a site puts up a wall it backs off and asks you to look.

Please use sensible intervals and respect each site's terms. You are responsible for how you use it.

## Alarms and notifications

| | Windows | macOS, Linux |
|---|---|---|
| Alarm window | Red desktop window above everything | Red browser window |
| Sound | Yes | Yes |
| Phone (optional) | Telegram, Discord, ntfy, webhook | Telegram, Discord, ntfy, webhook |

On Windows the desktop window comes from a small helper. There is no binary in this repository: at first run it is built from [its source](windows-helper/PageSirenAlarm.cs) with the C# compiler that ships with Windows. If that fails, the browser window takes over.

Notifications are off until you fill them in under **Notifications** on the dashboard. Each channel has a test button.

**Platforms:** Windows is what this has been used on every day. macOS and Linux should work but are new and much less tested, so reports are very welcome.

## Options for each page

| Option | What it does |
|---|---|
| How often | From 30 seconds to 30 minutes. 5 minutes is a kind default. |
| Words | Alarm only if a change contains one of these words. "Sold out" going away always counts. |
| Alarm on every change | Turns off the direction rule. |
| Login check | Text you can only see when logged in. If it disappears, you get told once instead of watching a logged-out page. |
| Fast | Alarm on the first read when "sold out" goes away, for things that vanish in a minute. |
| Keep the tab open | For slow pages that only fill in after a while. |
| Who reads the page | Separate browser (default), plain HTTP (lightest), or your own Chrome through the extension. |

Other things on the dashboard: **Re-arm** makes a page's current state the new normal, **False alarm** teaches it to ignore that change, and **Export / Import** moves your list to another computer.

## Command line

```text
pagesiren [--port <n>] [--data <folder>] [--chrome <path>] [--lang <en|tr>] [--no-open] [--no-helper]
```

## Chrome extension (optional)

The `extension` folder also works by itself: go to `chrome://extensions`, turn on Developer mode, press **Load unpacked** and pick the folder. It then reads pages in your everyday Chrome, which helps with the few sites that only trust that browser. On Windows it can also work next to the program: choose *My Chrome extension* on a watch.

## Your data, and removing it

Everything lives in one folder. The browser profile in it holds your login cookies, so treat it as private.

| Windows | macOS | Linux |
|---|---|---|
| `%LOCALAPPDATA%\PageSiren` | `~/Library/Application Support/PageSiren` | `~/.local/share/pagesiren` |

To remove PageSiren: turn off *Start when I log in*, quit it (tray icon, or Ctrl+C), delete that folder, and run `npm uninstall -g pagesiren` if you installed it.

## Compared with other tools

PageSiren is a small desktop tool for one person. If you want a server, teams, a visual selector and many more integrations, use [changedetection.io](https://github.com/dgtlmoon/changedetection.io). If you like the command line and cron, look at [urlwatch](https://github.com/thp/urlwatch). Both are excellent.

## Development

```bash
npm test
```

No build step and no dependencies. See [how it works](docs/ARCHITECTURE.md) and [CONTRIBUTING](CONTRIBUTING.md). Security reports: [SECURITY](SECURITY.md).

Created and maintained by [Kerem Alkan](https://github.com/kerem-alkan), with heavy help from an AI assistant (Claude). It has been used every day on real pages. The tests are real; read the code and judge for yourself.

## Contact

Bugs and ideas: [issues](https://github.com/kerem-alkan/pagesiren/issues). Anything else: [contact@keremalkan.com](mailto:contact@keremalkan.com).

## License

[MIT](LICENSE) © 2026 Kerem Alkan. You can use, change and share it freely as long as the license and copyright notice stay with it.

Not affiliated with any website. Site names that appear in the tests are only there to reproduce real page behaviour.
