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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};


// INITIALIZE FIREBASE
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const provider = new GoogleAuthProvider();


// GLOBAL ORDER
let currentOrder = {
  item: "",
  price: 0
};


// SCROLL FUNCTION
window.scrollToSection = (id) => {

  document.getElementById(id).scrollIntoView({
    behavior: "smooth"
  });
};


// GOOGLE LOGIN
window.signInWithGoogle = async () => {

  try {

    const result =
      await signInWithPopup(auth, provider);

    const user = result.user;


    // SAVE USER TO FIRESTORE
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


    alert(`Welcome ${user.displayName} ⚡`);

  } catch (err) {

    console.log(err);

    alert(err.message);
  }
};


// LOGOUT
window.logout = async () => {

  try {

    await signOut(auth);

    alert("Logged out successfully ⚡");

  } catch (err) {

    console.log(err);

    alert(err.message);
  }
};


// AUTH STATE
onAuthStateChanged(auth, async (user) => {

  const storeLink =
    document.getElementById("store-link");

  const diamonds =
    document.getElementById("diamonds");

  const heroLoginBtn =
    document.getElementById("hero-login-btn");

  const navLoginBtn =
    document.getElementById("nav-login-btn");


  if (user) {

    // SHOW STORE
    storeLink.style.display = "inline-block";

    // SHOW DIAMONDS
    diamonds.classList.remove("hidden");

    // HIDE HERO LOGIN BUTTON
    heroLoginBtn.style.display = "none";

    // CHANGE NAV BUTTON TO LOGOUT
    navLoginBtn.innerHTML = "LOGOUT";

    navLoginBtn.onclick = logout;

  } else {

    // HIDE STORE
    storeLink.style.display = "none";

    // HIDE DIAMONDS
    diamonds.classList.add("hidden");

    // SHOW HERO LOGIN
    heroLoginBtn.style.display = "inline-block";

    // CHANGE NAV BUTTON TO LOGIN
    navLoginBtn.innerHTML = "LOGIN";

    navLoginBtn.onclick = signInWithGoogle;
  }
});


// OPEN ORDER MODAL
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


  document
    .getElementById("order-modal")
    .classList.remove("hidden");
};


// CLOSE MODAL
window.closeModal = () => {

  document
    .getElementById("order-modal")
    .classList.add("hidden");
};


// COMPLETE ORDER
window.completeOrder = async () => {

  const uid =
    document.getElementById("uid")
    .value
    .trim();

  const email =
    document.getElementById("email")
    .value
    .trim();


  if (!uid || !email) {

    alert("Please fill all fields ⚡");

    return;
  }


  const user = auth.currentUser;

  if (!user) {

    alert("Please login first ⚡");

    return;
  }


  try {

    // SAVE ORDER
    await addDoc(collection(db, "orders"), {

      userId: user.uid,

      customerName: user.displayName,

      customerEmail: user.email,

      gameUID: uid,

      item: currentOrder.item,

      price: currentOrder.price,

      status: "pending",

      createdAt: serverTimestamp()
    });


    // WHATSAPP MESSAGE
    const message = `

SAVAGE STORE ORDER

ITEM: ${currentOrder.item}
PRICE: ₦${currentOrder.price}
UID: ${uid}
EMAIL: ${email}

`;


    // CHANGE NUMBER HERE
    const whatsappURL =
      `https://wa.me/234XXXXXXXXXX?text=${encodeURIComponent(message)}`;


    // OPEN WHATSAPP
    window.open(whatsappURL, "_blank");


    // CLOSE MODAL
    closeModal();


    // CLEAR INPUTS
    document.getElementById("uid").value = "";

    document.getElementById("email").value = "";


    alert("Order submitted successfully ⚡");


  } catch (err) {

    console.log(err);

    alert(err.message);
  }
};


// ESC KEY CLOSE MODAL
document.addEventListener("keydown", (e) => {

  if (e.key === "Escape") {

    closeModal();
  }
});


// HEADER EFFECT
window.addEventListener("scroll", () => {

  const header =
    document.querySelector("header");


  if (window.scrollY > 40) {

    header.style.background =
      "rgba(0,0,0,.85)";

    header.style.backdropFilter =
      "blur(10px)";

  } else {

    header.style.background =
      "transparent";

    header.style.backdropFilter =
      "none";
  }
});