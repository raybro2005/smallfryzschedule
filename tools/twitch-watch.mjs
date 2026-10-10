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

async function twitch() {
  const tok = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
  });
  if (!tok.ok) throw new Error("Twitch token request failed: " + tok.status);
  const { access_token } = await tok.json();
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${LOGIN}`, {
    headers: { "Client-Id": id, Authorization: "Bearer " + access_token },
  });
  if (!res.ok) throw new Error("Twitch streams request failed: " + res.status);
  const { data } = await res.json();
  return data && data[0] ? data[0] : null;   // null = offline
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
if (!important) { writeFileSync(STATE, JSON.stringify({ live: !!live, changed: false })); console.log(live ? "Live, nothing new to save yet." : "Offline, nothing to update."); process.exit(0); }
j.updatedAt = iso(now);
j.streams.sort((a, b) => (a.d + (a.start || "99")).localeCompare(b.d + (b.start || "99")));
writeFileSync(FILE, JSON.stringify(j, null, 1) + "\n");
writeFileSync(STATE, JSON.stringify({ live: !!live, changed: true, msg: note || "Update live status" }));
console.log("Saved:", note || "heartbeat");
