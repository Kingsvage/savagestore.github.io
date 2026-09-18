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
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { firebaseConfig, emailConfig, adminConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
const provider = new GoogleAuthProvider();

const authPersistenceReady = setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log("Auth persistence initialized");
  })
  .catch((err) => {
    console.error("AUTH PERSISTENCE ERROR:", err);
  });

provider.setCustomParameters({
  prompt: "select_account"
});

const emailClient = window.emailjs || null;

console.log("EmailJS loaded:", Boolean(emailClient));

if (emailClient) {
  emailClient.init(emailConfig.publicKey);
  console.log("EmailJS initialized");
} else {
  console.warn("EmailJS SDK is unavailable; email notifications are disabled.");
}

async function sendEmail(emailName, templateParams) {
  if (!emailClient) {
    throw new Error("EmailJS SDK is unavailable");
  }

  console.log(`EmailJS sending: ${emailName}`, {
    serviceId: emailConfig.serviceId,
    templateId: emailConfig.templateId,
    toEmail: templateParams.to_email
  });

  try {
    const response = await emailClient.send(
      emailConfig.serviceId,
      emailConfig.templateId,
      templateParams
    );

    console.log(`EmailJS success: ${emailName}`, {
      status: response.status,
      text: response.text
    });

    return response;
  } catch (err) {
    console.error(`EmailJS error: ${emailName}`, {
      status: err.status,
      text: err.text,
      message: err.message
    });

    throw err;
  }
}

let currentOrder = {
  item: "",
  price: 0,
  gameId: "free-fire",
  offerId: "",
  player: null
};

const GAMES = {
  "free-fire": { name: "Free Fire", supportsCustomDiamonds: true },
  "call-of-duty": { name: "Call of Duty Mobile", supportsCustomDiamonds: false }
};
let selectedGameId = "free-fire";
let marketplaceUnsubscribe = null;
let marketplaceFiltersBound = false;

const DEFAULT_LISTING_IMAGE =
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop";

let siteSettings = {
  diamondRate: 15,
  topupEnabled: true,
  marketplaceEnabled: true,
  maintenanceMode: false,
  supportWhatsapp: "2347120004769"
};

// Store all listings for filtering
let allListings = [];

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

async function ensureSiteSettingsLoaded(timeoutMs = 3000) {
  try {
    await Promise.race([
      siteSettingsReady,
      new Promise((resolve) => {
        setTimeout(resolve, timeoutMs);
      })
    ]);
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
  const customDiamondsSupported = GAMES[selectedGameId]?.supportsCustomDiamonds === true;
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
      customDiamondBox.classList.toggle("hidden", !customDiamondsSupported);
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

  appendOrderField(card, "Item", order.item || "N/A");
  appendOrderField(card, "Price", `₦${price.toLocaleString()}`);
  appendOrderField(card, "Status", order.status || "pending");

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
      updateOrderStatus(order.id, statusSelect.value);
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

// Create one public marketplace card implementation for Home and Marketplace.
function createMarketplaceCard(listing, isFeatured = false) {
  const card = document.createElement("article");
  card.className = isFeatured ? "market-card featured" : "market-card";
  card.dataset.listingId = listing.id;

  const badge = document.createElement("div");
  badge.className = isFeatured ? "badge premium" : "badge";
  badge.textContent = isFeatured ? "⭐ FEATURED" : "VERIFIED";
  card.appendChild(badge);
  card.appendChild(createListingImage(listing, "listing-image"));

  const title = document.createElement("h3");
  title.textContent = listing.title || "Gaming account";
  card.appendChild(title);
  const description = document.createElement("p");
  description.textContent = `Region: ${listing.region || "N/A"} • Level ${listing.level || "N/A"} • Rank: ${listing.rank || "N/A"}`;
  card.appendChild(description);
  const details = document.createElement("p");
  details.textContent = listing.description || "";
  card.appendChild(details);
  const price = document.createElement("h2");
  price.textContent = `₦${Number(listing.price || 0).toLocaleString()}`;
  card.appendChild(price);

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = isMarketplaceAvailable() ? "BUY ACCOUNT" : "MARKETPLACE UNAVAILABLE";
  button.disabled = !isMarketplaceAvailable();
  button.addEventListener("click", () => window.openAccountPurchase(listing.id));
  card.appendChild(button);
  return card;
}

window.openAccountPurchase = async (listingId) => {
  await ensureSiteSettingsLoaded();
  const listing = allListings.find((entry) => entry.id === listingId);
  if (!listing) { window.location.href = `marketplace.html?listing=${encodeURIComponent(listingId)}`; return; }
  if (!auth.currentUser) { showToast("Please log in to purchase an account."); await window.signInWithGoogle(); if (!auth.currentUser) return; }
  if (!isMarketplaceAvailable() || listing.status !== "approved") { showToast("This account is unavailable."); return; }
  showAccountPurchaseNotice(listing);
};

function showAccountPurchaseNotice(listing) {
  let modal = document.getElementById("account-purchase-modal");
  if (!modal) {
    modal = document.createElement("div"); modal.id = "account-purchase-modal"; modal.className = "modal";
    modal.innerHTML = '<div class="modal-box account-notice"><button type="button" class="close-btn">✕</button><h2>IMPORTANT ACCOUNT PURCHASE NOTICE</h2><p>This account purchase is handled through Savage Store Technical Support to help reduce scams and verify transfer. Do not send payment directly to a seller.</p><ul><li>Change the password immediately after transfer.</li><li>Secure recovery methods and review active sessions.</li><li>Remove unknown linked devices/accounts where available.</li><li>Never share the new password.</li></ul><p>Game publishers may prohibit account trading. Savage Store does not represent account trading as officially authorized by any publisher.</p><div class="profile-actions"><button type="button" class="secondary-btn cancel-account-purchase">CANCEL</button><button type="button" class="primary-btn contact-account-support">CONTACT TECHNICAL SUPPORT</button></div></div>';
    document.body.appendChild(modal);
  }
  modal.classList.remove("hidden");
  modal.querySelector(".close-btn").onclick = () => modal.classList.add("hidden");
  modal.querySelector(".cancel-account-purchase").onclick = () => modal.classList.add("hidden");
  modal.querySelector(".contact-account-support").onclick = async () => {
    try {
      const createSale = httpsCallable(functions, "createAccountSale");
      const result = await createSale({ listingId: listing.id });
      modal.classList.add("hidden");
      window.chatAdminForAccount(listing, result.data.saleId);
    } catch (error) { console.error("ACCOUNT SALE REQUEST ERROR:", error); showToast("Could not contact Technical Support. Please try again."); }
  };
}


// Filter and render marketplace listings
function renderMarketplaceListings() {
  const searchTerm = document.getElementById("marketplace-search")?.value.toLowerCase() || "";
  const regionFilter = document.getElementById("region-filter")?.value || "";
  const priceFilter = document.getElementById("price-filter")?.value || "";
  const levelFilter = document.getElementById("level-filter")?.value || "";

  // Filter listings based on search and filters
  const filtered = allListings.filter((listing) => {
    const matchesSearch =
      !searchTerm ||
      (listing.title || "").toLowerCase().includes(searchTerm) ||
      (listing.sellerName || "").toLowerCase().includes(searchTerm) ||
      (listing.region || "").toLowerCase().includes(searchTerm) ||
      (listing.description || "").toLowerCase().includes(searchTerm);

    const matchesRegion = !regionFilter || listing.region === regionFilter;

    const matchesLevel = !levelFilter || isLevelInRange(Number(listing.level), levelFilter);

    const matchesPrice = !priceFilter || isPriceInRange(Number(listing.price), priceFilter);

    return matchesSearch && matchesRegion && matchesLevel && matchesPrice;
  });

  // Separate featured (expensive) from regular listings
  const featured = filtered.filter(l => Number(l.price) >= 100000).slice(0, 3);
  const regular = filtered;

  // Render featured section
  const featuredGrid = document.getElementById("featured-grid");
  if (featuredGrid) {
    featuredGrid.replaceChildren();

    if (featured.length > 0) {
      featured.forEach((listing) => {
        featuredGrid.appendChild(createMarketplaceCard(listing, true));
      });
    } else {
      const emptyMsg = document.createElement("p");
      emptyMsg.textContent = "No featured listings match your search.";
      featuredGrid.appendChild(emptyMsg);
    }
  }

  // Render all listings on the Marketplace page and approved featured cards on Home.
  const homeFeaturedGrid = document.getElementById("home-featured-grid");
  if (homeFeaturedGrid) {
    homeFeaturedGrid.replaceChildren();
    const homeListings = filtered.slice(0, 3);
    if (homeListings.length) {
      homeListings.forEach((listing) => homeFeaturedGrid.appendChild(createMarketplaceCard(listing, true)));
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No approved accounts are available right now. Please check back soon.";
      homeFeaturedGrid.appendChild(empty);
    }
  }

  const marketplaceGrid = document.getElementById("marketplace-grid");
  if (marketplaceGrid) {
    marketplaceGrid.replaceChildren();

    if (!filtered.length) {
      const emptyMsg = document.createElement("p");
      emptyMsg.textContent = "No listings match your search criteria.";
      marketplaceGrid.appendChild(emptyMsg);
      return;
    }

    filtered.forEach((listing) => {
      marketplaceGrid.appendChild(createMarketplaceCard(listing, false));
    });
  }
}

// Helper function to check if level is in range
function isLevelInRange(level, range) {
  const [min, max] = range.split("-").map(Number);
  return level >= min && (max ? level <= max : true);
}

// Helper function to check if price is in range
function isPriceInRange(price, range) {
  if (range === "500000") return price >= 500000;

  const [min, max] = range.split("-").map(Number);
  return price >= min && price <= max;
}

function setSelectedGame(gameId) {
  if (!GAMES[gameId]) return;
  selectedGameId = gameId;
  document.querySelectorAll("[data-game-select]").forEach((button) => {
    button.classList.toggle("active", button.dataset.gameSelect === gameId);
    button.setAttribute("aria-pressed", String(button.dataset.gameSelect === gameId));
  });
  document.querySelectorAll("[data-game-name]").forEach((element) => { element.textContent = GAMES[gameId].name; });
  applySiteSettings();
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
  setSelectedGame(document.querySelector("[data-game-select].active")?.dataset.gameSelect || selectedGameId);
});

function setMobileMenuOpen(open) {
  const nav = document.querySelector("header nav");
  const button = document.getElementById("mobile-menu-toggle");
  if (!nav || !button) return;
  nav.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
}

function initializeNavigation() {
  const header = document.querySelector("header");
  const nav = header?.querySelector("nav");
  if (!header || !nav || document.getElementById("mobile-menu-toggle")) return;
  const button = document.createElement("button");
  button.id = "mobile-menu-toggle";
  button.type = "button";
  button.className = "mobile-menu-toggle";
  button.setAttribute("aria-label", "Open navigation menu");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "☰";
  button.addEventListener("click", () => setMobileMenuOpen(!nav.classList.contains("active")));
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMobileMenuOpen(false)));
  document.addEventListener("click", (event) => { if (!header.contains(event.target)) setMobileMenuOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMobileMenuOpen(false); });
  header.insertBefore(button, nav);
}

function setLoginOverlay(visible, message = "Connecting to Google…") {
  let overlay = document.getElementById("login-overlay");
  if (!overlay && visible) {
    overlay = document.createElement("div");
    overlay.id = "login-overlay";
    overlay.className = "login-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = '<div class="login-dialog"><span class="login-spinner"></span><strong></strong><p>Please complete the secure Google sign-in window.</p></div>';
    document.body.appendChild(overlay);
  }
  if (!overlay) return;
  overlay.querySelector("strong").textContent = message;
  overlay.classList.toggle("hidden", !visible);
}

window.signInWithGoogle = async () => {
  try {
    setLoginOverlay(true);
    showToast("Opening Google login...");
    await authPersistenceReady;

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    showToast(`Welcome ${user.displayName} ⚡`);

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
  } finally {
    setLoginOverlay(false);
  }
};

window.logout = async () => {
  try {
    await signOut(auth);
    showToast("Logged out successfully ⚡");
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
      "customer order confirmation",
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
      "admin new-order notification",
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
    if (!orderData.customerEmail) {
      throw new Error("Order is missing customerEmail");
    }

    await sendEmail(
      "customer delivered receipt",
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
function loadMarketplaceListings() {
  const marketplaceGrid = document.getElementById("marketplace-grid");
  const homeFeaturedGrid = document.getElementById("home-featured-grid");
  const marketplaceControls = document.getElementById("marketplace-controls");

  if (!marketplaceGrid && !homeFeaturedGrid) return;
  if (marketplaceUnsubscribe) return;

  if (!isMarketplaceAvailable()) {
    applySiteSettings();
    return;
  }

  try {
    const listingsQuery = query(
      collection(db, "listings"),
      where("status", "==", "approved")
    );

    marketplaceUnsubscribe = onSnapshot(listingsQuery, (snapshot) => {
      console.log("MARKETPLACE LISTINGS UPDATED:", snapshot.size);

      allListings = [];

      snapshot.forEach((docSnap) => {
        allListings.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      allListings.sort((firstListing, secondListing) => {
        const firstApprovedAt = firstListing.approvedAt?.toMillis?.() || 0;
        const secondApprovedAt = secondListing.approvedAt?.toMillis?.() || 0;

        return secondApprovedAt - firstApprovedAt;
      });

      // Show controls and sections
      if (marketplaceControls) {
        marketplaceControls.classList.remove("hidden");
      }
      const featuredSection = document.getElementById("featured-section");
      if (featuredSection) {
        featuredSection.classList.remove("hidden");
      }
      if (marketplaceGrid) {
        marketplaceGrid.classList.remove("hidden");
      }

      // Initial render
      renderMarketplaceListings();

    }, (error) => {
      console.error("MARKETPLACE LISTENER ERROR:", error);
      const target = marketplaceGrid || homeFeaturedGrid;
      if (!target) return;
      target.replaceChildren();
      const errorMsg = document.createElement("p");
      errorMsg.textContent = "Error loading marketplace listings.";
      target.appendChild(errorMsg);
    });

    // Set up search and filter event listeners once per page.
    if (marketplaceFiltersBound) return marketplaceUnsubscribe;
    marketplaceFiltersBound = true;
    const searchInput = document.getElementById("marketplace-search");
    if (searchInput) {
      searchInput.addEventListener("input", renderMarketplaceListings);
    }

    const regionFilter = document.getElementById("region-filter");
    if (regionFilter) {
      regionFilter.addEventListener("change", renderMarketplaceListings);
    }

    const priceFilter = document.getElementById("price-filter");
    if (priceFilter) {
      priceFilter.addEventListener("change", renderMarketplaceListings);
    }

    const levelFilter = document.getElementById("level-filter");
    if (levelFilter) {
      levelFilter.addEventListener("change", renderMarketplaceListings);
    }

    const clearFiltersBtn = document.getElementById("clear-filters");
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (regionFilter) regionFilter.value = "";
        if (priceFilter) priceFilter.value = "";
        if (levelFilter) levelFilter.value = "";
        renderMarketplaceListings();
        showToast("Filters cleared ✅");
      });
    }

    return marketplaceUnsubscribe;

  } catch (err) {
    console.error("LOAD MARKETPLACE ERROR:", err);
    marketplaceGrid.replaceChildren();
    const errorMsg = document.createElement("p");
    errorMsg.textContent = "Could not load marketplace listings.";
    marketplaceGrid.appendChild(errorMsg);
  }
}

// Load admin listings - NOW GLOBAL (moved out of loadAdminOrders)
async function loadAdminListings() {
  console.log("LOAD ADMIN LISTINGS STARTED");
  const listingsList = document.getElementById("listings-list");

  if (!listingsList) return;

  try {
    const listingsQuery = query(
      collection(db, "listings"),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(listingsQuery);
    console.log("LISTINGS COUNT:", snapshot.size);

    let listings = [];

    snapshot.forEach((docSnap) => {
      listings.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    if (!listings.length) {
      listingsList.replaceChildren();
      const emptyMsg = document.createElement("p");
      emptyMsg.textContent = "No listings found.";
      listingsList.appendChild(emptyMsg);
      return;
    }

    listingsList.replaceChildren();

    listings.forEach((listing) => {
      const card = document.createElement("div");
      card.className = "order-card";

      const title = document.createElement("h3");
      title.textContent = listing.title;
      card.appendChild(title);

      if (getValidImageUrl(listing.image1)) {
        card.appendChild(createListingImage(listing, "admin-listing-image"));
      }

      const fields = [
        { label: "Seller", value: listing.sellerName },
        { label: "Email", value: listing.sellerEmail },
        { label: "Region", value: listing.region },
        { label: "Rank", value: listing.rank },
        { label: "Level", value: listing.level },
        { label: "Price", value: `₦${Number(listing.price).toLocaleString()}` },
        { label: "Status", value: listing.status }
      ];

      fields.forEach(({ label, value }) => {
        appendOrderField(card, label, value);
      });

      const description = document.createElement("p");
      description.textContent = listing.description;
      card.appendChild(description);

      const viewCredentialsBtn = document.createElement("button");
      viewCredentialsBtn.className = "secondary-btn";
      viewCredentialsBtn.textContent = "VIEW ACCOUNT CREDENTIALS";
      viewCredentialsBtn.addEventListener("click", async () => {
        try {
          const getCredentials = httpsCallable(functions, "getListingCredentialsForAdmin");
          const result = await getCredentials({ listingId: listing.id });
          const credentials = result.data;
          const info = `Private verification details\n\nLogin method: ${credentials.loginMethod}\nLogin identifier: ${credentials.loginIdentifier}\nPassword: ${credentials.password}\n\n${credentials.verificationInfo || ""}`;
          window.prompt("Admin-only credentials. Do not copy into email or chat.", info);
        } catch (error) { console.error("CREDENTIAL ACCESS ERROR:", error); showToast("Credential access was denied or unavailable."); }
      });
      card.appendChild(viewCredentialsBtn);

      const approveBtn = document.createElement("button");
      approveBtn.className = "primary-btn";
      approveBtn.textContent = "APPROVE";
      approveBtn.addEventListener("click", () => approveListing(listing.id));
      card.appendChild(approveBtn);

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "danger-btn";
      rejectBtn.textContent = "REJECT";
      rejectBtn.addEventListener("click", () => rejectListing(listing.id));
      card.appendChild(rejectBtn);

      listingsList.appendChild(card);
    });

  } catch (err) {
    console.error("LOAD LISTINGS ERROR:", err);
    listingsList.replaceChildren();
    const errorMsg = document.createElement("p");
    errorMsg.textContent = "Error loading listings.";
    listingsList.appendChild(errorMsg);
  }
}

window.approveListing = async (listingId) => {
  try {
    await updateDoc(
      doc(db, "listings", listingId),
      {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: auth.currentUser?.uid || ""
      }
    );

    showToast("Listing approved ✅ - Marketplace will update in real-time!");
    loadAdminListings();

  } catch (err) {
    console.error("APPROVE LISTING ERROR:", err);
    showToast("⚠️ Failed to approve listing");
  }
};

window.rejectListing = async (listingId) => {
  try {
    await updateDoc(
      doc(db, "listings", listingId),
      {
        status: "rejected",
        rejectedAt: serverTimestamp(),
        rejectedBy: auth.currentUser?.uid || ""
      }
    );

    showToast("Listing rejected ❌");
    loadAdminListings();

  } catch (err) {
    console.error("REJECT LISTING ERROR:", err);
    showToast("⚠️ Failed to reject listing");
  }
};

function populateAdminSettingsForm() {
  const diamondRateInput = document.getElementById("setting-diamond-rate");
  const supportWhatsappInput = document.getElementById("setting-support-whatsapp");
  const topupEnabledInput = document.getElementById("setting-topup-enabled");
  const marketplaceEnabledInput = document.getElementById("setting-marketplace-enabled");
  const maintenanceModeInput = document.getElementById("setting-maintenance-mode");

  if (diamondRateInput) {
    diamondRateInput.value = siteSettings.diamondRate;
  }

  if (supportWhatsappInput) {
    supportWhatsappInput.value = siteSettings.supportWhatsapp;
  }

  if (topupEnabledInput) {
    topupEnabledInput.checked = siteSettings.topupEnabled;
  }

  if (marketplaceEnabledInput) {
    marketplaceEnabledInput.checked = siteSettings.marketplaceEnabled;
  }

  if (maintenanceModeInput) {
    maintenanceModeInput.checked = siteSettings.maintenanceMode;
  }
}

window.saveAdminSiteSettings = async () => {
  await ensureSiteSettingsLoaded();

  const user = auth.currentUser;

  if (!user || !adminConfig.emails.includes(user.email.toLowerCase())) {
    alert("Admin access required.");
    return;
  }

  const diamondRate = Number(
    document.getElementById("setting-diamond-rate")?.value
  );
  const supportWhatsapp = document
    .getElementById("setting-support-whatsapp")
    ?.value
    .trim();

  if (!Number.isFinite(diamondRate) || diamondRate <= 0) {
    alert("Diamond rate must be a positive number.");
    return;
  }

  if (!supportWhatsapp) {
    alert("Support WhatsApp number is required.");
    return;
  }

  const nextSettings = {
    diamondRate,
    supportWhatsapp,
    topupEnabled: Boolean(
      document.getElementById("setting-topup-enabled")?.checked
    ),
    marketplaceEnabled: Boolean(
      document.getElementById("setting-marketplace-enabled")?.checked
    ),
    maintenanceMode: Boolean(
      document.getElementById("setting-maintenance-mode")?.checked
    ),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  };

  try {
    showToast("Saving site settings...");

    await setDoc(doc(db, "settings", "config"), nextSettings, { merge: true });
    await loadSiteSettings();
    populateAdminSettingsForm();
    showToast("Site settings saved ✅");
  } catch (err) {
    console.error("SAVE SITE SETTINGS ERROR:", err);
    alert(
      "Could not save site settings:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
  }
};

async function loadAdminOrders() {
  const ordersList = document.getElementById("orders-list");
  const searchInput = document.getElementById("search-orders");
  const statusFilter = document.getElementById("status-filter");

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

      const filtered = orders.filter((order) => {
        const matchesSearch =
          (order.orderId || "").toLowerCase().includes(search) ||
          (order.customerEmail || "").toLowerCase().includes(search) ||
          (order.gameUID || "").toLowerCase().includes(search);

        const matchesStatus =
          status === "all" || order.status === status;

        return matchesSearch && matchesStatus;
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

    if (searchInput) {
      searchInput.addEventListener("input", renderOrders);
    }

    if (statusFilter) {
      statusFilter.addEventListener("change", renderOrders);
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

  if (!user || !adminConfig.emails.includes(user.email.toLowerCase())) {
    alert("Admin access required.");
    return;
  }

  if (!allowedStatuses.includes(newStatus)) {
    alert("Invalid order status.");
    return;
  }

  try {
    showToast("Updating order status...");

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

    showToast(`Order marked as ${newStatus} ✅`);

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
    } else if (newStatus === "delivered" && receiptAlreadySent) {
      showToast("Order delivered. Receipt was already sent earlier ✅");
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
    console.log("AUTH STATE CHANGED:", user ? "signed-in" : "signed-out");
    await ensureSiteSettingsLoaded();

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
  const marketplaceGrid = document.getElementById("marketplace-grid");
  const marketplaceLoginBox = document.getElementById("marketplace-login-box");

  const heroCardMessage = document.getElementById("hero-card-message");
  const heroCardStatus = document.getElementById("hero-card-status");
  const heroCardBtn = document.getElementById("hero-card-btn");

  if (user) {
    const loggedInEmail = (user.email || "").toLowerCase();
    const isAdmin = adminConfig.emails.includes(loggedInEmail);

    if (storeLink) {
      storeLink.style.display = "inline-block";
    }

    if (heroLoginBtn) {
      heroLoginBtn.style.display = "none";
    }

    if (ordersLink) {
      ordersLink.style.display = "inline-block";
    }

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
    loadProfile(user).catch((error) => console.error("PROFILE LOAD ERROR:", error));
    if (isMarketplaceAvailable()) {
      loadMarketplaceListings(); // Load approved listings with search/filter support
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

    document.getElementById("profile-section")?.classList.add("hidden");
    document.getElementById("profile-login-box")?.classList.remove("hidden");

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

    if (marketplaceGrid) {
      marketplaceGrid.classList.add("hidden");
    }

    if (marketplaceLoginBox) {
      marketplaceLoginBox.classList.remove("hidden");
    }

    if (navLoginBtn) {
      navLoginBtn.textContent = "LOGIN";
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

  currentOrder = {
    item,
    price: numPrice,
    gameId: selectedGameId,
    offerId: "",
    player: null
  };

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

window.openDiamondPackageOrder = async (button) => {
  await ensureSiteSettingsLoaded();

  const amount = Number(button?.dataset?.diamonds);
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

  const orderId = generateOrderId();

  try {
    showToast("Submitting order...");

    const orderData = {
      orderId: orderId,
      userId: user.uid,
      customerName: user.displayName,
      customerEmail: email,
      googleEmail: user.email,
      gameUID: uid,
      gameId: currentOrder.gameId,
      gameName: GAMES[currentOrder.gameId]?.name || currentOrder.gameId,
      item: currentOrder.item,
      price: currentOrder.price,
      paymentStatus: "pending",
      fulfillmentStatus: "pending",
      status: "processing"
    };

    await addDoc(collection(db, "orders"), {
      ...orderData,
      createdAt: serverTimestamp()
    });

    const customerEmailSent = await sendCustomerConfirmationEmail(orderData);
    const adminEmailSent = await sendAdminOrderEmail(orderData);

    closeModal();

    document.getElementById("uid").value = "";
    document.getElementById("email").value = user.email;

    if (customerEmailSent && adminEmailSent) {
      showToast(`Order submitted successfully ⚡ Order ID: ${orderId}`);
    } else {
      showToast(
        `Order submitted successfully ⚡ Order ID: ${orderId}. Email notification could not be sent.`
      );
    }

    loadUserOrders(user.uid);

    if (adminConfig.emails.includes(user.email.toLowerCase())) {
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

window.toggleMobileMenu = () => {
  const nav = document.querySelector("header nav");
  if (nav) setMobileMenuOpen(!nav.classList.contains("active"));
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

  if (!GAMES[selectedGameId]?.supportsCustomDiamonds) {
    alert("Custom diamond requests are currently available for Free Fire only.");
    return;
  }
  const estimatedPrice = calculateDiamondPrice(amount);
  await openOrderModal(`${amount} Custom Diamonds`, estimatedPrice);
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
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

window.chatAdminForAccount = async (listing, saleId = "") => {
  await ensureSiteSettingsLoaded();
  if (!isMarketplaceAvailable() || !auth.currentUser) return;
  const user = auth.currentUser;
  const message = `Hello Savage Store Technical Support. I want to purchase the following account:

Sale ID: ${saleId || "Pending"}
Listing ID: ${listing.id}
Game: ${listing.game || "Gaming account"}
Account: ${listing.title}
Listed Price: ₦${Number(listing.price || 0).toLocaleString()}

Buyer: ${user.displayName || "Customer"}
Buyer email: ${user.email || ""}

Please assist me with the account purchase process.`;
  window.open(`https://wa.me/${siteSettings.supportWhatsapp}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
};

window.toggleSellerPassword = () => {
  const input = document.getElementById("seller-login-password");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
};

document.addEventListener("DOMContentLoaded", () => {
  const agreement = document.getElementById("seller-agreement");
  const submit = document.getElementById("seller-submit-btn");
  if (agreement && submit) agreement.addEventListener("change", () => { submit.disabled = !agreement.checked; });
});

window.submitAccountListing = async () => {
  await ensureSiteSettingsLoaded();
  if (!isMarketplaceAvailable() || !auth.currentUser) { alert("Please log in and ensure Marketplace is available."); return; }
  if (!document.getElementById("seller-agreement")?.checked) { alert("You must accept the Marketplace Seller Agreement."); return; }
  const text = (id) => document.getElementById(id)?.value.trim() || "";
  const publicData = {
    game: document.getElementById("seller-game")?.value, title: text("seller-account-title"), region: text("seller-region"), price: Number(text("seller-price")),
    level: text("seller-level"), rank: text("seller-rank"), description: text("seller-description"), rareItems: text("seller-rare-items"), accountUid: text("seller-account-uid"),
    image1: getValidImageUrl(text("seller-image-1")), image2: getValidImageUrl(text("seller-image-2")), image3: getValidImageUrl(text("seller-image-3")), sellerAgreementAccepted: true
  };
  const secret = { loginMethod: document.getElementById("seller-login-method")?.value, loginIdentifier: text("seller-login-identifier"), password: document.getElementById("seller-login-password")?.value || "", verificationInfo: text("seller-verification-info") };
  if (!publicData.title || !publicData.region || !publicData.level || !publicData.rank || !publicData.description || !Number.isFinite(publicData.price) || publicData.price <= 0 || !secret.loginIdentifier || !secret.password) { alert("Complete public and private verification fields."); return; }
  try {
    showToast("Submitting private verification details securely...");
    const submitListing = httpsCallable(functions, "submitMarketplaceListing");
    await submitListing({ public: publicData, secret });
    document.getElementById("seller-form-box").querySelectorAll("input, textarea, select").forEach((field) => { if (field.type === "checkbox") field.checked = false; else field.value = ""; });
    document.getElementById("seller-game").value = "free-fire";
    document.getElementById("seller-submit-btn").disabled = true;
    showToast("Listing submitted for secure admin verification ✅");
  } catch (error) { console.error("LISTING SUBMIT ERROR:", error); showToast("Could not submit listing. Please try again."); }
};
