import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

// REEMPLAZA estos valores con los de tu proyecto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCYUAL1Pjbtp88ovSK54Nh1Qx0D1iufxCE",
  authDomain: "codigo-qr-a41a8.firebaseapp.com",
  projectId: "codigo-qr-a41a8",
  storageBucket: "codigo-qr-a41a8.firebasestorage.app",
  messagingSenderId: "1022538964432",
  appId: "1:1022538964432:web:7f5e9cf178ec230385edd5"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
