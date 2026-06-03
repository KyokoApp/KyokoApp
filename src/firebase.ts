import { initializeApp, FirebaseApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  getFirestore,
  Firestore
} from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

// ═══════════════════════════════════════════════════════════════
// 1. CHAT — globalChat, chatUsers, presence, typing
//    presetStickers, presetAvatars, groups_info
// ═══════════════════════════════════════════════════════════════
const appChat = initializeApp({
  apiKey: "AIzaSyD_TsheU34GB_hn_r1hiA1i4ZUC7-Z1qSo",
  authDomain: "kyokochat-dc792.firebaseapp.com",
  projectId: "kyokochat-dc792",
  storageBucket: "kyokochat-dc792.firebasestorage.app",
  messagingSenderId: "730376199922",
  appId: "1:730376199922:web:e236b7caabbaa11c053a6b"
}, 'chat')

// ⚠️  FIX: persistentMultipleTabManager → persistentSingleTabManager
// MultipleTabManager pakai BroadcastChannel yang tidak support di Android WebView!
// SingleTabManager aman di semua environment (web, PWA, Capacitor).
export const dbChat = initializeFirestore(appChat, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
})

// ═══════════════════════════════════════════════════════════════
// 2-4. RPG SHARD 1, 2, 3
// ═══════════════════════════════════════════════════════════════
const appRpg1 = initializeApp({
  apiKey: "AIzaSyBoIyBKvmEAav6tCZ2deXjXhylAPjnTdSA",
  authDomain: "kyokorpg1.firebaseapp.com",
  projectId: "kyokorpg1",
  storageBucket: "kyokorpg1.firebasestorage.app",
  messagingSenderId: "1027115501521",
  appId: "1:1027115501521:web:44ece9f0070e1786abc2f0"
}, 'rpg1')

const appRpg2 = initializeApp({
  apiKey: "AIzaSyD8Kfav-wDVVYuVjdPUrmqbVzIkl1Ztjw0",
  authDomain: "kyokorpg2.firebaseapp.com",
  projectId: "kyokorpg2",
  storageBucket: "kyokorpg2.firebasestorage.app",
  messagingSenderId: "143692722959",
  appId: "1:143692722959:web:4a3163f0717f66ad6fc47a"
}, 'rpg2')

const appRpg3 = initializeApp({
  apiKey: "AIzaSyDyqtGmjsxtu337KRZzzF2hf10e-k5W2Rk",
  authDomain: "kyokorpg3.firebaseapp.com",
  projectId: "kyokorpg3",
  storageBucket: "kyokorpg3.firebasestorage.app",
  messagingSenderId: "987099196778",
  appId: "1:987099196778:web:1831086d569a88036d0913"
}, 'rpg3')

export const dbRpg1 = getFirestore(appRpg1)
export const dbRpg2 = getFirestore(appRpg2)
export const dbRpg3 = getFirestore(appRpg3)

export function getRpgDb(uid: string): Firestore {
  if (!uid) return dbRpg1
  const first = uid[0].toLowerCase()
  if ('0123456789abcdefghi'.includes(first)) return dbRpg1
  if ('jklmnopqr'.includes(first)) return dbRpg2
  return dbRpg3
}

// ═══════════════════════════════════════════════════════════════
// 5. COMMUNITY
// ═══════════════════════════════════════════════════════════════
const appCommunity = initializeApp({
  apiKey: "AIzaSyCR31TsSG3xj1OFKVKPHa53f3_UPXFxSGI",
  authDomain: "kyokocomunity.firebaseapp.com",
  projectId: "kyokocomunity",
  storageBucket: "kyokocomunity.firebasestorage.app",
  messagingSenderId: "119916958650",
  appId: "1:119916958650:web:77898a123e7fc7b2c24383"
}, 'community')

export const dbCommunity = initializeFirestore(appCommunity, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
})

// ═══════════════════════════════════════════════════════════════
// 6. ADMIN
// ═══════════════════════════════════════════════════════════════
const appAdmin = initializeApp({
  apiKey: "AIzaSyCdEUk_0pPM_oUlwbhGA2j8-sX0RsoXcRw",
  authDomain: "kyokoadmin.firebaseapp.com",
  projectId: "kyokoadmin",
  storageBucket: "kyokoadmin.firebasestorage.app",
  messagingSenderId: "949808881814",
  appId: "1:949808881814:web:afe5159e81eb08491e62b7"
}, 'admin')

export const dbAdmin = initializeFirestore(appAdmin, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
})

// ═══════════════════════════════════════════════════════════════
// 7. BONUS
// ═══════════════════════════════════════════════════════════════
const appBonus = initializeApp({
  apiKey: "AIzaSyBBdDhf0VQgST6bdfIt6WgBe-JVt-OxvSI",
  authDomain: "kyokobonus.firebaseapp.com",
  projectId: "kyokobonus",
  storageBucket: "kyokobonus.firebasestorage.app",
  messagingSenderId: "722266253162",
  appId: "1:722266253162:web:ec515a7c58616d55a06713"
}, 'bonus')

export const dbBonus = initializeFirestore(appBonus, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
})

// ═══════════════════════════════════════════════════════════════
// AUTH — pakai project Chat sebagai auth utama
// ═══════════════════════════════════════════════════════════════
export const auth = getAuth(appChat)
export const googleProvider = new GoogleAuthProvider()

// LEGACY ALIAS
export const db = dbChat
