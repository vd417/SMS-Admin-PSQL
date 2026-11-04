/* Background banners for the School CRM. The page registers this worker. */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCblK72KXTNVLUWaUrEz4mAdFZLAFnUOI4',
  authDomain: 'sms-1085d.firebaseapp.com',
  projectId: 'sms-1085d',
  storageBucket: 'sms-1085d.firebasestorage.app',
  messagingSenderId: '157548521334',
  appId: '1:157548521334:web:a94ffd5f1b621b589ffc57',
});

firebase.messaging().onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'SchoolMate';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, { body });
});
