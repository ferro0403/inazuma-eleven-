# Inazuma Eleven Player Codex extractor and browser

This project contains:

- a local Chromium-based extractor for **all pages** of the English [Inazuma Eleven Player Codex](https://zukan.inazuma.jp/en/chara_list/);
- `data/players.js`, which the extractor expands automatically across repeated runs;
- `data/teams.js`, the generated team seed loaded by the browser;
- a static browser with player portraits, filters, and a persistent Team Manager.

The repository includes three sample records so the browser works immediately after download. Portraits are displayed directly from each record's `imageUrl`; image files are never downloaded into this project.

## Windows setup (step by step)

### 1. Install Python

1. Download Python 3.11 or newer from <https://www.python.org/downloads/windows/>.
2. Start the installer.
3. Check **Add python.exe to PATH**.
4. Select **Install Now**.
5. Open a new **PowerShell** window and confirm the installation:

```powershell
py --version
```

### 2. Download this project

Either clone the repository with Git or download and extract its ZIP file. In PowerShell, move into the project directory. For example:

```powershell
cd "$HOME\Downloads\inazuma-eleven"
```

All following commands must be run from the directory containing this `README.md`.

### 3. Create a virtual environment

```powershell
py -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

After activation, PowerShell displays `(.venv)` at the beginning of the prompt.

### 4. Install the extractor and Chromium

```powershell
py -m pip install --upgrade pip
py -m pip install -r requirements.txt
py -m playwright install chromium
```

`requirements.txt` installs Playwright. The second Playwright command installs the matching local Chromium build used to open the Codex like a normal browser. It does not install a browser extension or change your normal browser.

### 5. Extract the complete Codex

Start with visible-browser mode because it lets you complete any verification screen presented by the website:

```powershell
py scripts\extract_players.py --headed
```

The script will:

1. open the English character list in Chromium;
2. discover the last available pagination page;
3. process every page in order;
4. extract `id`, `name`, `nickname`, `game`, `gender`, `element`, `position`, `characterRole`, `ageGroup`, `schoolYear`, `teams`, `description`, and `imageUrl`;
5. verify that every player has a portrait URL taken from that player's own result row;
6. load the existing `data\players.js` dataset and merge records by player ID;
7. retain every existing player, union team memberships, and update fields only
   when the extracted record contains a non-empty value;
8. atomically save the growing merged dataset only after extraction succeeds.

The terminal prints progress similar to:

```text
Page 1/110: 50 records (50 unique)
Page 2/110: 50 records (100 unique)
...
Existing players count: 3
Newly extracted players count: 5457
Duplicate players skipped: 3
Final total players count: 5457
Complete: wrote 5457 players to data\players.js
```

The exact page and player counts may change as the official Codex is updated.

After one successful headed run, the saved `.playwright-profile` usually allows future runs without showing Chromium:

```powershell
py scripts\extract_players.py
```

If the site displays a verification page or the script reports that the character table did not load, run `--headed` again and complete the verification in the opened Chromium window. The sample/full existing `data\players.js` is left untouched whenever extraction fails or is cancelled.

### Extract a filtered Codex URL

Apply the filters you want on the official Codex website, then copy the complete
URL from your browser's address bar. Pass that exact URL in quotes:

```powershell
py scripts\extract_players.py --headed --url "PASTE_FILTERED_URL_HERE"
```

For example:

```powershell
py scripts\extract_players.py --headed --url "https://zukan.inazuma.jp/en/chara_list/?position=GK&element=Mountain"
```

Filtered URLs can be very long. Keep the complete URL inside double quotes so
PowerShell does not interpret `&` or other query-string characters. The
extractor opens that exact URL first, preserves all active filter parameters
while changing pages, discovers pagination from the filtered results, and
merges the matching players into `data\players.js`.

The database is cumulative: run the extractor with several different filtered
URLs and players from earlier runs remain available. Player IDs are the unique
keys. A repeated player updates populated fields from the latest extraction,
blank values never erase existing information, and team lists are combined
without duplicates.

The existing count, extracted count, duplicate count, and final total are
printed in the terminal. If the filtered URL produces zero players, the command
exits with an error and leaves the existing `data\players.js` unchanged.

### 6. Open the player browser

Start a local web server:

```powershell
py -m http.server 8000
```

Open <http://localhost:8000> in your browser. Stop the server later with **Ctrl+C**.

The page displays each portrait directly from `imageUrl` and provides:

- search by player name or nickname;
- team filter;
- position filter;
- element filter;
- client-side result pagination.

## Team Manager

Open **Team Manager** from the navigation bar. Teams missing from
`data/teams.js` are generated automatically from the memberships in
`data/players.js`. Team aliases are resolved to their canonical team, so an
alias such as `Raimon GO` can be treated as `Raimon`.

The Team Manager supports:

- creating and renaming custom teams;
- setting a remote logo URL (logos are displayed directly and are not downloaded);
- editing aliases and notes;
- adding and removing players;
- moving a player to another team;
- selecting and merging multiple teams;
- deleting custom teams;
- exporting the current effective records as a new `teams.js` file.

Each public team record uses this format:

```javascript
{
  id: "raimon",
  name: "Raimon",
  logoUrl: "https://example.com/raimon.png",
  aliases: ["Raimon GO", "Raimon Junior High"],
  playerIds: [1, 2, 3],
  notes: ""
}
```

### Persistence and priority

`data/teams.js` is the checked-in/generated seed. Because a static browser
cannot directly rewrite files on your computer, manual edits are saved
persistently in the browser's localStorage. Those saved edits take priority
over automatic player-derived memberships on every page load. Removed players
stay removed, manually added players stay assigned, and new memberships from a
later `players.js` are still discovered.

Use **Export teams.js** in the Team Manager to download the current effective
team database when you want to replace the repository's `data/teams.js`.

Before a confirmed merge or custom-team deletion, the app stores an automatic
snapshot in localStorage. Up to 20 backups are retained under
`inazuma-team-manager-backups-v1`.

## Useful extractor options

```powershell
# Allow up to 120 seconds for each page
py scripts\extract_players.py --headed --timeout 120

# Use a different output file while testing
py scripts\extract_players.py --headed --output data\players-test.js

# Extract a copied filtered-results URL
py scripts\extract_players.py --headed --url "PASTE_FILTERED_URL_HERE"

# Reset the saved browser session if it becomes unusable
Remove-Item -Recurse -Force .playwright-profile
py scripts\extract_players.py --headed
```

Run `py scripts\extract_players.py --help` for every option.

## Data format

`data/players.js` assigns an array to `globalThis.INAZUMA_PLAYERS` so it can be loaded directly by a static page without a build step:

```javascript
globalThis.INAZUMA_PLAYERS = [
  {
    id: 1,
    name: "Mark Evans",
    nickname: "Mark",
    game: "Inazuma Eleven",
    gender: "Male",
    element: "Mountain",
    position: "GK",
    characterRole: "Player",
    ageGroup: "Middle School",
    schoolYear: "Second Year",
    teams: ["Raimon"],
    description: "...",
    imageUrl: "https://..."
  }
];
```

`imageUrl` is retained as an absolute remote URL. The extractor does not create an image directory and does not save portrait files.

## Tests

The parser tests do not require Chromium or internet access:

```powershell
py -m unittest discover -s tests -v
```

To verify JavaScript syntax when Node.js is installed:

```powershell
node --check app.js
node --check data\players.js
node --check data\teams.js
node tests\test_team_store.js
```
