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
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, emailConfig, adminConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("AUTH PERSISTENCE ERROR:", err);
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

let currentOrder = {
  item: "",
  price: 0,
  gameId: "free-fire"
};

const DEFAULT_LISTING_IMAGE =
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop";

// Store all listings for filtering
let allListings = [];
let selectedAccountListing = null;

// Single source of truth for games. Legacy records without gameId remain Free Fire.
const games = [
  { id: "free-fire", name: "Free Fire", shortName: "FF", enabled: true, currency: "Diamonds", uidLabel: "Free Fire Player UID" },
  { id: "call-of-duty", name: "Call of Duty Mobile", shortName: "CODM", enabled: true, currency: "COD Points", uidLabel: "Call of Duty Player UID / Player ID" }
];

function getGame(gameId) { return games.find((game) => game.id === gameId) || games[0]; }
function getListingGameId(listing) { return listing.gameId || "free-fire"; }
function getOrderGameId(order) { return order.gameId || "free-fire"; }

// Product data is kept alongside game metadata so additional game currencies can be added without changing order flow.
const topupProducts = [
  { gameId: "free-fire", productType: "diamonds", productName: "100 Diamonds", amount: 100, price: 1600, enabled: true },
  { gameId: "free-fire", productType: "diamonds", productName: "210 Diamonds", amount: 210, price: 3200, enabled: true },
  { gameId: "free-fire", productType: "diamonds", productName: "530 Diamonds", amount: 530, price: 7900, enabled: true },
  { gameId: "call-of-duty", productType: "cod-points", productName: "80 COD Points", amount: 80, price: 1800, enabled: true },
  { gameId: "call-of-duty", productType: "cod-points", productName: "420 COD Points", amount: 420, price: 8000, enabled: true },
  { gameId: "call-of-duty", productType: "cod-points", productName: "880 COD Points", amount: 880, price: 15500, enabled: true }
];
const SAVAGE_LOGO_URL = "https://www.image2url.com/r2/default/images/1778679132528-369f040c-1b4c-4795-826e-514f59f2ec64.png";

function initializeAppShell() {
  const currentPage = location.pathname.split("/").pop() || "index.html";
  const pageLinks = [
    ["index.html", "Home"], ["marketplace.html", "Marketplace"], ["sell.html", "Sell Account"],
    ["topup.html", "Top Up"], ["orders.html", "My Orders"]
  ];
  const links = pageLinks.map(([href, label]) => `<a class="${currentPage === href ? "is-active" : ""}" href="${href}">${label}</a>`).join("");
  const header = document.querySelector("header");
  if (header) {
    header.className = "top-navbar";
    header.innerHTML = `<a class="brand-logo" href="index.html" aria-label="Savage Store home"><img src="${SAVAGE_LOGO_URL}" alt="Savage Store"></a><button class="menu-toggle" type="button" aria-label="Open navigation" onclick="toggleMobileMenu()">☰</button><nav class="primary-nav">${links}<a href="admin.html" id="admin-link" style="display:none">Admin</a></nav><div class="nav-tools"><label class="global-search"><span>⌕</span><input id="global-search" type="search" placeholder="Search games, accounts, or items..."></label><button class="icon-button" type="button" aria-label="Cart">⌑</button><button class="icon-button" type="button" aria-label="Notifications">◌</button><span id="nav-user-label" class="nav-user-label">Guest</span><button type="button" class="nav-btn" id="nav-login-btn" onclick="signInWithGoogle()">LOGIN / SIGN UP</button></div>`;
  }
  if (!document.querySelector(".sidebar")) {
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar";
    sidebar.innerHTML = `<a class="sidebar-logo" href="index.html"><img src="${SAVAGE_LOGO_URL}" alt="Savage Store"></a><p class="sidebar-label">MAIN MENU</p><nav>${links}</nav><p class="sidebar-label">GAME CATEGORIES</p><nav class="game-nav"><a href="marketplace.html?game=free-fire">🔥 <span>Free Fire</span></a><a href="marketplace.html?game=call-of-duty">COD <span>Call of Duty</span></a><a class="muted-link" href="marketplace.html">＋ <span>More Games</span></a></nav><div class="sidebar-support"><b>NEED HELP?</b><p>Chat with Savage Store support.</p><a href="https://wa.me/2347120004769" target="_blank" rel="noopener">CHAT NOW →</a></div>`;
    document.body.prepend(sidebar);
    document.body.classList.add("has-sidebar");
  }
  const footer = document.querySelector("footer");
  if (footer) footer.innerHTML = `<div><img class="footer-logo" src="${SAVAGE_LOGO_URL}" alt="Savage Store"><p>Gaming Accounts • Top Up • Marketplace</p></div><nav>${links}</nav><div><p>Need help?</p><a href="https://wa.me/2347120004769" target="_blank" rel="noopener">CHAT WITH SUPPORT →</a><p>© 2026 Savage Store</p></div>`;
  document.getElementById("global-search")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.currentTarget.value.trim()) location.href = `marketplace.html?search=${encodeURIComponent(event.currentTarget.value.trim())}`;
  });
}

initializeAppShell();

const defaultSiteSettings = {
  diamondRate: 15,
  topupEnabled: true,
  marketplaceEnabled: true,
  maintenanceMode: false,
  supportWhatsapp: "2347120004769"
};

let siteSettings = {
  ...defaultSiteSettings
};

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function normalizeString(value, fallback) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

async function loadSiteSettings() {
  try {
    const settingsSnap = await getDoc(doc(db, "settings", "config"));

    if (settingsSnap.exists()) {
      const data = settingsSnap.data();

      siteSettings = {
        ...siteSettings,
        diamondRate: normalizePositiveNumber(
          data.diamondRate,
          siteSettings.diamondRate
        ),
        topupEnabled: normalizeBoolean(
          data.topupEnabled,
          siteSettings.topupEnabled
        ),
        marketplaceEnabled: normalizeBoolean(
          data.marketplaceEnabled,
          siteSettings.marketplaceEnabled
        ),
        maintenanceMode: normalizeBoolean(
          data.maintenanceMode,
          siteSettings.maintenanceMode
        ),
        supportWhatsapp: normalizeString(
          data.supportWhatsapp,
          siteSettings.supportWhatsapp
        )
      };
    }

    console.log("SITE SETTINGS LOADED:", siteSettings);
  } catch (err) {
    console.error("LOAD SITE SETTINGS ERROR:", err);
  }

  applySiteSettings();
  return siteSettings;
}

const siteSettingsReady = loadSiteSettings();

function setText(element, value) {
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

    if (customDiamondBox) {
      customDiamondBox.classList.add("hidden");
    }

    if (topupLoginBox) {
      topupLoginBox.classList.add("hidden");
    }

    upsertStatusMessage(
      "topup-settings-status",
      siteSettings.maintenanceMode
        ? "Diamond Top-up is unavailable during maintenance."
        : "Diamond Top-up is temporarily unavailable.",
      diamondGrid || customDiamondBox
    );
  } else {
    hideStatusMessage("topup-settings-status");

    if (customDiamondBox) {
      customDiamondBox.classList.remove("hidden");
    }
  }

  updateDiamondPackagePrices();

  const marketplaceGrid = document.getElementById("marketplace-grid");
  const featuredSection = document.getElementById("featured-section");
  const marketplaceControls = document.getElementById("marketplace-controls");
  const marketplaceLoginBox = document.getElementById("marketplace-login-box");

  if (!isMarketplaceAvailable()) {
    [marketplaceGrid, featuredSection, marketplaceControls, marketplaceLoginBox].forEach((element) => {
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
  }
}

function calculateDiamondPrice(amount) {
  return Math.round(amount * Number(siteSettings.diamondRate));
}

function updateDiamondPackagePrices() {
  document.querySelectorAll("[data-diamonds]").forEach((button) => {
    const amount = Number(button.dataset.diamonds);
    const priceElement = button
      .closest(".diamond-card")
      ?.querySelector("[data-diamond-price]");

    if (!Number.isInteger(amount) || !priceElement) return;

    priceElement.textContent = `₦${calculateDiamondPrice(amount).toLocaleString()}`;
  });
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
  const status = order.status || "processing";
  statusLabel.textContent = "Status: ";
  statusBadge.className = `status-badge status-${status}`;
  statusBadge.textContent = status.toUpperCase();
  statusRow.append(statusLabel, statusBadge);
  card.appendChild(statusRow);

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
      statusSelect.appendChild(option);
    });

    statusSelect.addEventListener("change", () => {
      window.updateOrderStatus(order.id, statusSelect.value);
    });

    card.appendChild(statusSelect);
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
  return listing.status === "approved";
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
  details.textContent = `${getGame(getListingGameId(listing)).name} · ${listing.region || "N/A"} · ${listing.rank || "N/A"} · Level ${listing.level || "N/A"} · Available`;
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

function renderMarketplaceListings() {
  const searchInput = document.getElementById("marketplace-search");
  if (searchInput && !searchInput.value && new URLSearchParams(location.search).get("search")) searchInput.value = new URLSearchParams(location.search).get("search");
  const searchTerm = searchInput?.value.toLowerCase().trim() || "";
  const regionFilter = document.getElementById("region-filter")?.value || "";
  const gameFilterElement = document.getElementById("game-filter");
  const requestedGame = new URLSearchParams(location.search).get("game");
  if (gameFilterElement && !gameFilterElement.value && games.some((game) => game.id === requestedGame)) gameFilterElement.value = requestedGame;
  const gameFilter = gameFilterElement?.value || "";
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

let currentUserIsAdmin = false;

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

  return adminConfig.emails.includes((user.email || "").toLowerCase());
}

function getSupportWhatsappNumber() {
  return String(
    siteSettings.supportWhatsapp || defaultSiteSettings.supportWhatsapp
  ).replace(/\D/g, "");
}

function getListingImage(listing) {
  return listing.image1 || listing.imageUrl || listing.screenshotUrl || DEFAULT_LISTING_IMAGE;
}

function setElementText(element, value) {
  setText(element, value);
}

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

window.signInWithGoogle = async () => {
  try {
    window.showToast("Opening Google login...");
    await authPersistenceReady;

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    window.showToast(`Welcome ${user.displayName} ⚡`);

    saveUser(user).catch((err) => {
      console.error("LOGIN SUCCESSFUL BUT PROFILE SAVE FAILED:", err);
      showToast("Login successful, but profile save failed ⚠️");
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    alert(
      "Login failed:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
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
  const diamondRateInput = document.getElementById("setting-diamond-rate");
  const supportWhatsappInput = document.getElementById("setting-support-whatsapp");
  const topupEnabledInput = document.getElementById("setting-topup-enabled");
  const marketplaceEnabledInput = document.getElementById("setting-marketplace-enabled");
  const maintenanceModeInput = document.getElementById("setting-maintenance-mode");

  if (diamondRateInput) diamondRateInput.value = siteSettings.diamondRate;
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

  const diamondRateInput = document.getElementById("setting-diamond-rate");
  const supportWhatsappInput = document.getElementById("setting-support-whatsapp");
  const topupEnabledInput = document.getElementById("setting-topup-enabled");
  const marketplaceEnabledInput = document.getElementById("setting-marketplace-enabled");
  const maintenanceModeInput = document.getElementById("setting-maintenance-mode");

  const nextSettings = {
    diamondRate: normalizePositiveNumber(diamondRateInput?.value, defaultSiteSettings.diamondRate),
    supportWhatsapp: normalizeString(supportWhatsappInput?.value, defaultSiteSettings.supportWhatsapp),
    topupEnabled: Boolean(topupEnabledInput?.checked),
    marketplaceEnabled: Boolean(marketplaceEnabledInput?.checked),
    maintenanceMode: Boolean(maintenanceModeInput?.checked),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  };

  try {
    await setDoc(doc(db, "settings", "config"), nextSettings, { merge: true });
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

  if (!marketplaceGrid && !featuredGrid) return;

  try {
    const listingsQuery = query(collection(db, "listings"), where("status", "==", "approved"));
    const snapshot = await getDocs(listingsQuery);

    allListings = [];
    snapshot.forEach((docSnap) => {
      allListings.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderMarketplaceListings();
    const homeGrid = document.getElementById("home-featured-grid");
    if (homeGrid) {
      homeGrid.replaceChildren();
      const featured = sortListings(allListings.filter(isListingApproved), "newest").slice(0, 3);
      if (!featured.length) {
        const empty = document.createElement("p");
        empty.textContent = "No approved accounts are available yet. Check back soon.";
        homeGrid.appendChild(empty);
      } else featured.forEach((listing) => homeGrid.appendChild(createMarketplaceCard(listing, true)));
    }
  } catch (err) {
    console.error("LOAD MARKETPLACE LISTINGS ERROR:", err);
    if (marketplaceGrid) {
      marketplaceGrid.replaceChildren();
      const errorMessage = document.createElement("p");
      errorMessage.textContent = "Could not load marketplace listings.";
      marketplaceGrid.appendChild(errorMessage);
    }
  }
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
  const modal = document.getElementById("account-detail-modal");
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
};

window.closeAccountDetails = () => {
  const modal = document.getElementById("account-detail-modal");

  if (modal) {
    modal.classList.add("hidden");
  }
};

window.openAccountPurchase = async (listingId) => {
  await ensureSiteSettingsLoaded();

  const user = auth.currentUser;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  const listing = getListingById(listingId) || selectedAccountListing;

  if (!listing || listing.id !== listingId || !isListingApproved(listing)) {
    alert("This account is no longer available.");
    return;
  }

  selectedAccountListing = listing;

  const modal = document.getElementById("account-purchase-modal");
  const summary = document.getElementById("account-purchase-summary");

  if (!modal || !summary) return;

  summary.replaceChildren();

  [
    ["Account", listing.title || "Gaming Account"],
    ["Price", formatNaira(listing.price)],
    ["Customer", user.displayName || "Customer"],
    ["Email", user.email || "N/A"]
  ].forEach(([label, value]) => {
    const row = document.createElement("p");

    row.innerHTML = `<strong>${label}:</strong> ${value}`;
    summary.appendChild(row);
  });

  window.closeAccountDetails();
  modal.classList.remove("hidden");
};

window.closeAccountPurchase = () => {
  const modal = document.getElementById("account-purchase-modal");

  if (modal) {
    modal.classList.add("hidden");
  }
};

async function sendMarketplacePurchaseEmails(orderData) {
  try {
    await sendEmail({
      to_email: adminConfig.emails[0],
      user_email: adminConfig.emails[0],
      email: adminConfig.emails[0],
      reply_to: orderData.customerEmail,
      to_name: "Savage Store Admin",
      customer_name: orderData.customerName,
      order_item: `NEW ACCOUNT PURCHASE: ${orderData.item}`,
      item: orderData.item,
      uid: orderData.listingId,
      currency_symbol: "₦",
      price: Number(orderData.price).toLocaleString()
    });
  } catch (err) {
    console.error("ACCOUNT PURCHASE ADMIN EMAIL ERROR:", err);
    window.showToast("Purchase saved, but admin email could not be sent ⚠️");
  }

  try {
    await sendEmail({
      to_email: orderData.customerEmail,
      user_email: orderData.customerEmail,
      email: orderData.customerEmail,
      reply_to: adminConfig.emails[0],
      to_name: orderData.customerName,
      customer_name: orderData.customerName,
      order_item: `ACCOUNT PURCHASE: ${orderData.item}`,
      item: orderData.item,
      uid: orderData.listingId,
      currency_symbol: "₦",
      price: Number(orderData.price).toLocaleString()
    });
  } catch (err) {
    console.error("ACCOUNT PURCHASE CUSTOMER EMAIL ERROR:", err);
    window.showToast("Purchase saved, but confirmation email could not be sent ⚠️");
  }
}

window.confirmAccountPurchase = async () => {
  await ensureSiteSettingsLoaded();

  const user = auth.currentUser;
  const listing = selectedAccountListing;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  if (!listing?.id) {
    alert("No account selected.");
    return;
  }

  const orderId = window.generateOrderId();
  let createdOrderData = null;

  try {
    window.showToast("Creating account purchase...");

    await runTransaction(db, async (transaction) => {
      const listingRef = doc(db, "listings", listing.id);
      const listingSnap = await transaction.get(listingRef);

      if (!listingSnap.exists()) {
        throw new Error("This listing no longer exists.");
      }

      const latestListing = listingSnap.data();

      if (latestListing.status !== "approved") {
        throw new Error("This account is no longer available for purchase.");
      }

      const orderRef = doc(db, "orders", orderId);

      createdOrderData = {
        orderId,
        orderType: "account-purchase",
        userId: user.uid,
        customerName: user.displayName || "Customer",
        customerEmail: user.email,
        googleEmail: user.email,
        listingId: listing.id,
        gameId: getListingGameId(latestListing),
        item: latestListing.title || "Gaming Account",
        price: Number(latestListing.price || 0),
        status: "processing",
        paymentProof: "Account purchase pending admin processing",
        createdAt: serverTimestamp()
      };

      transaction.set(orderRef, createdOrderData);
      transaction.update(listingRef, {
        status: "sold",
        soldAt: serverTimestamp(),
        soldTo: user.uid,
        soldOrderId: orderId,
        updatedAt: serverTimestamp()
      });
    });

    window.closeAccountPurchase();
    window.showToast(`Purchase created ✅ Order ID: ${orderId}`);

    if (createdOrderData) {
      sendMarketplacePurchaseEmails(createdOrderData);
    }

    await loadMarketplaceListings();
    loadUserOrders(user.uid);
  } catch (err) {
    console.error("ACCOUNT PURCHASE ERROR:", err);
    alert("Could not create purchase:\n\n" + err.message);
  }
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

  appendListingField(card, "Seller", listing.sellerName);
  appendListingField(card, "Email", listing.sellerEmail);
  appendListingField(card, "Contact", listing.contact);
  appendListingField(card, "Region", listing.region);
  appendListingField(card, "Level", listing.level);
  appendListingField(card, "Rank", listing.rank);
  appendListingField(card, "Price", `₦${Number(listing.price || 0).toLocaleString()}`);
  appendListingField(card, "Status", listing.status);
  appendListingField(card, "Date", formatDate(listing.createdAt));
  appendListingField(card, "Description", listing.description);

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
      return sum + Number(order.price || 0);
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

    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

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

      window.showToast("Delivered receipt sent ✅");
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
  await ensureSiteSettingsLoaded();

  try {
    const storeLink = document.getElementById("store-link");
  const heroLoginBtn = document.getElementById("hero-login-btn");
  const navLoginBtn = document.getElementById("nav-login-btn");
  const emailInput = document.getElementById("email");

  const adminDashboard = document.getElementById("admin-dashboard");
  const adminDenied = document.getElementById("admin-denied");
  const adminLink = document.getElementById("admin-link");
  const adminSettingsSection = document.getElementById("admin-settings-section");
  const adminListingsSection = document.getElementById("admin-listings-section");

  const ordersLink = document.getElementById("orders-link");
  const historySection = document.getElementById("history-section");
  const ordersLoginBox = document.getElementById("orders-login-box");

  const sellLoginBox = document.getElementById("sell-login-box");
  const sellerFormBox = document.getElementById("seller-form-box");
  const sellerDashboardSection = document.getElementById("seller-dashboard-section");
  const marketplaceGrid = document.getElementById("marketplace-grid");
  const marketplaceLoginBox = document.getElementById("marketplace-login-box");

  const heroCardMessage = document.getElementById("hero-card-message");
  const heroCardStatus = document.getElementById("hero-card-status");
  const heroCardBtn = document.getElementById("hero-card-btn");

  if (user) {
    const loggedInEmail = (user.email || "").toLowerCase();
    const isAdmin = await checkAdminAccess(user);
    currentUserIsAdmin = isAdmin;

    if (storeLink) {
      storeLink.style.display = "inline-block";
    }

    if (heroLoginBtn) {
      heroLoginBtn.style.display = "none";
    }

    if (ordersLink) {
      ordersLink.style.display = "inline-block";
    }

    setElementText(document.getElementById("nav-user-label"), user.displayName || user.email || "Account");
    if (navLoginBtn) {
      navLoginBtn.textContent = "LOGOUT";
      navLoginBtn.onclick = window.logout;
    }

    if (emailInput) {
      emailInput.value = user.email;
    }

    setElementText(heroCardMessage, "Diamond packages are unlocked.");
    setElementText(heroCardStatus, "Ready to Top Up");

    if (heroCardBtn) {
      heroCardBtn.textContent = "VIEW PACKAGES";
      heroCardBtn.onclick = () => scrollToSection("diamonds");
    }

    if (sellLoginBox) {
      sellLoginBox.classList.add("hidden");
    }

    if (sellerFormBox) {
      sellerFormBox.classList.remove("hidden");
    }

    if (sellerDashboardSection) {
      sellerDashboardSection.classList.remove("hidden");
      loadSellerListings(user.uid);
    }

    if (marketplaceGrid && isMarketplaceAvailable()) {
      marketplaceGrid.classList.remove("hidden");
    }

    if (marketplaceLoginBox) {
      marketplaceLoginBox.classList.add("hidden");
    }

    if (ordersLoginBox) {
      ordersLoginBox.classList.add("hidden");
    }

    unlockTopupForUser(user);
    loadUserOrders(user.uid);
    if (isMarketplaceAvailable()) {
      initializeMarketplaceControls();
      loadMarketplaceListings();
    } else {
      applySiteSettings();
    }

    if (adminLink) {
      adminLink.style.display = isAdmin ? "inline-block" : "none";
    }

    if (adminDashboard) {
      adminDashboard.classList.toggle("hidden", !isAdmin);
    }

    if (adminSettingsSection) {
      adminSettingsSection.classList.toggle("hidden", !isAdmin);
    }

    if (adminListingsSection) {
      adminListingsSection.classList.toggle("hidden", !isAdmin);
    }

    if (adminDenied) {
      adminDenied.classList.toggle("hidden", isAdmin);
    }

    if (isAdmin) {
      showToast("Admin dashboard unlocked ✅");
      populateAdminSettingsForm();
      loadAdminOrders();
      loadAdminListings();
    }

    saveUser(user).catch((err) => {
      console.error("LOGIN SUCCESSFUL BUT PROFILE SAVE FAILED:", err);
    });

  } else {

    currentUserIsAdmin = false;

    if (storeLink) {
      storeLink.style.display = "none";
    }

    if (heroLoginBtn) {
      heroLoginBtn.style.display = "inline-block";
    }

    if (ordersLink) {
      ordersLink.style.display = "none";
    }

    if (historySection) {
      historySection.classList.add("hidden");
    }

    if (ordersLoginBox) {
      ordersLoginBox.classList.remove("hidden");
    }

    if (sellLoginBox) {
      sellLoginBox.classList.remove("hidden");
    }

    if (sellerFormBox) {
      sellerFormBox.classList.add("hidden");
    }

    if (sellerDashboardSection) {
      sellerDashboardSection.classList.add("hidden");
    }

    if (marketplaceGrid) {
      marketplaceGrid.classList.add("hidden");
    }

    if (marketplaceLoginBox) {
      marketplaceLoginBox.classList.remove("hidden");
    }

    setElementText(document.getElementById("nav-user-label"), "Guest");
    if (navLoginBtn) {
      navLoginBtn.textContent = "LOGIN / SIGN UP";
      navLoginBtn.onclick = window.signInWithGoogle;
    }

    if (adminDashboard) {
      adminDashboard.classList.add("hidden");
    }

    if (adminSettingsSection) {
      adminSettingsSection.classList.add("hidden");
    }

    if (adminListingsSection) {
      adminListingsSection.classList.add("hidden");
    }

    if (adminDenied) {
      adminDenied.classList.remove("hidden");
    }

    if (adminLink) {
      adminLink.style.display = "none";
    }

    setElementText(heroCardMessage, "Login to unlock diamond packages.");
    setElementText(heroCardStatus, "Login Required");

    if (heroCardBtn) {
      heroCardBtn.textContent = "GET STARTED";
      heroCardBtn.onclick = window.signInWithGoogle;
    }

    lockTopupForGuest();
  }
  } catch (err) {
    console.error("AUTH STATE HANDLER ERROR:", err);
    showToast("Login loaded, but some page features failed to update ⚠️");
  }
});

window.openOrderModal = async (item, price) => {
  await ensureSiteSettingsLoaded();

  if (!isTopupAvailable()) {
    alert(
      siteSettings.maintenanceMode
        ? "Ordering is disabled during maintenance."
        : "Diamond Top-up is temporarily unavailable."
    );
    applySiteSettings();
    return;
  }

  const user = auth.currentUser;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  const numPrice = Number(price);
  if (isNaN(numPrice) || numPrice <= 0) {
    alert("Invalid price ⚡");
    return;
  }

  currentOrder.item = item;
  currentOrder.price = numPrice;
  currentOrder.gameId = currentOrder.gameId || "free-fire";

  const summary = document.getElementById("order-summary");

  if (summary) {
    const itemSummary = document.createElement("strong");

    itemSummary.textContent = item;
    summary.replaceChildren(
      itemSummary,
      document.createElement("br"),
      document.createElement("br"),
      `Price: ₦${numPrice.toLocaleString()}`
    );
  }

  const emailInput = document.getElementById("email");

  if (emailInput) {
    emailInput.value = user.email;
  }

  const modal = document.getElementById("order-modal");
  if (modal) {
    modal.classList.remove("hidden");
  }
};

window.closeModal = () => {
  const modal = document.getElementById("order-modal");

  if (modal) {
    modal.classList.add("hidden");
  }
};

window.openTopupPackageOrder = async (button) => {
  currentOrder.gameId = button?.dataset?.game || "free-fire";
  const item = button?.dataset?.item || "Game Top Up";
  const price = Number(button?.dataset?.price);
  if (!Number.isFinite(price) || price <= 0) return alert("Invalid top-up package ⚡");
  openOrderModal(item, price);
};

window.openDiamondPackageOrder = async (button) => {
  await ensureSiteSettingsLoaded();

  const amount = Number(button?.dataset?.diamonds);
  currentOrder.gameId = "free-fire";
  const item = button?.dataset?.item || `${amount} Diamonds`;

  if (!Number.isInteger(amount) || amount <= 0) {
    alert("Invalid diamond package ⚡");
    return;
  }

  openOrderModal(item, calculateDiamondPrice(amount));
};

window.copyAccountNumber = async () => {
  try {
    await navigator.clipboard.writeText(adminConfig.accountNumber);
    showToast("Account number copied ✅");
  } catch (err) {
    alert("Account number: " + adminConfig.accountNumber);
  }
};

window.generateOrderId = () => {
  return "SVG-" + Date.now().toString().slice(-8);
};

window.completeOrder = async () => {
  await ensureSiteSettingsLoaded();

  if (!isTopupAvailable()) {
    alert(
      siteSettings.maintenanceMode
        ? "Ordering is disabled during maintenance."
        : "Diamond Top-up is temporarily unavailable."
    );
    closeModal();
    applySiteSettings();
    return;
  }

  const uid = document.getElementById("uid").value.trim();
  const email = document.getElementById("email").value.trim();

  if (!uid || !email) {
    alert("Please fill all fields ⚡");
    return;
  }

  const user = auth.currentUser;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  const orderId = window.generateOrderId();

  try {
    window.showToast("Submitting order...");

    const orderData = {
      orderId: orderId,
      orderType: "topup",
      gameId: currentOrder.gameId || "free-fire",
      userId: user.uid,
      customerName: user.displayName,
      customerEmail: email,
      googleEmail: user.email,
      gameUID: uid,
      item: currentOrder.item,
      price: currentOrder.price,
      paymentProof: "Proof system not required yet",
      status: "processing"
    };

    await setDoc(doc(db, "orders", orderId), {
      ...orderData,
      createdAt: serverTimestamp()
    });

    const customerEmailSent = await sendCustomerConfirmationEmail(orderData);
    const adminEmailSent = await sendAdminOrderEmail(orderData);

    window.closeModal();

    document.getElementById("uid").value = "";
    document.getElementById("email").value = user.email;

    window.showToast(`Order submitted successfully ⚡ Order ID: ${orderId}`);

    loadUserOrders(user.uid);

    if (await checkAdminAccess(user)) {
      loadAdminOrders();
    }

  } catch (err) {
    console.error("ORDER ERROR:", err);

    alert(
      "Order failed:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
  }
};

function initializeTopupGameSelector() {
  const choices = document.querySelectorAll(".game-choice");
  if (!choices.length) return;
  const setGame = (gameId) => {
    const game = getGame(gameId);
    choices.forEach((choice) => choice.classList.toggle("active", choice.dataset.game === gameId));
    document.querySelectorAll(".diamond-card:not(.cod-product)").forEach((card) => card.classList.toggle("hidden", gameId !== "free-fire"));
    document.querySelectorAll(".cod-product").forEach((card) => card.classList.toggle("hidden", gameId !== "call-of-duty"));
    document.querySelector(".custom-diamond-box")?.classList.toggle("hidden", gameId !== "free-fire");
    const uid = document.getElementById("uid"); if (uid) uid.placeholder = `Enter ${game.uidLabel}`;
    const note = document.getElementById("topup-game-note"); if (note) note.textContent = `${game.name} · ${game.currency} · Enter your ${game.uidLabel}`;
  };
  choices.forEach((choice) => choice.addEventListener("click", () => setGame(choice.dataset.game)));
  setGame(new URLSearchParams(location.search).get("game") === "call-of-duty" ? "call-of-duty" : "free-fire");
}
initializeTopupGameSelector();

window.toggleMobileMenu = () => {
  const nav = document.querySelector(".top-navbar .primary-nav") || document.querySelector("header nav");

  if (nav) {
    nav.classList.toggle("active");
  }
};

window.submitCustomDiamond = async () => {
  await ensureSiteSettingsLoaded();

  if (!isTopupAvailable()) {
    alert(
      siteSettings.maintenanceMode
        ? "Custom top-up is disabled during maintenance."
        : "Diamond Top-up is temporarily unavailable."
    );
    applySiteSettings();
    return;
  }

  const amountInput = document.getElementById("custom-diamond-amount");
  const rawAmount = amountInput.value.trim();

  if (!rawAmount) {
    alert("Enter diamond amount ⚡");
    return;
  }

  if (rawAmount.includes(".") || rawAmount.includes(",")) {
    alert("Custom diamonds must be whole numbers only ⚡");
    return;
  }

  const amount = Number(rawAmount);

  if (!Number.isInteger(amount) || amount <= 0) {
    alert("Enter valid whole number of diamonds ⚡");
    return;
  }

  const estimatedPrice = calculateDiamondPrice(amount);

  window.openOrderModal(
    `${amount} Custom Diamonds`,
    estimatedPrice
  );
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.closeModal();
  }
});

window.addEventListener("scroll", () => {
  const header = document.querySelector("header");

  if (!header) return;

  if (window.scrollY > 40) {
    header.style.background = "rgba(0,0,0,.85)";
    header.style.backdropFilter = "blur(10px)";
  } else {
    header.style.background = "transparent";
    header.style.backdropFilter = "none";
  }
});

window.chatAdminForAccount = async (accountName, price) => {
  await ensureSiteSettingsLoaded();

  if (!isMarketplaceAvailable()) {
    alert(
      siteSettings.maintenanceMode
        ? "Purchases are disabled during maintenance."
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

  const numPrice = Number(price);
  if (isNaN(numPrice)) {
    alert("Invalid price ⚡");
    return;
  }

  const message = `
SAVAGE STORE ACCOUNT REQUEST

ACCOUNT: ${accountName}
PRICE: ₦${numPrice.toLocaleString()}

CUSTOMER NAME: ${user.displayName}
CUSTOMER EMAIL: ${user.email}

I want to buy this account. Please confirm availability.
`;

  const whatsappNumber = getSupportWhatsappNumber();
  const whatsappURL =
    `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  window.open(whatsappURL, "_blank");
};

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

  if (!title || !region || !price || !level || !rank || !description || !contact) {
    alert("Please fill all seller fields ⚡");
    return;
  }

  const numericPrice = Number(price);

  if (!Number.isInteger(numericPrice) || numericPrice <= 0) {
    alert("Price must be a positive whole number only ⚡");
    return;
  }

  try {
    window.showToast("Submitting listing for review...");

    const listingData = {
      sellerId: user.uid,
      sellerName: user.displayName,
      sellerEmail: user.email,
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
      status: "pending-review",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await addDoc(collection(db, "listings"), listingData);

    try {
      await sendEmail(
        {
          to_email: adminConfig.emails[0],
          user_email: adminConfig.emails[0],
          email: adminConfig.emails[0],
          reply_to: user.email,
          to_name: "Savage Store Admin",
          customer_name: user.displayName,
          order_item: `NEW ACCOUNT LISTING: ${title}`,
          item: title,
          uid: rank,
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

    window.showToast("Listing submitted for admin review ✅");
    loadSellerListings(user.uid);
  } catch (err) {
    console.error("LISTING SUBMIT ERROR:", err);

    alert(
      "Could not submit listing:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
  }
};

// Lightweight client-side order filter for the My Orders page.
document.getElementById("order-filter")?.addEventListener("change", (event) => {
  document.querySelectorAll("#history-list .order-card").forEach((card) => {
    card.hidden = event.target.value !== "all" && !card.textContent.includes(event.target.value === "topup" ? "TOP-UP ORDER" : "ACCOUNT PURCHASE");
  });
});
