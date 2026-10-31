# BeVigil status

Public status page for [BeVigil](https://www.bevigil.com.au), served by GitHub Pages and run entirely by GitHub Actions, outside BeVigil's own hosting so it stays up when BeVigil doesn't.

- `services.json`: what is checked (edit to add or remove a service).
- `check.mjs`: runs every 5 minutes (`.github/workflows/check.yml`), keeps 7 days of checks and 90 days of daily uptime in `data/`.
- Two failed checks in a row open an issue labelled `outage` (GitHub emails the repo owner); it closes itself when the service is back.
- `data/notice.json`: planned maintenance or incident notes shown at the top, e.g. `{"items":[{"title":"Planned maintenance","body":"Sunday 2am–3am AEST"}]}`.
