# Date Range Picker — a Tableau dashboard extension

A side-by-side two-month calendar for choosing a start and end date, in the
style of a flight-booking date picker, that applies the range to a Tableau date
filter or to a pair of date parameters.

It exists to fix one specific defect: an end date of 24 September returning rows
from 25 September.

---

## Root cause of the "end date pulls in the next day" bug

The Tableau Extensions API interprets the `Date` objects passed to
`applyRangeFilterAsync` and `Parameter.changeValueAsync` **as UTC**. Tableau's
own guidance is explicit: "For applying date filters, UTC Date objects are
expected (that is, `var min = new Date(Date.UTC(1999, 0, 1))`). Additionally,
date values are in UTC."
([Worksheet reference](https://tableau.github.io/extensions-api/api/interfaces/worksheet.html),
[Parameter reference](https://tableau.github.io/extensions-api/api/interfaces/Parameter.html))

A picker written the obvious way does two things that combine badly:

1. It builds the clicked day as a local-time `Date`: `new Date(2026, 8, 24)`.
2. It pads the end date so the last day is inclusive: `setHours(23, 59, 59)`.

In America/Chicago (UTC−05:00) that produces the instant
`2026-09-25T04:59:59.999Z`. In UTC terms the upper bound is already on
**25 September**, so every row stamped between midnight and 05:00 on the 25th
falls inside the filter. The further west the viewer sits, the more of the next
day leaks in; viewers east of Greenwich see the opposite symptom, where the
range loses the first hours of the start date.

Open [`tests.html`](tests.html) in a browser and the callout at the top prints
the exact instant a naive picker would send **from your own machine**, next to
the instant this extension sends.

### What this extension does instead

A day the user clicked is carried as a plain calendar day, `{ y, m, d }`, right
up to the moment it is handed to Tableau. There is exactly one conversion to
`Date`, in `DRP.date.boundsFor()` in [`js/dateutil.js`](js/dateutil.js), and it
uses `Date.UTC`, which is immune to the host timezone. No file in this project
calls `new Date(y, m, d)` or `setHours()`.

The upper bound then follows the field's data type, read from
`Field.dataType` ([Field reference](https://tableau.github.io/extensions-api/api/interfaces/Field.html)):

| Tableau data type | `max` that is sent | Why |
| --- | --- | --- |
| `date` | `2026-09-24T00:00:00.000Z` | Values carry no time part, so the end day is included and nothing after it can match. |
| `date-time` | `2026-09-24T23:59:59.999Z` | Covers every timestamp on the end day and stops one millisecond short of the next day. |

Either way, `2026-09-25T00:00:00Z` is outside the bound. The following day
cannot appear.

The **End date boundary** section of the configure dialog spells this out with a
worked example, and the optional diagnostics strip on the extension itself shows
the `min` and `max` that were sent alongside the values read back out of Tableau
with `getFiltersAsync`, so the behaviour can be confirmed without opening the
data.

---

## What is in the folder

| Path | Purpose |
| --- | --- |
| `daterangepicker.trex` | The manifest you drag into a dashboard. **Edit `<url>` before deploying.** |
| `index.html` | The extension surface. |
| `configure.html` | The settings dialog, reached from the extension's *Configure…* menu. |
| `js/dateutil.js` | Calendar-day arithmetic and the UTC boundary construction. |
| `js/presets.js` | Named relative ranges (Last 30 days, This quarter, and so on). |
| `js/calendar.js` | The dual-month range calendar widget. No dependencies. |
| `js/tableau-bridge.js` | Every call into the Extensions API, isolated in one file. |
| `js/main.js` | Controller for the extension surface. |
| `js/configure.js` | Controller for the settings dialog. |
| `css/styles.css` | Shared stylesheet. |
| `demo.html` | The same UI with the API stubbed out, for reviewing the interaction without Tableau. |
| `tests.html` | 51 assertions covering the date arithmetic and the boundary rules. |
| `serve.ps1` | A dependency-free static file server for local development. |
| `lib/` | Drop `tableau.extensions.1.latest.js` here. |

There is no build step. The files are plain ES5-compatible JavaScript and are
served as-is.

---

## Setup

### 1. Install the Extensions API library

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.js" -OutFile "lib\tableau.extensions.1.latest.js"
```

The library belongs to Tableau and is not redistributed here. Source:
<https://github.com/tableau/extensions-api>

### 2. Serve the folder

Tableau will not load an extension from a `file://` path, so the folder has to
be served over HTTP even during development.

```
.\serve.cmd
```

That publishes `http://localhost:8765/index.html`, which matches the `<url>`
already set in `daterangepicker.trex`.

`serve.cmd` is a launcher for `serve.ps1`. It exists because this machine sets
its PowerShell execution policy to `AllSigned` at LocalMachine scope, which
refuses unsigned `.ps1` files with *"is not digitally signed"*. The launcher
passes `-ExecutionPolicy Bypass`, which applies to that one process only and
changes nothing on the machine. To run the script directly instead:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\serve.ps1"
```

Both Group Policy scopes are `Undefined` here, so the restriction is a local
setting rather than a domain policy. Should you prefer a lasting change for
your own account, `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` takes
precedence over the LocalMachine value and needs no administrator rights —
though it then applies to every script you run, so signing `serve.ps1` or
hosting the extension properly are the tidier answers.

If the listener reports *Access is denied*, run the launcher from an elevated
window once, or reserve the URL:

```powershell
netsh http add urlacl url=http://localhost:8765/ user=$env:USERDOMAIN\$env:USERNAME
```

Any static host works equally well — IIS, nginx, an S3 bucket, GitHub Pages, or
`npx http-server -p 8765` if Node is installed.

> **`serve.ps1` is for development only.** A Tableau extension is a web page
> that Tableau fetches over HTTP every time the dashboard opens, so whatever
> serves it must be reachable at that moment. With `serve.ps1` that means the
> script has to be running, on your machine, for as long as the dashboard is
> open — and `http://localhost:8765` resolves to each viewer's own machine, so
> nobody else can load it. See **Hosting** below for the shared-host options.

### 3. Add it to a dashboard

1. In Tableau Desktop, drag an **Extension** object onto the dashboard.
2. Choose **Access Local Extensions** and open `daterangepicker.trex`.
3. Allow the extension when prompted. It requests **full data** access, which it
   uses only to read field names and data types so it can pick the correct end
   boundary.
4. Open the extension's menu and choose **Configure…**.
5. Pick the date field, then save.

### 4. Deploy

* Change `<url>` in `daterangepicker.trex` to the hosted address. Outside
  `localhost`, Tableau requires **HTTPS**.
* Bump `extension-version` whenever you publish a change. Tableau caches on the
  combination of `id`, `extension-version` and `url`.
* Change `id` from `com.aad.extensions.daterangepicker` if you fork this into a
  second extension, so both can coexist in one workbook.
* On Tableau Server or Tableau Cloud, an administrator must add the hosting URL
  to the extension safe list before the extension will load for other users.
  ([Manage Dashboard and Viz Extensions](https://help.tableau.com/current/online/en-us/dashboard_extensions_server.htm))

---

## Hosting

The extension's HTML, CSS and JavaScript are fetched from `<url>` each time a
dashboard containing the extension is opened. The host therefore needs to be up
whenever anyone views the dashboard, and it needs to be reachable from every
viewer's machine.

This Dropbox folder is the source of truth for the code. It is not a web host:
Dropbox shared links redirect and serve HTML as a download, which Tableau will
refuse. Publish the files from here to one of the following.

| Option | Fits when | Notes |
| --- | --- | --- |
| **IIS site on an internal server** | Tableau Server is already on-premises | Point a site or virtual directory at a copy of this folder. Use an internal certificate so the URL is HTTPS. Static content only; no application pool configuration is needed beyond enabling static file serving. |
| **Azure Static Web Apps / Azure Blob static website** | Tableau Cloud, or viewers off the corporate network | HTTPS and a certificate come included. Deployment is a file upload. |
| **Existing internal web server** | The organization already runs one for internal tools | The lightest option. The extension is static files with no server-side requirement. |
| **`serve.ps1` on localhost** | One person, developing or evaluating | Runs only while the script is running, and only for the machine running it. |

Whichever host you choose:

1. Copy every file except `serve.ps1`, `demo.html`, `tests.html` and `assets/`
   to the host. Those four are development aids and do not need to be published.
2. Set `<url>` in `daterangepicker.trex` to
   `https://your-host/path/index.html`. Tableau requires HTTPS for anything
   other than `localhost`.
3. Have a Tableau administrator add the host to the extension safe list on
   Tableau Server or Tableau Cloud.
4. Redistribute the updated `.trex` to whoever builds dashboards with it.

A workbook embeds the manifest but not the code, so existing dashboards pick up
host-side code changes on their next load without being republished. Bumping
`extension-version` matters when you redistribute the `.trex` itself. Serve the
files with a short cache lifetime, or a `Cache-Control: no-cache` header, so an
update reaches viewers promptly; `serve.ps1` already sends `no-store`.

---

## Configuration reference

| Setting | Effect |
| --- | --- |
| **Apply the range to** | A worksheet date filter, two date parameters, or both. |
| **Date field** | The field passed to `applyRangeFilterAsync`. Only date and date & time fields are listed, each labelled with its data type. |
| **Worksheets** | Which sheets receive the filter. Select none for all of them. |
| **Start / End parameter** | Date parameters to write. Both receive the same instants the filter uses, so a calculation written against them agrees with the filter. |
| **End-bound rule** | `Automatic` follows the field's data type and is the right answer almost always. The two manual settings exist for fields whose type Tableau cannot report, such as one reached only through a published data source. |
| **Null dates** | Leaves Tableau's default alone, or sets `nullOption` to include or exclude null dates. |
| **Week starts on** | Sunday or Monday. |
| **Date display** | How dates are shown in the header and the two text boxes. Typed entry accepts this format, ISO, and month names regardless. |
| **Default range** | Used the first time the extension loads. After that it restores the last applied range from the workbook's saved settings. |
| **Earliest / Latest selectable** | Greys out days outside the window and clamps the presets to it. |
| **Accent colour** | Tints the selected range. |
| **Apply as soon as the end date is picked** | On by default. Turn it off to show an explicit **Apply** button. |
| **Show the quick ranges rail** | Hides the preset column to save horizontal space. |
| **Show the boundary diagnostics panel** | Shows the sent and read-back bounds. Useful while validating, worth turning off for end users. |

All settings live in the workbook through `tableau.extensions.settings`, so they
travel with the `.twb`/`.twbx` and do not need to be reapplied per viewer.

---

## Sizing the extension object

The layout measures its own zone and adapts:

* **Wider than 640 px** — two months side by side with the presets rail.
* **420 to 640 px** — two months, tighter spacing.
* **Under 420 px** — one month, presets rail hidden.

The six week rows are sized from the height actually available, so the last week
of the month is never clipped. A zone of roughly **660 × 400 px** shows
everything comfortably; **700 × 470 px** if you leave the diagnostics panel on.

---

## Keyboard and accessibility

Arrow keys move day by day, Up and Down move by week, Home and End jump to the
ends of the week, Page Up and Page Down move by month (add Shift for a year),
Enter or Space selects, and Escape abandons a half-finished selection. Day
buttons carry full dates in their `aria-label`, and the selected span is marked
with `aria-selected`.

---

## Known limits

* `applyRangeFilterAsync` replaces whatever filter exists on that field. A
  worksheet using a *relative date* or *discrete date* filter on the same field
  will be converted to a range filter the first time the extension applies.
* Hierarchical date filters (a drilled-down Year/Quarter/Month hierarchy) are
  not supported by `getFiltersAsync`, so the diagnostics read-back shows nothing
  for them. The filter itself still applies.
* Reading field data types needs the **full data** permission. If a viewer
  declines the permission prompt, the configure dialog lists no fields; the
  extension still works if the field name and end-bound rule were saved earlier.
* Parameter mode requires the parameters to already exist in the workbook with a
  date or date & time data type.

---

## Sources

* [Tableau Extension Manifest File](https://tableau.github.io/extensions-api/docs/dashext/trex_manifest/) — the `.trex` schema, HTTPS rule, and the `full data` permission.
* [Get Started with Dashboard Extensions](https://tableau.github.io/extensions-api/docs/dashext/trex_getstarted/) — library file name, `initializeAsync`, and local hosting.
* [Worksheet interface](https://tableau.github.io/extensions-api/api/interfaces/worksheet.html) — `applyRangeFilterAsync`, `clearFilterAsync`, `getFiltersAsync`, and the UTC requirement.
* [RangeFilterOptions interface](https://tableau.github.io/extensions-api/api/interfaces/RangeFilterOptions.html) — `min`, `max`, `nullOption`.
* [Field interface](https://tableau.github.io/extensions-api/api/interfaces/Field.html) — `dataType`, used to choose the end boundary.
* [Parameter interface](https://tableau.github.io/extensions-api/api/interfaces/Parameter.html) — `changeValueAsync` and its UTC expectation.
* [Update a date filter to a specific range](https://github.com/tableau/datadev-hackathon/wiki/Update-a-date-filter-to-a-specific-range) — Tableau's own worked example.
* [Manage Dashboard and Viz Extensions](https://help.tableau.com/current/online/en-us/dashboard_extensions_server.htm) — server and cloud safe list.
