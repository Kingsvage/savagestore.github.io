import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { adminConfig, firebaseConfig } from "./config.js";

const app = getApps().find((existingApp) => existingApp.name === "[DEFAULT]") || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const allowedAdminEmails = new Set(adminConfig.emails.map((email) => email.trim().toLowerCase()));

function setAdminVisibility(authorized) {
  document.body.classList.toggle("admin-authorized", authorized);
  const adminLink = document.getElementById("admin-link");
  if (adminLink) {
    adminLink.hidden = !authorized;
    adminLink.setAttribute("aria-hidden", String(!authorized));
    adminLink.tabIndex = authorized ? 0 : -1;
  }
}

onAuthStateChanged(auth, async (user) => {
  setAdminVisibility(false);
  if (!user || !user.email || !user.emailVerified || !allowedAdminEmails.has(user.email.trim().toLowerCase())) return;

  try {
    const adminRecord = await getDoc(doc(db, "admins", user.uid));
    if (!adminRecord.exists()) return;
    const recordEmail = adminRecord.data()?.email;
    if (recordEmail && recordEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) return;
    setAdminVisibility(true);
  } catch (error) {
    console.error("ADMIN PAGE AUTHORIZATION CHECK FAILED:", error);
    setAdminVisibility(false);
  }
});

function syncScrolledHeader() {
  const header = document.querySelector("header");
  if (!header) return;
  const shouldFixHeader = window.scrollY > 40;
  const spacerId = "navigation-scroll-spacer";
  let spacer = document.getElementById(spacerId);

  if (shouldFixHeader) {
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.id = spacerId;
      spacer.className = "navigation-scroll-spacer";
      spacer.setAttribute("aria-hidden", "true");
      header.after(spacer);
    }
    spacer.style.height = `${header.offsetHeight}px`;
    header.classList.add("is-scrolled");
  } else {
    header.classList.remove("is-scrolled");
    spacer?.remove();
  }
}

window.addEventListener("scroll", syncScrolledHeader, { passive: true });
window.addEventListener("resize", syncScrolledHeader);
document.addEventListener("DOMContentLoaded", syncScrolledHeader);
syncScrolledHeader();
