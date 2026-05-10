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
  getDoc,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// FIREBASE CONFIG
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


// INITIALIZE
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

const provider = new GoogleAuthProvider();


// GLOBAL ORDER
let currentOrder = {
  item:"",
  price:0
};


// SCROLL
window.scrollToSection = (id) => {

  document.getElementById(id).scrollIntoView({
    behavior:"smooth"
  });
};


// LOGIN
window.signInWithGoogle = async () => {

  try{

    const result = await signInWithPopup(auth,provider);

    const user = result.user;

    // SAVE USER
    await setDoc(doc(db,"users",user.uid),{

      uid:user.uid,
      name:user.displayName,
      email:user.email,
      photo:user.photoURL,

      createdAt:serverTimestamp()

    },{merge:true});

  }catch(err){

    console.log(err);
    alert(err.message);
  }
};


// LOGOUT
window.logout = async () => {

  await signOut(auth);
};


// AUTH STATE
onAuthStateChanged(auth,async(user)=>{

  const storeLink = document.getElementById("store-link");
  const diamonds = document.getElementById("diamonds");

  if(user){

    storeLink.style.display = "block";

    diamonds.classList.remove("hidden");

    // CHANGE NAV BUTTON
    document.querySelector(".nav-btn").innerHTML = "LOGOUT";

    document.querySelector(".nav-btn").onclick = logout;

    // USER ALREADY EXISTS?
    const userRef = doc(db,"users",user.uid);

    await getDoc(userRef);

  }else{

    storeLink.style.display = "none";

    diamonds.classList.add("hidden");

    document.querySelector(".nav-btn").innerHTML = "LOGIN";

    document.querySelector(".nav-btn").onclick = signInWithGoogle;
  }
});


// OPEN ORDER
window.openOrderModal = (item,price)=>{

  const user = auth.currentUser;

  if(!user){

    alert("Please login first ⚡");
    return;
  }

  currentOrder.item = item;
  currentOrder.price = price;

  document.getElementById("order-summary").innerHTML = `

    <strong>${item}</strong><br><br>

    Price: ₦${price.toLocaleString()}
  `;

  document.getElementById("order-modal")
  .classList.remove("hidden");
};


// CLOSE MODAL
window.closeModal = ()=>{

  document.getElementById("order-modal")
  .classList.add("hidden");
};


// COMPLETE ORDER
window.completeOrder = async ()=>{

  const uid = document.getElementById("uid").value.trim();
  const email = document.getElementById("email").value.trim();

  if(!uid || !email){

    alert("Please fill all fields.");
    return;
  }

  const user = auth.currentUser;

  if(!user){

    alert("Please login first.");
    return;
  }

  try{

    await addDoc(collection(db,"orders"),{

      userId:user.uid,
      customerName:user.displayName,
      customerEmail:user.email,

      gameUID:uid,

      item:currentOrder.item,
      price:currentOrder.price,

      status:"pending",

      createdAt:serverTimestamp()
    });

    const message = `

SAVAGE STORE ORDER

ITEM: ${currentOrder.item}
PRICE: ₦${currentOrder.price}
UID: ${uid}
EMAIL: ${email}

`;

    const whatsappURL =
`https://wa.me/2347120004769?text=${encodeURIComponent(message)}`;

    window.open(whatsappURL,"_blank");

    closeModal();

    alert("Order submitted successfully ⚡");

  }catch(err){

    console.log(err);

    alert(err.message);
  }
};


// HEADER EFFECT
window.addEventListener("scroll",()=>{

  const header = document.querySelector("header");

  if(window.scrollY > 40){

    header.style.background = "rgba(0,0,0,.8)";

    header.style.backdropFilter = "blur(10px)";

  }else{

    header.style.background = "transparent";

    header.style.backdropFilter = "none";
  }
});