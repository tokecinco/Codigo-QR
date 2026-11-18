import { auth, db } from "./firebase-config.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  showToast,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  daysRemaining,
  isExpired,
  buildWhatsAppUrl,
  compressImageToBase64,
  copyToClipboard,
  getBaseUrl
} from "./utils.js";

const STORAGE_CODE_KEY = "toke_qr_business_code";

let currentBusinessId = null;
let currentBiz = null;
let servicesState = [];
let appointmentsState = [];
let categoriesState = [];
let productsState = [];
let ordersState = [];
let pendingProductImage = "";

let unsubBiz = null;
let unsubAppointments = null;
let unsubOrders = null;
let firstOrdersLoad = true;
let knownOrderIds = new Set();

const loginView = document.getElementById("panelLoginView");
const dashboardView = document.getElementById("panelDashboardView");
const logoutBtn = document.getElementById("panelLogoutBtn");

const serviceModal = document.getElementById("serviceModal");
const productModal = document.getElementById("productModal");

function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(784, ctx.currentTime);
    osc.frequency.setValueAtTime(1046, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Silencioso si el navegador bloquea audio automático
  }
}

function stopLiveListeners() {
  if (unsubBiz) { unsubBiz(); unsubBiz = null; }
  if (unsubAppointments) { unsubAppointments(); unsubAppointments = null; }
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
}

window.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  const params = new URLSearchParams(window.location.search);
  const urlCode = params.get("code")?.trim().toUpperCase();
  const savedCode = localStorage.getItem(STORAGE_CODE_KEY)?.trim().toUpperCase();
  const initialCode = urlCode || savedCode;

  if (initialCode) {
    document.getElementById("accessCodeInput").value = initialCode;
    await connectWithCode(initialCode, true);
  }
});

document.getElementById("panelLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = document.getElementById("accessCodeInput").value.trim().toUpperCase();
  if (!code) return;
  await connectWithCode(code, false);
});

logoutBtn.addEventListener("click", () => {
  stopLiveListeners();
  localStorage.removeItem(STORAGE_CODE_KEY);
  currentBusinessId = null;
  currentBiz = null;
  dashboardView.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  loginView.classList.remove("hidden");
  document.getElementById("navBizName").textContent = "Toke QR";
  showToast("Saliste del panel");
});

async function connectWithCode(code, silent = false) {
  const btn = document.getElementById("panelLoginBtn");
  btn.disabled = true;
  btn.textContent = "Validando código...";

  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const codeSnap = await getDoc(doc(db, "businessCodes", code));
    if (!codeSnap.exists()) {
      if (!silent) showToast("Código de acceso no válido.", "error");
      localStorage.removeItem(STORAGE_CODE_KEY);
      return;
    }

    const { businessId } = codeSnap.data();
    await setDoc(doc(db, "businesses", businessId, "sessions", auth.currentUser.uid), {
      code,
      createdAt: serverTimestamp()
    });

    currentBusinessId = businessId;
    localStorage.setItem(STORAGE_CODE_KEY, code);

    await loadBusinessDashboard();
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    if (!silent) showToast("Acceso concedido", "success");
  } catch (err) {
    console.error(err);
    localStorage.removeItem(STORAGE_CODE_KEY);
    if (!silent) showToast("Código incorrecto o sin autorización.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ingresar al Panel";
  }
}

function isBusinessOperational() {
  return Boolean(currentBiz && currentBiz.active && !isExpired(currentBiz.expiresAt));
}

function requireOperational() {
  if (!isBusinessOperational()) {
    showToast("Tu servicio está vencido o suspendido. Contacta al administrador.", "error");
    return false;
  }
  return true;
}

// Pestañas
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

async function loadBusinessDashboard() {
  stopLiveListeners();
  firstOrdersLoad = true;
  knownOrderIds.clear();

  const bizSnap = await getDoc(doc(db, "businesses", currentBusinessId));
  if (!bizSnap.exists()) throw new Error("Negocio no encontrado");
  currentBiz = { id: bizSnap.id, ...bizSnap.data() };

  renderHeaderAndLimits();
  renderQueueBoard();
  renderQrSection();
  fillSettingsForm();

  unsubBiz = onSnapshot(doc(db, "businesses", currentBusinessId), (snap) => {
    if (!snap.exists()) return;
    currentBiz = { id: snap.id, ...snap.data() };
    renderHeaderAndLimits();
    renderQueueBoard();
  });

  const promises = [];
  if (currentBiz.limits?.includesTurnos) {
    promises.push(loadServices());
    startAppointmentsListener();
  }
  if (currentBiz.limits?.includesMenu) {
    promises.push(loadCategories(), loadProducts());
    startOrdersListener();
  }
  await Promise.all(promises);
  lucide.createIcons();
}

function renderHeaderAndLimits() {
  document.getElementById("navBizName").textContent = currentBiz.name || "Toke QR";
  document.getElementById("bizTitle").textContent = currentBiz.name || "Mi Negocio";
  document.getElementById("bizPackageLabel").textContent = currentBiz.packageName || "Plan";
  document.getElementById("bizExpiresLabel").textContent = formatDate(currentBiz.expiresAt);

  const badge = document.getElementById("bizStatusBadge");
  const expiredAlert = document.getElementById("expiredAlert");
  const operational = isBusinessOperational();

  if (!currentBiz.active) {
    badge.className = "badge badge-inactive";
    badge.textContent = "Suspendido";
    expiredAlert.classList.remove("hidden");
  } else if (isExpired(currentBiz.expiresAt)) {
    badge.className = "badge badge-cancelado";
    badge.textContent = "Vencido";
    expiredAlert.classList.remove("hidden");
  } else {
    const days = daysRemaining(currentBiz.expiresAt);
    badge.className = "badge badge-active";
    badge.textContent = `Activo (${days}d restantes)`;
    expiredAlert.classList.add("hidden");
  }

  const usedApp = currentBiz.usage?.appointmentsCount || 0;
  const maxApp = currentBiz.limits?.maxAppointments || 0;
  const appPct = maxApp > 0 ? Math.min(100, Math.round((usedApp / maxApp) * 100)) : 100;
  document.getElementById("turnosQuotaText").textContent = `${usedApp} / ${maxApp}`;
  document.getElementById("turnosQuotaBar").style.width = `${appPct}%`;
  document.getElementById("turnosQuotaBox").classList.toggle("hidden", !currentBiz.limits?.includesTurnos);

  const usedProd = currentBiz.usage?.productsCount || 0;
  const maxProd = currentBiz.limits?.maxProducts || 0;
  const prodPct = maxProd > 0 ? Math.min(100, Math.round((usedProd / maxProd) * 100)) : 100;
  document.getElementById("productsQuotaText").textContent = `${usedProd} / ${maxProd}`;
  document.getElementById("productsQuotaBar").style.width = `${prodPct}%`;
  document.getElementById("productsQuotaBox").classList.toggle("hidden", !currentBiz.limits?.includesMenu);

  const hasTurnos = Boolean(currentBiz.limits?.includesTurnos);
  const hasMenu = Boolean(currentBiz.limits?.includesMenu);

  document.getElementById("turnosDisabledMsg").classList.toggle("hidden", hasTurnos);
  document.getElementById("turnosModuleContent").classList.toggle("hidden", !hasTurnos);
  document.getElementById("menuDisabledMsg").classList.toggle("hidden", hasMenu);
  document.getElementById("menuModuleContent").classList.toggle("hidden", !hasMenu);

  const newProdBtn = document.getElementById("newProductBtn");
  newProdBtn.disabled = !operational || usedProd >= maxProd;
  document.getElementById("productLimitHint").textContent =
    usedProd >= maxProd
      ? `Alcanzaste el límite de ${maxProd} productos de tu paquete.`
      : `Disponibles: ${Math.max(0, maxProd - usedProd)} productos más en tu paquete.`;
}

// ==========================================
// MÓDULO TURNOS QR POR NÚMERO
// ==========================================
async function loadServices() {
  const snap = await getDocs(collection(db, "businesses", currentBusinessId, "services"));
  servicesState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderServices();
}

function renderServices() {
  const container = document.getElementById("servicesList");
  if (servicesState.length === 0) {
    container.innerHTML = `<div class="empty-state text-sm" style="grid-column:1/-1;">Aún no creaste servicios. Agrega uno para que tus clientes saquen número.</div>`;
    return;
  }

  container.innerHTML = servicesState
    .map(
      (s) => `
      <div class="card card-compact flex-between gap-2">
        <div>
          <div class="flex gap-1">
            <strong style="color:var(--dark);">${escapeHtml(s.name)}</strong>
            <span class="badge ${s.active !== false ? "badge-active" : "badge-inactive"}">
              ${s.active !== false ? "Activo" : "Oculto"}
            </span>
          </div>
          <div class="text-xs text-muted mt-1">
            ${s.duration || 15} min · <strong>${formatCurrency(s.price || 0)}</strong>
          </div>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-outline btn-sm edit-service-btn" data-id="${s.id}">Editar</button>
          <button class="btn btn-danger btn-sm delete-service-btn" data-id="${s.id}">✕</button>
        </div>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".edit-service-btn").forEach((btn) =>
    btn.addEventListener("click", () => openServiceModal(btn.dataset.id))
  );
  container.querySelectorAll(".delete-service-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteService(btn.dataset.id))
  );
}

document.getElementById("newServiceBtn").addEventListener("click", () => {
  if (!requireOperational()) return;
  openServiceModal(null);
});
document.getElementById("closeServiceModal").addEventListener("click", () => serviceModal.classList.add("hidden"));
document.getElementById("cancelServiceModal").addEventListener("click", () => serviceModal.classList.add("hidden"));

function openServiceModal(id) {
  document.getElementById("serviceForm").reset();
  if (!id) {
    document.getElementById("serviceModalTitle").textContent = "Nuevo Servicio";
    document.getElementById("serviceId").value = "";
    document.getElementById("serviceDuration").value = 15;
    document.getElementById("servicePrice").value = 0;
    document.getElementById("serviceActive").checked = true;
  } else {
    const s = servicesState.find((x) => x.id === id);
    if (!s) return;
    document.getElementById("serviceModalTitle").textContent = "Editar Servicio";
    document.getElementById("serviceId").value = s.id;
    document.getElementById("serviceName").value = s.name || "";
    document.getElementById("serviceDuration").value = s.duration || 15;
    document.getElementById("servicePrice").value = s.price ?? 0;
    document.getElementById("serviceActive").checked = s.active !== false;
  }
  serviceModal.classList.remove("hidden");
}

document.getElementById("serviceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireOperational()) return;

  const id = document.getElementById("serviceId").value;
  const payload = {
    name: document.getElementById("serviceName").value.trim(),
    duration: Number(document.getElementById("serviceDuration").value || 15),
    price: Number(document.getElementById("servicePrice").value || 0),
    active: document.getElementById("serviceActive").checked
  };

  try {
    if (id) {
      await updateDoc(doc(db, "businesses", currentBusinessId, "services", id), payload);
    } else {
      await addDoc(collection(db, "businesses", currentBusinessId, "services"), payload);
    }
    serviceModal.classList.add("hidden");
    showToast("Servicio guardado", "success");
    await loadServices();
  } catch (err) {
    console.error(err);
    showToast("Error al guardar servicio", "error");
  }
});

async function deleteService(id) {
  if (!requireOperational()) return;
  if (!confirm("¿Eliminar este servicio?")) return;
  try {
    await deleteDoc(doc(db, "businesses", currentBusinessId, "services", id));
    showToast("Servicio eliminado");
    await loadServices();
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar servicio", "error");
  }
}

function startAppointmentsListener() {
  const q = query(collection(db, "businesses", currentBusinessId, "appointments"), orderBy("createdAt", "asc"));
  unsubAppointments = onSnapshot(q, (snap) => {
    appointmentsState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    appointmentsState.sort((a, b) => (a.ticketNumber || 0) - (b.ticketNumber || 0));
    renderQueueBoard();
    renderAppointments();
  }, (err) => console.error(err));
}

function getWaitingAppointments() {
  const currentNum = currentBiz?.queue?.currentNumber || 0;
  return appointmentsState.filter(
    (a) => a.status === "pendiente" && (a.ticketNumber || 0) > currentNum
  );
}

function renderQueueBoard() {
  if (!currentBiz) return;
  const currentNum = currentBiz.queue?.currentNumber || 0;
  const lastNum = currentBiz.queue?.lastNumber || 0;
  const waiting = getWaitingAppointments();
  const nextApp = waiting[0];

  document.getElementById("queueCurrentNum").textContent = `#${currentNum}`;
  document.getElementById("queueLastNum").textContent = `#${lastNum}`;
  document.getElementById("queueWaitingCount").textContent = waiting.length;
  document.getElementById("queueNextLabel").textContent = nextApp
    ? `#${nextApp.ticketNumber} — ${nextApp.customerName} (${nextApp.serviceName || "Turno"})`
    : "Sin turnos en espera";
}

document.getElementById("nextTurnBtn").addEventListener("click", async () => {
  if (!requireOperational()) return;
  const currentNum = currentBiz.queue?.currentNumber || 0;
  const lastNum = currentBiz.queue?.lastNumber || 0;
  const waiting = getWaitingAppointments();
  const nextApp = waiting[0];

  const currentActiveApps = appointmentsState.filter(
    (a) => (a.status === "confirmado" || a.status === "pendiente") && (a.ticketNumber || 0) <= currentNum
  );

  if (!nextApp && currentActiveApps.length === 0) {
    showToast("No hay más números en espera en este momento.");
    return;
  }

  const btn = document.getElementById("nextTurnBtn");
  btn.disabled = true;

  try {
    const batch = writeBatch(db);
    currentActiveApps.forEach((a) => {
      batch.update(doc(db, "businesses", currentBusinessId, "appointments", a.id), {
        status: "atendido"
      });
    });

    if (nextApp) {
      batch.update(doc(db, "businesses", currentBusinessId, "appointments", nextApp.id), {
        status: "confirmado"
      });
      batch.update(doc(db, "businesses", currentBusinessId), {
        queue: {
          currentNumber: nextApp.ticketNumber,
          lastNumber: Math.max(lastNum, nextApp.ticketNumber)
        }
      });
    }

    await batch.commit();

    if (nextApp) {
      const waMsg = `¡Hola ${nextApp.customerName}! Es tu turno *#${nextApp.ticketNumber}* en *${currentBiz.name}* (${nextApp.serviceName || "Atención"}). ¡Ya puedes acercarte!`;
      const waUrl = buildWhatsAppUrl(nextApp.customerPhone, waMsg);

      document.getElementById("nextTurnWaText").textContent =
        `Turno #${nextApp.ticketNumber} (${nextApp.customerName}) llamado`;
      document.getElementById("nextTurnWaLink").href = waUrl;
      document.getElementById("nextTurnWaBanner").classList.remove("hidden");

      showToast(`Llamando al número #${nextApp.ticketNumber}`, "success");
      window.open(waUrl, "_blank");
    } else {
      document.getElementById("nextTurnWaBanner").classList.add("hidden");
      showToast("Turno finalizado. No quedan números en espera.", "success");
    }
  } catch (err) {
    console.error(err);
    showToast("Error al avanzar al siguiente número", "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("resetQueueBtn").addEventListener("click", async () => {
  if (!requireOperational()) return;
  if (!confirm("¿Reiniciar los números a #0 para comenzar una nueva jornada? Se limpiará la lista actual de turnos.")) return;

  try {
    const chunks = [];
    for (let i = 0; i < appointmentsState.length; i += 400) {
      chunks.push(appointmentsState.slice(i, i + 400));
    }
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach((a) => {
        batch.delete(doc(db, "businesses", currentBusinessId, "appointments", a.id));
      });
      await batch.commit();
    }

    await updateDoc(doc(db, "businesses", currentBusinessId), {
      queue: { currentNumber: 0, lastNumber: 0 }
    });

    document.getElementById("nextTurnWaBanner").classList.add("hidden");
    showToast("Fila reiniciada a #0", "success");
  } catch (err) {
    console.error(err);
    showToast("No se pudo reiniciar la fila", "error");
  }
});

document.getElementById("appointmentStatusFilter").addEventListener("change", renderAppointments);
document.getElementById("refreshAppointmentsBtn").addEventListener("click", async () => {
  await loadBusinessDashboard();
  showToast("Lista actualizada");
});

function renderAppointments() {
  const filter = document.getElementById("appointmentStatusFilter").value;
  const container = document.getElementById("appointmentsList");
  const list = appointmentsState.filter((a) => filter === "all" || a.status === filter);

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state text-sm">No hay números en esta categoría.</div>`;
    return;
  }

  container.innerHTML = list
    .map((a) => {
      const status = a.status || "pendiente";
      const numLabel = a.ticketNumber ? `#${a.ticketNumber}` : "—";
      const waMsg =
        status === "cancelado"
          ? `Hola ${a.customerName}, te escribimos de ${currentBiz.name}. Tu turno ${numLabel} (${a.serviceName}) fue cancelado.`
          : `¡Hola ${a.customerName}! Te escribimos de *${currentBiz.name}* por tu turno *${numLabel}* (${a.serviceName}). ¡Ya casi es tu momento!`;
      const waUrl = buildWhatsAppUrl(a.customerPhone, waMsg);

      return `
        <div class="card card-compact">
          <div class="flex-between flex-wrap gap-2">
            <div class="flex gap-2" style="align-items:flex-start;">
              <span class="queue-number-pill">${escapeHtml(numLabel)}</span>
              <div>
                <div class="flex gap-1 flex-wrap">
                  <strong style="color:var(--dark);">${escapeHtml(a.customerName)}</strong>
                  <span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>
                </div>
                <div class="text-sm mt-1">
                  Servicio: <strong>${escapeHtml(a.serviceName || "—")}</strong>
                </div>
                <div class="text-xs text-muted mt-1">
                  WhatsApp: ${escapeHtml(a.customerPhone)} · ${formatDateTime(a.createdAt)}
                </div>
              </div>
            </div>
            <div class="flex flex-wrap gap-1">
              <select class="select app-status-select" data-id="${a.id}" style="width:auto;min-height:36px;padding:4px 10px;font-size:0.82rem;">
                <option value="pendiente" ${status === "pendiente" ? "selected" : ""}>En espera</option>
                <option value="confirmado" ${status === "confirmado" ? "selected" : ""}>Llamado</option>
                <option value="atendido" ${status === "atendido" ? "selected" : ""}>Atendido</option>
                <option value="cancelado" ${status === "cancelado" ? "selected" : ""}>Cancelado</option>
              </select>
              <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm">
                <i data-lucide="message-circle" style="width:14px;height:14px;"></i> WhatsApp
              </a>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".app-status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      if (!requireOperational()) {
        renderAppointments();
        return;
      }
      const id = sel.dataset.id;
      const newStatus = e.target.value;
      try {
        await updateDoc(doc(db, "businesses", currentBusinessId, "appointments", id), { status: newStatus });
        showToast("Estado actualizado", "success");
      } catch (err) {
        console.error(err);
        showToast("No se pudo actualizar el turno", "error");
      }
    });
  });
  lucide.createIcons();
}

// ==========================================
// MÓDULO MENÚ Y CATÁLOGOS QR
// ==========================================
async function loadCategories() {
  const snap = await getDocs(collection(db, "businesses", currentBusinessId, "categories"));
  categoriesState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderCategories();
}

function renderCategories() {
  const listEl = document.getElementById("categoriesList");
  const selectEl = document.getElementById("productCategory");

  if (categoriesState.length === 0) {
    listEl.innerHTML = `<span class="text-xs text-muted">Sin categorías creadas aún.</span>`;
  } else {
    listEl.innerHTML = categoriesState
      .map(
        (c) => `
        <span class="badge" style="background:var(--primary-soft);color:var(--primary);padding:6px 12px;">
          ${escapeHtml(c.name)}
          <button type="button" class="delete-cat-btn" data-id="${c.id}" style="background:none;border:none;color:inherit;cursor:pointer;font-weight:700;margin-left:4px;">✕</button>
        </span>
      `
      )
      .join("");
  }

  selectEl.innerHTML =
    `<option value="">Sin categoría</option>` +
    categoriesState.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  listEl.querySelectorAll(".delete-cat-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireOperational()) return;
      try {
        await deleteDoc(doc(db, "businesses", currentBusinessId, "categories", btn.dataset.id));
        showToast("Categoría eliminada");
        await loadCategories();
      } catch (err) {
        console.error(err);
        showToast("Error al eliminar categoría", "error");
      }
    });
  });
}

document.getElementById("categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireOperational()) return;
  const input = document.getElementById("newCategoryName");
  const name = input.value.trim();
  if (!name) return;

  try {
    await addDoc(collection(db, "businesses", currentBusinessId, "categories"), {
      name,
      createdAt: serverTimestamp()
    });
    input.value = "";
    showToast("Categoría agregada", "success");
    await loadCategories();
  } catch (err) {
    console.error(err);
    showToast("Error al crear categoría", "error");
  }
});

async function loadProducts() {
  const snap = await getDocs(collection(db, "businesses", currentBusinessId, "products"));
  productsState = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderProducts();
}

function renderProducts() {
  const container = document.getElementById("productsList");
  if (productsState.length === 0) {
    container.innerHTML = `<div class="empty-state text-sm" style="grid-column:1/-1;">Todavía no cargaste productos en tu catálogo.</div>`;
    return;
  }

  container.innerHTML = productsState
    .map(
      (p) => `
      <div class="product-card">
        ${
          p.imageUrl
            ? `<img src="${escapeHtml(p.imageUrl)}" class="product-img" alt="${escapeHtml(p.name)}" />`
            : `<div class="product-img-placeholder"><i data-lucide="image"></i></div>`
        }
        <div class="product-body">
          <div>
            <div class="flex-between gap-1">
              <strong style="color:var(--dark);font-size:0.95rem;">${escapeHtml(p.name)}</strong>
              <span class="badge ${p.active !== false ? "badge-active" : "badge-inactive"}">
                ${p.active !== false ? "Activo" : "Pausado"}
              </span>
            </div>
            <div class="text-xs text-muted">${escapeHtml(p.categoryName || "General")}</div>
            ${p.description ? `<p class="text-xs text-muted mt-1">${escapeHtml(p.description)}</p>` : ""}
          </div>
          <div class="flex-between flex-wrap gap-1">
            <strong style="color:var(--primary);font-size:0.98rem;">${formatCurrency(p.price)}</strong>
            <div class="flex gap-1 flex-wrap">
              <button class="btn btn-outline btn-sm toggle-product-btn" data-id="${p.id}">
                ${p.active !== false ? "Pausar" : "Activar"}
              </button>
              <button class="btn btn-secondary btn-sm edit-product-btn" data-id="${p.id}">Editar</button>
              <button class="btn btn-danger btn-sm delete-product-btn" data-id="${p.id}">✕</button>
            </div>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".toggle-product-btn").forEach((btn) =>
    btn.addEventListener("click", () => toggleProductActive(btn.dataset.id))
  );
  container.querySelectorAll(".edit-product-btn").forEach((btn) =>
    btn.addEventListener("click", () => openProductModal(btn.dataset.id))
  );
  container.querySelectorAll(".delete-product-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteProduct(btn.dataset.id))
  );
  lucide.createIcons();
}

document.getElementById("newProductBtn").addEventListener("click", () => {
  if (!requireOperational()) return;
  const used = currentBiz.usage?.productsCount || 0;
  const max = currentBiz.limits?.maxProducts || 0;
  if (used >= max) {
    showToast(`Tu paquete permite hasta ${max} productos.`, "error");
    return;
  }
  openProductModal(null);
});
document.getElementById("closeProductModal").addEventListener("click", () => productModal.classList.add("hidden"));
document.getElementById("cancelProductModal").addEventListener("click", () => productModal.classList.add("hidden"));

document.getElementById("productImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const base64 = await compressImageToBase64(file, 480, 0.72);
    pendingProductImage = base64;
    document.getElementById("productImageUrl").value = "";
    const preview = document.getElementById("productImagePreview");
    preview.src = base64;
    preview.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showToast("No se pudo procesar la foto", "error");
  }
});

document.getElementById("productImageUrl").addEventListener("input", (e) => {
  const url = e.target.value.trim();
  pendingProductImage = url;
  const preview = document.getElementById("productImagePreview");
  if (url) {
    preview.src = url;
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
  }
});

function openProductModal(id) {
  document.getElementById("productForm").reset();
  const preview = document.getElementById("productImagePreview");
  preview.classList.add("hidden");
  pendingProductImage = "";

  if (!id) {
    document.getElementById("productModalTitle").textContent = "Nuevo Producto";
    document.getElementById("productId").value = "";
    document.getElementById("productActive").checked = true;
  } else {
    const p = productsState.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("productModalTitle").textContent = "Editar Producto";
    document.getElementById("productId").value = p.id;
    document.getElementById("productName").value = p.name || "";
    document.getElementById("productCategory").value = p.categoryId || "";
    document.getElementById("productPrice").value = p.price ?? 0;
    document.getElementById("productDescription").value = p.description || "";
    document.getElementById("productActive").checked = p.active !== false;
    pendingProductImage = p.imageUrl || "";
    if (p.imageUrl) {
      if (p.imageUrl.startsWith("http")) {
        document.getElementById("productImageUrl").value = p.imageUrl;
      }
      preview.src = p.imageUrl;
      preview.classList.remove("hidden");
    }
  }
  productModal.classList.remove("hidden");
}

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireOperational()) return;

  const btn = document.getElementById("saveProductBtn");
  btn.disabled = true;

  try {
    const id = document.getElementById("productId").value;
    const catId = document.getElementById("productCategory").value;
    const cat = categoriesState.find((c) => c.id === catId);

    const payload = {
      name: document.getElementById("productName").value.trim(),
      categoryId: catId,
      categoryName: cat ? cat.name : "General",
      price: Number(document.getElementById("productPrice").value || 0),
      description: document.getElementById("productDescription").value.trim(),
      imageUrl: pendingProductImage || "",
      active: document.getElementById("productActive").checked
    };

    if (id) {
      await updateDoc(doc(db, "businesses", currentBusinessId, "products", id), payload);
    } else {
      const bizRef = doc(db, "businesses", currentBusinessId);
      const newProdRef = doc(collection(db, "businesses", currentBusinessId, "products"));
      await runTransaction(db, async (tx) => {
        const bizSnap = await tx.get(bizRef);
        const data = bizSnap.data();
        const used = data.usage?.productsCount || 0;
        const max = data.limits?.maxProducts || 0;
        if (used >= max) {
          throw new Error("LIMIT_REACHED");
        }
        tx.set(newProdRef, payload);
        tx.update(bizRef, { "usage.productsCount": used + 1 });
      });
    }

    productModal.classList.add("hidden");
    showToast("Producto guardado", "success");
    await loadProducts();
  } catch (err) {
    console.error(err);
    if (err.message === "LIMIT_REACHED") {
      showToast("Alcanzaste el máximo de productos de tu paquete.", "error");
    } else {
      showToast("Error al guardar producto", "error");
    }
  } finally {
    btn.disabled = false;
  }
});

async function toggleProductActive(id) {
  if (!requireOperational()) return;
  const p = productsState.find((x) => x.id === id);
  if (!p) return;
  const nextActive = p.active === false;
  try {
    await updateDoc(doc(db, "businesses", currentBusinessId, "products", id), { active: nextActive });
    p.active = nextActive;
    showToast(nextActive ? "Producto activado" : "Producto pausado");
    renderProducts();
  } catch (err) {
    console.error(err);
    showToast("No se pudo cambiar estado", "error");
  }
}

async function deleteProduct(id) {
  if (!requireOperational()) return;
  if (!confirm("¿Eliminar este producto?")) return;

  try {
    const bizRef = doc(db, "businesses", currentBusinessId);
    const prodRef = doc(db, "businesses", currentBusinessId, "products", id);
    await runTransaction(db, async (tx) => {
      const bizSnap = await tx.get(bizRef);
      const used = bizSnap.data().usage?.productsCount || 0;
      tx.delete(prodRef);
      tx.update(bizRef, { "usage.productsCount": Math.max(0, used - 1) });
    });
    showToast("Producto eliminado");
    await loadProducts();
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar producto", "error");
  }
}

function startOrdersListener() {
  const q = query(collection(db, "businesses", currentBusinessId, "orders"), orderBy("createdAt", "desc"));
  unsubOrders = onSnapshot(q, (snap) => {
    const newOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!firstOrdersLoad) {
      const incoming = newOrders.find((o) => !knownOrderIds.has(o.id) && o.status === "pendiente");
      if (incoming) {
        playAlertBeep();
        showToast(`🔔 ¡Nuevo pedido de ${incoming.customerName}!`, "success");
        const waMsg = `¡Hola ${incoming.customerName}! Recibimos tu pedido en *${currentBiz.name}* por ${formatCurrency(incoming.total)}. En breve comenzamos a prepararlo.`;
        document.getElementById("newOrderAlertText").textContent =
          `🔔 ¡Nuevo pedido de ${incoming.customerName} (${formatCurrency(incoming.total)})!`;
        document.getElementById("newOrderAlertWaLink").href = buildWhatsAppUrl(incoming.customerPhone, waMsg);
        document.getElementById("newOrderAlertBanner").classList.remove("hidden");
      }
    }

    knownOrderIds = new Set(newOrders.map((o) => o.id));
    firstOrdersLoad = false;
    ordersState = newOrders;
    renderOrders();
  }, (err) => console.error(err));
}

document.getElementById("dismissOrderAlertBtn").addEventListener("click", () => {
  document.getElementById("newOrderAlertBanner").classList.add("hidden");
});

document.getElementById("orderStatusFilter").addEventListener("change", renderOrders);
document.getElementById("refreshOrdersBtn").addEventListener("click", () => {
  renderOrders();
  showToast("Pedidos actualizados");
});

document.getElementById("clearOrdersHistoryBtn").addEventListener("click", async () => {
  if (!requireOperational()) return;
  if (ordersState.length === 0) {
    showToast("No hay pedidos en el historial.");
    return;
  }
  if (!confirm("¿Seguro que deseas eliminar todo el historial de pedidos? Esta acción no se puede deshacer.")) {
    return;
  }

  try {
    const chunks = [];
    for (let i = 0; i < ordersState.length; i += 400) {
      chunks.push(ordersState.slice(i, i + 400));
    }
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach((o) => {
        batch.delete(doc(db, "businesses", currentBusinessId, "orders", o.id));
      });
      await batch.commit();
    }
    document.getElementById("newOrderAlertBanner").classList.add("hidden");
    showToast("Historial de pedidos eliminado", "success");
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar el historial", "error");
  }
});

function renderOrders() {
  const filter = document.getElementById("orderStatusFilter").value;
  const container = document.getElementById("ordersList");
  const list = ordersState.filter((o) => filter === "all" || o.status === filter);

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state text-sm">No hay pedidos en esta categoría.</div>`;
    return;
  }

  container.innerHTML = list
    .map((o) => {
      const status = o.status || "pendiente";
      const itemsText = (o.items || [])
        .map((it) => `${it.qty}x ${escapeHtml(it.name)} (${formatCurrency(it.price * it.qty)})`)
        .join(", ");

      const waMsg =
        status === "listo"
          ? `¡Hola ${o.customerName}! Tu pedido en *${currentBiz.name}* ya está *LISTO*. Total: ${formatCurrency(o.total)}. ¡Te esperamos!`
          : status === "pendiente"
          ? `¡Hola ${o.customerName}! Recibimos tu pedido en *${currentBiz.name}* (${formatCurrency(o.total)}). ¡Muchas gracias!`
          : `Hola ${o.customerName}, te escribimos de *${currentBiz.name}* por tu pedido (${formatCurrency(o.total)}). Estado actual: *${status.toUpperCase()}*.`;
      const waUrl = buildWhatsAppUrl(o.customerPhone, waMsg);

      return `
        <div class="card card-compact">
          <div class="flex-between flex-wrap gap-2">
            <div style="flex:1;min-width:220px;">
              <div class="flex gap-1 flex-wrap">
                <strong style="color:var(--dark);">${escapeHtml(o.customerName)}</strong>
                <span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>
              </div>
              <div class="text-sm mt-1">${itemsText}</div>
              ${o.notes ? `<div class="text-xs text-muted mt-1">Nota: ${escapeHtml(o.notes)}</div>` : ""}
              <div class="text-xs text-muted mt-1">
                Total: <strong style="color:var(--dark);">${formatCurrency(o.total)}</strong> ·
                WhatsApp: ${escapeHtml(o.customerPhone)} ·
                ${formatDateTime(o.createdAt)}
              </div>
            </div>
            <div class="flex flex-wrap gap-1">
              <select class="select order-status-select" data-id="${o.id}" style="width:auto;min-height:36px;padding:4px 10px;font-size:0.82rem;">
                <option value="pendiente" ${status === "pendiente" ? "selected" : ""}>Pendiente</option>
                <option value="preparando" ${status === "preparando" ? "selected" : ""}>Preparando</option>
                <option value="listo" ${status === "listo" ? "selected" : ""}>Listo</option>
                <option value="entregado" ${status === "entregado" ? "selected" : ""}>Entregado</option>
              </select>
              <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm">
                <i data-lucide="message-circle" style="width:14px;height:14px;"></i>
                ${status === "listo" ? "Avisar Listo" : "WhatsApp"}
              </a>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".order-status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      if (!requireOperational()) {
        renderOrders();
        return;
      }
      const id = sel.dataset.id;
      const newStatus = e.target.value;
      try {
        await updateDoc(doc(db, "businesses", currentBusinessId, "orders", id), { status: newStatus });
        showToast("Estado del pedido actualizado", "success");
      } catch (err) {
        console.error(err);
        showToast("No se pudo actualizar el pedido", "error");
      }
    });
  });
  lucide.createIcons();
}

// ==========================================
// MÓDULO CÓDIGOS QR EN PNG
// ==========================================
function renderQrSection() {
  const baseUrl = getBaseUrl();
  const turnosUrl = `${baseUrl}/turnos.html?id=${encodeURIComponent(currentBusinessId)}`;
  const menuUrl = `${baseUrl}/menu.html?id=${encodeURIComponent(currentBusinessId)}`;

  const turnosCard = document.getElementById("qrTurnosCard");
  const menuCard = document.getElementById("qrMenuCard");

  turnosCard.classList.toggle("hidden", !currentBiz.limits?.includesTurnos);
  menuCard.classList.toggle("hidden", !currentBiz.limits?.includesMenu);

  if (currentBiz.limits?.includesTurnos) {
    document.getElementById("qrTurnosUrlText").textContent = turnosUrl;
    drawQr("qrTurnosCanvas", turnosUrl);
    document.getElementById("copyTurnosLinkBtn").onclick = () => copyToClipboard(turnosUrl);
    document.getElementById("downloadTurnosQrBtn").onclick = () =>
      downloadQrPng("qrTurnosCanvas", `QR-Turnos-${currentBiz.name}.png`);
  }

  if (currentBiz.limits?.includesMenu) {
    document.getElementById("qrMenuUrlText").textContent = menuUrl;
    drawQr("qrMenuCanvas", menuUrl);
    document.getElementById("copyMenuLinkBtn").onclick = () => copyToClipboard(menuUrl);
    document.getElementById("downloadMenuQrBtn").onclick = () =>
      downloadQrPng("qrMenuCanvas", `QR-Menu-${currentBiz.name}.png`);
  }
}

function drawQr(elementId, url) {
  const container = document.getElementById(elementId);
  container.innerHTML = "";
  new QRCode(container, {
    text: url,
    width: 512,
    height: 512,
    colorDark: "#0f172a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

function downloadQrPng(elementId, filename) {
  const container = document.getElementById(elementId);
  const sourceCanvas = container.querySelector("canvas");
  if (!sourceCanvas) {
    showToast("No se pudo generar el PNG", "error");
    return;
  }

  const padding = 32;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = sourceCanvas.width + padding * 2;
  exportCanvas.height = sourceCanvas.height + padding * 2;
  const ctx = exportCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(sourceCanvas, padding, padding);

  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/\s+/g, "-");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("QR descargado en PNG", "success");
  }, "image/png");
}

// ==========================================
// PERSONALIZACIÓN Y WHATSAPP
// ==========================================
function fillSettingsForm() {
  document.getElementById("settingWhatsapp").value = currentBiz.whatsapp || "";
  document.getElementById("settingPrimaryColor").value = currentBiz.theme?.primaryColor || "#7c3aed";
  document.getElementById("settingAccentColor").value = currentBiz.theme?.accentColor || "#07192b";
  document.getElementById("settingAllowOrders").checked = currentBiz.allowOrders !== false;
}

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireOperational()) return;

  try {
    await updateDoc(doc(db, "businesses", currentBusinessId), {
      whatsapp: document.getElementById("settingWhatsapp").value.trim(),
      allowOrders: document.getElementById("settingAllowOrders").checked,
      theme: {
        primaryColor: document.getElementById("settingPrimaryColor").value,
        accentColor: document.getElementById("settingAccentColor").value
      }
    });
    showToast("Personalización guardada", "success");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar cambios", "error");
  }
});
