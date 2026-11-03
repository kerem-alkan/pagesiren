# How PageSiren works

## The pieces

```text
extension/background.js + engine.js   the brain: reading schedule, baselines, alarm rules (the same files run in Node and in Chrome)
app/pagesiren.js                      runs the brain in Node and provides the chrome.* calls it uses; serves the dashboard
app/browser.js                        a separate small Chrome, driven through the DevTools protocol, for reading pages
app/store.js                          chrome.storage.local as files
app/notify.js                         optional Telegram, Discord, ntfy, webhook
app/helper.js, autostart.js           builds the Windows helper; start at login
windows-helper/PageSirenAlarm.cs      red window on top of everything, tray icon, watchdog, supervisor
extension/dashboard.*, i18n.js        the screen, in the program and in the extension alike
```

The brain doesn't know where it runs. In the extension, `chrome.tabs` are real tabs. In the program, they are "virtual tabs": when an address arrives, a reader is chosen for that watch.

| Reader (`okuyucu`) | How the page is read |
|---|---|
| `''` (default) | A hidden tab in a separate Chrome with its own profile. The tab closes after the read; the browser closes when idle. |
| `'http'` | Plain HTTP, no browser. For pages whose information is in the raw HTML. A 403 or 429 sends the watch back to the browser reader for good. |
| `'eklenti'` | The extension in the user's own Chrome (Windows, through the helper). |

## One read, step by step

```text
tick (every 30 s) -> tekIzleme: is this watch due? open a tab or go to its address
tab finished loading -> okumaPlanla: wait a few seconds -> oku: take the page's HTML
  the page is still filling in? read again; within one page load only the last read counts
engine.represent(html) -> a multiset of keys
engine.turIsle -> first read: baseline. Later: compare -> confirm (seen in two reads in a row) -> update the baseline
background.alarmSuz -> direction rule, keyword filter, ignore list
alarmVer -> red window + sound, optional notifications, dashboard card
```

## The representation

A page becomes a multiset of keys, `"X|text"`. The difference between two reads is taken on these sets, so moving things around on a page is not a change.

| Key | Meaning |
|---|---|
| `L` `O` `B` `I` | Link address, option, button, form field |
| `A` `H` `S` `T` `P` | Link text, heading, list row, table row, paragraph |
| `D` | Short status text: *Sold out*, *Tükendi*, *Ausverkauft*… |
| `M` | An event from a site's JSON: `NAME (dd/mm) — SOLD OUT` |
| `Y` | Fallback lines for very small pages |
| `…\|soluk` | The same item, disabled |

Never represented: cookie and consent containers (cut out of the HTML entirely), FAQ blocks unless they hold something for sale, login and sign-up windows, account links and account names, UI buttons like *Show more*, relative times, address parts holding session ids, and lines where only a number changed.

Keys never depend on the interface language, so switching language doesn't look like a page change.

## When an alarm is raised

- **Two reads:** a change must be seen in two consecutive reads. *Fast* mode confirms in one read when a negative text goes away and something positive replaces it.
- **Warm-up:** the first read after the first baseline quietly completes the baseline, unless the difference looks like an opening. After a version update, only removals are absorbed.
- **Direction rule:** an opening means something new arrived or a negative text went away. Only removals, or negative-to-negative changes, are silent. *Alarm on every change* turns this off.
- **Coming back:** if what went away at the last alarm returns together with a negative text, that is a sell-out, not news.
- **Keyword filter:** cuts noise from side lists, but a negative text going away always passes.
- **Ignore list:** *False alarm* adds that change's keys, except buy signals and session or queue keys.

## Problems stay visible

| State | Dot | What happens |
|---|---|---|
| Bot check | Orange | No baseline is ever taken from it. Tried again at most every 15 minutes. Nothing is solved; the user presses **Open**. |
| Login wall | Orange | No baseline. One alarm after two reads. Watching continues by itself after login. |
| Waiting room | Orange | One alarm. The tab keeps its place in line and retries from time to time. |
| Not read for long | Gray | A watch that hasn't been read never looks green. |
| Page suddenly emptied | Orange | The baseline is kept. |
| No page read for 15 minutes | Red alarm | The program raises an alarm about itself. |
| Program silent for 5 minutes | Red alarm | The helper's watchdog does (Windows). It also restarts a stuck program. |

## Files in the data folder

| Path | Contents |
|---|---|
| `store/izlemeler.json` | The watch list (a last good copy is kept as `.yedek`) |
| `store/motor_<id>.json` | One watch's baseline and pending changes |
| `store/alarmlar.json`, `arsiv.json`, `ayarlar.json` | Last 50 alarms, deleted watches, settings |
| `profile/` | The reader browser's profile. **Contains your cookies.** |
| `alarm-profile/` | A separate profile for the browser alarm window |
| `notify.json` | Notification settings, owner-only where the system supports it |
| `helper/` | The built helper exe |
| `pagesiren.log` | Log, with no addresses or tokens from notifications |

## Local ports

| Port | Who | Notes |
|---|---|---|
| 47431 | Dashboard and its API | 127.0.0.1 only. Checks `Host` (DNS rebinding) and `Origin` (other web pages can't write). |
| 47430 | Windows helper | 127.0.0.1 only. Accepts no `Origin` other than the extension. |

## Tests

| File | What it covers |
|---|---|
| `test/unit.test.js` | Notifications against a local server, autostart files, every text has a translation |
| `test/background.test.js` | The brain with a fake `chrome`, page by page |
| `test/app.test.js` | The real program, real headless Chrome, a fake site and a fake helper |
| `test/helper.test.js` | The real helper exe in `--test` mode, with no window |

Nothing in the tests leaves 127.0.0.1 or opens a window on screen.
