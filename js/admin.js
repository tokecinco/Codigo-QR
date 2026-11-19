import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  Timestamp
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
  generateAccessCode,
  copyToClipboard,
  getBaseUrl
} from "./utils.js";

const DEFAULT_PACKAGES = {
  basic: {
    id: "basic",
    name: "Paquete Básico",
    weeklyPrice: 5000,
    maxAppointments: 0,
    maxProducts: 15,
    durationDays: 7,
    includesTurnos: false,
    includesMenu: true
  },
  premium: {
    id: "premium",
    name: "Paquete Premium",
    weeklyPrice: 9500,
    maxAppointments: 0,
    maxProducts: 80,
    durationDays: 7,
    includesTurnos: false,
    includesMenu: true
  }
};

let packagesState = { ...DEFAULT_PACKAGES };
let businessesState = [];
let ordersState = [];

const loginView = document.getElementById("adminLoginView");
const dashboardView = document.getElementById("adminDashboardView");
const logoutBtn = document.getElementById("logoutBtn");
const adminEmailLabel = document.getElementById("adminEmailLabel");

const businessModal = document.getElementById("businessModal");
const renewModal = document.getElementById("renewModal");

onAuthStateChanged(auth, async (user) => {
  if (user && !user.isAnonymous) {
    try {
      await loadAllAdminData();
      loginView.classList.add("hidden");
      dashboardView.classList.remove("hidden");
      logoutBtn.classList.remove("hidden");
      adminEmailLabel.textContent = user.email;
      adminEmailLabel.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      showToast("No tienes permisos de Administrador General.", "error");
      await signOut(auth);
    }
  } else {
    loginView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    adminEmailLabel.classList.add("hidden");
  }
  lucide.createIcons();
});

document.getElementById("adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("loginSubmitBtn");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  btn.disabled = true;
  btn.textContent = "Verificando...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Bienvenido al Panel Administrador", "success");
  } catch (err) {
    console.error(err);
    showToast("Correo o contraseña incorrectos.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ingresar al Panel";
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  showToast("Sesión cerrada");
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

async function loadAllAdminData() {
  await loadPackages();
  await loadBusinesses();
  await loadGlobalActivity();
  renderStats();
  renderPackages();
  renderBusinesses();
  renderExpirations();
  renderGlobalActivity();
  lucide.createIcons();
}

async function loadPackages() {
  for (const key of ["basic", "premium"]) {
    const ref = doc(db, "packages", key);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      packagesState[key] = { id: key, ...snap.data() };
    } else {
      await setDoc(ref, DEFAULT_PACKAGES[key]);
      packagesState[key] = { ...DEFAULT_PACKAGES[key] };
    }
  }
}

async function loadBusinesses() {
  const snap = await getDocs(collection(db, "businesses"));
  const list = await Promise.all(
    snap.docs.map(async (bizDoc) => {
      const data = bizDoc.data();
      let priv = {};
      try {
        const privSnap = await getDoc(doc(db, "businesses", bizDoc.id, "private", "config"));
        if (privSnap.exists()) priv = privSnap.data();
      } catch (e) {
        console.warn("Sin acceso privado para", bizDoc.id, e);
      }
      return {
        id: bizDoc.id,
        ...data,
        private: priv
      };
    })
  );
  list.sort((a, b) => {
    const da = toJsDate(a.createdAt)?.getTime() || 0;
    const dbTime = toJsDate(b.createdAt)?.getTime() || 0;
    return dbTime - da;
  });
  businessesState = list;
}

async function loadGlobalActivity() {
  const ordSnap = await getDocs(collectionGroup(db, "orders"));
  ordersState = ordSnap.docs.map((d) => ({
    id: d.id,
    businessId: d.ref.parent.parent ? d.ref.parent.parent.id : "",
    ...d.data()
  }));
}

function renderStats() {
  const total = businessesState.length;
  const active = businessesState.filter((b) => b.active && !isExpired(b.expiresAt)).length;
  const expiringOrExpired = businessesState.filter(
    (b) => b.active && daysRemaining(b.expiresAt) <= 2
  ).length;
  const totalRevenue = businessesState.reduce(
    (sum, b) => sum + Number(b.private?.totalPaid || b.private?.lastPaymentAmount || 0),
    0
  );
  const realOrdersCount = ordersState.filter((o) => o.orderType !== "bill").length;

  document.getElementById("statActiveBusinesses").textContent = active;
  document.getElementById("statTotalBusinesses").textContent = `de ${total} registrados`;
  document.getElementById("statExpiring").textContent = expiringOrExpired;
  document.getElementById("statTotalOrders").textContent = realOrdersCount;
  document.getElementById("statTotalRevenue").textContent = formatCurrency(totalRevenue);
}

function renderPackages() {
  const container = document.getElementById("packagesContainer");
  container.innerHTML = ["basic", "premium"]
    .map((key) => {
      const pkg = packagesState[key];
      return `
        <form class="card package-form" data-pkg-id="${key}">
          <div class="flex-between mb-2">
            <h2 style="font-size:1.15rem;color:var(--dark);">${escapeHtml(pkg.name)}</h2>
            <span class="badge badge-active">${key === "basic" ? "Inicial" : "Completo"}</span>
          </div>
          <div class="form-group">
            <label class="form-label">Nombre visible</label>
            <input type="text" name="name" class="input" value="${escapeHtml(pkg.name)}" required />
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label">Precio semanal ($)</label>
              <input type="number" name="weeklyPrice" class="input" min="0" step="any" value="${pkg.weeklyPrice}" required />
            </div>
            <div class="form-group">
              <label class="form-label">Duración (días)</label>
              <input type="number" name="durationDays" class="input" min="1" value="${pkg.durationDays || 7}" required />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Máx. productos en el menú</label>
            <input type="number" name="maxProducts" class="input" min="0" value="${pkg.maxProducts}" required />
          </div>
          <button type="submit" class="btn btn-primary btn-block mt-2">
            Guardar ${escapeHtml(pkg.name)}
          </button>
        </form>
      `;
    })
    .join("");

  container.querySelectorAll(".package-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.pkgId;
      const updated = {
        id,
        name: form.name.value.trim(),
        weeklyPrice: Number(form.weeklyPrice.value),
        durationDays: Number(form.durationDays.value),
        maxAppointments: 0,
        maxProducts: Number(form.maxProducts.value),
        includesTurnos: false,
        includesMenu: true
      };
      try {
        await setDoc(doc(db, "packages", id), updated);
        packagesState[id] = updated;
        showToast(`${updated.name} actualizado correctamente`, "success");
      } catch (err) {
        console.error(err);
        showToast("Error al guardar paquete", "error");
      }
    });
  });
}

document.getElementById("bizSearchInput").addEventListener("input", renderBusinesses);
document.getElementById("bizFilterSelect").addEventListener("change", renderBusinesses);

function getBusinessStatusBadge(biz) {
  if (!biz.active) return `<span class="badge badge-inactive">Suspendido</span>`;
  const days = daysRemaining(biz.expiresAt);
  if (days < 0 || isExpired(biz.expiresAt)) return `<span class="badge badge-cancelado">Vencido</span>`;
  if (days <= 2) return `<span class="badge badge-pendiente">Vence en ${days}d</span>`;
  return `<span class="badge badge-active">Activo (${days}d)</span>`;
}

function renderBusinesses() {
  const search = document.getElementById("bizSearchInput").value.trim().toLowerCase();
  const filter = document.getElementById("bizFilterSelect").value;
  const container = document.getElementById("businessesList");

  const filtered = businessesState.filter((b) => {
    const matchText =
      !search ||
      (b.name || "").toLowerCase().includes(search) ||
      (b.category || "").toLowerCase().includes(search);
    if (!matchText) return false;

    const expired = isExpired(b.expiresAt);
    const days = daysRemaining(b.expiresAt);
    if (filter === "active") return b.active && !expired;
    if (filter === "expiring") return b.active && !expired && days <= 2;
    if (filter === "expired") return b.active && expired;
    if (filter === "suspended") return !b.active;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card empty-state" style="grid-column:1/-1;">No hay negocios que coincidan con el filtro.</div>`;
    return;
  }

  const baseUrl = getBaseUrl();
  container.innerHTML = filtered
    .map((b) => {
      const code = b.private?.accessCode || "—";
      const usedProd = b.usage?.productsCount || 0;
      const maxProd = b.limits?.maxProducts || 0;
      return `
        <div class="card">
          <div class="flex-between mb-1">
            <div>
              <h3 style="font-size:1.08rem;color:var(--dark);">${escapeHtml(b.name)}</h3>
              <div class="text-xs text-muted">${escapeHtml(b.category || "Sin rubro")} · ${escapeHtml(b.packageName || b.packageId)}</div>
            </div>
            ${getBusinessStatusBadge(b)}
          </div>

          <div class="divider"></div>

          <div class="grid-2 text-sm" style="gap:8px;">
            <div>
              <span class="text-xs text-muted">Código de acceso:</span><br/>
              <strong style="letter-spacing:0.04em;color:var(--primary);">${escapeHtml(code)}</strong>
            </div>
            <div>
              <span class="text-xs text-muted">Vencimiento:</span><br/>
              <strong>${formatDate(b.expiresAt)}</strong>
            </div>
            <div>
              <span class="text-xs text-muted">Productos:</span><br/>
              <strong>${usedProd} / ${maxProd}</strong>
            </div>
            <div>
              <span class="text-xs text-muted">Precio semanal:</span><br/>
              <strong>${formatCurrency(b.weeklyPrice)}</strong>
            </div>
          </div>

          <div class="text-xs text-muted mt-2">
            Último pago: <strong>${formatCurrency(b.private?.lastPaymentAmount || 0)}</strong>
          </div>

          <div class="flex flex-wrap gap-1 mt-3">
            <button class="btn btn-secondary btn-sm copy-code-btn" data-code="${escapeHtml(code)}">
              <i data-lucide="copy" style="width:14px;height:14px;"></i> Código
            </button>
            <a href="${baseUrl}/panel.html?code=${encodeURIComponent(code)}" target="_blank" class="btn btn-outline btn-sm">
              <i data-lucide="external-link" style="width:14px;height:14px;"></i> Panel
            </a>
            <button class="btn btn-success btn-sm renew-biz-btn" data-id="${b.id}">
              <i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Renovar
            </button>
            <button class="btn btn-outline btn-sm edit-biz-btn" data-id="${b.id}">
              <i data-lucide="pencil" style="width:14px;height:14px;"></i> Editar
            </button>
            <button class="btn btn-outline btn-sm toggle-biz-btn" data-id="${b.id}">
              ${b.active ? "Suspender" : "Activar"}
            </button>
            <button class="btn btn-danger btn-sm delete-biz-btn" data-id="${b.id}">
              <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".copy-code-btn").forEach((btn) =>
    btn.addEventListener("click", () => copyToClipboard(btn.dataset.code))
  );
  container.querySelectorAll(".edit-biz-btn").forEach((btn) =>
    btn.addEventListener("click", () => openBusinessModal(btn.dataset.id))
  );
  container.querySelectorAll(".renew-biz-btn").forEach((btn) =>
    btn.addEventListener("click", () => openRenewModal(btn.dataset.id))
  );
  container.querySelectorAll(".toggle-biz-btn").forEach((btn) =>
    btn.addEventListener("click", () => toggleBusinessStatus(btn.dataset.id))
  );
  container.querySelectorAll(".delete-biz-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteBusiness(btn.dataset.id))
  );
  lucide.createIcons();
}

document.getElementById("newBusinessBtn").addEventListener("click", () => openBusinessModal(null));
document.getElementById("closeBusinessModal").addEventListener("click", () => businessModal.classList.add("hidden"));
document.getElementById("cancelBusinessModal").addEventListener("click", () => businessModal.classList.add("hidden"));
document.getElementById("regenCodeBtn").addEventListener("click", () => {
  document.getElementById("bizCode").value = generateAccessCode();
});

document.getElementById("bizPackage").addEventListener("change", (e) => {
  const pkg = packagesState[e.target.value];
  if (pkg) {
    document.getElementById("bizWeeklyPrice").value = pkg.weeklyPrice;
    document.getElementById("bizMaxProducts").value = pkg.maxProducts;
    document.getElementById("bizDurationDays").value = pkg.durationDays || 7;
  }
});

function openBusinessModal(bizId) {
  const form = document.getElementById("businessForm");
  form.reset();

  if (!bizId) {
    document.getElementById("businessModalTitle").textContent = "Nuevo Negocio";
    document.getElementById("bizId").value = "";
    document.getElementById("bizOldCode").value = "";
    document.getElementById("bizCode").value = generateAccessCode();
    document.getElementById("bizPackage").value = "basic";
    const pkg = packagesState.basic;
    document.getElementById("bizWeeklyPrice").value = pkg.weeklyPrice;
    document.getElementById("bizMaxProducts").value = pkg.maxProducts;
    document.getElementById("bizDurationDays").value = pkg.durationDays || 7;
    document.getElementById("bizAllowOrders").checked = true;
    document.getElementById("bizActive").checked = true;
    document.getElementById("bizPaymentAmount").value = pkg.weeklyPrice;
  } else {
    const biz = businessesState.find((b) => b.id === bizId);
    if (!biz) return;
    document.getElementById("businessModalTitle").textContent = "Editar Negocio";
    document.getElementById("bizId").value = biz.id;
    document.getElementById("bizOldCode").value = biz.private?.accessCode || "";
    document.getElementById("bizName").value = biz.name || "";
    document.getElementById("bizCategory").value = biz.category || "";
    document.getElementById("bizWhatsapp").value = biz.whatsapp || "";
    document.getElementById("bizCode").value = biz.private?.accessCode || "";
    document.getElementById("bizPackage").value = biz.packageId || "basic";
    document.getElementById("bizWeeklyPrice").value = biz.weeklyPrice ?? 0;
    document.getElementById("bizMaxProducts").value = biz.limits?.maxProducts ?? 0;
    document.getElementById("bizDurationDays").value = biz.durationDays || 7;
    document.getElementById("bizAllowOrders").checked = biz.allowOrders !== false;
    document.getElementById("bizActive").checked = biz.active !== false;
    document.getElementById("bizPaymentAmount").value = biz.private?.lastPaymentAmount ?? 0;
    document.getElementById("bizNotes").value = biz.private?.notes || "";
  }
  businessModal.classList.remove("hidden");
  lucide.createIcons();
}

document.getElementById("businessForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("saveBusinessBtn");
  btn.disabled = true;

  try {
    const bizId = document.getElementById("bizId").value;
    const oldCode = document.getElementById("bizOldCode").value.trim().toUpperCase();
    const newCode = document.getElementById("bizCode").value.trim().toUpperCase();
    const packageId = document.getElementById("bizPackage").value;
    const pkg = packagesState[packageId] || DEFAULT_PACKAGES.basic;
    const durationDays = Number(document.getElementById("bizDurationDays").value || 7);
    const active = document.getElementById("bizActive").checked;
    const paymentAmount = Number(document.getElementById("bizPaymentAmount").value || 0);
    const notes = document.getElementById("bizNotes").value.trim();

    if (!newCode || newCode.length < 4) {
      showToast("El código debe tener al menos 4 caracteres.", "error");
      btn.disabled = false;
      return;
    }

    if (newCode !== oldCode) {
      const codeSnap = await getDoc(doc(db, "businessCodes", newCode));
      if (codeSnap.exists()) {
        showToast("Ese código de acceso ya pertenece a otro negocio.", "error");
        btn.disabled = false;
        return;
      }
    }

    const batch = writeBatch(db);
    const targetRef = bizId ? doc(db, "businesses", bizId) : doc(collection(db, "businesses"));
    const targetId = targetRef.id;

    const publicPayload = {
      name: document.getElementById("bizName").value.trim(),
      category: document.getElementById("bizCategory").value.trim(),
      whatsapp: document.getElementById("bizWhatsapp").value.trim(),
      packageId,
      packageName: pkg.name,
      weeklyPrice: Number(document.getElementById("bizWeeklyPrice").value || 0),
      durationDays,
      active,
      allowOrders: document.getElementById("bizAllowOrders").checked,
      limits: {
        maxAppointments: 0,
        maxProducts: Number(document.getElementById("bizMaxProducts").value || 0),
        includesTurnos: false,
        includesMenu: true
      }
    };

    if (!bizId) {
      const expiresDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
      publicPayload.createdAt = Timestamp.now();
      publicPayload.expiresAt = Timestamp.fromDate(expiresDate);
      publicPayload.usage = { appointmentsCount: 0, productsCount: 0 };
      publicPayload.theme = { primaryColor: "#7c3aed", accentColor: "#07192b" };
      batch.set(targetRef, publicPayload);
      batch.set(doc(db, "businesses", targetId, "private", "config"), {
        accessCode: newCode,
        lastPaymentAmount: paymentAmount,
        totalPaid: paymentAmount,
        lastPaymentDate: Timestamp.now(),
        notes
      });
    } else {
      const existing = businessesState.find((b) => b.id === bizId);
      batch.update(targetRef, publicPayload);
      const oldTotal = Number(existing?.private?.totalPaid || 0);
      const oldLast = Number(existing?.private?.lastPaymentAmount || 0);
      const extra = paymentAmount !== oldLast ? paymentAmount : 0;
      batch.set(
        doc(db, "businesses", targetId, "private", "config"),
        {
          accessCode: newCode,
          lastPaymentAmount: paymentAmount,
          totalPaid: oldTotal + extra,
          notes
        },
        { merge: true }
      );
    }

    if (oldCode && oldCode !== newCode) {
      batch.delete(doc(db, "businessCodes", oldCode));
    }
    batch.set(doc(db, "businessCodes", newCode), {
      businessId: targetId,
      active
    });

    await batch.commit();
    businessModal.classList.add("hidden");
    showToast(bizId ? "Negocio actualizado" : "Negocio creado con éxito", "success");
    await loadAllAdminData();
  } catch (err) {
    console.error(err);
    showToast("Error al guardar el negocio", "error");
  } finally {
    btn.disabled = false;
  }
});

async function toggleBusinessStatus(bizId) {
  const biz = businessesState.find((b) => b.id === bizId);
  if (!biz) return;
  const newActive = !biz.active;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "businesses", bizId), { active: newActive });
    if (biz.private?.accessCode) {
      batch.set(
        doc(db, "businessCodes", biz.private.accessCode),
        { businessId: bizId, active: newActive },
        { merge: true }
      );
    }
    await batch.commit();
    showToast(newActive ? "Negocio activado" : "Negocio suspendido", "success");
    await loadAllAdminData();
  } catch (err) {
    console.error(err);
    showToast("Error al cambiar estado", "error");
  }
}

async function deleteBusiness(bizId) {
  const biz = businessesState.find((b) => b.id === bizId);
  if (!biz) return;
  if (!confirm(`¿Seguro que deseas eliminar "${biz.name}"? Esta acción no se puede deshacer.`)) return;

  try {
    const batch = writeBatch(db);
    if (biz.private?.accessCode) {
      batch.delete(doc(db, "businessCodes", biz.private.accessCode));
    }
    batch.delete(doc(db, "businesses", bizId, "private", "config"));
    batch.delete(doc(db, "businesses", bizId));
    await batch.commit();
    showToast("Negocio eliminado", "success");
    await loadAllAdminData();
  } catch (err) {
    console.error(err);
    showToast("Error al eliminar negocio", "error");
  }
}

document.getElementById("closeRenewModal").addEventListener("click", () => renewModal.classList.add("hidden"));
document.getElementById("cancelRenewModal").addEventListener("click", () => renewModal.classList.add("hidden"));

function openRenewModal(bizId) {
  const biz = businessesState.find((b) => b.id === bizId);
  if (!biz) return;
  document.getElementById("renewBizId").value = biz.id;
  document.getElementById("renewBizName").textContent = biz.name;
  document.getElementById("renewDays").value = biz.durationDays || 7;
  document.getElementById("renewAmount").value = biz.weeklyPrice || 0;
  document.getElementById("renewNotes").value = "";
  renewModal.classList.remove("hidden");
}

document.getElementById("renewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bizId = document.getElementById("renewBizId").value;
  const biz = businessesState.find((b) => b.id === bizId);
  if (!biz) return;

  const days = Number(document.getElementById("renewDays").value || 7);
  const amount = Number(document.getElementById("renewAmount").value || 0);
  const notes = document.getElementById("renewNotes").value.trim();

  const currentExp = toJsDate(biz.expiresAt);
  const baseTime = currentExp && currentExp.getTime() > Date.now() ? currentExp.getTime() : Date.now();
  const newExpires = new Date(baseTime + days * 24 * 60 * 60 * 1000);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "businesses", bizId), {
      active: true,
      expiresAt: Timestamp.fromDate(newExpires)
    });

    const prevTotal = Number(biz.private?.totalPaid || 0);
    batch.set(
      doc(db, "businesses", bizId, "private", "config"),
      {
        lastPaymentAmount: amount,
        totalPaid: prevTotal + amount,
        lastPaymentDate: Timestamp.now(),
        notes: notes || biz.private?.notes || ""
      },
      { merge: true }
    );

    if (biz.private?.accessCode) {
      batch.set(
        doc(db, "businessCodes", biz.private.accessCode),
        { businessId: bizId, active: true },
        { merge: true }
      );
    }

    await batch.commit();
    renewModal.classList.add("hidden");
    showToast("Suscripción renovada correctamente", "success");
    await loadAllAdminData();
  } catch (err) {
    console.error(err);
    showToast("Error al renovar suscripción", "error");
  }
});

function renderExpirations() {
  const container = document.getElementById("expirationsList");
  if (businessesState.length === 0) {
    container.innerHTML = `<div class="card empty-state">Aún no hay negocios registrados.</div>`;
    return;
  }

  const sorted = [...businessesState].sort((a, b) => {
    const da = toJsDate(a.expiresAt)?.getTime() || 0;
    const dbTime = toJsDate(b.expiresAt)?.getTime() || 0;
    return da - dbTime;
  });

  container.innerHTML = sorted
    .map((b) => `
      <div class="card card-compact flex-between flex-wrap gap-2">
        <div>
          <div class="flex gap-2">
            <strong style="color:var(--dark);">${escapeHtml(b.name)}</strong>
            ${getBusinessStatusBadge(b)}
          </div>
          <div class="text-xs text-muted mt-1">
            Vence: <strong>${formatDate(b.expiresAt)}</strong> ·
            Último pago: <strong>${formatCurrency(b.private?.lastPaymentAmount || 0)}</strong> (${formatDate(b.private?.lastPaymentDate)}) ·
            Total acumulado: <strong>${formatCurrency(b.private?.totalPaid || 0)}</strong>
          </div>
          ${b.private?.notes ? `<div class="text-xs text-muted">Nota: ${escapeHtml(b.private.notes)}</div>` : ""}
        </div>
        <button class="btn btn-success btn-sm renew-exp-btn" data-id="${b.id}">
          <i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Renovar
        </button>
      </div>
    `)
    .join("");

  container.querySelectorAll(".renew-exp-btn").forEach((btn) =>
    btn.addEventListener("click", () => openRenewModal(btn.dataset.id))
  );
  lucide.createIcons();
}

document.getElementById("refreshActivityBtn").addEventListener("click", async () => {
  await loadGlobalActivity();
  renderStats();
  renderGlobalActivity();
  showToast("Pedidos actualizados");
});

function renderGlobalActivity() {
  const container = document.getElementById("globalActivityList");
  const bizMap = new Map(businessesState.map((b) => [b.id, b.name]));

  const items = [...ordersState].sort((a, b) => {
    const da = toJsDate(a.createdAt)?.getTime() || 0;
    const dbTime = toJsDate(b.createdAt)?.getTime() || 0;
    return dbTime - da;
  });

  if (items.length === 0) {
    container.innerHTML = `<div class="card empty-state">Aún no hay pedidos registrados.</div>`;
    return;
  }

  container.innerHTML = items
    .slice(0, 60)
    .map((item) => {
      const bizName = bizMap.get(item.businessId) || "Negocio";
      const isBill = item.orderType === "bill";
      return `
        <div class="card card-compact flex-between flex-wrap gap-2">
          <div>
            <div class="flex gap-1 flex-wrap">
              <span class="badge ${isBill ? "badge-pendiente" : "badge-active"}">${isBill ? "🧾 Pide Cuenta" : "Pedido"}</span>
              <strong style="color:var(--dark);">${escapeHtml(bizName)}</strong>
              <span class="badge badge-${escapeHtml(item.status || "pendiente")}">${escapeHtml(item.status || "pendiente")}</span>
            </div>
            <div class="text-sm mt-1">
              Cliente / Mesa: <strong>${escapeHtml(item.customerName)}</strong> (${escapeHtml(item.customerPhone)})
              ${isBill
                ? `· Pago: <strong>${escapeHtml(item.paymentMethod || "A confirmar")}</strong>`
                : `· Total: <strong>${formatCurrency(item.total || 0)}</strong> (${(item.items || []).length} productos)`}
            </div>
            <div class="text-xs text-muted">${formatDateTime(item.createdAt)}</div>
          </div>
        </div>
      `;
    })
    .join("");
                                                           }
