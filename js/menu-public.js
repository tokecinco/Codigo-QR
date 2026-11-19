import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
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
let categories = [];
let products = [];
let selectedCategoryId = "all";
let cart = new Map();

const loadingEl = document.getElementById("menuLoading");
const unavailableEl = document.getElementById("menuUnavailable");
const catalogEl = document.getElementById("menuCatalogView");
const successEl = document.getElementById("orderSuccessView");
const cartBarEl = document.getElementById("cartBar");
const cartModalEl = document.getElementById("cartModal");
const billModalEl = document.getElementById("billModal");

window.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  const params = new URLSearchParams(window.location.search);
  businessId = params.get("id")?.trim();

  if (!businessId) {
    showUnavailable("Enlace inválido", "Escanea nuevamente el código QR del menú.");
    return;
  }

  await initMenuPage();
});

async function initMenuPage() {
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
        "Catálogo temporalmente pausado",
        "Este comercio no tiene el menú activo en este momento.",
        true
      );
      return;
    }

    if (!currentBiz.limits?.includesMenu) {
      showUnavailable("Módulo no habilitado", "Este comercio no utiliza Menú y Catálogos QR.", true);
      return;
    }

    const allowOrders = currentBiz.allowOrders !== false;
    document.getElementById("billActionBar").classList.toggle("hidden", !allowOrders);

    const [catSnap, prodSnap] = await Promise.all([
      getDocs(collection(db, "businesses", businessId, "categories")),
      getDocs(collection(db, "businesses", businessId, "products"))
    ]);

    categories = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    products = prodSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.active !== false);

    renderCategoryTabs();
    renderProductsGrid();

    loadingEl.classList.add("hidden");
    catalogEl.classList.remove("hidden");
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    showUnavailable("Error de conexión", "No pudimos cargar el catálogo. Intenta nuevamente.");
  }
}

function applyBranding() {
  document.title = `Menú — ${currentBiz.name || "Toke QR"}`;
  document.getElementById("menuBizName").textContent = currentBiz.name || "Catálogo";
  document.getElementById("menuBizCategory").textContent = currentBiz.category || "Menú QR";

  const primary = currentBiz.theme?.primaryColor || "#7c3aed";
  const accent = currentBiz.theme?.accentColor || "#07192b";
  document.documentElement.style.setProperty("--primary", primary);
  document.documentElement.style.setProperty("--dark", accent);
  document.getElementById("menuBrandIcon").style.background = primary;

  if (currentBiz.whatsapp) {
    const waBtn = document.getElementById("menuWaContactBtn");
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, te consulto desde tu Menú QR.`
    );
    waBtn.classList.remove("hidden");
  }
}

function showUnavailable(title, msg, showWa = false) {
  loadingEl.classList.add("hidden");
  catalogEl.classList.add("hidden");
  document.getElementById("menuUnavailableTitle").textContent = title;
  document.getElementById("menuUnavailableMsg").textContent = msg;
  const waBtn = document.getElementById("menuUnavailableWaBtn");
  if (showWa && currentBiz?.whatsapp) {
    waBtn.href = buildWhatsAppUrl(
      currentBiz.whatsapp,
      `Hola ${currentBiz.name}, quisiera consultar por su menú.`
    );
    waBtn.classList.remove("hidden");
  }
  unavailableEl.classList.remove("hidden");
  lucide.createIcons();
}

function renderCategoryTabs() {
  const container = document.getElementById("menuCategoriesTabs");
  const allTabs = [{ id: "all", name: "Todos" }, ...categories];

  container.innerHTML = allTabs
    .map(
      (c) => `
      <button
        type="button"
        class="tab-btn ${selectedCategoryId === c.id ? "active" : ""}"
        data-cat-id="${c.id}"
      >
        ${escapeHtml(c.name)}
      </button>
    `
    )
    .join("");

  container.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCategoryId = btn.dataset.catId;
      renderCategoryTabs();
      renderProductsGrid();
    });
  });
}

document.getElementById("menuSearchInput").addEventListener("input", renderProductsGrid);

function renderProductsGrid() {
  const search = document.getElementById("menuSearchInput").value.trim().toLowerCase();
  const container = document.getElementById("menuProductsGrid");
  const allowOrders = currentBiz.allowOrders !== false;

  const filtered = products.filter((p) => {
    const matchCat = selectedCategoryId === "all" || p.categoryId === selectedCategoryId;
    const matchText =
      !search ||
      (p.name || "").toLowerCase().includes(search) ||
      (p.description || "").toLowerCase().includes(search);
    return matchCat && matchText;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card empty-state" style="grid-column:1/-1;">No hay productos disponibles en esta sección.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((p) => {
      const qty = cart.get(p.id)?.qty || 0;
      const waConsultUrl = currentBiz.whatsapp
        ? buildWhatsAppUrl(
            currentBiz.whatsapp,
            `Hola ${currentBiz.name}, quiero consultar por *${p.name}* (${formatCurrency(p.price)}).`
          )
        : "#";

      return `
        <div class="product-card">
          ${
            p.imageUrl
              ? `<img src="${escapeHtml(p.imageUrl)}" class="product-img" alt="${escapeHtml(p.name)}" />`
              : `<div class="product-img-placeholder"><i data-lucide="image"></i></div>`
          }
          <div class="product-body">
            <div>
              <span class="text-xs text-muted">${escapeHtml(p.categoryName || "General")}</span>
              <h3 style="font-size:1rem;color:var(--dark);margin-top:2px;">${escapeHtml(p.name)}</h3>
              ${p.description ? `<p class="text-xs text-muted mt-1">${escapeHtml(p.description)}</p>` : ""}
            </div>
            <div>
              <div class="flex-between mt-1">
                <strong style="font-size:1.05rem;color:var(--primary);">${formatCurrency(p.price)}</strong>
                ${
                  allowOrders
                    ? qty > 0
                      ? `<div class="flex gap-1">
                          <button type="button" class="btn btn-outline btn-sm qty-minus-btn" data-id="${p.id}">-</button>
                          <strong style="min-width:22px;text-align:center;">${qty}</strong>
                          <button type="button" class="btn btn-primary btn-sm qty-plus-btn" data-id="${p.id}">+</button>
                        </div>`
                      : `<button type="button" class="btn btn-primary btn-sm qty-plus-btn" data-id="${p.id}">
                          <i data-lucide="plus" style="width:14px;height:14px;"></i> Agregar
                        </button>`
                    : currentBiz.whatsapp
                    ? `<a href="${waConsultUrl}" target="_blank" class="btn btn-whatsapp btn-sm">Consultar</a>`
                    : ""
                }
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".qty-plus-btn").forEach((btn) =>
    btn.addEventListener("click", () => updateCartQty(btn.dataset.id, 1))
  );
  container.querySelectorAll(".qty-minus-btn").forEach((btn) =>
    btn.addEventListener("click", () => updateCartQty(btn.dataset.id, -1))
  );
  lucide.createIcons();
}

function updateCartQty(productId, delta) {
  const prod = products.find((p) => p.id === productId);
  if (!prod) return;

  const existing = cart.get(productId);
  const newQty = (existing?.qty || 0) + delta;

  if (newQty <= 0) {
    cart.delete(productId);
  } else {
    cart.set(productId, {
      id: prod.id,
      name: prod.name,
      price: Number(prod.price || 0),
      qty: newQty
    });
  }

  renderProductsGrid();
  renderCartBar();
}

function getCartTotals() {
  let count = 0;
  let total = 0;
  cart.forEach((item) => {
    count += item.qty;
    total += item.price * item.qty;
  });
  return { count, total };
}

function renderCartBar() {
  const { count, total } = getCartTotals();
  if (count === 0 || currentBiz.allowOrders === false) {
    cartBarEl.classList.add("hidden");
    return;
  }
  document.getElementById("cartItemsCount").textContent =
    count === 1 ? "1 producto" : `${count} productos`;
  document.getElementById("cartTotalText").textContent = formatCurrency(total);
  cartBarEl.classList.remove("hidden");
}

document.getElementById("openCartModalBtn").addEventListener("click", () => {
  renderCartModal();
  cartModalEl.classList.remove("hidden");
});
document.getElementById("closeCartModal").addEventListener("click", () => {
  cartModalEl.classList.add("hidden");
});

function renderCartModal() {
  const container = document.getElementById("cartModalItems");
  const { total } = getCartTotals();

  if (cart.size === 0) {
    cartModalEl.classList.add("hidden");
    return;
  }

  container.innerHTML = Array.from(cart.values())
    .map(
      (item) => `
      <div class="flex-between" style="border-bottom:1px solid var(--border);padding-bottom:8px;">
        <div>
          <strong style="color:var(--dark);">${escapeHtml(item.name)}</strong>
          <div class="text-xs text-muted">${formatCurrency(item.price)} c/u</div>
        </div>
        <div class="flex gap-1">
          <button type="button" class="btn btn-outline btn-sm modal-minus-btn" data-id="${item.id}">-</button>
          <strong style="min-width:22px;text-align:center;">${item.qty}</strong>
          <button type="button" class="btn btn-primary btn-sm modal-plus-btn" data-id="${item.id}">+</button>
        </div>
      </div>
    `
    )
    .join("");

  document.getElementById("cartModalTotal").textContent = formatCurrency(total);

  container.querySelectorAll(".modal-plus-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      updateCartQty(btn.dataset.id, 1);
      renderCartModal();
    })
  );
  container.querySelectorAll(".modal-minus-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      updateCartQty(btn.dataset.id, -1);
      renderCartModal();
    })
  );
}

document.getElementById("checkoutOrderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (cart.size === 0) return;

  const customerName = document.getElementById("orderCustomerName").value.trim();
  const customerPhone = document.getElementById("orderCustomerPhone").value.trim();
  const notes = document.getElementById("orderNotes").value.trim();

  if (customerPhone.replace(/[^\d]/g, "").length < 6) {
    showToast("Ingresa un número de WhatsApp válido", "error");
    return;
  }

  const btn = document.getElementById("submitOrderBtn");
  btn.disabled = true;
  btn.textContent = "Enviando pedido...";

  try {
    const items = Array.from(cart.values());
    const { total } = getCartTotals();

    await addDoc(collection(db, "businesses", businessId, "orders"), {
      orderType: "order",
      customerName,
      customerPhone,
      notes,
      items,
      total,
      status: "pendiente",
      createdAt: serverTimestamp()
    });

    cartModalEl.classList.add("hidden");
    catalogEl.classList.add("hidden");
    cartBarEl.classList.add("hidden");

    const summaryLines = items
      .map((i) => `• ${i.qty}x ${i.name} (${formatCurrency(i.price * i.qty)})`)
      .join("<br/>");

    document.getElementById("orderSuccessTitle").textContent = "¡Pedido enviado!";
    document.getElementById("orderSuccessSubtitle").textContent =
      "El negocio recibió tu pedido. Cuando esté listo te avisarán por WhatsApp.";
    document.getElementById("orderSuccessSummary").innerHTML = `
      <div><strong>Cliente / Mesa:</strong> ${escapeHtml(customerName)}</div>
      <div class="mt-1">${summaryLines}</div>
      ${notes ? `<div class="mt-1"><strong>Notas:</strong> ${escapeHtml(notes)}</div>` : ""}
      <div class="mt-1"><strong>Total:</strong> ${formatCurrency(total)}</div>
    `;

    const waBtn = document.getElementById("orderSuccessWaBtn");
    if (currentBiz.whatsapp) {
      const waTextItems = items.map((i) => `- ${i.qty}x ${i.name}`).join("\n");
      waBtn.href = buildWhatsAppUrl(
        currentBiz.whatsapp,
        `Hola ${currentBiz.name}, hice un pedido desde el Menú QR:\n${waTextItems}\nTotal: ${formatCurrency(total)}\nCliente/Mesa: ${customerName}${notes ? `\nNota: ${notes}` : ""}`
      );
      waBtn.classList.remove("hidden");
    } else {
      waBtn.classList.add("hidden");
    }

    cart.clear();
    successEl.classList.remove("hidden");
    showToast("¡Pedido enviado al negocio!", "success");
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    showToast("No se pudo enviar el pedido. Verifica si el negocio está activo.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar Pedido";
  }
});

document.getElementById("openBillModalBtn").addEventListener("click", () => {
  billModalEl.classList.remove("hidden");
});
document.getElementById("closeBillModal").addEventListener("click", () => {
  billModalEl.classList.add("hidden");
});

document.getElementById("checkoutBillForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tableOrName = document.getElementById("billTableOrName").value.trim();
  const paymentMethod = document.getElementById("billPaymentMethod").value;
  const rawPhone = document.getElementById("billCustomerPhone").value.trim();
  const notes = document.getElementById("billNotes").value.trim();

  if (rawPhone && rawPhone.replace(/[^\d]/g, "").length < 6) {
    showToast("Ingresa un WhatsApp válido o déjalo vacío.", "error");
    return;
  }

  const phoneToSave = rawPhone || "Sin WhatsApp";
  const btn = document.getElementById("submitBillBtn");
  btn.disabled = true;
  btn.textContent = "Enviando solicitud...";

  try {
    await addDoc(collection(db, "businesses", businessId, "orders"), {
      orderType: "bill",
      customerName: tableOrName,
      customerPhone: phoneToSave,
      paymentMethod,
      notes,
      items: [{ id: "bill", name: `Solicita la cuenta (${paymentMethod})`, price: 0, qty: 1 }],
      total: 0,
      status: "pendiente",
      createdAt: serverTimestamp()
    });

    billModalEl.classList.add("hidden");
    catalogEl.classList.add("hidden");
    cartBarEl.classList.add("hidden");

    document.getElementById("orderSuccessTitle").textContent = "¡Cuenta solicitada!";
    document.getElementById("orderSuccessSubtitle").textContent =
      "Ya avisamos al local. En breve se acercarán a tu mesa con la cuenta.";
    document.getElementById("orderSuccessSummary").innerHTML = `
      <div><strong>Mesa / Nombre:</strong> ${escapeHtml(tableOrName)}</div>
      <div class="mt-1"><strong>Forma de pago:</strong> ${escapeHtml(paymentMethod)}</div>
      ${notes ? `<div class="mt-1"><strong>Notas:</strong> ${escapeHtml(notes)}</div>` : ""}
    `;

    const waBtn = document.getElementById("orderSuccessWaBtn");
    if (currentBiz.whatsapp) {
      waBtn.href = buildWhatsAppUrl(
        currentBiz.whatsapp,
        `Hola ${currentBiz.name}, pedimos la cuenta desde el Menú QR:\n• Mesa / Nombre: ${tableOrName}\n• Forma de pago: ${paymentMethod}${notes ? `\n• Nota: ${notes}` : ""}`
      );
      waBtn.classList.remove("hidden");
    } else {
      waBtn.classList.add("hidden");
    }

    successEl.classList.remove("hidden");
    showToast("¡Solicitud de cuenta enviada!", "success");
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    showToast("No se pudo enviar la solicitud.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Solicitar cuenta ahora";
  }
});

document.getElementById("newOrderBtn").addEventListener("click", () => {
  window.location.reload();
});
