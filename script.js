import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  collection,
  addDoc,
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

let currentOrder = {
  item: "",
  price: 0
};

const whatsappNumber = "2348033515808";

/* SCROLL FUNCTION */
window.scrollToSection = (id) => {
  const section = document.getElementById(id);

  if (section) {
    section.scrollIntoView({
      behavior: "smooth"
    });
  }
};

/* TOAST MESSAGE */
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

/* SAVE USER TO FIRESTORE */
async function saveUser(user) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      name: user.displayName,
      email: user.email,
      photo: user.photoURL,
      createdAt: serverTimestamp()
    },
    { merge: true }
  );
}

/* GOOGLE LOGIN */
window.signInWithGoogle = async () => {
  try {
    await signInWithRedirect(auth, provider);
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

/* CHECK REDIRECT LOGIN RESULT */
getRedirectResult(auth)
  .then(async (result) => {
    if (result && result.user) {
      await saveUser(result.user);
      showToast(`Welcome ${result.user.displayName} ⚡`);
    }
  })
  .catch((err) => {
    console.error("REDIRECT LOGIN ERROR:", err);

    alert(
      "Redirect login failed:\n\n" +
      err.code +
      "\n\n" +
      err.message
    );
  });

/* LOGOUT */
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

/* AUTH STATE */
onAuthStateChanged(auth, async (user) => {
  const storeLink = document.getElementById("store-link");
  const diamonds = document.getElementById("diamonds");
  const heroLoginBtn = document.getElementById("hero-login-btn");
  const navLoginBtn = document.getElementById("nav-login-btn");
  const emailInput = document.getElementById("email");

  if (!storeLink || !diamonds || !heroLoginBtn || !navLoginBtn) {
    console.error("One or more HTML elements are missing.");
    return;
  }

  if (user) {
    await saveUser(user);

    storeLink.style.display = "inline-block";
    diamonds.classList.remove("hidden");
    heroLoginBtn.style.display = "none";

    navLoginBtn.innerHTML = "LOGOUT";
    navLoginBtn.onclick = logout;

    if (emailInput) {
      emailInput.value = user.email;
    }
  } else {
    storeLink.style.display = "none";
    diamonds.classList.add("hidden");
    heroLoginBtn.style.display = "inline-block";

    navLoginBtn.innerHTML = "LOGIN";
    navLoginBtn.onclick = signInWithGoogle;
  }
});

/* OPEN ORDER MODAL */
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

/* CLOSE MODAL */
window.closeModal = () => {
  const modal = document.getElementById("order-modal");

  if (modal) {
    modal.classList.add("hidden");
  }
};

/* COPY ACCOUNT NUMBER */
window.copyAccountNumber = async () => {
  const accountNumber = "7120004769";

  try {
    await navigator.clipboard.writeText(accountNumber);
    showToast("Account number copied ✅");
  } catch (err) {
    alert("Account number: " + accountNumber);
  }
};

/* ORDER ID */
window.generateOrderId = () => {
  return "SVG-" + Date.now().toString().slice(-8);
};

/* COMPLETE ORDER */
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
    await addDoc(collection(db, "orders"), {
      orderId: orderId,
      userId: user.uid,
      customerName: user.displayName,
      customerEmail: email,
      googleEmail: user.email,
      gameUID: uid,
      item: currentOrder.item,
      price: currentOrder.price,
      status: "pending",
      createdAt: serverTimestamp()
    });

    const message = `
SAVAGE STORE ORDER

ORDER ID: ${orderId}
ITEM: ${currentOrder.item}
PRICE: ₦${currentOrder.price.toLocaleString()}
FREE FIRE UID: ${uid}
EMAIL: ${email}
GOOGLE ACCOUNT: ${user.email}

I have made payment.
`;

    const whatsappURL =
      `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

    window.open(whatsappURL, "_blank");

    closeModal();

    document.getElementById("uid").value = "";
    document.getElementById("email").value = user.email;

    showToast(`Order submitted successfully ⚡ Order ID: ${orderId}`);
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

/* MOBILE MENU */
window.toggleMobileMenu = () => {
  const nav = document.querySelector("nav");

  if (nav) {
    nav.classList.toggle("active");
  }
};

/* ESC KEY CLOSE MODAL */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
  }
});

/* HEADER EFFECT */
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