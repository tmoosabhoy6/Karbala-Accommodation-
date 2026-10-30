# Karbala Rooms

A simple dashboard of the guest-house rooms, with two tabs:

- **Guest rooms**: filter by building, floor, number of beds, wing, features and how many people a room fits. It shows the total rooms, beds and capacity for whatever is selected, grouped by floor, by number of beds, or by feature.
- **KG & staff**: the Khidmat Guzar and staff rooms and who is staying in each. You can search by room or by name.

Tap any room to edit it: block it (guest rooms show a red ✕ and are left out of all guest totals), or change its beds, extra mattresses, features, notes, room number, building, floor, wing or description, or move it between the guest and KG tabs. On KG rooms you can also set who is staying and how many people.

## How saving works

Every change made in the app is saved straight into `data/rooms.csv` in this repository, as a commit such as `Room 133: extra mattresses 2 → 1`. Every phone and tab reads the same file and checks for changes every 30 seconds, so nothing is lost when you close a tab. The commit history on GitHub is the full record of who changed what, and when.

- **Viewing** needs nothing. Changes made by others appear within about a minute.
- **Editing** needs a GitHub key on that device, entered once. Tap **Set up saving** at the top of the app and follow the steps: create a *fine-grained* key for this repository only, with **Contents: Read and write**. The key stays in that browser only and is never part of the website.
- **Another phone:** on a device that is already set up, tap **Saving on → Copy link for another device**, then open that link once on the other phone. Anyone with the link can change the room list, so only share it with staff.
- **Two people saving at once:** the app re-applies your change on top of theirs, so both are kept.

There is no sign-in screen and no database. The whole room list lives in two files in this repository:

| File | What it holds |
|---|---|
| `data/buildings.csv` | One row per building: code, display name, whether it is shown (`active` = yes/no), and order. |
| `data/rooms.csv` | One row per room, in the order the house uses. |

## Editing rooms or building names

You can also edit the files directly, which is the only way to change building names:

1. On GitHub, open `data/rooms.csv` (or `data/buildings.csv`) and click the pencil icon.
2. Change what you need and click **Commit changes**.
3. The site updates by itself within about a minute.

The data is checked before the site is published. If a row is broken, for example a bed count of `four` instead of `4`, or the same room listed twice, the update stops and the live site keeps its previous version. The **Actions** tab shows the problem.

### Columns in `rooms.csv`

| Column | Meaning |
|---|---|
| `building` | Building code from `buildings.csv` (`FAIZ`, `QB`, `QX`). |
| `room` | Room label exactly as staff write it, e.g. `109 A`, `Q G1 W`. |
| `floor` | `G` = ground, `1`, `2`, `3` …, `A` = annex. |
| `wing` | `Main wing`, `New wing` or empty. |
| `room_type` | The original wording from the old sheet (shown when you hover a room). |
| `features` | Filter tags separated by `;`, e.g. `Partition;Ladies`. Any new word you add becomes a new filter chip. |
| `beds`, `extra_mattress`, `extra_2` | Whole numbers. "Fits up to" is always worked out as beds + extra_mattress + extra_2. |
| `kg` | `yes` puts the room in the **KG & staff** tab and leaves it out of the guest totals. `no` is a guest room. |
| `blocked` | Optional. `yes` blocks a guest room for everyone (red ✕, left out of the totals). Empty or `no` = not blocked. |
| `occupant` | KG rooms: who is staying there. Empty means no one is listed. |
| `people` | KG rooms: how many people are staying, if known. |
| `notes` | Free text shown on the room tile. |

To show the hidden "Q list 2" building, set its `active` to `yes` in `buildings.csv`.

## Running it locally

Any static file server works, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To check the data and print the totals:

```bash
node scripts/check-data.mjs
```

## Publishing (one-time setup)

In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Every push to `main` then publishes the site.
