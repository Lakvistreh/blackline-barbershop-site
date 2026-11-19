require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "development-only-secret-change-before-deploy";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "owner";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeThisPassword123!";

if (isProduction && (SESSION_SECRET.length < 32 || ADMIN_PASSWORD === "ChangeThisPassword123!")) {
  throw new Error("Set a long SESSION_SECRET and a unique ADMIN_PASSWORD before production.");
}

app.use(helmet({
  frameguard: false,
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'", "https://stackblitz.com", "https://*.stackblitz.io", "https://*.webcontainer.io"]
    }
  }
}));

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "blackline.json");

function defaultDb() {
  return {
    nextServiceId: 4,
    nextBarberId: 3,
    nextAppointmentId: 1,
    services: [
      { id: 1, name: "Мужская стрижка", description: "Классическая или современная стрижка", duration: 45, price: 500, active: 1 },
      { id: 2, name: "Стрижка + борода", description: "Комплексный уход и оформление бороды", duration: 60, price: 700, active: 1 },
      { id: 3, name: "Оформление бороды", description: "Форма, контур и уход", duration: 30, price: 350, active: 1 }
    ],
    barbers: [
      { id: 1, name: "Александр", active: 1 },
      { id: 2, name: "Дмитрий", active: 1 }
    ],
    appointments: []
  };
}

function loadDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    const initial = defaultDb();
    saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(dbFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultDb(),
      ...parsed,
      services: Array.isArray(parsed.services) ? parsed.services : defaultDb().services,
      barbers: Array.isArray(parsed.barbers) ? parsed.barbers : defaultDb().barbers,
      appointments: Array.isArray(parsed.appointments) ? parsed.appointments : []
    };
  } catch {
    const initial = defaultDb();
    saveDb(initial);
    return initial;
  }
}

function saveDb(data) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tempFile = `${dbFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempFile, dbFile);
}

let db = loadDb();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function makeToken(username) {
  const payload = Buffer.from(JSON.stringify({ username, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (data.username !== ADMIN_USERNAME || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const found = raw.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}
function requireAdmin(req, res, next) {
  const session = readToken(getCookie(req, "blackline_session"));
  if (!session) return res.status(401).json({ error: "Потрібно увійти в панель власника." });
  req.admin = session;
  next();
}
function sameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    const host = req.get("host");
    try {
      if (new URL(origin).host !== host) return res.status(403).json({ error: "Запит відхилено." });
    } catch { return res.status(403).json({ error: "Запит відхилено." }); }
  }
  next();
}
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const d = new Date(`${date}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
function minutes(time) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}
function overlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}
function getAvailableSlots(date, barberId, duration) {
  const open = 10 * 60;
  const close = 20 * 60;
  const step = 30;
  const existing = db.appointments.filter(
    item => item.appointment_date === date && item.barber_id === barberId && item.status !== "cancelled"
  );
  const result = [];
  for (let start = open; start + duration <= close; start += step) {
    const busy = existing.some(item => {
      const s = minutes(item.appointment_time);
      return overlap(start, start + duration, s, s + item.duration);
    });
    if (!busy) result.push(`${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`);
  }
  return result;
}

app.get("/api/config", (req, res) => {
  res.json({
    shopName: "BLACKLINE BARBERSHOP",
    phone: process.env.PUBLIC_PHONE || "+380XXXXXXXXX",
    instagram: process.env.INSTAGRAM_URL || "https://instagram.com/your_account",
    hours: "Щодня: 10:00–20:00",
    address: "Вкажіть адресу барбершопу"
  });
});
app.get("/api/services", (req, res) => {
  const rows = db.services
    .filter(s => s.active === 1)
    .sort((a, b) => a.id - b.id)
    .map(({ id, name, description, duration, price }) => ({ id, name, description, duration, price }));
  res.json(rows);
});
app.get("/api/barbers", (req, res) => {
  const rows = db.barbers
    .filter(b => b.active === 1)
    .sort((a, b) => a.id - b.id)
    .map(({ id, name }) => ({ id, name }));
  res.json(rows);
});
app.get("/api/slots", (req, res) => {
  const date = String(req.query.date || "");
  const barberId = Number(req.query.barberId);
  const serviceId = Number(req.query.serviceId);
  if (!validDate(date) || !Number.isInteger(barberId) || !Number.isInteger(serviceId)) {
    return res.status(400).json({ error: "Оберіть коректну дату, майстра та послугу." });
  }
  const service = db.services.find(s => s.id === serviceId && s.active === 1);
  const barber = db.barbers.find(b => b.id === barberId && b.active === 1);
  if (!service || !barber) return res.status(400).json({ error: "Послугу або майстра не знайдено." });
  if (date < new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" })) {
    return res.json([]);
  }
  res.json(getAvailableSlots(date, barberId, service.duration));
});

app.post("/api/bookings", bookingLimiter, sameOrigin, (req, res) => {
  const customerName = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const date = String(req.body.date || "");
  const time = String(req.body.time || "");
  const serviceId = Number(req.body.serviceId);
  const barberId = Number(req.body.barberId);

  if (customerName.length < 2 || customerName.length > 60) return res.status(400).json({ error: "Вкажіть ім’я (від 2 до 60 символів)." });
  if (!/^[+0-9()\-\s]{7,20}$/.test(phone)) return res.status(400).json({ error: "Перевірте номер телефону." });
  if (!validDate(date) || minutes(time) < 0) return res.status(400).json({ error: "Перевірте дату та час." });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
  if (date < today) return res.status(400).json({ error: "Не можна записатися на минулу дату." });

  const service = db.services.find(s => s.id === serviceId && s.active === 1);
  const barber = db.barbers.find(b => b.id === barberId && b.active === 1);
  if (!service || !barber) return res.status(400).json({ error: "Оберіть доступну послугу та майстра." });

  const start = minutes(time);
  if (start < 600 || start + service.duration > 1200 || start % 30 !== 0) {
    return res.status(400).json({ error: "Цей час недоступний." });
  }

  try {
    const free = getAvailableSlots(date, barberId, service.duration).includes(time);
    if (!free) return res.status(409).json({ error: "На жаль, цей час щойно зайняли. Оберіть інший." });

    const newAppointment = {
      id: db.nextAppointmentId++,
      customer_name: customerName,
      phone,
      service_id: serviceId,
      barber_id: barberId,
      appointment_date: date,
      appointment_time: time,
      duration: service.duration,
      status: "new",
      created_at: new Date().toISOString()
    };
    db.appointments.push(newAppointment);
    saveDb(db);

    res.status(201).json({ message: "Запис створено! Ми зв’яжемося з вами для підтвердження." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Не вдалося створити запис. Спробуйте ще раз." });
  }
});

app.post("/api/admin/login", loginLimiter, sameOrigin, async (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const usernameOk = safeEqual(username, ADMIN_USERNAME);
  const passwordOk = await bcrypt.compare(password, await bcrypt.hash(ADMIN_PASSWORD, 10));
  if (!usernameOk || !passwordOk) return res.status(401).json({ error: "Неправильний логін або пароль." });
  const token = makeToken(ADMIN_USERNAME);
  res.cookie("blackline_session", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/"
  });
  res.json({ message: "Вхід виконано." });
});
app.post("/api/admin/logout", sameOrigin, (req, res) => {
  res.clearCookie("blackline_session", { httpOnly: true, secure: isProduction, sameSite: "strict", path: "/" });
  res.json({ message: "Ви вийшли." });
});
app.get("/api/admin/me", requireAdmin, (req, res) => res.json({ username: req.admin.username }));
app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const rows = db.appointments
    .map(a => {
      const s = db.services.find(item => item.id === a.service_id);
      const b = db.barbers.find(item => item.id === a.barber_id);
      return {
        id: a.id,
        customer_name: a.customer_name,
        phone: a.phone,
        appointment_date: a.appointment_date,
        appointment_time: a.appointment_time,
        duration: a.duration,
        status: a.status,
        created_at: a.created_at,
        service_name: s ? s.name : "",
        price: s ? s.price : 0,
        barber_name: b ? b.name : ""
      };
    })
    .sort((a, b) => {
      const dateCmp = b.appointment_date.localeCompare(a.appointment_date);
      if (dateCmp !== 0) return dateCmp;
      return b.appointment_time.localeCompare(a.appointment_time);
    })
    .slice(0, 300);
  res.json(rows);
});
app.patch("/api/admin/bookings/:id", requireAdmin, sameOrigin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "");
  if (!Number.isInteger(id) || !["new", "confirmed", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Некоректні дані." });
  }
  const item = db.appointments.find(a => a.id === id);
  if (!item) return res.status(404).json({ error: "Запис не знайдено." });
  item.status = status;
  saveDb(db);
  res.json({ message: "Статус оновлено." });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`BLACKLINE запущено: http://localhost:${PORT}`);
  console.log(`Панель власника: http://localhost:${PORT}/admin.html`);
});