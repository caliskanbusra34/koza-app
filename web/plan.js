/* Hafta 1-5 menüleri — szbfit.com "Planım" sayfasından aktarıldı.
 * Diyetisyen her hafta için tek bir günlük menü tanımlıyor; menü haftanın 7 gününe uygulanır.
 * "Akşam (4 gün)" seçeneği Pzt/Çar/Cum/Paz, "Akşam (3 gün)" seçeneği Sal/Per/Cmt günlerine yerleştirildi;
 * uygulamadaki Planım ekranından günler değiştirilebilir.
 * "veya" ile verilen alternatif öğünler ilgili öğünün notuna yazıldı. */
window.SEED_PLAN = (function () {
  const ALL = [0, 1, 2, 3, 4, 5, 6], D4 = [0, 2, 4, 6], D3 = [1, 3, 5];

  const W = {
    1: [
      { k: "kahvalti", t: "Kahvaltı", time: "11:00",
        items: ["1 fincan yeşil çay", "5 adet zeytin (renk farketmez)", "3 dilim peynir", "2 adet yumurta (küçük - S)", "2 dilim tam buğday ekmeği", "1 adet domates (orta)", "1 adet salatalık (orta)"],
        note: "Veya: Smoothie 1 — 1 bardak laktozsuz süt, 2 hurma veya 1 muz (kabız değilseniz), 1 tatlı kaşığı kakao, 2 yemek kaşığı yulaf ezmesi, 8 çiğ fındık" },
      { k: "ara1", t: "Ara Öğün 1", time: "14:00", items: ["1 fincan kahve", "1 adet orta boy meyve", "1 avuç çiğ kuruyemiş"] },
      { k: "ara2", t: "Ara Öğün 2", time: "16:00", items: ["1 su bardağı sade kefir", "2 adet tam buğday galeta"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D4, note: "Haftada 4 gün seçeneği",
        items: ["8 yemek kaşığı etsiz sebze yemeği / baklagil yemeği", "1 dilim tam buğday ekmeği", "4 yemek kaşığı yoğurt"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D3, note: "Haftada 3 gün seçeneği",
        items: ["180 g tavuk / balık / köfte ızgara", "1 kase yeşil salata", "4 yemek kaşığı pilav veya makarna"] },
    ],
    2: [
      { k: "kahvalti", t: "Kahvaltı", time: "11:00",
        items: ["1 fincan yeşil çay", "1 dilim tam buğday ekmeği", "1 porsiyon omlet", "1 kase söğüş sebze", "2 tatlı kaşığı labne", "Yarım avokado"],
        note: "Veya: 1 porsiyon kakaolu yulaf puding" },
      { k: "ara1", t: "Ara Öğün 1", time: "14:00", items: ["1 fincan kahve", "1 adet orta boy meyve", "2 adet ceviz içi"] },
      { k: "ara2", t: "Ara Öğün 2", time: "16:00", items: ["1 porsiyon mineralli ayran", "2 adet tam buğday galeta"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D4, note: "Haftada 4 gün seçeneği",
        items: ["1 dilim tam buğday ekmeği", "8 yemek kaşığı zeytinyağlı sebze yemeği", "1 kase cacık"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D3, note: "Haftada 3 gün seçeneği",
        items: ["180 g tavuk / balık / köfte ızgara", "4 yemek kaşığı basmati pirinç pilavı veya tam buğday makarna", "1 kase çoban salata"] },
    ],
    3: [
      { k: "kahvalti", t: "Kahvaltı", time: "11:00",
        items: ["1 fincan yeşil çay", "1 kase söğüş sebze", "2 tatlı kaşığı labne", "1 porsiyon menemen", "2 adet ceviz içi", "1 dilim tam buğday ekmeği"],
        note: "Veya: 1 porsiyon granola kase" },
      { k: "ara1", t: "Ara Öğün 1", time: "14:00", items: ["1 adet orta boy meyve", "10 adet kaju", "1 kupa soğuk kahve"] },
      { k: "ara2", t: "Ara Öğün 2", time: "16:00", items: ["1 porsiyon yoğurt kasesi"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D4, note: "Haftada 4 gün seçeneği",
        items: ["1 dilim tam buğday ekmeği", "8 yemek kaşığı etli sebze yemeği", "4 yemek kaşığı yoğurt"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D3, note: "Haftada 3 gün seçeneği",
        items: ["180 g tavuk / balık / köfte ızgara", "1 kase çoban salata", "1 kase çorba"] },
      { k: "gece", t: "Ara Öğün 3", time: "20:30", items: ["1 adet salatalık (orta)", "1 su bardağı sade kefir"] },
    ],
    4: [
      { k: "kahvalti", t: "Kahvaltı", time: "11:00",
        items: ["1 fincan yeşil çay", "1 porsiyon dereotlu, hindi fümeli omlet", "5 adet zeytin (renk farketmez)", "1 kase söğüş sebze", "1 dilim tam buğday ekmeği"],
        note: "Veya: 1 porsiyon buz gibi yulaf lapası + 10 adet çiğ fındık" },
      { k: "ara1", t: "Ara Öğün 1", time: "14:00",
        items: ["1 bardak sütlü kahve", "1 paket Fellas protein bar"],
        note: "2. alternatif: protein bar yerine 1 adet orta boy meyve + 10 adet çiğ fındık" },
      { k: "ara2", t: "Ara Öğün 2", time: "16:00", items: ["1 porsiyon şeftalili maden suyu", "1 yemek kaşığı çiğ kabak çekirdeği içi"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D4, note: "Haftada 4 gün seçeneği",
        items: ["8 yemek kaşığı kıymalı sebze yemeği", "1 kase cacık", "1 dilim tam buğday ekmeği"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D3, note: "Haftada 3 gün seçeneği",
        items: ["100 g ton balığı veya 5 yemek kaşığı mercimek / maş fasulyesi", "1 kase çorba", "1 kase yeşil salata", "1 dilim tam buğday ekmeği"] },
    ],
    5: [
      { k: "kahvalti", t: "Kahvaltı", time: "11:00",
        items: ["1 fincan yeşil çay", "1 kase söğüş sebze", "1 adet yumurta (küçük - S)", "1 porsiyon tost"],
        note: "Veya: 1 porsiyon chialı smoothie" },
      { k: "ara1", t: "Ara Öğün 1", time: "14:00", items: ["1 bardak sütlü kahve", "1 adet orta boy meyve", "1 tatlı kaşığı şekersiz fıstık ezmesi"] },
      { k: "ara2", t: "Ara Öğün 2", time: "16:00", items: ["1 fincan kiraz sapı çayı", "10 adet çiğ fındık"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D4, note: "Haftada 4 gün seçeneği",
        items: ["1 dilim tam buğday ekmeği", "8 yemek kaşığı etli sebze yemeği", "4 yemek kaşığı yoğurt"] },
      { k: "aksam", t: "Akşam", time: "18:00", days: D3, note: "Haftada 3 gün seçeneği",
        items: ["1 kase çorba", "1 kase yeşil salata", "1 dilim tam buğday ekmeği", "6 yemek kaşığı etsiz sebze yemeği / baklagil yemeği"] },
    ],
  };

  const FRUIT = "1 orta boy meyve nelere eşit? 6 çilek · 6 erik · 5 kayısı · 5 yeni dünya · 3 dilim kavun veya karpuz · 10 kiraz";
  const detox = (x) => `Detoks suyu: 1 lt su, ${x}, 2 dilim limon, 2 karanfil — 3 saat bekletip içelim.`;
  const NOTES = {
    2: ["Günde 3 lt su", detox("1 çubuk tarçın"), FRUIT].join("\n"),
    3: ["Günde 3 lt su", detox("1 çubuk tarçın"), FRUIT].join("\n"),
    4: ["Günde 3 lt su", "Haftada 5 gün 7000 adım!", detox("1 yeşil elma"), FRUIT].join("\n"),
    5: ["Günde 3 lt su", "Haftada 5 gün 7000 adım!", detox("1 tutam nane"), FRUIT].join("\n"),
  };

  const weeks = Object.keys(W).map(Number).sort((a, b) => a - b).map((n) => ({
    number: n,
    note: NOTES[n] || "",
    days: ALL.map((d) => ({
      dayIndex: d,
      meals: W[n].filter((m) => (m.days || ALL).includes(d)).map((m) => ({
        id: `w${n}d${d}_${m.k}`, title: m.t, time: m.time || "", items: m.items.slice(), note: m.note || "",
      })),
    })),
  }));

  // Tarifler: içeriği bilinenler dolu; menüde adı geçen diğerleri diyetisyenin tarifiyle doldurulmak üzere boş.
  const R = (title, category, match, ingredients = [], steps = "") => ({ id: "r_" + match.replace(/\W+/g, "_"), title, category, match, ingredients, steps, notes: "", photo: null });
  const recipes = [
    R("Smoothie 1", "İçecek", "smoothie 1", ["1 bardak laktozsuz süt", "2 hurma veya 1 muz (kabız değilseniz)", "1 tatlı kaşığı kakao", "2 yemek kaşığı yulaf ezmesi", "8 çiğ fındık"], "Tüm malzemeleri blenderdan geçirin."),
    R("Detoks Suyu (Tarçınlı)", "Detoks", "detoks tarçın", ["1 lt su", "1 çubuk tarçın", "2 dilim limon", "2 karanfil"], "Malzemeleri suya ekleyip 3 saat bekletin, gün içinde için."),
    R("Detoks Suyu (Yeşil Elmalı)", "Detoks", "detoks elma", ["1 lt su", "1 yeşil elma (dilimlenmiş)", "2 dilim limon", "2 karanfil"], "Malzemeleri suya ekleyip 3 saat bekletin, gün içinde için."),
    R("Detoks Suyu (Naneli)", "Detoks", "detoks nane", ["1 lt su", "1 tutam nane", "2 dilim limon", "2 karanfil"], "Malzemeleri suya ekleyip 3 saat bekletin, gün içinde için."),
    R("Omlet", "Kahvaltı", "porsiyon omlet"),
    R("Kakaolu Yulaf Puding", "Kahvaltı", "kakaolu yulaf puding"),
    R("Mineralli Ayran", "İçecek", "mineralli ayran"),
    R("Menemen", "Kahvaltı", "menemen"),
    R("Granola Kase", "Kahvaltı", "granola kase"),
    R("Yoğurt Kasesi 1", "Ara öğün", "yoğurt kasesi"),
    R("Dereotlu, Hindi Fümeli Omlet", "Kahvaltı", "hindi fümeli omlet"),
    R("Buz Gibi Yulaf Lapası", "Kahvaltı", "yulaf lapası"),
    R("Şeftalili Maden Suyu", "İçecek", "şeftalili maden suyu"),
    R("Tost 1", "Kahvaltı", "porsiyon tost"),
    R("Chialı Smoothie", "İçecek", "chialı smoothie"),
  ];

  // Hafta 1, 23 Kasım 2026 Pazartesi başlar
  return { startDate: "2026-11-23", goals: { startWeight: 90.9, targetWeight: 70 }, weeks, recipes };
})();
