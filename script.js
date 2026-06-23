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

import { firebaseConfig, emailConfig, adminConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence).catch((err) => {
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
  price: 0
};

// Store all listings for filtering
let allListings = [];

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function appendOrderField(card, label, value) {
  const paragraph = document.createElement("p");
  const strong = document.createElement("strong");

  strong.textContent = `${label}:`;
  paragraph.append(strong, ` ${value}`);
  card.appendChild(paragraph);
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

// Create marketplace card for listings
function createMarketplaceCard(listing, isFeatured = false) {
  const card = document.createElement("div");
  card.className = isFeatured ? "market-card featured" : "market-card";

  // Badge
  const badge = document.createElement("div");
  badge.className = isFeatured ? "badge premium" : "badge";
  badge.textContent = isFeatured ? "⭐ FEATURED" : "VERIFIED";
  card.appendChild(badge);

  // Placeholder image
  const img = document.createElement("img");
  img.src = "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop";
  img.alt = listing.title;
  card.appendChild(img);

  // Title
  const title = document.createElement("h3");
  title.textContent = listing.title;
  card.appendChild(title);

  // Description with listing details
  const description = document.createElement("p");
  description.textContent = `Region: ${listing.region} • Level ${listing.level} • Rank: ${listing.rank}`;
  card.appendChild(description);

  // Additional description
  const details = document.createElement("p");
  details.textContent = listing.description;
  card.appendChild(details);

  // Price
  const price = document.createElement("h2");
  price.textContent = `₦${Number(listing.price).toLocaleString()}`;
  card.appendChild(price);

  // Seller contact info
  const sellerInfo = document.createElement("p");
  sellerInfo.style.fontSize = "0.9em";
  sellerInfo.style.color = "#888";
  sellerInfo.textContent = `Seller: ${listing.sellerName}`;
  card.appendChild(sellerInfo);

  // Chat button
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "CHAT ADMIN TO BUY";
  button.addEventListener("click", () => {
    chatAdminForAccount(listing.title, listing.price);
  });
  card.appendChild(button);

  return card;
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

  // Render all listings
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
    showToast("Opening Google login...");

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    showToast(`Welcome ${user.displayName} ⚡`);

    saveUser(user).catch((err) => {
      console.error("SAVE USER ERROR:", err);
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
  } catch (err) {
    console.error("CUSTOMER EMAIL ERROR:", err);
    showToast("⚠️ Confirmation email could not be sent");
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
  } catch (err) {
    console.error("ADMIN EMAIL ERROR:", err);
    showToast("⚠️ Admin notification email could not be sent");
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
  } catch (err) {
    console.error("DELIVERED EMAIL ERROR:", err);
    showToast("⚠️ Delivery receipt email could not be sent");
  }
}

// Load approved marketplace listings with real-time updates AND search/filter support
function loadMarketplaceListings() {
  const marketplaceGrid = document.getElementById("marketplace-grid");
  const marketplaceControls = document.getElementById("marketplace-controls");

  if (!marketplaceGrid) return;

  try {
    const listingsQuery = query(
      collection(db, "listings"),
      where("status", "==", "approved")
    );

    const unsubscribe = onSnapshot(listingsQuery, (snapshot) => {
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
      marketplaceGrid.replaceChildren();
      const errorMsg = document.createElement("p");
      errorMsg.textContent = "Error loading marketplace listings.";
      marketplaceGrid.appendChild(errorMsg);
    });

    // Set up search and filter event listeners
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

    return unsubscribe;

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
        approvedAt: serverTimestamp()
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
        status: "rejected"
      }
    );

    showToast("Listing rejected ❌");
    loadAdminListings();

  } catch (err) {
    console.error("REJECT LISTING ERROR:", err);
    showToast("⚠️ Failed to reject listing");
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

    setText(totalOrders, orders.length);

    const revenue = orders.reduce((sum, order) => {
      return sum + Number(order.price || 0);
    }, 0);

    setText(totalRevenue, `₦${revenue.toLocaleString()}`);

    const pending = orders.filter((order) => {
      return order.status === "processing";
    }).length;

    setText(pendingOrders, pending);

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

    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    showToast(`Order marked as ${newStatus} ✅`);

    if (newStatus === "delivered") {
      const orderSnap = await getDoc(orderRef);

      if (orderSnap.exists()) {
        sendDeliveredReceiptEmail(orderSnap.data());
      }

      showToast("Delivered receipt sent ✅");
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

  if (diamondGrid) {
    diamondGrid.classList.remove("hidden");
  }

  if (loginRequiredBox) {
    loginRequiredBox.classList.add("hidden");
  }
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
}

onAuthStateChanged(auth, (user) => {

  const storeLink = document.getElementById("store-link");
  const heroLoginBtn = document.getElementById("hero-login-btn");
  const navLoginBtn = document.getElementById("nav-login-btn");
  const emailInput = document.getElementById("email");

  const adminDashboard = document.getElementById("admin-dashboard");
  const adminDenied = document.getElementById("admin-denied");
  const adminLink = document.getElementById("admin-link");

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
    const loggedInEmail = user.email.toLowerCase();
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
      navLoginBtn.onclick = logout;
    }

    if (emailInput) {
      emailInput.value = user.email;
    }

    setText(heroCardMessage, "Diamond packages are unlocked.");
    setText(heroCardStatus, "Ready to Top Up");

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

    if (marketplaceGrid) {
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
    loadMarketplaceListings(); // Load approved listings with search/filter support

    if (adminLink) {
      adminLink.style.display = isAdmin ? "inline-block" : "none";
    }

    if (adminDashboard) {
      adminDashboard.classList.toggle("hidden", !isAdmin);
    }

    if (adminDenied) {
      adminDenied.classList.toggle("hidden", isAdmin);
    }

    if (isAdmin) {
      showToast("Admin dashboard unlocked ✅");
      loadAdminOrders();
      loadAdminListings();
    }

    saveUser(user).catch((err) => {
      console.error("SAVE USER ERROR:", err);
    });

  } else {

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
      navLoginBtn.onclick = signInWithGoogle;
    }

    if (adminDashboard) {
      adminDashboard.classList.add("hidden");
    }

    if (adminDenied) {
      adminDenied.classList.remove("hidden");
    }

    if (adminLink) {
      adminLink.style.display = "none";
    }

    setText(heroCardMessage, "Login to unlock diamond packages.");
    setText(heroCardStatus, "Login Required");

    if (heroCardBtn) {
      heroCardBtn.textContent = "GET STARTED";
      heroCardBtn.onclick = signInWithGoogle;
    }

    lockTopupForGuest();
  }
});

window.openOrderModal = (item, price) => {
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
      item: currentOrder.item,
      price: currentOrder.price,
      paymentProof: "Proof system not required yet",
      status: "processing"
    };

    await addDoc(collection(db, "orders"), {
      ...orderData,
      createdAt: serverTimestamp()
    });

    await sendCustomerConfirmationEmail(orderData);

    await sendAdminOrderEmail(orderData);

    closeModal();

    document.getElementById("uid").value = "";
    document.getElementById("email").value = user.email;

    showToast(`Order submitted successfully ⚡ Order ID: ${orderId}`);

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
  const nav = document.querySelector("nav");

  if (nav) {
    nav.classList.toggle("active");
  }
};

window.submitCustomDiamond = () => {
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

  const estimatedPrice = Math.round(amount * 15);

  openOrderModal(
    `${amount} Custom Diamonds`,
    estimatedPrice
  );
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

window.chatAdminForAccount = (accountName, price) => {
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

  const whatsappURL =
    `https://wa.me/${adminConfig.whatsappNumber}?text=${encodeURIComponent(message)}`;

  window.open(whatsappURL, "_blank");
};

window.submitAccountListing = async () => {
  const user = auth.currentUser;

  if (!user) {
    alert("Please login first ⚡");
    return;
  }

  const title = document.getElementById("seller-account-title").value.trim();
  const region = document.getElementById("seller-region").value.trim();
  const price = document.getElementById("seller-price").value.trim();
  const level = document.getElementById("seller-level").value.trim();
  const rank = document.getElementById("seller-rank").value.trim();
  const description = document.getElementById("seller-description").value.trim();
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
    showToast("Submitting listing for review...");

    await addDoc(collection(db, "listings"), {
      sellerId: user.uid,
      sellerName: user.displayName,
      sellerEmail: user.email,
      title,
      region,
      price: numericPrice,
      level,
      rank,
      description,
      contact,
      status: "pending-review",
      createdAt: serverTimestamp()
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
    document.getElementById("seller-contact").value = "";

    showToast("Listing submitted for admin review ✅");
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
