# BellSync Display Web

A local-first, dependency-free classroom Display client. It runs entirely in a current browser with JavaScript enabled: no account, API, Node package, or backend is required.

## Run locally

```sh
cd BellSyncWebDisplay
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080). Serving through HTTP is required because the WMHS built-in resource files are loaded with `fetch`.

## Set up a browser schedule

Choose **Enter My Schedule** on the first screen to create a browser-local school schedule. It starts with editable example bell-time rows, so teachers do not begin with a blank page:

1. Name the school and set its IANA time zone.
2. Choose Same Every Day, Day 1–5, Day 1–6, Day 1–7, A/B, A–G, or a custom comma-separated rotation.
3. Add, rename, reorder, or remove periods and set their bell times.
4. Enter personal class names and rooms separately for every rotation day.
5. Set a rotation seed date/day and mark no-school dates. Rotation advances only across weekdays that are not marked no-school.
6. Save. The live classroom Display opens immediately.

**Edit Schedule** returns to the same teacher-friendly working-copy editor. Cancelling leaves the active local schedule unchanged; saving validates and atomically replaces it. The browser stores the saved configuration in `localStorage`, so reopening the page returns to the Display.

## Upload, import, and export

**Upload My Schedule** is shown honestly as coming soon. Browser-only PDF/photo recognition would require a local PDF renderer and OCR implementation or a processing service; neither has been added to this dependency-free client.


- **Import from BellSync** is the quickest option for teachers already using BellSync on their phone. It imports a `.bellsync` v1 *WMHS* personal schedule and combines it with the bundled public WMHS calendar and bell data.
- **Export Display Schedule** downloads a browser-native `.bellsyncdisplay` JSON backup. It includes the browser school structure, rotation/calendar settings, personal assignments, and display preferences.
- **Import Display Schedule** restores a `.bellsyncdisplay` backup on another browser/computer after validating the configuration.

The browser-native format is intentionally separate from `.bellsync`; it does not redefine the native BellSync sharing format. GMS and custom-school `.bellsync` files lack the school-owned definitions needed by this static browser client, so they are not claimed as supported by the native import path.

## Display settings

**Display Settings** keeps classroom presentation preferences separate from schedule editing:

- accent color
- 12/24-hour clock
- show/hide rooms
- show/hide Today’s Schedule
- show/hide school name
- compact, standard, or large display size

All preferences are local to this browser.

## Demo

**Try Demo** loads a development/testing schedule into the current page. It is never written to local storage unless you explicitly save it through **Edit Schedule**.

## Deploy to GitHub Pages

There is no build step. This folder is ready to publish as a static site: it uses only relative paths, browser `localStorage`, and bundled JSON resources. The included `.nojekyll` file keeps GitHub Pages from applying Jekyll processing.

1. Put `BellSyncWebDisplay/` in a GitHub repository.
2. In **Settings → Pages**, publish from the branch/folder that contains this `index.html`.
3. Open the GitHub Pages URL, including its repository subpath when applicable, such as `https://username.github.io/BellSyncWebDisplay/`.

A custom domain can be configured later in GitHub Pages after DNS is prepared. No server configuration, secret, API key, or machine-specific path is required.

Before publishing, test locally:

```sh
cd BellSyncWebDisplay
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080). Serving through HTTP is required because the bundled WMHS resources are loaded with `fetch`.
