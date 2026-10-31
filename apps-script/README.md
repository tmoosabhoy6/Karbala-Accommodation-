# Live sheet connector

The **Live** tab of Karbala Rooms shows the **ACCOMMODATION** tab of the accommodation Google sheet ("Krb Accomodation") and keeps itself up to date. Check-ins, check-outs and room changes are still made in the sheet. The site only reads it.

The sheet is an Excel (.xlsx) file stored in Google Drive and it is not public, so the site cannot read it directly. This folder holds a small Google Apps Script web app that reads the sheet under **your** Google account and passes the room calendar to the site. You set it up **once**. After that, nobody has to sign in, on any device.

## Set it up (about 5 minutes, once)

Use a Google account that can open the sheet (for example the one that already edits it).

1. Go to **[script.google.com](https://script.google.com/home/projects/create)**. A new, empty project opens.
2. Click **Untitled project** at the top and name it `Karbala Rooms live`.
3. Delete everything in the editor, then paste in all of [`Code.gs`](Code.gs) (open it on GitHub and use the **Copy raw file** button). Press **Ctrl+S** / **⌘S** to save.
4. *Optional, but it means the script can only **read** your Drive:* click the **⚙ Project Settings** gear on the left, tick **Show "appsscript.json" manifest file in editor**, go back to **Editor**, open `appsscript.json`, replace its contents with [`appsscript.json`](appsscript.json), and save.
5. Click **Deploy → New deployment**. Click the gear next to **Select type** and choose **Web app**. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
6. Click **Deploy**, then **Authorize access** and pick your Google account. Google shows *"Google hasn't verified this app"* because you wrote it yourself: click **Advanced → Go to Karbala Rooms live (unsafe)** → **Allow**.
7. Copy the **Web app URL** (it ends in `/exec`).
8. Open Karbala Rooms, tap the **Live** tab, paste the URL and tap **Connect**.

If this device has **saving** turned on (the GitHub key), the address is saved to `data/live.json` in the repository and every phone picks it up within a minute. Without saving it only works on that one device, so connect from a device with saving on. You can also edit `data/live.json` on GitHub and put the URL in `"url"`.

To check it worked, open the Web app URL in a browser: you should see text starting with `{"ok":true`.

## How fresh is it?

- Each open Live tab asks for updates every 15 seconds, and straight away when you come back to the tab.
- The script checks whether the sheet file has changed and only reads it again when it has. Reading it takes about a second.
- Google Sheets saves edits back to the .xlsx file as people type, so a change normally shows up in the app within about half a minute. As a safety net the script also re-reads the sheet every 5 minutes even if the file does not look changed.

## Things to know

- **Anyone who has the Web app URL can see the room calendar** (room numbers and the names/groups written in the ACCOMMODATION tab, for two weeks back and two months ahead). The URL is stored in this repository. Nothing else in the sheet or your Drive is shared, and the sheet itself stays private.
- **If the tab is renamed**, the script uses the first tab with "ACCOM" in its name. To use another tab, change `SHEET_NAME` at the top of `Code.gs`.
- **If the sheet is replaced by a new file**, change `FILE_ID` at the top of `Code.gs` (it is the long code in the sheet's link), then do **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. The URL stays the same.
- **If you update `Code.gs`**, do the same *Manage deployments → New version* step so the live URL uses the new code.
- **If the person who set it up loses access to the sheet**, the Live tab shows an error. Someone else with access repeats the setup and connects the new URL.
- It also works if the file is ever converted to a native Google Sheet.

## What the site receives

`GET <Web app URL>` returns JSON:

```json
{
  "ok": true,
  "sheet": "ACCOMMODATION",
  "today": "2026-10-31",
  "modified": "2026-10-31T09:55:04.678Z",
  "dates": ["2026-10-17", "2026-10-18", "…"],
  "labels": ["", "", "…"],
  "rows": [
    { "n": 7, "info": "", "room": "102", "beds": "0", "add": "2", "add2": "1",
      "runs": [[0, 35, "FAIZ ROOM"]] }
  ]
}
```

`rows` has one entry per sheet row with a room number in column B. `runs` lists stretches of consecutive days with the same text: `[first date index, number of days, text]`. The site matches each row to a room in `data/rooms.csv` by room number, in sheet order. Rows it cannot match are still shown, next to the room above them.
