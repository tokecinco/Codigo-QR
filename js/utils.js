export function showToast(message, type = "default") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "toast-error" : type === "success" ? "toast-success" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatCurrency(amount) {
  const num = Number(amount || 0);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
}

export function toJsDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(val) {
  const d = toJsDate(val);
  if (!d) return "—";
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function formatDateTime(val) {
  const d = toJsDate(val);
  if (!d) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function daysRemaining(expiresAt) {
  const d = toJsDate(expiresAt);
  if (!d) return -1;
  const diffMs = d.getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function isExpired(expiresAt) {
  const d = toJsDate(expiresAt);
  if (!d) return true;
  return d.getTime() < Date.now();
}

export function sanitizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

export function buildWhatsAppUrl(phone, message) {
  const clean = sanitizePhone(phone);
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

export function generateAccessCode(prefix = "TOKE") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = new Uint32Array(8);
  crypto.getRandomValues(randomValues);
  let part1 = "";
  let part2 = "";
  for (let i = 0; i < 4; i++) {
    part1 += chars[randomValues[i] % chars.length];
    part2 += chars[randomValues[i + 4] % chars.length];
  }
  return `${prefix}-${part1}-${part2}`;
}

export function getBaseUrl() {
  const url = window.location.href.split("?")[0];
  return url.substring(0, url.lastIndexOf("/"));
}

export function compressImageToBase64(file, maxSize = 480, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("El archivo debe ser una imagen."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagen inválida."));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL("image/jpeg", quality);
        resolve(compressed);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copiado al portapapeles", "success");
  } catch {
    showToast("No se pudo copiar automáticamente", "error");
  }
      }
