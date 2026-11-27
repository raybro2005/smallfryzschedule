# Running the site by hand

Everything here works from a web browser on github.com. No Claude needed.

## What keeps running on its own

These don't need Claude at all:

- **cron-job.org** starts the Twitch checker every 5 minutes.
- **The Twitch checker** (GitHub Actions) updates live status, the live timer, stream lengths, peak viewers and his Twitch schedule.
- **GitHub Pages** hosts the site, and **Cloudflare** holds the domain.

If Claude is down, the only thing you lose is the hourly clean-up: new stream titles stay rough (like "!vote + hidden gem") until you or Claude fix them.

## Editing schedule.json

1. Go to https://github.com/raybro2005/smallfryzschedule and click **schedule.json**.
2. Click the **pencil icon** (Edit this file), top right of the file.
3. Make your change (see below).
4. Click **Commit changes…**, then **Commit changes** again.
5. Wait 1–2 minutes and refresh smallfryzschedule.com.

If GitHub says the file changed while you were editing, the checker saved something in the meantime. Copy your new text, refresh the page, and redo the edit on the fresh file.

## Adding a stream from Fryz's schedule

Find the line `"streams": [` near the top and paste this right under it:

```json
  {
   "d": "2026-11-28",
   "start": "21:00",
   "dur": null,
   "planned": true,
   "source": "fryz",
   "title": "Minecraft with chat",
   "tags": ["Minecraft"],
   "note": "From Fryz's schedule."
  },
```

- **d** is the date, as YYYY-MM-DD.
- **start** is the start time in **UTC**, 24-hour HH:MM. In winter, Edmonton time + 7 hours = UTC (2:00 PM → 21:00). In summer it's + 6 hours. If the UTC time goes past midnight, use the next day's date. Use `null` (no quotes) if you don't know the time.
- **title** is a short title; **tags** is the game or type of stream. Use `[]` if you don't know.
- Keep the comma after `}`. Order doesn't matter, because the checker re-sorts the file.
- Paste one block per day, with only one entry per day.

`"source": "fryz"` makes it beat his Twitch schedule for that day, and the site labels it "From Fryz's schedule". When he goes live that day, it turns into the real stream on its own.

## Marking days (days off, trips, tourneys, subathons)

Marked days are **events**. On the calendar they show as a purple band across those days, and clicking a day shows the event's title and note. Find the line `"events": [` near the bottom of the file and paste this right under it:

```json
  {
   "from": "2026-12-24",
   "to": "2026-12-26",
   "title": "Day off: Christmas",
   "note": "No streams over Christmas."
  },
```

- **from** and **to** are the first and last day, as YYYY-MM-DD, and are inclusive. For a single day, use the same date for both.
- These are calendar dates, not UTC times, so no time conversion is needed.
- Same comma rules as streams.

For **days off**, add `"off": true` to the event:

```json
  {
   "from": "2026-11-27",
   "to": "2026-11-28",
   "title": "Days off: birthday",
   "note": "No streams for two days.",
   "off": true
  },
```

The site then labels it "Day off", and the checker hides his Twitch-schedule streams on those days. Without `"off": true`, an event only marks the days and doesn't hide anything.

## How a planned day turns into the real stream

You don't do anything. When he goes live, the checker looks for a planned entry on the same **UTC date** as his start time, replaces it with the real stream, and adds a "Pull up on Twitch" link.

So enter the date the stream starts **in UTC**. In winter, anything he starts after 5:00 PM Edmonton time is already the next day in UTC. If you put it on the wrong day, the real stream still shows up on its own day, and the leftover planned entry is removed once the day has passed.

## Fixing a title

Search the file (Ctrl+F) for the date, e.g. `"d": "2026-11-19"`, and change the text inside the quotes after `"title":`. Leave `"raw"` alone, since that's his original Twitch title.

## Removing an entry

Delete the whole block, from its `{` to its `},`. If it's the last block in the list, also delete the comma left on the `}` above it.

## Rules that keep it from breaking

- Use straight double quotes `"`, never curly ones. Phones often turn them curly, so edit on a computer if you can.
- Keep commas between blocks, and no comma after the last block in a list.
- Don't edit blocks with `"source": "twitch"`. The checker manages those and will put them back.
- Don't change `"dur"` on a stream that already has a number.

Before committing, you can paste the whole file into https://jsonlint.com to check it. If the file breaks, the site keeps showing the last good copy, but the checker stops updating it until it's fixed. To undo, open **History** on schedule.json, open the last commit before yours and copy its version back.

## Health checks, once in a while

- **GitHub → Actions tab**: recent "Twitch live watcher" runs should have green checks. Red X's mean something's wrong; click one to read the error.
- **cron-job.org → your job → History**: should show 204 responses.
  - **401** means the GitHub token expired. Make a new fine-grained token (this repo only, Actions: read and write) and paste it into the job's Authorization header as `Bearer <token>`.
- **Twitch keys**: if the Actions error says "Twitch token request failed", make a new secret at dev.twitch.tv and update `TWITCH_CLIENT_SECRET` in the repo's Settings → Secrets and variables → Actions.
- **Cloudflare**: keep auto-renew on for smallfryzschedule.com.

## Pausing updates

To stop all automatic updates (for a long break, say), disable the job on cron-job.org, and turn it back on when he's back.
