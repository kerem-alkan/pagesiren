# Contributing

Thanks for looking. Bug reports with a page that misbehaves are the most useful thing you can send: a false alarm, or a change it missed.

## Setting up

```bash
git clone https://github.com/kerem-alkan/pagesiren
cd pagesiren
node app/pagesiren.js
npm test
```

There are no dependencies and no build step. Node 22 or newer. The full tests need Chrome, Edge or Brave. `npm run test:core` needs neither.

## A note on the code

PageSiren started as a private project in Turkish. Comments and everything users see are now in English, but **identifiers and most test labels are still Turkish**. Pull requests that rename things a little at a time are welcome. A short glossary:

| Turkish | English | Turkish | English |
|---|---|---|---|
| `izleme`, `iz` | watch | `oku`, `okuyucu` | read, reader |
| `taban` | baseline | `sekme` | tab |
| `bekleyen` | pending | `tarayici` | browser |
| `alarmSuz` | filter alarms | `yardimci` | helper |
| `olumsuz` | negative text ("sold out") | `eklenti` | extension |
| `satis` | sale | `depo` | store |
| `isinma` | warm-up | `ayarlar` | settings |
| `yoksay` | ignore list | `gunluk` | log |
| `sorun` | problem | `dil` | language |
| `ozet` | summary | `nobet` | re-arm |

## Rules for changes

- **Don't add ways around protection.** No captcha solving, no fingerprint or User-Agent tricks, no hiding `navigator.webdriver`, no replaying tokens. PageSiren doesn't buy, log in, fill in forms or hold seats. Pull requests that add these won't be merged.
- **Every false alarm or miss becomes a test.** Put a short version of the page in `test/background.test.js`.
- **Never lose a real change to avoid a false alarm.** When a new filter might also hide something for sale, keep the item.
- **A dead watch must never look alive.** Problems stay visible.
- **No dependencies** without a very good reason.
- **Nothing in the tests may open a window or leave 127.0.0.1.**

## Adding a language

Open `extension/i18n.js`, copy the `TR` block, translate the values, and add it to `SOZLUK` and to the language list in `extension/dashboard.html`. `test/unit.test.js` checks that every text has a Turkish version; it's easy to extend to yours. The helper's window has its own few strings in `windows-helper/PageSirenAlarm.cs` (`Y("English", "Türkçe")`).

To teach it "sold out" in a new language, add the words to `OLUMSUZ` in `extension/background.js` and `DURUM_SOZ` in `extension/engine.js`, with a test.

## Regenerating the pictures

`node tools/make-assets.js` makes the icon and the siren sound. `node tools/make-demo.js` records `docs/demo.gif` with the real program and a fake local shop. Nothing opens on screen.
