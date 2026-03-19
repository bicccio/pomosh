<div align="center">

```
█████  ███  █    █  ███  █████  █    █
█   █ █   █ █    █ █   █ █      █    █
█████ █   █ █ ██ █ █   █ █████  ██████
█     █   █ █    █ █   █     █  █    █
█      ███  █    █  ███  █████  █    █
```

**A minimal, beautiful Pomodoro timer for the terminal.**

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://apple.com/macos)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

</div>

---

## What it looks like

```
  █████  ███  █    █  ███  █████  █    █     ← gradient title
  █   █ █   █ █    █ █   █ █      █    █
  █████ █   █ █ ██ █ █   █ █████  ██████
  █     █   █ █    █ █   █     █  █    █
  █      ███  █    █  ███  █████  █    █
  ────────────────────────────────────────────────────────────

    What would you like to do?

    ❯ Start a new pomodoro
      View today's pomodoros
      Settings
      Exit

    [↑↓] navigate   [enter] select   [q] quit
```

---

## Features

- **Fullscreen TUI** — clean ANSI interface, no clutter
- **Task history** — navigate previous task names with `↑ ↓`
- **Automatic breaks** — short break every pomodoro, long break every 4th
- **Progress bar** — visual countdown with a live fill bar
- **macOS notifications** — via `terminal-notifier` or `osascript` fallback
- **15 notification sounds** — preview them live in the settings screen
- **Persistent log** — every session saved as JSONL, queryable from the CLI
- **Zero config needed** — sane defaults, everything adjustable in-app

---

## Install

```bash
git clone https://github.com/bicccio/pomosh.git
cd pomosh
npm install && npm run build
npm link          # makes `pomosh` available system-wide
```

For richer notifications (optional):

```bash
brew install terminal-notifier
```

---

## Usage

```bash
pomosh                        # open the interactive menu
pomosh "fix the login bug"    # skip the menu, start immediately
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-l` | List today's pomodoros |
| `-L <YYYYMMDD>` | List pomodoros for a specific date |
| `-d <file>` | Use a custom config file |
| `-g <dir>` | Use a custom log directory |

---

## Controls

**Menu & input**

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate / browse task history |
| `Enter` | Confirm |
| `Esc` `q` | Back / quit |

**During a pomodoro**

| Key | Action |
|-----|--------|
| `q` `Esc` | Interrupt |
| `y` / `n` | Cancel or resume after interrupt |

**After a pomodoro**

| Key | Action |
|-----|--------|
| `b` | Take a break |
| `Enter` | Start next pomodoro immediately |
| `m` | Back to menu |
| `q` | Quit |

---

## Settings

Accessible from the main menu. Changes are saved automatically to `~/.pomosh/pomosh.cfg`.

| Setting | Default | Description |
|---------|---------|-------------|
| Pomodoro | 25 min | Work session duration |
| Short break | 5 min | Break after each pomodoro |
| Long break | 15 min | Break after every 4th pomodoro |
| Notifications | on | System notifications on completion |
| Sound | default | Notification sound (15 options, live preview) |

---

## Log

Every completed pomodoro is appended to `~/.pomosh/pomos/pomosh.jsonl`:

```json
{"date":"2026-03-19","time":"10:30","duration_min":25,"task":"fix the login bug"}
```

Query it directly:

```bash
pomosh -l               # today
pomosh -L 20260315      # specific date
```

---

## Development

```bash
npm run dev     # run with tsx (no build step needed)
npm run build   # compile to dist/
```
