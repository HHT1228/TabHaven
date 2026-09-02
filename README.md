# TabHaven

A beautiful, feature-rich **new tab page** for Chromium browsers (Microsoft Edge / Google Chrome). It replaces the blank new tab with a personal dashboard: random wallpapers from a local folder or a smooth **Fluid Color** gradient, a centered clock & greeting, live weather with sunrise/sunset, a TODO list, and a **Personal OA** work-hours tracker.

Everything is stored locally in your browser (IndexedDB) — no accounts, no telemetry, and your images never leave your machine.

---

## ✨ Features

### Background
- 🖼️ **Folder mode** — pick a local image folder once; every new tab shows a random image, filling the screen with center cropping (`object-fit: cover`).
- 🌈 **Fluid Color mode** — a smooth, slowly animating gradient in random colors. No folder needed.
- Switch between the two modes anytime from Settings.
- Fast startup thanks to a cached image index and a cached thumbnail placeholder (no black flash).

### Widgets
- 🕐 **Clock** — 24-hour time, date (English, with GMT offset), and a personalized greeting ("Good morning, {name}!") that changes at noon.
- 🌤️ **Weather** — current conditions and today's hourly forecast (English), based on your **device** location (not IP), via [WeatherAPI.com](https://www.weatherapi.com/).
- 🌅 **Sunrise / Sunset** — "Sunset in X hours" or "Sunrise in X hours" with the exact time.
- 🧮 **Personal OA** — a daily work-hours tracker: enter Arrive/Leave, press **Sign-off**, and it accumulates Daily & Weekly hours (Monday-based week). Lunch (12:00–13:00), pre-08:00, and post-21:30 time are handled automatically.
- ✅ **TODO list** — frosted-glass panel; add, edit, check off (strikethrough), drag to reorder, delete, and clear all completed items in one click. Persisted.
- 👁️ **Hide UI** — hide all widgets for a clean wallpaper; one click brings everything back.

### Design & privacy
- Frosted-glass (backdrop-blur) panels with rounded corners.
- All data (TODO, OA records, settings, caches) lives in IndexedDB and persists across sessions.
- No servers, no tracking. The only network calls are to WeatherAPI.com for weather.

---

## 🚀 Installation

> Requires a Chromium-based browser (Microsoft Edge or Google Chrome).

1. Download or clone this repository.
2. Open `edge://extensions` (Edge) or `chrome://extensions` (Chrome).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Open a new tab — you'll be asked for your name, then to **Choose Background**.

---

## 📖 Usage

### First launch
- Enter your **name** — it appears in the greeting ("Good morning, {name}!").
- **Choose Folder** → enter folder mode and pick a local image folder.
- **Fluid Color** → enter the animated gradient mode (no folder required).

### Everyday
- Open a new tab for a fresh random wallpaper (folder mode) or a new gradient (Fluid mode).
- Press `⏭` (bottom-left) or the keyboard shortcut `R` to randomize the background.
- Press `⚙` to open **Settings**:
  - Change your **name** (also shown in the greeting).
  - Switch between **Folder** and **Fluid Color**.
  - (Folder mode) change folder, include subfolders, show filename.
- Click the greeting to quickly open Settings and edit your name.
- In the TODO list, click `+` to add an item and `⌧` to clear all completed items.
- Press `⛶` to hide/show all widgets for a clean view.

### Personal OA (work-hours tracker)
1. Enter your **Arrive** and **Leave** times.
2. Click **Sign-off** to commit the day — the button changes to **Signed ✓**.
3. **Daily Hours** shows today's total; **Weekly Hours** is the running total for the current week (Monday → Sunday), counting only signed-off days.
4. Use **Clear Today** / **Clear Week** to fix mistakes or skip holidays (both ask for confirmation).

   Time rules:
   - Before **08:00** is ignored.
   - The **12:00–13:00** lunch break is deducted (up to 1 hour).
   - After **21:30** is ignored.

### Weather setup
- On first use, the browser asks for location permission. It uses **device/OS location** (not IP), so it stays accurate even behind a proxy or VPN.
- Weather data needs a free [WeatherAPI.com](https://www.weatherapi.com/signup.aspx) key:
  1. Register and copy your API key.
  2. Copy `config.example.js` to `config.js` and paste your key there.
  3. Reload the extension.

> ⚠️ **Never commit a real API key.** Put it in `config.js`, which is gitignored. `config.example.js` (tracked) only contains a placeholder. If a key was ever committed, reset it in the WeatherAPI dashboard.

---

## 🧠 How it works / notes

- Built on **Manifest V3** with plain HTML/CSS/JS — no build step, no framework.
- Folder access uses the browser's **File System Access API** (`showDirectoryPicker`); the folder handle and image index are cached in IndexedDB, so the folder is only picked once.
- Weather and location are cached (15 min / 60 min) and refreshed in the background.
- On some older Chromium versions the folder read permission may require a one-click re-authorization after a browser restart; recent versions persist it automatically.
- Images are rendered with `object-fit: cover; object-position: center` so the short edge fills the viewport and the long edge is cropped off-screen.

---

## 📁 Project structure

```
tabhaven/
├── manifest.json         # Manifest V3, new-tab override
├── newtab.html           # Page markup & widget panels
├── newtab.css            # Styles (frosted glass, layout)
├── newtab.js             # All logic (background modes, widgets, persistence)
└── config.example.js     # Template for your local WeatherAPI key (copy to config.js)
```

---

## 🛠️ Customizing

- Colors / design tokens are in `newtab.css` (`:root`).
- Background behavior, cache TTLs, and OA rules are constants near the top of `newtab.js` (e.g. `IMAGE_CACHE_TTL_MS`, `OA_WORK_START`, `OA_WORK_END`).

Contributions, issues, and pull requests are welcome.

---

## 📄 License

Choose a license (e.g. MIT) and add a `LICENSE` file.
