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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7W0bvFnDfEUzuwuAIoGCwRakfFiTEt48",
  authDomain: "savage-store-18507.firebaseapp.com",
  databaseURL: "https://savage-store-18507-default-rtdb.firebaseio.com",
  projectId: "savage-store-18507",
  storageBucket: "savage-store-18507.firebasestorage.app",
  messagingSenderId: "521961005705",
  appId: "1:521961005705:web:216bf71293154e67c29c58",
  measurementId: "G-86K4ZGMZQ4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence);

provider.setCustomParameters({
  prompt: "select_account"
});

const emailServiceId = "service_3ut8kuo";
const emailTemplateId = "template_jeabwaa";
const emailPublicKey = "VGMXshIsMZlghPhDW";

emailjs.init(emailPublicKey);

let currentOrder = {
  item: "",
  price: 0
};

const accountNumber = "7071048081";

const adminEmails = [
  "chukwumachidozie18@gmail.com"
];

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
    await emailjs.send(
      emailServiceId,
      emailTemplateId,
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
  }
}

async function sendAdminOrderEmail(orderData) {
  try {
    await emailjs.send(
      emailServiceId,
      emailTemplateId,
      {
        to_email: adminEmails[0],
        user_email: adminEmails[0],
        email: adminEmails[0],
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
  }
}

async function sendDeliveredReceiptEmail(orderData) {
  try {
    await emailjs.send(
      emailServiceId,
      emailTemplateId,
      {
        to_email: orderData.customerEmail,
        user_email: orderData.customerEmail,
        email: orderData.customerEmail,
        reply_to: adminEmails[0],

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
  }
}

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

    async function loadAdminListings() {
console.log("LOAD ADMIN LISTINGS STARTED");
  const listingsList =
    document.getElementById("listings-list");

  if (!listingsList) return;

  try {

    const listingsQuery = query(
      collection(db, "listings"),
      orderBy("createdAt", "desc")
    );

    const snapshot =
      await getDocs(listingsQuery);
    console.log("LISTINGS COUNT:", snapshot.size);

    let listings = [];

    snapshot.forEach((docSnap) => {

      listings.push({
        id: docSnap.id,
        ...docSnap.data()
      });

    });

    if (!listings.length) {

      listingsList.innerHTML =
        "<p>No listings found.</p>";

      return;
    }

    listingsList.innerHTML = "";

    listings.forEach((listing) => {

      listingsList.innerHTML += `

        <div class="order-card">

          <h3>${listing.title}</h3>

          <p>
            <strong>Seller:</strong>
            ${listing.sellerName}
          </p>

          <p>
            <strong>Email:</strong>
            ${listing.sellerEmail}
          </p>

          <p>
            <strong>Region:</strong>
            ${listing.region}
          </p>

          <p>
            <strong>Rank:</strong>
            ${listing.rank}
          </p>

          <p>
            <strong>Level:</strong>
            ${listing.level}
          </p>

          <p>
            <strong>Price:</strong>
            ₦${Number(listing.price).toLocaleString()}
          </p>

          <p>
            <strong>Status:</strong>
            ${listing.status}
          </p>

          <p>
            ${listing.description}
          </p>

          <button
            class="primary-btn"
            onclick="approveListing('${listing.id}')"
          >
            APPROVE
          </button>

          <button
            class="danger-btn"
            onclick="rejectListing('${listing.id}')"
          >
            REJECT
          </button>

        </div>

      `;

    });

  } catch (err) {

    console.error(
      "LOAD LISTINGS ERROR:",
      err
    );

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

    showToast("Listing approved ✅");

    loadAdminListings();

  } catch (err) {

    console.error(err);

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

    console.error(err);

  }

};
    
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

  if (!user || !adminEmails.includes(user.email.toLowerCase())) {
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
    const isAdmin = adminEmails.includes(loggedInEmail);

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

  currentOrder.item = item;
  currentOrder.price = price;

  const summary = document.getElementById("order-summary");

  if (summary) {
    const itemSummary = document.createElement("strong");

    itemSummary.textContent = item;
    summary.replaceChildren(
      itemSummary,
      document.createElement("br"),
      document.createElement("br"),
      `Price: ₦${price.toLocaleString()}`
    );
  }

  const emailInput = document.getElementById("email");

  if (emailInput) {
    emailInput.value = user.email;
  }

  document.getElementById("order-modal").classList.remove("hidden");
};

window.closeModal = () => {
  const modal = document.getElementById("order-modal");

  if (modal) {
    modal.classList.add("hidden");
  }
};

window.copyAccountNumber = async () => {
  try {
    await navigator.clipboard.writeText(accountNumber);
    showToast("Account number copied ✅");
  } catch (err) {
    alert("Account number: " + accountNumber);
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

    if (adminEmails.includes(user.email.toLowerCase())) {
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

  const message = `
SAVAGE STORE ACCOUNT REQUEST

ACCOUNT: ${accountName}
PRICE: ₦${Number(price).toLocaleString()}

CUSTOMER NAME: ${user.displayName}
CUSTOMER EMAIL: ${user.email}

I want to buy this account. Please confirm availability.
`;

  const whatsappURL =
    `https://wa.me/2347120004769?text=${encodeURIComponent(message)}`;

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

  if (price.includes(".") || price.includes(",") ||
      !Number.isInteger(numericPrice) || numericPrice <= 0) {
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

    await emailjs.send(
      emailServiceId,
      emailTemplateId,
      {
        to_email: adminEmails[0],
        user_email: adminEmails[0],
        email: adminEmails[0],
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
