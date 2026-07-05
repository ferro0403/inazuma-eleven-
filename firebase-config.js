(() => {
  "use strict";

  window.INAZUMA_FIREBASE_READY = false;
  window.INAZUMA_FIREBASE_APP = null;
  window.INAZUMA_FIRESTORE = null;
  window.INAZUMA_FIREBASE_AUTH = null;

  const firebaseConfig = {
    apiKey: "AIzaSyBY056C0uCWdX8iUlxVpxYwQ0IFjDpYfpc",
    authDomain: "inazuma-ratings.firebaseapp.com",
    projectId: "inazuma-ratings",
    storageBucket: "inazuma-ratings.firebasestorage.app",
    messagingSenderId: "377615236481",
    appId: "1:377615236481:web:3c187fb57a59939f69fc80",
    measurementId: "G-QFYDDM2G79",
  };

  try {
    if (!window.firebase || typeof window.firebase.initializeApp !== "function") return;
    const app = window.firebase.apps && window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(firebaseConfig);
    const firestore = typeof window.firebase.firestore === "function" ? window.firebase.firestore(app) : null;
    const auth = typeof window.firebase.auth === "function" ? window.firebase.auth(app) : null;
    window.INAZUMA_FIREBASE_APP = app;
    window.INAZUMA_FIRESTORE = firestore;
    window.INAZUMA_FIREBASE_AUTH = auth;
    window.INAZUMA_FIREBASE_READY = Boolean(app && firestore);
  } catch (error) {
    console.warn("Firebase initialization failed; Player Ratings will use localStorage only.", error);
    window.INAZUMA_FIREBASE_READY = false;
  }
})();
