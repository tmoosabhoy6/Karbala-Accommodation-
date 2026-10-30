# Karbala Rooms

A simple, read-only dashboard of the guest-house rooms. You can filter by building, floor, wing, room features and how many people a room fits. It shows the total rooms, beds and capacity for whatever is selected, by floor or by feature.

There is no sign-in and no database. The whole room list lives in two files in this repository:

| File | What it holds |
|---|---|
| `data/buildings.csv` | One row per building: code, display name, whether it is shown (`active` = yes/no), and order. |
| `data/rooms.csv` | One row per room, in the order the house uses. |

## Editing rooms or building names

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
| `guest_room` | `yes` for guest rooms. `no` for staff rooms, stores and 0-bed rooms. These are hidden unless "Include staff and non-guest rooms" is switched on. |
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
