const $ = (id) => document.getElementById(id);
const serviceSelect = $("service");
const barberSelect = $("barber");
const dateInput = $("date");
const timeSelect = $("time");
const message = $("formMessage");

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
dateInput.min = localToday();
$("year").textContent = new Date().getFullYear();

async function loadConfig() {
  const config = await fetch("/api/config").then(r => r.json());
  $("phoneLink").href = `tel:${config.phone.replace(/[^\d+]/g, "")}`;
  $("phoneLink").textContent = config.phone;
  $("instagramLink").href = config.instagram;
  $("footerAddress").textContent = config.address;
}
async function loadOptions() {
  const [services, barbers] = await Promise.all([
    fetch("/api/services").then(r => r.json()),
    fetch("/api/barbers").then(r => r.json())
  ]);
  serviceSelect.innerHTML = '<option value="">Оберіть послугу</option>' + services.map(s =>
    `<option value="${s.id}">${escapeHtml(s.name)} — ${s.price} грн (${s.duration} хв)</option>`).join("");
  barberSelect.innerHTML = '<option value="">Оберіть майстра</option>' + barbers.map(b =>
    `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
async function loadSlots() {
  timeSelect.innerHTML = '<option value="">Завантаження часу…</option>';
  if (!dateInput.value || !barberSelect.value || !serviceSelect.value) {
    timeSelect.innerHTML = '<option value="">Оберіть послугу, майстра й дату</option>';
    return;
  }
  try {
    const params = new URLSearchParams({ date: dateInput.value, barberId: barberSelect.value, serviceId: serviceSelect.value });
    const response = await fetch(`/api/slots?${params}`);
    const slots = await response.json();
    timeSelect.innerHTML = slots.length
      ? '<option value="">Оберіть час</option>' + slots.map(t => `<option value="${t}">${t}</option>`).join("")
      : '<option value="">Вільного часу немає</option>';
  } catch {
    timeSelect.innerHTML = '<option value="">Не вдалося завантажити час</option>';
  }
}
serviceSelect.addEventListener("change", loadSlots);
barberSelect.addEventListener("change", loadSlots);
dateInput.addEventListener("change", loadSlots);

$("bookingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Надсилаємо запис…";
  const payload = {
    serviceId: serviceSelect.value,
    barberId: barberSelect.value,
    date: dateInput.value,
    time: timeSelect.value,
    name: $("customerName").value.trim(),
    phone: $("customerPhone").value.trim()
  };
  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Помилка запису.");
    message.textContent = result.message;
    $("bookingForm").reset();
    dateInput.min = localToday();
    timeSelect.innerHTML = '<option value="">Спочатку оберіть дату</option>';
  } catch (error) {
    message.textContent = error.message;
  }
});
$("menuToggle").addEventListener("click", () => $("mainNav").classList.toggle("open"));
$("mainNav").querySelectorAll("a").forEach(a => a.addEventListener("click", () => $("mainNav").classList.remove("open")));

loadConfig().catch(console.error);
loadOptions().catch(() => { serviceSelect.innerHTML = '<option>Помилка завантаження послуг</option>'; });
