import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { firebaseConfig, emailConfig, adminConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
const provider = new GoogleAuthProvider();

const authPersistenceReady = setPersistence(auth, browserLocalPersistence)
  .then(() => true)
  .catch((err) => {
    console.error("AUTH PERSISTENCE ERROR:", err);
    return false;
  });

provider.setCustomParameters({
  prompt: "select_account"
});

const emailClient = window.emailjs || null;

if (emailClient) {
  emailClient.init(emailConfig.publicKey);
} else {
  console.warn("EmailJS SDK is unavailable; email notifications are disabled.");
}

async function sendEmail(templateParams) {
  if (!emailClient) {
    throw new Error("EmailJS SDK is unavailable");
  }

  return emailClient.send(
    emailConfig.serviceId,
    emailConfig.templateId,
    templateParams
  );
}

let currentOrder = { item: "", price: 0, gameId: "free-fire", offerId: "", fields: [] };
const DEFAULT_LISTING_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%2319233a'/%3E%3Cstop offset='1' stop-color='%23090e19'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='800' fill='url(%23g)'/%3E%3Cpath d='M510 300h180v180H510zM450 360h300v60H450z' fill='none' stroke='%2359b5ff' stroke-width='12' opacity='.65'/%3E%3Ctext x='600' y='570' fill='%23aebbd2' font-family='sans-serif' font-size='34' text-anchor='middle'%3EACCOUNT SCREENSHOT NOT PROVIDED%3C/text%3E%3C/svg%3E";
let allListings = [];
let selectedAccountListing = null;
let currentUserIsAdmin = false;
let selectedGameId = "free-fire";
let marketplaceLoadPromise = null;
const topupCatalogRequests = new Map();

// Game capabilities are explicit. Custom top-up requests and swaps stay off
// until an authorized provider and publisher policy support them.
const games = [
  { id: "free-fire", name: "Free Fire", shortName: "FF", enabled: true, currency: "Diamonds", uidLabel: "Free Fire Player UID", capabilities: { customDiamondRequest: false, accountSwap: false } },
  { id: "call-of-duty", name: "Call of Duty Mobile", shortName: "CODM", enabled: true, currency: "COD Points", uidLabel: "Call of Duty Player UID", capabilities: { customDiamondRequest: false, accountSwap: false } }
];
const GAMES = Object.fromEntries(games.map((game) => [game.id, game]));

function getGame(gameId) { return GAMES[gameId] || games[0]; }
function getListingGameId(listing) { return listing.gameId || "free-fire"; }
function getOrderGameId(order) { return order.gameId || "free-fire"; }

const defaultSiteSettings = {
  topupEnabled: true,
  marketplaceEnabled: true,
  maintenanceMode: false,
  supportWhatsapp: "2347120004769"
};
let siteSettings = { ...defaultSiteSettings };
let siteSettingsReady;

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function loadSiteSettings() {
  try {
    const settingsSnap = await getDoc(doc(db, "settings", "public"));
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      siteSettings = {
        topupEnabled: normalizeBoolean(data.topupEnabled, defaultSiteSettings.topupEnabled),
        marketplaceEnabled: normalizeBoolean(data.marketplaceEnabled, defaultSiteSettings.marketplaceEnabled),
        maintenanceMode: normalizeBoolean(data.maintenanceMode, defaultSiteSettings.maintenanceMode),
        supportWhatsapp: normalizeString(data.supportWhatsapp, defaultSiteSettings.supportWhatsapp)
      };
    }
  } catch (err) {
    console.error("LOAD PUBLIC SITE SETTINGS ERROR:", err);
  }
  applySiteSettings();
  return siteSettings;
}

siteSettingsReady = loadSiteSettings();

function setElementText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function isTopupAvailable() {
  return !siteSettings.maintenanceMode && siteSettings.topupEnabled;
}

function isMarketplaceAvailable() {
  return !siteSettings.maintenanceMode && siteSettings.marketplaceEnabled;
}

async function ensureSiteSettingsLoaded() {
  try {
    await siteSettingsReady;
  } catch (err) {
    console.error("SITE SETTINGS STARTUP ERROR:", err);
  }
}

function upsertStatusMessage(id, message, anchorElement) {
  if (!anchorElement) return;

  let statusBox = document.getElementById(id);

  if (!statusBox) {
    statusBox = document.createElement("div");
    statusBox.id = id;
    statusBox.className = "login-required-box settings-status-box";
    anchorElement.before(statusBox);
  }

  statusBox.textContent = message;
  statusBox.classList.remove("hidden");
}

function hideStatusMessage(id) {
  const statusBox = document.getElementById(id);

  if (statusBox) {
    statusBox.classList.add("hidden");
  }
}

function applySiteSettings() {
  const maintenanceBannerId = "maintenance-banner";
  let maintenanceBanner = document.getElementById(maintenanceBannerId);

  if (siteSettings.maintenanceMode) {
    if (!maintenanceBanner) {
      maintenanceBanner = document.createElement("div");
      maintenanceBanner.id = maintenanceBannerId;
      maintenanceBanner.className = "maintenance-banner";
      document.body.prepend(maintenanceBanner);
    }

    maintenanceBanner.textContent =
      "Savage Store is currently in maintenance mode. Orders, purchases, and seller submissions are disabled.";
  } else if (maintenanceBanner) {
    maintenanceBanner.remove();
  }

  const diamondGrid = document.getElementById("diamond-grid");
  const customDiamondBox = document.querySelector(".custom-diamond-box");
  const topupLoginBox = document.getElementById("login-required-box");

  if (!isTopupAvailable()) {
    if (diamondGrid) {
      diamondGrid.classList.add("hidden");
    }

    if (customDiamondBox) customDiamondBox.classList.add("hidden");

    if (topupLoginBox) {
      topupLoginBox.classList.add("hidden");
    }

    upsertStatusMessage(
      "topup-settings-status",
      siteSettings.maintenanceMode
        ? "Game top-ups are unavailable during maintenance."
        : "Game top-ups are temporarily unavailable.",
      diamondGrid || customDiamondBox
    );
  } else {
    hideStatusMessage("topup-settings-status");
    if (customDiamondBox) {
      customDiamondBox.classList.toggle("hidden", !getGame(selectedGameId).capabilities.customDiamondRequest);
    }
  }

  document.querySelectorAll('a[href^="https://wa.me/"]').forEach((link) => {
    link.href = `https://wa.me/${getSupportWhatsappNumber()}`;
  });

  const marketplaceGrid = document.getElementById("marketplace-grid");
  const featuredSection = document.getElementById("featured-section");
  const marketplaceControls = document.getElementById("marketplace-controls");
  const marketplaceLoginBox = document.getElementById("marketplace-login-box");
  const homeFeaturedSection = document.querySelector(".home-page .featured-section");

  if (!isMarketplaceAvailable()) {
    [marketplaceGrid, featuredSection, marketplaceControls, marketplaceLoginBox, homeFeaturedSection].forEach((element) => {
      if (element) {
        element.classList.add("hidden");
      }
    });

    upsertStatusMessage(
      "marketplace-settings-status",
      siteSettings.maintenanceMode
        ? "Marketplace is unavailable during maintenance."
        : "Marketplace is temporarily unavailable.",
      marketplaceGrid || featuredSection || marketplaceControls
    );
  } else {
    hideStatusMessage("marketplace-settings-status");
    marketplaceGrid?.classList.remove("hidden");
    marketplaceControls?.classList.remove("hidden");
    featuredSection?.classList.remove("hidden");
    marketplaceLoginBox?.classList.add("hidden");
    homeFeaturedSection?.classList.remove("hidden");
  }
}

function appendOrderField(card, label, value) {
  const paragraph = document.createElement("p");
  const strong = document.createElement("strong");

  strong.textContent = `${label}:`;
  paragraph.append(strong, ` ${value}`);
  card.appendChild(paragraph);
}

function getValidImageUrl(url) {
  const value = (url || "").trim();

  if (!value) {
    return "";
  }

  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return parsedUrl.href;
    }
  } catch (err) {
    console.warn("Invalid listing image URL ignored:", value);
  }

  return "";
}

function createListingImage(listing, className) {
  const img = document.createElement("img");
  const imageUrl = getValidImageUrl(listing.image1);

  img.src = imageUrl || DEFAULT_LISTING_IMAGE;
  img.alt = listing.title
    ? `${listing.title} account screenshot`
    : "Account screenshot";

  if (className) {
    img.className = className;
  }

  return img;
}

function createOrderCard(order, options = {}) {
  const game = getGame(getOrderGameId(order));
  const card = document.createElement("div");
  const title = document.createElement("h3");
  const price = Number(order.price || 0);

  card.className = "order-card";
  title.textContent = order.orderId || "No Order ID";
  card.appendChild(title);

  if (options.showCustomerDetails) {
    appendOrderField(card, "Name", order.customerName || "N/A");
    appendOrderField(card, "Email", order.customerEmail || "N/A");
    appendOrderField(card, "UID", order.gameUID || "N/A");
  }

  appendOrderField(card, "Game", game.name);
  appendOrderField(card, "Type", order.orderType === "account-purchase" ? "ACCOUNT PURCHASE" : "TOP-UP ORDER");
  appendOrderField(card, "Item", order.item || "N/A");
  appendOrderField(card, "Price", `₦${price.toLocaleString()}`);
  const statusRow = document.createElement("p");
  const statusLabel = document.createElement("strong");
  const statusBadge = document.createElement("span");
  const status = ["processing", "delivered", "failed"].includes(order.status) ? order.status : "processing";
  statusLabel.textContent = "Status: ";
  statusBadge.className = `status-badge status-${status}`;
  statusBadge.textContent = status.toUpperCase();
  statusRow.append(statusLabel, statusBadge);
  card.appendChild(statusRow);

  if (order.orderType === "topup" || order.orderType == null) {
    appendOrderField(card, "Payment", order.paymentStatus || (order.orderType ? "pending" : "legacy"));
    appendOrderField(card, "Fulfillment", order.fulfillmentStatus || "legacy processing");
  }

  if (order.listingId) {
    appendOrderField(card, "Listing ID", order.listingId);
  }

  if (order.createdAt) {
    appendOrderField(card, "Date", formatDate(order.createdAt));
  }

  if (options.showStatusControl) {
    const statusSelect = document.createElement("select");
    const statuses = ["processing", "delivered", "failed"];

    statusSelect.className = "status-select";

    statuses.forEach((status) => {
      const option = document.createElement("option");

      option.value = status;
      option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      option.selected = order.status === status;
      option.disabled = status === "delivered" && order.orderType === "topup" &&
        (order.paymentStatus !== "paid" || !["submitted", "delivered"].includes(order.fulfillmentStatus));
      statusSelect.appendChild(option);
    });

    statusSelect.addEventListener("change", () => {
      window.updateOrderStatus(order.id, statusSelect.value);
    });

    card.appendChild(statusSelect);

    if (order.paymentStatus === "paid" && order.fulfillmentStatus === "reconciliation-required") {
      const recovery = document.createElement("div");
      const foundButton = document.createElement("button");
      const missingButton = document.createElement("button");
      recovery.className = "admin-controls fulfillment-recovery";
      foundButton.type = "button";
      foundButton.textContent = "SUPPLIER ORDER FOUND";
      foundButton.addEventListener("click", async () => {
        const supplierOrderId = window.prompt("Enter the FazerCards order ID after confirming it in the supplier dashboard:");
        if (!supplierOrderId?.trim()) return;
        await resolveTopupRecovery(order.id, "supplier-found", supplierOrderId.trim());
      });
      missingButton.type = "button";
      missingButton.className = "danger-btn";
      missingButton.textContent = "SUPPLIER ORDER NOT FOUND";
      missingButton.addEventListener("click", async () => {
        if (window.confirm("Only continue after checking FazerCards and confirming no order exists. Retry this paid order now?")) {
          await resolveTopupRecovery(order.id, "supplier-not-found");
        }
      });
      recovery.append(foundButton, missingButton);
      card.appendChild(recovery);
    }
  }

  if (options.showPaymentProof) {
    appendOrderField(
      card,
      "Proof",
      order.paymentProof || "No proof required yet"
    );
  }

  return card;
}

async function resolveTopupRecovery(orderId, resolution, supplierOrderId = "") {
  if (!currentUserIsAdmin) return;
  try {
    const resolve = httpsCallable(functions, "resolveTopupFulfillment");
    await resolve({ orderId, resolution, supplierOrderId });
    window.showToast("Supplier fulfillment status updated.");
    await loadAdminOrders();
  } catch (err) {
    console.error("TOP-UP RECOVERY ERROR:", err);
    window.showToast("Could not update supplier fulfillment. Confirm the supplier dashboard status and retry.");
  }
}

function formatNaira(value) {
  return `₦${Number(value || 0).toLocaleString()}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "N/A";

  const dateValue = typeof timestamp.toDate === "function"
    ? timestamp.toDate()
    : new Date(timestamp);

  return Number.isNaN(dateValue.getTime())
    ? "N/A"
    : dateValue.toLocaleDateString();
}

function getListingImages(listing) {
  return [listing.image1, listing.image2, listing.image3]
    .map(getValidImageUrl)
    .filter(Boolean);
}

function getListingById(listingId) {
  return allListings.find((listing) => listing.id === listingId) || null;
}

function createListingImageGallery(listing, className = "listing-gallery") {
  const gallery = document.createElement("div");
  const images = getListingImages(listing);

  gallery.className = className;

  if (!images.length) {
    gallery.appendChild(createListingImage(listing, "listing-image"));
    return gallery;
  }

  images.forEach((imageUrl, index) => {
    const image = document.createElement("img");

    image.src = imageUrl;
    image.alt = `${listing.title || "Gaming account"} screenshot ${index + 1}`;
    image.className = "listing-image";
    gallery.appendChild(image);
  });

  return gallery;
}

function isListingApproved(listing) {
  return listing.status === "approved" &&
    listing.availability !== "sold" &&
    listing.isAvailable !== false;
}

function isPriceInRange(price, range) {
  if (!range) return true;
  if (range === "500000") return price >= 500000;

  const [min, max] = range.split("-").map(Number);
  return price >= min && price <= max;
}

function sortListings(listings, sortValue) {
  const sortedListings = [...listings];

  if (sortValue === "price-asc") {
    sortedListings.sort((first, second) => Number(first.price || 0) - Number(second.price || 0));
  } else if (sortValue === "price-desc") {
    sortedListings.sort((first, second) => Number(second.price || 0) - Number(first.price || 0));
  } else {
    sortedListings.sort((first, second) => {
      const firstCreatedAt = first.approvedAt?.toMillis?.() || first.createdAt?.toMillis?.() || 0;
      const secondCreatedAt = second.approvedAt?.toMillis?.() || second.createdAt?.toMillis?.() || 0;

      return secondCreatedAt - firstCreatedAt;
    });
  }

  return sortedListings;
}

function createMarketplaceCard(listing, isFeatured = false) {
  const card = document.createElement("div");
  const badge = document.createElement("div");
  const title = document.createElement("h3");
  const details = document.createElement("p");
  const description = document.createElement("p");
  const price = document.createElement("h2");
  const viewButton = document.createElement("button");
  const buyButton = document.createElement("button");
  const actions = document.createElement("div");

  card.className = isFeatured ? "market-card featured" : "market-card";
  badge.className = isFeatured ? "badge premium" : "badge";
  badge.textContent = `${isFeatured ? "⭐ FEATURED · " : ""}${getGame(getListingGameId(listing)).shortName} · ${listing.rank || "ACCOUNT"}`;
  title.textContent = listing.title || "Gaming Account";
  details.textContent = `${getGame(getListingGameId(listing)).name} · ${listing.region || "N/A"} · ${listing.rank || "N/A"} · Level ${listing.level || "N/A"}`;
  description.textContent = listing.description || "No description provided.";
  price.textContent = formatNaira(listing.price);
  viewButton.type = "button";
  viewButton.textContent = "VIEW ACCOUNT";
  viewButton.addEventListener("click", () => window.viewAccountListing(listing.id));
  buyButton.type = "button";
  buyButton.className = "card-buy-button";
  buyButton.textContent = "BUY";
  buyButton.addEventListener("click", () => window.openAccountPurchase(listing.id));
  actions.className = "account-card-actions";
  actions.append(viewButton, buyButton);

  card.append(
    badge,
    createListingImage(listing, "listing-image"),
    title,
    details,
    description,
    price,
    actions
  );

  return card;
}

function ensureModalShell(modalId, titleText, bodyId, buttonId, buttonText, closeHandler) {
  let modal = document.getElementById(modalId);
  if (modal) {
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    if (modal.dataset.backdropBound !== "true") {
      modal.addEventListener("click", (event) => { if (event.target === modal) closeHandler(); });
      modal.dataset.backdropBound = "true";
    }
    if (modal.dataset.keyboardBound !== "true") {
      modal.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const focusable = [...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
          .filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      modal.dataset.keyboardBound = "true";
    }
    return modal;
  }
  modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const box = document.createElement("div");
  const close = document.createElement("button");
  const title = document.createElement("h2");
  const body = document.createElement("div");
  box.className = "modal-box account-modal-box";
  close.type = "button";
  close.className = "close-btn";
  close.setAttribute("aria-label", "Close dialog");
  close.textContent = "×";
  close.addEventListener("click", closeHandler);
  title.textContent = titleText;
  body.id = bodyId;
  body.className = "summary-box";
  box.append(close, title, body);
  if (buttonId) {
    const action = document.createElement("a");
    action.id = buttonId;
    action.className = "primary-btn full-btn";
    action.textContent = buttonText;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.addEventListener("click", window.closeAccountPurchase);
    box.appendChild(action);
  }
  modal.appendChild(box);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeHandler(); });
  modal.dataset.backdropBound = "true";
  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  modal.dataset.keyboardBound = "true";
  document.body.appendChild(modal);
  return modal;
}

function renderMarketplaceListings() {
  const searchInput = document.getElementById("marketplace-search");
  if (searchInput && !searchInput.value && new URLSearchParams(location.search).get("search")) searchInput.value = new URLSearchParams(location.search).get("search");
  const searchTerm = searchInput?.value.toLowerCase().trim() || "";
  const regionFilter = document.getElementById("region-filter")?.value || "";
  const gameFilter = document.getElementById("game-filter")?.value || "";
  const rankFilter = document.getElementById("rank-filter")?.value.toLowerCase() || "";
  const priceFilter = document.getElementById("price-filter")?.value || "";
  const sortFilter = document.getElementById("sort-filter")?.value || "newest";

  const filteredListings = allListings.filter((listing) => {
    if (!isListingApproved(listing)) return false;

    const listingRank = String(listing.rank || "").toLowerCase();
    const matchesSearch =
      !searchTerm ||
      String(listing.title || "").toLowerCase().includes(searchTerm) ||
      listingRank.includes(searchTerm) ||
      String(listing.region || "").toLowerCase().includes(searchTerm);

    const matchesGame = !gameFilter || getListingGameId(listing) === gameFilter;
    const matchesRegion = !regionFilter || listing.region === regionFilter;
    const matchesRank = !rankFilter || listingRank.includes(rankFilter);
    const matchesPrice = isPriceInRange(Number(listing.price || 0), priceFilter);

    return matchesSearch && matchesGame && matchesRegion && matchesRank && matchesPrice;
  });

  const sortedListings = sortListings(filteredListings, sortFilter);
  const featuredListings = sortedListings.slice(0, 3);
  const featuredGrid = document.getElementById("featured-grid");
  const marketplaceGrid = document.getElementById("marketplace-grid");
  const homeGrid = document.getElementById("home-featured-grid");

  if (featuredGrid) {
    featuredGrid.replaceChildren();

    if (featuredListings.length) {
      featuredListings.forEach((listing) => {
        featuredGrid.appendChild(createMarketplaceCard(listing, true));
      });
    } else {
      const emptyMessage = document.createElement("p");

      emptyMessage.textContent = "No featured listings match your filters.";
      featuredGrid.appendChild(emptyMessage);
    }
  }

  if (homeGrid) {
    homeGrid.replaceChildren();
    const homeListings = sortListings(
      allListings.filter(isListingApproved),
      "newest"
    ).slice(0, 3);
    if (!homeListings.length) {
      const emptyMessage = document.createElement("p");
      emptyMessage.textContent = "No approved accounts are available yet. Check back soon.";
      homeGrid.appendChild(emptyMessage);
    } else {
      homeListings.forEach((listing) => homeGrid.appendChild(createMarketplaceCard(listing, true)));
    }
  }

  if (!marketplaceGrid) return;

  marketplaceGrid.replaceChildren();

  if (!sortedListings.length) {
    const emptyMessage = document.createElement("p");

    emptyMessage.textContent = "No approved listings match your filters.";
    marketplaceGrid.appendChild(emptyMessage);
    return;
  }

  sortedListings.forEach((listing) => {
    marketplaceGrid.appendChild(createMarketplaceCard(listing));
  });
}

async function checkAdminAccess(user) {
  if (!user) {
    return false;
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));

    if (adminSnap.exists()) {
      return true;
    }
  } catch (err) {
    console.warn("ADMIN CHECK ERROR:", err);
  }

  return false;
}

function getSupportWhatsappNumber() {
  return String(
    siteSettings.supportWhatsapp || defaultSiteSettings.supportWhatsapp
  ).replace(/\D/g, "");
}

function getListingImage(listing) {
  return listing.image1 || listing.imageUrl || listing.screenshotUrl || DEFAULT_LISTING_IMAGE;
}

function setSelectedGame(gameId) {
  if (!GAMES[gameId]) return;
  selectedGameId = gameId;
  currentOrder = { item: "", price: 0, gameId, offerId: "", fields: [] };
  const gameFields = document.getElementById("game-fields-container");
  const customAmount = document.getElementById("custom-diamond-amount");
  gameFields?.replaceChildren();
  if (customAmount) customAmount.value = "";
  document.querySelectorAll("[data-game-select]").forEach((button) => {
    button.classList.toggle("active", button.dataset.gameSelect === gameId);
    button.setAttribute("aria-pressed", String(button.dataset.gameSelect === gameId));
  });
  document.querySelectorAll(".game-choice[data-game]").forEach((button) => {
    button.classList.toggle("active", button.dataset.game === gameId);
    button.setAttribute("aria-pressed", String(button.dataset.game === gameId));
  });
  document.querySelectorAll("[data-game-name]").forEach((element) => { element.textContent = GAMES[gameId].name; });
  const note = document.getElementById("topup-game-note");
  if (note) note.textContent = `${GAMES[gameId].name} · ${GAMES[gameId].currency} · Enter the player details required for the selected package`;
  applySiteSettings();
  if (auth.currentUser) loadTopupCatalog(gameId);
}

window.selectGame = setSelectedGame;

window.scrollToSection = (id) => {
  const section = document.getElementById(id);

  if (section) {
    section.scrollIntoView({
      behavior: "smooth"
    });
  }
};

window.showToast = (message) => {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
};

async function saveUser(user) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      name: user.displayName,
      email: user.email,
      photo: user.photoURL,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

async function loadProfile(user) {
  const section = document.getElementById("profile-section");
  const loginBox = document.getElementById("profile-login-box");
  if (!section || !loginBox) return;
  loginBox.classList.add("hidden");
  section.classList.remove("hidden");
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const swapContact = document.getElementById("swap-contact");
  if (swapContact) swapContact.value = profile.phone || "";
  const sellerContact = document.getElementById("seller-contact");
  if (sellerContact && !sellerContact.value) sellerContact.value = profile.phone || "";
  const values = {
    "profile-name": user.displayName || "Savage Store player",
    "profile-email": user.email || "",
    "profile-phone": profile.phone || "",
    "profile-free-fire-uid": profile.freeFireUid || "",
    "profile-cod-uid": profile.codMobileUid || "",
    "profile-country": profile.country || "",
    "profile-preferred-game": profile.preferredGame || "free-fire"
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element) return;
    if ("value" in element) element.value = value;
    else element.textContent = value;
  });
  const photo = document.getElementById("profile-photo");
  if (photo) photo.src = user.photoURL || DEFAULT_LISTING_IMAGE;
  const created = document.getElementById("profile-created");
  if (created) created.textContent = user.metadata?.creationTime ? `Account created: ${new Date(user.metadata.creationTime).toLocaleDateString()}` : "";
}

async function saveProfile(event) {
  event.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  const read = (id) => document.getElementById(id)?.value.trim() || "";
  const profileData = {
    uid: user.uid,
    phone: read("profile-phone"),
    freeFireUid: read("profile-free-fire-uid"),
    codMobileUid: read("profile-cod-uid"),
    country: read("profile-country"),
    preferredGame: document.getElementById("profile-preferred-game")?.value || "free-fire",
    updatedAt: serverTimestamp()
  };
  try {
    showToast("Saving profile...");
    await setDoc(doc(db, "users", user.uid), profileData, { merge: true });
    showToast("Profile saved ✅");
  } catch (error) {
    console.error("PROFILE SAVE ERROR:", error);
    showToast("Could not save profile. Please try again.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initializeNavigation();
  document.getElementById("profile-form")?.addEventListener("submit", saveProfile);
  document.querySelectorAll("nav a").forEach((link) => {
    if (new URL(link.href).pathname === window.location.pathname) link.setAttribute("aria-current", "page");
  });
});

function setMobileMenuOpen(open) {
  const nav = document.querySelector("header nav");
  const button = document.getElementById("mobile-menu-toggle");
  if (!nav || !button) return;
  nav.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  const icon = button.querySelector(".material-symbols-outlined");
  if (icon) icon.textContent = open ? "close" : "menu";
}

function setIconOnlyContent(element, iconName, accessibleLabel) {
  if (!element) return;
  element.classList.add("nav-icon-only");
  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined nav-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconName;
  const label = document.createElement("span");
  label.className = "visually-hidden";
  label.textContent = accessibleLabel;
  element.replaceChildren(icon, label);
  element.setAttribute("aria-label", accessibleLabel);
  element.title = accessibleLabel;
}

function setNavigationAccountState(user) {
  const button = document.getElementById("nav-login-btn");
  if (!button) return;
  const loggedIn = Boolean(user);
  setIconOnlyContent(button, loggedIn ? "logout" : "login", loggedIn ? "Log out" : "Log in or sign up with Google");
  if (loggedIn) {
    button.title = `${user.displayName || user.email || "Savage Store user"} · Log out`;
    button.onclick = window.logout;
  } else {
    button.onclick = window.signInWithGoogle;
  }
}

function initializeNavigation() {
  const header = document.querySelector("header");
  const nav = header?.querySelector("nav");
  if (!header || !nav) return;
  nav.setAttribute("aria-label", "Primary navigation");
  const iconByPage = {
    "index.html": ["home", "Home"],
    "topup.html": ["diamond", "Top up"],
    "marketplace.html": ["storefront", "Marketplace"],
    "sell.html": ["swap_horiz", "Sell or swap account"],
    "orders.html": ["receipt_long", "My orders"],
    "profile.html": ["person", "Profile"],
    "admin.html": ["admin_panel_settings", "Admin dashboard"]
  };
  nav.querySelectorAll("a").forEach((link) => {
    const page = new URL(link.href).pathname.split("/").pop().toLowerCase();
    const [icon, label] = iconByPage[page] || ["link", link.textContent.trim() || "Navigation"];
    setIconOnlyContent(link, icon, label);
    const currentPage = location.pathname.split("/").pop().toLowerCase() || "index.html";
    const active = page === currentPage;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  setNavigationAccountState(auth.currentUser);

  let button = header.querySelector("#mobile-menu-toggle, .menu-toggle");
  if (!button) {
    button = document.createElement("button");
    header.insertBefore(button, nav);
  }
  button.id = "mobile-menu-toggle";
  button.type = "button";
  button.classList.add("mobile-menu-toggle", "nav-icon-only");
  button.setAttribute("aria-expanded", "false");
  setIconOnlyContent(button, "menu", "Open navigation menu");
  button.addEventListener("click", () => setMobileMenuOpen(!nav.classList.contains("active")));
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMobileMenuOpen(false)));
  document.addEventListener("click", (event) => { if (!header.contains(event.target)) setMobileMenuOpen(false); });
  nav.classList.add("icons-ready");
}

function setLoginOverlay(visible, message = "Connecting to Google…") {
  let overlay = document.getElementById("login-overlay");
  if (!overlay && visible) {
    overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.className = "login-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    const dialog = document.createElement("div");
    const spinner = document.createElement("span");
    const heading = document.createElement("strong");
    const message = document.createElement("p");
    dialog.className = "login-dialog";
    spinner.className = "login-spinner";
    spinner.setAttribute("aria-hidden", "true");
    message.textContent = "Please complete the secure Google sign-in window.";
    dialog.append(spinner, heading, message);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }
  if (!overlay) return;
  overlay.querySelector("strong").textContent = message;
  overlay.classList.toggle("hidden", !visible);
}

window.signInWithGoogle = async () => {
  const loginButtons = [...document.querySelectorAll("#nav-login-btn, .login-button, [onclick=\"signInWithGoogle()\"]")];
  loginButtons.forEach((button) => { button.disabled = true; });
  setLoginOverlay(true, "Connecting to Google…");
  try {
    if (!(await authPersistenceReady)) {
      throw new Error("Persistent sign-in could not be configured.");
    }
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    try {
      await saveUser(user);
    } catch (profileError) {
      console.error("SIGNED-IN PROFILE SAVE ERROR:", profileError);
      window.showToast("Signed in successfully. Your profile details could not be refreshed; try saving your profile later.");
      return;
    }
    window.showToast(`Welcome ${user.displayName || "to Savage Store"}.`);
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    if (err.code === "auth/popup-closed-by-user") {
      window.showToast("Google sign-in was closed before it finished.");
    } else {
      window.showToast("Google sign-in failed. Please retry; if it continues, check Firebase authorized domains.");
    }
  } finally {
    setLoginOverlay(false);
    loginButtons.forEach((button) => { button.disabled = false; });
  }
};

window.logout = async () => {
  try {
    await signOut(auth);
    window.showToast("Logged out successfully ⚡");
  } catch (err) {
    console.error("LOGOUT ERROR:", err);

    alert(
      "Logout failed:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
  }
};


async function sendCustomerConfirmationEmail(orderData) {
  try {
    await sendEmail(
      {
        to_email: orderData.customerEmail,
        user_email: orderData.customerEmail,
        email: orderData.customerEmail,
        reply_to: orderData.customerEmail,

        to_name: orderData.customerName,
        customer_name: orderData.customerName,

        order_item: orderData.item,
        item: orderData.item,

        uid: orderData.gameUID,
        currency_symbol: "₦",
        price: Number(orderData.price).toLocaleString()
      }
    );

    return true;
  } catch (err) {
    console.error("CUSTOMER EMAIL ERROR:", err);
    showToast("⚠️ Confirmation email could not be sent");
    return false;
  }
}

async function sendAdminOrderEmail(orderData) {
  try {
    await sendEmail(
      {
        to_email: adminConfig.emails[0],
        user_email: adminConfig.emails[0],
        email: adminConfig.emails[0],
        reply_to: orderData.customerEmail,

        to_name: "Savage Store Admin",
        customer_name: orderData.customerName,

        order_item: `NEW ORDER: ${orderData.item}`,
        item: orderData.item,

        uid: orderData.gameUID,
        currency_symbol: "₦",
        price: Number(orderData.price).toLocaleString()
      }
    );

    return true;
  } catch (err) {
    console.error("ADMIN EMAIL ERROR:", err);
    showToast("⚠️ Admin notification email could not be sent");
    return false;
  }
}

async function sendDeliveredReceiptEmail(orderData) {
  try {
    await sendEmail(
      {
        to_email: orderData.customerEmail,
        user_email: orderData.customerEmail,
        email: orderData.customerEmail,
        reply_to: adminConfig.emails[0],

        to_name: orderData.customerName,
        customer_name: orderData.customerName,

        order_item: `DELIVERED: ${orderData.item}`,
        item: orderData.item,

        uid: orderData.gameUID,
        currency_symbol: "₦",
        price: Number(orderData.price).toLocaleString()
      }
    );

    return true;
  } catch (err) {
    console.error("DELIVERED EMAIL ERROR:", err);
    showToast("⚠️ Delivery receipt email could not be sent");
    return false;
  }
}

// Load approved marketplace listings with real-time updates AND search/filter support
function populateAdminSettingsForm() {
  const supportWhatsappInput = document.getElementById("setting-support-whatsapp");
  const topupEnabledInput = document.getElementById("setting-topup-enabled");
  const marketplaceEnabledInput = document.getElementById("setting-marketplace-enabled");
  const maintenanceModeInput = document.getElementById("setting-maintenance-mode");

  if (supportWhatsappInput) supportWhatsappInput.value = siteSettings.supportWhatsapp;
  if (topupEnabledInput) topupEnabledInput.checked = siteSettings.topupEnabled;
  if (marketplaceEnabledInput) marketplaceEnabledInput.checked = siteSettings.marketplaceEnabled;
  if (maintenanceModeInput) maintenanceModeInput.checked = siteSettings.maintenanceMode;
}

window.saveAdminSiteSettings = async () => {
  const user = auth.currentUser;

  if (!user || !(await checkAdminAccess(user))) {
    alert("Admin access required.");
    return;
  }

  const supportWhatsappInput = document.getElementById("setting-support-whatsapp");
  const topupEnabledInput = document.getElementById("setting-topup-enabled");
  const marketplaceEnabledInput = document.getElementById("setting-marketplace-enabled");
  const maintenanceModeInput = document.getElementById("setting-maintenance-mode");

  const nextSettings = {
    supportWhatsapp: normalizeString(supportWhatsappInput?.value, defaultSiteSettings.supportWhatsapp),
    topupEnabled: Boolean(topupEnabledInput?.checked),
    marketplaceEnabled: Boolean(marketplaceEnabledInput?.checked),
    maintenanceMode: Boolean(maintenanceModeInput?.checked),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  };

  try {
    await setDoc(doc(db, "settings", "public"), nextSettings, { merge: true });
    siteSettings = { ...siteSettings, ...nextSettings };
    populateAdminSettingsForm();
    applySiteSettings();
    window.showToast("Site settings saved ✅");
  } catch (err) {
    console.error("SAVE SITE SETTINGS ERROR:", err);
    alert("Could not save site settings: " + err.message);
  }
};

async function loadMarketplaceListings() {
  const marketplaceGrid = document.getElementById("marketplace-grid");
  const featuredGrid = document.getElementById("featured-grid");
  const homeGrid = document.getElementById("home-featured-grid");
  if (!marketplaceGrid && !featuredGrid && !homeGrid) return;
  if (marketplaceLoadPromise) return marketplaceLoadPromise;

  const targets = [marketplaceGrid, featuredGrid, homeGrid].filter(Boolean);
  targets.forEach((grid) => {
    if (!allListings.length) {
      grid.replaceChildren();
      const loading = document.createElement("p");
      loading.textContent = "Loading approved accounts…";
      grid.appendChild(loading);
    }
  });

  marketplaceLoadPromise = (async () => {
    try {
      const listingsQuery = query(collection(db, "listings"), where("status", "==", "approved"));
      const snapshot = await getDocs(listingsQuery);
      allListings = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderMarketplaceListings();
    } catch (err) {
      console.error("LOAD MARKETPLACE LISTINGS ERROR:", err);
      allListings = [];
      [marketplaceGrid, featuredGrid, homeGrid].filter(Boolean).forEach((grid) => {
        grid.replaceChildren();
        const message = document.createElement("p");
        message.textContent = "Unable to load listings. Please refresh and try again.";
        grid.appendChild(message);
      });
    } finally {
      marketplaceLoadPromise = null;
    }
  })();
  return marketplaceLoadPromise;
}

function initializeMarketplaceControls() {
  const controls = document.getElementById("marketplace-controls");
  const featuredSection = document.getElementById("featured-section");

  if (controls && isMarketplaceAvailable()) {
    controls.classList.remove("hidden");
  }

  if (featuredSection && isMarketplaceAvailable()) {
    featuredSection.classList.remove("hidden");
  }

  if (controls?.dataset.listenersBound === "true") return;

  ["marketplace-search", "game-filter", "region-filter", "price-filter", "rank-filter", "sort-filter"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener(id === "marketplace-search" ? "input" : "change", renderMarketplaceListings);
    }
  });

  document.getElementById("clear-filters")?.addEventListener("click", () => {
    ["marketplace-search", "game-filter", "region-filter", "price-filter", "rank-filter", "sort-filter"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.value = id === "sort-filter" ? "newest" : "";
    });
    renderMarketplaceListings();
  });

  if (controls) controls.dataset.listenersBound = "true";
}

window.viewAccountListing = (listingId) => {
  const listing = getListingById(listingId);
  const modal = ensureModalShell("account-detail-modal", "Account details", "account-detail-content", "", "", window.closeAccountDetails);
  const content = document.getElementById("account-detail-content");

  if (!listing || !modal || !content) return;

  selectedAccountListing = listing;
  content.replaceChildren();

  const title = document.createElement("h2");
  const details = document.createElement("div");
  const description = document.createElement("p");
  const price = document.createElement("h2");
  const buyButton = document.createElement("button");

  title.textContent = listing.title || "Gaming Account";
  details.className = "account-detail-grid";
  [["Game", getGame(getListingGameId(listing)).name], ["Region", listing.region], ["Rank", listing.rank], ["Level", listing.level], ["Availability", listing.status === "approved" ? "Available" : listing.status]].forEach(([label, value]) => {
    const item = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    item.append(strong, ` ${value || "N/A"}`);
    details.appendChild(item);
  });

  description.textContent = listing.description || "No description provided.";
  price.textContent = formatNaira(listing.price);
  buyButton.type = "button";
  buyButton.className = "primary-btn full-btn";
  buyButton.textContent = "BUY ACCOUNT";
  buyButton.addEventListener("click", () => window.openAccountPurchase(listing.id));

  content.append(title, createListingImageGallery(listing), details, description, price, buyButton);
  modal.classList.remove("hidden");
  modal.querySelector(".close-btn")?.focus();
};

window.closeAccountDetails = () => {
  const modal = document.getElementById("account-detail-modal");

  if (modal) {
    modal.classList.add("hidden");
  }
};

window.openAccountPurchase = async (listingId) => {
  await ensureSiteSettingsLoaded();
  if (!isMarketplaceAvailable()) {
    window.showToast("Marketplace purchases are temporarily unavailable.");
    return;
  }
  const user = auth.currentUser;
  if (!user) {
    window.showToast("Please log in to continue.");
    return;
  }
  const listing = getListingById(listingId);
  if (!listing || !isListingApproved(listing)) {
    window.showToast("This account is no longer available.");
    return;
  }
  selectedAccountListing = listing;
  const modal = ensureModalShell(
    "account-purchase-modal",
    "Contact Technical Support",
    "account-purchase-summary",
    "account-purchase-confirm-button",
    "CONTACT TECHNICAL SUPPORT",
    window.closeAccountPurchase
  );
  const summary = document.getElementById("account-purchase-summary");
  if (!modal || !summary) return;

  summary.replaceChildren();
  [
    ["Listing ID", listing.id],
    ["Game", getGame(getListingGameId(listing)).name],
    ["Account", listing.title || "Gaming Account"],
    ["Advertised price", formatNaira(listing.price)]
  ].forEach(([label, value]) => {
    const row = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(String(value)));
    summary.appendChild(row);
  });
  const disclaimer = document.createElement("div");
  disclaimer.className = "purchase-disclaimer";
  const disclaimerHeading = document.createElement("strong");
  disclaimerHeading.textContent = "Before you continue";
  const disclaimerText = document.createElement("p");
  disclaimerText.textContent = "Savage Store Technical Support assists with the transaction. Do not pay an unverified seller directly. Seller login credentials are not shown here; payment and transfer status are handled through Technical Support. After receiving access, change the password, secure the account, review linked accounts and recovery methods, and sign out active sessions. Game publishers may prohibit account trading.";
  disclaimer.append(disclaimerHeading, disclaimerText);
  if (!modal.querySelector(".purchase-disclaimer-copy")) summary.appendChild(disclaimer);
  const supportMessage = [
    "SAVAGE STORE ACCOUNT PURCHASE REQUEST",
    `Listing ID: ${listing.id}`,
    `Game: ${getGame(getListingGameId(listing)).name}`,
    `Account: ${listing.title || "Gaming Account"}`,
    `Advertised price: ${formatNaira(listing.price)}`,
    "Please confirm availability and assist with the account transaction."
  ].join("\n");
  const supportLink = document.getElementById("account-purchase-confirm-button");
  if (supportLink) {
    supportLink.href = `https://wa.me/${getSupportWhatsappNumber()}?text=${encodeURIComponent(supportMessage)}`;
    supportLink.target = "_blank";
    supportLink.rel = "noopener noreferrer";
  }
  window.closeAccountDetails();
  modal.classList.remove("hidden");
  document.getElementById("account-purchase-confirm-button")?.focus();
};

window.closeAccountPurchase = () => {
  document.getElementById("account-purchase-modal")?.classList.add("hidden");
};

function appendListingField(card, label, value) {
  appendOrderField(card, label, value || "N/A");
}

function createAdminListingCard(listing) {
  const card = document.createElement("div");
  const title = document.createElement("h3");
  const image = document.createElement("img");
  const actions = document.createElement("div");
  const approveButton = document.createElement("button");
  const rejectButton = document.createElement("button");
  const removeButton = document.createElement("button");

  card.className = "order-card";
  title.textContent = listing.title || "No Listing Title";
  card.appendChild(title);

  image.src = getListingImage(listing);
  image.alt = listing.title || "Listing screenshot";
  image.style.maxWidth = "180px";
  image.style.borderRadius = "12px";
  card.appendChild(image);

  appendListingField(card, "Game", getGame(getListingGameId(listing)).name);
  appendListingField(card, "Seller", listing.sellerName);
  appendListingField(card, "Region", listing.region);
  appendListingField(card, "Level", listing.level);
  appendListingField(card, "Rank", listing.rank);
  appendListingField(card, "Price", `₦${Number(listing.price || 0).toLocaleString()}`);
  appendListingField(card, "Status", listing.status);
  appendListingField(card, "Date", formatDate(listing.createdAt));
  appendListingField(card, "Description", listing.description);

  const contactButton = document.createElement("button");
  contactButton.type = "button";
  contactButton.className = "secondary-btn reveal-contact-button";
  contactButton.textContent = "REVEAL PRIVATE SELLER CONTACT";
  contactButton.addEventListener("click", async () => {
    if (contactButton.dataset.loaded === "true") return;
    contactButton.disabled = true;
    try {
      const readContact = httpsCallable(functions, "getAdminListingContact");
      const result = await readContact({ listingId: listing.id });
      appendListingField(card, "Seller email (private)", result.data.sellerEmail || "Not provided");
      appendListingField(card, "Seller contact (private)", result.data.contact || "Not provided");
      contactButton.dataset.loaded = "true";
      contactButton.textContent = "PRIVATE CONTACT REVEALED · ACCESS LOGGED";
    } catch (err) {
      console.error("ADMIN SELLER CONTACT LOAD ERROR:", err);
      window.showToast("Private seller contact could not be loaded.");
    } finally {
      contactButton.disabled = false;
    }
  });
  card.appendChild(contactButton);

  if (listing.image1 || listing.image2 || listing.image3) {
    appendListingField(
      card,
      "Screenshots",
      [listing.image1, listing.image2, listing.image3].filter(Boolean).join(" | ")
    );
  }

  actions.className = "admin-controls";
  approveButton.type = "button";
  approveButton.textContent = "APPROVE";
  approveButton.disabled = listing.status !== "pending-review" && listing.status !== "rejected";
  approveButton.addEventListener("click", () => window.approveListing(listing.id));

  rejectButton.type = "button";
  rejectButton.textContent = "REJECT";
  rejectButton.disabled = listing.status === "sold" || listing.status === "removed";
  rejectButton.addEventListener("click", () => window.rejectListing(listing.id));

  removeButton.type = "button";
  removeButton.textContent = "REMOVE";
  removeButton.className = "danger-btn";
  removeButton.disabled = listing.status === "sold";
  removeButton.addEventListener("click", () => window.removeListing(listing.id));

  actions.append(approveButton, rejectButton, removeButton);
  card.appendChild(actions);

  return card;
}

async function loadAdminListings() {
  const listingsList = document.getElementById("admin-listings-list") || document.getElementById("listings-list");

  if (!listingsList || !currentUserIsAdmin) return;

  try {
    const listingsQuery = query(
      collection(db, "listings"),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(listingsQuery);
    const listings = [];

    snapshot.forEach((docSnap) => {
      listings.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    listingsList.replaceChildren();

    if (!listings.length) {
      const emptyMessage = document.createElement("p");

      emptyMessage.textContent = "No listings submitted yet.";
      listingsList.appendChild(emptyMessage);
      return;
    }

    listings.forEach((listing) => {
      listingsList.appendChild(createAdminListingCard(listing));
    });
  } catch (err) {
    console.error("LOAD ADMIN LISTINGS ERROR:", err);
    listingsList.replaceChildren();

    const errorMessage = document.createElement("p");

    errorMessage.textContent = "Could not load listings.";
    listingsList.appendChild(errorMessage);
  }
}

window.approveListing = async (listingId) => {
  if (!auth.currentUser || !currentUserIsAdmin) {
    alert("Admin access required.");
    return;
  }

  try {
    await updateDoc(doc(db, "listings", listingId), {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    });

    window.showToast("Listing approved ✅");
    loadAdminListings();
    loadMarketplaceListings();
  } catch (err) {
    console.error("APPROVE LISTING ERROR:", err);
    alert("Could not approve listing: " + err.message);
  }
};

window.rejectListing = async (listingId) => {
  if (!auth.currentUser || !currentUserIsAdmin) {
    alert("Admin access required.");
    return;
  }

  try {
    await updateDoc(doc(db, "listings", listingId), {
      status: "rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    });

    window.showToast("Listing rejected ✅");
    loadAdminListings();
  } catch (err) {
    console.error("REJECT LISTING ERROR:", err);
    alert("Could not reject listing: " + err.message);
  }
};

window.removeListing = async (listingId) => {
  if (!auth.currentUser || !currentUserIsAdmin) {
    alert("Admin access required.");
    return;
  }

  if (!confirm("Remove this listing from marketplace/admin review?")) {
    return;
  }

  try {
    await updateDoc(doc(db, "listings", listingId), {
      status: "removed",
      removedAt: serverTimestamp(),
      removedBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    });

    window.showToast("Listing removed ✅");
    loadAdminListings();
    loadMarketplaceListings();
  } catch (err) {
    console.error("REMOVE LISTING ERROR:", err);
    alert("Could not remove listing: " + err.message);
  }
};


async function loadAdminOrders() {
  const ordersList = document.getElementById("orders-list");
  const searchInput = document.getElementById("search-orders");
  const statusFilter = document.getElementById("status-filter");
  const orderTypeFilter = document.getElementById("order-type-filter");
  const gameFilter = document.getElementById("admin-game-filter");

  if (!ordersList) return;

  try {
    const ordersQuery = query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(ordersQuery);

    let orders = [];

    snapshot.forEach((docSnap) => {
      orders.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    const totalOrders = document.getElementById("total-orders");
    const totalRevenue = document.getElementById("total-revenue");
    const pendingOrders = document.getElementById("pending-orders");

    setElementText(totalOrders, orders.length);

    const revenue = orders.reduce((sum, order) => {
      const confirmed = order.paymentStatus === "paid" || (!order.orderType && order.status === "delivered");
      return sum + (confirmed ? Number(order.price || 0) : 0);
    }, 0);

    setElementText(totalRevenue, `₦${revenue.toLocaleString()}`);

    const pending = orders.filter((order) => {
      return order.status === "processing";
    }).length;

    setElementText(pendingOrders, pending);

    function renderOrders() {
      const search = searchInput ? searchInput.value.toLowerCase() : "";
      const status = statusFilter ? statusFilter.value : "all";
      const orderType = orderTypeFilter ? orderTypeFilter.value : "all";
      const gameId = gameFilter ? gameFilter.value : "all";

      const filtered = orders.filter((order) => {
        const matchesSearch =
          (order.orderId || "").toLowerCase().includes(search) ||
          (order.customerEmail || "").toLowerCase().includes(search) ||
          (order.gameUID || "").toLowerCase().includes(search) ||
          (order.item || "").toLowerCase().includes(search) ||
          (order.listingId || "").toLowerCase().includes(search);

        const matchesStatus =
          status === "all" || order.status === status;
        const matchesOrderType =
          orderType === "all" || (order.orderType || "topup") === orderType;

        const matchesGame = gameId === "all" || getOrderGameId(order) === gameId;
        return matchesSearch && matchesStatus && matchesOrderType && matchesGame;
      });

      ordersList.replaceChildren();

      if (!filtered.length) {
        const emptyMessage = document.createElement("p");

        emptyMessage.textContent = "No matching orders.";
        ordersList.appendChild(emptyMessage);
        return;
      }

      filtered.forEach((order) => {
        ordersList.appendChild(createOrderCard(order, {
          showCustomerDetails: true,
          showPaymentProof: true,
          showStatusControl: true
        }));
      });
    }

    renderOrders();

    if (ordersList.dataset.listenersBound !== "true") {
      if (searchInput) {
        searchInput.addEventListener("input", renderOrders);
      }

      if (statusFilter) {
        statusFilter.addEventListener("change", renderOrders);
      }

      if (orderTypeFilter) {
        orderTypeFilter.addEventListener("change", renderOrders);
      }
      if (gameFilter) {
        gameFilter.addEventListener("change", renderOrders);
      }

      ordersList.dataset.listenersBound = "true";
    }

  } catch (err) {
    console.error("LOAD ORDERS ERROR:", err);
    ordersList.replaceChildren();

    const errorMessage = document.createElement("p");

    errorMessage.textContent = "Could not load orders.";
    ordersList.appendChild(errorMessage);
  }
}

window.updateOrderStatus = async (orderDocId, newStatus) => {
  const user = auth.currentUser;
  const allowedStatuses = ["processing", "delivered", "failed"];

  if (!user || !(await checkAdminAccess(user))) {
    alert("Admin access required.");
    return;
  }

  if (!allowedStatuses.includes(newStatus)) {
    alert("Invalid order status.");
    return;
  }

  try {
    window.showToast("Updating order status...");

    const orderRef = doc(db, "orders", orderDocId);
    const existingOrderSnap = await getDoc(orderRef);
    const existingOrder = existingOrderSnap.exists()
      ? existingOrderSnap.data()
      : null;
    const receiptAlreadySent = Boolean(existingOrder?.deliveryReceiptSent);

    if (existingOrder?.orderType === "topup") {
      const updateTopupStatus = httpsCallable(functions, "updateTopupOrderStatus");
      await updateTopupStatus({ orderId: orderDocId, status: newStatus });
    } else {
      await updateDoc(orderRef, {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    }

    window.showToast(`Order marked as ${newStatus} ✅`);

    if (newStatus === "delivered" && !receiptAlreadySent) {
      const orderSnap = await getDoc(orderRef);

      if (orderSnap.exists()) {
        const deliveredEmailSent = await sendDeliveredReceiptEmail(orderSnap.data());

        if (deliveredEmailSent) {
          await updateDoc(orderRef, {
            deliveryReceiptSent: true,
            deliveryReceiptSentAt: serverTimestamp()
          });

          showToast("Delivered receipt sent ✅");
        } else {
          showToast("Order delivered, but receipt email could not be sent ⚠️");
        }
      } else {
        showToast("Order delivered, but order data could not be found ⚠️");
      }

    }

    loadAdminOrders();

  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);

    alert(
      "Could not update status:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
  }
};

async function loadUserOrders(userId) {
  const historySection = document.getElementById("history-section");
  const historyList = document.getElementById("history-list");

  if (!historySection || !historyList) return;

  historySection.classList.remove("hidden");

  try {
    const ordersQuery = query(
      collection(db, "orders"),
      where("userId", "==", userId)
    );

    const snapshot = await getDocs(ordersQuery);

    let userOrders = [];

    snapshot.forEach((docSnap) => {
      userOrders.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    historyList.replaceChildren();

    userOrders.sort((firstOrder, secondOrder) => {
      const firstCreatedAt = firstOrder.createdAt?.toMillis?.() || 0;
      const secondCreatedAt = secondOrder.createdAt?.toMillis?.() || 0;

      return secondCreatedAt - firstCreatedAt;
    });

    if (!userOrders.length) {
      const emptyMessage = document.createElement("p");

      emptyMessage.textContent = "No orders yet.";
      historyList.appendChild(emptyMessage);
      return;
    }

    userOrders.forEach((order) => {
      historyList.appendChild(createOrderCard(order));
    });

  } catch (err) {
    console.error("LOAD USER ORDERS ERROR:", err);
    historyList.replaceChildren();

    const errorMessage = document.createElement("p");

    errorMessage.textContent = "Could not load history.";
    historyList.appendChild(errorMessage);
  }
}

async function loadMySwaps(userId) {
  const list = document.getElementById("my-swaps-list");
  if (!list || !userId) return;
  list.replaceChildren();
  list.textContent = "Loading your swap requests…";
  try {
    const snapshot = await getDocs(query(collection(db, "accountSwaps"), where("ownerId", "==", userId)));
    list.replaceChildren();
    if (snapshot.empty) {
      list.textContent = "You have no account swap requests.";
      return;
    }
    snapshot.forEach((swapDoc) => {
      const swap = swapDoc.data();
      const card = document.createElement("article");
      const title = document.createElement("h3");
      card.className = "order-card";
      title.textContent = `${getGame(swap.gameId).name} · ${swap.uid || "UID unavailable"}`;
      card.appendChild(title);
      appendOrderField(card, "Status", swap.status || "pending-review");
      appendOrderField(card, "Submitted", formatDate(swap.submittedAt));
      appendOrderField(card, "Requested swap", swap.desiredSwapDetails || "N/A");
      list.appendChild(card);
    });
  } catch (err) {
    console.error("MY SWAPS LOAD ERROR:", err);
    list.textContent = "Unable to load your swap requests. Please refresh and try again.";
  }
}

async function loadMySales(userId) {
  const list = document.getElementById("my-sales-list");
  if (!list || !userId) return;
  list.replaceChildren();
  list.textContent = "Loading your account sales…";
  try {
    const [sellerSnapshot, buyerSnapshot] = await Promise.all([
      getDocs(query(collection(db, "accountSales"), where("sellerId", "==", userId))),
      getDocs(query(collection(db, "accountSales"), where("buyerId", "==", userId)))
    ]);
    const sales = new Map();
    [sellerSnapshot, buyerSnapshot].forEach((snapshot) => snapshot.forEach((saleDoc) => sales.set(saleDoc.id, saleDoc.data())));
    list.replaceChildren();
    if (!sales.size) {
      list.textContent = "You have no recorded account sales.";
      return;
    }
    sales.forEach((sale) => {
      const card = document.createElement("article");
      const title = document.createElement("h3");
      card.className = "order-card";
      title.textContent = `${getGame(sale.gameId).name} · ${sale.saleId || sale.listingId}`;
      card.appendChild(title);
      appendOrderField(card, "Role", sale.sellerId === userId ? "Seller" : "Buyer");
      appendOrderField(card, "Sale status", sale.transferStatus || "pending");
      if (sale.sellerId === userId) {
        appendOrderField(card, "Final sale price", formatNaira(sale.finalSalePrice));
        appendOrderField(card, "Marketplace fee", sale.feeApplied ? formatNaira(sale.marketplaceFee) : "Applied on completed sales");
        appendOrderField(card, "Seller proceeds", sale.feeApplied ? formatNaira(sale.sellerProceeds) : "Pending transfer completion");
        appendOrderField(card, "Payout status", sale.sellerPayoutStatus || "pending");
      }
      list.appendChild(card);
    });
  } catch (err) {
    console.error("MY ACCOUNT SALES LOAD ERROR:", err);
    list.textContent = "Unable to load your account sales. Please refresh and try again.";
  }
}

function createSellerListingCard(listing) {
  const card = document.createElement("div");
  const title = document.createElement("h3");

  card.className = "order-card";
  title.textContent = listing.title || "Gaming Account";
  card.appendChild(title);

  appendListingField(card, "Game", getGame(getListingGameId(listing)).name);
  appendListingField(card, "Price", formatNaira(listing.price));
  appendListingField(card, "Region", listing.region);
  appendListingField(card, "Rank", listing.rank);
  appendListingField(card, "Level", listing.level);
  appendListingField(card, "Status", listing.status);
  appendListingField(card, "Date", formatDate(listing.createdAt));

  if (listing.status === "pending-review") {
    const cancelButton = document.createElement("button");

    cancelButton.type = "button";
    cancelButton.className = "secondary-btn full-btn";
    cancelButton.textContent = "CANCEL PENDING LISTING";
    cancelButton.addEventListener("click", () => window.cancelSellerListing(listing.id));
    card.appendChild(cancelButton);
  }

  return card;
}

function updateSellerListingSummary(listings) {
  const summary = document.getElementById("seller-listing-summary");

  if (!summary) return;

  const counts = {
    "pending-review": 0,
    approved: 0,
    sold: 0,
    rejected: 0
  };

  listings.forEach((listing) => {
    if (Object.prototype.hasOwnProperty.call(counts, listing.status)) {
      counts[listing.status] += 1;
    }
  });

  const values = [
    counts["pending-review"],
    counts.approved,
    counts.sold,
    counts.rejected
  ];

  summary.querySelectorAll("h3").forEach((heading, index) => {
    heading.textContent = values[index] || 0;
  });
}

async function loadSellerListings(userId) {
  const sellerList = document.getElementById("seller-listings-list");

  if (!sellerList) return;

  try {
    const listingsQuery = query(
      collection(db, "listings"),
      where("sellerId", "==", userId)
    );
    const snapshot = await getDocs(listingsQuery);
    const listings = [];

    snapshot.forEach((docSnap) => {
      listings.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    listings.sort((first, second) => {
      const firstCreatedAt = first.createdAt?.toMillis?.() || 0;
      const secondCreatedAt = second.createdAt?.toMillis?.() || 0;

      return secondCreatedAt - firstCreatedAt;
    });

    updateSellerListingSummary(listings);
    sellerList.replaceChildren();

    if (!listings.length) {
      const emptyMessage = document.createElement("p");

      emptyMessage.textContent = "You have not submitted any listings yet.";
      sellerList.appendChild(emptyMessage);
      return;
    }

    listings.forEach((listing) => {
      sellerList.appendChild(createSellerListingCard(listing));
    });
  } catch (err) {
    console.error("LOAD SELLER LISTINGS ERROR:", err);
    sellerList.replaceChildren();

    const errorMessage = document.createElement("p");

    errorMessage.textContent = "Could not load your listings.";
    sellerList.appendChild(errorMessage);
  }
}

window.cancelSellerListing = async (listingId) => {
  const user = auth.currentUser;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  if (!confirm("Cancel this pending listing?")) {
    return;
  }

  try {
    const listingRef = doc(db, "listings", listingId);
    const listingSnap = await getDoc(listingRef);

    if (!listingSnap.exists()) {
      alert("Listing not found.");
      return;
    }

    const listing = listingSnap.data();

    if (listing.sellerId !== user.uid || listing.status !== "pending-review") {
      alert("Only your own pending listings can be cancelled.");
      return;
    }

    await updateDoc(listingRef, {
      status: "removed",
      removedAt: serverTimestamp(),
      removedBy: user.uid,
      updatedAt: serverTimestamp()
    });

    window.showToast("Pending listing cancelled ✅");
    loadSellerListings(user.uid);
  } catch (err) {
    console.error("CANCEL SELLER LISTING ERROR:", err);
    alert("Could not cancel listing: " + err.message);
  }
};


function unlockTopupForUser(user) {
  const diamonds = document.getElementById("diamonds");
  const diamondGrid = document.getElementById("diamond-grid");
  const loginRequiredBox = document.getElementById("login-required-box");

  if (diamonds) {
    diamonds.classList.remove("hidden");
  }

  if (diamondGrid && isTopupAvailable()) {
    diamondGrid.classList.remove("hidden");
  }

  if (loginRequiredBox) {
    loginRequiredBox.classList.add("hidden");
  }

  applySiteSettings();
}

function lockTopupForGuest() {
  const diamonds = document.getElementById("diamonds");
  const diamondGrid = document.getElementById("diamond-grid");
  const loginRequiredBox = document.getElementById("login-required-box");

  if (diamonds) {
    diamonds.classList.remove("hidden");
  }

  if (diamondGrid) {
    diamondGrid.classList.add("hidden");
  }

  if (loginRequiredBox) {
    loginRequiredBox.classList.remove("hidden");
  }

  applySiteSettings();
}

onAuthStateChanged(auth, async (user) => {
  try {
    await ensureSiteSettingsLoaded();
    const emailInput = document.getElementById("email");
    const adminDashboard = document.getElementById("admin-dashboard");
    const adminDenied = document.getElementById("admin-denied");
    const adminLink = document.getElementById("admin-link");
    const adminSettingsSection = document.getElementById("admin-settings-section");
    const adminListingsSection = document.getElementById("admin-listings-section");
    const adminSwapsSection = document.getElementById("admin-swaps-section");
    const adminSalesSection = document.getElementById("admin-sales-section");
    const historySection = document.getElementById("history-section");
    const ordersLoginBox = document.getElementById("orders-login-box");
    const sellLoginBox = document.getElementById("sell-login-box");
    const sellerFormBox = document.getElementById("seller-form-box");
    const sellerDashboardSection = document.getElementById("seller-dashboard-section");
    const marketplaceGrid = document.getElementById("marketplace-grid");
    const marketplaceLoginBox = document.getElementById("marketplace-login-box");
    const heroLoginBtn = document.getElementById("hero-login-btn");
    const heroCardMessage = document.getElementById("hero-card-message");
    const heroCardStatus = document.getElementById("hero-card-status");
    const heroCardBtn = document.getElementById("hero-card-btn");

    if (user) {
      currentUserIsAdmin = await checkAdminAccess(user);
      setNavigationAccountState(user);
      if (emailInput) emailInput.value = user.email || "";
      heroLoginBtn?.classList.add("hidden");
      setElementText(heroCardMessage, "Choose a game and view current top-up packages.");
      setElementText(heroCardStatus, "Ready to Top Up");
      if (heroCardBtn) {
        heroCardBtn.textContent = "VIEW PACKAGES";
        heroCardBtn.onclick = () => scrollToSection("diamonds");
      }
      sellLoginBox?.classList.add("hidden");
      sellerFormBox?.classList.remove("hidden");
      if (sellerDashboardSection) {
        sellerDashboardSection.classList.remove("hidden");
        loadSellerListings(user.uid);
      }
      ordersLoginBox?.classList.add("hidden");
      historySection?.classList.remove("hidden");
      marketplaceGrid?.classList.remove("hidden");
      marketplaceLoginBox?.classList.add("hidden");
      unlockTopupForUser(user);
      initializeMarketplaceControls();
      if (isMarketplaceAvailable()) loadMarketplaceListings();
      if (document.getElementById("diamond-grid") && isTopupAvailable()) loadTopupCatalog(selectedGameId);
      try {
        await saveUser(user);
      } catch (profileError) {
        console.error("AUTH PROFILE SAVE ERROR:", profileError);
      }
      try {
        await loadProfile(user);
      } catch (profileError) {
        console.error("PROFILE LOAD ERROR:", profileError);
        window.showToast("You are signed in, but your profile could not be loaded.");
      }
      loadUserOrders(user.uid);
      loadMySwaps(user.uid);
      loadMySales(user.uid);

      const isAdmin = currentUserIsAdmin;
      adminLink?.classList.toggle("hidden", !isAdmin);
      if (adminLink) adminLink.style.display = isAdmin ? "" : "none";
      adminDashboard?.classList.toggle("hidden", !isAdmin);
      adminSettingsSection?.classList.toggle("hidden", !isAdmin);
      adminListingsSection?.classList.toggle("hidden", !isAdmin);
      adminSwapsSection?.classList.toggle("hidden", !isAdmin);
      adminSalesSection?.classList.toggle("hidden", !isAdmin);
      adminDenied?.classList.toggle("hidden", isAdmin);
      if (isAdmin) {
        populateAdminSettingsForm();
        loadAdminOrders();
        loadAdminListings();
        loadAdminSwaps();
        loadAdminSales();
      }
    } else {
      currentUserIsAdmin = false;
      setNavigationAccountState(null);
      heroLoginBtn?.classList.remove("hidden");
      setElementText(heroCardMessage, "Log in to view and order current top-up packages.");
      setElementText(heroCardStatus, "Login Required");
      if (heroCardBtn) {
        heroCardBtn.textContent = "GET STARTED";
        heroCardBtn.onclick = window.signInWithGoogle;
      }
      sellLoginBox?.classList.remove("hidden");
      sellerFormBox?.classList.add("hidden");
      sellerDashboardSection?.classList.add("hidden");
      historySection?.classList.add("hidden");
      ordersLoginBox?.classList.remove("hidden");
      marketplaceGrid?.classList.remove("hidden");
      marketplaceLoginBox?.classList.add("hidden");
      lockTopupForGuest();
      adminDashboard?.classList.add("hidden");
      adminSettingsSection?.classList.add("hidden");
      adminListingsSection?.classList.add("hidden");
      adminSwapsSection?.classList.add("hidden");
      adminSalesSection?.classList.add("hidden");
      adminDenied?.classList.remove("hidden");
      if (adminLink) adminLink.style.display = "none";
    }

    initializeMarketplaceControls();
    if (isMarketplaceAvailable()) loadMarketplaceListings();
    applySiteSettings();
  } catch (err) {
    console.error("AUTH STATE HANDLER ERROR:", err);
    window.showToast("Your sign-in state loaded, but some page features could not be refreshed.");
  }
});

async function loadTopupCatalog(gameId) {
  const grid = document.getElementById("diamond-grid");
  if (!grid) return;
  const user = auth.currentUser;
  if (!user) return;
  if (!isTopupAvailable()) {
    grid.replaceChildren();
    return;
  }
  const existingRequest = topupCatalogRequests.get(gameId);
  if (existingRequest) return existingRequest;

  grid.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "catalog-message";
  loading.textContent = `Loading ${getGame(gameId).currency} packages…`;
  grid.appendChild(loading);

  const request = (async () => {
    try {
      const getCatalog = httpsCallable(functions, "getTopupCatalog");
      const response = await getCatalog({ gameId });
      if (selectedGameId !== gameId) return;
      const offers = Array.isArray(response.data?.offers) ? response.data.offers : [];
      grid.replaceChildren();
      if (!offers.length) {
        const empty = document.createElement("p");
        empty.className = "catalog-message";
        empty.textContent = `No ${getGame(gameId).currency} packages are available right now.`;
        grid.appendChild(empty);
        return;
      }
      offers.forEach((offer) => {
        const price = Number(offer.price);
        if (!offer.id || !Number.isFinite(price) || price <= 0 || typeof offer.name !== "string") return;
        const card = document.createElement("article");
        const title = document.createElement("h3");
        const priceLabel = document.createElement("p");
        const button = document.createElement("button");
        card.className = "diamond-card catalog-product";
        title.textContent = offer.name;
        priceLabel.className = "price";
        priceLabel.textContent = formatNaira(price);
        button.type = "button";
        button.className = "primary-btn";
        button.textContent = "CONTINUE TO SECURE CHECKOUT";
        button.addEventListener("click", () => window.openOrderModal(offer.name, price, String(offer.id), gameId, offer.fields));
        card.append(title, priceLabel, button);
        grid.appendChild(card);
      });
      if (!grid.childElementCount) {
        const unavailable = document.createElement("p");
        unavailable.className = "catalog-message";
        unavailable.textContent = "Top-up packages could not be displayed. Please refresh and try again.";
        grid.appendChild(unavailable);
      }
    } catch (err) {
      console.error("TOP-UP CATALOG ERROR:", err);
      if (selectedGameId === gameId) {
        grid.replaceChildren();
        const message = document.createElement("p");
        message.className = "catalog-message";
        message.textContent = "Unable to load packages. Please refresh and try again.";
        grid.appendChild(message);
      }
    } finally {
      topupCatalogRequests.delete(gameId);
    }
  })();
  topupCatalogRequests.set(gameId, request);
  return request;
}

function renderTopupPlayerFields(fields) {
  const container = document.getElementById("game-fields-container");
  if (!container) return;
  container.replaceChildren();
  const schema = Array.isArray(fields) ? fields : [];
  schema.forEach((field, index) => {
    if (!field?.key || !field?.label) return;
    const label = document.createElement("label");
    const input = document.createElement("input");
    const inputId = `game-player-field-${index}`;
    label.htmlFor = inputId;
    label.textContent = field.required === false ? field.label : `${field.label} *`;
    input.id = inputId;
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = 120;
    input.dataset.providerField = field.key;
    input.required = field.required !== false;
    input.placeholder = field.label;
    container.append(label, input);
  });
  container.querySelector("input")?.setAttribute("aria-describedby", "game-fields-help");
}

window.openOrderModal = async (item, price, offerId, gameId = selectedGameId, fields = []) => {
  await ensureSiteSettingsLoaded();
  if (!isTopupAvailable()) {
    window.showToast("Game top-ups are temporarily unavailable.");
    return;
  }
  if (!auth.currentUser) {
    window.showToast("Please log in to continue.");
    return;
  }
  const amount = Number(price);
  if (!offerId || !GAMES[gameId] || gameId !== selectedGameId || !Number.isFinite(amount) || amount <= 0) {
    window.showToast("Choose a current package for the selected game.");
    return;
  }
  const schema = Array.isArray(fields) ? fields : [];
  if (!schema.length) {
    window.showToast("The supplier has not provided the required player fields for this package.");
    return;
  }
  currentOrder = { item: String(item), price: amount, gameId, offerId: String(offerId), fields: schema, orderId: "" };
  renderTopupPlayerFields(schema);
  const summary = document.getElementById("order-summary");
  if (summary) {
    const itemSummary = document.createElement("strong");
    itemSummary.textContent = String(item);
    summary.replaceChildren(itemSummary, document.createElement("br"), document.createElement("br"), `Current price: ${formatNaira(amount)}. Final amount is confirmed by Savage Store's secure server.`);
  }
  const emailInput = document.getElementById("email");
  if (emailInput) emailInput.value = auth.currentUser.email || "";
  const modal = ensureModalShell("order-modal", "Complete your order", "order-summary", "", "", window.closeModal);
  modal.classList.remove("hidden");
  document.querySelector("#game-fields-container input")?.focus();
};

window.closeModal = () => document.getElementById("order-modal")?.classList.add("hidden");

window.openTopupPackageOrder = (button) => {
  const gameId = button?.dataset?.game || selectedGameId;
  let fields = [];
  try { fields = JSON.parse(button?.dataset?.fields || "[]"); } catch { /* Invalid static markup stays unavailable. */ }
  window.openOrderModal(button?.dataset?.item || "Game top-up", button?.dataset?.price, button?.dataset?.offerId, gameId, fields);
};

window.openDiamondPackageOrder = () => {
  window.showToast("Choose one of the current server-provided packages.");
};

window.generateOrderId = () => {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `SVG-${random.slice(0, 24).toUpperCase()}`;
};

window.completeOrder = async () => {
  await ensureSiteSettingsLoaded();
  const button = document.getElementById("complete-order-btn");
  if (button?.disabled) return;
  if (!isTopupAvailable()) {
    window.showToast("Game top-ups are temporarily unavailable.");
    return;
  }
  const user = auth.currentUser;
  if (!user) {
    window.showToast("Please log in to continue.");
    return;
  }
  const gameFields = Object.fromEntries([...document.querySelectorAll("#game-fields-container [data-provider-field]")]
    .map((input) => [input.dataset.providerField, input.value.trim()]));
  const primaryField = currentOrder.fields.find((field) => /^(player[_-]?id|user[_-]?id|uid)$/i.test(field.key)) || currentOrder.fields[0];
  const uid = primaryField ? gameFields[primaryField.key] || "" : "";
  const email = user.email || "";
  const missingRequiredField = currentOrder.fields.some((field) => field.required !== false && !gameFields[field.key]);
  if (missingRequiredField || !uid || !email || !currentOrder.offerId || currentOrder.gameId !== selectedGameId) {
    window.showToast("Complete the player details required for this package.");
    return;
  }

  if (button) button.disabled = true;
  try {
    currentOrder.orderId ||= window.generateOrderId();
    const orderRef = doc(db, "orders", currentOrder.orderId);
    const existingOrder = await getDoc(orderRef);
    if (!existingOrder.exists()) {
      const orderData = {
        orderId: currentOrder.orderId,
        orderType: "topup",
        gameId: currentOrder.gameId,
        userId: user.uid,
        customerName: user.displayName || "Customer",
        customerEmail: email,
        googleEmail: email,
        gameUID: uid,
        supplierOfferId: currentOrder.offerId,
        item: currentOrder.item,
        price: currentOrder.price,
        paymentStatus: "pending",
        fulfillmentStatus: "pending",
        status: "processing",
        createdAt: serverTimestamp()
      };
      await setDoc(orderRef, orderData);
    } else if (existingOrder.data().userId !== user.uid || existingOrder.data().orderType !== "topup") {
      throw new Error("Order ID is already in use. Reopen the package and try again.");
    }

    const initializePayment = httpsCallable(functions, "initializePaystackPayment");
    const result = await initializePayment({ orderId: currentOrder.orderId, gameFields });
    const authorizationUrl = result.data?.authorizationUrl;
    if (!authorizationUrl) throw new Error("Secure checkout did not return a payment link.");

    const emailData = { orderId: currentOrder.orderId, userId: user.uid, customerName: user.displayName || "Customer", customerEmail: email, googleEmail: email, gameUID: uid, gameId: currentOrder.gameId, gameName: getGame(currentOrder.gameId).name, item: currentOrder.item, price: Number(result.data.amount || currentOrder.price), paymentStatus: "pending" };
    Promise.allSettled([sendCustomerConfirmationEmail(emailData), sendAdminOrderEmail(emailData)]);
    loadUserOrders(user.uid);
    window.location.assign(authorizationUrl);
  } catch (err) {
    console.error("SECURE TOP-UP CHECKOUT ERROR:", err);
    window.showToast("Secure checkout could not be started. Your order remains unpaid; retry or contact Technical Support.");
  } finally {
    if (button) button.disabled = false;
  }
};

function initializeTopupGameSelector() {
  const selectors = document.querySelectorAll("[data-game-select], .game-choice[data-game]");
  if (!selectors.length) return;
  selectors.forEach((button) => {
    button.addEventListener("click", () => setSelectedGame(button.dataset.gameSelect || button.dataset.game));
  });
  const requestedGame = new URLSearchParams(location.search).get("game");
  setSelectedGame(GAMES[requestedGame] ? requestedGame : "free-fire");
}
initializeTopupGameSelector();

window.toggleMobileMenu = () => {
  const nav = document.querySelector("header nav");
  if (nav) setMobileMenuOpen(!nav.classList.contains("active"));
};

window.submitCustomDiamond = () => {
  window.showToast("Custom Diamond Requests are not enabled until a server-priced provider product is available.");
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.closeModal();
    window.closeAccountPurchase();
    setMobileMenuOpen(false);
  }
});

window.addEventListener("scroll", () => {
  const header = document.querySelector("header");
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 40);
});
window.submitAccountListing = async () => {
  await ensureSiteSettingsLoaded();

  if (!isMarketplaceAvailable()) {
    alert(
      siteSettings.maintenanceMode
        ? "Seller submissions are disabled during maintenance."
        : "Marketplace is temporarily unavailable."
    );
    applySiteSettings();
    return;
  }

  const user = auth.currentUser;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  const gameId = document.getElementById("seller-game")?.value || "free-fire";
  const title = document.getElementById("seller-account-title").value.trim();
  const region = document.getElementById("seller-region").value.trim();
  const price = document.getElementById("seller-price").value.trim();
  const level = document.getElementById("seller-level").value.trim();
  const rank = document.getElementById("seller-rank").value.trim();
  const description = document.getElementById("seller-description").value.trim();
  const image1 = getValidImageUrl(document.getElementById("seller-image-1")?.value);
  const image2 = getValidImageUrl(document.getElementById("seller-image-2")?.value);
  const image3 = getValidImageUrl(document.getElementById("seller-image-3")?.value);
  const contact = document.getElementById("seller-contact").value.trim();
  const agreementAccepted = Boolean(document.getElementById("seller-agreement-accepted")?.checked);

  if (!title || !region || !price || !level || !rank || !description || !contact) {
    alert("Please fill all seller fields ⚡");
    return;
  }

  const numericPrice = Number(price);

  if (!Number.isInteger(numericPrice) || numericPrice <= 0) {
    alert("Price must be a positive whole number only ⚡");
    return;
  }
  if (!agreementAccepted) {
    window.showToast("Accept the Marketplace Seller Agreement before submitting.");
    return;
  }

  const submitButton = document.querySelector("#sell-mode-panel button[onclick='submitAccountListing()']");
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  try {
    window.showToast("Submitting listing for admin review…");
    const submitListing = httpsCallable(functions, "submitAccountListing");
    const result = await submitListing({
      gameId,
      title,
      region,
      price: numericPrice,
      level,
      rank,
      description,
      image1,
      image2,
      image3,
      contact,
      sellerAgreementAccepted: true,
      sellerAgreementVersion: "seller-v1-2026-10-24"
    });

    try {
      await sendEmail(
        {
          to_email: adminConfig.emails[0],
          user_email: adminConfig.emails[0],
          email: adminConfig.emails[0],
          reply_to: user.email,
          to_name: "Savage Store Admin",
          customer_name: user.displayName,
          order_item: `NEW ACCOUNT LISTING FOR REVIEW: ${title}`,
          item: `${title} · Listing ${result.data.listingId}`,
          uid: gameId,
          currency_symbol: "₦",
          price: numericPrice.toLocaleString()
        }
      );
    } catch (err) {
      console.error("LISTING EMAIL ERROR:", err);
      showToast("⚠️ Listing saved, but admin email could not be sent");
    }

    document.getElementById("seller-account-title").value = "";
    document.getElementById("seller-region").value = "";
    document.getElementById("seller-price").value = "";
    document.getElementById("seller-level").value = "";
    document.getElementById("seller-rank").value = "";
    document.getElementById("seller-description").value = "";
    document.getElementById("seller-image-1").value = "";
    document.getElementById("seller-image-2").value = "";
    document.getElementById("seller-image-3").value = "";
    document.getElementById("seller-contact").value = "";
    document.getElementById("seller-agreement-accepted").checked = false;

    window.showToast("Listing submitted for admin review.");
    loadSellerListings(user.uid);
  } catch (err) {
    console.error("LISTING SUBMIT ERROR:", err);
    window.showToast("Could not submit the listing. Please retry or contact Technical Support.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};

let swapLookupToken = null;

window.setSellPageMode = (mode) => {
  const sellMode = mode !== "swap";
  document.getElementById("sell-mode-panel")?.classList.toggle("hidden", !sellMode);
  document.getElementById("swap-mode-panel")?.classList.toggle("hidden", sellMode);
  const sellTab = document.getElementById("sell-mode-tab");
  const swapTab = document.getElementById("swap-mode-tab");
  sellTab?.classList.toggle("active", sellMode);
  swapTab?.classList.toggle("active", !sellMode);
  sellTab?.setAttribute("aria-selected", String(sellMode));
  swapTab?.setAttribute("aria-selected", String(!sellMode));
  if (!sellMode) window.updateSwapGameAvailability();
};

window.updateSwapGameAvailability = () => {
  const gameId = document.getElementById("swap-game")?.value || "free-fire";
  const result = document.getElementById("swap-profile-result");
  const uid = document.getElementById("swap-uid");
  const contact = document.getElementById("swap-contact");
  const supported = Boolean(GAMES[gameId]?.capabilities.accountSwap);
  swapLookupToken = null;
  if (uid) uid.value = "";
  if (contact && auth.currentUser && !contact.value) {
    getDoc(doc(db, "users", auth.currentUser.uid)).then((snapshot) => {
      if (contact) contact.value = snapshot.data()?.phone || "";
    }).catch((err) => console.error("SWAP PROFILE CONTACT LOAD ERROR:", err));
  }
  if (result) {
    result.replaceChildren();
    const message = document.createElement("p");
    message.textContent = supported
      ? "Enter the UID to check whether an authorized public profile provider is available."
      : `${getGame(gameId).name} account swaps are disabled because the publisher terms prohibit account trading or transfer.`;
    result.appendChild(message);
  }
  const lookupButton = document.getElementById("lookup-swap-profile");
  const submitButton = document.getElementById("submit-swap-request");
  if (lookupButton) lookupButton.disabled = !auth.currentUser;
  if (submitButton) submitButton.disabled = true;
};

window.lookupSwapProfile = async () => {
  const gameId = document.getElementById("swap-game")?.value || "free-fire";
  const uidInput = document.getElementById("swap-uid");
  const result = document.getElementById("swap-profile-result");
  if (!auth.currentUser) {
    window.showToast("Please log in to check a profile.");
    return;
  }
  const uid = uidInput?.value.trim() || "";
  const validUid = /^\d{1,32}$/.test(uid);
  if (!validUid) {
    window.showToast("Enter a numeric UID. Game-specific validation requires an authorized profile provider.");
    return;
  }
  const button = document.getElementById("lookup-swap-profile");
  if (button) button.disabled = true;
  swapLookupToken = null;
  if (result) result.textContent = "Checking for an authorized profile provider…";
  try {
    const lookup = httpsCallable(functions, "lookupGameProfile");
    const response = await lookup({ gameId, uid });
    if (!response.data?.available) {
      if (result) result.textContent = response.data?.message || "Automatic lookup is currently unavailable.";
      return;
    }
    swapLookupToken = response.data.lookupToken || null;
    const profile = response.data.profile || {};
    if (result) {
      result.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = "API-retrieved profile information";
      result.appendChild(heading);
      ["nickname", "uid", "level", "rank", "region", "guild"].forEach((field) => {
        if (profile[field] == null || profile[field] === "") return;
        const row = document.createElement("p");
        row.textContent = `${field[0].toUpperCase()}${field.slice(1)}: ${String(profile[field])}`;
        result.appendChild(row);
      });
      const fetched = document.createElement("small");
      fetched.textContent = `Retrieved ${response.data.fetchedAt || new Date().toISOString()}. UID lookup does not prove account ownership.`;
      result.appendChild(fetched);
    }
    const submitButton = document.getElementById("submit-swap-request");
    if (submitButton) submitButton.disabled = !swapLookupToken || !GAMES[gameId].capabilities.accountSwap;
  } catch (err) {
    console.error("SWAP UID LOOKUP ERROR:", err);
    if (result) result.textContent = err.code === "functions/resource-exhausted"
      ? "Too many lookup attempts. Please wait one minute and try again."
      : "Automatic lookup is unavailable. Savage Store has no approved profile API configured for this game.";
  } finally {
    if (button) button.disabled = false;
  }
};

window.submitAccountSwap = async () => {
  const gameId = document.getElementById("swap-game")?.value || "free-fire";
  if (!auth.currentUser) {
    window.showToast("Please log in to continue.");
    return;
  }
  if (!GAMES[gameId]?.capabilities.accountSwap) {
    window.showToast("Account swaps are disabled for this game under its publisher terms.");
    return;
  }
  if (!swapLookupToken || !document.getElementById("swap-agreement-accepted")?.checked) {
    window.showToast("Complete an authorized UID lookup and accept the swap notice first.");
    return;
  }
  try {
    const createSwap = httpsCallable(functions, "createAccountSwap");
    const response = await createSwap({
      gameId,
      uid: document.getElementById("swap-uid")?.value.trim(),
      region: document.getElementById("swap-region")?.value.trim() || "",
      desiredSwapDetails: document.getElementById("swap-desired")?.value.trim() || "",
      description: document.getElementById("swap-description")?.value.trim() || "",
      screenshots: [document.getElementById("swap-screenshots")?.value.trim()].filter(Boolean),
      cashDifference: Number(document.getElementById("swap-cash-difference")?.value || 0),
      agreementAccepted: true,
      agreementVersion: "swap-v1-2026-10-24",
      lookupToken: swapLookupToken
    });
    swapLookupToken = null;
    window.showToast(`Swap request ${response.data.swapId} sent for admin verification.`);
  } catch (err) {
    console.error("ACCOUNT SWAP SUBMISSION ERROR:", err);
    window.showToast("This swap request cannot be submitted under the selected game's current policy.");
  }
};

async function loadAdminSwaps() {
  const list = document.getElementById("admin-swaps-list");
  if (!list || !currentUserIsAdmin) return;
  list.replaceChildren();
  const loading = document.createElement("p");
  loading.textContent = "Loading account swap reviews…";
  list.appendChild(loading);
  try {
    const snapshot = await getDocs(collection(db, "accountSwaps"));
    list.replaceChildren();
    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.textContent = "No account swap requests are awaiting review.";
      list.appendChild(empty);
      return;
    }
    for (const swapDoc of snapshot.docs) {
      const swap = { id: swapDoc.id, ...swapDoc.data() };
      const secretSnapshot = await getDoc(doc(db, "accountSwapSecrets", swap.id));
      const swapSecret = secretSnapshot.exists() ? secretSnapshot.data() : {};
      const card = document.createElement("article");
      const title = document.createElement("h3");
      title.textContent = `${getGame(swap.gameId).name} · ${swap.uid || "No UID"}`;
      card.className = "order-card swap-review-card";
      card.appendChild(title);
      appendOrderField(card, "Owner ID", swap.ownerId || "N/A");
      appendOrderField(card, "Profile contact (private)", swapSecret.contact || "Not provided");
      appendOrderField(card, "Region", swap.region || "N/A");
      appendOrderField(card, "Requested swap", swap.desiredSwapDetails || "N/A");
      appendOrderField(card, "Status", swap.status || "pending-review");
      const profile = swap.publicProfileSnapshot || {};
      ["nickname", "level", "rank", "region"].forEach((field) => {
        if (profile[field] != null) appendOrderField(card, `API ${field}`, String(profile[field]));
      });
      (swap.screenshots || []).forEach((url, index) => {
        const link = document.createElement("a");
        link.href = getValidImageUrl(url) || "#";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Screenshot ${index + 1}`;
        card.appendChild(link);
      });
      const notes = document.createElement("textarea");
      notes.className = "swap-admin-notes";
      notes.maxLength = 1500;
      notes.placeholder = "Private admin notes";
      notes.value = swapSecret.adminNotes || "";
      card.appendChild(notes);
      const actions = document.createElement("div");
      actions.className = "account-card-actions";
      ["under-review", "verification-required", "approved", "rejected", "matched", "transfer-in-progress", "completed", "suspended"].forEach((status) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = status.replaceAll("-", " ");
        button.addEventListener("click", () => reviewSwapRequest(swap.id, status, notes.value));
        actions.appendChild(button);
      });
      card.appendChild(actions);
      list.appendChild(card);
    }
  } catch (err) {
    console.error("ADMIN SWAP REVIEW LOAD ERROR:", err);
    list.replaceChildren();
    const error = document.createElement("p");
    error.textContent = "Unable to load swap reviews. Please refresh and try again.";
    list.appendChild(error);
  }
}

async function reviewSwapRequest(swapId, status, adminNotes) {
  if (!currentUserIsAdmin) return;
  try {
    const review = httpsCallable(functions, "reviewAccountSwap");
    await review({ swapId, status, adminNotes });
    window.showToast("Swap review status updated.");
    loadAdminSwaps();
  } catch (err) {
    console.error("ADMIN SWAP REVIEW ERROR:", err);
    window.showToast("Swap review could not be updated.");
  }
}

window.recordAccountSale = async () => {
  if (!currentUserIsAdmin) {
    window.showToast("Administrator access is required.");
    return;
  }
  const payload = {
    listingId: document.getElementById("sale-listing-id")?.value.trim(),
    buyerId: document.getElementById("sale-buyer-id")?.value.trim(),
    finalSalePrice: Number(document.getElementById("sale-final-price")?.value),
    paymentStatus: document.getElementById("sale-payment-status")?.value,
    transferStatus: document.getElementById("sale-transfer-status")?.value,
    sellerPayoutStatus: document.getElementById("sale-payout-status")?.value
  };
  const button = document.querySelector("#admin-sales-section button[onclick='recordAccountSale()']");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    const saveSale = httpsCallable(functions, "recordAccountSale");
    const result = await saveSale(payload);
    window.showToast(result.data.feeApplied
      ? `Sale recorded. Fee: ${formatNaira(result.data.marketplaceFee)} · Seller proceeds: ${formatNaira(result.data.sellerPayout)}`
      : "Sale details saved. Fee is applied only after transfer completion.");
    loadAdminSales();
  } catch (err) {
    console.error("ACCOUNT SALE UPDATE ERROR:", err);
    window.showToast("Account sale could not be updated. Check the listing, payment, and transfer details.");
  } finally {
    if (button) button.disabled = false;
  }
};

async function loadAdminSales() {
  const list = document.getElementById("admin-sales-list");
  if (!list || !currentUserIsAdmin) return;
  try {
    const snapshot = await getDocs(collection(db, "accountSales"));
    list.replaceChildren();
    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.textContent = "No account sales have been recorded.";
      list.appendChild(empty);
      return;
    }
    snapshot.forEach((saleDoc) => {
      const sale = saleDoc.data();
      const card = document.createElement("article");
      card.className = "order-card";
      const title = document.createElement("h3");
      title.textContent = `Sale ${sale.saleId || saleDoc.id}`;
      card.appendChild(title);
      appendOrderField(card, "Listing", sale.listingId || "N/A");
      appendOrderField(card, "Seller", sale.sellerId || "N/A");
      appendOrderField(card, "Buyer", sale.buyerId || "N/A");
      appendOrderField(card, "Final price", formatNaira(sale.finalSalePrice));
      appendOrderField(card, "Fee", sale.feeApplied ? formatNaira(sale.marketplaceFee) : "Not applied until completed");
      appendOrderField(card, "Seller proceeds", sale.feeApplied ? formatNaira(sale.sellerProceeds) : "Pending");
      appendOrderField(card, "Payment", sale.paymentStatus || "pending");
      appendOrderField(card, "Transfer", sale.transferStatus || "pending");
      appendOrderField(card, "Payout", sale.sellerPayoutStatus || "pending");
      list.appendChild(card);
    });
  } catch (err) {
    console.error("ADMIN SALES LOAD ERROR:", err);
    list.textContent = "Unable to load account sales.";
  }
}

// Lightweight client-side order filter for the My Orders page.
document.getElementById("order-filter")?.addEventListener("change", (event) => {
  document.querySelectorAll("#history-list .order-card").forEach((card) => {
    card.hidden = event.target.value !== "all" && !card.textContent.includes(event.target.value === "topup" ? "TOP-UP ORDER" : "ACCOUNT PURCHASE");
  });
});
