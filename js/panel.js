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
  toJsDate,
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
let categoriesState = [];
let productsState = [];
let ordersState = [];
let pendingProductImage = "";

let unsubBiz = null;
let unsubOrders = null;
let firstOrdersLoad = true;
let knownOrderIds = new Set();

const loginView = document.getElementById("panelLoginView");
const dashboardView = document.getElementById("panelDashboardView");
const logoutBtn = document.getElementById("panelLogoutBtn");
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
    // Silencioso si el navegador bloquea audio
  }
}

function stopLiveListeners() {
  if (unsubBiz) { unsubBiz(); unsubBiz = null; }
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
}

function getLocalDayKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDayLabel(dayKey, todayKey, yesterdayKey) {
  if (dayKey === todayKey) return "Hoy";
  if (dayKey === yesterdayKey) return "Ayer";
  const [y, m, d] = dayKey.split("-");
  return `${d}/${m}/${y}`;
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

  if (
    isBusinessOperational() &&
    (currentBiz.theme?.primaryColor !== "#7c3aed" || currentBiz.theme?.accentColor !== "#07192b")
  ) {
    try {
      await updateDoc(doc(db, "businesses", currentBusinessId), {
        theme: { primaryColor: "#7c3aed", accentColor: "#07192b" }
      });
      currentBiz.theme = { primaryColor: "#7c3aed", accentColor: "#07192b" };
    } catch (e) {
      console.warn("No se pudo restablecer el color:", e);
    }
  }

  renderHeaderAndLimits();
  renderQrSection();

  unsubBiz = onSnapshot(doc(db, "businesses", currentBusinessId), (snap) => {
    if (!snap.exists()) return;
    currentBiz = { id: snap.id, ...snap.data() };
    renderHeaderAndLimits();
  });

  if (currentBiz.limits?.includesMenu) {
    await Promise.all([loadCategories(), loadProducts()]);
    startOrdersListener();
  }
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

  const usedProd = currentBiz.usage?.productsCount || 0;
  const maxProd = currentBiz.limits?.maxProducts || 0;
  const prodPct = maxProd > 0 ? Math.min(100, Math.round((usedProd / maxProd) * 100)) : 100;
  document.getElementById("productsQuotaText").textContent = `${usedProd} / ${maxProd}`;
  document.getElementById("productsQuotaBar").style.width = `${prodPct}%`;

  const hasMenu = Boolean(currentBiz.limits?.includesMenu);
  document.getElementById("menuDisabledMsg").classList.toggle("hidden", hasMenu);
  document.getElementById("menuModuleContent").classList.toggle("hidden", !hasMenu);

  const newProdBtn = document.getElementById("newProductBtn");
  newProdBtn.disabled = !operational || usedProd >= maxProd;
  document.getElementById("productLimitHint").textContent =
    usedProd >= maxProd
      ? `Alcanzaste el límite de ${maxProd} productos de tu paquete.`
      : `Disponibles: ${Math.max(0, maxProd - usedProd)} productos más en tu paquete.`;
}

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

function hasValidPhone(phone) {
  return Boolean(phone && phone !== "Sin WhatsApp" && phone.replace(/[^\d]/g, "").length >= 6);
}

function startOrdersListener() {
  const q = query(collection(db, "businesses", currentBusinessId, "orders"), orderBy("createdAt", "desc"));
  unsubOrders = onSnapshot(q, (snap) => {
    const newOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!firstOrdersLoad) {
      const incoming = newOrders.find((o) => !knownOrderIds.has(o.id) && o.status === "pendiente");
      if (incoming) {
        playAlertBeep();
        const waBtn = document.getElementById("newOrderAlertWaLink");

        if (incoming.orderType === "bill") {
          showToast(`🧾 ¡${incoming.customerName} pidió la cuenta!`, "success");
          document.getElementById("newOrderAlertText").textContent =
            `🧾 ¡${incoming.customerName} pidió la cuenta! (${incoming.paymentMethod || "A confirmar"})`;
          document.getElementById("newOrderAlertSub").textContent =
            incoming.notes ? `Nota: ${incoming.notes}` : "Acércate con la cuenta a la mesa.";
          if (hasValidPhone(incoming.customerPhone)) {
            waBtn.href = buildWhatsAppUrl(
              incoming.customerPhone,
              `¡Hola ${incoming.customerName}! Ya recibimos tu pedido de cuenta en *${currentBiz.name}* (${incoming.paymentMethod || ""}). ¡Enseguida vamos!`
            );
            waBtn.classList.remove("hidden");
          } else {
            waBtn.classList.add("hidden");
          }
        } else {
          showToast(`🔔 ¡Nuevo pedido de ${incoming.customerName}!`, "success");
          document.getElementById("newOrderAlertText").textContent =
            `🔔 ¡Nuevo pedido de ${incoming.customerName} (${formatCurrency(incoming.total)})!`;
          document.getElementById("newOrderAlertSub").textContent =
            "Puedes confirmar el pedido al cliente por WhatsApp ahora.";
          if (hasValidPhone(incoming.customerPhone)) {
            waBtn.href = buildWhatsAppUrl(
              incoming.customerPhone,
              `¡Hola ${incoming.customerName}! Recibimos tu pedido en *${currentBiz.name}* por ${formatCurrency(incoming.total)}. En breve comenzamos a prepararlo.`
            );
            waBtn.classList.remove("hidden");
          } else {
            waBtn.classList.add("hidden");
          }
        }

        document.getElementById("newOrderAlertBanner").classList.remove("hidden");
      }
    }

    knownOrderIds = new Set(newOrders.map((o) => o.id));
    firstOrdersLoad = false;
    ordersState = newOrders;
    renderSalesHistorySummary();
    renderOrders();
  }, (err) => console.error(err));
}

function renderSalesHistorySummary() {
  const now = new Date();
  const todayKey = getLocalDayKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = getLocalDayKey(yesterday);
  const weekCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();

  let todayAmount = 0;
  let todayCount = 0;
  let weekAmount = 0;
  let weekCount = 0;
  const dailyMap = new Map();

  ordersState
    .filter((o) => o.orderType !== "bill")
    .forEach((o) => {
      const d = toJsDate(o.createdAt) || new Date();
      const key = getLocalDayKey(d);
      const total = Number(o.total || 0);

      if (key === todayKey) {
        todayAmount += total;
        todayCount++;
      }
      if (d.getTime() >= weekCutoff) {
        weekAmount += total;
        weekCount++;
        if (!dailyMap.has(key)) {
          dailyMap.set(key, { count: 0, amount: 0 });
        }
        const entry = dailyMap.get(key);
        entry.count++;
        entry.amount += total;
      }
    });

  document.getElementById("salesTodayAmount").textContent = formatCurrency(todayAmount);
  document.getElementById("salesTodayCount").textContent = `${todayCount} pedidos hoy`;
  document.getElementById("salesWeekAmount").textContent = formatCurrency(weekAmount);
  document.getElementById("salesWeekCount").textContent = `${weekCount} pedidos (7 días)`;

  const listEl = document.getElementById("salesDailyHistoryList");
  const sortedDays = Array.from(dailyMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  if (sortedDays.length === 0) {
    listEl.innerHTML = `<div class="text-xs text-muted">Aún no hay ventas registradas esta semana.</div>`;
    return;
  }

  listEl.innerHTML = sortedDays
    .map(([key, info]) => `
      <div class="flex-between text-sm" style="padding:8px 12px;background:rgba(255,255,255,0.65);border-radius:10px;border:1px solid rgba(13,40,64,0.08);">
        <strong style="color:var(--dark);">${escapeHtml(getDayLabel(key, todayKey, yesterdayKey))}</strong>
        <span class="text-xs text-muted">
          ${info.count} pedidos · <strong style="color:var(--success);font-size:0.86rem;">${formatCurrency(info.amount)}</strong>
        </span>
      </div>
    `)
    .join("");
}

document.getElementById("dismissOrderAlertBtn").addEventListener("click", () => {
  document.getElementById("newOrderAlertBanner").classList.add("hidden");
});

document.getElementById("orderStatusFilter").addEventListener("change", renderOrders);
document.getElementById("refreshOrdersBtn").addEventListener("click", () => {
  renderSalesHistorySummary();
  renderOrders();
  showToast("Pedidos actualizados");
});

document.getElementById("clearOrdersHistoryBtn").addEventListener("click", async () => {
  if (!requireOperational()) return;
  if (ordersState.length === 0) {
    showToast("No hay pedidos en el historial.");
    return;
  }
  if (!confirm("¿Seguro que deseas eliminar todo el historial de pedidos y cuentas? Esta acción no se puede deshacer.")) {
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
    showToast("Historial eliminado", "success");
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
    container.innerHTML = `<div class="empty-state text-sm">No hay pedidos ni solicitudes de cuenta en esta categoría.</div>`;
    return;
  }

  container.innerHTML = list
    .map((o) => {
      const status = o.status || "pendiente";
      const isBill = o.orderType === "bill";
      const canWa = hasValidPhone(o.customerPhone);
      const itemsText = isBill
        ? `Forma de pago: <strong>${escapeHtml(o.paymentMethod || "A confirmar")}</strong>`
        : (o.items || [])
            .map((it) => `${it.qty}x ${escapeHtml(it.name)} (${formatCurrency(it.price * it.qty)})`)
            .join(", ");

      const waMsg = isBill
        ? `¡Hola ${o.customerName}! Ya recibimos tu pedido de cuenta en *${currentBiz.name}*. ¡Enseguida nos acercamos!`
        : status === "listo"
        ? `¡Hola ${o.customerName}! Tu pedido en *${currentBiz.name}* ya está *LISTO*. Total: ${formatCurrency(o.total)}. ¡Te esperamos!`
        : status === "pendiente"
        ? `¡Hola ${o.customerName}! Recibimos tu pedido en *${currentBiz.name}* (${formatCurrency(o.total)}). ¡Muchas gracias!`
        : `Hola ${o.customerName}, te escribimos de *${currentBiz.name}* por tu pedido (${formatCurrency(o.total)}). Estado actual: *${status.toUpperCase()}*.`;
      const waUrl = buildWhatsAppUrl(o.customerPhone, waMsg);

      return `
        <div class="card card-compact" ${isBill && status === "pendiente" ? 'style="border-color:#f59e0b;background:rgba(255,251,235,0.92);"' : ""}>
          <div class="flex-between flex-wrap gap-2">
            <div style="flex:1;min-width:220px;">
              <div class="flex gap-1 flex-wrap">
                ${isBill ? `<span class="badge badge-pendiente">🧾 PIDE LA CUENTA</span>` : ""}
                <strong style="color:var(--dark);">${escapeHtml(o.customerName)}</strong>
                <span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>
              </div>
              <div class="text-sm mt-1">${itemsText}</div>
              ${o.notes ? `<div class="text-xs text-muted mt-1">Nota: ${escapeHtml(o.notes)}</div>` : ""}
              <div class="text-xs text-muted mt-1">
                ${isBill ? "" : `Total: <strong style="color:var(--dark);">${formatCurrency(o.total)}</strong> · `}
                ${canWa ? `WhatsApp: ${escapeHtml(o.customerPhone)} · ` : ""}
                ${formatDateTime(o.createdAt)}
              </div>
            </div>
            <div class="flex flex-wrap gap-1">
              <select class="select order-status-select" data-id="${o.id}" style="width:auto;min-height:36px;padding:4px 10px;font-size:0.82rem;">
                <option value="pendiente" ${status === "pendiente" ? "selected" : ""}>Pendiente</option>
                <option value="preparando" ${status === "preparando" ? "selected" : ""}>${isBill ? "En camino" : "Preparando"}</option>
                <option value="listo" ${status === "listo" ? "selected" : ""}>Listo</option>
                <option value="entregado" ${status === "entregado" ? "selected" : ""}>${isBill ? "Cobrado" : "Entregado"}</option>
              </select>
              ${
                canWa
                  ? `<a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm">
                      <i data-lucide="message-circle" style="width:14px;height:14px;"></i>
                      ${status === "listo" ? "Avisar Listo" : "WhatsApp"}
                    </a>`
                  : ""
              }
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
        showToast("Estado actualizado", "success");
      } catch (err) {
        console.error(err);
        showToast("No se pudo actualizar", "error");
      }
    });
  });
  lucide.createIcons();
}

function renderQrSection() {
  const baseUrl = getBaseUrl();
  const menuUrl = `${baseUrl}/menu.html?id=${encodeURIComponent(currentBusinessId)}`;
  const menuCard = document.getElementById("qrMenuCard");

  menuCard.classList.toggle("hidden", !currentBiz.limits?.includesMenu);

  if (currentBiz.limits?.includesMenu) {
    document.getElementById("qrMenuBizName").textContent = currentBiz.name || "Mi Negocio";
    document.getElementById("qrMenuUrlText").textContent = menuUrl;
    drawQr("qrMenuCanvas", menuUrl);
    document.getElementById("copyMenuLinkBtn").onclick = () => copyToClipboard(menuUrl);
    document.getElementById("shareMenuWaBtn").href =
      `https://wa.me/?text=${encodeURIComponent(`¡Hola! Mira nuestro menú digital y haz tu pedido en *${currentBiz.name}* aquí:\n${menuUrl}`)}`;
    document.getElementById("downloadMenuQrBtn").onclick = () =>
      downloadQrPosterPng("qrMenuCanvas", `Cartel-Menu-${currentBiz.name}.png`, {
        badge: "MENÚ Y PEDIDOS QR",
        cta: "Escanea para ver nuestro menú",
        sub: "Haz tu pedido o pide la cuenta al instante"
      });
  }
}

function drawQr(elementId, url) {
  const container = document.getElementById(elementId);
  container.innerHTML = "";
  new QRCode(container, {
    text: url,
    width: 512,
    height: 512,
    colorDark: "#07192b",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || "").split(" ");
  let line = "";
  let lines = [];
  for (let i = 0; i < words.length; i++) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
      if (lines.length >= maxLines) break;
    } else {
      line = testLine;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((l, idx) => ctx.fillText(l, x, y + idx * lineHeight));
  return lines.length;
}

function downloadQrPosterPng(elementId, filename, posterInfo) {
  const container = document.getElementById(elementId);
  const sourceEl = container.querySelector("canvas") || container.querySelector("img");
  if (!sourceEl) {
    showToast("No se pudo generar el cartel PNG", "error");
    return;
  }

  const W = 840;
  const H = 1120;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#051422");
  bgGrad.addColorStop(0.55, "#0a253d");
  bgGrad.addColorStop(1, "#071b2e");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
  accentGrad.addColorStop(0, "#7c3aed");
  accentGrad.addColorStop(1, "#06b6d4");
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, W, 16);

  const pillW = 340;
  const pillH = 44;
  drawRoundedRect(ctx, (W - pillW) / 2, 54, pillW, pillH, 22);
  ctx.fillStyle = accentGrad;
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(posterInfo.badge, W / 2, 76);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px sans-serif";
  ctx.textBaseline = "alphabetic";
  const usedLines = drawWrappedText(ctx, currentBiz.name || "Mi Negocio", W / 2, 160, W - 100, 54, 2);

  if (currentBiz.category) {
    ctx.fillStyle = "#5eead4";
    ctx.font = "600 24px sans-serif";
    ctx.fillText(currentBiz.category, W / 2, usedLines > 1 ? 248 : 206);
  }

  const boxSize = 580;
  const boxX = (W - boxSize) / 2;
  const boxY = 278;
  drawRoundedRect(ctx, boxX, boxY, boxSize, boxSize, 32);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#2dd4bf";
  ctx.stroke();

  const qrSize = 500;
  ctx.drawImage(sourceEl, (W - qrSize) / 2, boxY + 40, qrSize, qrSize);

  ctx.fillStyle = "#2dd4bf";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(posterInfo.cta, W / 2, 932);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "22px sans-serif";
  ctx.fillText(posterInfo.sub, W / 2, 974);

  if (currentBiz.whatsapp) {
    ctx.fillStyle = "#86efac";
    ctx.font = "600 21px sans-serif";
    ctx.fillText(`WhatsApp: +${currentBiz.whatsapp.replace(/[^\d]/g, "")}`, W / 2, 1022);
  }

  ctx.fillStyle = "#94a3b8";
  ctx.font = "18px sans-serif";
  ctx.fillText("Impulsado por Toke QR", W / 2, 1078);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/\s+/g, "-");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Cartel QR descargado en PNG", "success");
  }, "image/png");
    }
