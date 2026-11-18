import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
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
let activeTicket = null;
let servicesLoaded = false;

const loadingEl = document.getElementById("turnosLoading");
const unavailableEl = document.getElementById("turnosUnavailable");
const queueBoardEl = document.getElementById("turnosQueueBoard");
const formViewEl = document.getElementById("turnosFormView");
const successViewEl = document.getElementById("turnosSuccessView");

function getTicketStorageKey() {
  return `toke_qr_ticket_${businessId}`;
}

function loadSavedTicket() {
  try {
    const raw = localStorage.getItem(getTicketStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTicketLocally(ticketObj) {
  activeTicket = ticketObj;
  localStorage.setItem(getTicketStorageKey(), JSON.stringify(ticketObj));
}

window.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  const params = new URLSearchParams(window.location.search);
  businessId = params.get("id")?.trim();

  if (!businessId) {
    showUnavailable("Enlace inválido", "Escanea nuevamente el código QR del comercio.");
    return;
  }

  activeTicket = loadSavedTicket();
  startLiveBusinessWatcher();
});

function startLiveBusinessWatcher() {
  onSnapshot(
    doc(db, "businesses", businessId),
    async (bizSnap) => {
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

      const lastNum = currentBiz.queue?.lastNumber || 0;
      if (activeTicket && lastNum < activeTicket.ticketNumber) {
        localStorage.removeItem(getTicketStorageKey());
        activeTicket = null;
      }

      updateLiveQueueUI();

      if (!servicesLoaded) {
        servicesLoaded = true;
        const used = currentBiz.usage?.appointmentsCount || 0;
        const max = currentBiz.limits?.maxAppointments || 0;

        if (used >= max && !activeTicket) {
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
        queueBoardEl.classList.remove("hidden");

        if (activeTicket && activeTicket.ticketNumber >= (currentBiz.queue?.currentNumber || 0)) {
          showTicketSuccessView(activeTicket);
        } else {
          formViewEl.classList.remove("hidden");
        }
        lucide.createIcons();
      }
    },
    (err) => {
      console.error(err);
      showUnavailable("Error de conexión", "No pudimos cargar los turnos. Intenta nuevamente.");
    }
  );
}

function updateLiveQueueUI() {
  if (!currentBiz) return;
  const currentNum = currentBiz.queue?.currentNumber || 0;
  const lastNum = currentBiz.queue?.lastNumber || 0;
  const waiting = Math.max(0, lastNum - currentNum);

  document.getElementById("liveCurrentNum").textContent = `#${currentNum}`;
  document.getElementById("liveLastNum").textContent = `#${lastNum}`;
  document.getElementById("liveWaitingNum").textContent = waiting;

  const savedBanner = document.getElementById("mySavedTicketBanner");
  if (activeTicket) {
    const remaining = Math.max(0, activeTicket.ticketNumber - currentNum);
    document.getElementById("mySavedTicketText").textContent =
      currentNum > activeTicket.ticketNumber
        ? `Tu turno #${activeTicket.ticketNumber} ya fue llamado`
        : remaining === 0
        ? `¡Es tu turno #${activeTicket.ticketNumber}!`
        : `Tu turno: #${activeTicket.ticketNumber} · Te faltan ${remaining}`;
    savedBanner.classList.remove("hidden");
  } else {
    savedBanner.classList.add("hidden");
  }

  if (activeTicket && !successViewEl.classList.contains("hidden")) {
    updateSuccessTracker();
  }
}

function updateSuccessTracker() {
  if (!activeTicket || !currentBiz) return;
  const currentNum = currentBiz.queue?.currentNumber || 0;
  const myNum = activeTicket.ticketNumber;
  const diff = myNum - currentNum;

  document.getElementById("myTicketBigNum").textContent = `#${myNum}`;
  document.getElementById("liveTrackerCurrent").textContent = `#${currentNum}`;

  const remEl = document.getElementById("liveTrackerRemaining");
  const msgEl = document.getElementById("liveTrackerMsg");

  if (diff > 1) {
    remEl.textContent = `${diff}`;
    remEl.style.color = "var(--primary)";
    msgEl.textContent = `Faltan ${diff} números para tu turno. Esta pantalla se actualiza sola.`;
    msgEl.style.color = "var(--dark)";
  } else if (diff === 1) {
    remEl.textContent = "1";
    remEl.style.color = "var(--warning)";
    msgEl.textContent = "⚡ ¡Prepárate! Eres el próximo número en pasar.";
    msgEl.style.color = "#b45309";
  } else if (diff === 0) {
    remEl.textContent = "¡YA!";
    remEl.style.color = "var(--success)";
    msgEl.textContent = `🎉 ¡ES TU TURNO (#${myNum})! Ya puedes acercarte.`;
    msgEl.style.color = "#047857";
  } else {
    remEl.textContent = "Llamado";
    remEl.style.color = "var(--muted)";
    msgEl.textContent = `El número #${myNum} ya fue llamado.`;
    msgEl.style.color = "var(--muted)";
  }
}

function applyBranding() {
  document.title = `Turnos — ${currentBiz.name || "Toke QR"}`;
  document.getElementById("bizNameHeader").textContent = currentBiz.name || "Negocio";
  document.getElementById("bizCategoryHeader").textContent = currentBiz.category || "Turnos por número";

  const primary = currentBiz.theme?.primaryColor || "#7c3aed";
  const accent = currentBiz.theme?.accentColor || "#07192b";
  document.documentElement.style.setProperty("--primary", primary);
  document.documentElement.style.setProperty("--dark", accent);
  document.getElementById("bizBrandIcon").style.background = primary;

  if (currentBiz.whatsapp) {
    const waBtn = document.getElementById("bizContactWaBtn");
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, quiero consultar sobre los turnos.`
    );
    waBtn.classList.remove("hidden");
  }
}

function showUnavailable(title, msg, showWa = false) {
  loadingEl.classList.add("hidden");
  queueBoardEl.classList.add("hidden");
  formViewEl.classList.add("hidden");
  successViewEl.classList.add("hidden");
  document.getElementById("unavailableTitle").textContent = title;
  document.getElementById("unavailableMsg").textContent = msg;
  const waBtn = document.getElementById("unavailableWaBtn");
  if (showWa && currentBiz?.whatsapp) {
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, quisiera consultar por un turno.`
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
        <div class="text-xs text-muted mt-1">Duración aprox: ${s.duration || 15} min</div>
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

  if (customerPhone.replace(/[^\d]/g, "").length < 6) {
    showToast("Ingresa un número de WhatsApp válido", "error");
    return;
  }

  const btn = document.getElementById("submitAppointmentBtn");
  btn.disabled = true;
  btn.textContent = "Asignando número...";

  try {
    const bizRef = doc(db, "businesses", businessId);
    const appRef = doc(collection(db, "businesses", businessId, "appointments"));

    let assignedTicketNumber = 1;

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

      const currentNum = data.queue?.currentNumber || 0;
      const lastNum = data.queue?.lastNumber || 0;
      assignedTicketNumber = lastNum + 1;

      tx.set(appRef, {
        ticketNumber: assignedTicketNumber,
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        customerName,
        customerPhone,
        status: "pendiente",
        createdAt: serverTimestamp()
      });

      tx.update(bizRef, {
        "usage.appointmentsCount": used + 1,
        queue: {
          currentNumber: currentNum,
          lastNumber: assignedTicketNumber
        }
      });
    });

    const ticketInfo = {
      id: appRef.id,
      ticketNumber: assignedTicketNumber,
      serviceName: selectedService.name,
      servicePrice: selectedService.price || 0,
      customerName
    };
    saveTicketLocally(ticketInfo);
    showTicketSuccessView(ticketInfo);
    showToast(`¡Tu número es el #${assignedTicketNumber}!`, "success");
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
      showToast("No se pudo sacar número. Revisa los datos.", "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Sacar mi número de turno";
  }
});

function showTicketSuccessView(ticketInfo) {
  formViewEl.classList.add("hidden");
  document.getElementById("successSummary").innerHTML = `
    <div><strong>Negocio:</strong> ${escapeHtml(currentBiz.name)}</div>
    <div><strong>Número asignado:</strong> #${ticketInfo.ticketNumber}</div>
    <div><strong>Servicio:</strong> ${escapeHtml(ticketInfo.serviceName)} (${formatCurrency(ticketInfo.servicePrice || 0)})</div>
    <div><strong>Cliente:</strong> ${escapeHtml(ticketInfo.customerName)}</div>
  `;

  const waBtn = document.getElementById("successWaBtn");
  if (currentBiz.whatsapp) {
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, acabo de sacar el turno *#${ticketInfo.ticketNumber}*:\n• Servicio: ${ticketInfo.serviceName}\n• Nombre: ${ticketInfo.customerName}`
    );
    waBtn.classList.remove("hidden");
  } else {
    waBtn.classList.add("hidden");
  }

  updateSuccessTracker();
  successViewEl.classList.remove("hidden");
  lucide.createIcons();
}

document.getElementById("viewMyTicketBtn").addEventListener("click", () => {
  if (activeTicket) {
    showTicketSuccessView(activeTicket);
  }
});

document.getElementById("bookAnotherBtn").addEventListener("click", () => {
  successViewEl.classList.add("hidden");
  document.getElementById("bookAppointmentForm").reset();
  formViewEl.classList.remove("hidden");
});
