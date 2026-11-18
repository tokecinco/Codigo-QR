import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  showToast,
  escapeHtml,
  formatCurrency,
  isExpired,
  buildWhatsAppUrl
} from "./utils.js";

let businessId = null;
let currentBiz = null;
let activeServices = [];
let selectedService = null;

const loadingEl = document.getElementById("turnosLoading");
const unavailableEl = document.getElementById("turnosUnavailable");
const formViewEl = document.getElementById("turnosFormView");
const successViewEl = document.getElementById("turnosSuccessView");

window.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  const params = new URLSearchParams(window.location.search);
  businessId = params.get("id")?.trim();

  if (!businessId) {
    showUnavailable("Enlace inválido", "Escanea nuevamente el código QR del comercio.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  document.getElementById("appDate").value = today;
  document.getElementById("appDate").min = today;

  await initTurnosPage();
});

async function initTurnosPage() {
  try {
    const bizSnap = await getDoc(doc(db, "businesses", businessId));
    if (!bizSnap.exists()) {
      showUnavailable("Negocio no encontrado", "El código QR no corresponde a un negocio activo.");
      return;
    }

    currentBiz = { id: bizSnap.id, ...bizSnap.data() };
    applyBranding();

    if (!currentBiz.active || isExpired(currentBiz.expiresAt)) {
      showUnavailable(
        "Turnos temporalmente pausados",
        "Este negocio no tiene habilitada la recepción de turnos en este momento.",
        true
      );
      return;
    }

    if (!currentBiz.limits?.includesTurnos) {
      showUnavailable(
        "Módulo no habilitado",
        "Este comercio no utiliza el sistema de Turnos QR.",
        true
      );
      return;
    }

    const used = currentBiz.usage?.appointmentsCount || 0;
    const max = currentBiz.limits?.maxAppointments || 0;
    if (used >= max) {
      showUnavailable(
        "Cupo de turnos completo",
        "Este negocio alcanzó el límite de turnos disponibles por el momento. Puedes escribirles directamente por WhatsApp.",
        true
      );
      return;
    }

    const srvSnap = await getDocs(collection(db, "businesses", businessId, "services"));
    activeServices = srvSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.active !== false);

    if (activeServices.length === 0) {
      showUnavailable(
        "Sin servicios cargados",
        "El negocio aún no configuró servicios disponibles para reservar.",
        true
      );
      return;
    }

    renderServicesList();
    loadingEl.classList.add("hidden");
    formViewEl.classList.remove("hidden");
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    showUnavailable("Error de conexión", "No pudimos cargar los turnos. Intenta nuevamente.");
  }
}

function applyBranding() {
  document.title = `Turnos — ${currentBiz.name || "Toke QR"}`;
  document.getElementById("bizNameHeader").textContent = currentBiz.name || "Negocio";
  document.getElementById("bizCategoryHeader").textContent = currentBiz.category || "Turnos QR";

  const primary = currentBiz.theme?.primaryColor || "#4f46e5";
  const accent = currentBiz.theme?.accentColor || "#0f172a";
  document.documentElement.style.setProperty("--primary", primary);
  document.documentElement.style.setProperty("--dark", accent);
  document.getElementById("bizBrandIcon").style.background = primary;

  if (currentBiz.whatsapp) {
    const waBtn = document.getElementById("bizContactWaBtn");
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, quiero consultar sobre un turno.`
    );
    waBtn.classList.remove("hidden");
  }
}

function showUnavailable(title, msg, showWa = false) {
  loadingEl.classList.add("hidden");
  formViewEl.classList.add("hidden");
  document.getElementById("unavailableTitle").textContent = title;
  document.getElementById("unavailableMsg").textContent = msg;
  const waBtn = document.getElementById("unavailableWaBtn");
  if (showWa && currentBiz?.whatsapp) {
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, quisiera consultar para solicitar un turno.`
    );
    waBtn.classList.remove("hidden");
  }
  unavailableEl.classList.remove("hidden");
  lucide.createIcons();
}

function renderServicesList() {
  const container = document.getElementById("servicesOptionsList");
  container.innerHTML = activeServices
    .map(
      (s, idx) => `
      <button
        type="button"
        class="card card-compact service-option-card ${idx === 0 ? "selected-service" : ""}"
        data-id="${s.id}"
        style="text-align:left;cursor:pointer;border-width:2px;border-color:${
          idx === 0 ? "var(--primary)" : "var(--border)"
        };background:${idx === 0 ? "var(--primary-soft)" : "var(--surface)"};"
      >
        <div class="flex-between">
          <strong style="color:var(--dark);">${escapeHtml(s.name)}</strong>
          <strong style="color:var(--primary);">${formatCurrency(s.price || 0)}</strong>
        </div>
        <div class="text-xs text-muted mt-1">Duración aprox: ${s.duration || 30} min</div>
      </button>
    `
    )
    .join("");

  selectedService = activeServices[0];
  document.getElementById("selectedServiceId").value = selectedService.id;

  container.querySelectorAll(".service-option-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedService = activeServices.find((x) => x.id === card.dataset.id);
      document.getElementById("selectedServiceId").value = selectedService.id;
      container.querySelectorAll(".service-option-card").forEach((c) => {
        const isSel = c.dataset.id === selectedService.id;
        c.style.borderColor = isSel ? "var(--primary)" : "var(--border)";
        c.style.background = isSel ? "var(--primary-soft)" : "var(--surface)";
      });
    });
  });
}

document.getElementById("bookAppointmentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedService) {
    showToast("Selecciona un servicio", "error");
    return;
  }

  const customerName = document.getElementById("customerName").value.trim();
  const customerPhone = document.getElementById("customerPhone").value.trim();
  const date = document.getElementById("appDate").value;
  const time = document.getElementById("appTime").value;

  if (customerPhone.replace(/[^\d]/g, "").length < 6) {
    showToast("Ingresa un número de WhatsApp válido", "error");
    return;
  }

  const btn = document.getElementById("submitAppointmentBtn");
  btn.disabled = true;
  btn.textContent = "Enviando solicitud...";

  try {
    const bizRef = doc(db, "businesses", businessId);
    const appRef = doc(collection(db, "businesses", businessId, "appointments"));

    await runTransaction(db, async (tx) => {
      const bizSnap = await tx.get(bizRef);
      const data = bizSnap.data();
      if (!data.active || isExpired(data.expiresAt)) {
        throw new Error("BUSINESS_INACTIVE");
      }
      const used = data.usage?.appointmentsCount || 0;
      const max = data.limits?.maxAppointments || 0;
      if (used >= max) {
        throw new Error("LIMIT_REACHED");
      }

      tx.set(appRef, {
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        customerName,
        customerPhone,
        date,
        time,
        status: "pendiente",
        createdAt: serverTimestamp()
      });

      tx.update(bizRef, {
        "usage.appointmentsCount": used + 1
      });
    });

    formViewEl.classList.add("hidden");
    document.getElementById("successSummary").innerHTML = `
      <div><strong>Negocio:</strong> ${escapeHtml(currentBiz.name)}</div>
      <div><strong>Servicio:</strong> ${escapeHtml(selectedService.name)} (${formatCurrency(selectedService.price || 0)})</div>
      <div><strong>Fecha y hora:</strong> ${escapeHtml(date)} a las ${escapeHtml(time)}</div>
      <div><strong>Cliente:</strong> ${escapeHtml(customerName)}</div>
    `;

    const waBtn = document.getElementById("successWaBtn");
    if (currentBiz.whatsapp) {
      waBtn.href = buildWhatsAppUrl(
        currentBiz.whatsapp,
        `Hola ${currentBiz.name}, acabo de solicitar un turno:\n• Servicio: ${selectedService.name}\n• Fecha: ${date} ${time}\n• Nombre: ${customerName}`
      );
      waBtn.classList.remove("hidden");
    } else {
      waBtn.classList.add("hidden");
    }

    const menuBtn = document.getElementById("goToBizMenuBtn");
    if (currentBiz.limits?.includesMenu) {
      menuBtn.href = `menu.html?id=${encodeURIComponent(businessId)}`;
      menuBtn.classList.remove("hidden");
    } else {
      menuBtn.classList.add("hidden");
    }

    successViewEl.classList.remove("hidden");
    showToast("¡Turno solicitado con éxito!", "success");
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    if (err.message === "LIMIT_REACHED") {
      showUnavailable(
        "Cupo de turnos completo",
        "Se acaba de completar el límite de turnos de este negocio.",
        true
      );
    } else if (err.message === "BUSINESS_INACTIVE") {
      showUnavailable("Turnos pausados", "Este negocio pausó su recepción de turnos.", true);
    } else {
      showToast("No se pudo registrar el turno. Revisa los datos.", "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirmar solicitud de turno";
  }
});

document.getElementById("bookAnotherBtn").addEventListener("click", () => {
  window.location.reload();
});

document.getElementById("backTurnosBtn").addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.reload();
  }
});
