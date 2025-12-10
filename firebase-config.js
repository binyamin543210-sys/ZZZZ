// Firebase configuration and initialization
// Uses the config שסיפקת בצ'אט
// חשוב: הקובץ הזה נטען לפני app.js

// v9 modular style via CDN
// @ts-ignore
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
// @ts-ignore
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCa808qwjJ8bayhjkTqZ8P9fRhfgi19xtY",
  authDomain: "bnapp-ddcbf.firebaseapp.com",
  databaseURL: "https://bnapp-ddcbf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bnapp-ddcbf",
  storageBucket: "bnapp-ddcbf.firebasestorage.app",
  messagingSenderId: "523128255450",
  appId: "1:523128255450:web:d29cdda3f21435f96686e3",
  measurementId: "G-61DKZ1B5L2"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);
