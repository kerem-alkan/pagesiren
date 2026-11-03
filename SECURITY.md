# Security

## Reporting a problem

Please use GitHub's private reporting ("Report a vulnerability" on the Security tab of this repository), not a public issue. Tell me what you found and how to reproduce it. If you can't use that, write to contact@keremalkan.com.

## What PageSiren protects

- **It listens only on 127.0.0.1.** The dashboard API checks `Host`, which stops DNS rebinding, and `Origin`, so other web pages can't write to it. The Windows helper accepts no `Origin` except the extension.
- **Page text is treated as data.** The dashboard only uses `textContent`, so a watched page can't inject anything into it.
- **Notification tokens** stay in `notify.json` in the data folder. They are masked on screen and never logged.
- **No telemetry.** The only requests it makes are to the pages you add and the notification channels you set up.

## What you should protect

- **`profile/` in the data folder holds the cookies of the sites you logged in to** through PageSiren. Anyone who can read that folder could use those sessions. Never share it or put it in a backup you don't trust.
- **There's no login on the dashboard.** Anyone who can run programs as you on your computer can use it. Don't forward its port to a network.
- **The Chrome extension** has access to all sites, because reading any page you add requires it.
