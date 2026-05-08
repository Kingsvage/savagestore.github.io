import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, where, updateDoc, doc, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

emailjs.init("VGMXshIsMZlghPhDW"); 

const ADMIN_PHONE = "2347120004769";
const ADMIN_EMAIL = "Chukwumachidozie18@gmail.com"; 
const BANK = { name: "OPAY", acc: "7120004769", user: "SAMUEL SEWANU OKESOLA" };

let activeOrder = null;
let currencySymbol = "₦";
let currencyRate = 1;

async function detectCurrency() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        const map = { "NG": { s: "₦", r: 1 }, "US": { s: "$", r: 0.00065 }, "GB": { s: "£", r: 0.00052 }, "GH": { s: "GH₵", r: 0.011 } };
        if (map[data.country_code]) { currencySymbol = map[data.country_code].s; currencyRate = map[data.country_code].r; }
    } catch (e) { console.log("Detect fail"); }
}

function convert(naira) {
    const val = naira * currencyRate;
    return currencyRate === 1 ? val.toLocaleString() : val.toFixed(2);
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await detectCurrency();
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        if(user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) document.getElementById('admin-link').classList.remove('hidden');
        initSavage();
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
    }
});

function initSavage() {
    document.getElementById('bank-name-display').innerText = BANK.name;
    document.getElementById('bank-acc-display').innerText = BANK.acc;
    document.getElementById('bank-user-display').innerText = BANK.user;
    
    const prices = { 100: 1200, 520: 5600, 1060: 11000, weekly: 2500 };
    Object.keys(prices).forEach(key => {
        const p = `${currencySymbol}${convert(prices[key])}`;
        if(document.getElementById(`price-${key}`)) document.getElementById(`price-${key}`).innerText = p;
        if(document.getElementById(`home-price-${key}`)) document.getElementById(`home-price-${key}`).innerText = p;
    });

    syncMarket();
    syncHomeRecent();
    syncAdminOrders();
}

window.openOrderModal = (item, price) => {
    activeOrder = { item, price };
    document.getElementById('order-summary').innerText = `${item} | ${currencySymbol}${convert(price)}`;
    document.getElementById('order-modal').classList.remove('hidden');
};

window.processFinalOrder = async () => {
    const uid = document.getElementById('cust-uid').value;
    const email = document.getElementById('cust-email').value;
    if(!uid || !email) return alert("Fill all fields!");
    await addDoc(collection(db, "orders"), { uid, email, item: activeOrder.item, price: activeOrder.price, status: "PENDING", createdAt: Date.now() });
    window.open(`https://wa.me/${ADMIN_PHONE}?text=ORDER:${activeOrder.item}-UID:${uid}`, '_blank');
    closeModal('order-modal');
};

function syncHomeRecent() {
    const q = query(collection(db, "listings"), orderBy("createdAt", "desc"), limit(3));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('home-recent-grid');
        grid.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            grid.innerHTML += `<div class="card"><p style="font-size:0.6rem">RECENT_ASSET</p><h2>${currencySymbol}${convert(data.price)}</h2><button class="action-btn" onclick="openOrderModal('ACCOUNT_${d.id.substring(0,4)}', ${data.price})">VIEW</button></div>`;
        });
    });
}

function syncAdminOrders() {
    const q = query(collection(db, "orders"), where("status", "==", "PENDING"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('admin-orders-list');
        list.innerHTML = "";
        snap.forEach(oDoc => {
            const data = oDoc.data();
            list.innerHTML += `<div class="card" style="border-left:4px solid var(--gold)"><h4>${data.item}</h4><p>UID: ${data.uid}</p><button class="action-btn" onclick="completeOrder('${oDoc.id}','${data.email}','${data.uid}','${data.item}',${data.price})">DONE</button></div>`;
        });
    });
}

window.completeOrder = async (id, email, uid, item, price) => {
    try {
        await updateDoc(doc(db, "orders", id), { status: "COMPLETED" });
        await emailjs.send("service_3ut8kuo", "template_jeabwaa", { to_name: email, order_item: item, uid: uid, price: convert(price), currency_symbol: currencySymbol });
        alert("Fulfilled!");
    } catch (e) { alert("Email Failed"); }
};

window.syncMarket = () => {
    const q = query(collection(db, "listings"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('market-grid');
        grid.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            grid.innerHTML += `<div class="card"><h2>${currencySymbol}${convert(data.price)}</h2><button class="action-btn" onclick="openOrderModal('ACCOUNT_${d.id.substring(0,4)}', ${data.price})">PURCHASE</button></div>`;
        });
    });
};

window.signInWithGoogle = () => signInWithPopup(auth, provider);
window.userLogout = () => signOut(auth);
window.showSection = (id) => { document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden')); document.getElementById(`section-${id}`).classList.remove('hidden'); };
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.uploadAsset = async () => { const p = document.getElementById('p-price').value; if(p) await addDoc(collection(db, "listings"), { price: parseFloat(p), createdAt: Date.now() }); closeModal('sell-modal'); };
