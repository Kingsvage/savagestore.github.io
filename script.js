import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
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

provider.setCustomParameters({
  prompt: "select_account"
});

/* EMAILJS DETAILS */
const emailServiceId = "service_3ut8kuo";
const emailTemplateId = "template_jeabwaa";
const emailPublicKey = "VGMXshIsMZlghPhDW";

emailjs.init(emailPublicKey);

let currentOrder = {
  item: "",
  price: 0
};

const whatsappNumber = "2347120004769";
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
              ${order.paymentProof || "Customer will send proof on WhatsApp"}
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

onAuthStateChanged(auth, (user) => {
  const storeLink = document.getElementById("store-link");
  const diamonds = document.getElementById("diamonds");
  const heroLoginBtn = document.getElementById("hero-login-btn");
  const navLoginBtn = document.getElementById("nav-login-btn");
  const emailInput = document.getElementById("email");
  const adminDashboard = document.getElementById("admin-dashboard");
  const ordersLink = document.getElementById("orders-link");
  const historySection = document.getElementById("history-section");

  if (!storeLink || !diamonds || !heroLoginBtn || !navLoginBtn) {
    console.error("Some HTML elements are missing.");
    return;
  }

  if (user) {
    const loggedInEmail = user.email.toLowerCase();

    storeLink.style.display = "inline-block";
    diamonds.classList.remove("hidden");
    heroLoginBtn.style.display = "none";

    if (ordersLink) {
      ordersLink.style.display = "inline-block";
    }

    navLoginBtn.innerHTML = "LOGOUT";
    navLoginBtn.onclick = logout;

    if (emailInput) {
      emailInput.value = user.email;
    }

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
    storeLink.style.display = "none";
    diamonds.classList.add("hidden");
    heroLoginBtn.style.display = "inline-block";

    if (ordersLink) {
      ordersLink.style.display = "none";
    }

    if (historySection) {
      historySection.classList.add("hidden");
    }

    navLoginBtn.innerHTML = "LOGIN";
    navLoginBtn.onclick = signInWithGoogle;

    if (adminDashboard) {
      adminDashboard.classList.add("hidden");
    }
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

  document.getElementById("order-summary").innerHTML = `
    <strong>${item}</strong>
    <br><br>
    Price: ₦${price.toLocaleString()}
  `;

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

async function sendConfirmationEmail(orderData) {
  try {
    const result = await emailjs.send(
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

    console.log("EMAILJS SUCCESS:", result);
  } catch (err) {
    console.error("EMAILJS ERROR:", err);

    alert(
      "Email failed:\n\n" +
      JSON.stringify(err)
    );
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
      paymentProof: "Customer will send proof on WhatsApp",
      status: "pending"
    };

    await addDoc(collection(db, "orders"), {
      ...orderData,
      createdAt: serverTimestamp()
    });

    await sendConfirmationEmail(orderData);

    const message = `
SAVAGE STORE ORDER

ORDER ID: ${orderId}
ITEM: ${currentOrder.item}
PRICE: ₦${currentOrder.price.toLocaleString()}
FREE FIRE UID: ${uid}
EMAIL: ${email}
GOOGLE ACCOUNT: ${user.email}
PAYMENT PROOF: Customer will send screenshot on WhatsApp

I have made payment.
`;

    const whatsappURL =
      `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

    window.open(whatsappURL, "_blank");

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
  const amount = document.getElementById("custom-diamond-amount").value;

  if (!amount || Number(amount) <= 0) {
    alert("Enter valid diamond amount ⚡");
    return;
  }

  const estimatedPrice = Math.round(Number(amount) * 4);

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