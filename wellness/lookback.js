/* Wellness lookback: compares the last two or three calendar years (current one year-to-date),
   using the monthly, yearly and like-for-like YTD aggregates in data.js. No libraries.
   Listens for the page's "Counting" switch via the "wellness:walks" event. */
(function () {
  "use strict";
  const D = window.WELLNESS;
  if (!D || !D.years || !D.ytd || !D.months) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const NAMES = { WeightTraining: "Weight training", HighIntensityIntervalTraining: "HIIT", VirtualRide: "Virtual ride", AlpineSki: "Alpine skiing",
    NordicSki: "Nordic skiing", StandUpPaddling: "Stand-up paddling", StairStepper: "Stair-stepper", Workout: "Workout (other)" };
  const tname = t => NAMES[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2");
  const h1 = x => (Math.round(x * 10) / 10).toFixed(1);
  const h2 = x => (Math.round(x * 100) / 100).toFixed(2);
  const int = x => Math.round(x).toLocaleString("en-US");
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const sign = x => (x > 0 ? "+" : x < 0 ? "\u2212" : "\u00b1");
  const svgNS = "http://www.w3.org/2000/svg";

  // Lookback groups: the page's six groups folded into five, so "cardio" reads as one thing.
  const CARDIO_EXTRA = new Set(["Swim", "Rowing", "VirtualRow", "StairStepper", "Elliptical", "NordicSki", "Canoeing", "Kayaking", "InlineSkate"]);
  const LG = [
    { key: "strength", name: "Strength & HIIT", color: "#2f4b7c" },
    { key: "cardio", name: "Cardio", color: "#2e8b7a" },
    { key: "walk", name: "Walk & hike", color: "#a9a77a" },
    { key: "yoga", name: "Yoga", color: "#8a6fb0" },
    { key: "other", name: "Other", color: "#bdbdbd" }
  ];
  const LGN = Object.fromEntries(LG.map(g => [g.key, g]));
  const pg = t => D.typeGroup[t] || "other";
  const lg = t => { const g = pg(t); if (g === "run" || g === "ride" || CARDIO_EXTRA.has(t)) return "cardio"; return LGN[g] ? g : "other"; };

  let walks = true, win = 2;
  const inc = t => walks || pg(t) !== "walk";
  const groups = () => LG.filter(g => walks || g.key !== "walk");

  // Sum a {type: [hours, count]} map under the current switch.
  function sum(by) {
    const r = { h: 0, n: 0, g: {}, t: {} };
    for (const [t, v] of Object.entries(by || {})) {
      if (!inc(t)) continue;
      r.h += v[0]; r.n += v[1]; r.g[lg(t)] = (r.g[lg(t)] || 0) + v[0];
      r.t[t] = (r.t[t] || 0) + v[0];
    }
    return r;
  }
  // Metrics for a span record {days, wk, aw, by}
  function metrics(s) {
    const r = sum(s.by), wks = s.days / 7;
    return { ...r, days: s.days, perWeek: r.h / wks, sessW: r.n / wks, sess: r.n ? r.h / r.n * 60 : 0,
      act: s.aw[walks ? 0 : 1], wk: s.wk, gw: Object.fromEntries(LG.map(g => [g.key, (r.g[g.key] || 0) / wks])) };
  }

  const snap = new Date(D.generated + "T00:00:00Z");
  const CY = snap.getUTCFullYear();
  const snapLabel = `${snap.getUTCDate()} ${MON[snap.getUTCMonth()]}`;
  const ytdLabel = `1 Jan \u2013 ${snapLabel}`;
  const winYears = () => { const y = []; for (let k = win - 1; k >= 0; k--) if (D.years[CY - k]) y.push(CY - k); return y; };
  const yLabel = y => (y === CY ? `${y} YTD` : String(y));

  // Months / quarters as h/week; a partial current period is kept only if enough of it has passed.
  const byM = Object.fromEntries(D.months.map(m => [m.m, m.by]));
  const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function monthSeries(y0) {
    const out = [];
    for (let y = y0; y <= CY; y++) for (let m = 0; m < 12; m++) {
      if (y === CY && m > snap.getUTCMonth()) break;
      const partial = y === CY && m === snap.getUTCMonth() && snap.getUTCDate() < dim(y, m);
      const days = partial ? snap.getUTCDate() : dim(y, m);
      if (partial && days < 15) continue;
      const key = `${y}-${String(m + 1).padStart(2, "0")}`, r = sum(byM[key]);
      out.push({ y, m, key, partial, days, h: r.h, n: r.n, perWeek: r.h / (days / 7), g: Object.fromEntries(LG.map(g => [g.key, (r.g[g.key] || 0) / (days / 7)])) });
    }
    return out;
  }
  function quarterSeries(y0) {
    const out = [];
    for (let y = y0; y <= CY; y++) for (let q = 0; q < 4; q++) {
      let days = 0, h = 0; const g = {};
      for (let m = q * 3; m < q * 3 + 3; m++) {
        if (y === CY && m > snap.getUTCMonth()) break;
        const d = (y === CY && m === snap.getUTCMonth()) ? snap.getUTCDate() : dim(y, m);
        days += d; const r = sum(byM[`${y}-${String(m + 1).padStart(2, "0")}`]); h += r.h;
        for (const [k, v] of Object.entries(r.g)) g[k] = (g[k] || 0) + v;
      }
      if (!days) continue;
      const isCur = y === CY && q === Math.floor(snap.getUTCMonth() / 3);
      const full = !isCur || (snap.getUTCMonth() === q * 3 + 2 && snap.getUTCDate() === dim(y, q * 3 + 2));
      if (!full && days < 30) continue;
      out.push({ y, q, label: `Q${q + 1} ${y}`, partial: !full, days, perWeek: h / (days / 7), g: Object.fromEntries(LG.map(x => [x.key, (g[x.key] || 0) / (days / 7)])) });
    }
    return out;
  }

  // ---------- Written read ----------
  function change(a, b) { // b relative to a
    if (a < 0.05 && b < 0.05) return "about the same";
    if (!a) return "new";
    const p = (b - a) / a * 100;
    return Math.abs(p) < 5 ? "about the same" : `${Math.abs(Math.round(p))}% ${p > 0 ? "higher" : "lower"}`;
  }
  function renderRead() {
    const ys = winYears(), last = ys[ys.length - 1], firstY = ys[0];
    const Y = Object.fromEntries(ys.map(y => [y, metrics(D.ytd[y])]));
    const L = Y[last], P = [];
    const scope = walks ? "" : " (not counting walks and hikes)";
    // 1. Volume, like for like
    const vs = ys.slice(0, -1).reverse().map(y => `${change(Y[y].perWeek, L.perWeek)} than the same span of ${y} (${h1(Y[y].perWeek)})`);
    P.push(`<b>Volume.</b> Between 1 Jan and ${snapLabel}, ${last} averaged ${h1(L.perWeek)} h a week${scope}: ${vs.join(", and ")}.` +
      (ys.length > 2 ? ` Over full calendar years, ${ys[0]} averaged ${h1(metrics(D.years[ys[0]]).perWeek)} h a week and ${ys[1]} ${h1(metrics(D.years[ys[1]]).perWeek)}.` : ""));
    // 2. Consistency and sessions
    const andJoin = (a, sep) => a.length > 1 ? a.slice(0, -1).join(sep) + sep + "and " + a[a.length - 1] : a.join("");
    const cons = andJoin(ys.map(y => `${Y[y].act} of ${Y[y].wk} weeks in ${y}`), ", ");
    const sess = andJoin(ys.map(y => `${h1(Y[y].sessW)} sessions a week averaging ${Math.round(Y[y].sess)} min in ${y}`), "; ");
    P.push(`<b>Consistency.</b> Over the same dates, at least one activity in ${cons}. That is ${sess}.`);
    // 3. What changed, by group (first vs last year of the window, same dates)
    const F = Y[firstY], moves = [], flat = [];
    for (const g of groups()) {
      const a = F.gw[g.key], b = L.gw[g.key], d = b - a;
      if (Math.abs(d) < 0.05) { if (a >= 0.05 || b >= 0.05) flat.push(`${g.name} (${h1(b)})`); continue; }
      moves.push({ g, a, b, d });
    }
    moves.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    let t = `<b>What changed.</b> Compared with the same dates in ${firstY}, in hours a week: `;
    t += moves.length ? moves.map(m => `${m.g.name} ${m.d > 0 ? "up" : "down"} from ${h1(m.a)} to ${h1(m.b)}`).join("; ") : "no group moved by more than 0.05";
    t += flat.length ? `. About the same: ${flat.join(", ")}.` : ".";
    if (ys.length > 2) {
      const M = Y[ys[1]], mid = groups().map(g => ({ g, d: L.gw[g.key] - M.gw[g.key] })).filter(x => Math.abs(x.d) >= 0.05).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      if (mid.length) t += ` Against ${ys[1]} alone, the biggest move was ${mid[0].g.name} (${sign(mid[0].d)}${h1(Math.abs(mid[0].d))} h a week).`;
    }
    P.push(t);
    // 4. Mix
    const share = y => { const r = Y[y]; const top = groups().map(g => [g, r.g[g.key] || 0]).sort((a, b) => b[1] - a[1])[0]; return { top, pct: pct(top[1], r.h) }; };
    const sL = share(last), sF = share(firstY);
    P.push(`<b>Mix.</b> ${sL.top[0].name} was the largest group in ${last} so far, ${sL.pct}% of hours; ` +
      (sF.top[0].key === sL.top[0].key ? `it was ${pct(F.g[sL.top[0].key] || 0, F.h)}% over the same dates in ${firstY}.` : `over the same dates in ${firstY} the largest was ${sF.top[0].name} (${sF.pct}%).`));
    // 5. Quarters
    const Q = quarterSeries(firstY).filter(q => !q.partial);
    if (Q.length > 2) {
      const peak = Q.reduce((a, b) => (b.perWeek > a.perWeek ? b : a)), low = Q.reduce((a, b) => (b.perWeek < a.perWeek ? b : a)), lq = Q[Q.length - 1];
      P.push(`<b>By quarter.</b> Across ${Q[0].label} to ${lq.label}, the busiest quarter was ${peak.label} at ${h1(peak.perWeek)} h a week and the quietest ${low.label} at ${h1(low.perWeek)}. The latest full quarter, ${lq.label}, averaged ${h1(lq.perWeek)}.`);
    }
    $("lb-read").innerHTML = P.map(p => `<p>${p}</p>`).join("");
  }

  // ---------- Year columns ----------
  function mixBar(g, h) {
    return `<span class="lb-bar">${groups().filter(x => g[x.key]).map(x => `<span style="width:${(g[x.key] / h * 100).toFixed(2)}%;background:${x.color}" title="${esc(x.name)} ${pct(g[x.key], h)}%"></span>`).join("")}</span>`;
  }
  function renderYears() {
    const ys = winYears();
    $("lb-years").innerHTML = ys.map(y => {
      const s = D.years[y], m = metrics(s);
      const top = Object.entries(m.t).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, h]) => `${esc(tname(t))} ${pct(h, m.h)}%`).join(" \u00b7 ");
      return `<article class="lb-year card">
        <h3>${yLabel(y)}<small>${y === CY ? ytdLabel : "Full year"}</small></h3>
        <p class="lb-big"><span class="num">${h1(m.perWeek)}</span> h a week</p>
        <dl>
          <dt>Active weeks</dt><dd>${m.act} of ${m.wk} <small>(${pct(m.act, m.wk)}%)</small></dd>
          <dt>Sessions a week</dt><dd>${h1(m.sessW)}</dd>
          <dt>Avg session</dt><dd>${Math.round(m.sess)} min</dd>
          <dt>Total</dt><dd>${int(m.h)} h <small>\u00b7 ${int(m.n)} sessions</small></dd>
        </dl>
        ${mixBar(m.g, m.h)}
        <p class="lb-top">Top types: ${top || "&ndash;"}</p>
      </article>`;
    }).join("");
  }

  // ---------- Like-for-like YTD ----------
  function renderYtd() {
    const ys = winYears(), last = ys[ys.length - 1], prev = ys.slice(0, -1).reverse();
    const Y = Object.fromEntries(ys.map(y => [y, metrics(D.ytd[y])]));
    const dPct = (a, b) => a ? `${sign(b - a)}${Math.abs(Math.round((b - a) / a * 100))}%` : (b ? "new" : "");
    const rows = [
      ["Hours a week", m => h1(m.perWeek), m => m.perWeek, (a, b) => `${sign(b - a)}${h1(Math.abs(b - a))} h`, true],
      ["Active weeks", m => `${m.act}<small>/${m.wk}</small>`, m => m.act, (a, b) => `${sign(b - a)}${Math.abs(b - a)} wk`, true],
      ["Sessions a week", m => h1(m.sessW), m => m.sessW, (a, b) => `${sign(b - a)}${h1(Math.abs(b - a))}`, true],
      ["Avg session", m => `${Math.round(m.sess)}<small> min</small>`, m => m.sess, (a, b) => `${sign(b - a)}${Math.abs(Math.round(b - a))} min`, true],
      ["Total hours", m => int(m.h), m => m.h, (a, b) => `${sign(b - a)}${int(Math.abs(b - a))} h`, true]
    ];
    const gRows = groups().map(g => [`<span class="sw" style="background:${g.color}"></span>${esc(g.name)}`, m => h2(m.gw[g.key]), m => m.gw[g.key], (a, b) => `${sign(b - a)}${h2(Math.abs(b - a))}`, true]);
    const head = `<thead><tr><th>${esc(ytdLabel)}</th>${ys.map(y => `<th class="num">${y}</th>`).join("")}${prev.map(y => `<th class="num delta">${last} vs ${y}</th>`).join("")}</tr></thead>`;
    const line = ([label, fmt, val, dfmt]) => `<tr><th scope="row">${label}</th>${ys.map(y => `<td class="num">${fmt(Y[y])}</td>`).join("")}` +
      prev.map(y => { const a = val(Y[y]), b = val(Y[last]); return `<td class="num delta">${dfmt(a, b)}<small>${dPct(a, b)}</small></td>`; }).join("") + `</tr>`;
    $("lb-ytd").innerHTML = head + `<tbody>${rows.map(line).join("")}<tr class="sub"><th colspan="${1 + ys.length + prev.length}">Hours a week by group</th></tr>${gRows.map(line).join("")}</tbody>`;
  }

  // ---------- Monthly trend chart ----------
  function el(name, attrs, text) { const e = document.createElementNS(svgNS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  function niceStep(max, n) { const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p; return 10 * p; }
  let months = [];
  function renderChart() {
    const ys = winYears(), svg = $("lb-chart"), wrap = $("lb-chart-wrap");
    months = monthSeries(ys[0]);
    const W = Math.max(280, wrap.clientWidth), H = W < 520 ? 210 : 260, small = W < 520;
    const m = { l: 30, r: 6, t: 18, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const N = months.length, bw = pw / N;
    const yAvg = Object.fromEntries(ys.map(y => [y, metrics(D.years[y]).perWeek]));
    const ymax0 = Math.max(1, ...months.map(x => x.perWeek), ...Object.values(yAvg));
    const step = niceStep(ymax0, 4), ymax = Math.ceil(ymax0 / step) * step, y = v => m.t + ph - v / ymax * ph;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H);
    while (svg.lastChild && svg.lastChild.nodeName !== "desc") svg.removeChild(svg.lastChild);
    for (let v = 0; v <= ymax + 1e-9; v += step) {
      svg.appendChild(el("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      svg.appendChild(el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, String(+v.toFixed(2))));
    }
    months.forEach((mo, i) => {
      const x = m.l + i * bw, g = el("g", mo.partial ? { opacity: 0.45 } : {}); let acc = 0;
      for (const grp of groups()) {
        const v = mo.g[grp.key]; if (!v) continue;
        g.appendChild(el("rect", { x: x + bw * 0.12, width: Math.max(1, bw * 0.76), y: y(acc + v), height: Math.max(0.5, y(acc) - y(acc + v)), fill: grp.color }));
        acc += v;
      }
      svg.appendChild(g);
      if (mo.m === 0) {
        svg.appendChild(el("line", { class: "yr", x1: x, x2: x, y1: m.t - 14, y2: m.t + ph }));
        svg.appendChild(el("text", { x: x + 4, y: m.t - 5, class: "yrl" }, mo.y === CY ? `${mo.y} YTD` : String(mo.y)));
      }
      if (small ? mo.m % 6 === 0 : mo.m % 3 === 0) svg.appendChild(el("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle" }, MON[mo.m]));
    });
    // Calendar-year average h/week (the current year: year to date)
    for (const yr of ys) {
      const idx = months.map((mo, i) => (mo.y === yr ? i : -1)).filter(i => i >= 0); if (!idx.length) continue;
      const x1 = m.l + idx[0] * bw + 2, x2 = m.l + (idx[idx.length - 1] + 1) * bw - 2;
      svg.appendChild(el("line", { class: "yavg", x1, x2, y1: y(yAvg[yr]), y2: y(yAvg[yr]) }));
    }
    svg.appendChild(el("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
    const hover = el("rect", { class: "hover", y: m.t, height: ph, width: bw, x: -999 }); svg.appendChild(hover);
    const pick = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width), i = Math.floor((px - m.l) / bw);
      if (i < 0 || i >= N) return hideTip();
      const mo = months[i]; hover.setAttribute("x", m.l + i * bw);
      const tip = $("lb-tip"), rows = groups().filter(g => mo.g[g.key] >= 0.05).map(g => `<span class="row"><span><span class="sw" style="background:${g.color}"></span> ${esc(g.name)}</span><span>${h1(mo.g[g.key])}</span></span>`).join("");
      tip.innerHTML = `<b>${MON[mo.m]} ${mo.y}${mo.partial ? " (so far)" : ""}</b>${h1(mo.perWeek)} h a week \u00b7 ${int(mo.n)} sessions${rows}`;
      tip.hidden = false;
      const tw = tip.offsetWidth, cx = (m.l + (i + 0.5) * bw) * (r.width / W);
      tip.style.left = Math.max(0, Math.min(r.width - tw, cx + 12 + tw > r.width ? cx - tw - 12 : cx + 12)) + "px"; tip.style.top = "8px";
    };
    svg.onpointermove = pick; svg.onpointerdown = pick; svg.onpointerleave = hideTip;
    const lastM = months[months.length - 1];
    const part = lastM && lastM.partial ? ` ${MON[lastM.m]} ${CY} is so far (pale).`
      : (lastM && (lastM.y !== CY || lastM.m !== snap.getUTCMonth()) ? ` ${MON[snap.getUTCMonth()]} ${CY} is left out: only ${snap.getUTCDate()} day${snap.getUTCDate() > 1 ? "s" : ""} so far.` : "");
    $("lb-chart-note").textContent = `Each bar is a calendar month, as hours per week (month total \u00f7 weeks in the month). The red dashes mark each year's average.${part}`;
  }
  function hideTip() { const t = $("lb-tip"); if (t) t.hidden = true; const h = document.querySelector("#lb-chart .hover"); if (h) h.setAttribute("x", -999); }

  // ---------- Quarterly small multiples ----------
  const fv = v => (v < 0.95 ? h2(v) : h1(v));
  function renderMulti() {
    const ys = winYears(), Q = quarterSeries(ys[0]), N = Q.length, box = $("lb-multi");
    const cw = Math.max(260, box.clientWidth), cols = cw >= 900 ? 5 : cw >= 520 ? 3 : 2, gap = cols === 2 ? 16 : 24;
    box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`; box.style.columnGap = gap + "px";
    const W = Math.floor((cw - gap * (cols - 1)) / cols), H = 100, m = { l: 4, r: 4, t: 16, b: 18 }, pw = W - m.l - m.r, ph = H - m.t - m.b, bw = pw / N;
    $("lb-multi").innerHTML = groups().map(g => {
      const vals = Q.map(q => q.g[g.key]), max = Math.max(...vals);
      const full = Q.filter(q => !q.partial), a = full.length ? full[0].g[g.key] : 0, b = full.length ? full[full.length - 1].g[g.key] : 0;
      let s = "";
      Q.forEach((q, i) => {
        const x = m.l + i * bw, v = vals[i], hh = max ? v / max * ph : 0;
        if (q.q === 0 && i) s += `<line class="yr" x1="${x}" x2="${x}" y1="${m.t + 2}" y2="${m.t + ph}"/>`;
        if (q.q === 0 || i === 0) s += `<text x="${x + 2}" y="${H - 5}">${q.y}</text>`;
        s += `<rect x="${(x + bw * 0.15).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" y="${(m.t + ph - hh).toFixed(1)}" height="${Math.max(v > 0 ? 0.8 : 0, hh).toFixed(1)}" fill="${g.color}"${q.partial ? ' opacity="0.45"' : ""}><title>${q.label}${q.partial ? " (so far)" : ""}: ${h2(v)} h a week</title></rect>`;
        if (v === max && max > 0) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${(m.t + ph - hh - 3).toFixed(1)}" text-anchor="middle" class="pk">${h1(v)}</text>`;
      });
      s += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
      const d = b - a, dir = Math.abs(d) < 0.05 ? "about the same" : d > 0 ? "up" : "down";
      return `<figure class="lb-panel"><figcaption><span class="sw" style="background:${g.color}"></span>${esc(g.name)}<small>${full.length ? `${full[0].label}: ${fv(a)} \u2192 ${full[full.length - 1].label}: ${fv(b)} h a week (${dir})` : ""}</small></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(g.name)} hours a week by quarter">${s}</svg></figure>`;
    }).join("");
    const p = Q.filter(q => q.partial);
    $("lb-multi-note").textContent = `Hours a week per calendar quarter. Each panel has its own scale; the number marks its busiest quarter.` + (p.length ? ` ${p[0].label} is so far (pale).` : "");
  }

  // ---------- Controls ----------
  function legend() { $("lb-legend").innerHTML = groups().map(g => `<li><span class="sw" style="background:${g.color}"></span>${esc(g.name)}</li>`).join("") + `<li><span class="sw sw--dash"></span>Year average</li>`; }
  function renderAll() { hideTip(); legend(); renderRead(); renderYears(); renderYtd(); renderChart(); renderMulti(); }
  const cardioTypes = Object.keys(D.typeGroup).filter(t => lg(t) === "cardio").map(tname).join(", ").toLowerCase();
  const otherTypes = Object.keys(D.typeGroup).filter(t => lg(t) === "other").map(tname).join(", ").toLowerCase();
  $("lb-groups").textContent = `Cardio here means ${cardioTypes}.` + (otherTypes ? ` Other means ${otherTypes}.` : "");
  document.querySelectorAll("[data-win]").forEach(b => {
    const n = +b.dataset.win, ys = []; for (let k = n - 1; k >= 0; k--) ys.push(CY - k);
    b.textContent = ys.map(yLabel).join(" \u2192 ");
    b.addEventListener("click", () => { win = n; document.querySelectorAll("[data-win]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderAll(); });
  });
  document.addEventListener("wellness:walks", e => { walks = !!e.detail.walks; renderAll(); });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { hideTip(); renderChart(); renderMulti(); }, 120); });
  $("lb-ytd-title").textContent = `Same dates each year: ${ytdLabel}`;
  renderAll();
})();
