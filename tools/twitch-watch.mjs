// Checks Twitch every few minutes and keeps schedule.json's live status current.
// Runs in GitHub Actions. Needs repo secrets TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.
import { readFileSync, writeFileSync } from "node:fs";

const LOGIN = "smallfryz";
const FILE = "schedule.json";
const HEARTBEAT_MIN = 30;   // while live, refresh updatedAt at least this often (site needs < 90 min)
const PEAK_EVERY_MIN = 15;  // don't commit peak-viewer bumps more often than this

const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) { console.error("Twitch secrets are missing. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in Settings > Secrets and variables > Actions."); process.exit(1); }

const now = new Date();
const iso = d => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const ymd = d => iso(d).slice(0, 10);
const hm = d => iso(d).slice(11, 16);
const mins = (a, b) => Math.round((b - a) / 60000);

let TOKEN = null;
async function helix(path) {
  if (!TOKEN) {
    const tok = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
    });
    if (!tok.ok) throw new Error("Twitch token request failed: " + tok.status);
    TOKEN = (await tok.json()).access_token;
  }
  return fetch("https://api.twitch.tv/helix/" + path, { headers: { "Client-Id": id, Authorization: "Bearer " + TOKEN } });
}
async function twitch() {
  const res = await helix(`streams?user_login=${LOGIN}`);
  if (!res.ok) throw new Error("Twitch streams request failed: " + res.status);
  const { data } = await res.json();
  return data && data[0] ? data[0] : null;   // null = offline
}
// His posted Twitch schedule (the "Schedule" tab on his channel). Returns [] if none is posted, null if it couldn't be read.
async function twitchSchedule() {
  try {
    const u = await helix(`users?login=${LOGIN}`);
    if (!u.ok) return null;
    const user = (await u.json()).data?.[0]; if (!user) return null;
    const r = await helix(`schedule?broadcaster_id=${user.id}&first=25`);
    if (r.status === 404) return [];          // no schedule posted
    if (!r.ok) return null;
    const body = await r.json();
    const vac = body.data?.vacation;
    return (body.data?.segments || []).filter(seg => !seg.canceled_until).map(seg => ({ ...seg, vacation: vac }));
  } catch { return null; }
}

// Plain-text cleanup of a raw Twitch title for the short "title" field.
function cleanTitle(raw) {
  const t = raw.replace(/\s+-\s+(![\w]+\s*)+$/, "")
    .replace(/[^\p{L}\p{N}\s&'’+:,.!?@/-]/gu, " | ")
    .split("|").map(x => x.trim()).filter(Boolean).slice(0, 2).join(" + ");
  const s = (t || raw).toLowerCase().slice(0, 120);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const stripCommands = raw => raw.replace(/\s+-\s+(![\w]+\s*)+$/, "").trim().slice(0, 300);

const j = JSON.parse(readFileSync(FILE, "utf8"));
j.streams = Array.isArray(j.streams) ? j.streams : [];
const last = j.updatedAt ? new Date(j.updatedAt) : new Date(0);
let important = false, minor = false, note = "";

const live = await twitch();
const summary = (msg) => { try { writeFileSync(process.env.GITHUB_STEP_SUMMARY || "/dev/null", `### Twitch check\n${msg}\n`, { flag: "a" }); } catch {} };
summary(live ? `SmallFryz is **live** (${live.viewer_count} viewers): ${live.title}` : "SmallFryz is **offline**.");

if (live) {
  const start = new Date(live.started_at);
  const day = ymd(start);
  let s = j.streams.find(x => x.d === day && !x.planned);
  if (!s) {
    // a planned entry for that day becomes the real stream
    j.streams = j.streams.filter(x => !(x.d === day && x.planned));
    s = { d: day, start: hm(start), dur: null, title: cleanTitle(live.title), tags: live.game_name ? [live.game_name] : [], raw: stripCommands(live.title) };
    j.streams.push(s);
    important = true; note = "went live";
  } else if (s.dur !== null) {
    s.dur = null; important = true; note = "live again (restart)";   // restarted the same day
  }
  if (!s.start) { s.start = hm(start); important = true; }
  s.seen = iso(now);  // last time we saw him live (used to compute length when he stops)
  if (!s.peak || live.viewer_count > s.peak) { s.peak = live.viewer_count; minor = true; }
  if (mins(last, now) >= HEARTBEAT_MIN) important = true;
  else if (minor && mins(last, now) >= PEAK_EVERY_MIN) important = true;
} else {
  // offline: close any stream still marked live
  for (const s of j.streams) {
    if (s.planned || s.dur !== null || !s.start) continue;
    const start = new Date(`${s.d}T${s.start}:00Z`);
    // He went offline between the last check (≤5 min ago) and now, so "now" is the end time.
    // Only fall back to the last saved sighting if the watcher was down for a long while.
    const seen = s.seen ? new Date(s.seen) : null;
    const end = !seen || mins(seen, now) <= HEARTBEAT_MIN + 15 ? now : seen;
    s.dur = Math.max(1, mins(start, end));
    delete s.seen;
    important = true; note = `ended, length ${s.dur} min`;
  }
}

const STATE = process.env.WATCH_STATE || "/dev/null";
// ---- upcoming streams from his Twitch schedule ----
const segs = await twitchSchedule();
if (segs) {
  const horizon = new Date(now.getTime() + 21 * 864e5);       // look three weeks ahead
  const wanted = new Map();
  for (const seg of segs) {
    const st = new Date(seg.start_time);
    if (st <= now || st > horizon) continue;
    const day = ymd(st);
    if (wanted.has(day)) continue;                              // one entry per day
    wanted.set(day, {
      d: day, start: hm(st), dur: null, planned: true, source: "twitch",
      title: seg.title ? cleanTitle(seg.title) : "Scheduled stream",
      tags: seg.category?.name ? [seg.category.name] : [],
      note: "From his Twitch schedule.",
      ...(seg.title ? { raw: stripCommands(seg.title) } : {}),
    });
  }
  const realDays = new Set(j.streams.filter(x => !x.planned).map(x => x.d));
  const before = JSON.stringify(j.streams);
  j.streams = j.streams.filter(x => {
    if (!x.planned) return true;
    if (wanted.has(x.d)) return false;                          // official entry replaces any guess for that day
    if (x.source === "twitch") return false;                    // dropped or cancelled on Twitch, or already happened
    return true;
  });
  for (const [day, entry] of wanted) if (!realDays.has(day)) j.streams.push(entry);
  if (JSON.stringify(j.streams) !== before) { important = true; note = note || `Twitch schedule: ${wanted.size} upcoming`; }
  summary(wanted.size ? `Twitch schedule: **${wanted.size}** upcoming stream(s) in the next 3 weeks.` : "Twitch schedule: nothing posted for the next 3 weeks.");
} else summary("Twitch schedule: couldn't be read this time.");

if (!important) { writeFileSync(STATE, JSON.stringify({ live: !!live, changed: false })); console.log(live ? "Live, nothing new to save yet." : "Offline, nothing to update."); process.exit(0); }
j.updatedAt = iso(now);
j.streams.sort((a, b) => (a.d + (a.start || "99")).localeCompare(b.d + (b.start || "99")));
writeFileSync(FILE, JSON.stringify(j, null, 1) + "\n");
writeFileSync(STATE, JSON.stringify({ live: !!live, changed: true, msg: note || "Update live status" }));
console.log("Saved:", note || "heartbeat");
