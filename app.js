/* ===== Schedule data lives in the artifact's shared store (collections "streams", "events", doc "meta/status").
   A scheduled task refreshes it from his public stream history. All start times are UTC. ===== */
const HEAD="head.png";
let TRACKED_FROM="2026-09-12";
let STREAMS=[], EVENTS=[], META=null, loadState="loading";
const OCCASIONS = {"2026-10-31":{icon:"🎃",label:"Halloween"},"2026-12-25":{icon:"🎄",label:"Christmas"},"2027-01-01":{icon:"🎆",label:"New Year's Day"}};

/* ===== helpers ===== */
const pad=n=>String(n).padStart(2,"0");
const key=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
const now=new Date();
let todayKey="";
const VIEWER_TZ=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"your time zone"}catch(e){return "your time zone"}})();
/* Friendly zone label: "NA - Edmonton" for the US, Canada and Mexico, "EU - London" for Europe, otherwise the zone name. */
const NA_ZONES=new Set(("New_York Detroit Kentucky/Louisville Kentucky/Monticello Indiana/Indianapolis Indiana/Vincennes Indiana/Winamac "+
  "Indiana/Marengo Indiana/Petersburg Indiana/Vevay Indiana/Tell_City Indiana/Knox Chicago Menominee North_Dakota/Center "+
  "North_Dakota/New_Salem North_Dakota/Beulah Denver Boise Phoenix Los_Angeles Anchorage Juneau Sitka Metlakatla Yakutat Nome Adak "+
  "St_Johns Halifax Glace_Bay Moncton Goose_Bay Toronto Montreal Nipigon Thunder_Bay Iqaluit Pangnirtung Atikokan Winnipeg "+
  "Rainy_River Resolute Rankin_Inlet Regina Swift_Current Edmonton Cambridge_Bay Yellowknife Inuvik Creston Dawson_Creek "+
  "Fort_Nelson Whitehorse Dawson Vancouver Blanc-Sablon "+
  "Mexico_City Cancun Merida Monterrey Matamoros Chihuahua Ciudad_Juarez Ojinaga Mazatlan Bahia_Banderas Hermosillo Tijuana").split(" ").map(z=>"America/"+z)
  .concat(["Pacific/Honolulu","US/Eastern","US/Central","US/Mountain","US/Pacific","US/Alaska","US/Hawaii","US/Arizona",
    "Canada/Atlantic","Canada/Central","Canada/Eastern","Canada/Mountain","Canada/Newfoundland","Canada/Pacific","Canada/Saskatchewan","Canada/Yukon","Mexico/General","Mexico/BajaNorte","Mexico/BajaSur"]));
function zoneLabel(tz){
  if(!tz||!tz.includes("/"))return tz||"your time zone";
  const city=tz.split("/").pop().replace(/_/g," ");
  if(NA_ZONES.has(tz))return `NA (North America) - ${city}`;
  if(tz.startsWith("Europe/"))return `EU (Europe) - ${city}`;
  return tz.replace(/_/g," ");
}
/* Which calendar day a moment falls on: the viewer's local date, or the UTC date when the UTC switch is on. */
function dayKeyOf(date){return prefs.tz==="utc"
  ?key(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())
  :key(date.getFullYear(),date.getMonth(),date.getDate())}
function refreshToday(){const k=dayKeyOf(new Date());const changed=k!==todayKey;todayKey=k;return changed}
const MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
/* ===== security: validate + trim everything read from the store, escape everything rendered ===== */
const RX_DATE=/^\d{4}-\d{2}-\d{2}$/, RX_TIME=/^([01]\d|2[0-3]):[0-5]\d$/, RX_TWITCH=/^[A-Za-z0-9_]{1,25}$/;
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function str(v,max){return typeof v==="string"?v.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,max):""}
function int(v,min,max){return Number.isInteger(v)&&v>=min&&v<=max?v:null}
function validDate(v){return typeof v==="string"&&RX_DATE.test(v)&&!isNaN(Date.parse(v+"T00:00:00Z"))}
function cleanStream(o){
  if(!o||typeof o!=="object"||!validDate(o.d))return null;
  const title=str(o.title,140); if(!title)return null;
  const out={d:o.d,title,start:typeof o.start==="string"&&RX_TIME.test(o.start)?o.start:null,dur:int(o.dur,1,2880),
    planned:o.planned===true,unsure:o.unsure===true,source:o.source==="twitch"?"twitch":undefined};
  if(Array.isArray(o.tags))out.tags=o.tags.map(t=>str(t,40)).filter(Boolean).slice(0,8);
  if(Array.isArray(o.with))out.with=o.with.filter(n=>typeof n==="string"&&RX_TWITCH.test(n)).slice(0,10);
  const peak=int(o.peak,0,10000000); if(peak!==null)out.peak=peak;
  const note=str(o.note,300); if(note)out.note=note;
  const raw=str(o.raw,300); if(raw)out.raw=raw;
  return out;
}
function cleanEvent(o){
  if(!o||typeof o!=="object"||!validDate(o.from)||!validDate(o.to)||o.to<o.from)return null;
  if((Date.parse(o.to)-Date.parse(o.from))/864e5>120)return null;
  const title=str(o.title,100); if(!title)return null;
  return {from:o.from,to:o.to,title,note:str(o.note,300)};
}
function cleanMeta(o){
  if(!o||typeof o!=="object")return null;
  const out={};
  if(typeof o.updatedAt==="string"&&!isNaN(Date.parse(o.updatedAt))&&Date.parse(o.updatedAt)<=Date.now()+36e5)out.updatedAt=o.updatedAt;
  if(validDate(o.trackedFrom))out.trackedFrom=o.trackedFrom;
  return out;
}
const twitchUrl=n=>"https://www.twitch.tv/"+encodeURIComponent(n.toLowerCase());

let byDay={};
function indexStreams(){
  byDay={};
  STREAMS.forEach(s=>{const t=startDate(s);s.k=t?dayKeyOf(t):s.d;s.sortAt=t?t.getTime():Date.parse(s.d+"T23:59:00Z")});
  STREAMS.slice().sort((a,b)=>a.sortAt-b.sortAt).forEach(s=>(byDay[s.k]=byDay[s.k]||[]).push(s));
}
function eventsOn(k){return EVENTS.filter(e=>k>=e.from&&k<=e.to)}
function startDate(s){return s.start?new Date(`${s.d}T${s.start}:00Z`):null}
/* A stream counts as live (and gets the timer) only if the latest data refresh, under 90 minutes old, still saw it live. */
const LIVE_FRESH_MS=90*60000;
function liveDataFresh(){return !!(META&&META.updatedAt)&&Date.now()-Date.parse(META.updatedAt)<LIVE_FRESH_MS}
function isLive(s){const t=startDate(s);if(!t||s.dur||s.planned||!liveDataFresh())return false;const h=(Date.now()-t)/36e5;return h>=0&&h<10}
function fmtDur(m){if(!m)return null;const h=Math.floor(m/60),r=m%60;return r?`${h}h ${r}m`:`${h}h`}
function hash(str){let h=0;for(const c of str)h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)}
function blobRadius(k){const h=hash(k);const v=i=>40+((h>>(i*3))%20);return `${v(0)}% ${100-v(0)}% ${v(1)}% ${100-v(1)}% / ${v(2)}% ${v(3)}% ${100-v(3)}% ${100-v(2)}%`}
function status(k){
  if(byDay[k])return "stream";
  if(loadState==="ready"&&k>=TRACKED_FROM&&k<todayKey)return "off";
  if(loadState!=="ready"||k<TRACKED_FROM)return "untracked";
  return "unknown";
}

/* ===== settings ===== */
const DEFAULT_PREFS={theme:"system",text:"normal",contrast:false,motion:"system",tabbar:"bottom",wk:1,tz:"local"};
const PREF_CHOICES={theme:["light","dark","system"],text:["normal","large","larger"],motion:["system","on","off"],tabbar:["bottom","top","left","right","hidden"],tz:["local","utc"]};
let prefs={...DEFAULT_PREFS};
try{
  const saved=JSON.parse(localStorage.getItem("sfz-prefs")||"{}")||{};
  if(typeof saved.motion==="boolean")saved.motion=saved.motion?"system":"off"; // older saved setting
  for(const k in PREF_CHOICES)if(PREF_CHOICES[k].includes(saved[k]))prefs[k]=saved[k];
  if(Number.isInteger(saved.wk)&&saved.wk>=0&&saved.wk<=6)prefs.wk=saved.wk;
  if(typeof saved.contrast==="boolean")prefs.contrast=saved.contrast;
}catch(e){}
function savePrefs(){try{localStorage.setItem("sfz-prefs",JSON.stringify(prefs))}catch(e){}}
function fmtTime(d){
  const utc=d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"})+" UTC";
  const loc=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit",timeZoneName:"short"});
  return prefs.tz==="utc"?{main:utc,side:loc}:{main:loc,side:utc};
}

/* ===== render ===== */
refreshToday();
function todayView(){const [y,m]=todayKey.split("-").map(Number);return {y,m:m-1}}
let view=todayView();
let selected=todayKey;
const $=id=>document.getElementById(id);

function render(){
  $("monthTitle").innerHTML=`${MONTHS[view.m]}<small>${view.y}</small>`;
  const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  $("dow").innerHTML=Array.from({length:7},(_,i)=>`<div>${names[(i+prefs.wk)%7]}</div>`).join("");
  const first=new Date(Date.UTC(view.y,view.m,1));
  const offset=(first.getUTCDay()-prefs.wk+7)%7;
  const start=new Date(Date.UTC(view.y,view.m,1-offset));
  const cells=[];
  for(let i=0;i<42;i++){
    const d=new Date(start.getTime()+i*864e5);
    cells.push({k:key(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()),day:d.getUTCDate(),inMonth:d.getUTCMonth()===view.m,col:i%7});
    if(i===34&&new Date(start.getTime()+35*864e5).getUTCMonth()!==view.m)break;
  }
  let html="",streamed=0,upcoming=0,mins=0,locked=0;
  cells.forEach((c,i)=>{
    const st=status(c.k), list=byDay[c.k]||[], evs=eventsOn(c.k);
    const prev=cells[i-1],next=cells[i+1];
    const cls=["day",`st-${st}`];
    if(!c.inMonth)cls.push("other");
    if(c.k<todayKey)cls.push("past");else if(c.k>todayKey)cls.push("future");else cls.push("today");
    if(st==="untracked"||st==="unknown")cls.push("untracked");
    if(c.k===selected)cls.push("sel");
    let inner="";
    if(st==="stream"){inner+=`<span class="blob stream" style="border-radius:${blobRadius(c.k)}"></span>`}
    if(st==="off"){
      const jl=c.col>0&&prev&&status(prev.k)==="off", jr=c.col<6&&next&&status(next.k)==="off";
      inner+=`<span class="blob off${jl?" join-l":""}${jr?" join-r":""}" style="border-radius:${blobRadius(c.k+"o")}"></span>`;
    }
    if(evs.length){
      const jl=c.col>0&&prev&&eventsOn(prev.k).length, jr=c.col<6&&next&&eventsOn(next.k).length;
      inner+=`<span class="band${jl?" join-l":""}${jr?" join-r":""}"></span>`;
    }
    const live=list.some(isLive);
    if(live)inner+=`<span class="mark live" title="Live"></span>`;
    else if(list.some(s=>s.unsure))inner+=`<span class="mark unsure" title="Unsure">?</span>`;
    else if(st==="stream"&&c.k<todayKey)inner+=`<span class="mark ok" title="Happened">✓</span>`;
    if(OCCASIONS[c.k])inner+=`<span class="sticker" title="${OCCASIONS[c.k].label}">${OCCASIONS[c.k].icon}</span>`;
    inner+=`<span class="num">${c.day}</span>`;
    const label=`${c.k}: ${st==="stream"?list.map(s=>s.title).join(", "):st==="off"?"no stream":"no record"}${evs.length?", event: "+evs.map(e=>e.title).join(", "):""}`;
    html+=`<button class="${cls.join(" ")}" data-k="${c.k}" aria-label="${esc(label)}">${inner}</button>`;
    if(c.inMonth){list.forEach(s=>{if(s.planned)upcoming++;else{streamed++;mins+=s.dur||0;if(lockedIn(s.raw))locked++}})}
  });
  $("grid").innerHTML=html;
  $("counts").textContent=loadState==="loading"?"Loading the schedule…":loadState==="offline"?"Schedule unavailable right now.":`${streamed} streams · ${Math.round(mins/60)} hours of yappin · locked in on ${locked} of ${streamed}${upcoming?` · ${upcoming} coming up`:""}`;
  {const latest=STREAMS.filter(x=>!x.planned&&subGoal(x.raw)&&Date.now()-Date.parse(x.d)<14*864e5).sort((x,y)=>y.sortAt-x.sortAt)[0];
   $("headgoal").innerHTML=latest?meter(subGoal(latest.raw)).replace("sub goal","current sub goal"):"";}
  renderDetail();
  renderLive();
  renderUpdated();
}

function renderDetail(){
  const k=selected, list=byDay[k]||[], evs=eventsOn(k), st=status(k);
  const d=new Date(k+"T12:00:00Z");
  const dateLabel=d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"});
  let h=`<h2>${dateLabel}${k===todayKey?` <span class="todaytag">today</span>`:""}</h2>`;
  if(OCCASIONS[k])h+=`<span class="chip plain">${OCCASIONS[k].icon} ${OCCASIONS[k].label}</span> `;
  if(!list.length){
    if(st==="off")h+=`<span class="chip off">Day off</span><p>No stream. Probably touching grass.</p>`;
    else if(st==="untracked")h+=`<span class="chip plain">No record</span><p>${loadState==="ready"?`Before this site existed (it starts ${fmtShort(TRACKED_FROM)} ${TRACKED_FROM.slice(0,4)}), so there's no record.`:"The schedule is still loading."}</p>`;
    else h+=`<span class="chip plain">Nothing yet</span><p>Nothing announced for this day yet. Check back, plans change fast round here.</p>`;
  }
  list.forEach(s=>{
    const live=isLive(s), t=startDate(s);
    const chip=live?`<span class="chip live">Live now</span>`:s.planned?`<span class="chip stream">${s.unsure?"Rumoured (from his titles)":s.source==="twitch"?"On his Twitch schedule":"Planned"}</span>`:`<span class="chip stream">Streamed</span>`;
    let rows="";
    /* start time and length only appear once the stream has actually started */
    const started=!s.planned&&t&&t.getTime()<=Date.now();
    if(started){const f=fmtTime(t);rows+=`<dt>Start</dt><dd>${f.main} <span class="mono" style="color:var(--muted)">· ${f.side}</span></dd>`}
    if(started&&s.dur)rows+=`<dt>Length</dt><dd>${fmtDur(s.dur)}</dd>`;
    else if(started)rows+=`<dt>${live?"Live for":"Length"}</dt><dd>${live?`<span class="livetimer mono" data-since="${t.getTime()}">${fmtElapsed(Date.now()-t.getTime())}</span>`:(Date.now()-t.getTime()<12*36e5?"Waiting for the next update":"Not recorded")}</dd>`;
    if(s.peak)rows+=`<dt>Peak</dt><dd>${s.peak.toLocaleString()} viewers</dd>`;
    if(s.with&&s.with.length)rows+=`<dt>With</dt><dd>${s.with.map(n=>`<a href="${esc(twitchUrl(n))}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join(", ")}</dd>`;
    const g=subGoal(s.raw);
    h+=`<div class="entry">${chip}<h3>${esc(s.title)}${lockedIn(s.raw)?` <span class="stamp" title="He said it in the title">locked in</span>`:""}</h3>${rows?`<dl>${rows}</dl>`:""}`;
    if(g)h+=meter(g);
    if(s.tags&&s.tags.length)h+=`<div class="tags">${s.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
    const note=(s.note||"").replace(/\s*Sub goal in the title:[^.]*\.?/i,"").trim(); // the meter already shows it
    if(note)h+=`<p style="margin:0;font-size:.92rem">${esc(note)}</p>`;
    if(s.raw)h+=`<div class="chatline"><span class="chatname">SmallFryz</span><span class="rawtitle">${esc(s.raw)}</span></div>`;
    h+=`</div>`;
  });
  evs.forEach(e=>{
    const range=e.from===e.to?"One day":`${fmtShort(e.from)} – ${fmtShort(e.to)}`;
    h+=`<div class="entry"><span class="chip event">Event · ${range}</span><h3>${esc(e.title)}</h3>${e.note?`<p style="margin:0;font-size:.92rem">${esc(e.note)}</p>`:""}</div>`;
  });
  h+=`<a class="watch" href="https://www.twitch.tv/smallfryz" target="_blank" rel="noopener noreferrer">Pull up on Twitch →</a>`;
  $("detail").innerHTML=h;
}
/* bits pulled from his own titles */
function subGoal(raw){const m=/(\d+)\s*\/\s*(\d+)\s*(?:T1|TIER\s*1)?\s*SUBS?/i.exec(raw||"");if(!m)return null;const cur=+m[1],goal=+m[2];return goal>0&&cur<=goal*2?{cur,goal}:null}
const lockedIn=raw=>/LOCKED\s*IN/i.test(raw||"");
function meter(g){const pct=Math.min(100,Math.round(g.cur/g.goal*100));return `<div class="subgoal"><div class="meter" role="img" aria-label="Sub goal ${g.cur} of ${g.goal}"><i style="width:${pct}%"></i></div><span>sub goal ${g.cur}/${g.goal}</span></div>`}
function fmtShort(k){return new Date(k+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"UTC"})}

/* ===== live timer: how long the current stream has been going, ticking every second ===== */
function fmtElapsed(ms){const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;return `${h}:${pad(m)}:${pad(sec)}`}
setInterval(()=>{document.querySelectorAll(".livetimer").forEach(el=>{const since=Number(el.dataset.since);if(since)el.textContent=fmtElapsed(Date.now()-since)})},1000);
function renderLive(){
  const live=STREAMS.find(isLive);
  $("livechip").classList.toggle("on",!!live);
  if(live){$("livetext").innerHTML=`LIVE · yappin for <span class="livetimer" data-since="${startDate(live).getTime()}">${fmtElapsed(Date.now()-startDate(live).getTime())}</span>`}
  else{
    const next=STREAMS.filter(s=>s.planned&&(s.k||s.d)>=todayKey).sort((a,b)=>a.sortAt-b.sortAt)[0];
    $("livetext").textContent=loadState==="loading"?"Loading…":next?`next stream: ${fmtShort(next.k||next.d)}${next.title&&next.title!=="Scheduled stream"?`, ${next.title}`:""}`:"offline (for now)";
  }
}

/* ===== floating heads ===== */
(function(){
  $("brandHead").src=HEAD;
  const box=$("school");
  for(let i=0;i<5;i++){
    const im=document.createElement("img");
    im.src=HEAD; im.alt="";
    im.style.top=(8+i*17)%72+"%";
    im.style.animationDuration=(30+i*9)+"s";
    im.style.animationDelay=(-i*8)+"s";
    box.appendChild(im);
  }
})();

/* ===== live data ===== */
function relTime(iso){const m=Math.round((Date.now()-new Date(iso))/6e4);if(m<1)return"just now";if(m<60)return m+" min ago";const h=Math.round(m/60);return h<48?h+" h ago":Math.round(h/24)+" days ago"}
function renderUpdated(){
  const zone=prefs.tz==="utc"?"UTC":zoneLabel(VIEWER_TZ);
  const upd=META&&META.updatedAt?`Schedule updated ${relTime(META.updatedAt)}`:loadState==="offline"?"Couldn't load the schedule. Try refreshing the page.":"";
  $("updated").textContent=[upd,`Days and times shown in ${zone}`].filter(Boolean).join(" · ");
}

async function loadSchedule(){
  try{
    const res=await fetch("schedule.json",{cache:"no-store",credentials:"omit"});
    if(!res.ok)throw new Error(res.status);
    const j=await res.json();
    if(!j||typeof j!=="object")throw new Error("bad data");
    STREAMS=(Array.isArray(j.streams)?j.streams:[]).slice(0,1000).map(cleanStream).filter(Boolean);
    EVENTS=(Array.isArray(j.events)?j.events:[]).slice(0,200).map(cleanEvent).filter(Boolean);
    META=cleanMeta(j); if(META&&META.trackedFrom)TRACKED_FROM=META.trackedFrom;
    indexStreams(); loadState="ready";
  }catch(e){ if(loadState!=="ready")loadState="offline"; }
  render();
}
loadSchedule();
setInterval(loadSchedule,5*60000);
setInterval(()=>{if(refreshToday())render();else{renderLive();renderUpdated()}},60000);

/* ===== events ===== */
$("grid").addEventListener("click",e=>{const b=e.target.closest(".day");if(!b)return;selected=b.dataset.k;
  const [y,m]=selected.split("-").map(Number);if(m-1!==view.m){view={y,m:m-1}}render()});
$("prev").onclick=()=>{view.m--;if(view.m<0){view.m=11;view.y--}render()};
$("next").onclick=()=>{view.m++;if(view.m>11){view.m=0;view.y++}render()};
$("todayBtn").onclick=()=>{refreshToday();view=todayView();selected=todayKey;render()};
function setTz(tz){if(prefs.tz===tz)return;const wasToday=selected===todayKey;prefs.tz=tz;savePrefs();refreshToday();indexStreams();if(wasToday){selected=todayKey;view=todayView()}render()}

/* ===== settings panel ===== */
function applyPrefs(){
  const root=document.documentElement;
  if(prefs.theme==="system")delete root.dataset.theme;else root.dataset.theme=prefs.theme;
  root.dataset.text=prefs.text;
  root.dataset.motion=prefs.motion;
  root.dataset.tabbar=prefs.tabbar;
  if(prefs.contrast)root.dataset.contrast="high";else delete root.dataset.contrast;
  document.querySelectorAll("#settings .choices").forEach(g=>{
    const cur=String(prefs[g.dataset.pref]);
    g.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.val===cur)));
  });
  $("prefContrast").checked=prefs.contrast;
  $("prefWeek").value=String(prefs.wk);
  $("tzHelp").textContent=`Your time zone: ${zoneLabel(VIEWER_TZ)}.`;
}
document.querySelectorAll("#settings .choices").forEach(g=>g.addEventListener("click",e=>{
  const b=e.target.closest("button[data-val]"); if(!b)return;
  const k=g.dataset.pref, v=b.dataset.val; if(!PREF_CHOICES[k].includes(v))return;
  if(k==="tz"){setTz(v);applyPrefs();return}
  prefs[k]=v; savePrefs(); applyPrefs();
}));
$("prefContrast").addEventListener("change",e=>{prefs.contrast=e.target.checked;savePrefs();applyPrefs()});
$("prefWeek").addEventListener("change",e=>{const v=Number(e.target.value);if(Number.isInteger(v)&&v>=0&&v<=6){prefs.wk=v;savePrefs();render()}});
$("resetSettings").addEventListener("click",()=>{const tzChanged=prefs.tz!==DEFAULT_PREFS.tz;prefs={...DEFAULT_PREFS};savePrefs();if(tzChanged){refreshToday();indexStreams();selected=todayKey;view=todayView()}applyPrefs();render()});
const dlg=$("settings");
function openSettings(){try{dlg.showModal()}catch(e){dlg.setAttribute("open","")}}
$("openSettings").addEventListener("click",openSettings);
$("openSettingsFab").addEventListener("click",openSettings);
$("closeSettings").addEventListener("click",()=>dlg.close());
dlg.addEventListener("click",e=>{if(e.target===dlg)dlg.close()}); // click outside the panel closes it

applyPrefs();
render();
