# Place the Tableau Extensions API library here

This folder must contain `tableau.extensions.1.latest.js` before the extension
will run. The file is not bundled here because it belongs to Tableau and should
be taken from the version Tableau publishes.

Download it from the official repository:

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.js" -OutFile "lib\tableau.extensions.1.latest.js"
```

Or clone the repository and copy `lib/tableau.extensions.1.latest.js` out of it:
<https://github.com/tableau/extensions-api>

If your organization pins a specific API version, use the matching
`tableau.extensions.1.<n>.js` file instead and set `<min-api-version>` in
`daterangepicker.trex` to that version.

`demo.html` and `tests.html` do not need this file. They run without Tableau.
