/* Wellness page: renders wellness/data.js (weekly aggregates from Strava). No libraries. */
(function () {
  "use strict";
  const D = window.WELLNESS;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const NAMES = { WeightTraining: "Weight training", HighIntensityIntervalTraining: "HIIT", VirtualRide: "Virtual ride", AlpineSki: "Alpine skiing",
    NordicSki: "Nordic skiing", StandUpPaddling: "Stand-up paddling", StairStepper: "Stair-stepper", Workout: "Workout (other)", Swim: "Swim" };
  const tname = t => NAMES[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2");
  const GROUPS = D.groups, GKEYS = GROUPS.map(g => g.key), GCOL = Object.fromEntries(GROUPS.map(g => [g.key, g.color]));
  const GNAME = Object.fromEntries(GROUPS.map(g => [g.key, g.name]));
  const tg = t => D.typeGroup[t] || "other";

  // Dates are plain YYYY-MM-DD Monday strings; do the arithmetic in UTC to avoid DST drift.
  const toDate = s => new Date(s + "T00:00:00Z");
  const iso = d => d.toISOString().slice(0, 10);
  const addW = (d, n) => new Date(d.getTime() + n * 7 * 864e5);
  const fmtDay = d => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const h1 = x => (Math.round(x * 10) / 10).toFixed(1);
  const int = x => Math.round(x).toLocaleString("en-US");
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

  // Full weekly series, first active week .. current week (zero-filled)
  const byW = Object.fromEntries(D.weeks.map(w => [w.w, w]));
  const first = toDate(D.weeks[0].w), cur = toDate(D.currentWeek);
  const S = [];
  for (let d = first; d <= cur; d = addW(d, 1)) {
    const w = byW[iso(d)];
    S.push({ d, iso: iso(d), by: w ? w.by : {}, partial: iso(d) === D.currentWeek });
  }
  let walks = true;
  const inc = t => walks || tg(t) !== "walk";
  const wh = w => Object.entries(w.by).reduce((s, [t, v]) => s + (inc(t) ? v[0] : 0), 0);
  const wn = w => Object.entries(w.by).reduce((s, [t, v]) => s + (inc(t) ? v[1] : 0), 0);
  const wg = w => { const g = {}; for (const [t, v] of Object.entries(w.by)) if (inc(t)) g[tg(t)] = (g[tg(t)] || 0) + v[0]; return g; };
  const complete = S.filter(w => !w.partial);

  function sumTypes(weeks) {
    const t = {}; let h = 0, n = 0, act = 0;
    for (const w of weeks) { let a = 0; for (const [k, v] of Object.entries(w.by)) if (inc(k)) { t[k] = t[k] || [0, 0]; t[k][0] += v[0]; t[k][1] += v[1]; h += v[0]; n += v[1]; a += v[1]; } if (a) act++; }
    return { t, h, n, act, weeks: weeks.length };
  }
  function streak() {
    let i = S.length - 1; if (!wn(S[i])) i--;
    let s = 0; while (i >= 0 && wn(S[i])) { s++; i--; }
    return s;
  }

  // ---------- Stats ----------
  function renderStats() {
    const l12 = complete.slice(-12), all = sumTypes(S);
    const years = (cur - first) / (365.25 * 864e5);
    $("stats").innerHTML = [
      [h1(sumTypes(l12).h / 12), "h / week", "last 12 weeks"],
      [streak(), "week streak", "active weeks in a row"],
      [int(all.h), "hours logged", "all time"],
      [int(all.n), "activities", "since " + MON[first.getUTCMonth()] + " " + first.getUTCFullYear()],
      [h1(years), "years on Strava", ""]
    ].map(([n, l, s]) => `<li><span class="num">${n}</span><span class="lbl">${esc(l)}${s ? `<small>${esc(s)}</small>` : ""}</span></li>`).join("");
  }

  // ---------- Main chart ----------
  let range = 52, view = [];
  $("legend").innerHTML = GROUPS.map(g => `<li data-g="${g.key}"><span class="sw" style="background:${g.color}"></span>${esc(g.name)}</li>`).join("") +
    `<li><span class="sw sw--line"></span>8-week average</li>`;
  const svgNS = "http://www.w3.org/2000/svg";
  function niceStep(max, n) { const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p; return 10 * p; }

  function renderChart() {
    const svg = $("chart"), wrap = $("chart-wrap");
    const W = Math.max(280, wrap.clientWidth), H = W < 520 ? 220 : 290;
    const m = { l: 30, r: 6, t: 10, b: 24 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const tot = S.map(wh), avg = tot.map((_, i) => { const a = tot.slice(Math.max(0, i - 7), i + 1); return a.reduce((x, y) => x + y, 0) / a.length; });
    const start = range ? Math.max(0, S.length - range - (S[S.length - 1].partial ? 1 : 0)) : 0;
    view = S.slice(start).map((w, k) => ({ w, total: tot[start + k], avg: avg[start + k], g: wg(w), n: wn(w) }));
    const N = view.length, bw = pw / N;
    const ymax0 = Math.max(1, ...view.map(v => Math.max(v.total, v.avg)));
    const step = niceStep(ymax0, 4), ymax = Math.ceil(ymax0 / step) * step;
    const y = v => m.t + ph - v / ymax * ph;
    let out = `<desc id="chart-desc">Bar chart of hours per week, stacked by activity type, with an 8-week rolling average line.</desc>`;
    for (let v = 0; v <= ymax + 1e-9; v += step) out += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${m.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${+v.toFixed(1)}</text>`;
    const gap = bw > 5 ? bw * 0.2 : 0;
    out += `<g shape-rendering="${bw < 3 ? "crispEdges" : "auto"}">`;
    view.forEach((v, i) => {
      let base = 0; const x = m.l + i * bw + gap / 2, w = Math.max(bw - gap, 0.6);
      for (const k of GKEYS) { const hv = v.g[k]; if (!hv) continue;
        out += `<rect x="${x.toFixed(2)}" y="${y(base + hv).toFixed(2)}" width="${w.toFixed(2)}" height="${(hv / ymax * ph).toFixed(2)}" fill="${GCOL[k]}"${v.w.partial ? ' opacity="0.45"' : ""}/>`;
        base += hv; }
    });
    out += `</g><polyline class="avg" points="${view.map((v, i) => `${(m.l + (i + 0.5) * bw).toFixed(1)},${y(v.avg).toFixed(1)}`).join(" ")}"/>`;
    // x labels
    const minGap = W < 520 ? 44 : 56; let lastX = -1e9;
    view.forEach((v, i) => {
      const d = v.w.d, x = m.l + i * bw; let lab = null;
      if (N <= 12) lab = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
      else if (N <= 60) { if (d.getUTCDate() <= 7) lab = MON[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? " " + d.getUTCFullYear() : ""); }
      else if (d.getUTCMonth() === 0 && d.getUTCDate() <= 7) lab = String(d.getUTCFullYear());
      if (lab && x - lastX >= minGap && x < W - 20) { out += `<line class="grid" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 4}"/><text x="${(x + 2).toFixed(1)}" y="${H - 6}">${lab}</text>`; lastX = x; }
    });
    out += `<rect class="hover" id="hov" x="0" y="${m.t}" width="0" height="${ph}" visibility="hidden"/>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.innerHTML = out;
    svg._geo = { m, bw, W, ph };
    // summary
    const done = view.filter(v => !v.w.partial), sum = done.reduce((s, v) => s + v.total, 0), act = done.filter(v => v.n).length;
    const label = range === 12 ? "Last 12 weeks" : range === 52 ? "Last year" : "All time";
    const curV = view[view.length - 1];
    $("range-sum").textContent = `${label}: ${int(sum)} h in total, ${h1(sum / Math.max(1, done.length))} h a week on average, active in ${act} of ${done.length} complete weeks.` +
      (curV.w.partial ? ` This week so far (pale bar): ${h1(curV.total)} h.` : "");
  }
  function tip(e) {
    const svg = $("chart"), g = svg._geo; if (!g) return;
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * (g.W / r.width);
    const i = Math.floor((sx - g.m.l) / g.bw);
    if (i < 0 || i >= view.length) return hideTip();
    const v = view[i], hov = $("hov");
    hov.setAttribute("x", g.m.l + i * g.bw); hov.setAttribute("width", Math.max(g.bw, 2)); hov.setAttribute("visibility", "visible");
    const rows = GKEYS.filter(k => v.g[k]).map(k => `<span class="row"><span><span class="sw" style="background:${GCOL[k]}"></span> ${esc(GNAME[k])}</span><span>${h1(v.g[k])} h</span></span>`).join("");
    const t = $("tip");
    t.innerHTML = `<b>Week of ${fmtDay(v.w.d)}${v.w.partial ? " (so far)" : ""}</b>${h1(v.total)} h · ${v.n} ${v.n === 1 ? "activity" : "activities"}${rows}<span class="row"><span>8-week average</span><span>${h1(v.avg)} h</span></span>`;
    t.hidden = false;
    const wrapW = $("chart-wrap").clientWidth, px = (g.m.l + (i + 0.5) * g.bw) * (r.width / g.W);
    const tw = t.offsetWidth; let left = px + 12; if (left + tw > wrapW) left = px - tw - 12; if (left < 0) left = Math.max(0, Math.min(wrapW - tw, px - tw / 2));
    t.style.left = left + "px"; t.style.top = "8px";
  }
  function hideTip() { $("tip").hidden = true; const h = $("hov"); if (h) h.setAttribute("visibility", "hidden"); }
  $("chart").addEventListener("pointermove", tip);
  $("chart").addEventListener("pointerdown", tip);
  $("chart").addEventListener("pointerleave", hideTip);

  // ---------- Years ----------
  function yearRows(withWalks) {
    const keep = walks; walks = withWalks;
    const ys = [];
    for (let y = first.getUTCFullYear(); y <= cur.getUTCFullYear(); y++) {
      const weeks = complete.filter(w => w.d.getUTCFullYear() === y);
      if (!weeks.length) continue;
      const s = sumTypes(weeks), g = {};
      for (const [t, v] of Object.entries(s.t)) g[tg(t)] = (g[tg(t)] || 0) + v[0];
      ys.push({ y, ...s, avg: s.h / weeks.length, g, partial: y === first.getUTCFullYear() || y === cur.getUTCFullYear() });
    }
    walks = keep; return ys;
  }
  function renderYears() {
    const ys = yearRows(walks), maxAvg = Math.max(...ys.map(r => r.avg));
    const topType = r => { const e = Object.entries(r.t).sort((a, b) => b[1][0] - a[1][0]); return e.length ? `${tname(e[0][0])} ${pct(e[0][1][0], r.h)}%` : "—"; };
    $("years").innerHTML = `<thead><tr><th>Year</th><th class="num">h / week</th><th class="num hide-sm">Active weeks</th><th class="num hide-sm">Hours</th><th class="barcell">Mix</th><th class="hide-sm">Largest type</th></tr></thead><tbody>` +
      ys.slice().reverse().map(r => `<tr><td>${r.y}${r.partial ? ` <span class="part">${r.y === cur.getUTCFullYear() ? "so far" : "from " + MON[first.getUTCMonth()]}</span>` : ""}</td>
        <td class="num">${h1(r.avg)}<div class="avgbar" style="width:${(r.avg / maxAvg * 100).toFixed(1)}%;margin-left:auto"></div></td>
        <td class="num hide-sm">${r.act} / ${r.weeks}</td><td class="num hide-sm">${int(r.h)}</td>
        <td class="barcell"><div class="bar" title="${esc(GKEYS.filter(k => r.g[k]).map(k => GNAME[k] + " " + pct(r.g[k], r.h) + "%").join(", "))}">${GKEYS.filter(k => r.g[k]).map(k => `<span style="width:${(r.g[k] / r.h * 100).toFixed(2)}%;background:${GCOL[k]}"></span>`).join("")}</div></td>
        <td class="top hide-sm">${esc(topType(r))}</td></tr>`).join("") + `</tbody>`;
  }

  // ---------- Written read (numbers computed from the data; independent of the toggle) ----------
  function renderRead() {
    const A = Object.fromEntries(yearRows(true).map(r => [r.y, r])), X = Object.fromEntries(yearRows(false).map(r => [r.y, r]));
    const has = (...ys) => ys.every(y => A[y]);
    const share = (r, g) => pct(r.g[g] || 0, r.h);
    const rank = (map, y) => Object.values(map).filter(r => !r.partial || r.y === y).sort((a, b) => b.avg - a.avg).findIndex(r => r.y === y);
    const P = [];
    if (has(2015, 2016, 2017, 2018)) {
      const e = [A[2015], A[2016], A[2017]], h = e.reduce((s, r) => s + r.h, 0), wk = e.reduce((s, r) => s + r.weeks, 0), act = e.reduce((s, r) => s + r.act, 0);
      const run = e.reduce((s, r) => s + (r.g.run || 0), 0);
      P.push(`<b>2015–2018: occasional running.</b> In the first years almost everything logged was running (${pct(run, h)}% of hours), averaging ${h1(h / wk)} h a week with activity in ${act} of ${wk} weeks. 2018 was nearly empty: ${A[2018].act} active weeks.`);
    }
    if (has(2019, 2020, 2021, 2022)) {
      const e = [A[2019], A[2020], A[2021]], h = e.reduce((s, r) => s + r.h, 0), ride = e.reduce((s, r) => s + (r.g.ride || 0), 0);
      P.push(`<b>2019–2022: cycling years.</b> Rides became the main activity (${pct(ride, h)}% of hours in 2019–21). 2020 was the busiest of these years at ${h1(A[2020].avg)} h a week; by 2022 volume was back to ${h1(A[2022].avg)} h a week, now mostly strength work (${share(A[2022], "strength")}%).`);
    }
    if (has(2022, 2023)) {
      const r = A[2023], ex = X[2023], exTop = rank(X, 2023) === 0;
      P.push(`<b>2023: the step up.</b> Weekly volume jumped from ${h1(A[2022].avg)} h in 2022 to ${h1(r.avg)} h, with an activity in ${r.act} of ${r.weeks} weeks. Strength and HIIT were the largest group (${share(r, "strength")}%), followed by walking and hiking (${share(r, "walk")}%). Without walks or hikes, 2023 averaged ${h1(ex.avg)} h a week${exTop ? ", the highest of any year" : ""}.`);
    }
    if (has(2024)) {
      const r = A[2024], top = rank(A, 2024) === 0;
      P.push(`<b>2024: ${top ? "the most hours" : "high volume"}, mostly walking.</b> ${h1(r.avg)} h a week${top ? ", the highest yearly average" : ""}, and every week had at least one activity (${r.act} of ${r.weeks}). Walking and hiking made up ${share(r, "walk")}% of the hours; without them it was ${h1(X[2024].avg)} h a week, down from ${h1(X[2023].avg)} in 2023.`);
    }
    if (has(2025, 2026)) {
      P.push(`<b>2025 to now: lower volume.</b> The average fell to ${h1(A[2025].avg)} h a week in 2025 and ${h1(A[2026].avg)} h so far in 2026 (${h1(X[2025].avg)} and ${h1(X[2026].avg)} without walks or hikes). Walking and hiking are still the largest share (${share(A[2026], "walk")}% of 2026 hours).`);
    }
    // Peak week and the recent picture
    const keep = walks; walks = true;
    const peak = complete.reduce((b, w) => wh(w) > wh(b) ? w : b, complete[0]);
    const pg = Object.entries(peak.by).sort((a, b) => b[1][0] - a[1][0])[0];
    const l12 = sumTypes(complete.slice(-12)).h / 12, l52 = sumTypes(complete.slice(-52)).h / 52;
    walks = false; const l12x = sumTypes(complete.slice(-12)).h / 12; walks = keep;
    P.push(`<b>Lately.</b> The last 12 complete weeks averaged ${h1(l12)} h a week (${h1(l12x)} without walks or hikes), against ${h1(l52)} h over the last 52. The single biggest week on record was the week of ${fmtDay(peak.d)}, at ${h1(wh(peak))} h, mostly ${esc(tname(pg[0]).toLowerCase())} (${h1(pg[1][0])} h).`);
    $("read").innerHTML = P.map(p => `<p>${p}</p>`).join("");
  }

  // ---------- Activity mix ----------
  function mixList(weeks, title, sub) {
    const s = sumTypes(weeks), rows = Object.entries(s.t).sort((a, b) => b[1][0] - a[1][0]), max = rows.length ? rows[0][1][0] : 1;
    return `<div><h3>${esc(title)}</h3><p class="sub">${esc(sub)} · ${int(s.h)} h · ${int(s.n)} activities</p><ol>` +
      rows.map(([t, v]) => `<li><span>${esc(tname(t))}</span><span class="mb" style="width:${(v[0] / max * 100).toFixed(1)}%;background:${GCOL[tg(t)]}"></span><span class="mv">${pct(v[0], s.h) || "<1"}% <span class="mn">${h1(v[0])} h · ${int(v[1])}</span></span></li>`).join("") + `</ol></div>`;
  }
  function renderMix() {
    const y = S.slice(-52);
    $("mix-wrap").innerHTML = mixList(y, "Last 12 months", `Weeks of ${fmtDay(y[0].d)} to now`) + mixList(S, "All time", `Since ${MON[first.getUTCMonth()]} ${first.getUTCFullYear()}`);
  }

  // ---------- Calendar ----------
  const SHADES = ["#dfe5ef", "#a9b8d1", "#6f88b0", "#2f4b7c"], CUTS = [1, 3, 6];
  const shade = h => h <= 0 ? null : SHADES[h <= CUTS[0] ? 0 : h <= CUTS[1] ? 1 : h <= CUTS[2] ? 2 : 3];
  function renderCal() {
    const map = Object.fromEntries(S.map(w => [w.iso, w])); let out = "";
    for (let y = cur.getUTCFullYear(); y >= first.getUTCFullYear(); y--) {
      const cells = new Array(53).fill('<span class="c none"></span>');
      for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d = new Date(d.getTime() + 864e5)) {
        if (d.getUTCDay() !== 1) continue;
        const doy = Math.floor((d - Date.UTC(y, 0, 1)) / 864e5), col = Math.floor(doy / 7), w = map[iso(d)];
        if (!w) continue;
        const h = wh(w), c = shade(h);
        cells[col] = `<span class="c" title="Week of ${fmtDay(d)}: ${h1(h)} h"${c ? ` style="background:${c}"` : ""}></span>`;
      }
      out += `<span>${y}</span><span class="cells">${cells.join("")}</span>`;
    }
    $("cal").innerHTML = out;
    $("cal-legend").innerHTML = `<span>0 h</span><span class="c" style="background:var(--color-surface)"></span>` + SHADES.map(c => `<span class="c" style="background:${c}"></span>`).join("") + `<span>6+ h a week</span>`;
  }

  // ---------- Controls ----------
  function renderAll() { renderStats(); renderChart(); renderYears(); renderMix(); renderCal(); }
  document.querySelectorAll("[data-range]").forEach(b => b.addEventListener("click", () => {
    range = +b.dataset.range; document.querySelectorAll("[data-range]").forEach(x => x.setAttribute("aria-pressed", x === b)); hideTip(); renderChart();
  }));
  document.querySelectorAll("[data-walks]").forEach(b => b.addEventListener("click", () => {
    walks = b.dataset.walks === "1"; document.querySelectorAll("[data-walks]").forEach(x => x.setAttribute("aria-pressed", x === b));
    document.querySelector('#legend [data-g="walk"]').style.opacity = walks ? "" : "0.35"; hideTip(); renderAll();
    document.dispatchEvent(new CustomEvent("wellness:walks", { detail: { walks } }));
  }));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { hideTip(); renderChart(); }, 120); });
  $("rule").textContent = `${D.rule} Weeks run Monday to Sunday in ${D.timezone.replace("_", " ")} time. ${D.capped} long indoor sessions were capped. Data through ${fmtDay(toDate(D.generated))}.`;
  renderRead();
  renderAll();
})();
