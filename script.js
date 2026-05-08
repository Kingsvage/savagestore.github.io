import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, where, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

// EMAILJS INITIALIZATION
emailjs.init("VGMXshIsMZlghPhDW"); 

// BUSINESS SETTINGS
const ADMIN_PHONE = "2347120004769";
const ADMIN_EMAIL = "Chukwumachidozie18@gmail.com"; 
const BANK_DETAILS = { bank: "OPAY", account: "7120004769", name: "SAMUEL SEWANU OKESOLA" };

let activeOrder = null;
let currencySymbol = "₦";
let currencyRate = 1;

// 1. ADAPTIVE CURRENCY DETECTION
async function detectCurrency() {
    try {
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        const map = {
            "NG": { s: "₦", r: 1 },
            "US": { s: "$", r: 0.00065 },
            "GB": { s: "£", r: 0.00052 },
            "GH": { s: "GH₵", r: 0.011 }
        };
        if (map[data.country_code]) {
            currencySymbol = map[data.country_code].s;
            currencyRate = map[data.country_code].r;
        }
    } catch (e) { console.log("Defaulting to Naira"); }
}

function convert(naira) {
    const val = naira * currencyRate;
    return currencyRate === 1 ? val.toLocaleString() : val.toFixed(2);
}

// 2. AUTHENTICATION & INITIALIZATION
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await detectCurrency();
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        if(user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
            document.getElementById('admin-link').classList.remove('hidden');
        }
        initSavage();
    } else {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
    }
});

function initSavage() {
    document.getElementById('bank-name-display').innerText = BANK_DETAILS.bank;
    document.getElementById('bank-acc-display').innerText = BANK_DETAILS.account;
    document.getElementById('bank-user-display').innerText = BANK_DETAILS.name;
    
    // Update Resource Hub Prices
    document.getElementById('price-100').innerText = `${currencySymbol}${convert(1200)}`;
    document.getElementById('price-520').innerText = `${currencySymbol}${convert(5600)}`;
    document.getElementById('price-1060').innerText = `${currencySymbol}${convert(11000)}`;
    
    syncMarket();
    syncAdminOrders();
}

// 3. TRANSACTION LOGIC
window.openOrderModal = (item, price) => {
    activeOrder = { item, price };
    document.getElementById('order-summary').innerText = `INVOICE: ${item} | PRICE: ${currencySymbol}${convert(price)}`;
    document.getElementById('order-modal').classList.remove('hidden');
};

window.processFinalOrder = async () => {
    const uid = document.getElementById('cust-uid').value;
    const email = document.getElementById('cust-email').value;
    if(!uid || !email) return alert("UID AND EMAIL REQUIRED!");

    await addDoc(collection(db, "orders"), {
        uid, email, item: activeOrder.item, price: activeOrder.price,
        status: "PENDING", createdAt: Date.now()
    });

    const msg = `SAVAGE_ORDER:\nUID: ${uid}\nITEM: ${activeOrder.item}\nPRICE: ${currencySymbol}${convert(activeOrder.price)}`;
    window.open(`https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(msg)}`, '_blank');
    closeModal('order-modal');
};

// 4. ADMIN FULFILLMENT
function syncAdminOrders() {
    const q = query(collection(db, "orders"), where("status", "==", "PENDING"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('admin-orders-list');
        list.innerHTML = "";
        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            list.innerHTML += `
                <div class="card" style="border-left: 4px solid var(--gold)">
                    <p style="color:var(--teal); font-weight:bold">${data.item}</p>
                    <p>UID: ${data.uid}</p>
                    <p style="font-size:0.6rem; color:#888">${data.email}</p>
                    <button class="action-btn" onclick="completeOrder('${orderDoc.id}', '${data.email}', '${data.uid}', '${data.item}', ${data.price})">MARK DONE</button>
                </div>`;
        });
    });
}

window.completeOrder = async (id, email, uid, item, price) => {
    try {
        await updateDoc(doc(db, "orders", id), { status: "COMPLETED" });
        await emailjs.send("service_3ut8kuo", "template_jeabwaa", {
            to_name: email, order_item: item, uid: uid,
            price: convert(price), currency_symbol: currencySymbol
        });
        alert("FULFILLED: Email Dispatched to " + email);
    } catch (e) { alert("DB Updated, but Email Failed."); }
};

window.syncMarket = () => {
    const q = query(collection(db, "listings"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('market-grid');
        grid.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            grid.innerHTML += `
                <div class="card">
                    <h2 class="neon-text">${currencySymbol}${convert(data.price)}</h2>
                    <button class="action-btn" onclick="openOrderModal('ACCOUNT_${d.id.substring(0,4)}', ${data.price})">BUY_ASSET</button>
                </div>`;
        });
    });
};

// UTILITIES
window.signInWithGoogle = () => signInWithPopup(auth, provider);
window.userLogout = () => signOut(auth);
window.showSection = (id) => {
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`section-${id}`).classList.remove('hidden');
};
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.uploadAsset = async () => {
    const p = document.getElementById('p-price').value;
    if(p) await addDoc(collection(db, "listings"), { price: parseFloat(p), createdAt: Date.now() });
    closeModal('sell-modal');
};
