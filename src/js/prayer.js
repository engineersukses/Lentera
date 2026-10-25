// Hitung jadwal sholat secara lokal (tanpa internet).
// Parameter mengikuti Kemenag RI: Subuh 20°, Isya 18°, Ashar madzhab Syafi'i,
// ihtiyat +2 menit, Imsak = Subuh - 10 menit.

const dtr = (d) => (d * Math.PI) / 180;
const rtd = (r) => (r * 180) / Math.PI;
const sin = (d) => Math.sin(dtr(d));
const cos = (d) => Math.cos(dtr(d));
const tan = (d) => Math.tan(dtr(d));
const arcsin = (x) => rtd(Math.asin(x));
const arccos = (x) => rtd(Math.acos(x));
const arctan2 = (y, x) => rtd(Math.atan2(y, x));
const arccot = (x) => rtd(Math.atan(1 / x));
const fix = (a, b) => {
  a = a - b * Math.floor(a / b);
  return a < 0 ? a + b : a;
};

function julian(y, m, d) {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
  return { decl: arcsin(sin(e) * sin(L)), eqt: q / 15 - fix(RA, 24) };
}

export const PRAYERS = [
  { key: "subuh", name: "Fajr", fard: true },
  { key: "terbit", name: "Sunrise", fard: false },
  { key: "dzuhur", name: "Dhuhr", fard: true },
  { key: "ashar", name: "Asr", fard: true },
  { key: "maghrib", name: "Maghrib", fard: true },
  { key: "isya", name: "Isha", fard: true },
];

/** Jadwal untuk tanggal kalender lokal `date`. Hasilnya objek Date per waktu. */
export function prayerTimes(date, lat, lng, opts = {}) {
  const fajrAngle = opts.fajrAngle ?? 20;
  const ishaAngle = opts.ishaAngle ?? 18;
  const ihtiyat = opts.ihtiyat ?? 2;
  const asrFactor = opts.asrFactor ?? 1;
  const elevation = opts.elevation ?? 0;

  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const jd = julian(y, m, d) - lng / (15 * 24);

  const midDay = (t) => fix(12 - sunPosition(jd + t).eqt, 24);
  const angleTime = (angle, t, ccw) => {
    const decl = sunPosition(jd + t).decl;
    const x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    if (Math.abs(x) > 1) return NaN;
    const T = arccos(x) / 15;
    return midDay(t) + (ccw ? -T : T);
  };
  const asrTime = (t) => {
    const decl = sunPosition(jd + t).decl;
    return angleTime(-arccot(asrFactor + tan(Math.abs(lat - decl))), t, false);
  };
  const riseSet = 0.833 + 0.0347 * Math.sqrt(elevation);

  // Dua kali iterasi supaya posisi matahari dihitung di jam yang tepat.
  let t = { subuh: 5, terbit: 6, dzuhur: 12, ashar: 13, maghrib: 18, isya: 18 };
  for (let i = 0; i < 2; i++) {
    const f = (h) => h / 24;
    t = {
      subuh: angleTime(fajrAngle, f(t.subuh), true),
      terbit: angleTime(riseSet, f(t.terbit), true),
      dzuhur: midDay(f(t.dzuhur)),
      ashar: asrTime(f(t.ashar)),
      maghrib: angleTime(riseSet, f(t.maghrib), false),
      isya: angleTime(ishaAngle, f(t.isya), false),
    };
  }

  const base = Date.UTC(y, m - 1, d);
  const toDate = (hours, offsetMin) => {
    const utcHours = hours - lng / 15;
    const ms = base + utcHours * 3600e3 + offsetMin * 60e3;
    // Bulatkan ke menit berikutnya, seperti jadwal resmi.
    return new Date(Math.ceil(ms / 60e3) * 60e3);
  };

  const out = {
    subuh: toDate(t.subuh, ihtiyat),
    terbit: toDate(t.terbit, -ihtiyat),
    dzuhur: toDate(t.dzuhur, ihtiyat),
    ashar: toDate(t.ashar, ihtiyat),
    maghrib: toDate(t.maghrib, ihtiyat),
    isya: toDate(t.isya, ihtiyat),
  };
  out.imsak = new Date(out.subuh.getTime() - 10 * 60e3);
  return out;
}

/** Waktu sholat wajib berikutnya (bisa sholat Subuh besok). */
export function nextPrayer(now, lat, lng) {
  const today = prayerTimes(now, lat, lng);
  for (const p of PRAYERS) {
    if (p.fard && today[p.key] > now) return { ...p, time: today[p.key] };
  }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  return { ...PRAYERS[0], time: prayerTimes(tomorrow, lat, lng).subuh };
}

/** Waktu sholat wajib yang sedang berlangsung (yang terakhir lewat). */
export function currentPrayer(now, lat, lng) {
  const today = prayerTimes(now, lat, lng);
  let cur = null;
  for (const p of PRAYERS) {
    if (today[p.key] <= now) cur = p.fard ? { ...p, time: today[p.key] } : null;
  }
  return cur;
}

export const CITIES = [
  ["Jakarta", -6.2088, 106.8456],
  ["Bogor", -6.595, 106.8166],
  ["Depok", -6.4025, 106.7942],
  ["Tangerang", -6.1783, 106.6319],
  ["Bekasi", -6.2383, 106.9756],
  ["Bandung", -6.9175, 107.6191],
  ["Cirebon", -6.732, 108.5523],
  ["Semarang", -6.9667, 110.4167],
  ["Yogyakarta", -7.7956, 110.3695],
  ["Solo", -7.5755, 110.8243],
  ["Surabaya", -7.2575, 112.7521],
  ["Malang", -7.9666, 112.6326],
  ["Serang", -6.1201, 106.1503],
  ["Banda Aceh", 5.5483, 95.3238],
  ["Medan", 3.5952, 98.6722],
  ["Padang", -0.9471, 100.4172],
  ["Pekanbaru", 0.5071, 101.4478],
  ["Batam", 1.0456, 104.0305],
  ["Jambi", -1.6101, 103.6131],
  ["Palembang", -2.9761, 104.7754],
  ["Bengkulu", -3.8004, 102.2655],
  ["Bandar Lampung", -5.3971, 105.2668],
  ["Pontianak", -0.0263, 109.3425],
  ["Banjarmasin", -3.3186, 114.5944],
  ["Balikpapan", -1.2379, 116.8529],
  ["Samarinda", -0.5022, 117.1536],
  ["Denpasar", -8.6705, 115.2126],
  ["Mataram", -8.5833, 116.1167],
  ["Kupang", -10.1772, 123.607],
  ["Makassar", -5.1477, 119.4327],
  ["Manado", 1.4748, 124.8421],
  ["Palu", -0.8917, 119.8707],
  ["Kendari", -3.9985, 122.5129],
  ["Gorontalo", 0.5435, 123.0568],
  ["Ambon", -3.6954, 128.1814],
  ["Ternate", 0.7893, 127.3753],
  ["Jayapura", -2.5337, 140.7181],
  ["Kuala Lumpur", 3.139, 101.6869],
  ["Singapore", 1.3521, 103.8198],
];
