const $ = (id) => document.getElementById(id);
const loginPanel = $("loginPanel");
const dashboard = $("dashboard");
const loginMessage = $("loginMessage");
const dashboardMessage = $("dashboardMessage");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Сталася помилка.");
  return data;
}
async function checkLogin() {
  try {
    await api("/api/admin/me");
    loginPanel.hidden = true;
    dashboard.hidden = false;
    await loadBookings();
  } catch {
    loginPanel.hidden = false;
    dashboard.hidden = true;
  }
}
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "Перевіряємо дані…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username: $("username").value, password: $("password").value }) });
    $("password").value = "";
    loginMessage.textContent = "";
    await checkLogin();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});
async function loadBookings() {
  dashboardMessage.textContent = "";
  try {
    const bookings = await api("/api/admin/bookings");
    $("bookingCount").textContent = `Записів у списку: ${bookings.length}`;
    const labels = { new: "Нова", confirmed: "Підтверджена", completed: "Завершена", cancelled: "Скасована" };
    $("bookingRows").innerHTML = bookings.length ? bookings.map(b => `
      <tr>
        <td>${escapeHtml(b.appointment_date)}<br><strong>${escapeHtml(b.appointment_time)}</strong></td>
        <td>${escapeHtml(b.customer_name)}<br><a href="tel:${escapeHtml(b.phone)}">${escapeHtml(b.phone)}</a></td>
        <td>${escapeHtml(b.service_name)}<br>${b.price} грн</td>
        <td>${escapeHtml(b.barber_name)}</td>
        <td><select class="status-select" data-id="${b.id}" aria-label="Статус запису">
          ${Object.entries(labels).map(([value,label]) => `<option value="${value}" ${b.status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></td>
        <td><button class="small-action" data-save="${b.id}">ЗБЕРЕГТИ</button></td>
      </tr>`).join("") : '<tr><td colspan="6">Поки що записів немає.</td></tr>';
    $("bookingRows").querySelectorAll("[data-save]").forEach(button => button.addEventListener("click", async () => {
      const id = button.dataset.save;
      const status = $("bookingRows").querySelector(`select[data-id="${id}"]`).value;
      try {
        await api(`/api/admin/bookings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        dashboardMessage.textContent = "Статус запису оновлено.";
        await loadBookings();
      } catch (error) { dashboardMessage.textContent = error.message; }
    }));
  } catch (error) {
    dashboardMessage.textContent = error.message;
  }
}
$("refreshButton").addEventListener("click", loadBookings);
$("logoutButton").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch {}
  await checkLogin();
});
checkLogin();
