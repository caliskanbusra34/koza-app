/* FitTakip — diyet, kilo, su, egzersiz ve döngü takibi.
 * Tarayıcıda localStorage'a, APK içinde AndroidBridge üzerinden uygulama dosyasına kaydeder.
 * Fotoğraflar IndexedDB'de (küçültülmüş JPEG) tutulur. */
(function () {
  "use strict";

  const SEED_VERSION = 4;
  const DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const DAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const MOODS = ["😄 İyi", "😐 Normal", "😞 Kötü"];
  const EX_TYPES = { "Yürüyüş": 3.5, "Koşu": 9, "Bisiklet": 7, "Pilates": 3, "Yoga": 2.5, "Fitness": 5, "Yüzme": 7, "Dans": 5, "Ev egzersizi": 4, "Merdiven": 8, "Diğer": 4 };
  const SYMPTOMS = ["Kramp", "Baş ağrısı", "Şişkinlik", "Yorgunluk", "Hassasiyet", "Akne", "Ruh hali değişimi", "Tatlı isteği", "Bel ağrısı"];
  const MEASURES = [
    ["weight", "Kilo", "kg"], ["waist", "Bel", "cm"], ["hip", "Basen", "cm"], ["chest", "Göğüs", "cm"],
    ["arm", "Kol", "cm"], ["thigh", "Uyluk", "cm"], ["neck", "Boyun", "cm"], ["bodyFat", "Yağ oranı", "%"],
  ];
  const bridge = window.AndroidBridge || null;

  // ---------------- Yardımcılar ----------------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { if (!k) return null; const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => keyOf(new Date());
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  const mondayOf = (k) => { const d = parseKey(k); const wd = (d.getDay() + 6) % 7; return addDays(k, -wd); };
  const weekday = (k) => (parseKey(k).getDay() + 6) % 7;
  const fmt = (k, o) => new Intl.DateTimeFormat("tr-TR", o).format(parseKey(k));
  const fmtLong = (k) => fmt(k, { day: "numeric", month: "long", weekday: "long" });
  const fmtShort = (k) => fmt(k, { day: "numeric", month: "short" });
  const f1 = (n) => (n == null || isNaN(n) ? "-" : Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
  const num = (v) => { if (v === "" || v == null) return null; const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // ---------------- Depolama ----------------
  const store = {
    load() {
      try { if (bridge) { const s = bridge.load(); return s ? JSON.parse(s) : null; } } catch (e) { /* yoksay */ }
      try { const s = localStorage.getItem("fittakip"); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    },
    save(d) {
      const s = JSON.stringify(d);
      try { if (bridge) { bridge.save(s); return; } } catch (e) { /* yoksay */ }
      try { localStorage.setItem("fittakip", s); } catch (e) { /* önizlemede depolama kapalı olabilir */ }
    },
  };

  const photos = {
    db: null, mem: new Map(), cache: new Map(),
    open() {
      return new Promise((res) => {
        try {
          const r = indexedDB.open("fittakip-photos", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("p");
          r.onsuccess = () => { this.db = r.result; res(); };
          r.onerror = () => res();
        } catch (e) { res(); }
      });
    },
    put(id, dataUrl) {
      this.cache.set(id, dataUrl);
      if (!this.db) { this.mem.set(id, dataUrl); return Promise.resolve(); }
      return new Promise((res) => { const t = this.db.transaction("p", "readwrite"); t.objectStore("p").put(dataUrl, id); t.oncomplete = res; t.onerror = res; });
    },
    get(id) {
      if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
      if (!this.db) return Promise.resolve(this.mem.get(id) || null);
      return new Promise((res) => {
        const r = this.db.transaction("p").objectStore("p").get(id);
        r.onsuccess = () => { if (r.result) this.cache.set(id, r.result); res(r.result || null); };
        r.onerror = () => res(null);
      });
    },
    del(id) {
      this.cache.delete(id); this.mem.delete(id);
      if (this.db) this.db.transaction("p", "readwrite").objectStore("p").delete(id);
    },
  };

  /** Görseli en uzun kenarı 1280px olacak şekilde küçültüp JPEG data URL'e çevirir. */
  function shrink(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, 1280 / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = rej; img.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  // ---------------- Veri ----------------
  function defaults() {
    return {
      profile: { name: "", heightCm: null, planStartDate: mondayOf(todayKey()) },
      goals: { startWeight: null, targetWeight: null, waterGlasses: 8, glassMl: 250, activityMinutes: 60, sleepHours: 8 },
      weeks: [], days: {}, measurements: [], periods: [], shopping: [], recipes: [], seedVersion: 0,
    };
  }

  function normalize(d) {
    const base = defaults();
    d = d && typeof d === "object" ? d : {};
    const out = { ...base, ...d, profile: { ...base.profile, ...(d.profile || {}) }, goals: { ...base.goals, ...(d.goals || {}) } };
    for (const k of ["weeks", "measurements", "periods", "shopping", "recipes"]) if (!Array.isArray(out[k])) out[k] = [];
    if (!out.days || typeof out.days !== "object") out.days = {};
    if (!out.profile.planStartDate) out.profile.planStartDate = mondayOf(todayKey());
    // Plan tohumu: Hafta 1-5 menüleri (plan.js)
    if ((out.seedVersion || 0) < SEED_VERSION) {
      const seed = window.SEED_PLAN || {};
      const byNo = new Map(out.weeks.map((w) => [w.number, w]));
      for (const w of seed.weeks || []) {
        const ex = byNo.get(w.number);
        if (!ex || ex.days.every((dd) => !dd.meals.length)) byNo.set(w.number, JSON.parse(JSON.stringify(w)));
      }
      out.weeks = [...byNo.values()].sort((a, b) => a.number - b.number);
      if (seed.startDate) out.profile.planStartDate = seed.startDate;
      if (seed.goals) {
        if (out.goals.startWeight == null) out.goals.startWeight = seed.goals.startWeight ?? null;
        if (out.goals.targetWeight == null) out.goals.targetWeight = seed.goals.targetWeight ?? null;
      }
      const haveR = new Set(out.recipes.map((r) => r.id));
      for (const r of seed.recipes || []) if (!haveR.has(r.id)) out.recipes.push(JSON.parse(JSON.stringify(r)));
      out.seedVersion = SEED_VERSION;
    }
    return out;
  }

  let D = normalize(store.load());
  const dayLog = (k) => D.days[k] || { water: 0, completedMeals: [], mealPhotos: {}, dayPhotos: [], snacks: [], exercises: [], sleepHours: null, mood: null, note: "" };
  function updDay(k, fn) {
    const cur = dayLog(k);
    const c = { water: 0, completedMeals: [], mealPhotos: {}, dayPhotos: [], snacks: [], exercises: [], sleepHours: null, mood: null, note: "", ...cur };
    const next = fn(c) || c;
    next.u = Date.now(); // gün bazında eşitleme için son değişiklik zamanı
    D.days[k] = next;
  }

  // ---------------- Plan takvimi ----------------
  const Plan = {
    pos(k) { const n = diffDays(D.profile.planStartDate, k); if (n < 0) return null; return { week: Math.floor(n / 7) + 1, day: n % 7 }; },
    dateOf(week, day) { return addDays(D.profile.planStartDate, (week - 1) * 7 + day); },
    week(n) { return D.weeks.find((w) => w.number === n); },
    meals(k) { const p = this.pos(k); if (!p) return []; const w = this.week(p.week); return (w && w.days[p.day] && w.days[p.day].meals) || []; },
  };

  // ---------------- Uyum skoru ----------------
  /** Uyum % = tamamlanan öğün oranı × 80 + su hedefi oranı × 20 (kaloriye dayalı değildir). */
  /** Öğündeki maddelerin işaret durumu. Öğün completedMeals'teyse (ör. widget'tan) tüm maddeler işaretli sayılır. */
  function itemState(log, m) {
    const n = m.items.length;
    if ((log.completedMeals || []).includes(m.id)) return { checked: new Set(m.items.map((_, i) => i)), n, frac: 1 };
    const checked = new Set(((log.completedItems || {})[m.id] || []).filter((i) => i < n));
    return { checked, n, frac: n ? checked.size / n : 0 };
  }

  const Comp = {
    day(k) {
      const meals = Plan.meals(k), log = dayLog(k);
      const fracs = meals.map((m) => itemState(log, m).frac);
      const done = fracs.filter((f) => f >= 1).length;
      const sum = fracs.reduce((a, f) => a + f, 0);
      const water = clamp((log.water || 0) / Math.max(1, D.goals.waterGlasses), 0, 1);
      const pct = meals.length ? (sum / meals.length) * 80 + water * 20 : water * 100;
      return { pct: Math.round(pct), done, total: meals.length, water };
    },
    range(keys) { const t = todayKey(); const ks = keys.filter((k) => k <= t); return ks.length ? Math.round(ks.reduce((s, k) => s + this.day(k).pct, 0) / ks.length) : 0; },
    week(monday) { return this.range([0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i))); },
    label(p) { return p >= 90 ? "Mükemmel" : p >= 70 ? "Çok iyi" : p >= 50 ? "İyi" : p >= 25 ? "Gelişiyor" : p > 0 ? "Zorlandı" : "Es geçildi"; },
  };

  // ---------------- Hedef ----------------
  const Goal = {
    weights() { return D.measurements.filter((m) => m.weight != null).sort((a, b) => (a.date < b.date ? -1 : 1)); },
    stats() {
      const ws = this.weights();
      const start = D.goals.startWeight ?? (ws[0] && ws[0].weight) ?? null;
      // Ölçüm yoksa güncel kilo = başlangıç (önceden ws.length 0 olunca 0 kg sayılıyordu)
      const current = ws.length ? ws[ws.length - 1].weight : start;
      const target = D.goals.targetWeight;
      const lost = start != null && current != null ? start - current : null;
      const remaining = current != null && target != null ? Math.max(0, current - target) : null;
      const progress = start != null && current != null && target != null && start !== target ? clamp((start - current) / (start - target), 0, 1) : 0;
      const h = D.profile.heightCm;
      const bmi = h && current ? current / ((h / 100) ** 2) : null;
      return { start, current, target, lost, remaining, progress, bmi };
    },
    message(s) {
      if (s.lost == null) return "İlk ölçümünü kaydederek yolculuğuna başla!";
      if (s.remaining != null && s.remaining <= 0) return "Tebrikler, hedefine ulaştın! 🎉";
      if (s.lost > 0 && s.remaining != null) return `${f1(s.lost)} kg verdin, hedefine ${f1(s.remaining)} kg kaldı.`;
      if (s.lost > 0) return `${f1(s.lost)} kg verdin.`;
      if (s.lost < 0) return `Başlangıca göre ${f1(-s.lost)} kg fazlası var. Yeniden başlamak için iyi bir gün.`;
      return s.remaining != null ? `Hedefine ${f1(s.remaining)} kg kaldı.` : "Hedef kilonu girerek ilerlemeni gör.";
    },
    bmiLabel(b) { return b < 18.5 ? "Zayıf" : b < 25 ? "Normal" : b < 30 ? "Fazla kilolu" : "Obez"; },
  };

  // ---------------- Akıllı döngü tahmini ----------------
  const Cycle = {
    /** Son 6 döngünün ağırlıklı ortalaması (yeni döngüler daha ağırlıklı); 18-50 gün dışındaki değerler elenir. */
    predict(today = todayKey()) {
      const ps = [...D.periods].sort((a, b) => (a.start < b.start ? -1 : 1));
      const starts = [...new Set(ps.map((p) => p.start))];
      const lens = [];
      for (let i = 1; i < starts.length; i++) { const l = diffDays(starts[i - 1], starts[i]); if (l >= 18 && l <= 50) lens.push(l); }
      const last6 = lens.slice(-6);
      let avg = 28;
      if (last6.length) { let ws = 0, s = 0; last6.forEach((l, i) => { s += l * (i + 1); ws += i + 1; }); avg = Math.round(s / ws); }
      const durs = ps.filter((p) => p.end).map((p) => diffDays(p.start, p.end) + 1).filter((x) => x >= 1 && x <= 12).slice(-6);
      const avgP = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 5;
      const last = starts[starts.length - 1] || null;
      let next = last ? addDays(last, avg) : null;
      while (next && next < addDays(today, -avgP)) next = addDays(next, avg);
      const ov = next ? addDays(next, -14) : null;
      let sd = null;
      if (last6.length >= 2) { const m = last6.reduce((a, b) => a + b, 0) / last6.length; sd = Math.sqrt(last6.reduce((a, l) => a + (l - m) ** 2, 0) / last6.length); }
      const confidence = !last6.length ? "Düşük · en az 2 döngü girin" : last6.length < 3 ? "Orta" : sd <= 3 ? "Yüksek" : "Orta · döngüler düzensiz";
      const doc = last ? diffDays(last, today) + 1 : null;
      return { avg, avgP, last, next, ov, fertileStart: ov ? addDays(ov, -5) : null, fertileEnd: ov ? addDays(ov, 1) : null, doc, confidence, count: lens.length, sd };
    },
    phaseOf(k, p) {
      for (const e of D.periods) { const end = e.end || addDays(e.start, p.avgP - 1); if (k >= e.start && k <= end) return "period"; }
      if (p.next) for (let i = 0; i < 3; i++) {
        const ns = addDays(p.next, p.avg * i);
        if (k >= ns && k < addDays(ns, p.avgP)) return "predicted";
        const ov = addDays(ns, -14);
        if (k === ov) return "ovulation";
        if (k >= addDays(ov, -5) && k <= addDays(ov, 1)) return "fertile";
      }
      return "";
    },
    phaseName(doc, p) {
      if (!doc) return "Henüz kayıt yok";
      const ovDay = p.avg - 14;
      if (doc <= p.avgP) return "Menstrüel faz";
      if (doc < ovDay - 1) return "Foliküler faz";
      if (doc <= ovDay + 1) return "Ovulasyon fazı";
      return "Luteal faz";
    },
  };

  // ---------------- Alışveriş listesi üretimi ----------------
  const CATS = [
    ["Meyve & Sebze", "domates salatalık biber marul roka maydanoz dereotu soğan sarımsak elma armut muz çilek portakal mandalina kivi limon brokoli kabak patlıcan havuç ıspanak mantar avokado üzüm şeftali kayısı erik karpuz kavun yeşillik salata sebze meyve nar greyfurt lahana karnabahar fasulye bezelye pırasa turp nane semizotu kereviz enginar bamya patates ananas yaban mersini frambuaz"],
    ["Süt Ürünleri & Yumurta", "süt yoğurt peynir lor kefir ayran yumurta labne kaşar tereyağ cottage krema"],
    ["Et, Tavuk & Balık", "tavuk hindi köfte kıyma balık somon ton levrek çupra biftek bonfile et "],
    ["Tahıl & Bakliyat", "ekmek yulaf bulgur pirinç makarna mercimek nohut kinoa lavaş galeta buğday çavdar karabuğday barbunya erişte müsli granola pilav gevrek wasa grissini"],
    ["Kuruyemiş & Tohum", "ceviz badem fındık kaju chia keten tohum fıstık çekirdek kuru üzüm hurma kuru kayısı kuru incir"],
    ["Yağ, Sos & Baharat", "zeytinyağı zeytin tahin pekmez bal salça sirke baharat tarçın kimyon pul biber nar ekşisi ezmesi reçel hardal"],
    ["İçecek", "çay kahve maden suyu soda yeşil çay"],
  ].map(([n, w]) => [n, w.trim().split(/\s+/)]);
  const catOf = (name) => { const n = " " + name.toLocaleLowerCase("tr-TR") + " "; const c = CATS.find(([, ks]) => ks.some((k) => n.includes(k))); return c ? c[0] : "Diğer"; };
  const QTY = /^\s*((\d+([.,/]\d+)?|yarım|bir|iki|üç|dört|beş|altı|bol|az)\s*(adet|dilim|yemek kaşığı|tatlı kaşığı|çay kaşığı|su bardağı|çay bardağı|kahve fincanı|kase|avuç|porsiyon|kepçe|gr|g|ml|lt|tane|tutam|kaşık|bardak|kibrit kutusu|parmak|orta boy|küçük boy|büyük boy|küçük|orta|büyük)?\s+)+/i;
  function cleanItem(raw) {
    let s = String(raw).trim().replace(/^[-•*·]\s*/, "");
    s = s.replace(/\(.*?\)/g, "").replace(QTY, "").trim().replace(/[.,;:]+$/, "");
    return s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : "";
  }
  function itemsFromWeek(w) {
    const counts = new Map();
    for (const day of w.days) for (const m of day.meals) for (const line of m.items) {
      for (const part of line.split(/\s*(?:,|\+|\bve\b|\bveya\b|\bya da\b|\/)\s*/i)) {
        const c = cleanItem(part); const low = c.toLocaleLowerCase("tr-TR");
        if (c.length < 2 || c.length > 40 || low === "su" || /^\d/.test(low)) continue;
        counts.set(low, { name: c, n: ((counts.get(low) || {}).n || 0) + 1 });
      }
    }
    return [...counts.values()];
  }

  // ---------------- Widget özeti (APK widget'ları bunu okur) ----------------
  function widgetSummary() {
    const t = todayKey(), s = Goal.stats(), p = Cycle.predict(), c = Comp.day(t);
    const upcoming = {};
    for (let i = 0; i < 3; i++) { const k = addDays(t, i); upcoming[k] = Plan.meals(k).map((m) => ({ id: m.id, title: m.title, time: m.time || "", items: m.items.slice(0, 4) })); }
    const pos = Plan.pos(t);
    return {
      accent: (() => { const t = THEMES[D.profile.theme] || THEMES.zeytin; return { light: t.dark ? t.d[6] : t.l[6], dark: t.d[6] }; })(),
      generatedFor: t, waterTarget: D.goals.waterGlasses, glassMl: D.goals.glassMl, compliance: c.pct,
      upcoming, weekNo: pos ? pos.week : null,
      goal: { start: s.start, current: s.current, target: s.target, lost: s.lost, remaining: s.remaining, progress: s.progress, message: Goal.message(s) },
      cycle: D.periods.length ? { next: p.next, avg: p.avg, avgP: p.avgP, last: p.last, ov: p.ov, phase: Cycle.phaseName(p.doc, p) } : null,
    };
  }

  function save(opts = {}) {
    if (!opts.keepStamp) D.updatedAt = Date.now();
    D.widget = widgetSummary();
    store.save(D);
    if (!opts.keepStamp) Sync.schedule();
    if (!opts.silent) render();
  }

  // ---------------- Google Drive eşitleme (yalnızca APK) ----------------
  const Sync = {
    available: !!(bridge && bridge.call),
    state: { connected: false, email: null, busy: false, last: null, error: null },
    pending: new Map(), seq: 0, timer: null,
    call(method, args = {}) {
      return new Promise((res) => { const id = "r" + (++this.seq); this.pending.set(id, res); bridge.call(id, method, JSON.stringify(args)); });
    },
    resolve(id, result) { const r = this.pending.get(id); if (r) { this.pending.delete(id); r(result || { ok: false }); } },
    async init() {
      if (!this.available) return;
      try { this.state.last = +localStorage.getItem("fittakip.lastSync") || null; } catch (e) { /* yoksay */ }
      const s = await this.call("status");
      this.state.connected = !!s.connected; this.state.email = s.email || null;
      if (this.state.connected) this.run(true);
      render();
    },
    async connect() {
      this.state.busy = true; render();
      const r = await this.call("connect");
      this.state.busy = false;
      if (!r.ok) { this.state.error = r.error === "auth" ? "Google izni verilmedi." : r.error; render(); return; }
      this.state.connected = true; this.state.email = r.email; this.state.error = null;
      await this.run(false);
    },
    async disconnect() { await this.call("disconnect"); this.state.connected = false; this.state.email = null; render(); },
    schedule() { if (!this.state.connected) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(true), 20000); },

    /** Gün kayıtları gün gün birleştirilir (en son değişen kazanır); diğer bölümler en son kaydedilen cihazdan alınır. */
    merge(local, remote) {
      const newer = (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
      const out = JSON.parse(JSON.stringify(newer));
      const keys = new Set([...Object.keys(local.days || {}), ...Object.keys(remote.days || {})]);
      out.days = {};
      for (const k of keys) {
        const a = (local.days || {})[k], b = (remote.days || {})[k];
        out.days[k] = !a ? b : !b ? a : ((b.u || 0) > (a.u || 0) ? b : a);
      }
      out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
      return out;
    },
    photoIds(d) {
      const ids = new Set();
      for (const day of Object.values(d.days || {})) {
        (day.dayPhotos || []).forEach((x) => ids.add(x));
        Object.values(day.mealPhotos || {}).forEach((l) => l.forEach((x) => ids.add(x)));
        (day.snacks || []).forEach((s) => s.photo && ids.add(s.photo));
      }
      (d.recipes || []).forEach((r) => r.photo && ids.add(r.photo));
      return [...ids];
    },
    async run(silent) {
      if (this.state.busy || !this.state.connected) return;
      this.state.busy = true; if (!silent) render();
      try {
        const r = await this.call("pull");
        if (!r.ok) throw new Error(r.error === "auth" ? "Google oturumu yenilenmeli; 'Tekrar bağlan'a dokun." : r.error);
        if (r.exists) {
          const remote = JSON.parse(r.data);
          D = normalize(this.merge(D, remote));
          save({ keepStamp: true, silent: true });
        }
        const push = await this.call("push", { data: JSON.stringify(D) });
        if (!push.ok) throw new Error(push.error);
        // Fotoğraflar: eksik olanları yükle / indir
        const remoteSet = new Set(r.photos || []);
        for (const id of this.photoIds(D)) {
          const local = await photos.get(id);
          if (local && !remoteSet.has(id)) await this.call("putPhoto", { id, dataUrl: local });
          else if (!local && remoteSet.has(id)) { const g = await this.call("getPhoto", { id }); if (g.ok) await photos.put(id, g.dataUrl); }
        }
        this.state.last = Date.now(); this.state.error = null;
        try { localStorage.setItem("fittakip.lastSync", String(this.state.last)); } catch (e) { /* yoksay */ }
        if (!silent) toast("Eşitlendi.");
      } catch (e) {
        this.state.error = e.message || "Eşitleme başarısız";
        if (!silent) toast(this.state.error);
      }
      this.state.busy = false;
      if (!ui.sheet || !silent) render(); // açık bir formu arka plan eşitlemesi yüzünden sıfırlama
    },
  };

  function syncCard() {
    const s = Sync.state;
    if (!Sync.available) return `<div class="card"><div class="card-h"><h2>Google ile Eşitleme</h2></div>
      <div class="sub">Google hesabıyla giriş ve Drive yedeklemesi Android uygulamasında çalışır. Tarayıcı önizlemesinde kapalıdır.</div></div>`;
    const last = s.last ? new Date(s.last).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "henüz yok";
    return `<div class="card"><div class="card-h"><h2>Google ile Eşitleme</h2>${s.connected ? `<span class="chip">Bağlı</span>` : ""}</div>
      ${s.connected ? `<div class="sub">${esc(s.email)} · son eşitleme: ${esc(last)}</div>
        <div class="sub">Kayıtların ve fotoğrafların Google Drive'ındaki gizli uygulama klasörüne yedeklenir. Aynı hesapla giriş yapılan başka telefonda geri gelir.</div>
        <div class="wrap"><button class="btn primary" data-act="sync-now" ${s.busy ? "disabled" : ""}>${s.busy ? "Eşitleniyor…" : "Şimdi eşitle"}</button>
        ${s.error ? `<button class="btn" data-act="sync-connect">Tekrar bağlan</button>` : ""}<button class="btn danger" data-act="sync-off">Bağlantıyı kes</button></div>`
      : `<div class="sub">Google hesabınla bağlan; kayıtların Drive'a yedeklensin ve cihazlar arasında eşitlensin.</div>
        <button class="btn primary" data-act="sync-connect" ${s.busy ? "disabled" : ""}>${s.busy ? "Bağlanıyor…" : "Google ile bağlan"}</button>`}
      ${s.error ? `<div class="tiny" style="color:var(--danger)">${esc(s.error)}</div>` : ""}</div>`;
  }

  // ---------------- Temalar ----------------
  // Her tema açık ve koyu görünüm için ayrı renk seti taşır: [bg, kart, kart-2, yazı, soluk yazı, çizgi, vurgu, vurgu-açık, vurgu üstü yazı]
  const THEMES = {
    zeytin: { n: "Zeytin", l: ["#f1f4ec", "#ffffff", "#e6ebdd", "#1f2a17", "#5d6852", "#d5dccb", "#4f7d2b", "#dcebcb", "#ffffff"], d: ["#131711", "#1c2219", "#283023", "#e6ecdc", "#a3ae96", "#34402c", "#9cc66e", "#2f4520", "#14200a"] },
    lavanta: { n: "Lavanta", l: ["#f4f1fa", "#ffffff", "#e9e4f3", "#2a2340", "#6b6385", "#dcd5ea", "#7a5fc2", "#e6def7", "#ffffff"], d: ["#15121d", "#1e1a29", "#2a2538", "#ebe6f6", "#aaa1c2", "#3a3350", "#b4a2f0", "#3a2f5c", "#1a1330"] },
    seftali: { n: "Şeftali", l: ["#fbf3ee", "#ffffff", "#f3e5dc", "#3a2219", "#8a6457", "#ecd8cc", "#d2643e", "#f8ddd1", "#ffffff"], d: ["#1b1310", "#251b17", "#33251f", "#f6e9e2", "#c2a297", "#46342c", "#f09a76", "#4f2a1d", "#2a120a"] },
    gece: { n: "Gece mavisi", dark: true, l: ["#11161f", "#1b2230", "#252e3f", "#e6ebf4", "#93a0b5", "#2f3a4e", "#7cc4a8", "#21413a", "#0b211b"], d: ["#11161f", "#1b2230", "#252e3f", "#e6ebf4", "#93a0b5", "#2f3a4e", "#7cc4a8", "#21413a", "#0b211b"] },
    okyanus: { n: "Okyanus", l: ["#eef5f7", "#ffffff", "#dfecef", "#16323a", "#557079", "#cbdfe4", "#1f7f95", "#d0eaf0", "#ffffff"], d: ["#0f171a", "#162226", "#1f2f34", "#e1eef1", "#94b1b8", "#2b3f45", "#6cc6da", "#173c45", "#06242b"] },
    gul: { n: "Gül", l: ["#fbf1f4", "#ffffff", "#f3e2e8", "#3d1f2a", "#8a5e6c", "#ecd3dc", "#c2466f", "#f7dbe5", "#ffffff"], d: ["#1b1115", "#25181e", "#33222a", "#f6e6ec", "#c39ead", "#46303a", "#ee8cae", "#4a2333", "#2a0c18"] },
    kum: { n: "Kum", l: ["#f6f2ea", "#fffdf9", "#ece5d8", "#2e281e", "#76695a", "#e0d6c5", "#9a6b3c", "#efe0cc", "#ffffff"], d: ["#171410", "#211d17", "#2d2820", "#efe7da", "#b5a792", "#3d362c", "#d6a674", "#43311f", "#26180a"] },
    orman: { n: "Orman", dark: true, l: ["#0f1712", "#16211a", "#1f2d24", "#e1eee5", "#97b0a0", "#2a3c30", "#8fd19e", "#1f4029", "#082010"], d: ["#0f1712", "#16211a", "#1f2d24", "#e1eee5", "#97b0a0", "#2a3c30", "#8fd19e", "#1f4029", "#082010"] },
    bal: { n: "Bal", l: ["#fbf6e9", "#ffffff", "#f2e9d0", "#33290f", "#7d6c43", "#eadfbf", "#b7840f", "#f6e7b8", "#ffffff"], d: ["#18150c", "#221e12", "#2f2a19", "#f3ecd6", "#bfae82", "#423a24", "#e8bf4f", "#473811", "#261c02"] },
  };
  const TOKENS = ["--bg", "--surface", "--surface-2", "--ink", "--muted", "--line", "--leaf", "--leaf-soft", "--on-leaf"];
  const darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function currentTheme() {
    const t = THEMES[D.profile.theme] || THEMES.zeytin;
    const mode = D.profile.themeMode || "auto";
    const dark = t.dark || mode === "dark" || (mode === "auto" && !!(darkMq && darkMq.matches));
    return { t, dark, vals: dark ? t.d : t.l };
  }
  function applyTheme() {
    const { dark, vals } = currentTheme(), root = document.documentElement;
    TOKENS.forEach((k, i) => root.style.setProperty(k, vals[i]));
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.style.colorScheme = dark ? "dark" : "light";
    try { if (bridge && bridge.setBars) bridge.setBars(vals[0], dark); } catch (e) { /* yoksay */ }
  }
  if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", () => { applyTheme(); render(); });

  function themeCard() {
    const mode = D.profile.themeMode || "auto", cur = D.profile.theme || "zeytin";
    return `<div class="card"><div class="card-h"><h2>Tema</h2></div>
      <div class="theme-grid">${Object.entries(THEMES).map(([k, t]) => { const v = t.dark ? t.d : t.l; return `<button class="theme-sw ${k === cur ? "on" : ""}" data-act="theme" data-t="${k}" aria-label="${t.n} teması">
        <span class="sw" style="background:${v[0]};border-color:${v[5]}"><i style="background:${v[1]}"></i><b style="background:${v[6]}"></b></span>${esc(t.n)}</button>`; }).join("")}</div>
      <div class="sub">Görünüm</div>
      <div class="seg">${[["auto", "Otomatik"], ["light", "Açık"], ["dark", "Koyu"]].map(([m, n]) => `<button class="${m === mode ? "on" : ""}" data-act="theme-mode" data-m="${m}">${n}</button>`).join("")}</div>
      ${THEMES[cur] && THEMES[cur].dark ? `<div class="tiny">${THEMES[cur].n} her zaman koyu görünür.</div>` : `<div class="tiny">Otomatik: telefonun açık/koyu ayarını izler.</div>`}</div>`;
  }

  // ---------------- UI durumu ----------------
  const VIEWS = {
    ana: { title: "Ana Sayfa", tab: true }, gunluk: { title: "Günlük", tab: true }, plan: { title: "Planım", tab: true },
    ilerleme: { title: "İlerleme", tab: true }, daha: { title: "Daha Fazla", tab: true },
    dongu: { title: "Döngü Takibi" }, alisveris: { title: "Alışveriş Listesi" }, egzersiz: { title: "Egzersiz" },
    tirtiklama: { title: "Tırtıklama Tablom" }, ayarlar: { title: "Hedefler & Ayarlar" }, olcum: { title: "Haftalık Ölçümler" },
    tarifler: { title: "Tarifler" }, tarif: { title: "Tarif" },
  };
  const RECIPE_CATS = ["Kahvaltı", "Ara öğün", "Ana yemek", "Çorba", "Salata", "İçecek", "Detoks", "Tatlı", "Diğer"];
  const recipeFor = (text) => { const t = text.toLocaleLowerCase("tr-TR"); return D.recipes.find((r) => r.match && t.includes(r.match.toLocaleLowerCase("tr-TR"))); };
  const initialView = (location.hash || "").slice(1);
  const ui = {
    stack: [VIEWS[initialView] ? initialView : "ana"],
    date: todayKey(),
    planWeek: null, planDay: null,
    measureKey: "waist",
    calMonth: todayKey().slice(0, 7),
    shopWeek: null,
    sheet: null, viewer: null, photoTarget: null, toast: null,
  };
  const view = () => ui.stack[ui.stack.length - 1];
  function go(v) {
    if (VIEWS[v].tab) ui.stack = [v]; else ui.stack.push(v);
    try { history.replaceState(null, "", "#" + v); } catch (e) { /* yoksay */ }
    window.scrollTo(0, 0); render();
  }
  function back() { if (ui.stack.length > 1) { ui.stack.pop(); render(); } }
  function toast(msg) { ui.toast = msg; render(); clearTimeout(toast.t); toast.t = setTimeout(() => { ui.toast = null; render(); }, 2200); }

  // ---------------- Küçük bileşenler ----------------
  const ICONS = {
    ana: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    gunluk: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4"/>',
    plan: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
    ilerleme: '<path d="M4 19h16M6 15l4-5 4 3 5-7"/>',
    daha: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  function ring(p, color, size = 76, stroke = 8, label = "") {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<div class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp(p, 0, 1))}"/></svg><b class="num">${label}</b></div>`;
  }
  const bar = (p, color = "var(--leaf)") => `<div class="bar"><i style="width:${clamp(p, 0, 1) * 100}%;background:${color}"></i></div>`;

  function lineChart(pts, color, target) {
    if (pts.length < 2) return `<div class="empty">${pts.length ? "Bir kayıt daha girince grafik oluşacak." : "Grafik için en az 2 kayıt gerekli."}</div>`;
    const W = 340, H = 180, L = 38, R = 12, T = 12, B = 26;
    const vals = pts.map((p) => p.v).concat(target != null ? [target] : []);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 1) { max += 0.5; min -= 0.5; }
    const padv = (max - min) * 0.08; min -= padv; max += padv;
    const x = (i) => L + ((W - L - R) * i) / (pts.length - 1);
    const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
    let g = "";
    for (let i = 0; i <= 3; i++) { const v = min + ((max - min) * i) / 3, yy = y(v); g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="lbl" x="${L - 6}" y="${yy + 3}" text-anchor="end">${f1(v)}</text>`; }
    const step = Math.max(1, Math.ceil(pts.length / 5));
    pts.forEach((p, i) => { if (i % step === 0 || i === pts.length - 1) g += `<text class="lbl" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.l)}</text>`; });
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
    const area = `${d} L${x(pts.length - 1)},${H - B} L${x(0)},${H - B} Z`;
    const tl = target != null ? `<line class="target" x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}"/><text class="lbl" x="${W - R}" y="${y(target) - 4}" text-anchor="end" style="fill:var(--berry)">hedef ${f1(target)}</text>` : "";
    const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="${i === pts.length - 1 ? 5 : 3}" fill="${color}"/>`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${tl}<path class="area" d="${area}" fill="${color}"/><path class="line" d="${d}" stroke="${color}"/>${dots}</svg>`;
  }

  function barChart(items, color, max = 100, unit = "") {
    return `<div style="display:grid;grid-template-columns:repeat(${items.length},1fr);gap:6px;align-items:end;height:130px">${items.map((it) => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
        <span class="tiny num">${it.v}${unit}</span>
        <div style="width:100%;max-width:26px;height:80px;background:var(--surface-2);border-radius:7px;display:flex;align-items:flex-end;overflow:hidden">
          <div style="width:100%;height:${clamp(it.v / max, 0, 1) * 100}%;background:${color};border-radius:7px"></div></div>
        <span class="tiny" style="${it.hl ? "font-weight:700;color:var(--ink)" : ""}">${esc(it.l)}</span></div>`).join("")}</div>`;
  }

  function photoStrip(ids, target) {
    return `<div class="photos">${(ids || []).map((id) => `<img data-ph="${esc(id)}" alt="Fotoğraf" data-act="photo-view" data-id="${esc(id)}" data-target="${esc(target)}">`).join("")}
      <button class="add" data-act="photo-add" data-target="${esc(target)}">📷<br>Fotoğraf</button></div>`;
  }

  function dateSwitch() {
    const k = ui.date;
    return `<div class="row" style="justify-content:space-between">
      <button class="icon-btn" data-act="date-shift" data-n="-1" aria-label="Önceki gün">‹</button>
      <label class="grow" style="text-align:center;font-weight:650;position:relative;cursor:pointer">
        ${k === todayKey() ? "Bugün · " : ""}${esc(fmtLong(k))}
        <input type="date" id="datePick" value="${k}" style="position:absolute;inset:0;opacity:0;cursor:pointer">
      </label>
      <button class="icon-btn" data-act="date-shift" data-n="1" aria-label="Sonraki gün">›</button></div>`;
  }

  // ---------------- Ekranlar ----------------
  function vHome() {
    const t = todayKey(), log = dayLog(t), s = Goal.stats(), c = Comp.day(t), pos = Plan.pos(t);
    const wk = Comp.week(mondayOf(t));
    const meals = Plan.meals(t);
    const minutes = (log.exercises || []).reduce((a, e) => a + (e.minutes || 0), 0);
    const sleep = log.sleepHours || 0;
    const lastM = [...D.measurements].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const needM = !lastM || lastM.date < mondayOf(t);
    let cyc = "";
    if (D.periods.length) {
      const p = Cycle.predict(), dd = p.next ? diffDays(t, p.next) : null;
      cyc = `<div class="card"><div class="card-h"><h2>Döngü</h2><button class="btn ghost small" data-act="go" data-v="dongu">Aç</button></div>
        <div class="row">${ring(p.doc ? p.doc / p.avg : 0, "var(--berry)", 64, 7, p.doc || "-")}
        <div class="grow"><b>${dd == null ? "Tahmin için adet başlangıcı gir." : dd > 0 ? `Sonraki adete tahminen ${dd} gün var` : dd === 0 ? "Adetin bugün başlayabilir" : `Adet dönemi / ${-dd} gün gecikme`}</b>
        <div class="sub">Döngü günü ${p.doc || "-"} · ${Cycle.phaseName(p.doc, p)}${p.next ? " · " + fmtShort(p.next) : ""}</div></div></div></div>`;
    }
    return `
    <div class="hello"><h1>Merhaba${D.profile.name ? ", " + esc(D.profile.name) : ""} 👋</h1>
      <div class="sub">${esc(fmtLong(t))}${pos ? ` · Hafta ${pos.week}, ${DAY_NAMES[pos.day]}` : ""}</div></div>

    <div class="card"><div class="card-h"><h2>Hedefin</h2><button class="btn ghost small" data-act="go" data-v="ilerleme">Detay</button></div>
      <div class="row">${ring(s.progress, "var(--leaf)", 88, 9, "%" + Math.round(s.progress * 100))}
        <div class="grow stack" style="gap:4px"><b style="font-size:16px">${esc(Goal.message(s))}</b>
          <div class="sub num">Başlangıç ${f1(s.start)} kg → Hedef ${f1(s.target)} kg</div>
          <div class="sub num">Güncel ${f1(s.current)} kg${s.bmi ? ` · VKİ ${f1(s.bmi)} (${Goal.bmiLabel(s.bmi)})` : ""}</div></div></div>
      ${s.start == null || s.target == null ? `<button class="btn small" data-act="go" data-v="ayarlar">Başlangıç ve hedef kilonu gir</button>` : ""}
    </div>

    <div class="card"><div class="card-h"><h2>Planına Uygunluk</h2><span class="chip">${Comp.label(c.pct)}</span></div>
      <div class="row">${ring(c.pct / 100, "var(--leaf)", 88, 9, "%" + c.pct)}
        <div class="grow stack" style="gap:3px"><div class="num">Öğün <b>${c.done}/${c.total}</b> · Su <b>${log.water || 0}/${D.goals.waterGlasses}</b></div>
          <div class="sub num">Bu hafta ortalama %${wk}</div></div></div>
      <div class="tiny">Uyum % = Tamamlanan öğün (%80) + su hedefi katkısı (%20). Kaloriye dayalı değildir.</div></div>

    ${waterCard(t)}

    <div class="grid2">
      <button class="card" style="border:0;text-align:left;cursor:pointer" data-act="go" data-v="egzersiz">
        <span class="sub">🏃 Aktivite</span><span class="big num">${minutes} dk</span><span class="tiny">Hedef ${D.goals.activityMinutes} dk</span>${bar(minutes / D.goals.activityMinutes, "var(--sun)")}</button>
      <button class="card" style="border:0;text-align:left;cursor:pointer" data-act="go" data-v="gunluk">
        <span class="sub">🌙 Uyku</span><span class="big num">${f1(sleep)} sa</span><span class="tiny">Hedef ${f1(D.goals.sleepHours)} sa</span>${bar(sleep / D.goals.sleepHours, "var(--plum)")}</button>
    </div>

    <div class="card"><div class="card-h"><h2>Bugünün Menüsü</h2><button class="btn ghost small" data-act="go" data-v="gunluk">Takip et</button></div>
      ${meals.length ? meals.map((m) => mealRow(t, m, true)).join("") : `<div class="empty">Bugün için planlanmış öğün bulunamadı.</div><button class="btn small" data-act="go" data-v="plan">Planı görüntüle</button>`}</div>

    ${cyc}
    ${needM ? `<div class="card"><div class="row"><span class="badge">📏</span><div class="grow"><b>Haftalık ölçüm</b><div class="sub">Bu hafta henüz ölçüm girmedin.</div></div><button class="btn small primary" data-act="measure-edit">Ekle</button></div></div>` : ""}

    <div class="grid2">
      <button class="btn block" data-act="go" data-v="tirtiklama">🍪 Tırtıklama (${(log.snacks || []).length})</button>
      <button class="btn block" data-act="go" data-v="alisveris">🛒 Alışveriş</button>
    </div>`;
  }

  function waterCard(k) {
    const log = dayLog(k), w = log.water || 0, tg = D.goals.waterGlasses, left = tg - w;
    const glasses = Array.from({ length: Math.max(tg, w) }, (_, i) => `<span style="font-size:18px;opacity:${i < w ? 1 : 0.25}">💧</span>`).join("");
    return `<div class="card"><div class="card-h"><h2>Su</h2><span class="chip water num">${w * D.goals.glassMl} ml</span></div>
      <div class="row">${ring(w / tg, "var(--water)", 72, 8, `${w}/${tg}`)}
        <div class="grow"><div class="wrap" style="gap:2px">${glasses}</div><div class="sub">${left > 0 ? `Hedefe ${left} bardak kaldı` : "Su hedefi tamam! 💧"}</div></div>
        <button class="icon-btn" data-act="water" data-n="-1" data-k="${k}" aria-label="Bir bardak çıkar">−</button>
        <button class="icon-btn water" data-act="water" data-n="1" data-k="${k}" aria-label="Bir bardak ekle">+</button></div></div>`;
  }

  /** Öğündeki maddeler; her biri ayrı işaretlenir. */
  function itemList(k, m, st) {
    return `<div class="items">${m.items.map((it, i) => { const r = recipeFor(it); return `<div class="row" style="gap:4px"><button class="item grow ${st.checked.has(i) ? "on" : ""}" data-act="item-toggle" data-k="${k}" data-id="${esc(m.id)}" data-i="${i}">
      <span class="box">✓</span><span>${esc(it)}</span></button>${r ? `<button class="btn ghost small" data-act="recipe-open" data-id="${esc(r.id)}" aria-label="${esc(r.title)} tarifi">📖</button>` : ""}</div>`; }).join("")}</div>`;
  }

  function mealHead(k, m, st, extra = "") {
    const all = st.n > 0 && st.checked.size === st.n, some = st.checked.size > 0 && !all;
    return `<button class="check ${all ? "on" : some ? "part" : ""}" data-act="meal-toggle" data-k="${k}" data-id="${esc(m.id)}" aria-label="${esc(m.title)}: tümünü işaretle">${some ? "–" : "✓"}</button>
      <div class="body"><div class="row" style="gap:6px"><div class="title grow">${esc(m.title)}${m.time ? ` <span class="sub">· ${esc(m.time)}</span>` : ""}</div>
      <span class="sub num">${st.checked.size}/${st.n}</span>${extra}</div>`;
  }

  function mealRow(k, m, compact) {
    const log = dayLog(k), st = itemState(log, m);
    if (compact) {
      return `<div class="meal">${mealHead(k, m, st)}
        <div class="sub">${m.items.map((it, i) => st.checked.has(i) ? `<span class="done-txt">${esc(it)}</span>` : esc(it)).join(", ")}</div></div></div>`;
    }
    return `<div class="meal">${mealHead(k, m, st)}${itemList(k, m, st)}${m.note ? `<div class="note">${esc(m.note)}</div>` : ""}
      ${photoStrip((log.mealPhotos || {})[m.id], `meal|${k}|${m.id}`)}</div></div>`;
  }

  function vDaily() {
    const k = ui.date, log = dayLog(k), meals = Plan.meals(k), c = Comp.day(k), pos = Plan.pos(k);
    return `${dateSwitch()}
    <div class="card"><div class="row">${ring(c.pct / 100, "var(--leaf)", 66, 7, "%" + c.pct)}
      <div class="grow"><h2 style="font-size:17px">Günlük Durum</h2><div class="sub">${c.done}/${c.total} öğün tamamlandı${pos ? ` · Hafta ${pos.week}, ${DAY_NAMES[pos.day]}` : ""}</div></div>
      <span class="chip">${Comp.label(c.pct)}</span></div></div>

    <div class="card"><div class="card-h"><h2>Öğünler</h2></div>
      ${meals.length ? meals.map((m) => mealRow(k, m, false)).join("") : `<div class="empty">Bu gün için planda öğün yok.</div><button class="btn small" data-act="go" data-v="plan">Plana öğün ekle</button>`}</div>

    ${waterCard(k)}
    ${snackCard(k)}
    ${exerciseCard(k)}

    <div class="card"><div class="card-h"><h2>Uyku & Ruh Hali</h2></div>
      <div class="field"><label for="sleepIn">Uyku: <b class="num" id="sleepVal">${f1(log.sleepHours || 0)}</b> saat (hedef ${f1(D.goals.sleepHours)})</label>
        <input type="range" id="sleepIn" min="0" max="12" step="0.5" value="${log.sleepHours || 0}" data-in="sleep" data-k="${k}"></div>
      <div class="sub">Bugün kendini nasıl hissediyorsun?</div>
      <div class="seg">${MOODS.map((m) => `<button class="${log.mood === m ? "on" : ""}" data-act="mood" data-k="${k}" data-m="${esc(m)}">${m}</button>`).join("")}</div></div>

    <div class="card"><div class="card-h"><h2>Not & Günün Fotoğrafları</h2></div>
      <div class="field"><label for="noteIn">Notum</label><textarea id="noteIn" data-in="note" data-k="${k}" placeholder="Bugün nasıl geçti?">${esc(log.note || "")}</textarea></div>
      ${photoStrip(log.dayPhotos, `day|${k}`)}</div>`;
  }

  function snackCard(k) {
    const log = dayLog(k), sn = log.snacks || [];
    const kcal = sn.reduce((a, s) => a + (s.kcal || 0), 0);
    return `<div class="card"><div class="card-h"><h2>Tırtıklama Tablom</h2><button class="btn small primary" data-act="snack-edit" data-k="${k}">+ Ekle</button></div>
      <div class="sub">Menüde olmayan ama gün içinde yediklerin.</div>
      <div>${sn.length ? sn.map((s) => `<div class="list-item">${s.photo ? `<img class="thumb" data-ph="${esc(s.photo)}" alt="">` : `<span class="badge">🍪</span>`}
        <div class="grow"><b>${esc(s.name)}</b><div class="sub">${esc([s.amount, s.time, s.kcal ? s.kcal + " kcal" : ""].filter(Boolean).join(" · "))}</div></div>
        <button class="btn ghost small" data-act="snack-edit" data-k="${k}" data-id="${esc(s.id)}">Düzenle</button></div>`).join("") : `<div class="empty">Tırtıklama yok 👏</div>`}</div>
      ${kcal ? `<div class="sub num">Toplam ~${kcal} kcal</div>` : ""}</div>`;
  }

  function exerciseCard(k) {
    const log = dayLog(k), ex = log.exercises || [], min = ex.reduce((a, e) => a + (e.minutes || 0), 0);
    return `<div class="card"><div class="card-h"><h2>Egzersiz</h2><button class="btn small primary" data-act="ex-edit" data-k="${k}">+ Ekle</button></div>
      <div class="row"><b class="num">${min} / ${D.goals.activityMinutes} dk</b><div class="grow">${bar(min / D.goals.activityMinutes, "var(--sun)")}</div></div>
      <div>${ex.map((e) => `<div class="list-item"><span class="badge">🏃</span><div class="grow"><b>${esc(e.type)} · ${e.minutes} dk</b>
        <div class="sub">${esc([e.kcal ? "~" + e.kcal + " kcal" : "", e.steps ? e.steps + " adım" : "", e.note].filter(Boolean).join(" · "))}</div></div>
        <button class="btn ghost small" data-act="ex-edit" data-k="${k}" data-id="${esc(e.id)}">Düzenle</button></div>`).join("")}</div></div>`;
  }

  function vPlan() {
    const t = todayKey(), cur = Plan.pos(t);
    if (ui.planWeek == null) ui.planWeek = (cur && Plan.week(cur.week) ? cur.week : (D.weeks[0] && D.weeks[0].number)) || 1;
    const w = Plan.week(ui.planWeek);
    if (ui.planDay == null) ui.planDay = cur && cur.week === ui.planWeek ? cur.day : 0;
    const dk = Plan.dateOf(ui.planWeek, ui.planDay);
    const weekStart = Plan.dateOf(ui.planWeek, 0);
    const wc = Comp.week(weekStart);
    const meals = (w && w.days[ui.planDay] && w.days[ui.planDay].meals) || [];
    const dayLogK = dayLog(dk);
    return `
    <div class="card"><div class="row"><div class="grow"><h2 style="font-size:18px">Hafta ${ui.planWeek} Beslenme Planı</h2>
      <div class="sub">${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}${cur && cur.week === ui.planWeek ? " · Bu hafta" : ""}</div></div>
      <span class="chip num">Uyum %${wc}</span></div>
      <div class="wrap"><button class="btn small" data-act="go" data-v="alisveris" data-week="${ui.planWeek}">🛒 Alışveriş listesi</button>
      <button class="btn small" data-act="plan-start">📅 Başlangıç: ${fmtShort(D.profile.planStartDate)}</button></div></div>

    <div class="seg">${D.weeks.map((x) => `<button class="${x.number === ui.planWeek ? "on" : ""}" data-act="plan-week" data-n="${x.number}">Hafta ${x.number}<small>${fmtShort(Plan.dateOf(x.number, 0))}</small></button>`).join("")}
      <button data-act="week-add">+ Hafta</button></div>

    ${w && w.note ? `<div class="card"><div class="card-h"><h2>Plan Notları</h2></div><div class="stack" style="gap:4px">${w.note.split("\n").map((l) => `<div class="sub" style="color:var(--ink)">${esc(l)}</div>`).join("")}</div></div>` : ""}
    ${w ? `<div class="seg">${DAY_SHORT.map((d, i) => { const k = Plan.dateOf(ui.planWeek, i); return `<button class="${i === ui.planDay ? "on" : ""}" data-act="plan-day" data-n="${i}">${d}<small>${fmt(k, { day: "numeric" })}${k === t ? " •" : ""}</small></button>`; }).join("")}</div>
    <div class="card"><div class="card-h"><h2>${DAY_NAMES[ui.planDay]} <span class="sub">${esc(fmtShort(dk))}</span></h2>
      <span class="sub num">${meals.filter((m) => itemState(dayLogK, m).frac >= 1).length}/${meals.length} öğün</span></div>
      ${meals.length ? meals.map((m) => { const st = itemState(dayLogK, m); return `<div class="meal">${mealHead(dk, m, st, `<button class="btn ghost small" data-act="meal-edit" data-id="${esc(m.id)}">Düzenle</button>`)}
        ${itemList(dk, m, st)}${m.note ? `<div class="note">${esc(m.note)}</div>` : ""}
        ${photoStrip((dayLogK.mealPhotos || {})[m.id], `meal|${dk}|${m.id}`)}</div></div>`; }).join("") : `<div class="empty">Bu gün için öğün yok.</div>`}
      <div class="wrap"><button class="btn small primary" data-act="meal-edit">+ Öğün ekle</button>
        ${ui.planDay > 0 ? `<button class="btn small" data-act="day-copy">Önceki günü kopyala</button>` : ""}</div></div>
    <div class="wrap"><button class="btn small" data-act="week-copy">Bu haftayı yeni haftaya kopyala</button>
      <button class="btn small danger" data-act="week-del">Haftayı sil</button></div>`
      : `<div class="card"><div class="empty">Henüz plan haftası yok.</div><button class="btn primary" data-act="week-add">Hafta ekle</button></div>`}`;
  }

  function vProgress() {
    const s = Goal.stats(), ws = Goal.weights();
    const mk = MEASURES.find((m) => m[0] === ui.measureKey);
    const mpts = D.measurements.filter((m) => m[ui.measureKey] != null).sort((a, b) => (a.date < b.date ? -1 : 1)).map((m) => ({ l: fmtShort(m.date), v: m[ui.measureKey] }));
    // plan haftalarına göre uyum
    const weeksComp = D.weeks.filter((w) => Plan.dateOf(w.number, 0) <= todayKey()).map((w) => ({ l: "H" + w.number, v: Comp.week(Plan.dateOf(w.number, 0)) }));
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(todayKey(), i - 6)).map((k) => ({ l: DAY_SHORT[weekday(k)], v: Comp.day(k).pct, hl: k === todayKey() }));
    const sorted = [...D.measurements].sort((a, b) => (a.date < b.date ? 1 : -1));
    return `
    <div class="card"><div class="card-h"><h2>Kilo Hedefi</h2><button class="btn ghost small" data-act="go" data-v="ayarlar">Hedefi düzenle</button></div>
      <b style="font-size:16px">${esc(Goal.message(s))}</b>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr);text-align:center">
        <div><div class="tiny">Verilen</div><div class="mid num" style="color:var(--leaf)">${s.lost != null ? f1(s.lost) : "-"} kg</div></div>
        <div><div class="tiny">Kalan</div><div class="mid num" style="color:var(--berry)">${f1(s.remaining)} kg</div></div>
        <div><div class="tiny">Güncel</div><div class="mid num">${f1(s.current)} kg</div></div></div>
      ${bar(s.progress)}<div class="row sub num" style="justify-content:space-between"><span>Başlangıç ${f1(s.start)} kg</span><span>%${Math.round(s.progress * 100)}</span><span>Hedef ${f1(s.target)} kg</span></div>
      ${s.bmi ? `<div class="sub">Vücut kitle indeksi: <b class="num">${f1(s.bmi)}</b> (${Goal.bmiLabel(s.bmi)})</div>` : ""}</div>

    <div class="card"><div class="card-h"><h2>Kilo Grafiği</h2><button class="btn small primary" data-act="measure-edit">+ Ölçüm</button></div>
      ${lineChart(ws.map((m) => ({ l: fmtShort(m.date), v: m.weight })), "var(--leaf)", s.target)}</div>

    <div class="card"><div class="card-h"><h2>Vücut Ölçüleri</h2></div>
      <div class="seg">${MEASURES.slice(1).map(([k, n]) => `<button class="${k === ui.measureKey ? "on" : ""}" data-act="mkey" data-k="${k}">${n}</button>`).join("")}</div>
      ${lineChart(mpts, "var(--water)", null)}
      ${mpts.length >= 2 ? `<div class="sub num">İlk ölçüme göre: <b>${f1(mpts[mpts.length - 1].v - mpts[0].v)} ${mk[2]}</b></div>` : ""}</div>

    <div class="card"><div class="card-h"><h2>Plan Uyumu · Son 7 Gün</h2></div>${barChart(last7, "var(--leaf)", 100)}</div>
    ${weeksComp.length ? `<div class="card"><div class="card-h"><h2>Haftalara Göre Uyum</h2></div>${barChart(weeksComp.slice(-8), "var(--leaf)", 100)}</div>` : ""}

    <div class="card"><div class="card-h"><h2>Ölçüm Geçmişi</h2></div>
      ${sorted.length ? sorted.map((m, i) => {
        const prev = sorted[i + 1];
        const vals = MEASURES.filter(([k]) => m[k] != null).map(([k, n, u]) => {
          const d = prev && prev[k] != null ? m[k] - prev[k] : null;
          return `<span class="chip ${k === "weight" ? "" : "muted"} num">${n} ${f1(m[k])}${u === "%" ? "%" : ""}${d ? ` (${d > 0 ? "+" : ""}${f1(d)})` : ""}</span>`;
        }).join("");
        return `<div class="list-item"><div class="grow"><b>${esc(fmt(m.date, { day: "numeric", month: "long", year: "numeric" }))}</b><div class="wrap" style="margin-top:4px">${vals}</div>${m.note ? `<div class="sub">${esc(m.note)}</div>` : ""}</div>
        <button class="btn ghost small" data-act="measure-edit" data-id="${esc(m.id)}">Düzenle</button></div>`;
      }).join("") : `<div class="empty">Henüz ölçüm yok. Haftada bir kilo, bel, basen gibi ölçülerini gir.</div>`}</div>`;
  }

  function vMore() {
    const p = D.periods.length ? Cycle.predict() : null;
    const t = todayKey();
    const tiles = [
      ["dongu", "🌸", "Döngü Takibi", p && p.next ? `Sonraki: ${fmtShort(p.next)}` : "Adet döngünü kaydet", "var(--berry-soft)"],
      ["alisveris", "🛒", "Alışveriş Listesi", `${D.shopping.filter((s) => !s.checked).length} ürün`, "var(--leaf-soft)"],
      ["egzersiz", "🏃", "Egzersiz", `Bugün ${(dayLog(t).exercises || []).reduce((a, e) => a + e.minutes, 0)} dk`, "var(--sun-soft)"],
      ["tirtiklama", "🍪", "Tırtıklama Tablom", `Bugün ${(dayLog(t).snacks || []).length} kayıt`, "var(--sun-soft)"],
      ["tarifler", "📖", "Tarifler", `${D.recipes.length} tarif`, "var(--leaf-soft)"],
      ["olcum", "📏", "Haftalık Ölçümler", `${D.measurements.length} kayıt`, "var(--water-soft)"],
      ["ayarlar", "⚙️", "Hedefler & Ayarlar", "Hedef, profil, yedek", "var(--surface-2)"],
    ];
    return `<div class="more-grid">${tiles.map(([v, e, n, s, bg]) => `<button class="tile" data-act="go" data-v="${v}"><span class="badge" style="background:${bg}">${e}</span><b>${n}</b><span class="sub">${esc(s)}</span></button>`).join("")}</div>`;
  }

  function vCycle() {
    const t = todayKey(), p = Cycle.predict();
    const open = D.periods.find((e) => !e.end && diffDays(e.start, t) < 12);
    const dd = p.next ? diffDays(t, p.next) : null;
    const [yy, mm] = ui.calMonth.split("-").map(Number);
    const first = `${yy}-${pad(mm)}-01`, startCell = addDays(first, -weekday(first));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(startCell, i));
    const monthName = fmt(first, { month: "long", year: "numeric" });
    return `
    <div class="card"><div class="row">${ring(p.doc ? p.doc / p.avg : 0, "var(--berry)", 92, 9, p.doc ? p.doc + ". gün" : "-")}
      <div class="grow stack" style="gap:3px"><b style="font-size:16px">${!p.last ? "Son adet başlangıcını girerek başla." : open ? `Adet dönemindesin (${diffDays(open.start, t) + 1}. gün)` : dd > 0 ? `Sonraki adete ~${dd} gün` : dd === 0 ? "Adetin bugün başlayabilir" : `${-dd} gün gecikme`}</b>
        <div class="sub">${Cycle.phaseName(p.doc, p)}</div>
        ${p.next ? `<div class="sub num">Tahmini adet: ${fmtShort(p.next)} · Yumurtlama: ${fmtShort(p.ov)}</div>` : ""}</div></div>
      <div class="wrap">${open ? `<button class="btn primary" data-act="period-end" data-id="${open.id}">Adet bitti (bugün)</button>` : `<button class="btn primary" style="background:var(--berry);color:#fff" data-act="period-start">Adet başladı (bugün)</button>`}
        <button class="btn" data-act="period-edit">+ Geçmiş kayıt</button></div></div>

    <div class="card"><div class="card-h"><button class="icon-btn" data-act="cal-shift" data-n="-1" aria-label="Önceki ay">‹</button>
      <h2 style="text-align:center;text-transform:capitalize">${esc(monthName)}</h2><button class="icon-btn" data-act="cal-shift" data-n="1" aria-label="Sonraki ay">›</button></div>
      <div class="cal">${DAY_SHORT.map((d) => `<span class="dn">${d}</span>`).join("")}
        ${cells.map((k) => `<button class="${Cycle.phaseOf(k, p)} ${k === t ? "today" : ""} ${k.slice(0, 7) !== ui.calMonth ? "out" : ""}" data-act="cal-day" data-k="${k}">${parseKey(k).getDate()}</button>`).join("")}</div>
      <div class="legend"><span><i style="background:var(--berry)"></i>Adet</span><span><i style="background:var(--berry-soft);border:1px dashed var(--berry)"></i>Tahmini adet</span>
        <span><i style="background:var(--water-soft)"></i>Doğurgan</span><span><i style="background:var(--water)"></i>Yumurtlama</span></div></div>

    <div class="card"><div class="card-h"><h2>Akıllı Tahmin</h2><span class="chip berry">Güven: ${esc(p.confidence)}</span></div>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr);text-align:center">
        <div><div class="tiny">Ort. döngü</div><div class="mid num">${p.avg} gün</div></div>
        <div><div class="tiny">Ort. adet</div><div class="mid num">${p.avgP} gün</div></div>
        <div><div class="tiny">Kayıtlı döngü</div><div class="mid num">${p.count}</div></div></div>
      <div class="tiny">Son 6 döngünün ağırlıklı ortalaması kullanılır; yeni döngüler daha etkilidir. Çok kısa (18 gün altı) veya uzun (50 gün üstü) aralıklar hesaba katılmaz. Yumurtlama tahmini adetten 14 gün öncesidir. Bu bir tahmindir, doğum kontrolü için kullanılmamalıdır.</div></div>

    <div class="card"><div class="card-h"><h2>Geçmiş</h2></div>
      ${[...D.periods].sort((a, b) => (a.start < b.start ? 1 : -1)).map((e, i, arr) => {
        const len = arr[i + 1] ? diffDays(arr[i + 1].start, e.start) : null;
        return `<div class="list-item"><span class="badge" style="background:var(--berry-soft)">🌸</span><div class="grow"><b>${fmtShort(e.start)} – ${e.end ? fmtShort(e.end) : "devam ediyor"}</b>
        <div class="sub">${esc([e.end ? diffDays(e.start, e.end) + 1 + " gün" : "", len ? "döngü " + len + " gün" : "", e.flow, (e.symptoms || []).join(", ")].filter(Boolean).join(" · "))}</div></div>
        <button class="btn ghost small" data-act="period-edit" data-id="${e.id}">Düzenle</button></div>`;
      }).join("") || `<div class="empty">Kayıt yok.</div>`}</div>`;
  }

  function vShopping() {
    if (ui.shopWeek == null) { const c = Plan.pos(todayKey()); ui.shopWeek = (c && Plan.week(c.week) ? c.week : D.weeks[0] && D.weeks[0].number) || null; }
    const groups = new Map();
    for (const s of D.shopping) { if (!groups.has(s.category)) groups.set(s.category, []); groups.get(s.category).push(s); }
    const order = CATS.map((c) => c[0]).concat(["Diğer"]);
    const left = D.shopping.filter((s) => !s.checked).length;
    return `
    <div class="card"><div class="card-h"><h2>Plandan Oluştur</h2></div>
      <div class="sub">Seçtiğin haftanın menüsündeki malzemeleri listeye ekler, aynı olanları birleştirir.</div>
      <div class="seg">${D.weeks.map((w) => `<button class="${w.number === ui.shopWeek ? "on" : ""}" data-act="shop-week" data-n="${w.number}">Hafta ${w.number}</button>`).join("")}</div>
      <button class="btn primary" data-act="shop-gen" ${ui.shopWeek ? "" : "disabled"}>Hafta ${ui.shopWeek || ""} için liste oluştur</button></div>

    <div class="card"><div class="card-h"><h2>Listem</h2><span class="chip num">${left} ürün</span></div>
      <form class="row" data-form="shop-add" style="gap:8px"><div class="field grow"><input id="shopName" placeholder="Ürün ekle (ör. yulaf)" autocomplete="off"></div>
        <div class="field" style="width:90px"><input id="shopQty" placeholder="Miktar"></div><button class="btn primary" type="submit">Ekle</button></form>
      ${D.shopping.length ? order.filter((c) => groups.has(c)).map((c) => `<div class="cat">${esc(c)}</div>${groups.get(c).sort((a, b) => a.checked - b.checked).map((s) => `
        <div class="list-item"><input type="checkbox" ${s.checked ? "checked" : ""} data-act="shop-toggle" data-id="${s.id}" aria-label="${esc(s.name)}">
          <div class="grow ${s.checked ? "done-txt" : ""}">${esc(s.name)}${s.quantity ? ` <span class="sub">· ${esc(s.quantity)}</span>` : ""}</div>
          <button class="btn ghost small" data-act="shop-del" data-id="${s.id}" aria-label="Sil">✕</button></div>`).join("")}`).join("") : `<div class="empty">Liste boş.</div>`}
      ${D.shopping.length ? `<div class="wrap"><button class="btn small" data-act="shop-clear">Alınanları temizle</button><button class="btn small" data-act="shop-copy">Metin olarak kopyala</button><button class="btn small danger" data-act="shop-all">Tümünü sil</button></div>` : ""}</div>`;
  }

  function vExercise() {
    const t = todayKey();
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
    const mins = days.map((k) => ({ l: DAY_SHORT[weekday(k)], v: (dayLog(k).exercises || []).reduce((a, e) => a + e.minutes, 0), hl: k === t }));
    const total = mins.reduce((a, m) => a + m.v, 0);
    const kcal = days.reduce((a, k) => a + (dayLog(k).exercises || []).reduce((b, e) => b + (e.kcal || 0), 0), 0);
    const hist = Object.keys(D.days).sort().reverse().slice(0, 30).flatMap((k) => (D.days[k].exercises || []).map((e) => ({ ...e, k })));
    const activeDays = mins.filter((m) => m.v > 0).length;
    return `${exerciseCard(t)}
    <div class="card"><div class="card-h"><h2>Son 7 Gün</h2></div>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr);text-align:center">
        <div><div class="tiny">Toplam</div><div class="mid num">${total} dk</div></div>
        <div><div class="tiny">Kalori</div><div class="mid num">~${kcal}</div></div>
        <div><div class="tiny">Aktif gün</div><div class="mid num">${activeDays}/7</div></div></div>
      ${barChart(mins, "var(--sun)", Math.max(D.goals.activityMinutes, ...mins.map((m) => m.v)))}</div>
    <div class="card"><div class="card-h"><h2>Geçmiş</h2></div>
      ${hist.length ? hist.map((e) => `<div class="list-item"><span class="badge">🏃</span><div class="grow"><b>${esc(e.type)} · ${e.minutes} dk</b><div class="sub">${esc(fmtShort(e.k))}${e.kcal ? " · ~" + e.kcal + " kcal" : ""}</div></div>
        <button class="btn ghost small" data-act="ex-edit" data-k="${e.k}" data-id="${esc(e.id)}">Düzenle</button></div>`).join("") : `<div class="empty">Henüz egzersiz kaydı yok.</div>`}</div>`;
  }

  function vSnacks() {
    const days = Object.keys(D.days).filter((k) => (D.days[k].snacks || []).length).sort().reverse().slice(0, 14);
    return `${dateSwitch()}${snackCard(ui.date)}
    <div class="card"><div class="card-h"><h2>Son Kayıtlar</h2></div>
      ${days.length ? days.map((k) => `<div class="list-item"><div class="grow"><b>${esc(fmtLong(k))}</b><div class="sub">${esc(D.days[k].snacks.map((s) => s.name).join(", "))}</div></div>
        <span class="chip sun">${D.days[k].snacks.length}</span></div>`).join("") : `<div class="empty">Kayıt yok.</div>`}</div>`;
  }

  function vSettings() {
    const g = D.goals, p = D.profile;
    const f = (id, label, val, suf = "", type = "text") => `<div class="field"><label for="${id}">${label}${suf ? ` (${suf})` : ""}</label><input id="${id}" type="${type}" inputmode="decimal" value="${val ?? ""}"></div>`;
    return `<form class="stack" data-form="settings" style="gap:14px">
    <div class="card"><div class="card-h"><h2>Profil</h2></div>
      <div class="field"><label for="sName">Adın</label><input id="sName" value="${esc(p.name)}" autocomplete="off"></div>
      ${f("sHeight", "Boy", p.heightCm, "cm")}
      <div class="field"><label for="sStart">Plan başlangıcı (Hafta 1 Pazartesi)</label><input id="sStart" type="date" value="${p.planStartDate}"></div></div>
    <div class="card"><div class="card-h"><h2>Kilo Hedefi</h2></div>
      <div class="grid2">${f("gStart", "Başlangıç kilosu", g.startWeight, "kg")}${f("gTarget", "Hedef kilo", g.targetWeight, "kg")}</div></div>
    <div class="card"><div class="card-h"><h2>Günlük Hedefler</h2></div>
      <div class="grid2">${f("gWater", "Su", g.waterGlasses, "bardak")}${f("gGlass", "Bardak", g.glassMl, "ml")}
      ${f("gAct", "Aktivite", g.activityMinutes, "dk")}${f("gSleep", "Uyku", g.sleepHours, "saat")}</div></div>
    <button class="btn primary block" type="submit">Kaydet</button></form>

    ${themeCard()}
    ${syncCard()}
    <div class="card"><div class="card-h"><h2>Dosyaya Yedekleme</h2></div>
      <div class="sub">Tüm kayıtlarını (fotoğraflar hariç) bir JSON dosyasına al veya geri yükle. Telefon değiştirirken işe yarar.</div>
      <div class="wrap"><button class="btn" data-act="export">Yedek al</button><button class="btn" data-act="import">Yedekten yükle</button></div></div>
    <div class="card"><div class="card-h"><h2>Planı sıfırla</h2></div>
      <div class="sub">Hafta 1-5 menülerini ilk aktarılan hâline döndürür. Günlük kayıtların silinmez.</div>
      <button class="btn danger" data-act="reseed">Menüleri yeniden yükle</button></div>
    <div class="tiny" style="text-align:center">Koza · veriler yalnızca bu cihazda saklanır</div>`;
  }

  function vRecipes() {
    const cats = RECIPE_CATS.filter((c) => D.recipes.some((r) => r.category === c));
    const list = D.recipes.filter((r) => !ui.recipeCat || r.category === ui.recipeCat).sort((a, b) => a.title.localeCompare(b.title, "tr"));
    return `<div class="row" style="gap:8px"><div class="field grow"><input id="recSearch" data-in="rsearch" placeholder="Tarif veya malzeme ara" autocomplete="off"></div>
      <button class="btn primary" data-act="recipe-edit">+ Yeni</button></div>
    <div class="seg"><button class="${!ui.recipeCat ? "on" : ""}" data-act="recipe-cat" data-c="">Tümü</button>${cats.map((c) => `<button class="${ui.recipeCat === c ? "on" : ""}" data-act="recipe-cat" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="card">${list.length ? list.map((r) => `<button class="list-item" style="border-left:0;border-right:0;border-bottom:0;background:none;width:100%;text-align:left;cursor:pointer" data-act="recipe-open" data-id="${esc(r.id)}"
        data-search="${esc((r.title + " " + r.ingredients.join(" ")).toLocaleLowerCase("tr-TR"))}">
        ${r.photo ? `<img class="thumb" data-ph="${esc(r.photo)}" alt="">` : `<span class="badge">📖</span>`}
        <div class="grow"><b>${esc(r.title)}</b><div class="sub">${esc(r.category)} · ${r.ingredients.length ? r.ingredients.length + " malzeme" : "tarif henüz girilmedi"}</div></div><span class="sub">›</span></button>`).join("")
      : `<div class="empty">Bu kategoride tarif yok.</div>`}</div>`;
  }

  function vRecipe() {
    const r = D.recipes.find((x) => x.id === ui.recipeId);
    if (!r) return `<div class="empty">Tarif bulunamadı.</div>`;
    const uses = [];
    for (const w of D.weeks) {
      const n = new Set();
      w.days.forEach((d) => d.meals.forEach((m) => m.items.forEach((it) => { if (recipeFor(it) === r) n.add(m.title); })));
      if (n.size) uses.push(`Hafta ${w.number} · ${[...n].join(", ")}`);
    }
    return `${r.photo ? `<img data-ph="${esc(r.photo)}" alt="${esc(r.title)}" style="width:100%;max-height:260px;object-fit:cover;border-radius:var(--radius)">` : ""}
    <div class="card"><div class="card-h"><h2 style="font-size:20px">${esc(r.title)}</h2><span class="chip">${esc(r.category)}</span></div>
      ${uses.length ? `<div class="sub">Menüde: ${esc(uses.join(" · "))}</div>` : ""}
      <div class="wrap"><button class="btn small" data-act="recipe-edit" data-id="${esc(r.id)}">Düzenle</button>
      ${r.ingredients.length ? `<button class="btn small" data-act="recipe-shop" data-id="${esc(r.id)}">🛒 Malzemeleri listeye ekle</button>` : ""}</div></div>
    <div class="card"><div class="card-h"><h2>Malzemeler</h2></div>
      ${r.ingredients.length ? `<ul style="margin:0;padding-left:20px">${r.ingredients.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
        : `<div class="empty">Bu tarifin malzemeleri henüz girilmedi. Diyetisyeninin tarifini "Düzenle" ile ekleyebilirsin.</div>`}</div>
    ${r.steps ? `<div class="card"><div class="card-h"><h2>Yapılışı</h2></div><div style="white-space:pre-line">${esc(r.steps)}</div></div>` : ""}
    ${r.notes ? `<div class="card"><div class="card-h"><h2>Not</h2></div><div class="sub" style="white-space:pre-line">${esc(r.notes)}</div></div>` : ""}`;
  }

  const RENDER = {
    tarifler: vRecipes, tarif: vRecipe, ana: vHome, gunluk: vDaily, plan: vPlan, ilerleme: vProgress, daha: vMore, dongu: vCycle, alisveris: vShopping, egzersiz: vExercise, tirtiklama: vSnacks, ayarlar: vSettings, olcum: vProgress };

  // ---------------- Alt sayfalar (form) ----------------
  function sheetHtml() {
    const s = ui.sheet; if (!s) return "";
    let body = "";
    const field = (id, label, val = "", attrs = "") => `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${esc(val ?? "")}" ${attrs}></div>`;
    if (s.type === "photo") {
      body = `<h2>Fotoğraf ekle</h2><div class="stack"><button class="btn primary block" data-act="pick-cam">📷 Kamera ile çek</button><button class="btn block" data-act="pick-gal">🖼️ Galeriden seç</button></div>
        <div class="actions"><button class="btn" data-act="sheet-close">Vazgeç</button></div>`;
    } else if (s.type === "snack") {
      const x = s.item;
      body = `<h2>Tırtıklama</h2>${field("fName", "Ne yedin?", x.name, 'autocomplete="off"')}
        <div class="grid2">${field("fAmount", "Miktar", x.amount, 'placeholder="ör. 1 avuç"')}${field("fTime", "Saat", x.time, 'type="time"')}</div>
        ${field("fKcal", "Kalori (opsiyonel)", x.kcal, 'inputmode="numeric"')}
        <div class="sub">Fotoğraf</div>${photoStrip(x.photo ? [x.photo] : [], "snack")}
        <div class="actions">${s.isNew ? "" : `<button class="btn danger" data-act="snack-del">Sil</button>`}<button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="snack-save">Kaydet</button></div>`;
    } else if (s.type === "ex") {
      const x = s.item;
      body = `<h2>Egzersiz</h2><div class="wrap">${Object.keys(EX_TYPES).map((t) => `<button class="chip ${t === x.type ? "" : "muted"}" style="border:0;cursor:pointer;font-size:13px;padding:6px 12px" data-act="ex-type" data-t="${t}">${t}</button>`).join("")}</div>
        <div class="grid2">${field("fMin", "Süre (dk)", x.minutes, 'inputmode="numeric"')}${field("fKcal", "Kalori (boşsa tahmin)", x.kcal, 'inputmode="numeric"')}</div>
        ${field("fSteps", "Adım (opsiyonel)", x.steps, 'inputmode="numeric"')}${field("fNote", "Not", x.note)}
        <div class="tiny">Kalori tahmini: aktivite yoğunluğu × kilo × süre.</div>
        <div class="actions">${s.isNew ? "" : `<button class="btn danger" data-act="ex-del">Sil</button>`}<button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="ex-save">Kaydet</button></div>`;
    } else if (s.type === "measure") {
      const x = s.item;
      body = `<h2>Haftalık Ölçüm</h2>${field("mDate", "Tarih", x.date, 'type="date"')}
        <div class="grid2">${MEASURES.map(([k, n, u]) => field("m_" + k, `${n} (${u})`, x[k], 'inputmode="decimal"')).join("")}</div>${field("mNote", "Not", x.note)}
        <div class="actions">${s.isNew ? "" : `<button class="btn danger" data-act="measure-del">Sil</button>`}<button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="measure-save">Kaydet</button></div>`;
    } else if (s.type === "period") {
      const x = s.item;
      body = `<h2>Adet Kaydı</h2><div class="grid2">${field("pStart", "Başlangıç", x.start, 'type="date"')}${field("pEnd", "Bitiş", x.end, 'type="date"')}</div>
        <div class="sub">Akış</div><div class="seg">${["hafif", "orta", "yoğun"].map((f) => `<button class="${x.flow === f ? "on" : ""}" data-act="p-flow" data-f="${f}">${f}</button>`).join("")}</div>
        <div class="sub">Belirtiler</div><div class="wrap">${SYMPTOMS.map((y) => `<button class="chip ${(x.symptoms || []).includes(y) ? "berry" : "muted"}" style="border:0;cursor:pointer;font-size:13px;padding:6px 12px" data-act="p-sym" data-s="${y}">${y}</button>`).join("")}</div>
        ${field("pNote", "Not", x.note)}
        <div class="actions">${s.isNew ? "" : `<button class="btn danger" data-act="period-del">Sil</button>`}<button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="period-save">Kaydet</button></div>`;
    } else if (s.type === "meal") {
      const x = s.item;
      body = `<h2>${s.isNew ? "Öğün ekle" : "Öğünü düzenle"} · ${DAY_NAMES[ui.planDay]}</h2>
        <div class="grid2">${field("mlTitle", "Öğün", x.title, 'list="mealNames"')}${field("mlTime", "Saat", x.time, 'placeholder="08:00"')}</div>
        <datalist id="mealNames">${["Kahvaltı", "Ara Öğün", "Öğle Yemeği", "İkindi", "Akşam Yemeği", "Gece"].map((n) => `<option value="${n}">`).join("")}</datalist>
        <div class="field"><label for="mlItems">İçerik (her satıra bir besin)</label><textarea id="mlItems" rows="6">${esc(x.items.join("\n"))}</textarea></div>
        ${field("mlNote", "Not", x.note)}
        <div class="actions">${s.isNew ? "" : `<button class="btn danger" data-act="meal-del">Sil</button>`}<button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="meal-save">Kaydet</button></div>`;
    } else if (s.type === "recipe") {
      const x = s.item;
      body = `<h2>${s.isNew ? "Yeni tarif" : "Tarifi düzenle"}</h2>${field("rcTitle", "Tarif adı", x.title, 'autocomplete="off"')}
        <div class="field"><label for="rcCat">Kategori</label><select id="rcCat">${RECIPE_CATS.map((c) => `<option ${c === x.category ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="field"><label for="rcIng">Malzemeler (her satıra bir malzeme)</label><textarea id="rcIng" rows="6">${esc(x.ingredients.join("\n"))}</textarea></div>
        <div class="field"><label for="rcSteps">Yapılışı</label><textarea id="rcSteps" rows="5">${esc(x.steps)}</textarea></div>
        ${field("rcMatch", "Menüde eşleşecek kelime (opsiyonel)", x.match, 'placeholder="ör. menemen"')}
        <div class="field"><label for="rcNotes">Not</label><textarea id="rcNotes" rows="2">${esc(x.notes)}</textarea></div>
        <div class="sub">Fotoğraf</div>${photoStrip(x.photo ? [x.photo] : [], "recipe")}
        <div class="actions">${s.isNew ? "" : `<button class="btn danger" data-act="recipe-del">Sil</button>`}<button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="recipe-save">Kaydet</button></div>`;
    } else if (s.type === "planstart") {
      body = `<h2>Plan başlangıcı</h2><div class="sub">Hafta 1'in ilk günü (Pazartesi). Diğer haftalar buna göre sıralanır.</div>
        ${field("psDate", "Tarih", D.profile.planStartDate, 'type="date"')}
        <div class="actions"><button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="planstart-save">Kaydet</button></div>`;
    } else if (s.type === "export") {
      body = `<h2>Yedek</h2><div class="sub">Bu metni kopyalayıp güvenli bir yere kaydet. Geri yüklemek için "Yedekten yükle"yi kullan.</div>
        <div class="field"><textarea id="expText" rows="8" readonly>${esc(s.text)}</textarea></div>
        <div class="actions"><button class="btn" data-act="sheet-close">Kapat</button><button class="btn primary" data-act="export-copy">Kopyala</button></div>`;
    } else if (s.type === "import") {
      body = `<h2>Yedekten yükle</h2><div class="sub">Yedek dosyasını seç veya metni yapıştır. Mevcut kayıtların yerine geçer.</div>
        <button class="btn block" data-act="import-file">📄 Dosya seç</button>
        <div class="field"><textarea id="impText" rows="6" placeholder="Yedek metnini buraya yapıştır"></textarea></div>
        <div class="actions"><button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" data-act="import-go">Yükle</button></div>`;
    } else if (s.type === "confirm") {
      body = `<h2>${esc(s.title)}</h2><div class="sub">${esc(s.text)}</div>
        <div class="actions"><button class="btn" data-act="sheet-close">Vazgeç</button><button class="btn primary" style="background:var(--danger);color:#fff" data-act="confirm-yes">${esc(s.yes || "Evet")}</button></div>`;
    }
    return `<div class="sheet-bg" data-act="sheet-bg"><div class="sheet" role="dialog" aria-modal="true">${body}</div></div>`;
  }

  function confirmBox(title, text, yes, fn) { ui.sheet = { type: "confirm", title, text, yes, fn }; render(); }

  // ---------------- Render ----------------
  function render() {
    const v = view(), meta = VIEWS[v];
    const tabs = ["ana", "gunluk", "plan", "ilerleme", "daha"];
    const root = ui.stack[0];
    const scrollY = window.scrollY;
    $("#app").innerHTML = `
      <header class="topbar">${ui.stack.length > 1 ? `<button class="back" data-act="back" aria-label="Geri">←</button>` : ""}<h1>${meta.title}</h1></header>
      <main>${RENDER[v]()}</main>
      <nav class="tabbar">${tabs.map((t) => `<button class="${t === root ? "on" : ""}" data-act="go" data-v="${t}"><span class="pill">${icon(t)}</span>${VIEWS[t].title}</button>`).join("")}</nav>
      ${sheetHtml()}
      ${ui.viewer ? `<div class="viewer"><img data-ph="${esc(ui.viewer.id)}" alt="Fotoğraf"><div class="tools"><button class="btn" data-act="photo-del">Sil</button><button class="btn" data-act="viewer-close">Kapat</button></div></div>` : ""}
      ${ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : ""}`;
    window.scrollTo(0, scrollY);
    document.querySelectorAll("img[data-ph]").forEach((img) => photos.get(img.dataset.ph).then((u) => { if (u) img.src = u; }));
  }

  // ---------------- Olaylar ----------------
  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ""; };

  function setPhotoTarget(target, id, remove) {
    const [kind, k, mid] = target.split("|");
    if (kind === "snack" || kind === "recipe") { ui.sheet.item.photo = remove ? null : id; return; }
    updDay(k, (d) => {
      if (kind === "meal") { const cur = (d.mealPhotos[mid] || []); d.mealPhotos = { ...d.mealPhotos, [mid]: remove ? cur.filter((x) => x !== id) : cur.concat(id) }; }
      else d.dayPhotos = remove ? d.dayPhotos.filter((x) => x !== id) : d.dayPhotos.concat(id);
    });
  }

  async function handleFiles(files) {
    const target = ui.photoTarget; if (!target || !files.length) return;
    for (const f of files) {
      try { const url = await shrink(f); const id = "ph_" + uid(); await photos.put(id, url); setPhotoTarget(target, id, false); }
      catch (e) { toast("Fotoğraf okunamadı."); }
    }
    if (target === "snack" || target === "recipe") render(); else save();
  }

  function keepRecipeFields() {
    const it = ui.sheet.item;
    Object.assign(it, { title: val("rcTitle"), category: val("rcCat") || it.category, steps: val("rcSteps"), match: val("rcMatch"), notes: val("rcNotes"),
      ingredients: val("rcIng").split("\n").map((x) => x.trim()).filter(Boolean) });
  }

  const A = {
    go: (e) => { if (e.dataset.week) ui.shopWeek = +e.dataset.week; go(e.dataset.v); },
    back,
    water: (e) => { updDay(e.dataset.k, (d) => { d.water = Math.max(0, (d.water || 0) + +e.dataset.n); }); save(); },
    // Öğün kutusu: hepsi işaretliyse hepsini kaldırır, değilse hepsini işaretler
    "meal-toggle": (e) => {
      const id = e.dataset.id, k = e.dataset.k, m = Plan.meals(k).find((x) => x.id === id); if (!m) return;
      const full = itemState(dayLog(k), m).frac >= 1;
      updDay(k, (d) => {
        d.completedItems = { ...(d.completedItems || {}), [id]: full ? [] : m.items.map((_, i) => i) };
        d.completedMeals = full ? d.completedMeals.filter((x) => x !== id) : [...new Set(d.completedMeals.concat(id))];
      });
      save();
    },
    // Tek madde: öğünün tüm maddeleri işaretlenince öğün tamamlanmış sayılır
    "item-toggle": (e) => {
      const id = e.dataset.id, k = e.dataset.k, i = +e.dataset.i, m = Plan.meals(k).find((x) => x.id === id); if (!m) return;
      const set = new Set(itemState(dayLog(k), m).checked);
      set.has(i) ? set.delete(i) : set.add(i);
      updDay(k, (d) => {
        d.completedItems = { ...(d.completedItems || {}), [id]: [...set].sort((a, b) => a - b) };
        const full = set.size === m.items.length;
        d.completedMeals = full ? [...new Set(d.completedMeals.concat(id))] : d.completedMeals.filter((x) => x !== id);
      });
      save();
    },
    "date-shift": (e) => { ui.date = addDays(ui.date, +e.dataset.n); render(); },
    mood: (e) => { updDay(e.dataset.k, (d) => { d.mood = d.mood === e.dataset.m ? null : e.dataset.m; }); save(); },
    "photo-add": (e) => {
      ui.photoTarget = e.dataset.target;
      const prev = ui.sheet && (ui.sheet.type === "snack" || ui.sheet.type === "recipe") ? ui.sheet : null;
      if (prev && prev.type === "snack") Object.assign(prev.item, { name: val("fName"), amount: val("fAmount"), time: val("fTime"), kcal: num(val("fKcal")) });
      if (prev && prev.type === "recipe") keepRecipeFields();
      ui.sheet = { type: "photo", prev }; render();
    },
    "pick-cam": () => { const prev = ui.sheet.prev; ui.sheet = prev || null; render(); $("#camIn").click(); },
    "pick-gal": () => { const prev = ui.sheet.prev; ui.sheet = prev || null; render(); $("#galIn").click(); },
    "photo-view": (e) => { ui.viewer = { id: e.dataset.id, target: e.dataset.target }; render(); },
    "viewer-close": () => { ui.viewer = null; render(); },
    "photo-del": () => {
      const { id, target } = ui.viewer; ui.viewer = null;
      if (target === "recipe" && ui.sheet && ui.sheet.type === "recipe") keepRecipeFields();
      setPhotoTarget(target, id, true); photos.del(id); target === "snack" || target === "recipe" ? render() : save();
    },

    // Tarifler
    "recipe-cat": (e) => { ui.recipeCat = e.dataset.c || null; render(); },
    "recipe-open": (e) => { ui.recipeId = e.dataset.id; go("tarif"); },
    "recipe-edit": (e) => {
      const ex = D.recipes.find((r) => r.id === e.dataset.id);
      ui.sheet = { type: "recipe", isNew: !ex, item: ex ? JSON.parse(JSON.stringify(ex)) : { id: "r_" + uid(), title: "", category: ui.recipeCat || "Kahvaltı", match: "", ingredients: [], steps: "", notes: "", photo: null } };
      render();
    },
    "recipe-save": () => {
      keepRecipeFields(); const it = ui.sheet.item;
      if (!it.title) { toast("Tarif adını yaz."); return; }
      const i = D.recipes.findIndex((r) => r.id === it.id);
      if (i >= 0) D.recipes[i] = it; else D.recipes.push(it);
      const isNew = ui.sheet.isNew; ui.sheet = null; ui.recipeId = it.id;
      if (isNew) { save({ silent: true }); go("tarif"); } else save();
    },
    "recipe-del": () => {
      const id = ui.sheet.item.id, title = ui.sheet.item.title;
      confirmBox(`"${title}" silinsin mi?`, "Tarif kalıcı olarak silinecek.", "Sil", () => {
        D.recipes = D.recipes.filter((r) => r.id !== id); save({ silent: true });
        if (view() === "tarif") back(); else render();
      });
    },
    "recipe-shop": (e) => {
      const r = D.recipes.find((x) => x.id === e.dataset.id); if (!r) return;
      const have = new Set(D.shopping.map((s) => s.name.toLocaleLowerCase("tr-TR"))); let n = 0;
      for (const ing of r.ingredients) {
        const name = cleanItem(ing) || ing; if (have.has(name.toLocaleLowerCase("tr-TR"))) continue;
        D.shopping.push({ id: uid(), name, quantity: r.title, category: catOf(name), checked: false }); n++;
      }
      save(); toast(n ? `${n} malzeme listeye eklendi.` : "Malzemelerin hepsi zaten listede.");
    },
    "sheet-close": () => { ui.sheet = ui.sheet && ui.sheet.prev ? ui.sheet.prev : null; render(); },
    "sheet-bg": (e, ev) => { if (ev.target === e) A["sheet-close"](); },
    "confirm-yes": () => { const fn = ui.sheet.fn; ui.sheet = null; fn(); },

    // Tırtıklama
    "snack-edit": (e) => {
      const k = e.dataset.k, ex = (dayLog(k).snacks || []).find((s) => s.id === e.dataset.id);
      ui.sheet = { type: "snack", k, isNew: !ex, item: ex ? { ...ex } : { id: uid(), name: "", amount: "", time: nowTime(), kcal: null, photo: null } }; render();
    },
    "snack-save": () => {
      const s = ui.sheet, it = { ...s.item, name: val("fName"), amount: val("fAmount"), time: val("fTime"), kcal: num(val("fKcal")) };
      if (!it.name) { toast("Ne yediğini yaz."); return; }
      updDay(s.k, (d) => { d.snacks = d.snacks.filter((x) => x.id !== it.id).concat(it); }); ui.sheet = null; save();
    },
    "snack-del": () => { const s = ui.sheet; updDay(s.k, (d) => { d.snacks = d.snacks.filter((x) => x.id !== s.item.id); }); if (s.item.photo) photos.del(s.item.photo); ui.sheet = null; save(); },

    // Egzersiz
    "ex-edit": (e) => {
      const k = e.dataset.k, ex = (dayLog(k).exercises || []).find((s) => s.id === e.dataset.id);
      ui.sheet = { type: "ex", k, isNew: !ex, item: ex ? { ...ex } : { id: uid(), type: "Yürüyüş", minutes: 30, kcal: null, steps: null, note: "" } }; render();
    },
    "ex-type": (e) => { const it = ui.sheet.item; it.minutes = num(val("fMin")) ?? it.minutes; it.kcal = num(val("fKcal")); it.steps = num(val("fSteps")); it.note = val("fNote"); it.type = e.dataset.t; render(); },
    "ex-save": () => {
      const s = ui.sheet, min = Math.round(num(val("fMin")) || 0);
      if (!min) { toast("Süreyi gir."); return; }
      const w = Goal.stats().current || 70;
      const it = { ...s.item, minutes: min, kcal: num(val("fKcal")) ?? Math.round((EX_TYPES[s.item.type] || 4) * w * min / 60), steps: num(val("fSteps")), note: val("fNote") };
      updDay(s.k, (d) => { d.exercises = d.exercises.filter((x) => x.id !== it.id).concat(it); }); ui.sheet = null; save();
    },
    "ex-del": () => { const s = ui.sheet; updDay(s.k, (d) => { d.exercises = d.exercises.filter((x) => x.id !== s.item.id); }); ui.sheet = null; save(); },

    // Ölçüm
    "measure-edit": (e) => {
      const ex = D.measurements.find((m) => m.id === e.dataset.id);
      ui.sheet = { type: "measure", isNew: !ex, item: ex ? { ...ex } : { id: uid(), date: todayKey(), note: "" } }; render();
    },
    "measure-save": () => {
      const it = { id: ui.sheet.item.id, date: val("mDate") || todayKey(), note: val("mNote") };
      let any = false; for (const [k] of MEASURES) { const v = num(val("m_" + k)); if (v != null) { it[k] = v; any = true; } }
      if (!any) { toast("En az bir ölçü gir."); return; }
      D.measurements = D.measurements.filter((m) => m.id !== it.id).concat(it);
      if (D.goals.startWeight == null && it.weight != null) D.goals.startWeight = it.weight;
      ui.sheet = null; save(); toast("Ölçüm kaydedildi.");
    },
    "measure-del": () => { D.measurements = D.measurements.filter((m) => m.id !== ui.sheet.item.id); ui.sheet = null; save(); },
    mkey: (e) => { ui.measureKey = e.dataset.k; render(); },

    // Döngü
    "period-start": () => { D.periods.push({ id: uid(), start: todayKey(), end: null, flow: "orta", symptoms: [], note: "" }); save(); toast("Adet başlangıcı kaydedildi."); },
    "period-end": (e) => { const p = D.periods.find((x) => x.id === e.dataset.id); if (p) p.end = todayKey(); save(); },
    "period-edit": (e) => {
      const ex = D.periods.find((p) => p.id === e.dataset.id);
      ui.sheet = { type: "period", isNew: !ex, item: ex ? { ...ex, symptoms: [...(ex.symptoms || [])] } : { id: uid(), start: e.dataset.k || todayKey(), end: "", flow: "orta", symptoms: [], note: "" } }; render();
    },
    "p-flow": (e) => { keepPeriodFields(); ui.sheet.item.flow = e.dataset.f; render(); },
    "p-sym": (e) => { keepPeriodFields(); const s = ui.sheet.item.symptoms, y = e.dataset.s; ui.sheet.item.symptoms = s.includes(y) ? s.filter((x) => x !== y) : s.concat(y); render(); },
    "period-save": () => {
      keepPeriodFields(); const it = ui.sheet.item;
      if (!it.start) { toast("Başlangıç tarihini seç."); return; }
      if (it.end && it.end < it.start) { toast("Bitiş, başlangıçtan önce olamaz."); return; }
      it.end = it.end || null;
      D.periods = D.periods.filter((p) => p.id !== it.id).concat(it); ui.sheet = null; save();
    },
    "period-del": () => { D.periods = D.periods.filter((p) => p.id !== ui.sheet.item.id); ui.sheet = null; save(); },
    "cal-shift": (e) => { const [y, m] = ui.calMonth.split("-").map(Number); const d = new Date(y, m - 1 + +e.dataset.n, 1); ui.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); },
    "cal-day": (e) => {
      const k = e.dataset.k, ex = D.periods.find((p) => k >= p.start && k <= (p.end || p.start));
      if (ex) A["period-edit"]({ dataset: { id: ex.id } }); else A["period-edit"]({ dataset: { k } });
    },

    // Alışveriş
    "shop-week": (e) => { ui.shopWeek = +e.dataset.n; render(); },
    "shop-gen": () => {
      const w = Plan.week(ui.shopWeek); if (!w) return;
      const have = new Set(D.shopping.map((s) => s.name.toLocaleLowerCase("tr-TR")));
      let added = 0;
      for (const it of itemsFromWeek(w)) {
        if (have.has(it.name.toLocaleLowerCase("tr-TR"))) continue;
        D.shopping.push({ id: uid(), name: it.name, quantity: it.n > 1 ? `${it.n} öğünde` : "", category: catOf(it.name), checked: false, fromWeek: w.number }); added++;
      }
      save(); toast(added ? `${added} ürün eklendi.` : "Yeni ürün yok, hepsi zaten listede.");
    },
    "shop-toggle": (e) => { const s = D.shopping.find((x) => x.id === e.dataset.id); if (s) s.checked = !s.checked; save(); },
    "shop-del": (e) => { D.shopping = D.shopping.filter((x) => x.id !== e.dataset.id); save(); },
    "shop-clear": () => { D.shopping = D.shopping.filter((x) => !x.checked); save(); },
    "shop-all": () => confirmBox("Liste silinsin mi?", "Alışveriş listesindeki tüm ürünler silinecek.", "Tümünü sil", () => { D.shopping = []; save(); }),
    "shop-copy": () => {
      const txt = D.shopping.filter((s) => !s.checked).map((s) => `- ${s.name}${s.quantity ? " (" + s.quantity + ")" : ""}`).join("\n");
      copyText(txt, "Liste kopyalandı.");
    },

    // Plan
    "plan-week": (e) => { ui.planWeek = +e.dataset.n; ui.planDay = 0; render(); },
    "plan-day": (e) => { ui.planDay = +e.dataset.n; render(); },
    "plan-start": () => { ui.sheet = { type: "planstart" }; render(); },
    "planstart-save": () => {
      const v = val("psDate"); if (!v) return;
      if (weekday(v) !== 0) toast(`Not: ${fmtLong(v)} Pazartesi değil.`);
      D.profile.planStartDate = v; ui.sheet = null; ui.planWeek = null; ui.planDay = null; save();
    },
    "week-add": () => {
      const n = (D.weeks.reduce((a, w) => Math.max(a, w.number), 0)) + 1;
      D.weeks.push({ number: n, days: Array.from({ length: 7 }, (_, i) => ({ dayIndex: i, meals: [] })) });
      ui.planWeek = n; ui.planDay = 0; save();
    },
    "week-copy": () => {
      const src = Plan.week(ui.planWeek); const n = (D.weeks.reduce((a, w) => Math.max(a, w.number), 0)) + 1;
      const copy = JSON.parse(JSON.stringify(src)); copy.number = n;
      copy.days.forEach((d) => d.meals.forEach((m) => { m.id = `w${n}d${d.dayIndex}_${uid()}`; }));
      D.weeks.push(copy); ui.planWeek = n; ui.planDay = 0; save(); toast(`Hafta ${n} oluşturuldu.`);
    },
    "week-del": () => confirmBox(`Hafta ${ui.planWeek} silinsin mi?`, "Bu haftanın menüsü silinecek. Günlük kayıtların kalır.", "Haftayı sil", () => {
      D.weeks = D.weeks.filter((w) => w.number !== ui.planWeek); ui.planWeek = null; ui.planDay = null; save();
    }),
    "day-copy": () => {
      const w = Plan.week(ui.planWeek), prev = w.days[ui.planDay - 1];
      w.days[ui.planDay].meals = prev.meals.map((m) => ({ ...m, items: [...m.items], id: `w${w.number}d${ui.planDay}_${uid()}` })); save();
    },
    "meal-edit": (e) => {
      const w = Plan.week(ui.planWeek), ex = w.days[ui.planDay].meals.find((m) => m.id === e.dataset.id);
      ui.sheet = { type: "meal", isNew: !ex, item: ex ? { ...ex, items: [...ex.items] } : { id: `w${w.number}d${ui.planDay}_${uid()}`, title: "", time: "", items: [], note: "" } }; render();
    },
    "meal-save": () => {
      const it = { ...ui.sheet.item, title: val("mlTitle") || "Öğün", time: val("mlTime"), note: val("mlNote"), items: val("mlItems").split("\n").map((x) => x.trim()).filter(Boolean) };
      const day = Plan.week(ui.planWeek).days[ui.planDay];
      const i = day.meals.findIndex((m) => m.id === it.id);
      if (i >= 0) day.meals[i] = it; else day.meals.push(it);
      ui.sheet = null; save();
    },
    "meal-del": () => { const day = Plan.week(ui.planWeek).days[ui.planDay]; day.meals = day.meals.filter((m) => m.id !== ui.sheet.item.id); ui.sheet = null; save(); },

    // Ayarlar
    export: () => {
      const txt = JSON.stringify(D, null, 1);
      if (bridge && bridge.shareText) { bridge.shareText("fittakip-yedek-" + todayKey() + ".json", txt); return; }
      ui.sheet = { type: "export", text: txt }; render();
    },
    "export-copy": () => copyText(ui.sheet.text, "Yedek kopyalandı.", "expText"),
    import: () => { ui.sheet = { type: "import" }; render(); },
    theme: (e) => { D.profile.theme = e.dataset.t; applyTheme(); save(); },
    "theme-mode": (e) => { D.profile.themeMode = e.dataset.m; applyTheme(); save(); },
    "sync-connect": () => Sync.connect(),
    "sync-now": () => Sync.run(false),
    "sync-off": () => confirmBox("Bağlantı kesilsin mi?", "Bu telefondaki kayıtların kalır; Drive'daki yedek silinmez.", "Bağlantıyı kes", () => Sync.disconnect()),
    "import-file": () => $("#jsonIn").click(),
    "import-go": () => importText(val("impText")),
    reseed: () => confirmBox("Menüler yeniden yüklensin mi?", "Hafta 1-5 menülerine yaptığın düzenlemeler ilk hâline döner.", "Yeniden yükle", () => {
      const seed = window.SEED_PLAN || {};
      const nums = new Set((seed.weeks || []).map((w) => w.number));
      D.weeks = D.weeks.filter((w) => !nums.has(w.number)).concat(JSON.parse(JSON.stringify(seed.weeks || []))).sort((a, b) => a.number - b.number);
      save(); toast("Menüler yüklendi.");
    }),
  };

  function keepPeriodFields() { const it = ui.sheet.item; it.start = val("pStart"); it.end = val("pEnd"); it.note = val("pNote"); }

  function copyText(txt, msg, fallbackId) {
    const done = () => toast(msg);
    try { navigator.clipboard.writeText(txt).then(done, () => selectFallback(fallbackId)); } catch (e) { selectFallback(fallbackId); }
  }
  function selectFallback(id) { const el = id && document.getElementById(id); if (el) { el.select(); toast("Metni seçtim, uzun basıp kopyalayabilirsin."); } else toast("Kopyalanamadı."); }

  function importText(t) {
    try {
      const parsed = JSON.parse(t);
      if (!parsed || typeof parsed !== "object" || !("days" in parsed || "weeks" in parsed)) throw new Error("x");
      D = normalize({ ...parsed, seedVersion: Math.max(parsed.seedVersion || 0, SEED_VERSION) }); ui.sheet = null; save(); toast("Yedek yüklendi.");
    } catch (e) { toast("Bu metin geçerli bir Koza yedeği değil."); }
  }

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]"); if (!el) return;
    const fn = A[el.dataset.act]; if (!fn) return;
    if (el.tagName === "BUTTON") ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target.dataset.form;
    if (f === "shop-add") {
      const name = val("shopName"); if (!name) return;
      D.shopping.push({ id: uid(), name, quantity: val("shopQty"), category: catOf(name), checked: false }); save();
      setTimeout(() => { const i = document.getElementById("shopName"); if (i) i.focus(); }, 0);
    } else if (f === "settings") {
      D.profile.name = val("sName"); D.profile.heightCm = num(val("sHeight"));
      const st = val("sStart"); if (st) D.profile.planStartDate = st;
      D.goals.startWeight = num(val("gStart")); D.goals.targetWeight = num(val("gTarget"));
      D.goals.waterGlasses = Math.max(1, Math.round(num(val("gWater")) || 8)); D.goals.glassMl = Math.round(num(val("gGlass")) || 250);
      D.goals.activityMinutes = Math.max(1, Math.round(num(val("gAct")) || 60)); D.goals.sleepHours = num(val("gSleep")) || 8;
      ui.planWeek = null; ui.planDay = null; save(); toast("Kaydedildi.");
    }
  });
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.dataset.in === "sleep") { const v = parseFloat(el.value); updDay(el.dataset.k, (d) => { d.sleepHours = v; }); const s = $("#sleepVal"); if (s) s.textContent = f1(v); save({ silent: true }); }
    if (el.dataset.in === "rsearch") {
      const q = el.value.trim().toLocaleLowerCase("tr-TR");
      document.querySelectorAll("[data-search]").forEach((b) => { b.hidden = q && !b.dataset.search.includes(q); });
    }
    if (el.dataset.in === "note") { updDay(el.dataset.k, (d) => { d.note = el.value; }); save({ silent: true }); }
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.id === "datePick" && el.value) { ui.date = el.value; render(); }
    if (el.dataset.in === "sleep") render();
    if (el.id === "camIn" || el.id === "galIn") { handleFiles([...el.files]); el.value = ""; }
    if (el.id === "jsonIn" && el.files[0]) { const fr = new FileReader(); fr.onload = () => importText(fr.result); fr.readAsText(el.files[0]); el.value = ""; }
  });
  window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== view()) { ui.stack = VIEWS[v].tab ? [v] : [ui.stack[0], v]; render(); } });

  // Android: geri tuşu ve widget'tan dönüşte veriyi tazele
  window.FitTakip = {
    back() { if (ui.viewer) { ui.viewer = null; render(); return true; } if (ui.sheet) { A["sheet-close"](); return true; } if (ui.stack.length > 1) { back(); return true; } if (view() !== "ana") { go("ana"); return true; } return false; },
    reload() { D = normalize(store.load()); applyTheme(); render(); },
    open(v) { if (VIEWS[v]) go(v); },
    __resolve(id, result) { Sync.resolve(id, result); },
  };

  applyTheme();
  photos.open().then(() => { save({ silent: true, keepStamp: true }); render(); Sync.init(); });
})();
