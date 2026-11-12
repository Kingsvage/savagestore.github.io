// Firebase Configuration
// ⚠️ IMPORTANT: These credentials are public-facing (frontend only)
// Firestore Security Rules enforce all data access control
// Do NOT put sensitive admin keys or secrets here

export const firebaseConfig = {
  apiKey: "AIzaSyB7W0bvFnDfEUzuwuAIoGCwRakfFiTEt48",
  authDomain: "savage-store-18507.firebaseapp.com",
  databaseURL: "https://savage-store-18507-default-rtdb.firebaseio.com",
  projectId: "savage-store-18507",
  storageBucket: "savage-store-18507.firebasestorage.app",
  messagingSenderId: "521961005705",
  appId: "1:521961005705:web:216bf71293154e67c29c58",
  measurementId: "G-86K4ZGMZQ4"
};

// Email.js Configuration
export const emailConfig = {
  serviceId: "service_3ut8kuo",
  templateId: "template_jeabwaa",
  publicKey: "VGMXshIsMZlghPhDW"
};

// Admin Configuration
export const adminConfig = {
  emails: ["chukwumachidozie18@gmail.com"]
};

// Load navigation overrides on every page that imports this shared config.
if (typeof document !== "undefined" && !document.getElementById("nav-fixes-styles")) {
  const navigationStyles = document.createElement("link");
  navigationStyles.id = "nav-fixes-styles";
  navigationStyles.rel = "stylesheet";
  navigationStyles.href = new URL("./nav-fixes.css", import.meta.url).href;
  document.head.appendChild(navigationStyles);
}
