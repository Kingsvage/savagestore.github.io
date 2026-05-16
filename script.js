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
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
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

  toast.innerHTML = message;
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

    if (totalOrders) {
      totalOrders.innerHTML = orders.length;
    }

    const revenue = orders.reduce((sum, order) => {
      return sum + Number(order.price || 0);
    }, 0);

    if (totalRevenue) {
      totalRevenue.innerHTML = `₦${revenue.toLocaleString()}`;
    }

    const pending = orders.filter((order) => {
      return order.status === "pending";
    }).length;

    if (pendingOrders) {
      pendingOrders.innerHTML = pending;
    }

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

      if (!filtered.length) {
        ordersList.innerHTML = "<p>No matching orders.</p>";
        return;
      }

      ordersList.innerHTML = "";

      filtered.forEach((order) => {
        ordersList.innerHTML += `
          <div class="order-card">

            <h3>${order.orderId || "No Order ID"}</h3>

            <p><strong>Name:</strong> ${order.customerName || "N/A"}</p>

            <p><strong>Email:</strong> ${order.customerEmail || "N/A"}</p>

            <p><strong>UID:</strong> ${order.gameUID || "N/A"}</p>

            <p><strong>Item:</strong> ${order.item || "N/A"}</p>

            <p><strong>Price:</strong>
              ₦${Number(order.price || 0).toLocaleString()}
            </p>

            <p><strong>Status:</strong>
              ${order.status || "pending"}
            </p>

            <p><strong>Proof:</strong>
              ${order.paymentProof || "No proof required yet"}
            </p>

          </div>
        `;
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
    ordersList.innerHTML = "<p>Could not load orders.</p>";
  }
}

async function loadUserOrders(userId) {
  const historySection = document.getElementById("history-section");
  const historyList = document.getElementById("history-list");

  if (!historySection || !historyList) return;

  historySection.classList.remove("hidden");

  try {
    const ordersQuery = query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(ordersQuery);

    let userOrders = [];

    snapshot.forEach((docSnap) => {
      const order = docSnap.data();

      if (order.userId === userId) {
        userOrders.push(order);
      }
    });

    if (!userOrders.length) {
      historyList.innerHTML = "<p>No orders yet.</p>";
      return;
    }

    historyList.innerHTML = "";

    userOrders.forEach((order) => {
      historyList.innerHTML += `
        <div class="order-card">

          <h3>${order.orderId || "No Order ID"}</h3>

          <p><strong>Item:</strong>
            ${order.item || "N/A"}
          </p>

          <p><strong>Price:</strong>
            ₦${Number(order.price || 0).toLocaleString()}
          </p>

          <p><strong>Status:</strong>
            ${order.status || "pending"}
          </p>

        </div>
      `;
    });

  } catch (err) {
    console.error("LOAD USER ORDERS ERROR:", err);
    historyList.innerHTML = "<p>Could not load history.</p>";
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
  const ordersLink = document.getElementById("orders-link");
  const historySection = document.getElementById("history-section");

  if (user) {
    const adminLink = document.getElementById("admin-link");

if (
  adminLink &&
  adminEmails.includes(user.email.toLowerCase())
) {
  adminLink.style.display = "inline-block";
}
    const heroCardMessage = document.getElementById("hero-card-message");
const heroCardStatus = document.getElementById("hero-card-status");
const heroCardBtn = document.getElementById("hero-card-btn");

if (heroCardMessage) {
  heroCardMessage.innerHTML = "Diamond packages are unlocked.";
}

if (heroCardStatus) {
  heroCardStatus.innerHTML = "Ready to Top Up";
}

if (heroCardBtn) {
  heroCardBtn.innerHTML = "VIEW PACKAGES";
  heroCardBtn.onclick = () => scrollToSection("diamonds");
}
    const loggedInEmail = user.email.toLowerCase();

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
      navLoginBtn.innerHTML = "LOGOUT";
      navLoginBtn.onclick = logout;
    }

    if (emailInput) {
      emailInput.value = user.email;
    }

    unlockTopupForUser(user);

    loadUserOrders(user.uid);

    if (adminDashboard && adminEmails.includes(loggedInEmail)) {
      adminDashboard.classList.remove("hidden");
      showToast("Admin dashboard unlocked ✅");
      loadAdminOrders();
    } else if (adminDashboard) {
      adminDashboard.classList.add("hidden");
    }

    saveUser(user).catch((err) => {
      console.error("SAVE USER ERROR:", err);
    });

  } else {
    const adminLink = document.getElementById("admin-link");

if (adminLink) {
  adminLink.style.display = "none";
}
    const heroCardMessage = document.getElementById("hero-card-message");
const heroCardStatus = document.getElementById("hero-card-status");
const heroCardBtn = document.getElementById("hero-card-btn");

if (heroCardMessage) {
  heroCardMessage.innerHTML = "Login to unlock diamond packages.";
}

if (heroCardStatus) {
  heroCardStatus.innerHTML = "Login Required";
}

if (heroCardBtn) {
  heroCardBtn.innerHTML = "GET STARTED";
  heroCardBtn.onclick = signInWithGoogle;
}
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

    if (navLoginBtn) {
      navLoginBtn.innerHTML = "LOGIN";
      navLoginBtn.onclick = signInWithGoogle;
    }

    if (adminDashboard) {
      adminDashboard.classList.add("hidden");
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
    summary.innerHTML = `
      <strong>${item}</strong>
      <br><br>
      Price: ₦${price.toLocaleString()}
    `;
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
      status: "pending"
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
