import React, { useEffect, useRef, useState, useCallback, memo, Suspense } from 'react'
const GameRpg = React.lazy(() => import('./GameRpg'))
import AnimeStreamPanel from './AnimeStreamPanel'
import DrakorStreamPanel from './DrakorStreamPanel'
import MangaStreamPanel from './MangaStreamPanel'
import MangaCrossPanel from './MangaCrossPanel'
import KyoNovelPanel from './KyoNovelPanel'
import { auth, googleProvider, dbChat, getRpgDb } from './firebase'
import {
  rpgSaveLocal, rpgLoadLocal, rpgSyncToFirebase, rpgNeedsSync,
  markLocalChanges, getSyncMeta, setSyncMeta,
  queueTransfer, getPendingTransfers, executePendingTransfers,
  setupOnlineListener, isOnline, hasCachedAuth,
} from './rpgStore'
import PlanetPanel from './PlanetPanel'
import {
  collection, doc, setDoc, addDoc, onSnapshot, orderBy, query,
  serverTimestamp, getDoc, limit, updateDoc, deleteDoc, increment,
  arrayUnion, arrayRemove, where, getDocs
} from 'firebase/firestore'
import {
  signInWithPopup, signInWithRedirect, signOut,
  onAuthStateChanged, User
} from 'firebase/auth'
import GameOfflinePanel, { OfflineGamesMenu, CaturGame, SnakeGame, TicTacToeGame, MemoryCardGame } from './GameOfflinePanel'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface GcMessage {
  id: string; uid: string; username: string; photoURL: string
  text: string; createdAt: number; type?: 'text' | 'sticker' | 'rpg-event'
  stickerUrl?: string
  replyToId?: string; replyToUser?: string; replyToText?: string
}
interface StickerItem { id: string; url: string; enabled: boolean }

// ── Global music state (survive panel close/open) ──────────────
let _globalAudio: HTMLAudioElement | null = null
let _globalNowPlaying: {url:string;title:string;thumbnail?:string} | null = null
function getGlobalAudio() { return _globalAudio }
function setGlobalAudio(a: HTMLAudioElement | null) { _globalAudio = a }
function getGlobalNowPlaying() { return _globalNowPlaying }
function setGlobalNowPlaying(v: {url:string;title:string;thumbnail?:string}|null) { _globalNowPlaying = v }

// ── Music category detection ────────────────────────────────────
const MUSIC_CATEGORIES: Record<string, string[]> = {
  'dj': ['dj', 'remix', 'nonstop', 'bootleg', 'mashup', 'mix', 'edit', 'vip', 'extended'],
  'pop': ['pop', 'top hits', 'chart', 'billboard', 'trending', 'viral'],
  'rock': ['rock', 'metal', 'punk', 'grunge', 'alternative', 'indie', 'band'],
  'rnb': ['r&b', 'rnb', 'soul', 'neo soul', 'funk', 'groove'],
  'hip hop': ['hip hop', 'hiphop', 'rap', 'trap', 'drill', 'freestyle', 'cypher'],
  'jazz': ['jazz', 'blues', 'swing', 'bossa nova', 'lofi', 'lo-fi', 'chill'],
  'kpop': ['kpop', 'k-pop', 'bts', 'blackpink', 'twice', 'aespa', 'newjeans', 'stray kids', 'ive'],
  'electronic': ['edm', 'electronic', 'house', 'techno', 'trance', 'dubstep', 'drum and bass', 'dnb'],
  'acoustic': ['acoustic', 'unplugged', 'live', 'cover', 'guitar', 'piano', 'instrumental'],
  'dangdut': ['dangdut', 'koplo', 'jaipongan', 'campursari', 'keroncong'],
}

function detectMusicCategory(title: string): string | null {
  const lower = title.toLowerCase()
  for (const [category, keywords] of Object.entries(MUSIC_CATEGORIES)) {
    if (keywords.some(kw => lower.includes(kw))) return category
  }
  return null
}

function getAutoplayQuery(title: string): string {
  const category = detectMusicCategory(title)
  if (category) return category + ' music'
  // fallback: ambil kata pertama judul (bersihkan dari tanda baca)
  const firstWord = title.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/)[0] || title
  return firstWord
}
interface GroupInfo {
  id: string; name: string; desc: string; iconUrl: string
  ownerId: string; ownerName: string; admins: string[]
  members: string[]; memberNames: Record<string, string>; createdAt: number
}
interface RpgChar {
  uid: string; username: string; class: RpgClass; level: number; exp: number
  hp: number; maxHp: number; mp: number; maxMp: number
  atk: number; def: number; spd: number; luck: number
  gold: number; inventory: string[]; skills: string[]
  activeQuest: string | null; questProgress: number; kills: number
  titles: string[]; element: RpgElement; wins: number; losses: number
  party?: string[]       // gacha char ids in party (max 4)
  dungeonKills?: number  // total dungeon boss kills
  dailyMissions?: { date: string; completed: string[]; claimed: string[] }
  energy?: number        // burst energy 0-100
  ores?: Record<string, number>          // mining materials
  crops?: {type:string;plantedAt:number;slots:number}[]  // farm slots
  foodBuffs?: {type:string;expiresAt:number;stat:string;value:number}[]  // active food buffs
  trainCooldowns?: Record<string, number>   // last training timestamp per stat
  duelRecord?: {wins:number;losses:number}  // duel PvP record
  investments?: {amount:number;returnAt:number;mult:number}[]  // investasi
  weaponLevel?: number     // weapon upgrade level (0-10)
  wildQuestCooldown?: number   // timestamp: when next wild quest is available (2 jam cooldown)
  duelCooldown?: number        // timestamp: kapan duel bisa dilakukan lagi (5 menit cooldown)
  mineSessionStart?: number    // timestamp: when active 10-min mining session started (0 = not active)
}
interface ActiveBattleInfo {
  uid: string; username: string; class: RpgClass
  playerHp: number; playerMaxHp: number; playerMp: number; playerMaxMp: number
  monsterName: string; monsterEmoji: string; monsterHp: number; monsterMaxHp: number
  updatedAt: number
}
type RpgClass = 'Warrior' | 'Mage' | 'Rogue' | 'Paladin' | 'Archer' | 'Necromancer' | 'Berserker' | 'Summoner'
type RpgElement = 'Fire' | 'Water' | 'Earth' | 'Wind' | 'Dark' | 'Light' | 'Thunder' | 'Ice'

// ═══════════════════════════════════════════════════════════════
// RPG DATA
// ═══════════════════════════════════════════════════════════════
const RPG_CLASSES: Record<RpgClass, { emoji: string; desc: string; baseHp: number; baseMp: number; atk: number; def: number; spd: number; luck: number; skills: string[] }> = {
  Warrior:    { emoji: '⚔️',  desc: 'Pejuang tangguh, tinggi HP & DEF', baseHp: 500, baseMp: 120,  atk: 18, def: 15, spd: 10, luck: 8,  skills: ['Slash', 'Shield Bash', 'War Cry', 'Berserker Mode'] },
  Mage:       { emoji: '🔮',  desc: 'Penyihir kuat, damage tinggi', baseHp: 320,  baseMp: 300, atk: 28, def: 5,  spd: 12, luck: 10, skills: ['Fireball', 'Ice Lance', 'Thunder Storm', 'Meteor'] },
  Rogue:      { emoji: '🗡️',  desc: 'Pencuri cepat, kritis tinggi', baseHp: 380, baseMp: 180,  atk: 22, def: 8,  spd: 22, luck: 20, skills: ['Backstab', 'Poison Blade', 'Shadow Step', 'Assassinate'] },
  Paladin:    { emoji: '🛡️',  desc: 'Pendekar suci, healer & tank', baseHp: 480, baseMp: 220,  atk: 15, def: 20, spd: 8,  luck: 12, skills: ['Holy Strike', 'Heal', 'Divine Shield', 'Judgment'] },
  Archer:     { emoji: '🏹',  desc: 'Pemanah akurat, serangan jarak jauh', baseHp: 350,  baseMp: 200,  atk: 24, def: 7,  spd: 18, luck: 15, skills: ['Arrow Rain', 'Piercing Shot', 'Eagle Eye', 'Volley'] },
  Necromancer:{ emoji: '💀',  desc: 'Pengontrol kematian, summon undead', baseHp: 330,  baseMp: 280, atk: 25, def: 6,  spd: 11, luck: 9,  skills: ['Soul Drain', 'Raise Dead', 'Death Curse', 'Lich Form'] },
  Berserker:  { emoji: '🪓',  desc: 'Barbar liar, ATK paling tinggi', baseHp: 450, baseMp: 100,  atk: 35, def: 6,  spd: 14, luck: 7,  skills: ['Frenzy', 'Blood Rage', 'Devastate', 'Rampage'] },
  Summoner:   { emoji: '🐉',  desc: 'Pemanggil makhluk, serba bisa', baseHp: 360,  baseMp: 260, atk: 20, def: 10, spd: 13, luck: 14, skills: ['Summon Wolf', 'Dragon Breath', 'Spirit Army', 'Ancient Beast'] },
}
const ELEMENTS: RpgElement[] = ['Fire','Water','Earth','Wind','Dark','Light','Thunder','Ice']
const ELEMENT_EMOJI: Record<RpgElement, string> = {
  Fire:'🔥', Water:'💧', Earth:'🌿', Wind:'🌪️', Dark:'🌑', Light:'✨', Thunder:'⚡', Ice:'❄️'
}
const MONSTERS = [
  // rank F — diperberat 2.5x HP, +heal ability
  { name: 'Slime Biru',     emoji: '🟦', hp: 380,   atk: 10,  def: 3,  exp: 15,  gold: 8,   rank: 'F', drop: 'Lendir Slime',   canHeal: false, canShield: false },
  { name: 'Goblin',         emoji: '👺', hp: 550,   atk: 15,  def: 6,  exp: 25,  gold: 15,  rank: 'F', drop: 'Telinga Goblin', canHeal: false, canShield: false },
  // rank E
  { name: 'Wolf Hutan',     emoji: '🐺', hp: 780,   atk: 22,  def: 8,  exp: 40,  gold: 22,  rank: 'E', drop: 'Taring Wolf',    canHeal: false, canShield: true  },
  { name: 'Orc Prajurit',   emoji: '👹', hp: 1100,  atk: 28,  def: 13, exp: 65,  gold: 35,  rank: 'E', drop: 'Baju Orc Rusak', canHeal: false, canShield: true  },
  // rank D
  { name: 'Undead Knight',  emoji: '💀', hp: 1500,  atk: 35,  def: 18, exp: 90,  gold: 50,  rank: 'D', drop: 'Tulang Rune',    canHeal: true,  canShield: true  },
  { name: 'Dark Elf',       emoji: '🧝', hp: 1350,  atk: 42,  def: 15, exp: 110, gold: 60,  rank: 'D', drop: 'Busur Gelap',    canHeal: true,  canShield: false },
  // rank C
  { name: 'Ice Golem',      emoji: '🧊', hp: 2200,  atk: 35,  def: 32, exp: 140, gold: 75,  rank: 'C', drop: 'Kristal Es',     canHeal: false, canShield: true  },
  { name: 'Thunder Wyvern', emoji: '🦅', hp: 2000,  atk: 50,  def: 22, exp: 170, gold: 90,  rank: 'C', drop: 'Sisik Petir',    canHeal: true,  canShield: false },
  // rank B
  { name: 'Demon Samurai',  emoji: '👿', hp: 2800,  atk: 60,  def: 28, exp: 220, gold: 120, rank: 'B', drop: 'Katana Setan',   canHeal: true,  canShield: true  },
  { name: 'Ancient Lich',   emoji: '🦴', hp: 3200,  atk: 72,  def: 25, exp: 280, gold: 150, rank: 'B', drop: 'Mahkota Lich',   canHeal: true,  canShield: true  },
  // rank A
  { name: 'Fire Dragon',    emoji: '🐲', hp: 5000,  atk: 88,  def: 38, exp: 400, gold: 220, rank: 'A', drop: 'Sisik Naga Api', canHeal: true,  canShield: true  },
  { name: 'Void Titan',     emoji: '🌌', hp: 5800,  atk: 95,  def: 44, exp: 500, gold: 280, rank: 'A', drop: 'Inti Kehampaan', canHeal: true,  canShield: true  },
  // rank S
  { name: 'Abyss Lord',     emoji: '😈', hp: 8000,  atk: 120, def: 58, exp: 700, gold: 400, rank: 'S', drop: 'Jiwa Jurang',    canHeal: true,  canShield: true  },
  { name: 'Celestial Beast',emoji: '🦁', hp: 9500,  atk: 135, def: 65, exp: 900, gold: 500, rank: 'S', drop: 'Kristal Langit', canHeal: true,  canShield: true  },
  // rank SS
  { name: 'World Serpent',  emoji: '🐍', hp: 13000, atk: 160, def: 75, exp: 1200,gold: 700, rank: 'SS',drop: 'Sisik Dunia',    canHeal: true,  canShield: true  },
  // rank SSS (20 musuh tambahan, semakin tinggi semakin kuat)
  { name: 'Shadow Phantom',  emoji: '👁️', hp: 16000, atk: 180, def: 85,  exp: 1600, gold: 900,  rank: 'SSS', drop: 'Inti Bayangan',    canHeal: true,  canShield: true  },
  { name: 'Crimson Hydra',   emoji: '🐉', hp: 18500, atk: 195, def: 90,  exp: 1900, gold: 1050, rank: 'SSS', drop: 'Darah Hydra',      canHeal: true,  canShield: true  },
  { name: 'Soul Reaper',     emoji: '💫', hp: 21000, atk: 215, def: 98,  exp: 2200, gold: 1200, rank: 'SSS', drop: 'Sabit Jiwa',       canHeal: true,  canShield: true  },
  { name: 'Abyssal Kraken',  emoji: '🦑', hp: 24000, atk: 230, def: 105, exp: 2600, gold: 1400, rank: 'SSS', drop: 'Tentakel Abyss',   canHeal: true,  canShield: true  },
  { name: 'Void Archon',     emoji: '🌀', hp: 27500, atk: 250, def: 115, exp: 3000, gold: 1650, rank: 'SSS', drop: 'Kristal Void',     canHeal: true,  canShield: true  },
  { name: 'Titan Berserker', emoji: '🪓', hp: 31000, atk: 275, def: 122, exp: 3500, gold: 1900, rank: 'SSS', drop: 'Kapak Titan',      canHeal: true,  canShield: true  },
  { name: 'Fallen Seraph',   emoji: '👼', hp: 35000, atk: 295, def: 132, exp: 4000, gold: 2200, rank: 'SSS', drop: 'Sayap Malaikat',   canHeal: true,  canShield: true  },
  { name: 'Chaos Leviathan', emoji: '🌊', hp: 40000, atk: 320, def: 142, exp: 4600, gold: 2500, rank: 'SSS', drop: 'Sisik Leviathan',  canHeal: true,  canShield: true  },
  { name: 'Hellfire Golem',  emoji: '🔥', hp: 45000, atk: 345, def: 155, exp: 5200, gold: 2900, rank: 'SSS', drop: 'Batu Api Neraka',  canHeal: true,  canShield: true  },
  { name: 'Thunder God',     emoji: '⚡', hp: 51000, atk: 375, def: 168, exp: 6000, gold: 3300, rank: 'SSS', drop: 'Petir Dewa',       canHeal: true,  canShield: true  },
  { name: 'Frost Ancient',   emoji: '❄️', hp: 58000, atk: 400, def: 182, exp: 6800, gold: 3800, rank: 'SSS', drop: 'Es Abadi',         canHeal: true,  canShield: true  },
  { name: 'Dusk Sovereign',  emoji: '🌑', hp: 66000, atk: 430, def: 198, exp: 7800, gold: 4400, rank: 'SSS', drop: 'Mahkota Senja',    canHeal: true,  canShield: true  },
  { name: 'Primal Beast',    emoji: '🦬', hp: 75000, atk: 465, def: 215, exp: 8800, gold: 5000, rank: 'SSS', drop: 'Taring Purba',     canHeal: true,  canShield: true  },
  { name: 'Astral Colossus', emoji: '🌟', hp: 85000, atk: 500, def: 235, exp: 1e4,  gold: 5800, rank: 'SSS', drop: 'Shard Astral',     canHeal: true,  canShield: true  },
  { name: 'Nether Wraith',   emoji: '🩻', hp: 96000, atk: 540, def: 255, exp: 11500,gold: 6600, rank: 'SSS', drop: 'Jiwa Nether',      canHeal: true,  canShield: true  },
  { name: 'Undying Titan',   emoji: '🤖', hp: 110000,atk: 580, def: 278, exp: 13000,gold: 7600, rank: 'SSS', drop: 'Inti Abadi',       canHeal: true,  canShield: true  },
  { name: 'Dimensional Rift',emoji: '🕳️', hp: 125000,atk: 625, def: 302, exp: 15000,gold: 8800, rank: 'SSS', drop: 'Celah Dimensi',    canHeal: true,  canShield: true  },
  { name: 'God of Ruin',     emoji: '💀', hp: 145000,atk: 680, def: 330, exp: 17500,gold: 10000,rank: 'SSS', drop: 'Mahkota Kehancuran',canHeal:true,  canShield: true  },
  { name: 'Eternal Dragon',  emoji: '🐲', hp: 170000,atk: 740, def: 362, exp: 20000,gold: 12000,rank: 'SSS', drop: 'Sisik Naga Abadi', canHeal: true,  canShield: true  },
  { name: 'Omnigod',         emoji: '👁️', hp: 200000,atk: 820, def: 400, exp: 25000,gold: 15000,rank: 'SSS', drop: 'Inti Omnigod',     canHeal: true,  canShield: true  },
]
const QUESTS = [
  { id: 'q1', name: 'Pembersihan Hutan',     desc: 'Bunuh 5 monster rank F-E',    kills: 5,  ranks: ['F','E'],         expReward: 100, goldReward: 50,  itemReward: 'Pedang Besi' },
  { id: 'q2', name: 'Pemburu Goblin',        desc: 'Bunuh 10 Goblin',             kills: 10, ranks: ['F'],             expReward: 200, goldReward: 100, itemReward: 'Helm Goblin' },
  { id: 'q3', name: 'Hantu Kegelapan',       desc: 'Bunuh 8 monster rank D',      kills: 8,  ranks: ['D'],             expReward: 350, goldReward: 175, itemReward: 'Cape Gelap' },
  { id: 'q4', name: 'Ksatria Baja',          desc: 'Bunuh 5 monster rank C',      kills: 5,  ranks: ['C'],             expReward: 500, goldReward: 250, itemReward: 'Armor Baja' },
  { id: 'q5', name: 'Pembantai Iblis',       desc: 'Bunuh 3 monster rank B',      kills: 3,  ranks: ['B'],             expReward: 800, goldReward: 400, itemReward: 'Pedang Iblis' },
  { id: 'q6', name: 'Legenda Naga',          desc: 'Bunuh 1 naga rank A atau S',  kills: 1,  ranks: ['A','S','SS'],    expReward:1500, goldReward: 800, itemReward: 'Jubah Naga' },
  { id: 'q7', name: 'Pembasmi Semua',        desc: 'Bunuh 20 monster apapun',     kills: 20, ranks: ['F','E','D','C','B','A','S','SS'], expReward: 600, goldReward: 300, itemReward: 'Cincin Petarung' },
]
const ITEMS_SHOP = [
  { id: 'potion_hp',   name: 'Potion HP',       emoji: '🧪', price: 30,  desc: 'Pulihkan 50 HP',         effect: 'hp+50' },
  { id: 'potion_mp',   name: 'Potion MP',       emoji: '💙', price: 25,  desc: 'Pulihkan 40 MP',         effect: 'mp+40' },
  { id: 'elixir',      name: 'Elixir',          emoji: '✨', price: 80,  desc: 'Pulihkan 100 HP & 80 MP',effect: 'hp+100,mp+80' },
  { id: 'iron_sword',  name: 'Pedang Besi',     emoji: '🗡️', price: 100, desc: '+10 ATK permanen',       effect: 'atk+10' },
  { id: 'wood_bow',    name: 'Busur Kayu',      emoji: '🏹', price: 90,  desc: '+8 ATK permanen',        effect: 'atk+8' },
  { id: 'iron_shield', name: 'Perisai Besi',    emoji: '🛡️', price: 120, desc: '+12 DEF permanen',       effect: 'def+12' },
  { id: 'swift_boots', name: 'Sepatu Angin',    emoji: '👟', price: 85,  desc: '+8 SPD permanen',        effect: 'spd+8' },
  { id: 'lucky_coin',  name: 'Koin Keberuntungan', emoji: '🍀', price: 150, desc: '+10 LUCK permanen',   effect: 'luck+10' },
  { id: 'mana_stone',  name: 'Batu Mana',       emoji: '💎', price: 200, desc: '+30 Max MP permanen',    effect: 'maxMp+30' },
  { id: 'rune_armor',  name: 'Armor Rune',      emoji: '🪬', price: 250, desc: '+20 Max HP permanen',    effect: 'maxHp+20' },
]
const TITLES = ['Pemula','Pejuang Muda','Pemburu Berbakat','Legenda Hutan','Pahlawan Kota','Penghancur Iblis','Dewa Pertempuran','Raja Abadi']
const CLASS_CHANGE_COST = 5000  // gold untuk ganti class

// ── Quest item reward effects (Bug Fix: sebelumnya tidak diapply) ──
const QUEST_ITEM_EFFECTS: Record<string, string> = {
  'Pedang Besi':    'atk+10',
  'Helm Goblin':    'def+8',
  'Cape Gelap':     'spd+5',
  'Armor Baja':     'def+15,maxHp+30',
  'Pedang Iblis':   'atk+20',
  'Jubah Naga':     'def+10,luck+10',
  'Cincin Petarung':'atk+8,luck+8',
}

// ── Sell prices for monster/dungeon drops (sebelumnya pajangan) ──
const ITEM_SELL_PRICES: Record<string, number> = {
  // Monster drops
  'Lendir Slime':    20,
  'Telinga Goblin':  35,
  'Taring Wolf':     55,
  'Baju Orc Rusak':  80,
  'Tulang Rune':     120,
  'Busur Gelap':     150,
  'Kristal Es':      200,
  'Sisik Petir':     250,
  'Katana Setan':    400,
  'Mahkota Lich':    500,
  'Sisik Naga Api':  700,
  'Inti Kehampaan':  1000,
  'Jiwa Jurang':     1500,
  'Kristal Langit':  2000,
  'Sisik Dunia':     3500,
  // SSS monster drops
  'Inti Bayangan':       4500,
  'Darah Hydra':         5500,
  'Sabit Jiwa':          6500,
  'Tentakel Abyss':      8000,
  'Kristal Void':        9500,
  'Kapak Titan':         11000,
  'Sayap Malaikat':      13000,
  'Sisik Leviathan':     15500,
  'Batu Api Neraka':     18000,
  'Petir Dewa':          21000,
  'Es Abadi':            25000,
  'Mahkota Senja':       30000,
  'Taring Purba':        36000,
  'Shard Astral':        43000,
  'Jiwa Nether':         52000,
  'Inti Abadi':          62000,
  'Celah Dimensi':       75000,
  'Mahkota Kehancuran':  90000,
  'Sisik Naga Abadi':    110000,
  'Inti Omnigod':        150000,
  // Dungeon boss drops
  'Anemo Crystal':      300,
  'Agnidus Agate':      400,
  'Varunada Lazurite':  500,
  'Vajrada Amethyst':   600,
  'Shivada Jade':       700,
  'Juvenile Jade':      900,
  'Shard of Foul Legacy':1200,
  'Hellfire Butterfly': 1500,
  'Ominous Mask':       2000,
  "Irminsul's Core":    2500,
  // Quest items
  'Pedang Besi':     80,
  'Helm Goblin':     60,
  'Cape Gelap':      70,
  'Armor Baja':      150,
  'Pedang Iblis':    300,
  'Jubah Naga':      400,
  'Cincin Petarung': 250,
  // Shop items
  'Pedang Besi Tempa':200,
  'Cincin Emas':     180,
  'Permata Mana':    350,
  'Pedang Rune':     500,
  'Armor Obsidian':  450,
  'Sepatu Kilat':    300,
  'Jimat Keberuntungan':380,
}

// ═══════════════════════════════════════════════════════════════
// GACHA RPG DATA (Genshin/WuWa style)
// ═══════════════════════════════════════════════════════════════
type GachaRarity = '6★' | '5★' | '4★' | '3★'
type GachaElement = 'Pyro'|'Hydro'|'Anemo'|'Geo'|'Electro'|'Dendro'|'Cryo'|'Spectro'|'Havoc'|'Quantum'|'Imaginary'|'Physical'|'Ice'|'Wind'|'Fire'|'Lightning'
type GachaSource = 'genshin'|'wuwa'|'hsr'
interface GachaChar {
  id: string; name: string; rarity: GachaRarity; element: GachaElement
  weapon: string; emoji: string; desc: string
  atk: number; def: number; hp: number; spd: number
  skill: string; burst: string
  source: GachaSource   // game asal karakter
  img?: string
}
// Material upgrade per level range (dari sistem RPG lain)
const CHAR_LEVEL_MATS: Record<string, { fish?: number; ore?: number; herb?: number; gold: number }> = {
  '1-20':   { fish: 5,  ore: 5,   herb: 5,  gold: 500   },
  '21-40':  { fish: 15, ore: 15,  herb: 15, gold: 2000  },
  '41-60':  { fish: 30, ore: 30,  herb: 30, gold: 6000  },
  '61-80':  { fish: 60, ore: 60,  herb: 60, gold: 15000 },
  '81-100': { fish: 100,ore: 100, herb: 100,gold: 40000 },
}
function getCharLevelRange(level: number): string {
  if (level <= 20) return '1-20'
  if (level <= 40) return '21-40'
  if (level <= 60) return '41-60'
  if (level <= 80) return '61-80'
  return '81-100'
}
function getCharLevelCost(level: number): { fish: number; ore: number; herb: number; gold: number } {
  const range = getCharLevelRange(level)
  const mat = CHAR_LEVEL_MATS[range]
  return { fish: mat.fish||0, ore: mat.ore||0, herb: mat.herb||0, gold: mat.gold }
}
// Max level by rarity
const CHAR_MAX_LEVEL: Record<GachaRarity, number> = {
  '3★': 40, '4★': 60, '5★': 80, '6★': 100
}
// Exp needed per level from dungeon battles (scales with level)
function getCharExpNeeded(level: number): number {
  return Math.floor(100 + level * 40 + level * level * 2)
}
// Exp gained per dungeon win based on boss rank
function getDungeonCharExp(bossRank: string): number {
  const table: Record<string, number> = {
    'Normal': 80, 'Elite': 180, 'Weekly': 320, 'Archon': 600
  }
  return table[bossRank] ?? 80
}
// Stat multiplier by level
function getCharStatMult(level: number, rarity: GachaRarity): number {
  const maxLv = CHAR_MAX_LEVEL[rarity]
  const base = 1 + (level - 1) / maxLv * 2.5  // 1x at lv1, up to 3.5x at max
  const rarityBonus = rarity === '6★' ? 0.5 : rarity === '5★' ? 0.25 : 0
  return base + rarityBonus
}
const GACHA_CHARS: GachaChar[] = [
  // ══════════ GENSHIN IMPACT ══════════
  // 6★ Archon/Exclusive (super rare)
  { id:'celestia_aether', name:'Celestia Aether',  rarity:'6★', element:'Anemo',   weapon:'Sword',    emoji:'⚡', source:'genshin', desc:'Pengelana yang telah menyerap kekuatan semua Archon.',  atk:75,def:55,hp:420,spd:28, skill:'Omni Blade',    burst:'Celestial Convergence' },
  { id:'archon_lumine',   name:'Archon Lumine',    rarity:'6★', element:'Hydro',   weapon:'Sword',    emoji:'🌙', source:'genshin', desc:'Lumine yang telah menguasai kekuatan Abyssal Archon.',  atk:70,def:60,hp:440,spd:26, skill:'Void Star',     burst:'Abyssal Tide' },
  // 5★ Genshin
  { id:'hu_tao',    name:'Hu Tao',      rarity:'5★', element:'Pyro',    weapon:'Polearm',  emoji:'🔥', source:'genshin', desc:'Direktur Rumah Duka, api kematian di tangannya.',   atk:55,def:22,hp:250,spd:17, skill:'Searing Grasp', burst:'Spirit Soother' },
  { id:'raiden',    name:'Raiden Ei',   rarity:'5★', element:'Electro', weapon:'Polearm',  emoji:'⚡', source:'genshin', desc:'Shogun Abadi Inazuma, penguasa petir.',             atk:52,def:26,hp:265,spd:18, skill:'Transcendence', burst:'Musou Isshin' },
  { id:'furina',    name:'Furina',      rarity:'5★', element:'Hydro',   weapon:'Sword',    emoji:'💧', source:'genshin', desc:'Archon Hydro Fontaine, diva panggung keadilan.',    atk:48,def:28,hp:275,spd:21, skill:'Style Change',  burst:'Let the Show Begin' },
  { id:'nahida',    name:'Nahida',      rarity:'5★', element:'Dendro',  weapon:'Catalyst', emoji:'🌿', source:'genshin', desc:'Archon Kecil Sumeru, kebijaksanaan tak terbatas.',  atk:46,def:30,hp:260,spd:22, skill:'TDM Link',      burst:'Illusory Heart' },
  { id:'kazuha',    name:'Kazuha',      rarity:'5★', element:'Anemo',   weapon:'Sword',    emoji:'🍂', source:'genshin', desc:'Samurai Ronin, puisi angin di setiap langkahnya.',  atk:50,def:24,hp:270,spd:24, skill:'Chihayaburu',   burst:'Kazuha Slash' },
  { id:'zhongli',   name:'Zhongli',     rarity:'5★', element:'Geo',     weapon:'Polearm',  emoji:'🪨', source:'genshin', desc:'Morax, Archon Batu, kontrak adalah segalanya.',     atk:44,def:45,hp:310,spd:15, skill:'Dominus Lapidis',burst:'Planet Befall' },
  { id:'yelan',     name:'Yelan',       rarity:'5★', element:'Hydro',   weapon:'Bow',      emoji:'🎯', source:'genshin', desc:'Agen misterius Liyue, informasi adalah kekuatan.',  atk:51,def:20,hp:285,spd:23, skill:'Lingering Lifeline',burst:'Depth-Clarion Dice' },
  { id:'arlecchino',name:'Arlecchino',  rarity:'5★', element:'Pyro',    weapon:'Polearm',  emoji:'🎪', source:'genshin', desc:'Fatui Harbormaster, nyala abadi Knave.',            atk:58,def:18,hp:245,spd:20, skill:'All Is Ash',    burst:'Balemoon Shadesire' },
  { id:'neuvillette',name:'Neuvillette',rarity:'5★', element:'Hydro',   weapon:'Catalyst', emoji:'🐉', source:'genshin', desc:'Iudex Fontaine, Watcher Hydro sejati.',             atk:53,def:24,hp:290,spd:20, skill:'Recitation',    burst:'Judgment Decree' },
  { id:'wriothesley',name:'Wriothesley',rarity:'5★', element:'Cryo',    weapon:'Catalyst', emoji:'🥊', source:'genshin', desc:'Warden Meropide, pukulan es yang menghancurkan.',   atk:56,def:22,hp:255,spd:21, skill:'Icefang Rush',  burst:'Darkgold Wolfbite' },
  // 4★ Genshin
  { id:'xiangling', name:'Xiangling',   rarity:'4★', element:'Pyro',    weapon:'Polearm',  emoji:'🍜', source:'genshin', desc:'Chef berbakat Liyue dengan beruang api Guoba.',     atk:38,def:20,hp:200,spd:18, skill:'Guoba Attack',  burst:'Pyronado' },
  { id:'fischl',    name:'Fischl',      rarity:'4★', element:'Electro', weapon:'Bow',      emoji:'🦅', source:'genshin', desc:'Prinzessin der Verurteilung, menyayangi Oz.',       atk:40,def:18,hp:190,spd:19, skill:'Nightrider',    burst:'Midnight Phantasmagoria' },
  { id:'bennett',   name:'Bennett',     rarity:'4★', element:'Pyro',    weapon:'Sword',    emoji:'🍀', source:'genshin', desc:'Petualang sial tapi paling berhati emas.',           atk:35,def:22,hp:215,spd:17, skill:'Passion Overload',burst:'Fantastic Voyage' },
  { id:'sucrose',   name:'Sucrose',     rarity:'4★', element:'Anemo',   weapon:'Catalyst', emoji:'🧪', source:'genshin', desc:'Alkemis Mondstadt, peneliti reaksi elemen.',        atk:33,def:24,hp:195,spd:20, skill:'Isotoma',       burst:'Forbidden Creation' },
  { id:'beidou',    name:'Beidou',      rarity:'4★', element:'Electro', weapon:'Claymore', emoji:'⚓', source:'genshin', desc:'Kapten Laut Crux Fleet, petir di samudera.',        atk:42,def:26,hp:210,spd:16, skill:'Tidecaller',    burst:'Stormbreaker' },
  { id:'noelle',    name:'Noelle',      rarity:'4★', element:'Geo',     weapon:'Claymore', emoji:'🌹', source:'genshin', desc:'Penjaga Kastil Knight Favonius paling gigih.',      atk:30,def:42,hp:230,spd:14, skill:'Breastplate',   burst:'Sweeping Time' },
  { id:'kuki',      name:'Kuki Shinobu',rarity:'4★', element:'Electro', weapon:'Sword',    emoji:'🩺', source:'genshin', desc:'Wakil Arataki Gang, penyembuh petir andalan.',      atk:34,def:28,hp:225,spd:19, skill:'Gyoei Narukami',burst:'Kamisato Art' },
  { id:'collei',    name:'Collei',      rarity:'4★', element:'Dendro',  weapon:'Bow',      emoji:'🌱', source:'genshin', desc:'Asisten Ranger Sumeru, pemakai Dendro aktif.',      atk:36,def:22,hp:195,spd:21, skill:'Floral Brush',  burst:'Trump-Card Kitty' },
  // 3★ Genshin
  { id:'amber',     name:'Amber',       rarity:'3★', element:'Pyro',    weapon:'Bow',      emoji:'🐰', source:'genshin', desc:'Outrider Knight Mondstadt satu-satunya.',           atk:28,def:18,hp:175,spd:16, skill:'Explosive Puppet',burst:'Fiery Rain' },
  { id:'kaeya',     name:'Kaeya',       rarity:'3★', element:'Cryo',    weapon:'Sword',    emoji:'❄️', source:'genshin', desc:'Cavalry Captain Mondstadt berbakat.',               atk:30,def:20,hp:180,spd:17, skill:'Frostgnaw',     burst:'Glacial Waltz' },
  { id:'lisa',      name:'Lisa',        rarity:'3★', element:'Electro', weapon:'Catalyst', emoji:'📚', source:'genshin', desc:'Perpustakaan Knight Favonius yang malas tapi jenius.',atk:32,def:16,hp:170,spd:18, skill:'Violet Arc',   burst:'Lightning Rose' },

  // ══════════ WUTHERING WAVES ══════════
  // 6★ WuWa
  { id:'rover_void',   name:'Rover (Havoc)',   rarity:'6★', element:'Havoc',   weapon:'Sword',     emoji:'🌑', source:'wuwa', desc:'Rover yang telah menguasai kekuatan Havoc penuh.',  atk:72,def:52,hp:410,spd:27, skill:'Void Claw',     burst:'Nihility Surge' },
  // 5★ WuWa
  { id:'rover',     name:'Rover',       rarity:'5★', element:'Spectro', weapon:'Sword',    emoji:'🌟', source:'wuwa', desc:'Resonator misterius, kekuatan Spectro terpendam.',  atk:50,def:30,hp:275,spd:21, skill:'Resonance Skill',burst:'Resonance Liberation' },
  { id:'jiyan',     name:'Jiyan',       rarity:'5★', element:'Anemo',   weapon:'Broadblade',emoji:'🌀',source:'wuwa', desc:'Komandan Resonator Jinzhou, angin pedang tajam.',  atk:54,def:25,hp:260,spd:22, skill:'Emerald Storm', burst:'Emerald Tempest' },
  { id:'calcharo',  name:'Calcharo',    rarity:'5★', element:'Electro', weapon:'Rectifier',emoji:'⚡', source:'wuwa', desc:'Resonator Electro dengan kekuatan destruktif.',     atk:57,def:20,hp:250,spd:19, skill:'Execute',       burst:'Death Messenger' },
  { id:'jinhsi',    name:'Jinhsi',      rarity:'5★', element:'Spectro', weapon:'Rectifier',emoji:'✨', source:'wuwa', desc:'Wali Jinzhou, cahaya Spectro yang menyilaukan.',    atk:49,def:32,hp:270,spd:20, skill:'Temporal Bender',burst:'Purification Light' },
  { id:'changli',   name:'Changli',     rarity:'5★', element:'Fire',    weapon:'Sword',    emoji:'🔮', source:'wuwa', desc:'Maha-Resonator Rinascita, api yang menerangi kegelapan.',atk:56,def:23,hp:262,spd:22, skill:'Flame Surge',  burst:"Inferno's Edge" },
  { id:'xiangli',   name:'Xiangli Yao', rarity:'5★', element:'Electro', weapon:'Gauntlet', emoji:'⚙️', source:'wuwa', desc:'Insinyur Resonator dari Rinascita, petir mekanis.',  atk:58,def:21,hp:255,spd:20, skill:'Circuit Breaker',burst:'Omega Protocol' },
  { id:'camellya',  name:'Camellya',    rarity:'5★', element:'Havoc',   weapon:'Sword',    emoji:'🌸', source:'wuwa', desc:'Bunga gelap yang mekar di kegelapan, havoc murni.',  atk:60,def:19,hp:248,spd:21, skill:'Petal Slash',   burst:'Bloom of Ruin' },
  { id:'zhezhi',    name:'Zhezhi',      rarity:'5★', element:'Spectro', weapon:'Rectifier',emoji:'🎭', source:'wuwa', desc:'Seniman misterius Resonator, ilusi spectro hidup.',  atk:47,def:33,hp:278,spd:22, skill:'Painted Soul',  burst:'Living Canvas' },
  { id:'shorekeeper',name:'Shorekeeper',rarity:'5★', element:'Spectro', weapon:'Rectifier',emoji:'🪬', source:'wuwa', desc:'Penjaga Pantai, Resonator penyembuh yang kuat.',     atk:43,def:36,hp:295,spd:20, skill:'Tidal Guard',   burst:'Spectral Tide' },
  // 4★ WuWa
  { id:'yangyang',  name:'Yangyang',    rarity:'4★', element:'Anemo',   weapon:'Sword',    emoji:'🍃', source:'wuwa', desc:'Resonator Anemo Jinzhou, lincah dan lembut.',        atk:36,def:24,hp:200,spd:22, skill:'Wind Chaser',   burst:'Wings of Gale' },
  { id:'chixia',    name:'Chixia',      rarity:'4★', element:'Fire',    weapon:'Pistol',   emoji:'🔫', source:'wuwa', desc:'Resonator Pyro energik dengan senjata kembar api.',  atk:40,def:18,hp:190,spd:21, skill:'Dual Blaze',    burst:'Blazing Barrage' },
  { id:'danjin',    name:'Danjin',      rarity:'4★', element:'Havoc',   weapon:'Sword',    emoji:'⚔️', source:'wuwa', desc:'Resonator Havoc agresif, mengorbankan HP untuk power.',atk:42,def:16,hp:185,spd:22, skill:'Crimson Fragment',burst:'Crimson Erosion' },
  { id:'yuanwu',    name:'Yuanwu',      rarity:'4★', element:'Electro', weapon:'Gauntlet', emoji:'🥋', source:'wuwa', desc:'Resonator Electro, master bela diri Jinzhou.',       atk:38,def:26,hp:210,spd:17, skill:'Thundering Fist',burst:'Thunder God Descent' },

  // ══════════ HONKAI: STAR RAIL ══════════
  // 6★ HSR
  { id:'hsr_aeon',    name:'The Trailblazer (Aeon)', rarity:'6★', element:'Fire', weapon:'Hands',   emoji:'🌠', source:'hsr', desc:'Trailblazer yang telah menyentuh kekuatan Aeon sejati.',  atk:68,def:58,hp:430,spd:25, skill:"Aeon's Might",  burst:'Path Convergence' },
  // 5★ HSR
  { id:'hsr_kafka',   name:'Kafka',       rarity:'5★', element:'Lightning', weapon:'Guns',     emoji:'🎵', source:'hsr', desc:'Anggota Stellaron Hunter, operator petir mematikan.',  atk:54,def:22,hp:258,spd:25, skill:'Thunderclap Myriad Doom',burst:'Twilight Trill' },
  { id:'hsr_blade',   name:'Blade',       rarity:'5★', element:'Wind',      weapon:'Sword',    emoji:'🌬️', source:'hsr', desc:'Mantan Stellaron Hunter, tak bisa mati tapi ingin mati.',atk:60,def:18,hp:300,spd:21, skill:'Shard Sword',   burst:'Death Wish' },
  { id:'hsr_jingliu', name:'Jingliu',     rarity:'5★', element:'Ice',       weapon:'Sword',    emoji:'🌸', source:'hsr', desc:'Sword Champion Luofu, es yang membekukan waktu.',       atk:58,def:20,hp:268,spd:22, skill:'Transcendent Flash',burst:'Crescent Transmutation' },
  { id:'hsr_himeko',  name:'Himeko',      rarity:'5★', element:'Fire',      weapon:'Sword',    emoji:'🔥', source:'hsr', desc:'Direktur Astral Express, peneliti berbahaya sekaligus.',atk:52,def:24,hp:262,spd:22, skill:'Molten Fist',   burst:'Stygian Resurge' },
  { id:'hsr_seele',   name:'Seele',       rarity:'5★', element:'Quantum',   weapon:'Scythe',   emoji:'🦋', source:'hsr', desc:'Butterfly Girl Wildfire, Quantum yang berputar cepat.',  atk:57,def:20,hp:252,spd:25, skill:'Sheathed Blade',burst:'Butterfly Flurry' },
  { id:'hsr_bronya',  name:'Bronya',      rarity:'5★', element:'Wind',      weapon:'Mecha',    emoji:'🐰', source:'hsr', desc:'Supreme Guardian Belobog, buffer dan support terkuat.', atk:44,def:35,hp:285,spd:20, skill:'War Commander',burst:'The Belobog March' },
  { id:'hsr_welt',    name:'Welt Yang',   rarity:'5★', element:'Imaginary', weapon:'Sword',    emoji:'🌌', source:'hsr', desc:'Lord Herrscher, kontrol dan debuff paling handal.',     atk:48,def:30,hp:275,spd:20, skill:'Art of Finesse',burst:'Synthetic Black Hole' },
  { id:'hsr_fu_xuan', name:'Fu Xuan',     rarity:'5★', element:'Quantum',   weapon:'Matrix',   emoji:'🔮', source:'hsr', desc:'Master Strategist IPC, tank Quantum sejati.',          atk:40,def:48,hp:335,spd:18, skill:'Known by Stars',burst:'Woven Fate' },
  { id:'hsr_ruan_mei',name:'Ruan Mei',    rarity:'5★', element:'Ice',       weapon:'Needle',   emoji:'🌸', source:'hsr', desc:'Genius Society #81, es abadi yang mendistorsi realita.',atk:45,def:32,hp:280,spd:20, skill:'Somatotypical Helix',burst:'Petals to Stream, Rime to River' },
  { id:'hsr_acheron', name:'Acheron',     rarity:'5★', element:'Lightning', weapon:'Sword',    emoji:'☔', source:'hsr', desc:'Galaxy Ranger, petir yang membunuh kenangan.',          atk:56,def:23,hp:260,spd:22, skill:'Slashed Dream',burst:'Slashed Dream Cries in Red' },
  { id:'hsr_robin',   name:'Robin',       rarity:'5★', element:'Physical',  weapon:'Feather',  emoji:'🕊️', source:'hsr', desc:'Diva Penacony, suaranya bisa membalikkan nasib.',       atk:46,def:30,hp:278,spd:20, skill:"Pinion's Art",  burst:'Vox Harmonique' },
  { id:'hsr_firefly', name:'Firefly (SAM)',rarity:'5★',element:'Fire',      weapon:'Mecha',    emoji:'🔥', source:'hsr', desc:'Stellaron Hunter SAM, gadis yang mencari kematian.',    atk:59,def:21,hp:256,spd:21, skill:'Pyrogenic Break',burst:'Tonight, I Shall Seal the Star' },
  { id:'hsr_boothill',name:'Boothill',    rarity:'5★', element:'Fire',      weapon:'Guns',     emoji:'🤠', source:'hsr', desc:'Galaxy Ranger, koboi langit yang mematikan.',           atk:57,def:22,hp:258,spd:23, skill:'Skullcrush Spurs',burst:'Last Known Position' },
  // 4★ HSR
  { id:'hsr_march7',  name:'March 7th',   rarity:'4★', element:'Ice',       weapon:'Bow',      emoji:'🏹', source:'hsr', desc:'Pemotret Astral Express, pelindung tim dengan es.',     atk:33,def:38,hp:215,spd:22, skill:'Freezing Arrow',burst:'Figure-Skating Dream' },
  { id:'hsr_asta',    name:'Asta',        rarity:'4★', element:'Fire',      weapon:'Sword',    emoji:'🌙', source:'hsr', desc:'Supervisor IPC, penjelajah yang selalu ceria.',          atk:36,def:24,hp:200,spd:20, skill:'Meteor Shower', burst:'Astral Blessing' },
  { id:'hsr_natasha', name:'Natasha',     rarity:'4★', element:'Physical',  weapon:'Gun',      emoji:'💉', source:'hsr', desc:'Dokter Wildfire Belobog, penyembuh dengan senyum misterius.',atk:32,def:28,hp:228,spd:18, skill:'Love, Heal, Choose',burst:'Gift of Rebirth' },
  { id:'hsr_pela',    name:'Pela',        rarity:'4★', element:'Ice',       weapon:'Sword',    emoji:'📕', source:'hsr', desc:'Intelligence Officer IPC, spesialis debuff musuh.',     atk:34,def:26,hp:210,spd:20, skill:'Frostbite',     burst:'Zone Suppression' },
  { id:'hsr_tingyun', name:'Tingyun',     rarity:'4★', element:'Lightning', weapon:'Staff',    emoji:'🦊', source:'hsr', desc:'Foxian Trade Consultant, buffer lightning terbaik.',    atk:38,def:22,hp:195,spd:22, skill:'Soothing Music', burst:'Amidst the Rejoicing Clouds' },
  { id:'hsr_sampo',   name:'Sampo',       rarity:'4★', element:'Wind',      weapon:'Knife',    emoji:'🎭', source:'hsr', desc:'Teman perjalanan misterius, DoT Wind spesialis.',       atk:40,def:18,hp:188,spd:21, skill:'Windtorn Dagger',burst:'Surprise Present' },
  // 3★ HSR
  { id:'hsr_qingque', name:'Qingque',     rarity:'3★', element:'Quantum',   weapon:'Jade',     emoji:'🀄', source:'hsr', desc:'Pemain mahjong Xianzhou, Quantum random tapi kuat.',    atk:29,def:19,hp:178,spd:18, skill:'Celestial Jade',burst:'A Scoop of Moon' },
  { id:'hsr_serval',  name:'Serval',      rarity:'3★', element:'Lightning', weapon:'Guitar',   emoji:'🎸', source:'hsr', desc:'Teknisi underground Belobog, rocker petir.',            atk:31,def:17,hp:172,spd:19, skill:'Bzzt! Thermobaric',burst:'Here Comes the Mechanical Fever' },
]

const GACHA_BANNER: { name: string; featured: string[]; rateUp: boolean } = {
  name: '✨ Crossover Star Banner', featured: ['hu_tao','hsr_kafka','camellya','hsr_acheron'], rateUp: true
}

const PITY_SOFT = 74   // soft pity mulai (5★)
const PITY_HARD = 90   // hard pity (5★)
const PITY_6STAR = 200 // hard pity 6★ — 1× per 200 pull
const RATE_6STAR = 0.1 // 0.1% base rate 6★

interface PlayerGacha {
  uid: string; primogems: number; tickets: number
  pity: number; guaranteed: boolean; pity6: number   // pity6 tracks 6★ counter
  roster: string[]   // char ids
  pulls: number      // total pulls
  charLevels: Record<string, number>        // char id → current level (default 1)
  charExp: Record<string, number>           // char id → accumulated exp from dungeon battles
  constellations: Record<string, number>    // char id → C0–C6 (>C6 converts to primo)
  // Resources for char upgrade (gathered from fishing, mining, RPG)
  charMats: { fish: number; ore: number; herb: number }
}

const GACHA_EVENTS = [
  { id:'ev1', name:'🔥 Trial of Flames', desc:'Karakter Pyro dapat +30% DMG. Berlaku 3 hari.', bonus:'pyro_boost', active:true },
  { id:'ev2', name:'⚡ Thunder Monarch', desc:'Kumpulkan 1000 Thunder Points untuk unlock skin ekslusif Raiden.', bonus:'thunder_points', active:true },
  { id:'ev3', name:'💧 Tide Festival',   desc:'Login 7 hari berturut-turut untuk Primogems bonus.', bonus:'daily_login', active:true },
]

const BATTLE_PASS_TIERS = [
  { level:1,  free:'🧪×3 Potion HP',              premium:'💎 60 Primogems + 🧪×5 Potion' },
  { level:5,  free:'🎫×1 Ticket Gacha',           premium:'🎫×3 Ticket + 💎 80 Primogems' },
  { level:10, free:'💰 500 Gold',                  premium:'💎 120 Primogems + 🎫×2 Ticket' },
  { level:15, free:'⚔️ ATK Rune +5',              premium:'💎 200 Primogems + 🗡️ Pedang Langit (atk+30)' },
  { level:20, free:'🎫×2 Ticket',                  premium:'💎 400 Primogems + 🛡️ Perisai Jiwa (def+25)' },
  { level:25, free:'💰 1500 Gold',                 premium:'🌟 Exclusive Title: "Penjelajah Jiwa" + 💎 300 Primogems' },
  { level:30, free:'🏆 Title: Wisher + 💎 100',   premium:'💎 800 Primogems + 🐉 Amulet Naga (atk+20,def+15,luck+15)' },
  { level:35, free:'⚔️ ATK Rune +8',              premium:'🌌 Void Shard (maxHp+100,atk+25) — BP EXCLUSIVE' },
  { level:40, free:'💎 200 Primogems',             premium:'✨ Cosmic Ring (luck+30,spd+20) — BP EXCLUSIVE' },
  { level:50, free:'🎫×5 Ticket + 💰 3000 Gold',  premium:'👑 Title: "Ksatria Kosmik" + 🌟 Celestial Core (semua stat +10) — BP EXCLUSIVE' },
]

// ── Battle Pass exclusive item effects ──
const BP_EXCLUSIVE_ITEM_EFFECTS: Record<string, string> = {
  'Pedang Langit':    'atk+30',
  'Perisai Jiwa':     'def+25',
  'Amulet Naga':      'atk+20,def+15,luck+15',
  'Void Shard':       'maxHp+100,atk+25',
  'Cosmic Ring':      'luck+30,spd+20',
  'Celestial Core':   'atk+10,def+10,spd+10,luck+10,maxHp+50,maxMp+50',
}

// ═══════════════════════════════════════════════════════════════
// DUNGEON BOSSES (Genshin/HSR inspired)
// ═══════════════════════════════════════════════════════════════
interface DungeonBoss {
  id: string; name: string; emoji: string; element: GachaElement
  hp: number; atk: number; def: number; exp: number; gold: number
  primogems: number; rank: 'Normal'|'Elite'|'Weekly'|'Archon'
  desc: string; weakness: GachaElement[]; phase2Hp: number
  skills: string[]; dropItem: string
}
const DUNGEON_BOSSES: DungeonBoss[] = [
  { id:'slime_boss',   name:'Anemo Hypostasis',  emoji:'🌀', element:'Anemo',   hp:800,   atk:45,  def:20,  exp:300,  gold:150,  primogems:20,  rank:'Normal', desc:'Kristal Anemo kuno yang berputar liar.', weakness:['Pyro','Electro'], phase2Hp:400, skills:['Wind Barrage','Cube Slam','Anemo Burst'], dropItem:'Anemo Crystal' },
  { id:'pyro_boss',    name:'Pyro Regisvine',    emoji:'🌹', element:'Pyro',    hp:1000,  atk:55,  def:15,  exp:400,  gold:200,  primogems:30,  rank:'Normal', desc:'Tanaman api raksasa dari Mondstadt.', weakness:['Hydro','Cryo'], phase2Hp:500, skills:['Fire Petal','Crimson Lotus','Bloom Storm'], dropItem:'Agnidus Agate' },
  { id:'hydro_boss',   name:'Oceanid',           emoji:'🐟', element:'Hydro',   hp:1200,  atk:50,  def:18,  exp:500,  gold:250,  primogems:40,  rank:'Normal', desc:'Makhluk air purba dari Fontaine.', weakness:['Cryo','Electro'], phase2Hp:600, skills:['Hydro Summon','Tidal Wave','Water Prison'], dropItem:'Varunada Lazurite' },
  { id:'electro_boss', name:'Thunder Manifestation',emoji:'⛈️',element:'Electro', hp:1400,  atk:65,  def:22,  exp:650,  gold:300,  primogems:50,  rank:'Elite',  desc:'Entitas petir yang menyerang tanpa ampun.', weakness:['Cryo','Hydro'], phase2Hp:700, skills:['Lightning Strike','Shock Wave','Electro Prison'], dropItem:'Vajrada Amethyst' },
  { id:'cryo_boss',    name:'Cryo Hypostasis',   emoji:'❄️', element:'Cryo',    hp:1500,  atk:60,  def:25,  exp:700,  gold:350,  primogems:60,  rank:'Elite',  desc:'Kubus es yang mengancam para musafir.', weakness:['Pyro','Electro'], phase2Hp:800, skills:['Ice Spear','Blizzard','Cryo Cage'], dropItem:'Shivada Jade' },
  { id:'geo_boss',     name:'Primo Geovishap',   emoji:'🦎', element:'Geo',     hp:1800,  atk:70,  def:30,  exp:900,  gold:450,  primogems:80,  rank:'Weekly', desc:'Reptil purba dari era kuno, memiliki kulit sekeras batu.', weakness:['Hydro','Anemo'], phase2Hp:900, skills:['Stone Slam','Geo Burst','Ancient Roar'], dropItem:'Juvenile Jade' },
  { id:'childe',       name:'Childe (Tartaglia)', emoji:'🎯', element:'Hydro',   hp:2200,  atk:80,  def:25,  exp:1200, gold:600,  primogems:120, rank:'Weekly', desc:'Harbinger ke-11 Fatui, sang Penembak Jitu dari Snezhnaya.', weakness:['Cryo','Electro'], phase2Hp:1100, skills:['Foul Legacy','Riptide Flash','Ranged Barrage'], dropItem:'Shard of Foul Legacy' },
  { id:'signora',      name:'La Signora',        emoji:'🦋', element:'Cryo',    hp:2500,  atk:85,  def:28,  exp:1500, gold:750,  primogems:150, rank:'Weekly', desc:'Harbinger ke-8 Fatui, ratu es yang kejam.', weakness:['Pyro','Electro'], phase2Hp:1250, skills:['Crimson Lotus','Ice Storm','Frostflake Arrow'], dropItem:'Hellfire Butterfly' },
  { id:'raiden_boss',  name:'Raiden Shogun',     emoji:'⚡', element:'Electro', hp:3000,  atk:95,  def:35,  exp:2000, gold:1000, primogems:200, rank:'Archon', desc:'Archon Electro Inazuma — kekuatan sejati Musou no Hitotachi.', weakness:['Cryo','Dendro'], phase2Hp:1500, skills:['Transcendence','Musou Isshin','Baleful Shadowlord'], dropItem:'Ominous Mask' },
  { id:'zhongli_boss', name:'Osial, God of Salt', emoji:'🪨', element:'Geo',     hp:3500,  atk:100, def:40,  exp:2500, gold:1200, primogems:250, rank:'Archon', desc:'Raja Lautan kuno yang dipenjarakan Zhongli/Morax.', weakness:['Hydro','Anemo'], phase2Hp:1800, skills:['Tidal Force','Salt Formation','Geo Barrage'], dropItem:"Irminsul's Core" },
]

// Elemental Reactions (Genshin-style)
const ELEMENTAL_REACTIONS: Record<string, { name: string; emoji: string; dmgMult: number; effect: string }> = {
  'Pyro+Hydro':   { name:'Vaporize',    emoji:'💧🔥', dmgMult: 1.5, effect:'DMG ×1.5' },
  'Hydro+Pyro':   { name:'Vaporize',    emoji:'🔥💧', dmgMult: 2.0, effect:'DMG ×2.0' },
  'Pyro+Cryo':    { name:'Melt',        emoji:'❄️🔥', dmgMult: 1.5, effect:'DMG ×1.5' },
  'Cryo+Pyro':    { name:'Melt',        emoji:'🔥❄️', dmgMult: 2.0, effect:'DMG ×2.0' },
  'Pyro+Electro': { name:'Overloaded',  emoji:'⚡🔥', dmgMult: 1.8, effect:'AoE blast +80%' },
  'Electro+Pyro': { name:'Overloaded',  emoji:'🔥⚡', dmgMult: 1.8, effect:'AoE blast +80%' },
  'Hydro+Electro':{ name:'Electro-Charged', emoji:'⚡💧', dmgMult: 1.4, effect:'Chain lightning +40%' },
  'Electro+Hydro':{ name:'Electro-Charged', emoji:'💧⚡', dmgMult: 1.4, effect:'Chain lightning +40%' },
  'Hydro+Cryo':   { name:'Frozen',      emoji:'❄️💧', dmgMult: 1.0, effect:'Freeze! Enemy skip turn' },
  'Cryo+Hydro':   { name:'Frozen',      emoji:'💧❄️', dmgMult: 1.0, effect:'Freeze! Enemy skip turn' },
  'Cryo+Electro': { name:'Superconduct',emoji:'⚡❄️', dmgMult: 0.5, effect:'DEF -40% next hit' },
  'Electro+Cryo': { name:'Superconduct',emoji:'❄️⚡', dmgMult: 0.5, effect:'DEF -40% next hit' },
  'Dendro+Electro':{ name:'Quicken',    emoji:'🌿⚡', dmgMult: 1.6, effect:'Spread: multi-hit +60%' },
  'Dendro+Hydro': { name:'Bloom',       emoji:'🌿💧', dmgMult: 1.3, effect:'Seed explosion +30%' },
  'Anemo+any':    { name:'Swirl',       emoji:'🌀✨', dmgMult: 1.2, effect:'Spread element to all' },
  'Geo+any':      { name:'Crystallize', emoji:'🪨✨', dmgMult: 1.0, effect:'Shield +200 HP absorbed' },
}

// Daily Missions
const DAILY_MISSIONS = [
  { id:'dm_battle',   name:'Berburu Monster',  desc:'Menangkan 3 pertarungan monster',  target:3,  reward:{ primogems:20, tickets:0, gold:0 }, icon:'⚔️' },
  { id:'dm_dungeon',  name:'Dungeon Run',       desc:'Selesaikan 1 dungeon boss',         target:1,  reward:{ primogems:40, tickets:1, gold:0 }, icon:'🏰' },
  { id:'dm_quest',    name:'Klaim Quest',       desc:'Klaim 1 quest reward',             target:1,  reward:{ primogems:20, tickets:0, gold:100 }, icon:'📜' },
  { id:'dm_pull',     name:'Gacha Pull',        desc:'Lakukan 1x pull gacha',            target:1,  reward:{ primogems:0,  tickets:0, gold:200 }, icon:'✨' },
]

// Genshin element to RPG element mapping (for gacha chars in dungeon)
const GACHA_ELEM_COLOR: Record<GachaElement, string> = {
  Pyro:'#ff6b3d', Hydro:'#4fc3f7', Anemo:'#74c2a0', Geo:'#daa520',
  Electro:'#c86eff', Dendro:'#7cbb4a', Cryo:'#98d8ea', Spectro:'#ffd700', Havoc:'#9b59b6',
  Quantum:'#7b5cff', Imaginary:'#f5c842', Physical:'#aaaaaa',
  Ice:'#a8d8f0', Wind:'#80d9b0', Fire:'#ff7755', Lightning:'#bb88ff'
}
const GACHA_SOURCE_LABEL: Record<GachaSource, string> = {
  genshin: '⚙️ Genshin', wuwa: '🌊 WuWa', hsr: '🚂 HSR'
}
const GACHA_SOURCE_COLOR: Record<GachaSource, string> = {
  genshin: '#5ab4ff', wuwa: '#7fffd4', hsr: '#ff9ebc'
}
const RARITY_COLOR: Record<GachaRarity, string> = {
  '6★': '#ff3cff', '5★': '#ffd700', '4★': '#c080ff', '3★': '#66aaff'
}

function checkElemReaction(charElem: GachaElement, bossElem: GachaElement): typeof ELEMENTAL_REACTIONS[string] | null {
  const key = `${charElem}+${bossElem}`
  const key2 = `${charElem}+any`
  return ELEMENTAL_REACTIONS[key] || ELEMENTAL_REACTIONS[key2] || null
}

const EXP_PER_LEVEL = (lvl: number) => Math.floor(100 * Math.pow(1.35, lvl - 1))

function getLevel(exp: number) {
  let lvl = 1; let total = 0
  while (total + EXP_PER_LEVEL(lvl) <= exp) { total += EXP_PER_LEVEL(lvl); lvl++ }
  return lvl
}
function getLevelExp(exp: number) {
  let lvl = 1; let total = 0
  while (total + EXP_PER_LEVEL(lvl) <= exp) { total += EXP_PER_LEVEL(lvl); lvl++ }
  return { current: exp - total, needed: EXP_PER_LEVEL(lvl), level: lvl }
}

// ═══════════════════════════════════════════════════════════════
// FISHING SYSTEM DATA
// ═══════════════════════════════════════════════════════════════
type FishRarity = 'Common'|'Uncommon'|'Rare'|'Epic'|'Legendary'|'Mythic'
interface FishData {
  id: string; name: string; emoji: string; rarity: FishRarity
  sellPrice: number; desc: string; locationIds: number[]
}
interface FishRod {
  id: string; name: string; emoji: string; tier: number
  desc: string; rarityBonus: number; timingWidth: number
  upgradeGold: number; upgradeFish: {fishId:string; count:number}[]
}
interface FishLocation {
  id: number; name: string; emoji: string; desc: string
  unlockGold: number; unlockFish: {fishId:string; count:number}
  unlockMaterial: string; fishPool: string[]
}
interface FishingData {
  uid: string
  rodId: string
  pond: Record<string, number>        // fishId -> count
  gold?: number                        // synced from rpgChar
  unlockedLocations: number[]
  quests: FishingQuest[]
  totalCaught: number
  rodUpgrades: string[]               // unlocked rod ids
}
interface FishingQuest {
  id: string; name: string; desc: string; icon: string
  type: 'catch'|'sell'|'location'
  target: number; progress: number; completed: boolean; claimed: boolean
  reward: { gold: number; primogems?: number; rodMaterial?: string }
  fishId?: string; locationId?: number
}

const FISH_LIST: FishData[] = [
  // Common
  { id:'roh_kecil',    name:'Roh Sungai Kecil',  emoji:'🐟', rarity:'Common',    sellPrice:8,   desc:'Ikan roh paling umum, bersinar redup biru.',    locationIds:[0,1] },
  { id:'jiwa_daun',    name:'Jiwa Dedaunan',      emoji:'🍃', rarity:'Common',    sellPrice:10,  desc:'Ikan berwarna hijau transparans, jiwa alam.',    locationIds:[0,1,2] },
  { id:'bayang_kolam', name:'Bayang Kolam',       emoji:'🌑', rarity:'Common',    sellPrice:7,   desc:'Ikan hitam pekat, suka sembunyi di bayangan.',  locationIds:[0,2] },
  { id:'percik_fajar', name:'Percik Fajar',       emoji:'✨', rarity:'Common',    sellPrice:12,  desc:'Muncul saat fajar, kilau emas lemah.',           locationIds:[0,1] },
  // Uncommon
  { id:'naga_mini',    name:'Naga Sungai Kecil',  emoji:'🐲', rarity:'Uncommon',  sellPrice:35,  desc:'Anak naga kecil yang tinggal di sungai.',       locationIds:[1,2] },
  { id:'bidadari_air', name:'Bidadari Air',       emoji:'💧', rarity:'Uncommon',  sellPrice:40,  desc:'Ikan bersayap kecil, jiwa air purba.',           locationIds:[1,2,3] },
  { id:'peri_kristal', name:'Peri Kristal',       emoji:'💎', rarity:'Uncommon',  sellPrice:45,  desc:'Tubuh transparan seperti kristal, langka.',     locationIds:[2,3] },
  // Rare
  { id:'ryu_abyssal',  name:'Ryu Abyssal',        emoji:'🌊', rarity:'Rare',      sellPrice:120, desc:'Naga laut dalam, muncul saat bulan penuh.',     locationIds:[2,3,4] },
  { id:'arwah_danau',  name:'Arwah Danau Beku',   emoji:'❄️', rarity:'Rare',      sellPrice:150, desc:'Ikan jiwa dari danau es abadi.',                locationIds:[2,3] },
  { id:'roh_petir',    name:'Roh Petir Merah',    emoji:'⚡', rarity:'Rare',      sellPrice:130, desc:'Berkilat merah saat menyentuh air.',             locationIds:[3,4] },
  // Epic
  { id:'leviathan_k',  name:'Leviathan Kecil',   emoji:'🐉', rarity:'Epic',      sellPrice:400, desc:'Versi mini Leviathan, sangat kuat.',             locationIds:[3,4] },
  { id:'jiwa_laut',    name:'Jiwa Laut Purba',    emoji:'🌌', rarity:'Epic',      sellPrice:500, desc:'Manifestasi jiwa laut dari era kuno.',           locationIds:[4] },
  // Legendary
  { id:'raja_jurang',  name:'Raja Jurang',        emoji:'👑', rarity:'Legendary', sellPrice:1500,desc:'Penguasa Jurang, hanya muncul 1% waktu.',       locationIds:[3,4] },
  { id:'dewa_samudra', name:'Dewa Samudra',       emoji:'🔱', rarity:'Legendary', sellPrice:2000,desc:'Inkarnasi dewa laut, amat jarang.',              locationIds:[4] },
  // Mythic (material for rod upgrade)
  { id:'void_serpent', name:'Void Serpent',       emoji:'🌀', rarity:'Mythic',    sellPrice:5000,desc:'Ular kehampaan, material rod Celestial.',        locationIds:[4] },
  { id:'inti_kosmos',  name:'Inti Kosmos',        emoji:'⭐', rarity:'Mythic',    sellPrice:8000,desc:'Inti alam semesta dalam bentuk ikan.',           locationIds:[4] },
]

const FISHING_RODS: FishRod[] = [
  { id:'kayu',     name:'Tongkat Petapa',     emoji:'🪵', tier:1, desc:'Rod kayu sederhana milik petapa hutan.',          rarityBonus:0,   timingWidth:28, upgradeGold:500,   upgradeFish:[{fishId:'roh_kecil', count:5}] },
  { id:'besi',     name:'Batang Jiwa Besi',   emoji:'⚙️', tier:2, desc:'Ditempa dari besi jiwa, lebih kuat.',             rarityBonus:5,   timingWidth:24, upgradeGold:1500,  upgradeFish:[{fishId:'naga_mini', count:3}] },
  { id:'kristal',  name:'Tongkat Kristal',    emoji:'💎', tier:3, desc:'Kristal alam yang memancarkan cahaya biru.',      rarityBonus:12,  timingWidth:20, upgradeGold:4000,  upgradeFish:[{fishId:'peri_kristal', count:5}] },
  { id:'abyssal',  name:'Batang Abyssal',     emoji:'🌊', tier:4, desc:'Diambil dari kedalaman jurang abyssal.',         rarityBonus:20,  timingWidth:16, upgradeGold:10000, upgradeFish:[{fishId:'arwah_danau', count:3}] },
  { id:'void',     name:'Tongkat Kehampaan',  emoji:'🌌', tier:5, desc:'Terbuat dari serpihan kehampaan dimensi lain.',  rarityBonus:30,  timingWidth:13, upgradeGold:25000, upgradeFish:[{fishId:'raja_jurang', count:1}] },
  { id:'celestial',name:'Batang Langit Abadi',emoji:'✨', tier:6, desc:'Rod paling sakti, milik dewa langit kuno.',      rarityBonus:45,  timingWidth:10, upgradeGold:80000, upgradeFish:[{fishId:'void_serpent', count:1},{fishId:'inti_kosmos', count:1}] },
]

const FISHING_LOCATIONS: FishLocation[] = [
  { id:0, name:'Telaga Fajar',      emoji:'🌅', desc:'Telaga tenang tempat petualangan dimulai.', unlockGold:0,     unlockFish:{fishId:'',count:0},              unlockMaterial:'',         fishPool:['roh_kecil','jiwa_daun','bayang_kolam','percik_fajar','naga_mini'] },
  { id:1, name:'Sungai Jiwa',       emoji:'🌿', desc:'Sungai jernih yang mengalir dari hutan jiwa.',unlockGold:2000,  unlockFish:{fishId:'roh_kecil',count:10},    unlockMaterial:'',         fishPool:['roh_kecil','jiwa_daun','percik_fajar','naga_mini','bidadari_air'] },
  { id:2, name:'Danau Kristal',     emoji:'💎', desc:'Danau misterius dengan air sejernih kristal.',unlockGold:8000,  unlockFish:{fishId:'peri_kristal',count:5},  unlockMaterial:'Kristal Es',fishPool:['jiwa_daun','bayang_kolam','peri_kristal','ryu_abyssal','arwah_danau'] },
  { id:3, name:'Laut Jurang',       emoji:'🌑', desc:'Lautan gelap di tepi jurang dimensi.',       unlockGold:25000, unlockFish:{fishId:'arwah_danau',count:3},   unlockMaterial:'Mahkota Lich',fishPool:['ryu_abyssal','roh_petir','leviathan_k','raja_jurang','bidadari_air'] },
  { id:4, name:'Samudra Kehampaan', emoji:'🌌', desc:'Samudra antardimensi — hanya yang terkuat.',  unlockGold:80000, unlockFish:{fishId:'raja_jurang',count:1},   unlockMaterial:'Inti Kehampaan',fishPool:['leviathan_k','jiwa_laut','raja_jurang','dewa_samudra','void_serpent','inti_kosmos'] },
]

const FISH_RARITY_COLOR: Record<FishRarity, string> = {
  Common:'#aaa', Uncommon:'#4fc3f7', Rare:'#c86eff', Epic:'#ff6b3d', Legendary:'#ffd700', Mythic:'#ff375f'
}
const FISH_RARITY_BG: Record<FishRarity, string> = {
  Common:'rgba(170,170,170,0.08)', Uncommon:'rgba(79,195,247,0.1)', Rare:'rgba(200,110,255,0.1)', Epic:'rgba(255,107,61,0.1)', Legendary:'rgba(255,215,0,0.1)', Mythic:'rgba(255,55,95,0.12)'
}

const FISHING_QUESTS_TEMPLATE: Omit<FishingQuest,'progress'|'completed'|'claimed'>[] = [
  { id:'fq1', name:'Pemancing Pemula',    desc:'Tangkap 10 ikan apapun',         icon:'🎣', type:'catch',    target:10,  reward:{gold:200},            },
  { id:'fq2', name:'Jiwa Sungai',         desc:'Tangkap 5 Roh Sungai Kecil',    icon:'🐟', type:'catch',    target:5,   reward:{gold:300},            fishId:'roh_kecil' },
  { id:'fq3', name:'Naga Berburu',        desc:'Tangkap 3 Naga Sungai Kecil',   icon:'🐲', type:'catch',    target:3,   reward:{gold:600},            fishId:'naga_mini' },
  { id:'fq4', name:'Pedagang Ikan',       desc:'Jual ikan senilai 500 Gold',     icon:'💰', type:'sell',     target:500, reward:{gold:400,primogems:20} },
  { id:'fq5', name:'Penjelajah Lokasi',   desc:'Pancing di Sungai Jiwa',        icon:'🌿', type:'location', target:1,   reward:{gold:800},            locationId:1 },
  { id:'fq6', name:'Pemburu Kristal',     desc:'Tangkap 2 Peri Kristal',        icon:'💎', type:'catch',    target:2,   reward:{gold:1500,primogems:30}, fishId:'peri_kristal' },
  { id:'fq7', name:'Legenda Jurang',      desc:'Tangkap 1 Raja Jurang',         icon:'👑', type:'catch',    target:1,   reward:{gold:5000,primogems:100}, fishId:'raja_jurang' },
]

function rollFish(locationId: number, rodId: string): FishData {
  const loc = FISHING_LOCATIONS[locationId]
  const rod = FISHING_RODS.find(r => r.id === rodId) || FISHING_RODS[0]
  const pool = FISH_LIST.filter(f => loc.fishPool.includes(f.id))
  const bonus = rod.rarityBonus
  // weighted by rarity
  const weights: Record<FishRarity, number> = {
    Common: Math.max(5, 55 - bonus),
    Uncommon: Math.max(5, 28 - bonus/2),
    Rare: Math.min(40, 10 + bonus/2),
    Epic: Math.min(20, 4 + bonus/3),
    Legendary: Math.min(10, 1.5 + bonus/10),
    Mythic: Math.min(5, 0.5 + bonus/20),
  }
  const weighted = pool.map(f => ({ f, w: weights[f.rarity] }))
  const total = weighted.reduce((s,x) => s+x.w, 0)
  let r = Math.random() * total
  for (const {f,w} of weighted) { r -= w; if (r <= 0) return f }
  return pool[pool.length-1]
}

// ═══════════════════════════════════════════════════════════════
// MINING DATA
// ═══════════════════════════════════════════════════════════════
const ORES = [
  { id:'batu',      name:'Batu Biasa',      emoji:'🪨', rarity:'Common',    chance:50, baseGold:5   },
  { id:'besi',      name:'Bijih Besi',      emoji:'⚙️',  rarity:'Uncommon',  chance:25, baseGold:15  },
  { id:'emas',      name:'Bijih Emas',      emoji:'🪙',  rarity:'Rare',      chance:12, baseGold:40  },
  { id:'kristal',   name:'Kristal Mana',    emoji:'💎', rarity:'Epic',      chance:8,  baseGold:80  },
  { id:'miril',     name:'Ore Langka',      emoji:'🌟', rarity:'Legendary', chance:4,  baseGold:200 },
  { id:'obsidian',  name:'Obsidian',        emoji:'🖤', rarity:'Epic',      chance:1,  baseGold:150 },
]
const MINE_SESSION_MS = 10 * 60 * 1000   // 10 menit sesi aktif tambang
const MINE_COOLDOWN_MS = 30 * 60 * 1000  // 30 menit cooldown setelah sesi selesai
const MINE_DROP_INTERVAL_MS = 2 * 60 * 1000  // drop ore tiap 2 menit selama sesi

// ═══════════════════════════════════════════════════════════════
// CRAFTING DATA
// ═══════════════════════════════════════════════════════════════
const CRAFT_RECIPES = [
  { id:'iron_blade',  name:'Pedang Besi Tempa',  emoji:'🗡️', materials:{besi:3,batu:2},  effect:'atk+15', desc:'+15 ATK permanen' },
  { id:'gold_ring',   name:'Cincin Emas',         emoji:'💍', materials:{emas:2},          effect:'luck+10',desc:'+10 LUCK permanen' },
  { id:'mana_gem',    name:'Permata Mana',        emoji:'💎', materials:{kristal:2,batu:1},effect:'mp+50', desc:'+50 Max MP permanen' },
  { id:'rune_blade',  name:'Pedang Rune',         emoji:'⚡', materials:{besi:5,kristal:1},effect:'atk+25',desc:'+25 ATK permanen' },
  { id:'obs_armor',   name:'Armor Obsidian',      emoji:'🛡️', materials:{obsidian:3,besi:2},effect:'def+20',desc:'+20 DEF permanen' },
  { id:'speed_boots', name:'Sepatu Kilat',        emoji:'👟', materials:{miril:1,batu:3},  effect:'spd+15',desc:'+15 SPD permanen' },
  { id:'luck_charm',  name:'Jimat Keberuntungan', emoji:'🍀', materials:{emas:3,kristal:1},effect:'luck+20',desc:'+20 LUCK permanen' },
]

// ═══════════════════════════════════════════════════════════════
// FARMING DATA
// ═══════════════════════════════════════════════════════════════
const CROPS = [
  { id:'gandum',   name:'Gandum',       emoji:'🌾', growMs: 10*60*1000, sellGold:10 },
  { id:'sayur',    name:'Sayuran',      emoji:'🥦', growMs: 20*60*1000, sellGold:20 },
  { id:'buah',     name:'Buah Ajaib',   emoji:'🍎', growMs: 40*60*1000, sellGold:45 },
  { id:'jamur',    name:'Jamur Sihir',  emoji:'🍄', growMs: 60*60*1000, sellGold:80 },
]
const FARM_SLOTS = 4

// ═══════════════════════════════════════════════════════════════
// COOKING DATA
// ═══════════════════════════════════════════════════════════════
const RECIPES_COOK = [
  { id:'roti',      name:'Roti Gandum',   emoji:'🍞', ing:{gandum:3},     stat:'hp',   val:50,  durMs:10*60*1000, desc:'+50 HP sementara 10 mnt' },
  { id:'salad',     name:'Salad Segar',   emoji:'🥗', ing:{sayur:2},      stat:'def',  val:8,   durMs:15*60*1000, desc:'+8 DEF sementara 15 mnt' },
  { id:'pie',       name:'Buah Pie',      emoji:'🥧', ing:{buah:2,gandum:1},stat:'atk',val:12,  durMs:20*60*1000, desc:'+12 ATK sementara 20 mnt' },
  { id:'elixir_j',  name:'Elixir Jamur',  emoji:'🧪', ing:{jamur:2},      stat:'luck', val:15,  durMs:30*60*1000, desc:'+15 LUCK sementara 30 mnt' },
  { id:'stew',      name:'Sup Pendekar',  emoji:'🍲', ing:{sayur:2,gandum:2},stat:'spd',val:10, durMs:20*60*1000, desc:'+10 SPD sementara 20 mnt' },
]

// ═══════════════════════════════════════════════════════════════
// TRAINING DATA
// ═══════════════════════════════════════════════════════════════
const TRAININGS = [
  { id:'atk',  stat:'atk',  name:'Latihan Serangan',  emoji:'⚔️',  desc:'+3 ATK',  gain:3,  cost:200, coolMs:60*60*1000 },
  { id:'def',  stat:'def',  name:'Latihan Bertahan',  emoji:'🛡️',  desc:'+3 DEF',  gain:3,  cost:200, coolMs:60*60*1000 },
  { id:'spd',  stat:'spd',  name:'Latihan Kecepatan', emoji:'💨',  desc:'+2 SPD',  gain:2,  cost:150, coolMs:60*60*1000 },
  { id:'luck', stat:'luck', name:'Meditasi Nasib',    emoji:'🍀',  desc:'+2 LUCK', gain:2,  cost:150, coolMs:60*60*1000 },
  { id:'hp',   stat:'maxHp',name:'Perkuat Fisik',     emoji:'❤️',  desc:'+20 Max HP',gain:20,cost:300,coolMs:60*60*1000 },
  { id:'mp',   stat:'maxMp',name:'Meditasi Mana',     emoji:'💙',  desc:'+15 Max MP',gain:15,cost:300,coolMs:60*60*1000 },
]

// ═══════════════════════════════════════════════════════════════
// INVESTMENT DATA
// ═══════════════════════════════════════════════════════════════
const INVEST_PLANS = [
  { id:'safe',   name:'Deposito Aman',   emoji:'🏦', durMs:2*60*60*1000,  minMult:1.05, maxMult:1.15, risk:'rendah'  },
  { id:'medium', name:'Saham Menengah',  emoji:'📈', durMs:1*60*60*1000,  minMult:0.85, maxMult:1.5,  risk:'sedang'  },
  { id:'risky',  name:'Kripto Liar',     emoji:'₿',  durMs:30*60*1000,    minMult:0.3,  maxMult:3.0,  risk:'tinggi'  },
]

// ═══════════════════════════════════════════════════════════════
// WILD QUEST DATA
// ═══════════════════════════════════════════════════════════════
const WILD_QUEST_POOL = [
  { desc:'Kumpulkan 5 Bijih Besi dari tambang', reward:{gold:120,exp:80},  type:'mine',  need:{besi:5}      },
  { desc:'Panen 3 hasil kebun apapun',          reward:{gold:100,exp:60},  type:'farm',  need:{}            },
  { desc:'Masak 2 hidangan dari bahan kebun',   reward:{gold:150,exp:100}, type:'cook',  need:{}            },
  { desc:'Latih 2 stat yang berbeda hari ini',  reward:{gold:200,exp:150}, type:'train', need:{}            },
  { desc:'Kumpulkan 3 Bijih Emas',              reward:{gold:250,exp:120}, type:'mine',  need:{emas:3}      },
  { desc:'Capai 5.000 Gold total',              reward:{gold:300,exp:200}, type:'gold',  need:{gold:5000}   },
  { desc:'Bunuh 10 monster apapun',             reward:{gold:180,exp:130}, type:'kill',  need:{kills:10}    },
  { desc:'Selesaikan 1 Dungeon Boss',           reward:{gold:400,exp:300}, type:'dungeon',need:{dungeon:1}  },
]

// ═══════════════════════════════════════════════════════════════
// WEAPON UPGRADE DATA
// ═══════════════════════════════════════════════════════════════
const WEAPON_LEVELS = [
  { level:1,  atkBonus:5,   defBonus:0,  materials:{besi:2},         goldCost:100  },
  { level:2,  atkBonus:10,  defBonus:0,  materials:{besi:4},         goldCost:200  },
  { level:3,  atkBonus:15,  defBonus:2,  materials:{besi:6,emas:1},  goldCost:400  },
  { level:4,  atkBonus:22,  defBonus:3,  materials:{emas:3,besi:5},  goldCost:700  },
  { level:5,  atkBonus:30,  defBonus:5,  materials:{kristal:2,emas:2},goldCost:1200 },
  { level:6,  atkBonus:40,  defBonus:8,  materials:{kristal:4,emas:4},goldCost:2000 },
  { level:7,  atkBonus:52,  defBonus:12, materials:{miril:1,kristal:5},goldCost:3500 },
  { level:8,  atkBonus:65,  defBonus:16, materials:{miril:2,kristal:8},goldCost:5000 },
  { level:9,  atkBonus:80,  defBonus:20, materials:{miril:4,obsidian:3},goldCost:8000 },
  { level:10, atkBonus:100, defBonus:25, materials:{miril:6,obsidian:5},goldCost:15000 },
]


// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════════════════════════════
interface ToastItem { id: number; type: 'win' | 'lose' | 'info'; title: string; msg: string }

function ToastContainer({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: number) => void }) {
  return (
    <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 999, display: 'flex', flexDirection: 'column', gap: 8, width: '90%', pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} className={`kyoko-toast kyoko-toast-${t.type}`}>
          <span className="kyoko-toast-icon">{t.type === 'win' ? '🏆' : t.type === 'lose' ? '💀' : '⚔️'}</span>
          <div className="kyoko-toast-body">
            <div className="kyoko-toast-title">{t.title}</div>
            <div className="kyoko-toast-msg">{t.msg}</div>
          </div>
          <div className="kyoko-toast-bar"/>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
// ── Moderation config type ──────────────────────────────────────
interface ModerasiConfig {
  antiLinkAll: boolean
  antiLinkWa: boolean
  antiPromo: boolean
  antiBadword: boolean
  badwords: string[]
  autoClear?: 'off' | 'daily' | 'weekly'
  lastClearedAt?: number
}

// ── VideoAvatar: loop, pause saat tidak kelihatan ────────────────
const VideoAvatar = ({ src }: { src: string }) => {
  const ref = React.useRef<HTMLVideoElement>(null)
  React.useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { e.isIntersecting ? el.play().catch(()=>{}) : el.pause() }, { threshold: 0.1 })
    obs.observe(el); return () => obs.disconnect()
  }, [])
  return <video ref={ref} src={src} loop muted playsInline style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'10px'}}/>
}

export default function GlobalChatPanel({ onClose, onUnread, onMusicChange, initialTab }: {
  onClose: () => void
  onUnread?: () => void
  onMusicChange?: (info: { playing: boolean; title: string; audioRef: React.RefObject<HTMLAudioElement | null> } | null) => void
  initialTab?: 'chat'|'rpg'|'fishing'|'anime'|'manga'|'novel'
}) {
  const [user, setUser] = useState<User | null>(null)
  const [username, setUsername] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [step, setStep] = useState<'loading'|'login'|'username'|'main'>('loading')
  const [showUpdateBanner, setShowUpdateBanner] = useState(false)
  const appVersionRef = useRef<string | null>(null) // versi yang sedang dipakai user

  const [activeTab, setActiveTab] = useState<'chat'|'rpg'|'fishing'|'voice'|'music'|'anime'>((initialTab as any) || 'chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [navOpen, setNavOpen] = useState(false)
  const [navTransDir, setNavTransDir] = useState<'up'|'down'>('up')
  const [navContentKey, setNavContentKey] = useState(0)
  const [offlineSelectedGame, setOfflineSelectedGame] = useState<string|null>(null)

  // ── Voice Call state ───────────────────────────────────────────
  const [voiceCallActive, setVoiceCallActive] = useState(false)
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, {username:string;photoURL:string;muted:boolean;joinedAt:number}>>({})
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({})
  const voiceUnsubRef = useRef<(() => void) | null>(null)
  // ── Optimization refs ──────────────────────────────────────────────────────
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSeenPlanetRef = useRef<number>(0)

  const [messages, setMessages] = useState<GcMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null)
  const [showGroupSettings, setShowGroupSettings] = useState(false)
  const [editGroupName, setEditGroupName] = useState('')
  const [editGroupDesc, setEditGroupDesc] = useState('')
  const [editGroupIcon, setEditGroupIcon] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  const [memberList, setMemberList] = useState<{uid:string;username:string;photoURL:string;isAdmin:boolean;isOwner:boolean}[]>([])

  const [rpgChar, setRpgChar] = useState<RpgChar | null>(null)
  // Ref agar updateRpgChar selalu akses state terbaru (bukan stale closure)
  const rpgCharRef = useRef<RpgChar | null>(null)
  useEffect(() => { rpgCharRef.current = rpgChar }, [rpgChar])

  /**
   * Update RPG char — LOCAL-FIRST:
   * 1. Update React state DULU (instant, tidak nunggu network)
   * 2. Save ke IndexedDB (offline-safe, terenkripsi)
   * 3. Firebase: background write (tidak block UI)
   * 4. Daily sync jika sudah 24 jam sejak sync terakhir
   */
  const updateRpgChar = useCallback(async (updates: Partial<RpgChar>) => {
    if (!user) return
    setRpgChar(prev => {
      if (!prev) return prev
      const newChar = { ...prev, ...updates } as RpgChar
      // Side-effects non-blocking
      ;(async () => {
        await rpgSaveLocal(user.uid, newChar)
        await markLocalChanges(user.uid)
        // Firebase background write (jika online)
        if (navigator.onLine) {
          updateDoc(doc(getRpgDb(user.uid), 'rpgChars', user.uid), updates as Record<string, unknown>).catch(console.error)
          // Daily sync check
          const needs = await rpgNeedsSync(user.uid)
          if (needs) rpgSyncToFirebase(user.uid, newChar, getRpgDb).catch(console.error)
        }
      })()
      return newChar
    })
  }, [user])
  // Helper: update playerGacha di Firestore + local state
  const updateGachaLocal = useCallback(async (updates: Partial<PlayerGacha>) => {
    if (!user) return
    await updateDoc(doc(getRpgDb(user.uid), 'playerGacha', user.uid), updates as any)
    setGachaData(prev => prev ? { ...prev, ...updates } as PlayerGacha : prev)
  }, [user])
  const [rpgView, setRpgView] = useState<'dashboard'|'battle'|'quest'|'shop'|'create'|'leaderboard'|'dungeon'|'party'|'daily'|'mining'|'crafting'|'farming'|'cooking'|'training'|'duel'|'wildquest'|'invest'|'weaponup'|'transfer'>('dashboard')
  const [autoBattle, setAutoBattle] = useState(false)
  const autoBattleRef = useRef(false)
  const [battleState, setBattleState] = useState<{
    monster: typeof MONSTERS[0]; monsterHp: number; monsterMp: number
    monsterShield: number; monsterShieldMax: number
    playerHp: number; playerMp: number; playerShield: number; playerShieldMax: number
    log: {text:string;type:'dmg'|'heal'|'skill'|'info'|'shield'}[]; phase: 'confirm'|'running'|'result'
    result?: 'win'|'lose'; loading: boolean; turn: number
  } | null>(null)
  const [shopMsg, setShopMsg] = useState('')
  const [questMsg, setQuestMsg] = useState('')
  const [leaderboard, setLeaderboard] = useState<{uid:string;username:string;level:number;class:RpgClass;kills:number;gold:number}[]>([])
  const leaderboardLastFetchRef = useRef<number>(0) // timestamp last fetch, untuk throttle 1x/hari
  const [rpgLoading, setRpgLoading] = useState(false)
  const [gachaData, setGachaData] = useState<PlayerGacha | null>(null)
  const [gachaView, setGachaView] = useState<'home'|'banner'|'roster'|'events'|'pass'>('home')
  const [gachaResult, setGachaResult] = useState<GachaChar[] | null>(null)
  const [gachaAnim, setGachaAnim] = useState(false)
  const [showClassChange, setShowClassChange] = useState(false)
  const [questClaimMsg, setQuestClaimMsg] = useState('')
  const [activeGachaTab, setActiveGachaTab] = useState<'rpg'|'gacha'|'planet'>('rpg')
  const [battleAnim, setBattleAnim] = useState<'player-atk'|'enemy-atk'|''>('')
  const [loadingBar, setLoadingBar] = useState(0)
  const [loadingActive, setLoadingActive] = useState(false)
  const [activeBattles, setActiveBattles] = useState<ActiveBattleInfo[]>([])
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [swapAnim, setSwapAnim] = useState<null|'left'|'right'>(null)

  // ── New features state ────────────────────────────────────────
  const [msgMenuId, setMsgMenuId] = useState<string|null>(null) // message context menu
  const [showGroupInfo, setShowGroupInfo] = useState(false) // group info panel
  const [showAvatarPicker, setShowAvatarPicker] = useState(false) // avatar picker
  const [avatarList, setAvatarList] = useState<{id:string;url:string}[]>([]) // preset avatars from Firebase
  const [adminAvatarInput, setAdminAvatarInput] = useState('') // admin upload link
  const [showMusicSearch, setShowMusicSearch] = useState(false) // music search panel
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<{url:string;title:string;user:string;thumbnail:string}[]>([])
  const [musicSearching, setMusicSearching] = useState(false)
  // Music: use global vars so state survives panel close/open
  const [nowPlaying, setNowPlayingState] = useState<{url:string;title:string;thumbnail?:string}|null>(() => getGlobalNowPlaying())
  const setNowPlaying = (v: {url:string;title:string;thumbnail?:string}|null) => { setGlobalNowPlaying(v); setNowPlayingState(v) }
  const gcAudioRef = React.useRef<HTMLAudioElement | null>(null)
  const [gcMusicPlaying, setGcMusicPlaying] = useState(() => {
    const a = getGlobalAudio(); return !!(a && !a.paused)
  })
  // ── Sticker state ──────────────────────────────────────────────
  const [stickerList, setStickerList] = useState<StickerItem[]>([])
  const [showStickerPicker, setShowStickerPicker] = useState(false)
  const [adminStickerInput, setAdminStickerInput] = useState('')
  const [stickerDeleteMode, setStickerDeleteMode] = useState(false)
  const [showStickerSearch, setShowStickerSearch] = useState(false)
  const [stickerSearchQuery, setStickerSearchQuery] = useState('')
  const [stickerSearchResults, setStickerSearchResults] = useState<{title:string;url:string}[]>([])
  const [stickerSearchLoading, setStickerSearchLoading] = useState(false)
  const [stickerSearchPreview, setStickerSearchPreview] = useState<{title:string;url:string}|null>(null)
  const [videoAvatarInput, setVideoAvatarInput] = useState('')
  const [showVideoAvatarInput, setShowVideoAvatarInput] = useState(false)
  // ── Member management state ────────────────────────────────────
  const [memberSearch, setMemberSearch] = useState('')
  const [memberMenuId, setMemberMenuId] = useState<string|null>(null)
  const [gcMusicApiUrl, setGcMusicApiUrl] = useState(() => localStorage.getItem('kyoko_music_api') || 'https://api-faa.my.id/faa/soundcloud-play')
  const [musicQueryParam, setMusicQueryParam] = useState<'query'|'q'>(() => (localStorage.getItem('kyoko_music_param') as 'query'|'q') || 'query')
  const [showMusicApiEdit, setShowMusicApiEdit] = useState(false)
  const [musicApiInput, setMusicApiInput] = useState('')
  const [gcMusicError, setGcMusicError] = useState('')
  const [gcMusicVisualizer, setGcMusicVisualizer] = useState(false)
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => localStorage.getItem('kyoko_autoplay') !== 'false')
  // ── Custom music categories (admin only) ──────────────────────
  const [customMusicCats, setCustomMusicCats] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('kyoko_custom_music_cats') || '{}') } catch { return {} }
  })
  const [showMusicCatMgr, setShowMusicCatMgr] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatKeywords, setNewCatKeywords] = useState('')
  const saveCustomCat = (name: string, keywords: string) => {
    if (!name.trim() || !keywords.trim()) return
    const kws = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    const updated = { ...customMusicCats, [name.toLowerCase()]: kws }
    setCustomMusicCats(updated)
    localStorage.setItem('kyoko_custom_music_cats', JSON.stringify(updated))
    setNewCatName(''); setNewCatKeywords('')
  }
  const deleteCustomCat = (name: string) => {
    const updated = { ...customMusicCats }
    delete updated[name]
    setCustomMusicCats(updated)
    localStorage.setItem('kyoko_custom_music_cats', JSON.stringify(updated))
  }
  const [autoplayLoading, setAutoplayLoading] = useState(false)
  const lastMsgCountRef = useRef(0)

  // ── Moderasi state ─────────────────────────────────────────────
  const [moderasi, setModerasiState] = useState<ModerasiConfig>({
    antiLinkAll: false, antiLinkWa: false, antiPromo: false, antiBadword: false,
    badwords: ['anjing','bangsat','kontol','memek','bajingan','brengsek','tolol','idiot','bodoh'],
    autoClear: 'off', lastClearedAt: 0,
  })
  const [showModerasiPanel, setShowModerasiPanel] = useState(false)
  const [badwordInput, setBadwordInput] = useState('')

  // ── Fishing state ──────────────────────────────────────────────
  const [fishingData, setFishingData] = useState<FishingData | null>(null)
  const [fishingView, setFishingView] = useState<'home'|'fishing'|'pond'|'rods'|'quests'>('home')
  const [fishingPhase, setFishingPhase] = useState<'idle'|'casting'|'waiting'|'struggle'|'result'>('idle')
  const [fishingProgress, setFishingProgress] = useState(0)
  const [fishingTarget, setFishingTarget] = useState(50)
  const [fishingTargetWidth, setFishingTargetWidth] = useState(20)
  const [fishingResult, setFishingResult] = useState<FishData | null>(null)
  const [fishingMissed, setFishingMissed] = useState(false)
  const [fishingLocation, setFishingLocation] = useState(0)
  const [fishingMsg, setFishingMsg] = useState('')
  const [fishingHearts, setFishingHearts] = useState(3)
  const fishingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fishingWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── @mention state ─────────────────────────────────────────────
  // ── New RPG Feature States ────────────────────────────────────
  const [mineMsg, setMineMsg] = useState('')
  const [craftMsg, setCraftMsg] = useState('')
  const [farmMsg, setFarmMsg] = useState('')
  const [cookMsg, setCookMsg] = useState('')
  const [trainMsg, setTrainMsg] = useState('')
  const [duelMsg, setDuelMsg] = useState('')
  const [duelLoading, setDuelLoading] = useState(false)
  const [wildQuest, setWildQuest] = useState<typeof WILD_QUEST_POOL[0]|null>(null)
  const [wildQuestMsg, setWildQuestMsg] = useState('')
  const [investMsg, setInvestMsg] = useState('')
  const [investInput, setInvestInput] = useState('')
  const [transferMsg, setTransferMsg] = useState('')
  const [transferTarget, setTransferTarget] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [weaponMsg, setWeaponMsg] = useState('')

  // ── Battle Pass states ─────────────────────────────────────────
  const [showBpBuyConfirm, setShowBpBuyConfirm] = useState(false)
  const [bpBuyLoading, setBpBuyLoading] = useState(false)
  const [bpMsg, setBpMsg] = useState('')
  const [bpRequests, setBpRequests] = useState<{id:string;uid:string;username:string;requestedAt:number;status:'pending'|'approved'|'declined'}[]>([])
  const [showOwnerInbox, setShowOwnerInbox] = useState(false)
  const [bpClaimMsg, setBpClaimMsg] = useState('')

  const [mentionQuery, setMentionQuery] = useState('')
  const [showMention, setShowMention] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)

  // ── Reply state ────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<{id:string;username:string;text:string}|null>(null)
  const [swipingMsgId, setSwipingMsgId] = useState<string|null>(null)
  const [swipeX, setSwipeX] = useState(0)

  // ── Scroll to bottom button ────────────────────────────────────
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [hasNewMsg, setHasNewMsg] = useState(false)
  const initialScrollDone = useRef(false)
  const messagesRef = useRef<HTMLDivElement>(null)

  // ── Custom notification sound ──────────────────────────────────
  const [notifSound, setNotifSound] = useState<string>(() => localStorage.getItem('kyoko_notif_sound') || '')

  // ── Offline/Online state ───────────────────────────────────────
  const [isAppOnline, setIsAppOnline] = useState(navigator.onLine)
  const [pendingTransferCount, setPendingTransferCount] = useState(0)
  useEffect(() => {
    const on = () => setIsAppOnline(true)
    const off = () => setIsAppOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // ── Chat cache & virtual window ───────────────────────────────
  const CHAT_CACHE_KEY = 'kyoko_chat_cache_v3'
  const MSG_WINDOW_SIZE = 50       // jumlah pesan yang di-render sekaligus
  const [msgWindowExtra, setMsgWindowExtra] = useState(0) // tambahan pesan lama yang di-load
  const [showSoundPicker, setShowSoundPicker] = useState(false)
  const [soundInput, setSoundInput] = useState('')
  const notifAudioRef = useRef<HTMLAudioElement | null>(null)

  // ── chatUsers realtime cache (untuk avatar up-to-date) ─────────
  const [userAvatarCache, setUserAvatarCache] = useState<Record<string, string>>({})
  // ── Presence & music status per user ──────────────────────────
  const [presenceMap, setPresenceMap] = useState<Record<string, {online: boolean}>>({})
  const [dungeonState, setDungeonState] = useState<{
    boss: DungeonBoss; bossHp: number; bossPhase: 1|2; frozenTurns: number
    superconduct: boolean; activeChars: GachaChar[]; charHp: number[]
    currentChar: number; energy: number
    log: {text:string;type:'dmg'|'heal'|'skill'|'info'|'reaction'}[]
    result?: 'win'|'lose'; phase: 'player'|'enemy'|'result'
    charLevels?: Record<string, number>  // for scaled stats in battle
  } | null>(null)

  // ── Back button (History API) — nutup panel, bukan keluar web ──
  useEffect(() => {
    window.history.pushState({ gcOpen: true }, '')
    const handlePop = () => {
      onClose()
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      // Jika masih di state gc, pop it
      if (window.history.state?.gcOpen) {
        window.history.back()
      }
    }
  }, [onClose])

  // ── Lock body scroll while panel open ─────────────────────────
  useEffect(() => {
    const handleResize = () => {
      setSidebarCollapsed(window.innerWidth < 400)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Stop notif audio ref when panel closes
    return () => {
      document.body.style.overflow = prev
      // Stop notif sound — tidak boleh bunyi kalau panel tutup
      if (notifAudioRef.current) {
        notifAudioRef.current.pause()
        notifAudioRef.current = null
      }
      // Kalau musik lagi main, notify parent untuk tampil mini player
      const ga = getGlobalAudio()
      if (ga && !ga.paused && getGlobalNowPlaying()) {
        onMusicChange?.({ playing: true, title: getGlobalNowPlaying()!.title, audioRef: gcAudioRef })
      } else {
        onMusicChange?.(null)
      }
      // Resume web music if it was paused by GC
      try {
        if ((window as any).__webAudioPausedByGc) {
          const webAudio = document.querySelector('audio') as HTMLAudioElement | null
          if (webAudio) { webAudio.play().catch(() => {}); (window as any).__webAudioPausedByGc = false }
        }
      } catch {}
    }
  }, [])

  // ── Sync gcAudioRef with global audio on mount ─────────────────
  useEffect(() => {
    const existing = getGlobalAudio()
    if (existing) {
      gcAudioRef.current = existing
      existing.onended = () => { setGcMusicPlaying(false); setGlobalNowPlaying(null); setNowPlayingState(null); setGlobalAudio(null) }
    }
  }, [])

  // ── Presence: tulis online saat masuk, offline saat keluar ─────
  useEffect(() => {
    if (!user || step !== 'main') return
    const presRef = doc(dbChat, 'presence', user.uid)
    updateDoc(presRef, { online: true, lastSeen: Date.now() }).catch(() =>
      setDoc(presRef, { online: true, lastSeen: Date.now() })
    )
    const handleOffline = () => updateDoc(presRef, { online: false, lastSeen: Date.now() }).catch(() => {})
    const handleVisibility = () => {
      if (document.hidden) updateDoc(presRef, { online: false, lastSeen: Date.now() }).catch(() => {})
      else updateDoc(presRef, { online: true, lastSeen: Date.now() }).catch(() => {})
    }
    window.addEventListener('beforeunload', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      handleOffline()
      window.removeEventListener('beforeunload', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [user, step])

  // ── App version listener: auto-reload saat admin update versi ──
  useEffect(() => {
    const versionRef = doc(dbChat, 'appConfig', 'version')
    const unsub = onSnapshot(versionRef, (snap) => {
      if (!snap.exists()) return
      const remoteVersion = snap.data()?.version as string
      if (!remoteVersion) return
      if (appVersionRef.current === null) {
        // Pertama kali load: simpan versi saat ini, jangan reload
        appVersionRef.current = remoteVersion
      } else if (appVersionRef.current !== remoteVersion) {
        // Versi berubah: tampilkan banner update
        setShowUpdateBanner(true)
      }
    })
    return () => unsub()
  }, [])

  // ── Presence: polling 30 detik (bukan per-member onSnapshot, hemat reads) ──
  useEffect(() => {
    if (memberList.length === 0) return
    const fetchPresence = async () => {
      const snaps = await Promise.all(memberList.map(m => getDoc(doc(dbChat, 'presence', m.uid))))
      const map: Record<string, {online:boolean}> = {}
      snaps.forEach(snap => { if (snap.exists()) map[snap.id] = snap.data() as {online:boolean} })
      setPresenceMap(map)
    }
    fetchPresence()
    const interval = setInterval(fetchPresence, 5 * 60 * 1000) // hemat reads: 5 menit
    return () => clearInterval(interval)
  }, [memberList])


  // ── Avatar preset listener ─────────────────────────────────────
  useEffect(() => {
    getDocs(collection(dbChat, 'presetAvatars')).then(snap => {
      setAvatarList(snap.docs.map(d => ({ id: d.id, url: d.data().url as string })))
    })
  }, [])

  // ── Sticker listener ───────────────────────────────────────────
  useEffect(() => {
    getDocs(collection(dbChat, 'presetStickers')).then(snap => {
      setStickerList(snap.docs.map(d => ({ id: d.id, url: d.data().url as string, enabled: d.data().enabled !== false })))
    })
  }, [])

  // ── Moderasi listener dari Firestore ──────────────────────────
  useEffect(() => {
    return onSnapshot(doc(dbChat, 'groups_info', 'kyokomd-global'), (snap) => {
      if (snap.exists() && snap.data().moderasi) {
        setModerasiState(snap.data().moderasi as ModerasiConfig)
      }
    })
  }, [])

  // ── Avatar cache: fetch sekali saat memberList berubah (hemat reads) ──
  useEffect(() => {
    if (memberList.length === 0) return
    Promise.all(memberList.map(m => getDoc(doc(dbChat, 'chatUsers', m.uid)))).then(snaps => {
      const cache: Record<string, string> = {}
      snaps.forEach(snap => {
        if (snap.exists() && snap.data().photoURL) cache[snap.id] = snap.data().photoURL
      })
      setUserAvatarCache(prev => ({ ...prev, ...cache }))
    })
  }, [memberList])

  // ── Play notif sound on new messages (only when panel open) ───
  const lastNotifMsgIdRef = useRef<string>('')
  const msgInitDoneRef = useRef(false)
  const panelMountedRef = useRef(true)
  useEffect(() => { panelMountedRef.current = true; return () => { panelMountedRef.current = false } }, [])

  // ── Spring / Jiggle physics — semua button kenyal ──────────────
  useEffect(() => {
    const activeButtons = new Set<HTMLElement>()

    const onDown = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button')
      if (!btn) return

      // Hapus state lama
      btn.classList.remove('btn-spring-up', 'btn-spring-up-stretch')

      // Pilih squash biasa atau squash+stretch berdasarkan ukuran button
      const rect = btn.getBoundingClientRect()
      const isWide = rect.width > 120

      if (isWide) {
        btn.classList.add('btn-spring-down-stretch')
      } else {
        btn.classList.add('btn-spring-down')
      }
      activeButtons.add(btn)
    }

    const onUp = () => {
      activeButtons.forEach(btn => {
        const isStretch = btn.classList.contains('btn-spring-down-stretch')
        btn.classList.remove('btn-spring-down', 'btn-spring-down-stretch')

        if (isStretch) {
          btn.classList.add('btn-spring-up-stretch')
          const clean = () => { btn.classList.remove('btn-spring-up-stretch'); btn.removeEventListener('transitionend', clean) }
          btn.addEventListener('transitionend', clean)
        } else {
          btn.classList.add('btn-spring-up')
          const clean = () => { btn.classList.remove('btn-spring-up'); btn.removeEventListener('transitionend', clean) }
          btn.addEventListener('transitionend', clean)
        }
      })
      activeButtons.clear()
    }

    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)

    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // ── Auto-sync & pending transfer execution saat kembali online ──
  useEffect(() => {
    if (!user) return
    const cleanup = setupOnlineListener(
      user.uid,
      () => rpgCharRef.current as (object & { gold?: number; level?: number }),
      getRpgDb,
      (msg, ok) => {
        showToast(ok ? 'win' : 'info', msg, '')
        getPendingTransfers(user.uid).then(p => setPendingTransferCount(p.length))
      }
    )
    return cleanup
  }, [user])

  // Reset init flag tiap kali step berubah ke 'main' (panel baru dibuka)
  useEffect(() => {
    if (step === 'main') {
      msgInitDoneRef.current = false
      lastNotifMsgIdRef.current = ''
    }
  }, [step])

  // ── Register Service Worker untuk push notif HP ───────────────
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // ── Request permission notif ───────────────────────────────────
  useEffect(() => {
    if (!user || step !== 'main') return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [user, step])

  useEffect(() => {
    if (messages.length === 0) return

    const latestMsg = messages[messages.length - 1]

    // Saat pertama kali messages masuk (initial load), simpan ID terakhir tanpa bunyi
    if (!msgInitDoneRef.current) {
      lastNotifMsgIdRef.current = latestMsg.id
      msgInitDoneRef.current = true
      return
    }

    // Kalau ID pesan terakhir sama, tidak ada pesan baru
    if (latestMsg.id === lastNotifMsgIdRef.current) return

    // Ada pesan baru — cari semua pesan setelah lastNotifMsgId
    const lastIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].id === lastNotifMsgIdRef.current) return i } return -1 })()
    const newMsgs = lastIdx >= 0 ? messages.slice(lastIdx + 1) : [latestMsg]

    // Update penanda terakhir
    lastNotifMsgIdRef.current = latestMsg.id

    // Pastikan user sudah login sebelum cek uid
    const myUid = user?.uid
    if (!myUid) return

    // Hanya bunyi kalau ada pesan dari orang LAIN (bukan diri sendiri)
    const hasOtherMsg = newMsgs.some(m => m.uid !== myUid)
    if (!hasOtherMsg) return

    // Notif suara kalau panel terbuka
    if (notifSound && panelMountedRef.current) {
      try {
        if (notifAudioRef.current) {
          notifAudioRef.current.currentTime = 0
          notifAudioRef.current.play().catch(() => {})
        } else {
          const a = new Audio(notifSound)
          a.volume = 0.6
          a.play().catch(() => {})
          notifAudioRef.current = a
        }
      } catch {}
    }
    // Push notif ke HP via Service Worker kalau tab di background
    if (document.hidden && 'serviceWorker' in navigator) {
      const lastMsg = newMsgs.filter(m => m.uid !== myUid).at(-1)
      if (lastMsg && Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then(reg => {
          reg.active?.postMessage({
            type: 'SHOW_NOTIF',
            title: `${lastMsg.username} — KyokoMd Global`,
            body: lastMsg.type === 'sticker' ? '🖼 Stiker' : (lastMsg.text || '').slice(0, 80),
            icon: lastMsg.photoURL || '/icon-192x192.png'
          })
        }).catch(() => {})
      }
    }
  }, [messages, notifSound, user?.uid])

  // Toast system
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)

  const showToast = useCallback((type: 'win'|'lose'|'info', title: string, msg: string) => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, type, title, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  // ── Auth ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const cachedUsername = localStorage.getItem('kyoko_username_' + u.uid)
        if (cachedUsername) { setUsername(cachedUsername); setStep('main'); joinGroup(u.uid, cachedUsername, u.photoURL || '') }
        // Jika offline tapi punya cached username → langsung main (offline mode)
        if (!navigator.onLine) {
          if (cachedUsername) {
            // Sudah set di atas, tidak perlu fetch Firebase
            console.log('[Auth] Offline mode — gunakan cached session')
          } else {
            setStep('login') // Belum pernah login, perlu internet
          }
          return
        }
        try {
          const snap = await getDoc(doc(dbChat, 'chatUsers', u.uid))
          if (snap.exists() && snap.data().username) {
            const fresh = snap.data().username
            localStorage.setItem('kyoko_username_' + u.uid, fresh)
            setUsername(fresh)
            if (!cachedUsername) { setStep('main'); joinGroup(u.uid, fresh, u.photoURL || '') }
          } else if (!cachedUsername) setStep('username')
        } catch { if (!cachedUsername) setStep('username') }
      } else setStep('login')
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (step !== 'main') return
    // Load cache DULU → tampil instant, tidak blank saat buka chat
    try {
      const cached = localStorage.getItem(CHAT_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as GcMessage[]
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed)
      }
    } catch { /* ignore */ }
    // Reset window saat panel dibuka
    setMsgWindowExtra(0)

    const q = query(collection(dbChat, 'globalChat'), orderBy('createdAt', 'desc'), limit(100))
    return onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({
        id: d.id, ...(d.data() as Omit<GcMessage,'id'>),
        createdAt: d.data().createdAt?.toMillis?.() ?? Date.now()
      })).reverse()
      setMessages(msgs)
      // Simpan 60 pesan terakhir ke cache (untuk instant load berikutnya)
      try {
        localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(msgs.slice(-60)))
      } catch { /* ignore quota */ }
    }, (err) => {
      console.error('globalChat onSnapshot error:', err)
    })
  }, [step])

  useEffect(() => {
    if (step !== 'main') return
    const GROUP_ID = 'kyokomd-global'
    return onSnapshot(doc(dbChat, 'groups_info', GROUP_ID), async (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Omit<GroupInfo,'id'>
        setGroupInfo({ id: snap.id, ...data })
        const members = data.members || []
        if (members.length > 0) {
          const memberData = await Promise.all(
            members.slice(0, 20).map(async (uid: string) => {
              const uSnap = await getDoc(doc(dbChat, 'chatUsers', uid))
              const uData = uSnap.exists() ? uSnap.data() : {}
              return {
                uid, username: uData.username || 'User',
                photoURL: uData.photoURL || '',
                isAdmin: (data.admins || []).includes(uid),
                isOwner: data.ownerId === uid
              }
            })
          )
          // Sort: owner first, then admins, then members
          memberData.sort((a, b) => {
            if (a.isOwner) return -1
            if (b.isOwner) return 1
            if (a.isAdmin && !b.isAdmin) return -1
            if (!a.isAdmin && b.isAdmin) return 1
            return 0
          })
          setMemberList(memberData)
        }
      } else {
        await setDoc(doc(dbChat, 'groups_info', GROUP_ID), {
          name: 'KyokoMd Global', desc: 'Komunitas resmi KyokoMd. Ngobrol, game, dan RPG bareng!',
          iconUrl: '', ownerId: '', ownerName: 'KyokoMd', admins: [],
          members: [], memberNames: {}, createdAt: Date.now()
        })
      }
    })
  }, [step])

  useEffect(() => {
    if (step !== 'main' || !user) return
    // rpgChar: load IndexedDB DULU (instant + offline-capable), lalu update dari Firebase
    const fetchRpgChar = async () => {
      // 1. Load lokal (instant, works offline)
      const localChar = await rpgLoadLocal(user!.uid)
      if (localChar) {
        setRpgChar(localChar as RpgChar)
        rpgCharRef.current = localChar as RpgChar
      }

      // 2. Fetch Firebase (update jika online)
      if (navigator.onLine) {
        try {
          const snap = await getDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid))
          if (snap.exists()) {
            const fbChar = snap.data() as RpgChar
            setRpgChar(fbChar)
            rpgCharRef.current = fbChar
            // Update IndexedDB dengan data Firebase (truth source terbaru)
            await rpgSaveLocal(user!.uid, fbChar)
            await setSyncMeta(user!.uid, {
              lastSync: Date.now(),
              lastSyncedGold: fbChar.gold || 0,
              hasLocalChanges: false,
            })
          } else if (!localChar) {
            setRpgChar(null)
          }

          // Execute pending transfers dari saat offline
          const charForTransfer = rpgCharRef.current
          if (charForTransfer) {
            const count = await executePendingTransfers(
              user!.uid, charForTransfer.gold || 0, getRpgDb,
              (msg, ok) => showToast(ok ? 'win' : 'info', msg, '')
            )
            if (count > 0) {
              // Refresh gold dari Firebase setelah transfer
              const snap2 = await getDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid))
              if (snap2.exists()) {
                const refreshed = snap2.data() as RpgChar
                setRpgChar(refreshed); rpgCharRef.current = refreshed
                await rpgSaveLocal(user!.uid, refreshed)
              }
            }
            // Update pending transfer count badge
            const pending = await getPendingTransfers(user!.uid)
            setPendingTransferCount(pending.length)
          }
        } catch {
          console.log('[RPG] Firebase tidak bisa diakses, gunakan data lokal')
        }
      } else {
        // Offline: tampilkan pending transfer count
        const pending = await getPendingTransfers(user!.uid)
        setPendingTransferCount(pending.length)
      }
    }
    fetchRpgChar()
  }, [step, user])

  // Gacha data: getDoc sekali saat login, update lokal setelah write
  useEffect(() => {
    if (step !== 'main' || !user) return
    const fetchGacha = async () => {
      const snap = await getDoc(doc(getRpgDb(user!.uid), 'playerGacha', user.uid))
      if (snap.exists()) {
        setGachaData(snap.data() as PlayerGacha)
      } else {
        const init: PlayerGacha = {
          uid: user.uid, primogems: 1600, tickets: 10,
          pity: 0, pity6: 0, guaranteed: false,
          roster: ['amber','kaeya','lisa'], pulls: 0,
          charLevels: { amber:1, kaeya:1, lisa:1 },
          constellations: { amber:0, kaeya:0, lisa:0 },
          charMats: { fish:0, ore:0, herb:0 },
          charExp: {}
        }
        await setDoc(doc(getRpgDb(user!.uid), 'playerGacha', user.uid), init)
        setGachaData(init)
      }
    }
    fetchGacha()

  // ── Battle Pass requests listener (owner only) ─────────────────
  const isOwner = groupInfo?.ownerId === user.uid
  if (isOwner) {
    const bpRef = collection(dbChat, 'battlePassRequests')
    const qBp = query(bpRef, where('status', '==', 'pending'))
    const unsubBp = onSnapshot(qBp, (snap) => {
      const reqs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      setBpRequests(reqs)
    })
    return () => { unsubBp() }
  }
  }, [step, user, groupInfo?.ownerId])

  // Leaderboard: on-demand + cache 6 jam — fetch hanya saat buka leaderboard/duel/transfer
  const LEADERBOARD_CACHE_MS = 6 * 60 * 60 * 1000
  const fetchLeaderboard = useCallback(async (force = false) => {
    if (!user) return
    const now = Date.now()
    if (!force && now - leaderboardLastFetchRef.current < LEADERBOARD_CACHE_MS) return
    try {
      const q = query(collection(getRpgDb(user!.uid), 'rpgChars'), orderBy('level', 'desc'), limit(20))
      const snap = await getDocs(q)
      setLeaderboard(snap.docs.map(d => {
        const data = d.data()
        return { uid: d.id, username: data.username, level: data.level, class: data.class, kills: data.kills, gold: data.gold || 0 }
      }))
      leaderboardLastFetchRef.current = now
    } catch (e) { console.error('fetchLeaderboard:', e) }
  }, [user])

  useEffect(() => {
    if (step !== 'main') return
    fetchLeaderboard() // fetch 1x saat login, skip jika cache masih valid
  }, [step, fetchLeaderboard])

  // Active battles: fetch on-demand saat user buka tab RPG saja (bukan polling)
  // Dipanggil manual via fetchActiveBattles() saat rpgTab dibuka
  const fetchActiveBattles = useCallback(async () => {
    if (!user) return
    try {
      const q = query(collection(getRpgDb(user!.uid), 'activeBattles'))
      const snap = await getDocs(q)
      const now = Date.now()
      const battles = snap.docs
        .map(d => d.data() as ActiveBattleInfo)
        .filter(b => now - b.updatedAt < 60000) // valid 60 detik
      setActiveBattles(battles)
    } catch {}
  }, [user])

  useEffect(() => {
    if (messages.length === 0) return
    const el = messagesRef.current
    if (!el) return
    // First time messages load: scroll to bottom instantly, no "Pesan Baru"
    if (!initialScrollDone.current) {
      el.scrollTop = el.scrollHeight
      initialScrollDone.current = true
      setShowScrollDown(false)
      setHasNewMsg(false)
      return
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (isNearBottom) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
      setShowScrollDown(false)
      setHasNewMsg(false)
    } else {
      setShowScrollDown(true)
      // Only set hasNewMsg if the newest message is from someone else
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.uid !== user?.uid) {
        setHasNewMsg(true)
      }
    }
  }, [messages, user?.uid])

  useEffect(() => {
    if (step !== 'main' || !user) return
    const typingRef = doc(dbChat, 'typing', 'global')
    return onSnapshot(typingRef, (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      const now = Date.now()
      const active = Object.entries(data)
        .filter(([uid, ts]) => uid !== user.uid && typeof ts === 'number' && now - (ts as number) < 4000)
        .map(([uid]) => {
          const found = memberList.find(m => m.uid === uid)
          return found?.username || 'Seseorang'
        })
      setTypingUsers(active)
    })
  }, [step, user, memberList])

  const handleTyping = useCallback(() => {
    if (!user) return
    const typingRef = doc(dbChat, 'typing', 'global')
    // Debounce typing: hanya write ke Firestore setelah 1.5 detik berhenti ngetik
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
    typingDebounceRef.current = setTimeout(() => {
      setDoc(typingRef, { [user.uid]: Date.now() }, { merge: true })
    }, 1500)
    setIsTyping(true)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false)
      setDoc(typingRef, { [user.uid]: 0 }, { merge: true })
    }, 3000)
  }, [user])

  const joinGroup = async (uid: string, uname: string, photo: string) => {
    try {
      await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), {
        members: arrayUnion(uid),
        [`memberNames.${uid}`]: uname
      })
    } catch {}
  }

  const handleLogin = async () => {
    setLoginLoading(true)
    try {
      const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.()
      if (isCapacitor) {
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
        await GoogleAuth.initialize()
        const googleUser = await GoogleAuth.signIn()
        const credential = (await import('firebase/auth')).GoogleAuthProvider.credential(
          googleUser.authentication.idToken
        )
        const { signInWithCredential } = await import('firebase/auth')
        await signInWithCredential(auth, credential)
      } else {
        await signInWithPopup(auth, googleProvider)
      }
    } catch (err: any) {
      console.error('Login error:', err)
      setLoginLoading(false)
    }
  }

  const handleSetUsername = async () => {
    const t = usernameInput.trim()
    if (!t) { setUsernameError('Username tidak boleh kosong'); return }
    if (t.length < 3) { setUsernameError('Minimal 3 karakter'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(t)) { setUsernameError('Hanya huruf, angka, underscore'); return }
    setSavingUsername(true)
    try {
      // Cek username unik dengan targeted query (lebih cepat)
      const usersSnap = await getDocs(query(collection(dbChat, 'chatUsers'), where('username', '==', t)))
      const taken = usersSnap.docs.some(d => d.id !== user!.uid)
      // Juga cek case-insensitive (lowercase variant)
      const usersSnapLower = await getDocs(query(collection(dbChat, 'chatUsers'), where('username', '==', t.toLowerCase())))
      const takenLower = usersSnapLower.docs.some(d => d.id !== user!.uid)
      if (taken || takenLower) { setUsernameError('Username sudah dipakai, coba yang lain!'); setSavingUsername(false); return }
      await setDoc(doc(dbChat, 'chatUsers', user!.uid), {
        username: t, photoURL: user!.photoURL || '', email: user!.email || '', createdAt: serverTimestamp()
      })
      setUsername(t); setStep('main')
      localStorage.setItem('kyoko_username_' + user!.uid, t)
      joinGroup(user!.uid, t, user!.photoURL || '')
    } catch { setUsernameError('Gagal menyimpan, coba lagi') }
    finally { setSavingUsername(false) }
  }

  // ── Moderasi helpers ──────────────────────────────────────────
  const checkModerasiViolation = (text: string): string | null => {
    const lower = text.toLowerCase()
    const linkRegex = /https?:\/\/\S+|www\.\S+/i
    const waLinkRegex = /wa\.me|chat\.whatsapp|wa\.link/i
    const promoRegex = /(promo|diskon|jual|beli|order|gratis|murah|harga|dijual|free|sale|contact|hub aku|hubungi)/i
    if (moderasi.antiLinkAll && linkRegex.test(text)) return '🚫 Anti Link aktif: link tidak diizinkan.'
    if (moderasi.antiLinkWa && waLinkRegex.test(text)) return '🚫 Anti Link WA aktif: link WhatsApp tidak diizinkan.'
    if (moderasi.antiPromo && promoRegex.test(lower)) return '🚫 Anti Promosi aktif: pesan promosi tidak diizinkan.'
    if (moderasi.antiBadword) {
      const found = moderasi.badwords.find(w => lower.includes(w.toLowerCase()))
      if (found) return `🚫 Anti Kata Kasar aktif: kata "${found}" tidak diizinkan.`
    }
    return null
  }

  const saveModerasiToFirestore = async (newMod: ModerasiConfig) => {
    try {
      await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), { moderasi: newMod })
    } catch {}
  }

  const handleToggleModerasiField = async (field: keyof Omit<ModerasiConfig, 'badwords'>) => {
    const newMod = { ...moderasi, [field]: !moderasi[field] }
    setModerasiState(newMod)
    await saveModerasiToFirestore(newMod)
  }

  const handleAddBadword = async () => {
    const w = badwordInput.trim().toLowerCase()
    if (!w || moderasi.badwords.includes(w)) { setBadwordInput(''); return }
    const newMod = { ...moderasi, badwords: [...moderasi.badwords, w] }
    setModerasiState(newMod); setBadwordInput('')
    await saveModerasiToFirestore(newMod)
  }

  const handleRemoveBadword = async (w: string) => {
    const newMod = { ...moderasi, badwords: moderasi.badwords.filter(b => b !== w) }
    setModerasiState(newMod)
    await saveModerasiToFirestore(newMod)
  }

  const handleSetAutoClear = async (val: 'off' | 'daily' | 'weekly') => {
    const newMod = { ...moderasi, autoClear: val }
    setModerasiState(newMod)
    await saveModerasiToFirestore(newMod)
  }

  const isAdmin = user ? (groupInfo?.admins?.includes(user.uid) || groupInfo?.ownerId === user.uid) : false

  const handleClearChatNow = async () => {
    if (!isAdmin) return
    try {
      const snap = await getDocs(collection(dbChat, 'globalChat'))
      await Promise.all(snap.docs.map(d => deleteDoc(doc(dbChat, 'globalChat', d.id))))
      const newMod = { ...moderasi, lastClearedAt: Date.now() }
      setModerasiState(newMod)
      await saveModerasiToFirestore(newMod)
    } catch {}
  }

  // ── Auto-clear background checker ─────────────────────────────
  React.useEffect(() => {
    if (!isAdmin || !moderasi.autoClear || moderasi.autoClear === 'off') return
    const intervalMs = moderasi.autoClear === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    const lastCleared = moderasi.lastClearedAt || 0
    const shouldClear = Date.now() - lastCleared >= intervalMs
    if (!shouldClear) return
    // Jalankan clear
    handleClearChatNow()
  }, [moderasi.autoClear, moderasi.lastClearedAt, isAdmin])

  // ── @mention helpers ──────────────────────────────────────────
  const getMentionSuggestions = () => {
    if (!mentionQuery) return []
    return memberList
      .filter(m => m.uid !== user?.uid && m.username.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      .slice(0, 5)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInput(val)
    handleTyping()
    // Deteksi @mention
    const cursor = e.target.selectionStart ?? val.length
    const textBefore = val.slice(0, cursor)
    const atMatch = textBefore.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setShowMention(true)
      setMentionIndex(0)
    } else {
      setShowMention(false)
      setMentionQuery('')
    }
  }

  const handleMentionSelect = (username: string) => {
    const cursor = inputRef.current?.selectionStart ?? input.length
    const textBefore = input.slice(0, cursor)
    const textAfter = input.slice(cursor)
    const newText = textBefore.replace(/@\w*$/, `@${username} `) + textAfter
    setInput(newText)
    setShowMention(false)
    setMentionQuery('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending || !user || !username) return
    // Cek moderasi
    const violation = checkModerasiViolation(text)
    if (violation) {
      showToast('info', '🚫 Moderasi', violation)
      return
    }
    const replyData = replyTo ? { replyToId: replyTo.id, replyToUser: replyTo.username, replyToText: replyTo.text.slice(0, 60) } : {}
    setInput(''); setSending(true); setShowMention(false); setReplyTo(null)
    try {
      await addDoc(collection(dbChat, 'globalChat'), {
        uid: user.uid, username, photoURL: user.photoURL || '',
        text, type: 'text', createdAt: serverTimestamp(),
        ...replyData
      })
    } catch (err) {
      setInput(text)
      showToast('info', '❌ Gagal kirim', 'Pesan gagal terkirim, coba lagi')
    }
    finally { setSending(false); inputRef.current?.focus() }
  }

  const handleLogout = async () => {
    // 1. Langsung ke login screen - UI responsif
    setStep('login')
    setUsername('')
    setSending(false) // reset sending state agar tidak nyangkut setelah re-login
    const currentUser = user
    setUser(null)
    if (currentUser) {
      // 2. Await cleanup - aman karena UI sudah di login screen
      // arrayRemove di-await agar tidak race condition dengan re-login arrayUnion
      try {
        await addDoc(collection(dbChat, 'globalChat'), {
          uid: 'system', username: 'System', photoURL: '',
          text: `👋 ${username} telah keluar dari Obrolan Global.`,
          type: 'text', createdAt: serverTimestamp()
        })
      } catch {}
      await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), { members: arrayRemove(currentUser.uid) }).catch(() => {})
      deleteDoc(doc(getRpgDb(user!.uid), 'activeBattles', currentUser.uid)).catch(() => {})
    }
    await signOut(auth)
  }

  // ── Delete message ────────────────────────────────────────────
  const handleDeleteMsg = async (msgId: string, msgUid: string) => {
    if (!user) return
    if (user.uid !== msgUid && !isAdmin) return
    try {
      await deleteDoc(doc(dbChat, 'globalChat', msgId))
    } catch {}
    setMsgMenuId(null)
  }

  // ── Avatar: admin upload/delete ───────────────────────────────
  const handleAdminUploadAvatar = async () => {
    const url = adminAvatarInput.trim()
    if (!url) return
    const id = `avatar-${Date.now()}`
    await setDoc(doc(dbChat, 'presetAvatars', id), { url }).catch(() => {})
    setAdminAvatarInput('')
  }
  const handleAdminDeleteAvatar = async (id: string) => {
    await deleteDoc(doc(dbChat, 'presetAvatars', id)).catch(() => {})
  }

  const handleStickerSearch = async () => {
    if (!stickerSearchQuery.trim()) return
    setStickerSearchLoading(true); setStickerSearchResults([]); setStickerSearchPreview(null)
    try {
      const res = await fetch(`https://api-faa.my.id/faa/stickerly?q=${encodeURIComponent(stickerSearchQuery)}`)
      const data = await res.json()
      if (data?.status && Array.isArray(data.results)) setStickerSearchResults(data.results.slice(0, 30))
    } catch {}
    setStickerSearchLoading(false)
  }

  const handleAddStickerFromSearch = async (url: string) => {
    const id = `sticker-${Date.now()}`
    await setDoc(doc(dbChat, 'presetStickers', id), { url, enabled: true }).catch(() => {})
    setStickerSearchPreview(null); setShowStickerSearch(false); setStickerSearchResults([]); setStickerSearchQuery('')
  }

  // ── User pick avatar ──────────────────────────────────────────
  const handlePickAvatar = async (url: string) => {
    if (!user) return
    try {
      await updateDoc(doc(dbChat, 'chatUsers', user.uid), { photoURL: url })
      // Update messages visually via Firebase (messages will re-render)
    } catch {}
    setShowAvatarPicker(false)
  }

  // ── Music: play via SoundCloud API ──────────────────────────────
  const handleMusicSearch = async () => {
    if (!musicQuery.trim()) return
    setMusicSearching(true)
    setMusicResults([])
    setGcMusicError('')
    try {
      const apiUrl = gcMusicApiUrl.replace(/\/$/, '')
      const res = await fetch(`${apiUrl}?${musicQueryParam}=${encodeURIComponent(musicQuery)}`)
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      if (data?.status === false || !data?.result) throw new Error(data?.message || 'Tidak ditemukan')
      const r = data.result
      setMusicResults([{
        url: r.download_url || '',
        title: r.title || musicQuery,
        user: r.user || r.artist || '',
        thumbnail: r.thumbnail || ''
      }])
    } catch (e: any) {
      setGcMusicError('Lagu tidak ditemukan atau API sedang bermasalah.')
    }
    setMusicSearching(false)
  }

  const handlePlayGcMusic = (result: {url:string;title:string;thumbnail?:string}) => {
    // Pause web background music if playing
    try {
      const webAudio = document.querySelector('audio') as HTMLAudioElement | null
      if (webAudio && !webAudio.paused) { webAudio.pause(); (window as any).__webAudioPausedByGc = true }
    } catch {}
    // Stop existing global audio
    const existing = getGlobalAudio()
    if (existing) { existing.pause(); existing.src = ''; existing.onended = null }
    if (gcAudioRef.current) { gcAudioRef.current.pause(); gcAudioRef.current.src = '' }

    const audio = new Audio(result.url)
    audio.volume = 0.8
    setGlobalAudio(audio)
    gcAudioRef.current = audio
    audio.play().then(() => { setGcMusicPlaying(true); setGcMusicVisualizer(true) }).catch(() => setGcMusicError('Gagal memutar audio.'))
    audio.onended = () => {
      setGcMusicPlaying(false); setGcMusicVisualizer(false)
      setGlobalAudio(null)
      // ── Autoplay next track by same category ──
      const currentTitle = getGlobalNowPlaying()?.title || result.title
      setGlobalNowPlaying(null); setNowPlayingState(null)
      if (autoplayEnabled) {
        const q = getAutoplayQuery(currentTitle)
        setAutoplayLoading(true)
        const apiUrl = gcMusicApiUrl.replace(/\/$/, '')
        fetch(`${apiUrl}?${musicQueryParam}=${encodeURIComponent(q)}`)
          .then(r => r.json())
          .then(data => {
            setAutoplayLoading(false)
            if (data?.status !== false && data?.result) {
              const r2 = data.result
              const nextTrack = { url: r2.download_url || '', title: r2.title || q, thumbnail: r2.thumbnail || '' }
              if (nextTrack.url) handlePlayGcMusic(nextTrack)
            }
          })
          .catch(() => { setAutoplayLoading(false) })
      }
    }
    setNowPlaying(result)
    setShowMusicSearch(false)
  }

  const handleStopGcMusic = () => {
    const existing = getGlobalAudio()
    if (existing) { existing.pause(); existing.src = ''; existing.onended = null }
    if (gcAudioRef.current) { gcAudioRef.current.pause(); gcAudioRef.current.src = '' }
    setGlobalAudio(null)
    setGcMusicPlaying(false); setGcMusicVisualizer(false); setNowPlaying(null)
    // Resume web music if it was paused by GC
    try {
      if ((window as any).__webAudioPausedByGc) {
        const webAudio = document.querySelector('audio') as HTMLAudioElement | null
        if (webAudio) { webAudio.play().catch(() => {}); (window as any).__webAudioPausedByGc = false }
      }
    } catch {}
  }

  const handleSaveMusicApi = () => {
    const val = musicApiInput.trim()
    if (!val) return
    localStorage.setItem('kyoko_music_api', val)
    setGcMusicApiUrl(val)
    setShowMusicApiEdit(false)
    setMusicApiInput('')
  }

  const handleSaveGroup = async () => {
    if (!isAdmin || !groupInfo) return
    setSavingGroup(true)
    try {
      await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), {
        name: editGroupName || groupInfo.name,
        desc: editGroupDesc || groupInfo.desc,
        iconUrl: editGroupIcon !== undefined ? editGroupIcon : groupInfo.iconUrl
      })
      setShowGroupSettings(false)
    } catch {} finally { setSavingGroup(false) }
  }

  // ── Sticker handlers ──────────────────────────────────────────
  const handleAdminUploadSticker = async () => {
    const url = adminStickerInput.trim()
    if (!url || !isAdmin) return
    const id = `sticker-${Date.now()}`
    await setDoc(doc(dbChat, 'presetStickers', id), { url, enabled: true }).catch(() => {})
    setAdminStickerInput('')
  }
  const handleAdminDeleteSticker = async (id: string) => {
    await deleteDoc(doc(dbChat, 'presetStickers', id)).catch(() => {})
  }
  const handleToggleStickerEnabled = async (id: string, current: boolean) => {
    await updateDoc(doc(dbChat, 'presetStickers', id), { enabled: !current }).catch(() => {})
  }
  const handleSendSticker = async (url: string) => {
    if (!user) return
    await addDoc(collection(dbChat, 'globalChat'), {
      uid: user.uid, username, photoURL: user.photoURL || '',
      text: '[sticker]', type: 'sticker', stickerUrl: url, createdAt: serverTimestamp()
    }).catch(() => {})
    setShowStickerPicker(false)
  }

  // ── Member management handlers ────────────────────────────────
  const isOwner = user ? groupInfo?.ownerId === user.uid : false

  const handlePromoteAdmin = async (uid: string) => {
    if (!isAdmin) return
    await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), { admins: arrayUnion(uid) }).catch(() => {})
    setMemberMenuId(null)
  }
  const handleDemoteAdmin = async (uid: string) => {
    if (!isAdmin) return
    await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), { admins: arrayRemove(uid) }).catch(() => {})
    setMemberMenuId(null)
  }
  const handleKickMember = async (uid: string) => {
    if (!isAdmin) return
    await updateDoc(doc(dbChat, 'groups_info', 'kyokomd-global'), {
      members: arrayRemove(uid),
      admins: arrayRemove(uid)
    }).catch(() => {})
    setMemberMenuId(null)
  }

  // ── RPG: Loading bar ──────────────────────────────────────────
  const startLoading = (cb: () => void, duration = 1800) => {
    setLoadingActive(true); setLoadingBar(0)
    const start = Date.now()
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      setLoadingBar(p)
      if (p < 1) requestAnimationFrame(tick)
      else { setLoadingActive(false); cb() }
    }
    requestAnimationFrame(tick)
  }

  const createCharacter = async (cls: RpgClass, elem: RpgElement) => {
    if (!user) return
    setRpgLoading(true)
    const base = RPG_CLASSES[cls]
    const char: RpgChar = {
      uid: user.uid, username, class: cls, level: 1, exp: 0,
      hp: base.baseHp, maxHp: base.baseHp, mp: base.baseMp, maxMp: base.baseMp,
      atk: base.atk, def: base.def, spd: base.spd, luck: base.luck,
      gold: 100, inventory: [], skills: base.skills,
      activeQuest: null, questProgress: 0, kills: 0, titles: ['Pemula'],
      element: elem, wins: 0, losses: 0
    }
    startLoading(async () => {
      await setDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), char)
      setRpgLoading(false); setRpgView('dashboard')
    })
  }

  // ── RPG: Battle ───────────────────────────────────────────────
  const startBattle = (mIdx: number) => {
    if (!rpgChar) return
    const m = { ...MONSTERS[mIdx] }
    const bs = {
      monster: m, monsterHp: m.hp, monsterMp: 80,
      monsterShield: 0, monsterShieldMax: Math.floor(m.hp * 0.15),
      playerHp: rpgChar.hp, playerMp: rpgChar.mp,
      playerShield: 0, playerShieldMax: Math.floor(rpgChar.maxHp * 0.2),
      log: [{ text: `⚔️ ${rpgChar.username} vs ${m.emoji} ${m.name}!`, type: 'info' as const }],
      phase: 'confirm' as const, loading: false, turn: 0
    }
    setBattleState(bs)
    setRpgView('battle')
    // Publish active battle
    if (user) {
      setDoc(doc(getRpgDb(user!.uid), 'activeBattles', user.uid), {
        uid: user.uid, username: rpgChar.username, class: rpgChar.class,
        playerHp: rpgChar.hp, playerMaxHp: rpgChar.maxHp,
        playerMp: rpgChar.mp, playerMaxMp: rpgChar.maxMp,
        monsterName: m.name, monsterEmoji: m.emoji,
        monsterHp: m.hp, monsterMaxHp: m.hp,
        updatedAt: Date.now()
      }).catch(() => {})
    }
  }

  const lastActiveBattleWrite = useRef(0)
  const updateActiveBattle = (_bsNew: typeof battleState) => {
    // Dinonaktifkan: mid-battle writes dihapus untuk hemat quota Firebase.
    // activeBattle hanya di-publish saat battle mulai (startBattle) dan dihapus saat selesai (clearActiveBattle).
    void _bsNew
  }

  const clearActiveBattle = () => {
    if (user) deleteDoc(doc(getRpgDb(user!.uid), 'activeBattles', user.uid)).catch(() => {})
  }

  // ── RPG: Konfirmasi START / MUNDUR ───────────────────────────
  const confirmBattle = () => {
    if (!battleState || !rpgChar) return
    setBattleState(prev => prev ? { ...prev, phase: 'running' } : prev)
    // Mulai loop AI setelah confirm
  }

  const cancelBattle = () => {
    clearActiveBattle()
    setBattleState(null)
    setRpgView('dashboard')
  }

  const endBattle = async () => {
    if (!rpgChar) return
    setAutoBattle(false)
    autoBattleRef.current = false
    if (battleState && battleState.phase !== 'result') {
      try {
        await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), {
          hp: Math.max(1, battleState.playerHp),
          mp: battleState.playerMp
        })
      } catch (e) { console.error('endBattle save error:', e) }
      clearActiveBattle()
    }
    setBattleState(null)
    setRpgView('dashboard')
  }

  // ── AI Battle Engine — satu tick per 900ms ────────────────────
  const battleStateRef = useRef<typeof battleState>(battleState)
  useEffect(() => { battleStateRef.current = battleState }, [battleState])
  const rpgCharRef2 = useRef(rpgChar)
  useEffect(() => { rpgCharRef2.current = rpgChar }, [rpgChar])

  useEffect(() => {
    if (!battleState || battleState.phase !== 'running') return
    const interval = setInterval(() => {
      const bs = battleStateRef.current
      const char = rpgCharRef2.current
      if (!bs || bs.phase !== 'running' || !char) return

      // Clone state untuk tick ini
      let { monsterHp, monsterMp, monsterShield, playerHp, playerMp, playerShield, turn } = bs
      const newLog: typeof bs.log = []
      const nowTs = Date.now()
      const activeFoodBuffs = (char.foodBuffs || []).filter(b => b.expiresAt > nowTs)
      const buffedAtk = activeFoodBuffs.filter(b => b.stat === 'atk').reduce((acc, b) => acc + b.value, char.atk)
      const buffedDef = activeFoodBuffs.filter(b => b.stat === 'def').reduce((acc, b) => acc + b.value, char.def)
      turn++

      // ── PLAYER TURN (AI cerdas) ─────────────────────────────
      // Prioritas: kalau HP < 30% → heal / shield
      //            kalau MP cukup dan musuh tidak bershield → pakai skill
      //            kalau musuh punya shield tinggi → normal attack dulu
      //            else normal attack
      const playerHpPct = playerHp / char.maxHp
      const playerUsedAction = (() => {
        // Heal dulu kalau hp kritis & ada MP
        if (playerHpPct < 0.30 && playerMp >= 25) {
          const healAmt = Math.floor(char.maxHp * 0.28)
          playerHp = Math.min(char.maxHp, playerHp + healAmt)
          playerMp = Math.max(0, playerMp - 25)
          newLog.push({ text: `💚 [Player] Pulihkan ${healAmt} HP! [MP -25]`, type: 'heal' })
          return 'heal'
        }
        // Pasang shield kalau HP < 55% dan belum ada shield
        if (playerHpPct < 0.55 && playerShield === 0 && playerMp >= 20 && Math.random() < 0.5) {
          playerShield = bs.playerShieldMax
          playerMp = Math.max(0, playerMp - 20)
          newLog.push({ text: `🛡️ [Player] Pasang Perisai! [Shield +${bs.playerShieldMax}, MP -20]`, type: 'shield' })
          return 'shield'
        }
        // Skill attack kalau MP cukup dan musuh tidak punya shield penuh
        if (playerMp >= 18 && (monsterShield < bs.monsterShieldMax * 0.5 || Math.random() < 0.3)) {
          const skillIdx = Math.floor(Math.random() * Math.min(char.skills.length, 4))
          const mpCost = 15 + skillIdx * 5
          if (playerMp >= mpCost) {
            const crit = Math.random() * 100 < char.luck * 1.5
            let dmg = Math.max(2, Math.floor(buffedAtk * (1.4 + skillIdx * 0.2)) - Math.floor(bs.monster.def * 0.6) + Math.floor(Math.random() * 10) - 5)
            if (crit) dmg = Math.floor(dmg * 2)
            // Damage ke shield dulu
            if (monsterShield > 0) {
              const absorbedByShield = Math.min(monsterShield, Math.floor(dmg * 0.7))
              monsterShield = Math.max(0, monsterShield - absorbedByShield)
              dmg = Math.max(1, dmg - absorbedByShield)
              newLog.push({ text: `💥 [Skill: ${char.skills[skillIdx]}]${crit?' CRIT!':''} Tembus Shield! -${absorbedByShield}🛡️ -${dmg}HP`, type: 'skill' })
            } else {
              newLog.push({ text: `✨ [Skill: ${char.skills[skillIdx]}]${crit?' CRIT!':''} ${bs.monster.name} -${dmg} HP!`, type: 'skill' })
            }
            monsterHp = Math.max(0, monsterHp - dmg)
            playerMp = Math.max(0, playerMp - mpCost)
            return 'skill'
          }
        }
        // Normal attack
        const crit = Math.random() * 100 < char.luck
        let dmg = Math.max(1, buffedAtk - Math.floor(bs.monster.def * 0.8) + Math.floor(Math.random() * 8) - 4)
        if (crit) dmg = Math.floor(dmg * 1.8)
        if (monsterShield > 0) {
          const absorbed = Math.min(monsterShield, Math.floor(dmg * 0.5))
          monsterShield = Math.max(0, monsterShield - absorbed)
          dmg = Math.max(1, dmg - absorbed)
          newLog.push({ text: `⚔️${crit?' KRITIS!':''} [Player] Tembus Shield! -${absorbed}🛡️ -${dmg}HP ke ${bs.monster.name}`, type: 'dmg' })
        } else {
          newLog.push({ text: `⚔️${crit?' KRITIS!':''} [Player] ${bs.monster.name} -${dmg} HP!`, type: 'dmg' })
        }
        monsterHp = Math.max(0, monsterHp - dmg)
        // Regen MP sedikit tiap serangan
        playerMp = Math.min(char.maxMp, playerMp + 5)
        return 'normal'
      })()

      // ── CEK MENANG ──────────────────────────────────────────
      if (monsterHp <= 0) {
        const expGain = bs.monster.exp; const goldGain = bs.monster.gold
        newLog.push({ text: `🏆 Menang! +${expGain} EXP +${goldGain} Gold | Drop: ${bs.monster.drop}`, type: 'info' })
        setBattleAnim('player-atk')
        setTimeout(() => setBattleAnim(''), 400)
        setBattleState(prev => prev ? {
          ...prev, monsterHp: 0, playerHp, playerMp, playerShield, monsterShield,
          log: [...prev.log, ...newLog].slice(-30),
          phase: 'result', result: 'win', turn, loading: false
        } : prev)
        clearActiveBattle()
        showToast('win', '🏆 MENANG!', `+${expGain} EXP · +${goldGain} Gold`)
        const newExp = char.exp + expGain; const newGold = char.gold + goldGain
        const newLevel = getLevel(newExp); const newKills = char.kills + 1
        const inv = [...char.inventory, bs.monster.drop]
        const lvlUp = newLevel > char.level
        let newQP = char.questProgress; let newAQ = char.activeQuest
        if (char.activeQuest) {
          const quest = QUESTS.find(q => q.id === char.activeQuest)
          if (quest && quest.ranks.includes(bs.monster.rank)) {
            newQP = Math.min(newQP + 1, quest.kills)
            if (newQP >= quest.kills) newLog.push({ text: `✅ Quest selesai! Klaim di Quest Board.`, type: 'info' })
          }
        }
        const updates: Partial<RpgChar> = {
          exp: newExp, gold: newGold, level: newLevel, kills: newKills,
          inventory: inv.slice(-20), activeQuest: newAQ, questProgress: newQP,
          hp: Math.min(playerHp, char.maxHp + (lvlUp ? 20 : 0)),
          mp: Math.min(playerMp, char.maxMp + (lvlUp ? 15 : 0)),
          wins: (char.wins || 0) + 1
        }
        const todayStr = new Date().toDateString()
        const dm = char.dailyMissions?.date === todayStr ? char.dailyMissions : { date: todayStr, completed: [], claimed: [] }
        if (!dm.completed.includes('dm_battle') && newKills % 3 === 0) dm.completed = [...dm.completed, 'dm_battle']
        updates.dailyMissions = dm
        if (lvlUp) {
          updates.maxHp = char.maxHp + 20; updates.maxMp = char.maxMp + 15
          updates.atk = char.atk + 3; updates.def = char.def + 2
          const titleIdx = Math.min(Math.floor(newLevel / 5), TITLES.length - 1)
          updates.titles = [TITLES[titleIdx]]
          showToast('info', '🎉 LEVEL UP!', `Naik ke Level ${newLevel}!`)
        }
        updateRpgChar(updates)
        // ── Tambah 1 ore material ke charMats saat menang battle ──
        if (gachaData) {
          const curMats = gachaData.charMats ?? { fish:0, ore:0, herb:0 }
          const newMats = { ...curMats, ore: curMats.ore + 1 }
          updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user!.uid), { charMats: newMats }).catch(console.error)
          setGachaData(prev => prev ? { ...prev, charMats: newMats } : prev)
        }
        return
      }

      // ── MONSTER TURN (AI musuh cerdas) ───────────────────────
      const monsterHpPct = monsterHp / bs.monster.hp
      const canHeal = bs.monster.canHeal
      const canShield = bs.monster.canShield

      // Heal kalau HP < 25% dan punya kemampuan
      if (canHeal && monsterHpPct < 0.25 && monsterMp >= 30 && Math.random() < 0.6) {
        const healAmt = Math.floor(bs.monster.hp * 0.12)
        monsterHp = Math.min(bs.monster.hp, monsterHp + healAmt)
        monsterMp = Math.max(0, monsterMp - 30)
        newLog.push({ text: `💜 [${bs.monster.name}] Regenerasi +${healAmt} HP!`, type: 'heal' })
      }
      // Shield kalau HP < 50% dan belum ada shield
      else if (canShield && monsterShield === 0 && monsterHpPct < 0.50 && monsterMp >= 20 && Math.random() < 0.4) {
        monsterShield = bs.monsterShieldMax
        monsterMp = Math.max(0, monsterMp - 20)
        newLog.push({ text: `🔴 [${bs.monster.name}] Pasang Perisai! [Shield +${bs.monsterShieldMax}]`, type: 'shield' })
      }
      // Serangan musuh
      else {
        const rankPen: Record<string,number> = { F:0, E:0.1, D:0.2, C:0.35, B:0.5, A:0.65, S:0.8, SS:1.0 }
        const pen = rankPen[bs.monster.rank] || 0
        const effectiveDef = Math.floor(buffedDef * (1 - pen))
        const minDmg = Math.max(1, Math.floor(bs.monster.atk * 0.15))
        const baseDmg = bs.monster.atk - effectiveDef + Math.floor(Math.random() * 8) - 4
        let eDmg = Math.max(minDmg, baseDmg)
        // Terkadang musuh pakai serangan kuat (20% chance)
        const powerAtk = Math.random() < 0.2
        if (powerAtk) { eDmg = Math.floor(eDmg * 1.6); }
        // Kurangi shield player dulu
        if (playerShield > 0) {
          const absorbed = Math.min(playerShield, Math.floor(eDmg * 0.8))
          playerShield = Math.max(0, playerShield - absorbed)
          eDmg = Math.max(1, eDmg - absorbed)
          newLog.push({ text: `${powerAtk?'🔥 Serangan Kuat!':''}🗡️ [${bs.monster.name}] Tembus Shield! -${absorbed}🛡️ -${eDmg}HP`, type: 'dmg' })
        } else {
          newLog.push({ text: `${powerAtk?'🔥 Serangan Kuat! ':''} 🗡️ [${bs.monster.name}] Menyerang -${eDmg} HP!`, type: 'dmg' })
        }
        playerHp = Math.max(0, playerHp - eDmg)
        monsterMp = Math.min(100, monsterMp + 8)
      }

      setBattleAnim(turn % 2 === 0 ? 'player-atk' : 'enemy-atk')
      setTimeout(() => setBattleAnim(''), 400)

      // ── CEK KALAH ──────────────────────────────────────────
      if (playerHp <= 0) {
        newLog.push({ text: `💀 Kamu kalah! HP dipulihkan sebagian.`, type: 'info' })
        setBattleState(prev => prev ? {
          ...prev, playerHp: 0, monsterHp, monsterMp, monsterShield, playerShield,
          log: [...prev.log, ...newLog].slice(-30),
          phase: 'result', result: 'lose', turn, loading: false
        } : prev)
        clearActiveBattle()
        showToast('lose', '💀 KALAH!', `${bs.monster.name} mengalahkanmu.`)
        updateRpgChar({
          hp: Math.floor(char.maxHp * 0.3),
          mp: Math.floor(char.maxMp * 0.5),
          losses: (char.losses || 0) + 1
        })
        return
      }

      setBattleState(prev => prev ? {
        ...prev, monsterHp, monsterMp, monsterShield, playerHp, playerMp, playerShield, turn,
        log: [...prev.log, ...newLog].slice(-30), loading: false
      } : prev)
    }, 900)
    return () => clearInterval(interval)
  }, [battleState?.phase])

  // ── RPG: Auto-Battle ──────────────────────────────────────────
  useEffect(() => { autoBattleRef.current = autoBattle }, [autoBattle])

  // Auto-restart battle after win
  const autoWinHandled = useRef(false)
  useEffect(() => {
    if (!autoBattle || !battleState) { autoWinHandled.current = false; return }
    if (battleState.result === 'win' && !autoWinHandled.current) {
      autoWinHandled.current = true
      const char = rpgChar
      if (!char || battleState.playerHp <= 0) return
      setTimeout(() => {
        if (!autoBattleRef.current) return
        // HP/MP sudah tersimpan otomatis via updateRpgChar saat menang — tidak perlu write lagi
        const mIdx = MONSTERS.indexOf(battleState.monster)
        if (mIdx >= 0) startBattle(mIdx)
      }, 800)
    } else if (!battleState.result) {
      autoWinHandled.current = false
    }
  }, [autoBattle, battleState?.result])

  // ── RPG: Quest Claim ──────────────────────────────────────────
  const claimQuest = async () => {
    if (!rpgChar || !rpgChar.activeQuest) return
    const quest = QUESTS.find(q => q.id === rpgChar.activeQuest)
    if (!quest) return
    if (rpgChar.questProgress < quest.kills) { setQuestClaimMsg('Quest belum selesai!'); setTimeout(()=>setQuestClaimMsg(''),3000); return }
    const updates: Partial<RpgChar> = {
      activeQuest: null, questProgress: 0,
      exp: rpgChar.exp + quest.expReward,
      gold: rpgChar.gold + quest.goldReward,
      inventory: [...(rpgChar.inventory||[]), quest.itemReward].slice(-20),
    }
    // ── Apply quest item effects (bug fix) ──────────────────────
    const effectStr = QUEST_ITEM_EFFECTS[quest.itemReward]
    if (effectStr) {
      for (const part of effectStr.split(',')) {
        const [stat, valStr] = part.split('+')
        const val = parseInt(valStr)
        if (!val) continue
        if (stat === 'atk')   updates.atk   = (rpgChar.atk   || 0) + val
        if (stat === 'def')   updates.def   = (rpgChar.def   || 0) + val
        if (stat === 'spd')   updates.spd   = (rpgChar.spd   || 0) + val
        if (stat === 'luck')  updates.luck  = (rpgChar.luck  || 0) + val
        if (stat === 'maxHp') updates.maxHp = (rpgChar.maxHp || 0) + val
        if (stat === 'maxMp') updates.maxMp = (rpgChar.maxMp || 0) + val
        if (stat === 'hp')    updates.hp    = Math.min((rpgChar.maxHp || 0), (rpgChar.hp || 0) + val)
        if (stat === 'mp')    updates.mp    = Math.min((rpgChar.maxMp || 0), (rpgChar.mp || 0) + val)
      }
    }
    const newLevel = getLevel(updates.exp!)
    if (newLevel > rpgChar.level) {
      updates.level = newLevel; updates.maxHp = (updates.maxHp || rpgChar.maxHp) + 20; updates.maxMp = (updates.maxMp || rpgChar.maxMp) + 15
      updates.atk = (updates.atk || rpgChar.atk) + 3; updates.def = (updates.def || rpgChar.def) + 2
      const titleIdx = Math.min(Math.floor(newLevel / 5), TITLES.length - 1)
      updates.titles = [TITLES[titleIdx]]
      showToast('info','🎉 LEVEL UP!',`Naik ke Level ${newLevel}!`)
    }
    await updateRpgChar(updates)
    // Track daily mission dm_quest
    const todayStr2 = new Date().toDateString()
    const dm2 = rpgChar.dailyMissions?.date === todayStr2 ? rpgChar.dailyMissions : { date: todayStr2, completed: [], claimed: [] }
    if (!dm2.completed.includes('dm_quest')) {
      await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), { dailyMissions: { ...dm2, completed: [...dm2.completed, 'dm_quest'] } })
      showToast('info', '📋 Daily Done!', 'Mission "Klaim Quest" selesai! Klaim di Daily Missions.')
    }
    const effectInfo = effectStr ? ` · ${effectStr.split(',').map(p=>'+'+p.split('+')[1]+' '+p.split('+')[0].toUpperCase()).join(' ')}` : ''
    showToast('win','📜 QUEST KLAIM!',`+${quest.expReward} EXP · +${quest.goldReward} Gold · 🎁 ${quest.itemReward}${effectInfo}`)
    setQuestClaimMsg(`✅ Quest "${quest.name}" berhasil diklaim! 🎁 ${quest.itemReward}${effectStr ? ` (${effectStr})` : ''}`)
    setRpgChar(prev => prev ? { ...prev, ...updates } as RpgChar : prev)
    setTimeout(()=>setQuestClaimMsg(''),4000)
  }

  // ── RPG: Class Change ─────────────────────────────────────────
  const changeClass = async (newCls: RpgClass) => {
    if (!rpgChar || rpgChar.gold < CLASS_CHANGE_COST) { showToast('info','❌ Gold Kurang',`Butuh ${CLASS_CHANGE_COST} Gold untuk ganti class`); return }
    const base = RPG_CLASSES[newCls]
    const updates: Partial<RpgChar> = {
      class: newCls, gold: rpgChar.gold - CLASS_CHANGE_COST,
      skills: base.skills,
      atk: Math.max(rpgChar.atk, base.atk),
      def: Math.max(rpgChar.def, base.def),
    }
    await updateRpgChar(updates)
    setShowClassChange(false)
    showToast('info','⚔️ Class Berubah!',`Kamu sekarang adalah ${newCls}! -${CLASS_CHANGE_COST} Gold`)
  }

  // ── GACHA: Pull ───────────────────────────────────────────────
  const doGachaPull = async (count: 1|10) => {
    if (!gachaData || !user) return
    const cost = count === 1 ? 160 : 1600
    const ticketCost = count
    if (gachaData.tickets < ticketCost && gachaData.primogems < cost) {
      showToast('info','💎 Kurang!','Primogems atau tiket tidak cukup'); return
    }
    const useTickets = gachaData.tickets >= ticketCost
    const results: GachaChar[] = []
    let pity = gachaData.pity
    let pity6 = gachaData.pity6 ?? 0
    let guaranteed = gachaData.guaranteed
    // Track constellation updates from this pull
    const newConstellations: Record<string, number> = { ...(gachaData.constellations ?? {}) }
    const newRoster = [...(gachaData.roster ?? [])]
    let bonusPrimos = 0  // from duplicate 6★ (C6 exceeded)

    for (let i = 0; i < count; i++) {
      pity++; pity6++
      let rarity: GachaRarity = '3★'
      const roll = Math.random() * 100

      // 6★ check first
      if (pity6 >= PITY_6STAR) { rarity = '6★'; pity6 = 0; pity = 0 }
      else if (roll < RATE_6STAR) { rarity = '6★'; pity6 = 0; pity = 0 }
      // 5★ check
      else if (pity >= PITY_HARD) { rarity = '5★'; pity = 0 }
      else if (pity >= PITY_SOFT) { if (roll < (5 + (pity - PITY_SOFT) * 5)) { rarity = '5★'; pity = 0 } else if (roll < 15) rarity = '4★' }
      else if (roll < 0.6) { rarity = '5★'; pity = 0 }
      else if (roll < 6.6) rarity = '4★'

      let pool: GachaChar[]
      if (rarity === '6★') {
        pool = GACHA_CHARS.filter(c => c.rarity === '6★')
      } else if (rarity === '5★') {
        const featured = GACHA_CHARS.filter(c => GACHA_BANNER.featured.includes(c.id) && c.rarity === '5★')
        if (guaranteed || Math.random() < 0.5) { pool = featured.length ? featured : GACHA_CHARS.filter(c=>c.rarity==='5★'); guaranteed = false }
        else { pool = GACHA_CHARS.filter(c => c.rarity === '5★'); guaranteed = true }
      } else if (rarity === '4★') pool = GACHA_CHARS.filter(c => c.rarity === '4★')
      else pool = GACHA_CHARS.filter(c => c.rarity === '3★')

      const picked = pool[Math.floor(Math.random() * pool.length)]
      results.push(picked)

      // ── Constellation & roster logic ──
      const curConste = newConstellations[picked.id] ?? -1  // -1 = not owned yet
      if (!newRoster.includes(picked.id)) {
        // First time: add to roster, C0
        newRoster.push(picked.id)
        newConstellations[picked.id] = 0
      } else if (curConste < 6) {
        // Already owned: upgrade constellation
        newConstellations[picked.id] = curConste + 1
      } else {
        // C6 already maxed: convert to primogems
        const primoPer6star = picked.rarity === '6★' ? 800 : picked.rarity === '5★' ? 200 : picked.rarity === '4★' ? 20 : 5
        bonusPrimos += primoPer6star
      }
    }

    const updates: Partial<PlayerGacha> = {
      pity, pity6, guaranteed,
      pulls: gachaData.pulls + count,
      roster: newRoster,
      constellations: newConstellations,
      primogems: (gachaData.primogems + bonusPrimos) - (useTickets ? 0 : cost),
    }
    if (useTickets) updates.tickets = gachaData.tickets - ticketCost

    await updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user.uid), updates)
    setGachaData(prev => prev ? { ...prev, ...updates } as PlayerGacha : prev)
    // Mark daily pull mission
    if (rpgChar) {
      const todayStr = new Date().toDateString()
      const dm = rpgChar.dailyMissions?.date === todayStr ? rpgChar.dailyMissions : { date: todayStr, completed: [], claimed: [] }
      if (!dm.completed.includes('dm_pull')) {
        await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { dailyMissions: { ...dm, completed: [...dm.completed, 'dm_pull'] } })
      }
    }
    if (bonusPrimos > 0) showToast('win', '💎 Konversi', `+${bonusPrimos} primogems dari duplikat C6!`)
    setGachaAnim(true)
    setTimeout(() => { setGachaAnim(false); setGachaResult(results) }, 800)
  }

  // ── GACHA: Level Up Character ────────────────────────────────
  const doCharLevelUp = async (charId: string) => {
    if (!gachaData || !user) return
    const curLevel = (gachaData.charLevels ?? {})[charId] ?? 1
    const char = GACHA_CHARS.find(c => c.id === charId)
    if (!char) return
    const maxLv = CHAR_MAX_LEVEL[char.rarity]
    if (curLevel >= maxLv) { showToast('info','⛔','Level sudah maksimum!'); return }
    const cost = getCharLevelCost(curLevel)
    const mats = gachaData.charMats ?? { fish:0, ore:0, herb:0 }
    if ((mats.fish ?? 0) < cost.fish || (mats.ore ?? 0) < cost.ore || (mats.herb ?? 0) < cost.herb) {
      showToast('info','🪴 Kurang!',`Butuh ${cost.fish} ikan, ${cost.ore} ore, ${cost.herb} herb`); return
    }
    if ((gachaData.primogems ?? 0) < cost.gold / 100) {/* gold check from rpgChar */}
    // Check gold from rpgChar
    if (rpgChar && rpgChar.gold < cost.gold) {
      showToast('info','💰 Kurang Gold!',`Butuh ${cost.gold} gold. Kamu punya ${rpgChar.gold}`); return
    }
    // Deduct
    const newMats = { fish: (mats.fish)-cost.fish, ore: (mats.ore)-cost.ore, herb: (mats.herb)-cost.herb }
    const newLevels = { ...(gachaData.charLevels??{}), [charId]: curLevel+1 }
    await updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user.uid), { charLevels: newLevels, charMats: newMats })
    setGachaData(prev => prev ? { ...prev, charLevels: newLevels, charMats: newMats } : prev)
    // Deduct gold from rpgChar
    if (rpgChar) {
      const newGold = rpgChar.gold - cost.gold
      updateRpgChar({ gold: newGold })
    }
    showToast('win','⬆️ Level Up!',`${char.name} sekarang level ${curLevel+1}!`)
  }

  // ── RPG: Shop cooldown ref (anti-spam 2 detik) ───────────────
  const shopCooldownRef = useRef<number>(0)

  // ── RPG: Hitung harga item berdasarkan level ──────────────────
  // Harga naik 50% per 10 level mulai dari level 10
  // Max kenaikan 100% (2x) di level 70+
  // Potion HP & MP TIDAK dinaikkan harganya
  const getShopItemPrice = (item: typeof ITEMS_SHOP[0], level: number): number => {
    const isPotion = item.effect.includes('hp+') || item.effect.includes('mp+')
    if (isPotion) return item.price
    // Setiap 10 level = +50%, max 100% di level 70
    const tiers = Math.min(Math.floor((level - 1) / 10), 2) // 0, 1, 2 tiers
    const mult = 1 + tiers * 0.5  // 1.0, 1.5, 2.0
    return Math.round(item.price * mult)
  }

  // ── RPG: Shop ─────────────────────────────────────────────────
  const buyItem = async (item: typeof ITEMS_SHOP[0], countOverride?: number) => {
    if (!rpgChar) return
    // Anti-spam cooldown 2 detik
    const now = Date.now()
    if (now - shopCooldownRef.current < 2000) {
      setShopMsg('⏳ Tunggu 2 detik sebelum beli lagi!')
      setTimeout(() => setShopMsg(''), 2000)
      return
    }
    shopCooldownRef.current = now

    const lvl = rpgChar.level || 1
    const finalPrice = getShopItemPrice(item, lvl)
    const isPotion = item.effect.includes('hp+') || item.effect.includes('mp+')

    if (isPotion) {
      // Auto-max: hitung berapa banyak yang bisa dibeli sekaligus untuk full HP/MP
      let hpNeeded = 0, mpNeeded = 0
      const efx = item.effect.split(',')
      efx.forEach(e => {
        const [k, v] = e.split('+')
        if (k === 'hp') hpNeeded = Math.max(0, rpgChar.maxHp - rpgChar.hp)
        if (k === 'mp') mpNeeded = Math.max(0, rpgChar.maxMp - rpgChar.mp)
      })
      // Cari berapa hp/mp per item
      let hpPerItem = 0, mpPerItem = 0
      efx.forEach(e => {
        const [k, v] = e.split('+')
        if (k === 'hp') hpPerItem = parseInt(v)
        if (k === 'mp') mpPerItem = parseInt(v)
      })
      // Hitung berapa kali beli untuk full (minimal 1x)
      let count = 1
      if (hpPerItem > 0 && mpPerItem === 0) count = Math.max(1, Math.ceil(hpNeeded / hpPerItem))
      else if (mpPerItem > 0 && hpPerItem === 0) count = Math.max(1, Math.ceil(mpNeeded / mpPerItem))
      else count = Math.max(1, Math.max(Math.ceil(hpNeeded / hpPerItem), Math.ceil(mpNeeded / mpPerItem)))

      // Sesuaikan dengan uang yang ada (1% HP/MP per 80 coin rule)
      const totalCost = finalPrice * count
      if (rpgChar.gold < finalPrice) {
        // Tidak punya cukup untuk satu pun — cek berapa % HP/MP yang bisa dibeli dengan uang ada
        const canAfford = Math.floor(rpgChar.gold / finalPrice)
        if (canAfford === 0) {
          // Gunakan uang yang ada untuk mendapat 1% HP/MP per 80 coin
          const partialHpRestore = Math.floor((rpgChar.gold / 80) * rpgChar.maxHp / 100)
          const partialMpRestore = Math.floor((rpgChar.gold / 80) * rpgChar.maxMp / 100)
          const updates: Partial<RpgChar> = { gold: 0 }
          if (hpPerItem > 0) updates.hp = Math.min(rpgChar.maxHp, rpgChar.hp + partialHpRestore)
          if (mpPerItem > 0) updates.mp = Math.min(rpgChar.maxMp, rpgChar.mp + partialMpRestore)
          await updateRpgChar(updates)
          setShopMsg(`💸 Gold pas-pasan! Pulihkan HP/MP sesuai saldo (${rpgChar.gold} coin)`)
          setTimeout(() => setShopMsg(''), 3000)
          return
        }
        count = canAfford
      } else if (rpgChar.gold < totalCost) {
        count = Math.floor(rpgChar.gold / finalPrice)
      }

      const updates: Partial<RpgChar> = { gold: rpgChar.gold - (finalPrice * count) }
      efx.forEach(e => {
        const [k, v] = e.split('+')
        const val = parseInt(v)
        if (k === 'hp') updates.hp = Math.min(rpgChar.maxHp, rpgChar.hp + val * count)
        if (k === 'mp') updates.mp = Math.min(rpgChar.maxMp, rpgChar.mp + val * count)
      })
      await updateRpgChar(updates)
      const hpLabel = hpPerItem > 0 ? `HP: ${rpgChar.hp} → ${updates.hp}` : ''
      const mpLabel = mpPerItem > 0 ? `MP: ${rpgChar.mp} → ${updates.mp}` : ''
      setShopMsg(`✅ ${item.name} ×${count}! ${hpLabel}${hpLabel&&mpLabel?' · ':''}${mpLabel} (-${finalPrice*count} Gold)`)
      setTimeout(() => setShopMsg(''), 3500)
      return
    }

    // Item permanen (bukan potion)
    if (rpgChar.gold < finalPrice) {
      setShopMsg(`❌ Gold tidak cukup! Harga: ${finalPrice} (Kamu: ${rpgChar.gold})`)
      setTimeout(() => setShopMsg(''), 3000)
      return
    }
    const updates: Partial<RpgChar> = { gold: rpgChar.gold - finalPrice }
    const efx = item.effect.split(',')
    efx.forEach(e => {
      const [k, v] = e.split('+')
      const val = parseInt(v)
      if (k === 'atk') updates.atk = rpgChar.atk + val
      else if (k === 'def') updates.def = rpgChar.def + val
      else if (k === 'spd') updates.spd = rpgChar.spd + val
      else if (k === 'luck') updates.luck = rpgChar.luck + val
      else if (k === 'maxHp') { updates.maxHp = rpgChar.maxHp + val; updates.hp = Math.min(rpgChar.hp + val, rpgChar.maxHp + val) }
      else if (k === 'maxMp') { updates.maxMp = rpgChar.maxMp + val; updates.mp = Math.min(rpgChar.mp + val, rpgChar.maxMp + val) }
    })
    updates.inventory = [...(rpgChar.inventory || []), item.name].slice(-20)
    await updateRpgChar(updates)
    const tiers = Math.min(Math.floor((lvl - 1) / 10), 2)
    const multLabel = tiers > 0 ? ` (Harga ×${1+tiers*0.5} krn Lv${lvl})` : ''
    setShopMsg(`✅ ${item.name} berhasil dibeli!${multLabel}`)
    setTimeout(() => setShopMsg(''), 3000)
  }

  // ── RPG: Party Management ─────────────────────────────────────
  const setParty = async (charIds: string[]) => {
    if (!rpgChar || !user) return
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { party: charIds.slice(0, 4) })
    showToast('info', '👥 Party Diperbarui!', `${charIds.length} karakter dalam party`)
  }

  // ── DUNGEON: Start Boss Fight ─────────────────────────────────
  const startDungeon = (bossIdx: number, party: GachaChar[]) => {
    if (!rpgChar || party.length === 0) return
    const boss = { ...DUNGEON_BOSSES[bossIdx] }
    // Scale char HP based on their level
    const charHp = party.map(c => {
      const lv = (gachaData?.charLevels ?? {})[c.id] ?? 1
      return Math.floor(c.hp * getCharStatMult(lv, c.rarity))
    })
    setDungeonState({
      boss, bossHp: boss.hp, bossPhase: 1, frozenTurns: 0,
      superconduct: false, activeChars: party, charHp,
      currentChar: 0, energy: 0,
      charLevels: gachaData?.charLevels ?? {},
      log: [{ text: `🏰 DUNGEON: ${party.map(c=>c.name).join(', ')} vs ${boss.emoji} ${boss.name}!`, type: 'info' }],
      phase: 'player'
    })
    setRpgView('dungeon')
  }

  const doDungeonAttack = async (type: 'normal'|'skill'|'burst') => {
    if (!dungeonState || !rpgChar || dungeonState.phase !== 'player') return
    const ds = { ...dungeonState }
    const char = ds.activeChars[ds.currentChar]
    const boss = ds.boss
    const log = [...ds.log]
    let energy = ds.energy

    let dmg = 0
    let reaction: typeof ELEMENTAL_REACTIONS[string] | null = null

    if (type === 'normal') {
      const baseDmg = char.atk + rpgChar.atk * 0.3
      dmg = Math.max(1, Math.floor(baseDmg - boss.def * 0.5 + Math.random() * 10))
      const isWeakness = boss.weakness.includes(char.element)
      if (isWeakness) { dmg = Math.floor(dmg * 1.35); log.push({ text: `⚡ WEAKNESS HIT! ${char.name} → ${boss.name} -${dmg}`, type: 'skill' }) }
      else log.push({ text: `⚔️ ${char.name} menyerang ${boss.name} -${dmg} HP`, type: 'dmg' })
      reaction = checkElemReaction(char.element, boss.element)
      energy = Math.min(100, energy + 15)
    } else if (type === 'skill') {
      const baseDmg = char.atk * 1.8 + rpgChar.atk * 0.5
      dmg = Math.max(1, Math.floor(baseDmg - boss.def * 0.4 + Math.random() * 15))
      reaction = checkElemReaction(char.element, boss.element)
      log.push({ text: `✨ ${char.name} pakai ${char.skill}! → ${boss.name} -${dmg} HP`, type: 'skill' })
      energy = Math.min(100, energy + 25)
    } else if (type === 'burst') {
      if (energy < 100) { log.push({ text: `💫 Energy belum penuh! (${energy}/100)`, type: 'info' }); setDungeonState({ ...ds, log }); return }
      const baseDmg = char.atk * 3.5 + rpgChar.atk * 0.8
      dmg = Math.max(1, Math.floor(baseDmg - boss.def * 0.2 + Math.random() * 20))
      reaction = checkElemReaction(char.element, boss.element)
      log.push({ text: `💥 ${char.name} BURST: ${char.burst}! → ${boss.name} -${dmg} HP`, type: 'skill' })
      energy = 0
    }

    // Apply superconduct debuff
    if (ds.superconduct) { dmg = Math.floor(dmg * 1.4); }

    // Apply elemental reaction
    if (reaction) {
      const reactDmg = Math.floor(dmg * (reaction.dmgMult - 1))
      if (reaction.name === 'Frozen') {
        ds.frozenTurns = 2
        log.push({ text: `${reaction.emoji} ${reaction.name}! Boss membeku 2 giliran!`, type: 'reaction' })
      } else if (reaction.name === 'Superconduct') {
        ds.superconduct = true
        log.push({ text: `${reaction.emoji} ${reaction.name}! DEF boss -40% sementara!`, type: 'reaction' })
      } else if (reaction.name === 'Crystallize') {
        const shield = 200
        const newHp = ds.charHp.map((h, i) => i === ds.currentChar ? Math.min(char.hp, h + shield) : h)
        ds.charHp = newHp
        log.push({ text: `${reaction.emoji} ${reaction.name}! ${char.name} dapat shield +${shield} HP!`, type: 'reaction' })
      } else {
        dmg += reactDmg
        log.push({ text: `${reaction.emoji} ${reaction.name}! (${reaction.effect}) Total -${dmg} HP`, type: 'reaction' })
      }
    }

    ds.bossHp = Math.max(0, ds.bossHp - dmg)

    // Phase 2 check
    if (ds.bossPhase === 1 && ds.bossHp <= boss.phase2Hp) {
      ds.bossPhase = 2
      log.push({ text: `🔴 ${boss.name} masuk PHASE 2! Kekuatan meningkat!`, type: 'info' })
    }

    if (ds.bossHp <= 0) {
      // WIN
      log.push({ text: `🏆 ${boss.name} dikalahkan! +${boss.exp} EXP +${boss.gold} Gold +${boss.primogems}💎`, type: 'info' })
      log.push({ text: `🎁 Drop: ${boss.dropItem}`, type: 'info' })
      setDungeonState({ ...ds, log, energy, bossHp: 0, phase: 'result', result: 'win' })
      showToast('win', `🏰 DUNGEON CLEAR!`, `${boss.name} defeated! +${boss.primogems}💎`)
      // Save rewards
      const todayStr = new Date().toDateString()
      const dailyData = rpgChar.dailyMissions?.date === todayStr ? rpgChar.dailyMissions : { date: todayStr, completed: [], claimed: [] }
      const newCompleted = [...new Set([...dailyData.completed, 'dm_dungeon'])]
      const newDungeonKills = (rpgChar.dungeonKills || 0) + 1
      const updates: Partial<RpgChar> = {
        exp: rpgChar.exp + boss.exp,
        gold: rpgChar.gold + boss.gold,
        inventory: [...(rpgChar.inventory || []), boss.dropItem].slice(-20),
        dungeonKills: newDungeonKills,
        dailyMissions: { ...dailyData, completed: newCompleted }
      }
      const newLevel = getLevel(updates.exp!)
      if (newLevel > rpgChar.level) {
        updates.level = newLevel; updates.maxHp = rpgChar.maxHp + 20; updates.maxMp = rpgChar.maxMp + 15
        updates.atk = rpgChar.atk + 3; updates.def = rpgChar.def + 2
        showToast('info', '🎉 LEVEL UP!', `Naik ke Level ${newLevel}!`)
      }
      await updateRpgChar(updates)
      const herbGain = boss.rank === 'Archon' ? 10 : boss.rank === 'Weekly' ? 5 : boss.rank === 'Elite' ? 3 : 2
      const curMats2 = gachaData?.charMats ?? { fish:0, ore:0, herb:0 }
      const newMats2 = { ...curMats2, herb: curMats2.herb + herbGain }
      // ── Char EXP for party members used in dungeon ──
      const charExpGain = getDungeonCharExp(boss.rank)
      const usedCharIds = ds.activeChars.map((c: GachaChar) => c.id)
      const prevCharExp = gachaData?.charExp ?? {}
      const prevCharLevels = gachaData?.charLevels ?? {}
      const newCharExp = { ...prevCharExp }
      const newCharLevels = { ...prevCharLevels }
      const levelUpMsgs: string[] = []
      for (const cid of usedCharIds) {
        const gc = GACHA_CHARS.find((x: GachaChar) => x.id === cid)
        if (!gc) continue
        const maxLv = CHAR_MAX_LEVEL[gc.rarity]
        let curLv = newCharLevels[cid] ?? 1
        if (curLv >= maxLv) continue
        newCharExp[cid] = (newCharExp[cid] ?? 0) + charExpGain
        while (curLv < maxLv) {
          const needed = getCharExpNeeded(curLv)
          if ((newCharExp[cid] ?? 0) >= needed) {
            newCharExp[cid] = (newCharExp[cid] ?? 0) - needed
            curLv++
            newCharLevels[cid] = curLv
            levelUpMsgs.push(`${gc.emoji} ${gc.name} naik ke Lv${curLv}!`)
          } else break
        }
      }
      const gachaUpdateInline: Record<string, unknown> = {
        primogems: (gachaData?.primogems || 0) + boss.primogems,
        charMats: newMats2,
        charExp: newCharExp,
        charLevels: newCharLevels
      }
      await updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user!.uid), gachaUpdateInline)
      setGachaData(prev => prev ? { ...prev, primogems: (prev.primogems || 0) + boss.primogems, charMats: newMats2, charExp: newCharExp, charLevels: newCharLevels } : prev)
      if (herbGain > 0) showToast('info','🌿 Material!',`+${herbGain} herb dari dungeon!`)
      showToast('info','⚔️ Char EXP!', `+${charExpGain} EXP → ${usedCharIds.map((id: string) => GACHA_CHARS.find((c: GachaChar) => c.id===id)?.name||id).join(', ')}`)
      for (const msg of levelUpMsgs) showToast('win','🎉 Char Level Up!', msg)
      return
    }

    // Enemy turn (skip if frozen)
    ds.energy = energy
    ds.log = log
    if (ds.frozenTurns > 0) {
      ds.frozenTurns--
      log.push({ text: `❄️ ${boss.name} masih membeku! (skip turn)`, type: 'info' })
      setDungeonState({ ...ds, phase: 'player' })
      return
    }

    ds.phase = 'enemy'
    setDungeonState({ ...ds })

    setTimeout(() => {
      const phase2Mult = ds.bossPhase === 2 ? 1.4 : 1
      const eDmg = Math.max(1, Math.floor(boss.atk * phase2Mult - rpgChar.def * 0.3 + Math.random() * 12))
      // Boss attacks current char
      const newCharHp = [...ds.charHp]
      newCharHp[ds.currentChar] = Math.max(0, newCharHp[ds.currentChar] - eDmg)
      const bossSkill = boss.skills[Math.floor(Math.random() * boss.skills.length)]
      log.push({ text: `${boss.emoji} ${boss.name} pakai ${bossSkill}! → ${char.name} -${eDmg} HP`, type: 'dmg' })

      // Check if all chars dead
      const allDead = newCharHp.every(h => h <= 0)
      if (allDead) {
        log.push({ text: `💀 Semua karakter KO! Dungeon Gagal.`, type: 'info' })
        setDungeonState({ ...ds, charHp: newCharHp, log, phase: 'result', result: 'lose' })
        showToast('lose', '💀 DUNGEON GAGAL!', `${boss.name} terlalu kuat!`)
        updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), { hp: Math.floor(rpgChar.maxHp * 0.3), losses: (rpgChar.losses || 0) + 1 })
      } else {
        // Auto-switch to alive char if current is dead
        let nextChar = ds.currentChar
        if (newCharHp[ds.currentChar] <= 0) {
          nextChar = newCharHp.findIndex(h => h > 0)
          log.push({ text: `🔄 ${char.name} KO! Ganti ke ${ds.activeChars[nextChar].name}`, type: 'info' })
        }
        ds.superconduct = false // reset per turn
        setDungeonState({ ...ds, charHp: newCharHp, log, phase: 'player', currentChar: nextChar })
      }
    }, 900)
  }

  const switchDungeonChar = (idx: number) => {
    if (!dungeonState || dungeonState.charHp[idx] <= 0) return
    const log = [...dungeonState.log, { text: `🔄 Ganti karakter → ${dungeonState.activeChars[idx].name}`, type: 'info' as const }]
    setDungeonState({ ...dungeonState, currentChar: idx, log })
  }

  const endDungeon = () => {
    setDungeonState(null)
    setRpgView('dashboard')
  }

  const handleDungeonWin = async (boss: DungeonBoss) => {
    if (!rpgChar || !user) return
    showToast('win', `🏰 DUNGEON CLEAR!`, `${boss.name} dikalahkan! +${boss.primogems}💎`)
    const todayStr = new Date().toDateString()
    const dailyData = rpgChar.dailyMissions?.date === todayStr
      ? rpgChar.dailyMissions
      : { date: todayStr, completed: [], claimed: [] }
    const newCompleted = [...new Set([...dailyData.completed, 'dm_dungeon'])]
    const newDungeonKills = (rpgChar.dungeonKills || 0) + 1
    const updates: Partial<RpgChar> = {
      exp: rpgChar.exp + boss.exp,
      gold: rpgChar.gold + boss.gold,
      inventory: [...(rpgChar.inventory || []), boss.dropItem].slice(-20),
      dungeonKills: newDungeonKills,
      dailyMissions: { ...dailyData, completed: newCompleted }
    }
    const newLevel = getLevel(updates.exp!)
    if (newLevel > rpgChar.level) {
      updates.level = newLevel; updates.maxHp = rpgChar.maxHp + 20; updates.maxMp = rpgChar.maxMp + 15
      updates.atk = rpgChar.atk + 3; updates.def = rpgChar.def + 2
      showToast('info', '🎉 LEVEL UP!', `Naik ke Level ${newLevel}!`)
    }
    await updateRpgChar(updates)
    // ── Char EXP for party members used in dungeon (handleDungeonWin path) ──
    const charExpGainH = getDungeonCharExp(boss.rank)
    const usedIdsH = (dungeonState?.activeChars ?? []).map((c: GachaChar) => c.id)
    const prevExpH = gachaData?.charExp ?? {}
    const prevLvH = gachaData?.charLevels ?? {}
    const newExpH = { ...prevExpH }
    const newLvH = { ...prevLvH }
    const lvUpMsgsH: string[] = []
    for (const cid of usedIdsH) {
      const gc = GACHA_CHARS.find((x: GachaChar) => x.id === cid)
      if (!gc) continue
      const maxLv = CHAR_MAX_LEVEL[gc.rarity]
      let curLv = newLvH[cid] ?? 1
      if (curLv >= maxLv) continue
      newExpH[cid] = (newExpH[cid] ?? 0) + charExpGainH
      while (curLv < maxLv) {
        const needed = getCharExpNeeded(curLv)
        if ((newExpH[cid] ?? 0) >= needed) {
          newExpH[cid] = (newExpH[cid] ?? 0) - needed
          curLv++
          newLvH[cid] = curLv
          lvUpMsgsH.push(`${gc.emoji} ${gc.name} naik ke Lv${curLv}!`)
        } else break
      }
    }
    await updateDoc(doc(getRpgDb(user.uid), 'playerGacha', user.uid), {
      primogems: (gachaData?.primogems || 0) + boss.primogems,
      charExp: newExpH,
      charLevels: newLvH
    })
    setGachaData(prev => prev ? { ...prev, primogems: (prev.primogems || 0) + boss.primogems, charExp: newExpH, charLevels: newLvH } : prev)
    if (usedIdsH.length > 0) showToast('info','⚔️ Char EXP!', `+${charExpGainH} EXP → ${usedIdsH.map((id: string) => GACHA_CHARS.find((c: GachaChar) => c.id===id)?.name||id).join(', ')}`)
    for (const msg of lvUpMsgsH) showToast('win','🎉 Char Level Up!', msg)
  }

  // ── Daily Missions: Claim ─────────────────────────────────────
  const claimDailyMission = async (missionId: string) => {
    if (!rpgChar || !user) return
    const todayStr = new Date().toDateString()
    const dailyData = rpgChar.dailyMissions?.date === todayStr
      ? rpgChar.dailyMissions
      : { date: todayStr, completed: [], claimed: [] }
    if (!dailyData.completed.includes(missionId)) { showToast('info', '❌', 'Mission belum selesai!'); return }
    if (dailyData.claimed.includes(missionId)) { showToast('info', '✅', 'Sudah diklaim hari ini!'); return }
    const mission = DAILY_MISSIONS.find(m => m.id === missionId)!
    const newClaimed = [...dailyData.claimed, missionId]
    const updates: Partial<RpgChar> = {
      dailyMissions: { ...dailyData, claimed: newClaimed },
      gold: rpgChar.gold + (mission.reward.gold || 0)
    }
    await updateRpgChar(updates)
    if (mission.reward.primogems > 0 || mission.reward.tickets > 0) {
      await updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user.uid), {
        primogems: (gachaData?.primogems || 0) + mission.reward.primogems,
        tickets: (gachaData?.tickets || 0) + mission.reward.tickets
      })
    }
    showToast('win', '🎁 Reward Diklaim!', `+${mission.reward.primogems}💎 +${mission.reward.tickets}🎫 +${mission.reward.gold}G`)
  }


  // ── RPG: Mining ──────────────────────────────────────────────
  const doMine = async () => {
    if (!rpgChar || !user) return
    const now = Date.now()
    const lastMine = (rpgChar.trainCooldowns?.mine || 0)
    const sessionStart = rpgChar.mineSessionStart || 0
    const sessionActive = sessionStart > 0 && (now - sessionStart) < MINE_SESSION_MS

    // Still in cooldown (after session ended)?
    if (!sessionActive && lastMine > 0 && (now - lastMine) < MINE_COOLDOWN_MS) {
      const rem = Math.ceil((MINE_COOLDOWN_MS - (now - lastMine)) / 60000)
      setMineMsg(`⏳ Tambang cooldown ${rem} menit lagi!`); return
    }

    if (sessionActive) {
      // Already in session — collect ore drop manually (bonus click)
      const roll = Math.random() * 100
      let cum = 0; let ore = ORES[0]
      for (const o of ORES) { cum += o.chance; if (roll < cum) { ore = o; break } }
      const count = Math.floor(Math.random() * 2) + 1
      const newOres = { ...(rpgChar.ores || {}), [ore.id]: ((rpgChar.ores || {})[ore.id] || 0) + count }
      await updateRpgChar({ ores: newOres })
      setMineMsg(`⛏️ +${count}x ${ore.emoji}${ore.name}!`)
      setTimeout(() => setMineMsg(''), 3000)
      return
    }

    // Start new mining session
    const roll = Math.random() * 100
    let cum = 0; let ore = ORES[0]
    for (const o of ORES) { cum += o.chance; if (roll < cum) { ore = o; break } }
    const count = Math.floor(Math.random() * 3) + 1
    const newOres = { ...(rpgChar.ores || {}), [ore.id]: ((rpgChar.ores || {})[ore.id] || 0) + count }
    await updateRpgChar({ ores: newOres, mineSessionStart: now })
    setMineMsg(`⛏️ Sesi tambang dimulai! Dapat ${count}x ${ore.emoji}${ore.name}!`)
    setTimeout(() => setMineMsg(''), 4000)
  }

  // ── RPG: Mining session end (called when session timer expires) ──
  const endMineSession = async () => {
    if (!rpgChar || !user) return
    const now = Date.now()
    const newCooldowns = { ...(rpgChar.trainCooldowns || {}), mine: now }
    await updateRpgChar({ mineSessionStart: 0, trainCooldowns: newCooldowns })
    setMineMsg('⛏️ Sesi selesai! Cooldown 30 menit.')
    setTimeout(() => setMineMsg(''), 4000)
  }

  // ── RPG: Crafting ─────────────────────────────────────────────
  const doCraft = async (recipe: typeof CRAFT_RECIPES[0]) => {
    if (!rpgChar || !user) return
    const ores = rpgChar.ores || {}
    for (const [mat, qty] of Object.entries(recipe.materials)) {
      if ((ores[mat] || 0) < qty) { setCraftMsg(`❌ Material kurang: butuh ${qty}x ${ORES.find(o=>o.id===mat)?.name}`); return }
    }
    const newOres = { ...ores }
    for (const [mat, qty] of Object.entries(recipe.materials)) newOres[mat] = (newOres[mat] || 0) - qty
    const updates: Record<string, any> = { ores: newOres }
    const [stat, valStr] = recipe.effect.split('+')
    const val = parseInt(valStr)
    if (stat === 'atk') updates.atk = (rpgChar.atk || 0) + val
    else if (stat === 'def') updates.def = (rpgChar.def || 0) + val
    else if (stat === 'spd') updates.spd = (rpgChar.spd || 0) + val
    else if (stat === 'luck') updates.luck = (rpgChar.luck || 0) + val
    else if (stat === 'mp') updates.maxMp = (rpgChar.maxMp || 0) + val
    updates.inventory = [...(rpgChar.inventory || []), recipe.name]
    await updateRpgChar(updates)
    setCraftMsg(`✅ ${recipe.emoji}${recipe.name} berhasil dibuat! ${recipe.desc}`)
    setTimeout(() => setCraftMsg(''), 4000)
  }

  // ── RPG: Farming ─────────────────────────────────────────────
  const doPlant = async (cropId: string) => {
    if (!rpgChar || !user) return
    const crops = rpgChar.crops || []
    if (crops.length >= FARM_SLOTS) { setFarmMsg('🌿 Lahan penuh! Panen dulu sebelum menanam lagi.'); return }
    const newCrops = [...crops, { type: cropId, plantedAt: Date.now(), slots: 1 }]
    await updateRpgChar({ crops: newCrops })
    const crop = CROPS.find(c => c.id === cropId)!
    setFarmMsg(`🌱 ${crop.emoji}${crop.name} ditanam! Siap dalam ${Math.round(crop.growMs/60000)} menit.`)
    setTimeout(() => setFarmMsg(''), 4000)
  }

  const doHarvest = async (idx: number) => {
    if (!rpgChar || !user) return
    const crops = [...(rpgChar.crops || [])]
    const item = crops[idx]; if (!item) return
    const crop = CROPS.find(c => c.id === item.type)!
    const ready = Date.now() - item.plantedAt >= crop.growMs
    if (!ready) { setFarmMsg(`⏳ Belum siap! Tunggu ${Math.ceil((crop.growMs-(Date.now()-item.plantedAt))/60000)} mnt lagi.`); return }
    const count = Math.floor(Math.random() * 3) + 2
    const newOres: Record<string, number> = { ...(rpgChar.ores || {}), [item.type]: ((rpgChar.ores || {})[item.type] || 0) + count }
    crops.splice(idx, 1)
    await updateRpgChar({ crops, ores: newOres })
    setFarmMsg(`🌾 Panen ${count}x ${crop.emoji}${crop.name}! Tersimpan di material.`)
    setTimeout(() => setFarmMsg(''), 4000)
  }

  // ── RPG: Cooking ─────────────────────────────────────────────
  const doCook = async (recipe: typeof RECIPES_COOK[0]) => {
    if (!rpgChar || !user) return
    const ores = rpgChar.ores || {}
    for (const [mat, qty] of Object.entries(recipe.ing)) {
      if ((ores[mat as string] || 0) < (qty as number)) {
        setCookMsg(`❌ Bahan kurang: butuh ${qty}x ${CROPS.find(c=>c.id===mat)?.name || mat}`); return
      }
    }
    const newOres = { ...ores }
    for (const [mat, qty] of Object.entries(recipe.ing)) newOres[mat as string] = (newOres[mat as string] || 0) - (qty as number)
    const expiresAt = Date.now() + recipe.durMs
    const newBuffs = [...(rpgChar.foodBuffs || []).filter(b => b.expiresAt > Date.now()), { type:recipe.id, expiresAt, stat:recipe.stat, value:recipe.val }]
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { ores: newOres, foodBuffs: newBuffs })
    setCookMsg(`🍳 ${recipe.emoji}${recipe.name} siap! ${recipe.desc}`)
    setTimeout(() => setCookMsg(''), 4000)
  }

  // ── RPG: Training ─────────────────────────────────────────────
  const doTrain = async (t: typeof TRAININGS[0]) => {
    if (!rpgChar || !user) return
    const now = Date.now()
    const last = (rpgChar.trainCooldowns || {})[t.id] || 0
    if (now - last < t.coolMs) {
      const rem = Math.ceil((t.coolMs - (now - last)) / 60000)
      setTrainMsg(`⏳ ${t.name} cooldown ${rem} mnt lagi!`); return
    }
    if (rpgChar.gold < t.cost) { setTrainMsg(`❌ Gold tidak cukup! Butuh ${t.cost}G`); return }
    const updates: Record<string, any> = {
      gold: rpgChar.gold - t.cost,
      trainCooldowns: { ...(rpgChar.trainCooldowns || {}), [t.id]: now }
    }
    if (t.stat === 'maxHp') updates.maxHp = (rpgChar.maxHp || 0) + t.gain
    else if (t.stat === 'maxMp') updates.maxMp = (rpgChar.maxMp || 0) + t.gain
    else updates[t.stat] = ((rpgChar as any)[t.stat] || 0) + t.gain
    await updateRpgChar(updates)
    setTrainMsg(`💪 ${t.emoji} Latihan selesai! ${t.desc} | -${t.cost}G`)
    setTimeout(() => setTrainMsg(''), 4000)
  }

  // ── RPG: Duel PvP ─────────────────────────────────────────────
  const doDuel = async (opponent: {username:string;level:number;class:RpgClass;kills:number;atk?:number;def?:number}) => {
    if (!rpgChar || !user) return
    const now = Date.now()
    const lastDuel = rpgChar.duelCooldown || 0
    const DUEL_COOLDOWN = 5 * 60 * 1000 // 5 menit
    if (now < lastDuel) {
      const rem = Math.ceil((lastDuel - now) / 60000)
      setDuelMsg(`⏳ Duel cooldown ${rem} menit lagi!`)
      return
    }
    setDuelLoading(true)
    const myPower = (rpgChar.atk || 0) + (rpgChar.def || 0) + (rpgChar.spd || 0) + (rpgChar.level || 1) * 5
    const oppAtk = (opponent.atk || 20) + (opponent.level || 1) * 3
    const oppDef = (opponent.def || 10) + (opponent.level || 1) * 2
    const oppPower = oppAtk + oppDef + (opponent.level || 1) * 5
    const myRoll = Math.random() * myPower + (Math.random() * 20)
    const oppRoll = Math.random() * oppPower + (Math.random() * 20)
    const win = myRoll >= oppRoll
    const goldGain = win ? Math.floor(opponent.level * 15 + Math.random() * 50) : 0
    const expGain = win ? Math.floor(opponent.level * 20) : Math.floor(opponent.level * 5)
    const rec = rpgChar.duelRecord || { wins: 0, losses: 0 }
    const updates: Record<string, any> = {
      exp: (rpgChar.exp || 0) + expGain,
      gold: (rpgChar.gold || 0) + goldGain,
      duelRecord: { wins: rec.wins + (win?1:0), losses: rec.losses + (win?0:1) },
      duelCooldown: now + DUEL_COOLDOWN
    }
    await updateRpgChar(updates)
    setDuelLoading(false)
    if (win) setDuelMsg(`🏆 MENANG vs ${opponent.username}! +${goldGain}G +${expGain}EXP`)
    else setDuelMsg(`💀 KALAH vs ${opponent.username}! +${expGain}EXP (pengalaman pahit)`)
    setTimeout(() => setDuelMsg(''), 5000)
  }

  // ── RPG: Wild Quest ───────────────────────────────────────────
  const WILD_QUEST_COOLDOWN_MS = 2 * 60 * 60 * 1000 // 2 jam

  const rollWildQuest = () => {
    if (!rpgChar) return
    const now = Date.now()
    const cooldownUntil = rpgChar.wildQuestCooldown || 0
    if (now < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - now) / 60000)
      setWildQuestMsg(`⏳ Wild Quest tersedia lagi dalam ${remaining} menit!`)
      return
    }
    const q = WILD_QUEST_POOL[Math.floor(Math.random() * WILD_QUEST_POOL.length)]
    setWildQuest(q)
    setWildQuestMsg('')
  }

  const checkWildQuestCompletion = (q: typeof WILD_QUEST_POOL[0]): boolean => {
    if (!rpgChar) return false
    const need = q.need as Record<string,number>
    if (q.type === 'mine') {
      const ores = rpgChar.ores || {}
      return Object.entries(need).every(([ore, count]) => (ores[ore] || 0) >= count)
    }
    if (q.type === 'gold') {
      return rpgChar.gold >= (need.gold || 5000)
    }
    if (q.type === 'kill') {
      return (rpgChar.kills || 0) >= (need.kills || 10)
    }
    if (q.type === 'dungeon') {
      return (rpgChar.dungeonKills || 0) >= (need.dungeon || 1)
    }
    if (q.type === 'farm') {
      // Fix: cek ores (tempat hasil panen disimpan) dengan crop id yang benar
      const ores = rpgChar.ores || {}
      return CROPS.some(crop => (ores[crop.id] || 0) >= 1)
    }
    if (q.type === 'cook') {
      // Fix: cek foodBuffs aktif (hasil memasak) bukan inventory
      const now = Date.now()
      return (rpgChar.foodBuffs || []).filter(b => b.expiresAt > now).length >= 1
    }
    if (q.type === 'train') {
      const today = new Date().toDateString()
      const cds = rpgChar.trainCooldowns || {}
      const trainedToday = Object.values(cds).filter(ts => new Date(ts as number).toDateString() === today).length
      return trainedToday >= 2
    }
    return false
  }

  const claimWildQuest = async () => {
    if (!rpgChar || !user || !wildQuest) return

    // Cek apakah syarat quest sudah terpenuhi
    const completed = checkWildQuestCompletion(wildQuest)
    if (!completed) {
      setWildQuestMsg(`❌ Selesaikan dulu: ${wildQuest.desc}`)
      return
    }

    const now = Date.now()
    const cooldownUntil = rpgChar.wildQuestCooldown || 0
    if (now < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - now) / 60000)
      setWildQuestMsg(`⏳ Wild Quest tersedia lagi dalam ${remaining} menit!`)
      return
    }

    const updates = {
      gold: (rpgChar.gold || 0) + wildQuest.reward.gold,
      exp: (rpgChar.exp || 0) + wildQuest.reward.exp,
      wildQuestCooldown: now + WILD_QUEST_COOLDOWN_MS
    }
    await updateRpgChar(updates)
    setWildQuestMsg(`🎉 Quest selesai! +${wildQuest.reward.gold}G +${wildQuest.reward.exp}EXP | Cooldown 2 jam dimulai`)
    setWildQuest(null)
    setTimeout(() => setWildQuestMsg(''), 5000)
  }

  // ── RPG: Investasi ────────────────────────────────────────────
  const doInvest = async (plan: typeof INVEST_PLANS[0]) => {
    if (!rpgChar || !user) return
    const amount = parseInt(investInput)
    if (!amount || amount < 100) { setInvestMsg('❌ Minimal investasi 100 Gold!'); return }
    if (rpgChar.gold < amount) { setInvestMsg('❌ Gold tidak cukup!'); return }
    const returnAt = Date.now() + plan.durMs
    const mult = plan.minMult + Math.random() * (plan.maxMult - plan.minMult)
    const newInv = [...(rpgChar.investments || []), { amount, returnAt, mult: parseFloat(mult.toFixed(2)) }]
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), {
      gold: rpgChar.gold - amount,
      investments: newInv
    })
    setInvestMsg(`${plan.emoji} Rp${amount.toLocaleString()}G diinvestasikan! Cek hasil dalam ${Math.round(plan.durMs/60000)} menit.`)
    setInvestInput('')
    setTimeout(() => setInvestMsg(''), 5000)
  }

  const claimInvestment = async (idx: number) => {
    if (!rpgChar || !user) return
    const inv = (rpgChar.investments || [])[idx]
    if (!inv || Date.now() < inv.returnAt) { setInvestMsg('⏳ Investasi belum jatuh tempo!'); return }
    const result = Math.floor(inv.amount * inv.mult)
    const newInvestments = [...(rpgChar.investments || [])]
    newInvestments.splice(idx, 1)
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), {
      gold: (rpgChar.gold || 0) + result,
      investments: newInvestments
    })
    const profit = result - inv.amount
    setInvestMsg(profit >= 0 ? `📈 Investasi balik! +${result}G (profit: +${profit}G)` : `📉 Rugi! +${result}G (rugi: ${profit}G)`)
    setTimeout(() => setInvestMsg(''), 5000)
  }

  // ── RPG: Transfer Gold ────────────────────────────────────────
  const doTransfer = async () => {
    if (!rpgChar || !user) return
    const amount = parseInt(transferAmount)
    if (!transferTarget.trim()) { setTransferMsg('❌ Masukkan username tujuan!'); return }
    if (!amount || amount < 10) { setTransferMsg('❌ Minimal transfer 10 Gold!'); return }
    if (rpgChar.gold < amount) { setTransferMsg('❌ Gold tidak cukup!'); return }
    const target = leaderboard.find(l => l.username.toLowerCase() === transferTarget.trim().toLowerCase())
    if (!target) { setTransferMsg('❌ Player tidak ditemukan! Cek leaderboard.'); return }
    if (target.uid === user.uid) { setTransferMsg('❌ Tidak bisa transfer ke diri sendiri!'); return }

    // Kurangi gold lokal DULU (instant, tidak tunggu network)
    await updateRpgChar({ gold: rpgChar.gold - amount })

    if (navigator.onLine) {
      try {
        // Online: eksekusi langsung ke Firebase
        await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { gold: rpgChar.gold - amount })
        await updateDoc(doc(getRpgDb(target.uid), 'rpgChars', target.uid), { gold: (target.gold || 0) + amount }).catch(() => {})
        // Update last synced gold di meta
        await setSyncMeta(user.uid, { lastSyncedGold: rpgChar.gold - amount })
        setTransferMsg(`✅ Berhasil transfer ${amount}G ke ${transferTarget}!`)
      } catch {
        // Firebase error: queue untuk nanti
        await queueTransfer({ fromUid: user.uid, toUid: target.uid, toUsername: target.username, amount, queuedAt: Date.now() })
        const pending = await getPendingTransfers(user.uid)
        setPendingTransferCount(pending.length)
        setTransferMsg(`📤 Transfer ${amount}G ke ${transferTarget} di-queue (error jaringan). Akan dikirim otomatis.`)
      }
    } else {
      // Offline: queue transfer, akan execute saat online
      await queueTransfer({ fromUid: user.uid, toUid: target.uid, toUsername: target.username, amount, queuedAt: Date.now() })
      const pending = await getPendingTransfers(user.uid)
      setPendingTransferCount(pending.length)
      setTransferMsg(`📤 Offline! Transfer ${amount}G ke ${transferTarget} di-queue. Akan dikirim otomatis saat online.`)
    }

    setTransferTarget(''); setTransferAmount('')
    setTimeout(() => setTransferMsg(''), 6000)
  }

  // ── RPG: Weapon Upgrade ───────────────────────────────────────
  const doWeaponUpgrade = async () => {
    if (!rpgChar || !user) return
    const currentLvl = rpgChar.weaponLevel || 0
    if (currentLvl >= WEAPON_LEVELS.length) { setWeaponMsg('🌟 Senjata sudah MAX LEVEL!'); return }
    const next = WEAPON_LEVELS[currentLvl]
    const ores = rpgChar.ores || {}
    for (const [mat, qty] of Object.entries(next.materials)) {
      if ((ores[mat] || 0) < (qty as number)) {
        setWeaponMsg(`❌ Material kurang: butuh ${qty}x ${ORES.find(o=>o.id===mat)?.name || mat}`); return
      }
    }
    if (rpgChar.gold < next.goldCost) { setWeaponMsg(`❌ Gold kurang! Butuh ${next.goldCost}G`); return }
    const newOres = { ...ores }
    for (const [mat, qty] of Object.entries(next.materials)) newOres[mat] = (newOres[mat] || 0) - (qty as number)
    const prevLvl = currentLvl > 0 ? WEAPON_LEVELS[currentLvl - 1] : { atkBonus:0, defBonus:0 }
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), {
      weaponLevel: currentLvl + 1,
      atk: (rpgChar.atk || 0) + (next.atkBonus - prevLvl.atkBonus),
      def: (rpgChar.def || 0) + (next.defBonus - prevLvl.defBonus),
      gold: rpgChar.gold - next.goldCost,
      ores: newOres
    })
    setWeaponMsg(`⚔️ Senjata naik ke Level ${currentLvl + 1}! +${next.atkBonus - prevLvl.atkBonus} ATK +${next.defBonus - prevLvl.defBonus} DEF`)
    setTimeout(() => setWeaponMsg(''), 4000)
  }

  // ── RPG: Sell Inventory Item (Monster/Dungeon drops) ─────────
  const sellInventoryItem = async (itemName: string) => {
    if (!rpgChar || !user) return
    const price = ITEM_SELL_PRICES[itemName]
    if (!price) { showToast('info','❌ Tidak Bisa Dijual','Item ini tidak ada harganya!'); return }
    const inv = [...(rpgChar.inventory || [])]
    const idx = inv.indexOf(itemName)
    if (idx < 0) return
    inv.splice(idx, 1)
    await updateDoc(doc(getRpgDb(user.uid), 'rpgChars', user.uid), {
      inventory: inv, gold: (rpgChar.gold || 0) + price
    })
    setRpgChar(prev => prev ? { ...prev, inventory: inv, gold: (prev.gold || 0) + price } : prev)
    showToast('win','💰 Terjual!', `${itemName} dijual +${price} Gold`)
  }

  // ── Battle Pass: Request Beli (user) ──────────────────────────
  const requestBuyBattlePass = async () => {
    if (!user || !username) return
    setBpBuyLoading(true)
    try {
      // Cek apakah sudah punya premium atau sudah ada request pending
      if (gachaData && (gachaData as any).hasPremiumPass) {
        setBpMsg('✅ Kamu sudah memiliki Premium Pass!')
        setTimeout(() => setBpMsg(''), 3000)
        setShowBpBuyConfirm(false)
        setBpBuyLoading(false)
        return
      }
      // Cek apakah sudah ada request pending dari user ini
      const existing = await getDocs(query(collection(dbChat, 'battlePassRequests'), where('uid', '==', user.uid), where('status', '==', 'pending')))
      if (!existing.empty) {
        setBpMsg('⏳ Permintaanmu sedang menunggu persetujuan owner!')
        setTimeout(() => setBpMsg(''), 4000)
        setShowBpBuyConfirm(false)
        setBpBuyLoading(false)
        return
      }
      await addDoc(collection(dbChat, 'battlePassRequests'), {
        uid: user.uid, username, requestedAt: Date.now(), status: 'pending'
      })
      setBpMsg('✅ Request terkirim! Tunggu konfirmasi owner.')
      setShowBpBuyConfirm(false)
      // Kirim notif ke global chat
      await addDoc(collection(dbChat, 'globalChat'), {
        uid: user.uid, username, photoURL: user.photoURL || '',
        text: `🎖️ [Battle Pass Request] @${username} meminta akses Battle Pass Premium. Owner tolong cek Inbox!`,
        type: 'rpg-event', createdAt: serverTimestamp()
      })
    } catch (e) { setBpMsg('❌ Gagal kirim request, coba lagi!') }
    finally { setBpBuyLoading(false); setTimeout(() => setBpMsg(''), 4000) }
  }

  // ── Battle Pass: Owner Approve/Decline ─────────────────────────
  const approveBpRequest = async (reqId: string, reqUid: string, reqUsername: string) => {
    try {
      // Aktifkan premium pass di playerGacha user tersebut
      await updateDoc(doc(getRpgDb(reqUid), 'playerGacha', reqUid), { hasPremiumPass: true })
      // Update status request
      await updateDoc(doc(dbChat, 'battlePassRequests', reqId), { status: 'approved', approvedAt: Date.now() })
      // Notif ke global chat
      await addDoc(collection(dbChat, 'globalChat'), {
        uid: user!.uid, username, photoURL: user!.photoURL || '',
        text: `🎖️ ✅ Battle Pass Premium untuk @${reqUsername} telah DIAKTIFKAN oleh Owner!`,
        type: 'rpg-event', createdAt: serverTimestamp()
      })
      setBpRequests(prev => prev.filter(r => r.id !== reqId))
      showToast('win','✅ Approved!',`BP Premium @${reqUsername} diaktifkan`)
    } catch (e) { showToast('info','❌ Gagal','Coba lagi') }
  }

  const declineBpRequest = async (reqId: string, reqUsername: string) => {
    try {
      await updateDoc(doc(dbChat, 'battlePassRequests', reqId), { status: 'declined', declinedAt: Date.now() })
      setBpRequests(prev => prev.filter(r => r.id !== reqId))
      showToast('info','❌ Ditolak',`Request BP @${reqUsername} dihapus`)
    } catch (e) { showToast('info','❌ Gagal','Coba lagi') }
  }

  // ── Battle Pass: Klaim Tier Reward ────────────────────────────
  const claimBattlePassTier = async (tier: typeof BATTLE_PASS_TIERS[0], isPremium: boolean) => {
    if (!user || !rpgChar || !gachaData) return
    const passLevel = Math.min(Math.floor(gachaData.pulls / 5), 50)
    if (passLevel < tier.level) { setBpClaimMsg('❌ Level Pass belum cukup!'); setTimeout(()=>setBpClaimMsg(''),3000); return }
    const claimedKey = `bp_${isPremium?'premium':'free'}_${tier.level}`
    const claimed = (gachaData as any).claimedBPTiers || []
    if (claimed.includes(claimedKey)) { setBpClaimMsg('✅ Sudah diklaim!'); setTimeout(()=>setBpClaimMsg(''),2000); return }
    if (isPremium && !(gachaData as any).hasPremiumPass) { setBpClaimMsg('🔒 Butuh Premium Pass!'); setTimeout(()=>setBpClaimMsg(''),3000); return }
    const rewardStr = isPremium ? tier.premium : tier.free
    const rpgUpdates: Record<string, any> = {}
    const gachaUpdates: Record<string, any> = { claimedBPTiers: [...claimed, claimedKey] }
    // Parse reward
    if (rewardStr.includes('Potion')) {
      const count = parseInt(rewardStr.match(/×(\d+)/)?.[1] || '1')
      rpgUpdates.inventory = [...(rpgChar.inventory||[]), ...Array(count).fill('Potion HP')].slice(-30)
    }
    if (rewardStr.includes('Ticket') || rewardStr.includes('Tiket')) {
      const count = parseInt(rewardStr.match(/🎫×(\d+)/)?.[1] || rewardStr.match(/(\d+).*[Tt]icket/)?.[1] || '1')
      gachaUpdates.tickets = (gachaData.tickets || 0) + count
    }
    if (rewardStr.includes('Gold')) {
      const goldMatch = rewardStr.match(/(\d+)\s*Gold/)
      if (goldMatch) rpgUpdates.gold = (rpgChar.gold || 0) + parseInt(goldMatch[1])
    }
    if (rewardStr.includes('Primogems') || rewardStr.includes('💎')) {
      const pmMatch = rewardStr.match(/💎\s*(\d+)/) || rewardStr.match(/(\d+)\s*Primogems/)
      if (pmMatch) gachaUpdates.primogems = (gachaData.primogems || 0) + parseInt(pmMatch[1])
    }
    if (rewardStr.includes('ATK Rune')) {
      const val = parseInt(rewardStr.match(/\+(\d+)/)?.[1] || '5')
      rpgUpdates.atk = (rpgChar.atk || 0) + val
    }
    if (rewardStr.includes('Title:')) {
      const titleMatch = rewardStr.match(/Title:\s*"?([^"+"]+)"?/)
      if (titleMatch) rpgUpdates.titles = [...(rpgChar.titles||[]), titleMatch[1].trim()]
    }
    // BP Exclusive items
    const bpExcl = Object.keys(BP_EXCLUSIVE_ITEM_EFFECTS).find(k => rewardStr.includes(k))
    if (bpExcl) {
      rpgUpdates.inventory = [...(rpgUpdates.inventory || rpgChar.inventory || []), bpExcl].slice(-30)
      const effStr = BP_EXCLUSIVE_ITEM_EFFECTS[bpExcl]
      for (const part of effStr.split(',')) {
        const [stat, valStr] = part.split('+')
        const val = parseInt(valStr)
        if (!val) continue
        if (stat === 'atk')   rpgUpdates.atk   = (rpgUpdates.atk   ?? rpgChar.atk   ?? 0) + val
        if (stat === 'def')   rpgUpdates.def   = (rpgUpdates.def   ?? rpgChar.def   ?? 0) + val
        if (stat === 'spd')   rpgUpdates.spd   = (rpgUpdates.spd   ?? rpgChar.spd   ?? 0) + val
        if (stat === 'luck')  rpgUpdates.luck  = (rpgUpdates.luck  ?? rpgChar.luck  ?? 0) + val
        if (stat === 'maxHp') rpgUpdates.maxHp = (rpgUpdates.maxHp ?? rpgChar.maxHp ?? 0) + val
        if (stat === 'maxMp') rpgUpdates.maxMp = (rpgUpdates.maxMp ?? rpgChar.maxMp ?? 0) + val
      }
    }
    if (Object.keys(rpgUpdates).length > 0) await updateDoc(doc(getRpgDb(user.uid), 'rpgChars', user.uid), rpgUpdates)
    await updateDoc(doc(getRpgDb(user.uid), 'playerGacha', user.uid), gachaUpdates)
    setRpgChar(prev => prev ? { ...prev, ...rpgUpdates } as RpgChar : prev)
    setGachaData(prev => prev ? { ...prev, ...gachaUpdates } as any : prev)
    setBpClaimMsg(`✅ Reward "${isPremium?'Premium':'Free'} Lv${tier.level}" diklaim!`)
    showToast('win','🎖️ BP Reward!',`Lv${tier.level} ${isPremium?'Premium':'Free'}: ${rewardStr.substring(0,50)}`)
    setTimeout(() => setBpClaimMsg(''), 3500)
  }

  // ── RPG: Quest ────────────────────────────────────────────────
  const acceptQuest = async (questId: string) => {
    if (!rpgChar) return
    if (rpgChar.activeQuest) { setQuestMsg('Selesaikan quest aktif dulu!'); return }
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), { activeQuest: questId, questProgress: 0 })
    setQuestMsg('Quest diterima! Mulai berburu.'); setTimeout(() => setQuestMsg(''), 3000)
  }
  const cancelQuest = async () => {
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), { activeQuest: null, questProgress: 0 })
  }

  const avatarColor = (uid: string) => {
    const colors = ['#c8f500','#00e5ff','#ff6b9d','#a78bfa','#fb923c','#34d399']
    let hash = 0
    for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
  }
  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

  // ═══════════════════════════════════════════════════════════════
  // VOICE CALL HANDLERS (WebRTC + Firebase Signaling)
  // ═══════════════════════════════════════════════════════════════
  const VOICE_DOC = (groupId: string) => doc(dbChat, 'calls', groupId)
  const VOICE_PARTICIPANTS = (groupId: string) => collection(dbChat, 'calls', groupId, 'participants')
  const VOICE_OFFERS = (groupId: string) => collection(dbChat, 'calls', groupId, 'offers')
  const VOICE_ICE = (groupId: string) => collection(dbChat, 'calls', groupId, 'ice')
  const GROUP_ID = 'kyokomd-global'

  const createPeerConnection = (remoteUid: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    })
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!)
    })
    pc.onicecandidate = (e) => {
      if (e.candidate && user) {
        addDoc(VOICE_ICE(GROUP_ID), {
          from: user.uid, to: remoteUid,
          candidate: e.candidate.toJSON(), createdAt: Date.now()
        }).catch(() => {})
      }
    }
    pc.ontrack = (e) => {
      const audio = new Audio()
      audio.srcObject = e.streams[0]
      audio.autoplay = true
      audio.play().catch(() => {})
    }
    peerConnectionsRef.current[remoteUid] = pc
    return pc
  }

  const joinVoiceCall = async () => {
    if (!user || voiceLoading) return
    setVoiceLoading(true); setVoiceError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      localStreamRef.current = stream

      // Tulis partisipan ke Firestore
      await setDoc(doc(VOICE_PARTICIPANTS(GROUP_ID), user.uid), {
        username, photoURL: user.photoURL || '',
        muted: false, joinedAt: Date.now()
      })

      // Dengarkan partisipan lain
      const unsubPart = onSnapshot(VOICE_PARTICIPANTS(GROUP_ID), async (snap) => {
        const parts: Record<string, {username:string;photoURL:string;muted:boolean;joinedAt:number}> = {}
        snap.docs.forEach(d => { parts[d.id] = d.data() as any })
        setVoiceParticipants(parts)

        // Buat offer ke partisipan baru (bukan diri sendiri)
        for (const remoteUid of Object.keys(parts)) {
          if (remoteUid === user.uid) continue
          if (!peerConnectionsRef.current[remoteUid]) {
            const pc = createPeerConnection(remoteUid)
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            await setDoc(doc(VOICE_OFFERS(GROUP_ID), `${user.uid}_${remoteUid}`), {
              from: user.uid, to: remoteUid,
              sdp: offer.sdp, type: offer.type, createdAt: Date.now()
            })
          }
        }
      })

      // Dengarkan offers yang masuk (untuk diri sendiri)
      const unsubOffers = onSnapshot(
        query(VOICE_OFFERS(GROUP_ID), where('to', '==', user.uid)),
        async (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue
            const data = change.doc.data()
            const remoteUid = data.from as string
            let pc = peerConnectionsRef.current[remoteUid]
            if (!pc) pc = createPeerConnection(remoteUid)
            if (data.type === 'offer') {
              await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              await setDoc(doc(VOICE_OFFERS(GROUP_ID), `${remoteUid}_${user.uid}`), {
                from: user.uid, to: remoteUid,
                sdp: answer.sdp, type: answer.type, createdAt: Date.now()
              })
            } else if (data.type === 'answer') {
              if (pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
              }
            }
          }
        }
      )

      // Dengarkan ICE candidates
      const unsubIce = onSnapshot(
        query(VOICE_ICE(GROUP_ID), where('to', '==', user.uid)),
        async (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue
            const data = change.doc.data()
            const pc = peerConnectionsRef.current[data.from]
            if (pc) {
              try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)) } catch {}
            }
          }
        }
      )

      voiceUnsubRef.current = () => { unsubPart(); unsubOffers(); unsubIce() }
      setVoiceCallActive(true)
    } catch (err: any) {
      setVoiceError(err?.message?.includes('Permission') ? '🎙️ Izin mikrofon ditolak. Aktifkan di browser.' : 'Gagal join call: ' + (err?.message || 'unknown'))
    } finally { setVoiceLoading(false) }
  }

  const leaveVoiceCall = async () => {
    if (!user) return
    // Cleanup WebRTC
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
    peerConnectionsRef.current = {}
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    voiceUnsubRef.current?.()
    voiceUnsubRef.current = null
    // Hapus dari Firestore
    await deleteDoc(doc(VOICE_PARTICIPANTS(GROUP_ID), user.uid)).catch(() => {})
    // Cleanup offers & ice (milik kita)
    const offerSnap = await getDocs(query(VOICE_OFFERS(GROUP_ID), where('from', '==', user.uid))).catch(() => null)
    offerSnap?.docs.forEach(d => deleteDoc(d.ref).catch(() => {}))
    const iceSnap = await getDocs(query(VOICE_ICE(GROUP_ID), where('from', '==', user.uid))).catch(() => null)
    iceSnap?.docs.forEach(d => deleteDoc(d.ref).catch(() => {}))
    setVoiceCallActive(false)
    setVoiceParticipants({})
    setVoiceMuted(false)
  }

  const toggleVoiceMute = async () => {
    if (!user || !localStreamRef.current) return
    const newMuted = !voiceMuted
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !newMuted })
    setVoiceMuted(newMuted)
    await updateDoc(doc(VOICE_PARTICIPANTS(GROUP_ID), user.uid), { muted: newMuted }).catch(() => {})
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  // ── Discord-style channel list ────────────────────────────────
  const CHANNELS = [
    { id: 'chat',   icon: '💬', label: 'global-chat',   category: 'SOCIAL',  type: 'text' },
    { id: 'rpg',    icon: '⚔️', label: 'rpg-arena',     category: 'GAME ONLINE',  type: 'text' },
    { id: 'fishing',icon: '🎣', label: 'fishing-zone',  category: 'GAME ONLINE',  type: 'text' },
    { id: 'gacha',  icon: '✨', label: 'gacha-pull',    category: 'GAME ONLINE',  type: 'text' },
    { id: 'planet', icon: '🪐', label: 'planet-explore',category: 'GAME ONLINE',  type: 'text' },
    { id: 'offline',icon: '🕹️', label: 'game-offline',  category: 'GAME OFFLINE', type: 'text' },
    { id: 'music',  icon: '🎵', label: 'music-room',    category: 'MEDIA',   type: 'voice' },
    { id: 'voice',  icon: '📞', label: 'voice-room',    category: 'MEDIA',   type: 'voice' },
    { id: 'anime',  icon: '🎌', label: 'anime-stream',  category: 'MEDIA',   type: 'text'  },
    { id: 'drakor', icon: '🎬', label: 'drakor-stream', category: 'MEDIA',   type: 'text'  },
    { id: 'manga',  icon: '📖', label: 'kyoko-manga',   category: 'MEDIA',   type: 'text'  },
    { id: 'mangax', icon: '💎', label: 'manga-cross',   category: 'MEDIA',   type: 'text'  },
    { id: 'novel',  icon: '📕', label: 'kyonovel',      category: 'MEDIA',   type: 'text'  },
  ] as const

  type ChannelId = typeof CHANNELS[number]['id']

  const handleChannelClick = (id: ChannelId) => {
    const allIds = CHANNELS.map(c => c.id)
    const oldIdx = allIds.indexOf(getActiveChannelId())
    const newIdx = allIds.indexOf(id)
    setNavTransDir(newIdx >= oldIdx ? 'up' : 'down')
    setNavContentKey(k => k + 1)
    setNavOpen(false)

    if (id === 'rpg') { setActiveTab('rpg'); setActiveGachaTab('rpg'); fetchActiveBattles(); }
    else if (id === 'gacha') { setActiveTab('rpg'); setActiveGachaTab('gacha'); }
    else if (id === 'planet') { setActiveTab('rpg'); setActiveGachaTab('planet'); }
    else if (id === 'fishing') { setActiveTab('fishing' as any); }
    else if (id === 'voice') { setActiveTab('voice'); }
    else if (id === 'music') { setActiveTab('music'); }
    else if (id === 'anime') { setActiveTab('anime' as any); }
    else if (id === 'drakor') { setActiveTab('drakor' as any); }
    else if (id === 'manga') { setActiveTab('manga' as any); }
    else if (id === 'mangax') { setActiveTab('mangax' as any); }
    else if (id === 'novel') { setActiveTab('novel' as any); }
    else if (id === 'offline') { setActiveTab('offline' as any); }
    else { setActiveTab('chat'); }
  }

  const getActiveChannelId = (): ChannelId => {
    if ((activeTab as string) === 'fishing') return 'fishing'
    if ((activeTab as string) === 'anime') return 'anime'
    if ((activeTab as string) === 'drakor') return 'drakor'
    if ((activeTab as string) === 'manga') return 'manga'
    if ((activeTab as string) === 'mangax') return 'mangax'
    if ((activeTab as string) === 'offline') return 'offline'
    if (activeTab === 'voice') return 'voice'
    if (activeTab === 'music') return 'music'
    if (activeTab === 'rpg') {
      if (activeGachaTab === 'gacha') return 'gacha'
      if (activeGachaTab === 'planet') return 'planet'
      return 'rpg'
    }
    return 'chat'
  }

  const categories = ['SOCIAL', 'GAME ONLINE', 'GAME OFFLINE', 'MEDIA']

  return (
    <div className="gc-overlay" onClick={() => { if (battleState) clearActiveBattle(); onClose() }} style={{ zIndex: 9999, position:'fixed', inset:0, display:'flex', alignItems:'stretch', justifyContent:'stretch' }}>
      <div className="gc-container gc2-container zzz-discord-layout" onClick={e => e.stopPropagation()} style={{ position: 'relative', display: 'flex', flexDirection: 'row', padding: 0, overflow: 'hidden', width:'100vw', height:'100dvh', borderRadius:0, flex:1 }}>

        {/* ── QUARTER CIRCLE NAV TRIGGER ── */}
        {/* ── ICON NAV STRIP ── */}
        <div className="qc-icon-strip">
          <div className="qc-strip-avatar" onClick={() => setNavOpen(v => !v)}>
            {groupInfo?.iconUrl
              ? <img src={groupInfo.iconUrl} alt="g" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
              : <span style={{fontSize:15}}>⚡</span>}
          </div>
          <div className="qc-strip-divider"/>
          {CHANNELS.map((ch) => {
            const isActive = getActiveChannelId() === ch.id
            const isVoiceActive = ch.id === 'voice' && voiceCallActive
            return (
              <button
                key={ch.id}
                className={`qc-strip-btn${isActive ? ' qc-strip-active' : ''}${isVoiceActive ? ' qc-strip-voice' : ''}`}
                onClick={() => handleChannelClick(ch.id as ChannelId)}
                title={ch.label}
              >
                <span className="qc-strip-icon">{ch.icon}</span>
                {isVoiceActive && <span className="qc-strip-badge">{Object.keys(voiceParticipants).length}</span>}
              </button>
            )
          })}
        </div>

        {/* ── GROUP NAV POPUP (click avatar) ── */}

        {/* ── NAV BACKDROP ── */}
        <div className={`qc-backdrop${navOpen ? ' qc-backdrop-visible' : ''}`} onClick={() => setNavOpen(false)} />

        {/* ── NAV PANEL ── */}
        <div className={`qc-nav-panel${navOpen ? ' qc-nav-open' : ''}`}>
          {/* Group info */}
          <div className="qc-group-info">
            <div style={{fontSize:14,fontWeight:800,color:'#fff',letterSpacing:.4}}>{groupInfo?.name || 'KyokoMd Global'}</div>
            <div style={{fontSize:10,color:'rgba(200,245,0,0.5)',fontFamily:'monospace',marginTop:2}}>{groupInfo?.members?.length||0} members</div>
          </div>

          {/* Channel list */}
          <div className="qc-channel-scroll">
            {categories.map(cat => (
              <div key={cat}>
                <div className="qc-cat-label">{cat}</div>
                {CHANNELS.filter(c => c.category === cat).map((ch, chIdx) => {
                  const isActive = getActiveChannelId() === ch.id
                  const isVoiceActive = ch.id === 'voice' && voiceCallActive
                  const globalIdx = CHANNELS.indexOf(ch)
                  return (
                    <button
                      key={ch.id}
                      className={`qc-ch-item${isActive ? ' qc-ch-active' : ''}${isVoiceActive ? ' qc-ch-voice' : ''}`}
                      style={navOpen ? {animationDelay:`${globalIdx * 35}ms`} : {}}
                      onClick={() => handleChannelClick(ch.id as ChannelId)}
                    >
                      <span className="qc-ch-icon">{ch.icon}</span>
                      <span className="qc-ch-label">{ch.label}</span>
                      {ch.id === 'voice' && voiceCallActive && (
                        <span className="qc-voice-badge">{Object.keys(voiceParticipants).length}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* User panel */}
          {step === 'main' && user && (
            <div className="qc-user-bar">
              <div className="qc-user-av" style={{background: avatarColor(user.uid)}}>
                {user.photoURL
                  ? <img src={user.photoURL} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                  : username[0]?.toUpperCase()}
                <span className="qc-status-dot"/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,fontWeight:700,color:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{username}</div>
                <div style={{fontSize:9,color:'rgba(74,222,128,0.8)'}}>● Online</div>
              </div>
              <div style={{display:'flex',gap:4}}>
                <button className="zzz-icon-btn" title="Logout" onClick={handleLogout}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fillRule="evenodd" d="M3 3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 1 0 0-2H4V5h7a1 1 0 1 0 0-2H3zm12.293 4.293a1 1 0 0 1 1.414 1.414L14.414 11H9a1 1 0 1 1 0-2h5.414l2.293-2.293z" clipRule="evenodd"/></svg>
                </button>
                <button className="zzz-icon-btn" title="Kembali" onClick={() => { if (battleState) clearActiveBattle(); onClose() }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414z" clipRule="evenodd"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── MAIN CONTENT AREA ── */}
        <div className="zzz-main-content">
        {/* ── UPDATE BANNER ── */}
        {showUpdateBanner && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999,
            background: 'linear-gradient(90deg, #c8f500, #a0c800)',
            color: '#0a0a0a', padding: '10px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontWeight: 700, fontSize: 13, gap: 10
          }}>
            <span>🔄 Ada update baru! Refresh untuk versi terbaru.</span>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => window.location.reload()} style={{
                background: '#0a0a0a', color: '#c8f500', border: 'none',
                borderRadius: 8, padding: '5px 12px', fontWeight: 700,
                fontSize: 12, cursor: 'pointer'
              }}>Refresh</button>
              <button onClick={() => setShowUpdateBanner(false)} style={{
                background: 'rgba(0,0,0,0.2)', color: '#0a0a0a', border: 'none',
                borderRadius: 8, padding: '5px 10px', fontWeight: 700,
                fontSize: 12, cursor: 'pointer'
              }}>✕</button>
            </div>
          </div>
        )}

        {/* Swap transition overlay */}
        {swapAnim && (
          <div className="gc-swap-overlay" aria-hidden="true">
            <div className={`gc-swap-panel-a gc-swap-${swapAnim}`} />
            <div className={`gc-swap-panel-b gc-swap-${swapAnim}`} />
            <div className="gc-swap-flash" />
            <div className="gc-swap-line" />
          </div>
        )}

        {/* ── OWNER INBOX OVERLAY (Battle Pass Requests) ── */}
        {showOwnerInbox && isAdmin && (
          <div style={{position:'absolute',inset:0,background:'#0a0a12',zIndex:50,display:'flex',flexDirection:'column',overflowY:'auto'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderBottom:'1px solid rgba(255,157,0,0.2)',flexShrink:0}}>
              <button onClick={() => setShowOwnerInbox(false)} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'5px 10px',color:'rgba(255,255,255,0.6)',fontSize:11,cursor:'pointer',fontWeight:700}}>←</button>
              <span style={{color:'#ff9d00',fontWeight:800,fontSize:15}}>📬 Inbox BP Request</span>
              {bpRequests.length > 0 && <span style={{background:'#ff375f',color:'#fff',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:800}}>{bpRequests.length}</span>}
            </div>
            <div style={{padding:14,display:'flex',flexDirection:'column',gap:10}}>
              {bpRequests.length === 0 ? (
                <div style={{textAlign:'center',color:'rgba(255,255,255,0.3)',padding:40,fontSize:13}}>
                  <div style={{fontSize:36,marginBottom:8}}>📭</div>
                  Tidak ada permintaan Battle Pass
                </div>
              ) : bpRequests.map(req => (
                <div key={req.id} style={{background:'rgba(255,157,0,0.08)',border:'1px solid rgba(255,157,0,0.25)',borderRadius:14,padding:'14px 16px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,157,0,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>🎖️</div>
                    <div>
                      <div style={{fontSize:14,fontWeight:800,color:'#fff'}}>{req.username}</div>
                      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>
                        {new Date(req.requestedAt).toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.6)',marginBottom:10}}>
                    Meminta akses <strong style={{color:'#ff9d00'}}>Battle Pass Premium</strong>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={() => approveBpRequest(req.id, req.uid, req.username)} style={{flex:1,background:'rgba(50,200,100,0.15)',border:'1px solid rgba(50,200,100,0.4)',borderRadius:10,padding:'10px',color:'#4ade80',fontSize:13,fontWeight:800,cursor:'pointer'}}>
                      ✅ Approve (Dah Bayar)
                    </button>
                    <button onClick={() => declineBpRequest(req.id, req.username)} style={{flex:1,background:'rgba(255,55,95,0.1)',border:'1px solid rgba(255,55,95,0.3)',borderRadius:10,padding:'10px',color:'#ff6b6b',fontSize:13,fontWeight:800,cursor:'pointer'}}>
                      ❌ Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── BP BUY CONFIRM POPUP ── */}
        {showBpBuyConfirm && (
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.85)',zIndex:60,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div style={{background:'#111',border:'1px solid rgba(255,157,0,0.4)',borderRadius:18,padding:24,maxWidth:320,width:'100%',textAlign:'center'}}>
              <div style={{fontSize:44,marginBottom:12}}>🎖️</div>
              <div style={{fontSize:17,fontWeight:900,color:'#ff9d00',marginBottom:8}}>Battle Pass Premium</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.6)',lineHeight:1.6,marginBottom:16}}>
                Kamu akan mengirim permintaan akses Battle Pass ke Owner.<br/>
                Owner akan konfirmasi setelah pembayaran dikonfirmasi.
              </div>
              <div style={{background:'rgba(255,157,0,0.08)',border:'1px solid rgba(255,157,0,0.2)',borderRadius:10,padding:12,marginBottom:16,fontSize:12,color:'rgba(255,255,255,0.5)',textAlign:'left'}}>
                📌 Hubungi owner untuk info pembayaran<br/>
                📌 Setelah bayar, owner akan klik ✅ Approve<br/>
                📌 BP Premium langsung aktif di akunmu
              </div>
              {bpMsg && <div style={{fontSize:12,color:'#c8f500',marginBottom:12,padding:'6px 10px',background:'rgba(200,245,0,0.1)',borderRadius:8}}>{bpMsg}</div>}
              <div style={{display:'flex',gap:10}}>
                <button onClick={requestBuyBattlePass} disabled={bpBuyLoading} style={{flex:1,background:'linear-gradient(135deg,rgba(255,157,0,0.3),rgba(255,80,0,0.2))',border:'1px solid rgba(255,157,0,0.5)',borderRadius:12,padding:'12px',color:'#ff9d00',fontSize:14,fontWeight:800,cursor:'pointer'}}>
                  {bpBuyLoading ? '⏳ Mengirim...' : '✅ Allow'}
                </button>
                <button onClick={() => { setShowBpBuyConfirm(false); setBpMsg('') }} style={{flex:1,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:'12px',color:'rgba(255,255,255,0.5)',fontSize:14,fontWeight:800,cursor:'pointer'}}>
                  ❌ Decline
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast notifications */}
        <ToastContainer toasts={toasts} onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />

        {/* ── ZZZ CHANNEL HEADER ── */}
        <div className="zzz-channel-header" style={{paddingLeft:14}}>
          <div className="zzz-channel-header-left">
            <span className="zzz-channel-header-icon">
              {CHANNELS.find(c => c.id === getActiveChannelId())?.icon || '💬'}
            </span>
            <span className="zzz-channel-header-name">
              {CHANNELS.find(c => c.id === getActiveChannelId())?.label || 'global-chat'}
            </span>
            {isAdmin && <span className="gc2-admin-badge" style={{marginLeft:6}}>ADMIN</span>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            {isAdmin && (
              <button onClick={() => setShowOwnerInbox(true)} style={{position:'relative',background:bpRequests.length>0?'rgba(255,157,0,0.15)':'rgba(255,255,255,0.04)',border:`1px solid ${bpRequests.length>0?'rgba(255,157,0,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:8,padding:'5px 8px',color:bpRequests.length>0?'#ff9d00':'rgba(255,255,255,0.4)',fontSize:13,cursor:'pointer'}} title="Inbox BP Request">
                📬{bpRequests.length > 0 && <span style={{marginLeft:4,background:'#ff375f',color:'#fff',borderRadius:10,padding:'1px 5px',fontSize:9,fontWeight:800}}>{bpRequests.length}</span>}
              </button>
            )}
            <button className="zzz-icon-btn" onClick={() => setShowGroupInfo(true)} title="Info Grup" style={{padding:'5px 8px'}}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 1 1h1a1 1 0 1 0 0-2v-3a1 1 0 0 0-1-1H9z" clipRule="evenodd"/></svg>
            </button>
          </div>
        </div>

        {/* ── LOGIN / USERNAME SCREENS ── */}
        {step === 'loading' && (
          <div className="gc-center"><div className="gc-spinner"/><p style={{color:'rgba(255,255,255,0.4)',fontSize:13}}>Memuat...</p></div>
        )}
        {step === 'login' && (
          <div className="gc-center">
            <div className="gc-auth-card">
              <div className="gc-auth-icon" style={{fontSize:40}}>💬</div>
              <h2 className="gc-auth-title">Gabung Global Chat</h2>
              <p className="gc-auth-desc">Login dengan Google untuk ngobrol & main RPG bareng komunitas KyokoMd.</p>
              <button className="gc-google-btn" onClick={handleLogin} disabled={loginLoading}>
                {loginLoading ? <span className="gc-spinner-sm"/> : (
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                {loginLoading ? 'Menghubungkan...' : 'Lanjut dengan Google'}
              </button>
            </div>
          </div>
        )}
        {step === 'username' && (
          <div className="gc-center">
            <div className="gc-auth-card">
              <div className="gc-auth-icon" style={{fontSize:40}}>✏️</div>
              <h2 className="gc-auth-title">Buat Username</h2>
              <p className="gc-auth-desc">Username akan ditampilkan di chat & RPG.</p>
              <div className="gc-username-wrap">
                <input className="gc-username-input" type="text" placeholder="Contoh: KyokoFan123" value={usernameInput} maxLength={20}
                  onChange={e => { setUsernameInput(e.target.value); setUsernameError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSetUsername()} autoFocus/>
                {usernameError && <p style={{color:'#ff6b6b',fontSize:12,margin:'4px 0 0'}}>{usernameError}</p>}
                <button className="gc-set-username-btn" onClick={handleSetUsername} disabled={savingUsername}>
                  {savingUsername ? <span className="gc-spinner-sm"/> : 'Simpan & Mulai'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MAIN (TABS) ── */}
        {step === 'main' && (
          <div key={navContentKey} className={`gc-bloom-enter-${navTransDir}`} style={{display:'contents'}}>
            {/* ── VOICE ROOM TAB ── */}
            {activeTab === 'voice' && (
              <div className="zzz-voice-room">
                <div className="zzz-voice-room-header">
                  <div style={{fontSize:32,marginBottom:8}}>📞</div>
                  <div style={{fontSize:16,fontWeight:800,color:'#c8f500',letterSpacing:1}}>VOICE ROOM</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:4}}>
                    {voiceCallActive ? `${Object.keys(voiceParticipants).length} orang di dalam` : 'Belum ada yang join'}
                  </div>
                </div>

                {/* Participants grid */}
                <div className="zzz-voice-participants">
                  {Object.entries(voiceParticipants).map(([uid, p]) => (
                    <div key={uid} className={`zzz-voice-participant${p.muted ? ' muted' : ''}`}>
                      <div className="zzz-voice-avatar" style={{background: avatarColor(uid)}}>
                        {p.photoURL
                          ? <img src={p.photoURL} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                          : p.username[0]?.toUpperCase()}
                        {!p.muted && <div className="zzz-voice-wave"><span/><span/><span/></div>}
                      </div>
                      <div style={{fontSize:11,fontWeight:700,color:uid===user?.uid?'#c8f500':'#fff',marginTop:6,maxWidth:70,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'center'}}>
                        {uid === user?.uid ? 'Kamu' : p.username}
                      </div>
                      <div style={{fontSize:9,color:p.muted?'#ff6b6b':'rgba(200,245,0,0.7)'}}>
                        {p.muted ? '🔇 Muted' : '🎙️ Live'}
                      </div>
                    </div>
                  ))}
                  {Object.keys(voiceParticipants).length === 0 && !voiceCallActive && (
                    <div style={{gridColumn:'1/-1',textAlign:'center',padding:'40px 20px',color:'rgba(255,255,255,0.2)'}}>
                      <div style={{fontSize:40,marginBottom:8}}>🔕</div>
                      <div style={{fontSize:12}}>Room kosong. Jadilah yang pertama!</div>
                    </div>
                  )}
                </div>

                {voiceError && (
                  <div style={{margin:'0 16px',padding:'10px 14px',background:'rgba(255,107,107,0.1)',border:'1px solid rgba(255,107,107,0.3)',borderRadius:10,fontSize:12,color:'#ff6b6b'}}>
                    {voiceError}
                  </div>
                )}

                {/* Call controls */}
                <div className="zzz-voice-controls">
                  {!voiceCallActive ? (
                    <button className="zzz-voice-btn join" onClick={joinVoiceCall} disabled={voiceLoading}>
                      {voiceLoading ? <span className="gc-spinner-sm"/> : '📞'}
                      <span>{voiceLoading ? 'Menghubungkan...' : 'Join Voice Call'}</span>
                    </button>
                  ) : (
                    <>
                      <button className={`zzz-voice-btn ${voiceMuted ? 'muted' : 'unmuted'}`} onClick={toggleVoiceMute}>
                        {voiceMuted ? '🔇' : '🎙️'}
                        <span>{voiceMuted ? 'Unmute' : 'Mute'}</span>
                      </button>
                      <button className="zzz-voice-btn leave" onClick={leaveVoiceCall}>
                        📴 <span>Leave</span>
                      </button>
                    </>
                  )}
                </div>

                <div style={{padding:'0 16px 16px',fontSize:10,color:'rgba(255,255,255,0.2)',textAlign:'center',lineHeight:1.6}}>
                  🔒 Audio peer-to-peer langsung — tidak lewat server<br/>
                  Pastikan izin mikrofon browser sudah aktif
                </div>
              </div>
            )}

            {/* ── MUSIC ROOM TAB ── */}
            {activeTab === 'music' && (
              <div className="gc2-rpg-wrap" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:24}}>
                <div style={{fontSize:48}}>🎵</div>
                <div style={{fontSize:16,fontWeight:800,color:'#c8f500'}}>MUSIC ROOM</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',textAlign:'center'}}>
                  Putar musik di tab Chat, lalu nikmati bersama di sini
                </div>
                {nowPlaying ? (
                  <div style={{background:'rgba(200,245,0,0.07)',border:'1px solid rgba(200,245,0,0.2)',borderRadius:16,padding:'16px 20px',width:'100%',maxWidth:320}}>
                    <div style={{fontSize:11,color:'rgba(200,245,0,0.6)',marginBottom:6,letterSpacing:1}}>NOW PLAYING</div>
                    <div style={{fontSize:13,fontWeight:700,color:'#fff',lineHeight:1.4}}>{nowPlaying.title}</div>
                    {gcMusicVisualizer && gcMusicPlaying && (
                      <div className="gc-music-visualizer" style={{marginTop:12}} aria-hidden="true">
                        <span/><span/><span/><span/><span/>
                      </div>
                    )}
                    <button onClick={handleStopGcMusic} style={{marginTop:12,width:'100%',background:'rgba(255,107,107,0.1)',border:'1px solid rgba(255,107,107,0.3)',borderRadius:8,padding:'8px',color:'#ff6b6b',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                      ⏹ Stop Music
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setActiveTab('chat'); setShowMusicSearch(true) }} style={{background:'linear-gradient(135deg,rgba(200,245,0,0.15),rgba(200,245,0,0.05))',border:'1px solid rgba(200,245,0,0.3)',borderRadius:12,padding:'12px 24px',color:'#c8f500',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                    🎵 Cari & Putar Musik
                  </button>
                )}

                {/* ── Kelola Kategori Musik (Admin) ── */}
                {isAdmin && (
                  <div style={{width:'100%',maxWidth:320}}>
                    <button onClick={() => setShowMusicCatMgr(v=>!v)} style={{background:'rgba(200,245,0,0.08)',border:'1px solid rgba(200,245,0,0.2)',borderRadius:10,padding:'10px 16px',color:'#c8f500',fontSize:12,fontWeight:700,cursor:'pointer',width:'100%',marginTop:4}}>
                      🎵 {showMusicCatMgr ? 'Tutup' : 'Kelola'} Kategori Musik
                    </button>
                    {showMusicCatMgr && (
                      <div style={{background:'rgba(0,0,0,0.5)',border:'1px solid rgba(200,245,0,0.2)',borderRadius:14,padding:14,marginTop:8}}>
                        <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontWeight:700,marginBottom:6}}>BAWAAN</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>
                          {Object.keys({dj:1,pop:1,rock:1,rnb:1,'hip hop':1,jazz:1,kpop:1,electronic:1,acoustic:1,dangdut:1}).map(cat => (
                            <span key={cat} style={{padding:'3px 8px',borderRadius:5,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',fontSize:10,color:'rgba(255,255,255,0.45)'}}>{cat}</span>
                          ))}
                        </div>
                        {Object.keys(customMusicCats).length > 0 && (
                          <>
                            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontWeight:700,marginBottom:6}}>CUSTOM</div>
                            {Object.entries(customMusicCats).map(([name, kws]) => (
                              <div key={name} style={{display:'flex',alignItems:'center',gap:8,background:'rgba(200,245,0,0.06)',border:'1px solid rgba(200,245,0,0.15)',borderRadius:8,padding:'6px 10px',marginBottom:5}}>
                                <div style={{flex:1}}>
                                  <div style={{fontSize:12,fontWeight:700,color:'#c8f500'}}>{name}</div>
                                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{kws.join(', ')}</div>
                                </div>
                                <button onClick={() => deleteCustomCat(name)} style={{background:'rgba(255,107,107,0.1)',border:'1px solid rgba(255,107,107,0.3)',borderRadius:6,padding:'3px 8px',color:'#ff6b6b',fontSize:11,cursor:'pointer'}}>🗑️</button>
                              </div>
                            ))}
                          </>
                        )}
                        <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontWeight:700,margin:'8px 0 5px'}}>TAMBAH BARU</div>
                        <input placeholder="Nama kategori (misal: anime)" value={newCatName} onChange={e=>setNewCatName(e.target.value)}
                          style={{width:'100%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'7px 10px',color:'#fff',fontSize:12,outline:'none',marginBottom:5,boxSizing:'border-box' as const}} />
                        <input placeholder="Keywords, pisah koma (misal: anime, ost, opening)" value={newCatKeywords} onChange={e=>setNewCatKeywords(e.target.value)}
                          style={{width:'100%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'7px 10px',color:'#fff',fontSize:12,outline:'none',marginBottom:8,boxSizing:'border-box' as const}} />
                        <button onClick={() => saveCustomCat(newCatName, newCatKeywords)} style={{width:'100%',background:'linear-gradient(135deg,#c8f500,#a8d400)',border:'none',borderRadius:8,padding:'8px',color:'#000',fontSize:12,fontWeight:800,cursor:'pointer'}}>
                          ➕ Simpan Kategori
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── ANIME STREAM TAB ── */}
            {(activeTab as string) === 'anime' && (
              <AnimeStreamPanel isAdmin={isAdmin} userId={user?.uid || ''} />
            )}

            {/* ── DRAKOR STREAM TAB ── */}
            {(activeTab as string) === 'drakor' && (
              <DrakorStreamPanel isAdmin={isAdmin} userId={user?.uid || ''} />
            )}

            {/* ── MANGA TAB ── */}
            {(activeTab as string) === 'manga' && (
              <MangaStreamPanel isAdmin={isAdmin} userId={user?.uid || ''} />
            )}

            {/* ── MANGA CROSS TAB (PREMIUM) ── */}
            {(activeTab as string) === 'mangax' && (
              <MangaCrossPanel isAdmin={isAdmin} userId={user?.uid || ''} />
            )}

            {/* ── KYONOVEL TAB ── */}
            {(activeTab as string) === 'novel' && (
              <KyoNovelPanel isAdmin={isAdmin} userId={user?.uid || ''} />
            )}

            {/* ── CHAT TAB ── */}
            {activeTab === 'chat' && (
              <>
                {memberList.length > 0 && (
                  <div className="gc2-members-strip">
                    {memberList.slice(0,8).map(m => {
                      const pres = presenceMap[m.uid]
                      const isOnline = pres?.online === true
                      return (
                        <div key={m.uid} className="gc2-member-chip" title={m.username + (m.isOwner?' 👑':m.isAdmin?' ⭐':'')}>
                          <div style={{ position:'relative', display:'inline-block' }}>
                            <div
                              className="gc2-member-avatar"
                              style={{ background: avatarColor(m.uid) }}
                            >
                              {m.photoURL ? <img src={m.photoURL} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/> : m.username[0].toUpperCase()}
                            </div>
                            {/* Dot online/offline */}
                            <span className={`gc2-presence-dot ${isOnline ? 'online' : 'offline'}`}/>
                          </div>
                          <span className="gc2-member-name">{m.username}{m.isOwner?' 👑':m.isAdmin?' ⭐':''}</span>
                        </div>
                      )
                    })}
                    {memberList.length > 8 && <div className="gc2-member-more">+{memberList.length-8}</div>}
                  </div>
                )}

                {/* Active battles strip */}
                {activeBattles.length > 0 && (
                  <div className="gc2-battles-strip">
                    <div className="gc2-battles-label">⚔️ Sedang Bertarung</div>
                    {activeBattles.map(b => (
                      <div key={b.uid} className="gc2-battle-card">
                        <div className="gc2-battle-header">
                          <span className="gc2-battle-user">{RPG_CLASSES[b.class].emoji} {b.username}</span>
                          <span className="gc2-battle-vs">VS</span>
                          <span className="gc2-battle-monster">{b.monsterEmoji} {b.monsterName}</span>
                        </div>
                        <div className="gc2-battle-bars">
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>❤️ {b.playerHp}/{b.playerMaxHp}</div>
                            <div className="gc2-bar-wrap"><div className="gc2-bar-fill gc2-hp-fill" style={{ width: `${(b.playerHp/b.playerMaxHp)*100}%` }}/></div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 2, textAlign: 'right' }}>❤️ {b.monsterHp}/{b.monsterMaxHp}</div>
                            <div className="gc2-bar-wrap"><div className="gc2-bar-fill" style={{ width: `${(b.monsterHp/b.monsterMaxHp)*100}%`, background: 'linear-gradient(90deg,#ff4444,#ff0000)' }}/></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="gc-messages" ref={messagesRef} style={{flex:1, position:'relative'}}
                  onScroll={() => {
                    const el = messagesRef.current
                    if (!el) return
                    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                    setShowScrollDown(!nearBottom)
                    if (nearBottom) setHasNewMsg(false)
                  }}
                >
                  {messages.length === 0 && (
                    <div className="gc-empty"><div className="gc-empty-icon">💬</div><p>Belum ada pesan. Jadilah yang pertama!</p></div>
                  )}
                  {/* VIRTUAL WINDOW: hanya render MSG_WINDOW_SIZE + extra pesan, hemat DOM */}
                  {(() => {
                    const windowSize = MSG_WINDOW_SIZE + msgWindowExtra
                    const windowedMsgs = messages.slice(Math.max(0, messages.length - windowSize))
                    const hiddenCount = messages.length - windowedMsgs.length
                    return (
                      <>
                        {hiddenCount > 0 && (
                          <div style={{ textAlign: 'center', padding: '8px 0' }}>
                            <button
                              onClick={() => setMsgWindowExtra(e => e + 30)}
                              style={{
                                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: 20, padding: '4px 16px', color: 'rgba(255,255,255,0.6)',
                                fontSize: 12, cursor: 'pointer'
                              }}
                            >⬆️ Load {Math.min(30, hiddenCount)} pesan lama ({hiddenCount} tersembunyi)</button>
                          </div>
                        )}
                        {windowedMsgs.map((msg, i) => {
                    const isMe = msg.uid === user?.uid
                    const prev = windowedMsgs[i-1]
                    const sameUser = prev && prev.uid === msg.uid
                    const canDelete = isMe || isAdmin
                    const isSwiping = swipingMsgId === msg.id
                    return (
                      <div key={msg.id} className={`gc-msg-row ${isMe?'gc-msg-me':'gc-msg-other'} ${sameUser?'gc-msg-grouped':''}`}
                        onTouchStart={(e) => { setSwipingMsgId(msg.id); setSwipeX(e.touches[0].clientX) }}
                        onTouchMove={(e) => {
                          if (swipingMsgId !== msg.id) return
                          const dx = e.touches[0].clientX - swipeX
                          const el = e.currentTarget as HTMLElement
                          el.style.transform = `translateX(${Math.max(-60, Math.min(60, dx))}px)`
                          el.style.transition = 'none'
                        }}
                        onTouchEnd={(e) => {
                          const el = e.currentTarget as HTMLElement
                          const dx = e.changedTouches[0].clientX - swipeX
                          el.style.transform = ''
                          el.style.transition = 'transform .2s ease'
                          if (Math.abs(dx) > 50) {
                            setReplyTo({ id: msg.id, username: msg.username, text: msg.text })
                            setTimeout(() => inputRef.current?.focus(), 100)
                          }
                          setSwipingMsgId(null)
                        }}
                      >
                        {!isMe && !sameUser && (
                          <div className="gc-avatar" style={{ background: avatarColor(msg.uid) }}>
                            {(userAvatarCache[msg.uid] || msg.photoURL) ? (
                              /\.(mp4|webm|mov)(\?|$)/i.test(userAvatarCache[msg.uid] || msg.photoURL)
                                ? <VideoAvatar src={userAvatarCache[msg.uid] || msg.photoURL} />
                                : <img src={userAvatarCache[msg.uid] || msg.photoURL} alt="" className="gc-avatar-img"/>
                            ) : msg.username[0].toUpperCase()}
                          </div>
                        )}
                        {!isMe && sameUser && <div className="gc-avatar-spacer"/>}
                        <div className="gc-msg-content" style={{ position: 'relative' }}>
                          {!isMe && !sameUser && <div className="gc-msg-username">{msg.username}</div>}
                          {msg.type === 'sticker' && msg.stickerUrl ? (
                            <img src={msg.stickerUrl} alt="sticker" className="gc2-sticker"/>
                          ) : (
                            <div className={`gc-bubble ${isMe?'gc-bubble-me':'gc-bubble-other'}`}>
                              {msg.replyToUser && (
                                <div className="gc-reply-quote">
                                  <div className="gc-reply-quote-bar"/>
                                  <div>
                                    <div className="gc-reply-quote-user">↩ {msg.replyToUser}</div>
                                    <div className="gc-reply-quote-text">{msg.replyToText}</div>
                                  </div>
                                </div>
                              )}
                              <span className="gc-bubble-text">{msg.text.split(/(@\w+)/g).map((part, pi) =>
                                /^@\w+$/.test(part)
                                  ? <span key={pi} className="gc-mention-highlight">{part}</span>
                                  : part
                              )}</span>
                              <span className="gc-bubble-time">{fmtTime(msg.createdAt)}</span>
                            </div>
                          )}
                          {canDelete && (
                            <div className={`gc-msg-actions ${isMe ? 'gc-msg-actions-me' : 'gc-msg-actions-other'}`}>
                              <button
                                className="gc-msg-dots"
                                onClick={() => setMsgMenuId(msgMenuId === msg.id ? null : msg.id)}
                                aria-label="Opsi pesan"
                              >⋮</button>
                              {msgMenuId === msg.id && (
                                <div className={`gc-msg-menu ${isMe ? 'gc-msg-menu-me' : 'gc-msg-menu-other'}`}>
                                  <button onClick={() => handleDeleteMsg(msg.id, msg.uid)}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                    Hapus Pesan
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                      </>
                    )
                  })()}
                  {typingUsers.length > 0 && (
                    <div className="gc2-typing-row">
                      <div className="gc2-typing-bubble">
                        <span className="gc2-typing-dots"><span/><span/><span/></span>
                        <span className="gc2-typing-text">{typingUsers.join(', ')} sedang mengetik...</span>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef}/>
                </div>

                {/* Scroll to bottom button */}
                {showScrollDown && (
                  <button
                    className={`gc-scroll-down-btn${hasNewMsg ? ' gc-scroll-down-new' : ''}`}
                    onClick={() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }); setShowScrollDown(false); setHasNewMsg(false) }}
                    aria-label="Scroll ke bawah"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                    {hasNewMsg && <span>Pesan Baru</span>}
                  </button>
                )}

                <div className="gc-input-area">
                  {/* Music Player */}
                  {(nowPlaying || autoplayLoading) && (
                    <div className="gc-now-playing">
                      <div className="gc-now-playing-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        {autoplayLoading ? 'Loading...' : 'Now Playing'}
                      </div>
                      <div className="gc-now-playing-title">
                        {autoplayLoading ? <span style={{opacity:0.5}}>🔄 Mencari lagu berikutnya...</span> : nowPlaying?.title}
                      </div>
                      {/* Music Visualizer bars */}
                      {gcMusicVisualizer && gcMusicPlaying && !autoplayLoading && (
                        <div className="gc-music-visualizer" aria-hidden="true">
                          <span/><span/><span/><span/><span/>
                        </div>
                      )}
                      {/* Autoplay toggle */}
                      <button
                        className="gc-now-playing-close"
                        title={autoplayEnabled ? 'Autoplay ON (klik untuk OFF)' : 'Autoplay OFF (klik untuk ON)'}
                        style={{color: autoplayEnabled ? '#c8f500' : 'rgba(255,255,255,0.25)', fontSize:12, marginRight:2}}
                        onClick={() => {
                          const next = !autoplayEnabled
                          setAutoplayEnabled(next)
                          localStorage.setItem('kyoko_autoplay', next ? 'true' : 'false')
                        }}
                      >
                        {autoplayEnabled ? '🔁' : '➡️'}
                      </button>
                      <button className="gc-now-playing-close" onClick={handleStopGcMusic}>✕</button>
                    </div>
                  )}

                  {/* Music Search Panel */}
                  {showMusicSearch && (
                    <div className="gc-music-panel">
                      <div className="gc-music-header">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        <span>SOUNDCLOUD MUSIC</span>
                        <button onClick={() => { setShowMusicSearch(false); setMusicResults([]); setGcMusicError('') }}>✕</button>
                      </div>
                      {/* Admin API URL setting */}
                      {isAdmin && (
                        <div style={{padding:'6px 8px', borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                          {!showMusicApiEdit ? (
                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button className="gc-music-api-btn" onClick={() => { setShowMusicApiEdit(true); setMusicApiInput(gcMusicApiUrl) }}>
                                🔧 Ganti API URL
                              </button>
                              <button className="gc-music-api-btn" onClick={() => {
                                const next = musicQueryParam === 'query' ? 'q' : 'query'
                                setMusicQueryParam(next)
                                localStorage.setItem('kyoko_music_param', next)
                              }} style={{background: musicQueryParam === 'q' ? 'rgba(100,220,100,0.15)' : 'rgba(200,245,0,0.08)'}}>
                                🔁 Param: <b>?{musicQueryParam}=</b>
                              </button>
                            </div>
                          ) : (
                            <div style={{display:'flex',gap:6}}>
                              <input className="gc-music-input" style={{fontSize:11}} type="text" value={musicApiInput} onChange={e=>setMusicApiInput(e.target.value)} placeholder="https://api-faa.my.id/faa/soundcloud-play" />
                              <button className="gc-music-search-btn" onClick={handleSaveMusicApi}>✓</button>
                              <button className="gc-music-search-btn" onClick={() => setShowMusicApiEdit(false)} style={{background:'rgba(255,50,50,0.1)'}}>✕</button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="gc-music-search-row">
                        <input
                          className="gc-music-input"
                          type="text"
                          placeholder="Cari lagu di SoundCloud..."
                          value={musicQuery}
                          onChange={e => setMusicQuery(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleMusicSearch()}
                        />
                        <button className="gc-music-search-btn" onClick={handleMusicSearch} disabled={musicSearching}>
                          {musicSearching ? <span className="gc-spinner-sm"/> : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                          )}
                        </button>
                      </div>
                      {gcMusicError && <div style={{fontSize:11,color:'#ff6b6b',padding:'4px 8px'}}>{gcMusicError}</div>}
                      {musicResults.length > 0 && (
                        <div className="gc-music-results">
                          {musicResults.map((v, i) => (
                            <div key={i} className="gc-music-item" onClick={() => handlePlayGcMusic(v)}>
                              {v.thumbnail ? (
                                <div className="gc-music-thumb">
                                  <img src={v.thumbnail} alt={v.title} />
                                  <div className="gc-music-play-icon">▶</div>
                                </div>
                              ) : (
                                <div className="gc-music-thumb" style={{background:'rgba(200,245,0,0.1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                  <span style={{fontSize:20}}>🎵</span>
                                </div>
                              )}
                              <div className="gc-music-info">
                                <div className="gc-music-title">{v.title}</div>
                                <div className="gc-music-channel">
                                  {v.user}
                                  {detectMusicCategory(v.title) && (
                                    <span style={{marginLeft:5, background:'rgba(200,245,0,0.15)', color:'#c8f500', fontSize:9, padding:'1px 5px', borderRadius:4, fontWeight:700, textTransform:'uppercase'}}>
                                      {detectMusicCategory(v.title)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Avatar Picker */}
                  {/* Sticker Picker */}
                  {showStickerPicker && (
                    <div className="gc-avatar-picker">
                      <div className="gc-music-header">
                        <span>🎭 STICKER</span>
                        <button onClick={() => { setShowStickerPicker(false); setShowStickerSearch(false); setStickerSearchResults([]); setStickerSearchPreview(null) }}>✕</button>
                      </div>

                      {/* Admin toolbar — hanya tampil saat bukan mode search */}
                      {isAdmin && !showStickerSearch && (
                        <div style={{padding:'8px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', flexDirection:'column', gap:6}}>
                          <div style={{display:'flex', gap:6}}>
                            <input className="gc-music-input" type="url" placeholder="Link sticker (termai/github/imgbb...)"
                              value={adminStickerInput} onChange={e => setAdminStickerInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAdminUploadSticker()}/>
                            <button className="gc-music-search-btn" onClick={handleAdminUploadSticker}>+</button>
                          </div>
                          <div style={{display:'flex', gap:6}}>
                            <button onClick={() => { setShowStickerSearch(true); setStickerDeleteMode(false) }}
                              style={{flex:1, background:'rgba(200,245,0,0.08)', border:'1px solid rgba(200,245,0,0.2)', color:'rgba(200,245,0,0.85)', borderRadius:8, padding:'6px', fontSize:11, fontWeight:700, cursor:'pointer'}}>
                              🔍 Cari Stiker GIF
                            </button>
                            <button onClick={() => setStickerDeleteMode(p => !p)}
                              style={{flex:1, background: stickerDeleteMode ? 'rgba(255,60,60,0.12)' : 'rgba(255,255,255,0.05)', border: stickerDeleteMode ? '1px solid rgba(255,60,60,0.35)' : '1px solid rgba(255,255,255,0.1)', color: stickerDeleteMode ? '#ff8080' : 'rgba(255,255,255,0.4)', borderRadius:8, padding:'6px', fontSize:11, fontWeight:700, cursor:'pointer'}}>
                              {stickerDeleteMode ? '🔒 Hapus: ON' : '🗑 Hapus: OFF'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ── MODE SEARCH ── */}
                      {isAdmin && showStickerSearch && (
                        <div style={{display:'flex', flexDirection:'column'}}>
                          <div style={{display:'flex', gap:6, padding:'8px', borderBottom:'1px solid rgba(255,255,255,0.05)', alignItems:'center'}}>
                            <button onClick={() => { setShowStickerSearch(false); setStickerSearchResults([]); setStickerSearchPreview(null) }}
                              style={{background:'none', border:'none', color:'rgba(255,255,255,0.5)', fontSize:18, cursor:'pointer', lineHeight:1, padding:'0 2px'}}>←</button>
                            <input className="gc-music-input" placeholder="Cari GIF stiker..." value={stickerSearchQuery}
                              onChange={e => setStickerSearchQuery(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleStickerSearch()} style={{flex:1}} autoFocus/>
                            <button className="gc-music-search-btn" onClick={handleStickerSearch} disabled={stickerSearchLoading}>
                              {stickerSearchLoading ? '⏳' : '🔍'}
                            </button>
                          </div>
                          {stickerSearchPreview ? (
                            <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:10, padding:16}}>
                              <img src={stickerSearchPreview.url} alt={stickerSearchPreview.title}
                                style={{width:130, height:130, objectFit:'contain', borderRadius:14, background:'rgba(255,255,255,0.04)'}}/>
                              <div style={{display:'flex', gap:8, width:'100%'}}>
                                <button onClick={() => setStickerSearchPreview(null)}
                                  style={{flex:1, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', borderRadius:8, padding:'8px', fontSize:12, cursor:'pointer'}}>
                                  ← Kembali
                                </button>
                                <button onClick={() => handleAddStickerFromSearch(stickerSearchPreview!.url)}
                                  style={{flex:1, background:'rgba(200,245,0,0.15)', border:'1px solid rgba(200,245,0,0.3)', color:'rgba(200,245,0,0.95)', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer'}}>
                                  ✓ Tambah
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, padding:8, maxHeight:240, overflowY:'auto', overflowX:'hidden'}}>
                              {stickerSearchResults.length === 0 && !stickerSearchLoading && (
                                <div style={{gridColumn:'span 4', textAlign:'center', color:'rgba(255,255,255,0.3)', fontSize:12, padding:'20px 0'}}>
                                  {stickerSearchQuery ? 'Tidak ada hasil' : 'Ketik lalu tekan 🔍'}
                                </div>
                              )}
                              {stickerSearchResults.map((s, i) => (
                                <div key={i} onClick={() => setStickerSearchPreview(s)}
                                  style={{cursor:'pointer', borderRadius:10, overflow:'hidden', border:'1px solid rgba(255,255,255,0.08)', aspectRatio:'1/1', display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.03)'}}>
                                  <img src={s.url} alt={s.title} style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}}/>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── GRID PRESET STIKER (hidden saat mode search) ── */}
                      {!showStickerSearch && (
                        <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, padding:10, maxHeight:260, overflowY:'auto', overflowX:'hidden'}}>
                          {stickerList.filter(s => isAdmin || s.enabled).length === 0 && (
                            <div style={{color:'rgba(255,255,255,0.3)', fontSize:12, padding:'20px 0', textAlign:'center', gridColumn:'span 4'}}>
                              {isAdmin ? 'Belum ada sticker. Upload dulu!' : 'Admin belum upload sticker.'}
                            </div>
                          )}
                          {stickerList.filter(s => isAdmin || s.enabled).map(s => (
                            <div key={s.id} style={{position:'relative', aspectRatio:'1/1', borderRadius:12, overflow:'hidden', cursor:'pointer', border:'1px solid rgba(255,255,255,0.07)', opacity: s.enabled ? 1 : 0.4, flexShrink:0}}
                              onClick={() => !stickerDeleteMode && handleSendSticker(s.url)}>
                              <img src={s.url} alt="sticker" style={{width:'100%', height:'100%', objectFit:'cover', display:'block', borderRadius:12}}/>
                              {isAdmin && stickerDeleteMode && (
                                <button className="gc-avatar-del" style={{background:'#ff3b3b'}} onClick={e => { e.stopPropagation(); handleAdminDeleteSticker(s.id) }}>✕</button>
                              )}
                              {isAdmin && !stickerDeleteMode && (
                                <button className="gc-avatar-del"
                                  style={{background: s.enabled ? 'rgba(200,245,0,0.9)' : 'rgba(100,100,100,0.9)', color: s.enabled ? '#000' : '#fff', fontSize:8, width:18, height:18}}
                                  onClick={e => { e.stopPropagation(); handleToggleStickerEnabled(s.id, s.enabled) }}>
                                  {s.enabled ? '✓' : '✗'}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {showAvatarPicker && (
                    <div className="gc-avatar-picker">
                      <div className="gc-music-header">
                        <span>PILIH AVATAR</span>
                        <button onClick={() => setShowAvatarPicker(false)}>✕</button>
                      </div>
                      {isAdmin && (
                        <div className="gc-avatar-admin-row">
                          <input className="gc-music-input" type="url" placeholder="Link avatar (termai/github/imgbb...)"
                            value={adminAvatarInput} onChange={e => setAdminAvatarInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAdminUploadAvatar()}/>
                          <button className="gc-music-search-btn" onClick={handleAdminUploadAvatar}>+</button>
                        </div>
                      )}
                      {gachaData && (gachaData as any).hasPremiumPass && (
                        <div style={{padding:'8px', borderBottom:'1px solid rgba(255,215,0,0.1)'}}>
                          <button onClick={() => setShowVideoAvatarInput(p => !p)}
                            style={{width:'100%', background:'rgba(255,215,0,0.08)', border:'1px solid rgba(255,215,0,0.25)', color:'#ffd700', borderRadius:8, padding:'6px 10px', fontSize:11, fontWeight:700, cursor:'pointer'}}>
                            👑 Avatar Video (Premium)
                          </button>
                          {showVideoAvatarInput && (
                            <div style={{marginTop:8, display:'flex', flexDirection:'column', gap:8}}>
                              <input className="gc-music-input" type="url" placeholder="Link video avatar (.mp4, maks 5 detik)"
                                value={videoAvatarInput} onChange={e => setVideoAvatarInput(e.target.value)}/>
                              {videoAvatarInput.trim() && (
                                <video src={videoAvatarInput.trim()} autoPlay loop muted playsInline
                                  style={{width:80, height:80, objectFit:'cover', borderRadius:40, border:'2px solid #ffd700', alignSelf:'center'}}/>
                              )}
                              <button onClick={async () => {
                                const url = videoAvatarInput.trim(); if (!url || !user) return
                                await updateDoc(doc(dbChat, 'chatUsers', user.uid), { photoURL: url }).catch(() => {})
                                setShowVideoAvatarInput(false); setVideoAvatarInput(''); setShowAvatarPicker(false)
                              }} style={{background:'rgba(255,215,0,0.15)', border:'1px solid rgba(255,215,0,0.3)', color:'#ffd700', borderRadius:8, padding:'7px', fontSize:12, fontWeight:700, cursor:'pointer'}}>
                                ✓ Pakai Avatar Video Ini
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="gc-avatar-grid">
                        {avatarList.length === 0 && (
                          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, padding: '12px 0', textAlign: 'center', gridColumn: 'span 4' }}>
                            {isAdmin ? 'Belum ada avatar. Upload dulu!' : 'Admin belum upload avatar.'}
                          </div>
                        )}
                        {avatarList.map(av => (
                          <div key={av.id} className="gc-avatar-item" onClick={() => handlePickAvatar(av.url)}>
                            <img src={av.url} alt="avatar" />
                            {isAdmin && (
                              <button className="gc-avatar-del" onClick={e => { e.stopPropagation(); handleAdminDeleteAvatar(av.id) }}>✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="gc-input-wrap" style={{ position: 'relative', flexDirection:'column', gap:0, padding: replyTo ? '0' : '2px 2px 2px 12px' }}>
                    {replyTo && (
                      <div className="gc-reply-indicator">
                        <div className="gc-reply-indicator-bar"/>
                        <div className="gc-reply-indicator-content">
                          <span className="gc-reply-indicator-user">↩️ {replyTo.username}</span>
                          <span className="gc-reply-indicator-text">{replyTo.text.slice(0, 50)}{replyTo.text.length>50?'...':''}</span>
                        </div>
                        <button className="gc-reply-indicator-close" onClick={() => setReplyTo(null)}>✕</button>
                      </div>
                    )}
                    <div style={{display:'flex',gap:8,alignItems:'center',padding: replyTo ? '2px 2px 2px 12px' : '0', flex:1, width:'100%'}}>
                    <button
                      className="gc-input-icon-btn"
                      onClick={() => { setShowMusicSearch(p => !p); setShowAvatarPicker(false); setShowStickerPicker(false) }}
                      title="Cari Musik"
                      type="button"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                    </button>
                    <button
                      className="gc-input-icon-btn"
                      onClick={() => { setShowAvatarPicker(p => !p); setShowMusicSearch(false); setShowStickerPicker(false) }}
                      title="Ganti Avatar"
                      type="button"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    </button>
                    <button
                      className={`gc-input-icon-btn ${showStickerPicker ? 'gc-input-icon-btn-active' : ''}`}
                      onClick={() => { setShowStickerPicker(p => !p); setShowMusicSearch(false); setShowAvatarPicker(false) }}
                      title="Sticker"
                      type="button"
                    >
                      <span style={{fontSize:14}}>🎭</span>
                    </button>
                    {/* @mention dropdown */}
                    {showMention && getMentionSuggestions().length > 0 && (
                      <div className="gc-mention-dropdown">
                        {getMentionSuggestions().map((m, i) => (
                          <div
                            key={m.uid}
                            className={`gc-mention-item ${i === mentionIndex ? 'gc-mention-item-active' : ''}`}
                            onMouseDown={e => { e.preventDefault(); handleMentionSelect(m.username) }}
                          >
                            <div className="gc-mention-av" style={{ background: avatarColor(m.uid) }}>
                              {(userAvatarCache[m.uid] || m.photoURL)
                                ? <img src={userAvatarCache[m.uid] || m.photoURL} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                                : m.username[0].toUpperCase()}
                            </div>
                            <span>@{m.username}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <input ref={inputRef} className="gc-input" type="text" placeholder="Tulis pesan... (@mention)" value={input} maxLength={300}
                      onChange={handleInputChange}
                      onKeyDown={e => {
                        if (showMention && getMentionSuggestions().length > 0) {
                          if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i+1, getMentionSuggestions().length-1)) }
                          if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i-1, 0)) }
                          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleMentionSelect(getMentionSuggestions()[mentionIndex]?.username || ''); return }
                          if (e.key === 'Escape') { setShowMention(false); return }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) handleSend()
                      }}/>
                    <button className={`gc-send-btn ${input.trim()&&!sending?'active':''}`} onClick={handleSend} disabled={!input.trim()||sending}>
                      {sending ? <span className="gc-spinner-sm"/> : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                      )}
                    </button>
                    </div>
                  </div>
                  {/* Moderasi panel sudah dipindah ke Group Info */}
                  <div className="gc-input-info">
                    <span>Login sebagai <strong style={{color:'#c8f500'}}>{username}</strong></span>
                    <span>{input.length}/300</span>
                  </div>
                </div>
              </>
            )}

            {/* ── RPG TAB ── */}
            {activeTab === 'rpg' && activeGachaTab === 'rpg' && (
              <Suspense fallback={
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12,color:'rgba(255,255,255,0.4)'}}>
                  <div style={{fontSize:32}}>⚔️</div>
                  <div style={{fontSize:13}}>Memuat RPG...</div>
                </div>
              }>
                <GameRpg
                  rpgChar={rpgChar}
                rpgView={rpgView}
                setRpgView={setRpgView}
                battleState={battleState}
                setBattleState={setBattleState}
                dungeonState={dungeonState}
                setDungeonState={setDungeonState}
                gachaData={gachaData}
                gachaView={gachaView}
                setGachaView={setGachaView}
                gachaResult={gachaResult}
                setGachaResult={setGachaResult}
                gachaAnim={gachaAnim}
                showClassChange={showClassChange}
                setShowClassChange={setShowClassChange}
                leaderboard={leaderboard}
                rpgLoading={rpgLoading}
                loadingActive={loadingActive}
                loadingBar={loadingBar}
                autoBattle={autoBattle}
                onToggleAuto={() => { setAutoBattle(v => !v); autoBattleRef.current = !autoBattleRef.current }}
                isAppOnline={isAppOnline}
                pendingTransferCount={pendingTransferCount}
                shopMsg={shopMsg}
                questMsg={questMsg}
                questClaimMsg={questClaimMsg}
                mineMsg={mineMsg}
                craftMsg={craftMsg}
                farmMsg={farmMsg}
                cookMsg={cookMsg}
                trainMsg={trainMsg}
                duelMsg={duelMsg}
                duelLoading={duelLoading}
                wildQuest={wildQuest}
                wildQuestMsg={wildQuestMsg}
                investMsg={investMsg}
                investInput={investInput}
                setInvestInput={setInvestInput}
                transferMsg={transferMsg}
                transferTarget={transferTarget}
                setTransferTarget={setTransferTarget}
                transferAmount={transferAmount}
                setTransferAmount={setTransferAmount}
                weaponMsg={weaponMsg}
                bpClaimMsg={bpClaimMsg}
                createCharacter={createCharacter}
                startBattle={startBattle}
                endBattle={endBattle}
                acceptQuest={acceptQuest}
                cancelQuest={cancelQuest}
                claimQuest={claimQuest}
                buyItem={buyItem}
                changeClass={changeClass}
                startDungeon={startDungeon}
                endDungeon={endDungeon}
                handleDungeonWin={handleDungeonWin}
                setParty={setParty}
                claimDailyMission={claimDailyMission}
                sellInventoryItem={sellInventoryItem}
                fetchLeaderboard={fetchLeaderboard}
                doMine={doMine}
                endMineSession={endMineSession}
                doCraft={doCraft}
                doPlant={doPlant}
                doHarvest={doHarvest}
                doCook={doCook}
                doTrain={doTrain}
                doDuel={doDuel}
                rollWildQuest={rollWildQuest}
                claimWildQuest={claimWildQuest}
                doInvest={doInvest}
                claimInvestment={claimInvestment}
                doWeaponUpgrade={doWeaponUpgrade}
                doTransfer={doTransfer}
                doGachaPull={doGachaPull}
                doCharLevelUp={doCharLevelUp}
                onBuyRequest={() => setShowBpBuyConfirm(true)}
                claimBattlePassTier={claimBattlePassTier}
                setActiveTab={setActiveTab}
              />
              </Suspense>
            )}

            {/* ── GACHA TAB ── */}
            {activeTab === 'rpg' && activeGachaTab === 'gacha' && (
              <div className="gc2-rpg-wrap">
                {gachaAnim && (
                  <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.95)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,flexDirection:'column',gap:16}}>
                    <div style={{fontSize:60,animation:'gachaSpin 0.8s ease-in-out'}}>✨</div>
                    <div style={{fontSize:16,color:'#ffd700',fontWeight:800,letterSpacing:2,animation:'fadeInUp .4s'}}>運命を引く...</div>
                  </div>
                )}
                {gachaResult && (
                  <GachaResultScreen results={gachaResult} onClose={() => setGachaResult(null)} roster={gachaData?.roster||[]} constellations={gachaData?.constellations??{}}/>
                )}
                {!gachaResult && !gachaAnim && (
                  <>
                    {!gachaData && <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200,color:'rgba(255,255,255,0.3)',fontSize:13}}>Memuat data gacha...</div>}
                    {gachaData && gachaView === 'home' && <GachaHome data={gachaData} onBanner={()=>setGachaView('banner')} onRoster={()=>setGachaView('roster')} onEvents={()=>setGachaView('events')} onPass={()=>setGachaView('pass')}/>}
                    {gachaData && gachaView === 'banner' && <GachaBanner data={gachaData} onPull={doGachaPull} onBack={()=>setGachaView('home')}/>}
                    {gachaData && gachaView === 'roster' && <GachaRoster data={gachaData} onBack={()=>setGachaView('home')} onLevelUp={doCharLevelUp}/>}
                    {gachaView === 'events' && <GachaEvents onBack={()=>setGachaView('home')}/>}
                    {gachaData && gachaView === 'pass' && <GachaPass data={gachaData} rpgChar={rpgChar} onBack={()=>setGachaView('home')} onBuyRequest={() => setShowBpBuyConfirm(true)} onClaimTier={claimBattlePassTier} bpClaimMsg={bpClaimMsg}/>}
                  </>
                )}
              </div>
            )}

            {/* ── FISHING TAB ── */}
            {activeTab === 'fishing' && (
              <div className="gc2-rpg-wrap" style={{overflowY:'auto'}}>
                <FishingPanel
                  uid={user?.uid || ''}
                  rpgChar={rpgChar}
                  fishingData={fishingData}
                  setFishingData={setFishingData}
                  fishingView={fishingView}
                  setFishingView={setFishingView}
                  fishingPhase={fishingPhase}
                  setFishingPhase={setFishingPhase}
                  fishingProgress={fishingProgress}
                  setFishingProgress={setFishingProgress}
                  fishingTarget={fishingTarget}
                  setFishingTarget={setFishingTarget}
                  fishingTargetWidth={fishingTargetWidth}
                  setFishingTargetWidth={setFishingTargetWidth}
                  fishingResult={fishingResult}
                  setFishingResult={setFishingResult}
                  fishingMissed={fishingMissed}
                  setFishingMissed={setFishingMissed}
                  fishingLocation={fishingLocation}
                  setFishingLocation={setFishingLocation}
                  fishingMsg={fishingMsg}
                  setFishingMsg={setFishingMsg}
                  fishingHearts={fishingHearts}
                  setFishingHearts={setFishingHearts}
                  fishingIntervalRef={fishingIntervalRef}
                  fishingWaitRef={fishingWaitRef}
                  onGoldChange={async (newGold:number) => {
                    if (!rpgChar || !user) return
                    const updated = {...rpgChar, gold:newGold}
                    setRpgChar(updated)
                    await updateDoc(doc(getRpgDb(user.uid),'rpgChars',user.uid),{gold:newGold})
                  }}
                  onFishCaught={() => {
                    if (!gachaData || !user) return
                    const curMats = gachaData.charMats ?? { fish:0, ore:0, herb:0 }
                    const newMats = { ...curMats, fish: curMats.fish + 1 }
                    updateDoc(doc(getRpgDb(user.uid), 'playerGacha', user.uid), { charMats: newMats }).catch(console.error)
                    setGachaData(prev => prev ? { ...prev, charMats: newMats } : prev)
                  }}
                  onBack={() => { setActiveTab('rpg'); setFishingView('home') }}
                />
              </div>
            )}

            {/* ── OFFLINE GAMES TAB ── */}
            {(activeTab as string) === 'offline' && (
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#0a0a12'}}>
                {offlineSelectedGame === null ? (
                  <OfflineGamesMenu
                    onSelectGame={(id) => setOfflineSelectedGame(id)}
                    onBack={() => setActiveTab('chat')}
                  />
                ) : offlineSelectedGame === 'catur' ? (
                  <CaturGame onBack={() => setOfflineSelectedGame(null)} />
                ) : offlineSelectedGame === 'snake' ? (
                  <SnakeGame onBack={() => setOfflineSelectedGame(null)} />
                ) : offlineSelectedGame === 'ttt' ? (
                  <TicTacToeGame onBack={() => setOfflineSelectedGame(null)} />
                ) : offlineSelectedGame === 'memory' ? (
                  <MemoryCardGame onBack={() => setOfflineSelectedGame(null)} />
                ) : null}
              </div>
            )}

            {/* ── PLANET TAB ── */}
            {activeTab === 'rpg' && activeGachaTab === 'planet' && (
              <div className="gc2-rpg-wrap" style={{overflowY:'hidden',display:'flex',flexDirection:'column',padding:0}}>
                <PlanetPanel
                  uid={user?.uid || ''}
                  username={username}
                  gold={rpgChar?.gold || 0}
                  onGoldChange={async (newGold: number) => {
                    if (!rpgChar || !user) return
                    const updated = { ...rpgChar, gold: newGold }
                    setRpgChar(updated)
                    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { gold: newGold })
                  }}
                  onBack={() => setActiveGachaTab('rpg')}
                />
              </div>
            )}

          </div>
        )}

        {/* ── GROUP INFO PANEL (tap icon grup) ── */}
        {showGroupInfo && (
          <div className="gc-group-info-panel gc2-fadein">
            <div className="gc-group-info-header">
              <button className="gc2-rpg-btn secondary" onClick={() => setShowGroupInfo(false)} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
              {isAdmin && (
                <button className="gc2-rpg-btn primary" onClick={() => { setShowGroupInfo(false); setShowGroupSettings(true) }} style={{ padding:'6px 12px', fontSize:12 }}>⚙ Edit</button>
              )}
            </div>
            <div className="gc-group-info-body">
              <div className="gc-group-info-icon-wrap">
                <div className="gc-group-info-icon">
                  {groupInfo?.iconUrl
                    ? <img src={groupInfo.iconUrl} alt="group" />
                    : <span style={{ fontSize: 40 }}>💬</span>}
                </div>
                <div className="gc-group-info-ring" />
              </div>
              <div className="gc-group-info-name">{groupInfo?.name || 'KyokoMd Global'}</div>
              <div className="gc-group-info-meta">
                Grup · <span style={{ color: '#c8f500' }}>{groupInfo?.members?.length || 0} anggota</span>
              </div>
              {groupInfo?.desc && (
                <div className="gc-group-info-desc">
                  <div className="gc-group-info-desc-label">📋 Deskripsi</div>
                  <div className="gc-group-info-desc-text">{groupInfo.desc}</div>
                </div>
              )}

              {/* Custom notification sound */}
              <div className="gc-notif-sound-wrap">
                <div className="gc-notif-sound-label">🔔 Suara Notifikasi Pesan</div>
                {!showSoundPicker ? (
                  <div className="gc-notif-sound-row">
                    <span className="gc-notif-sound-current">
                      {notifSound ? '🎵 Custom aktif' : '🔕 Default (mati)'}
                    </span>
                    <button className="gc-notif-sound-btn" onClick={() => setShowSoundPicker(true)}>
                      ✏️ Ubah
                    </button>
                    {notifSound && (
                      <button className="gc-notif-sound-btn danger" onClick={() => { setNotifSound(''); localStorage.removeItem('kyoko_notif_sound'); notifAudioRef.current = null }}>
                        🗑
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="gc-notif-sound-editor">
                    <input
                      className="gc2-field-input"
                      type="url"
                      placeholder="Link audio .mp3/.ogg (termai, github, dll)..."
                      value={soundInput}
                      onChange={e => setSoundInput(e.target.value)}
                    />
                    <div style={{display:'flex',gap:6,marginTop:6}}>
                      <button className="gc2-rpg-btn primary" style={{flex:1,fontSize:11,padding:'6px'}} onClick={() => {
                        const url = soundInput.trim()
                        if (!url) return
                        setNotifSound(url)
                        localStorage.setItem('kyoko_notif_sound', url)
                        notifAudioRef.current = null
                        // Test play
                        const a = new Audio(url); a.volume = 0.6; a.play().catch(()=>{})
                        setShowSoundPicker(false); setSoundInput('')
                      }}>✅ Simpan & Test</button>
                      <button className="gc2-rpg-btn secondary" style={{fontSize:11,padding:'6px 10px'}} onClick={() => setShowSoundPicker(false)}>Batal</button>
                    </div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:4}}>
                      💡 Cari audio di termai.cc, github raw, atau cloudinary
                    </div>
                  </div>
                )}
              </div>
              <div className="gc-group-info-members-label">👥 Anggota</div>
              {/* Member Search */}
              <div style={{width:'100%', marginTop:6, marginBottom:6}}>
                <input
                  className="gc-music-input"
                  style={{width:'100%', boxSizing:'border-box'}}
                  placeholder="🔍 Cari member..."
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                />
              </div>
              <div className="gc-group-info-members">
                {memberList.filter(m => m.username.toLowerCase().includes(memberSearch.toLowerCase())).map(m => {
                  const canManage = isAdmin && !m.isOwner && m.uid !== user?.uid
                  const menuOpen = memberMenuId === m.uid
                  return (
                    <div key={m.uid} className="gc-group-info-member" style={{position:'relative'}}>
                      <div className="gc-group-info-member-av" style={{ background: avatarColor(m.uid) }}>
                        {(userAvatarCache[m.uid] || m.photoURL)
                          ? <img src={userAvatarCache[m.uid] || m.photoURL} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', borderRadius:'50%' }} />
                          : m.username[0].toUpperCase()}
                      </div>
                      <span className="gc-group-info-member-name">{m.username}</span>
                      {m.isOwner && <span className="gc-group-info-badge owner">👑</span>}
                      {!m.isOwner && m.isAdmin && <span className="gc-group-info-badge admin">⭐</span>}
                      {canManage && (
                        <div style={{position:'relative'}}>
                          <button
                            style={{background:'none',border:'none',color:'rgba(255,255,255,0.35)',fontSize:18,cursor:'pointer',padding:'0 4px',lineHeight:1}}
                            onClick={() => setMemberMenuId(menuOpen ? null : m.uid)}
                          >⋮</button>
                          {menuOpen && (
                            <div style={{position:'absolute',right:0,top:24,background:'#1a1a1a',border:'1px solid rgba(200,245,0,0.2)',borderRadius:10,padding:4,zIndex:50,minWidth:160,boxShadow:'0 8px 24px rgba(0,0,0,0.6)'}}>
                              {!m.isAdmin ? (
                                <button onClick={() => handlePromoteAdmin(m.uid)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:'#c8f500',fontSize:12,fontWeight:700,padding:'7px 12px',cursor:'pointer',borderRadius:7,width:'100%'}}>
                                  ⭐ Jadikan Admin
                                </button>
                              ) : (
                                <button onClick={() => handleDemoteAdmin(m.uid)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:'#ffd700',fontSize:12,fontWeight:700,padding:'7px 12px',cursor:'pointer',borderRadius:7,width:'100%'}}>
                                  ↓ Turunkan Admin
                                </button>
                              )}
                              <button onClick={() => handleKickMember(m.uid)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:'#ff5555',fontSize:12,fontWeight:700,padding:'7px 12px',cursor:'pointer',borderRadius:7,width:'100%'}}>
                                🚪 Kick Member
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Moderasi section - visible to all, editable only by admin */}
              <div style={{width:'100%', marginTop:16}}>
                <div style={{fontSize:11, fontWeight:800, color:'rgba(255,255,255,0.3)', letterSpacing:.5, marginBottom:8}}>🛡️ MODERASI GRUP</div>
                <div style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:'10px 12px', display:'flex', flexDirection:'column', gap:8}}>
                  {[
                    {key:'antiLinkAll' as const, label:'🔗 Anti Link All', desc:'Blokir semua link'},
                    {key:'antiLinkWa' as const, label:'📱 Anti Link WA', desc:'Blokir link WhatsApp'},
                    {key:'antiPromo' as const, label:'📢 Anti Promosi', desc:'Blokir pesan promosi'},
                    {key:'antiBadword' as const, label:'🤬 Anti Badword', desc:'Blokir kata kasar'},
                  ].map(item => (
                    <div key={item.key} style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                      <div>
                        <div style={{fontSize:12, color:'#f0f0f0', fontWeight:600}}>{item.label}</div>
                        <div style={{fontSize:10, color:'rgba(255,255,255,0.35)'}}>{item.desc}</div>
                      </div>
                      {isAdmin ? (
                        <button className={`gc-moderasi-toggle ${moderasi[item.key]?'on':''}`} onClick={() => handleToggleModerasiField(item.key)}>
                          {moderasi[item.key] ? 'ON' : 'OFF'}
                        </button>
                      ) : (
                        <span style={{fontSize:16}}>{moderasi[item.key] ? '✅' : '❌'}</span>
                      )}
                    </div>
                  ))}
                  {/* Badwords list - admin only */}
                  {moderasi.antiBadword && isAdmin && (
                    <div style={{paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                      <div style={{fontSize:10, color:'rgba(255,255,255,0.35)', marginBottom:6}}>Kata terlarang:</div>
                      <div className="gc-moderasi-tags">
                        {moderasi.badwords.map(w => (
                          <span key={w} className="gc-moderasi-tag">
                            {w}
                            <button onClick={() => handleRemoveBadword(w)}>✕</button>
                          </span>
                        ))}
                      </div>
                      <div style={{display:'flex', gap:6, marginTop:6}}>
                        <input className="gc-music-input" style={{flex:1}} placeholder="Tambah kata..." value={badwordInput} onChange={e => setBadwordInput(e.target.value)} onKeyDown={e => e.key==='Enter' && handleAddBadword()}/>
                        <button className="gc-music-search-btn" onClick={handleAddBadword}>+</button>
                      </div>
                    </div>
                  )}
                  {/* Auto-clear section */}
                  <div style={{paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
                      <div>
                        <div style={{fontSize:12, color:'#f0f0f0', fontWeight:600}}>🧹 Auto Clear Chat</div>
                        <div style={{fontSize:10, color:'rgba(255,255,255,0.35)'}}>Hapus semua pesan otomatis</div>
                      </div>
                    </div>
                    {isAdmin ? (
                      <>
                        <div style={{display:'flex', gap:6, marginBottom:8}}>
                          {(['off','daily','weekly'] as const).map(opt => (
                            <button
                              key={opt}
                              onClick={() => handleSetAutoClear(opt)}
                              style={{
                                flex:1, padding:'6px 4px', borderRadius:8, cursor:'pointer',
                                fontSize:11, fontWeight:700, letterSpacing:.3,
                                background: moderasi.autoClear === opt
                                  ? opt === 'off' ? 'rgba(255,255,255,0.15)'
                                  : opt === 'daily' ? 'rgba(200,245,0,0.2)'
                                  : 'rgba(168,85,247,0.2)'
                                  : 'rgba(255,255,255,0.05)',
                                color: moderasi.autoClear === opt
                                  ? opt === 'off' ? '#fff'
                                  : opt === 'daily' ? '#c8f500'
                                  : '#a855f7'
                                  : 'rgba(255,255,255,0.35)',
                                border: moderasi.autoClear === opt
                                  ? opt === 'off' ? '1px solid rgba(255,255,255,0.2)'
                                  : opt === 'daily' ? '1px solid rgba(200,245,0,0.4)'
                                  : '1px solid rgba(168,85,247,0.4)'
                                  : '1px solid rgba(255,255,255,0.08)',
                              }}
                            >
                              {opt === 'off' ? '✕ Off' : opt === 'daily' ? '📅 Harian' : '📆 Mingguan'}
                            </button>
                          ))}
                        </div>
                        {moderasi.autoClear !== 'off' && moderasi.lastClearedAt ? (
                          <div style={{fontSize:10, color:'rgba(255,255,255,0.3)', marginBottom:6}}>
                            Terakhir dihapus: {new Date(moderasi.lastClearedAt).toLocaleString('id-ID')}
                          </div>
                        ) : null}
                        <button
                          onClick={handleClearChatNow}
                          style={{width:'100%', padding:'7px', borderRadius:8, background:'rgba(255,55,95,0.12)', border:'1px solid rgba(255,55,95,0.3)', color:'#ff375f', fontSize:11, fontWeight:800, cursor:'pointer', letterSpacing:.3}}
                        >
                          🗑️ Hapus Chat Sekarang
                        </button>
                      </>
                    ) : (
                      <div style={{fontSize:11, color:'rgba(255,255,255,0.3)'}}>
                        {moderasi.autoClear === 'off' ? '❌ Nonaktif' : moderasi.autoClear === 'daily' ? '📅 Setiap hari' : '📆 Setiap minggu'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── GROUP SETTINGS MODAL ── */}
        {showGroupSettings && groupInfo && isAdmin && (
          <div className="gc2-modal-overlay" onClick={() => setShowGroupSettings(false)}>
            <div className="gc2-modal" onClick={e => e.stopPropagation()}>
              <div className="gc2-modal-header">
                <span>⚙️ Pengaturan Grup</span>
                <button onClick={() => setShowGroupSettings(false)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.5)',fontSize:20,cursor:'pointer'}}>×</button>
              </div>
              <div className="gc2-modal-body">
                <label className="gc2-field-label">Nama Grup</label>
                <input className="gc2-field-input" defaultValue={groupInfo.name} onChange={e => setEditGroupName(e.target.value)} placeholder="Nama grup..."/>
                <label className="gc2-field-label">Deskripsi</label>
                <textarea className="gc2-field-input" defaultValue={groupInfo.desc} onChange={e => setEditGroupDesc(e.target.value)} placeholder="Deskripsi grup..." rows={3} style={{resize:'none'}}/>
                <label className="gc2-field-label">URL Foto Profil Grup</label>
                <input className="gc2-field-input" defaultValue={groupInfo.iconUrl} onChange={e => setEditGroupIcon(e.target.value)} placeholder="https://..."/>
                {editGroupIcon && <img src={editGroupIcon} alt="preview" style={{width:64,height:64,borderRadius:'50%',objectFit:'cover',margin:'8px auto',display:'block'}} onError={e => (e.currentTarget.style.display='none')}/>}
                <div style={{marginTop:8}}>
                  <div style={{color:'rgba(255,255,255,0.5)',fontSize:12,marginBottom:8}}>👥 Member ({memberList.length})</div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:120,overflowY:'auto'}}>
                    {memberList.map(m => (
                      <div key={m.uid} style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
                        <div style={{width:24,height:24,borderRadius:'50%',background:avatarColor(m.uid),display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#000',flexShrink:0}}>
                          {m.username[0].toUpperCase()}
                        </div>
                        <span style={{flex:1,color:'rgba(255,255,255,0.8)'}}>{m.username}</span>
                        {m.isOwner && <span style={{fontSize:11,color:'#c8f500'}}>👑 Owner</span>}
                        {!m.isOwner && m.isAdmin && <span style={{fontSize:11,color:'#00e5ff'}}>⭐ Admin</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <button className="gc2-rpg-btn primary" style={{marginTop:14,width:'100%'}} onClick={handleSaveGroup} disabled={savingGroup}>
                  {savingGroup ? <span className="gc-spinner-sm"/> : '💾 Simpan Perubahan'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>{/* zzz-main-content */}
      </div>{/* zzz-discord-layout */}

      <style>{`
        /* ── Container ── */
        .gc2-container { display:flex; flex-direction:column; height:100dvh; width:100%; max-width:100%; border-radius:0; background:#0a0a0a; border:none; overflow:hidden; box-shadow:none; }
        /* ── Header ── */
        .gc2-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:linear-gradient(180deg,#111 0%,#0d0d0d 100%); border-bottom:1px solid rgba(200,245,0,0.1); flex-shrink:0; }
        .gc2-group-info { display:flex; align-items:center; gap:10px; }
        .gc2-group-icon { width:38px; height:38px; border-radius:12px; background:rgba(200,245,0,0.1); display:flex; align-items:center; justify-content:center; font-size:18px; overflow:hidden; flex-shrink:0; border:1.5px solid rgba(200,245,0,0.25); box-shadow:0 0 12px rgba(200,245,0,0.1); }
        .gc2-group-icon img { width:100%; height:100%; object-fit:cover; }
        .gc2-group-name { font-size:14px; font-weight:800; color:#fff; letter-spacing:-.2px; }
        .gc2-group-sub { font-size:11px; color:rgba(255,255,255,0.35); display:flex; align-items:center; gap:6px; }
        .gc2-admin-badge { background:rgba(200,245,0,0.15); color:#c8f500; font-size:9px; font-weight:800; padding:1px 6px; border-radius:4px; letter-spacing:.8px; border:1px solid rgba(200,245,0,0.2); }
        /* ── Tabs ── */
        .gc2-tabs { display:flex; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; background:#0d0d0d; }
        .gc2-tab { flex:1; padding:10px; background:none; border:none; cursor:pointer; font-size:13px; font-weight:700; color:rgba(255,255,255,0.35); display:flex; align-items:center; justify-content:center; gap:6px; transition:all .2s; border-bottom:2px solid transparent; letter-spacing:.2px; }
        .gc2-tab.active { color:#c8f500; border-bottom-color:#c8f500; background:rgba(200,245,0,0.04); }
        /* ── RPG Sub-tabs ── */
        .gc2-rpg-subtabs { display:flex; border-bottom:1px solid rgba(255,255,255,0.05); flex-shrink:0; background:#0a0a0a; padding:0 4px; }
        .gc2-rpg-subtab { flex:1; padding:7px 4px; background:none; border:none; cursor:pointer; font-size:11px; font-weight:700; color:rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; gap:4px; transition:all .2s; border-bottom:2px solid transparent; letter-spacing:.2px; }
        .gc2-rpg-subtab.active { color:#ff375f; border-bottom-color:#ff375f; background:rgba(255,55,95,0.04); }
        /* ── Members strip ── */
        .gc2-members-strip { display:flex; gap:8px; padding:8px 12px; overflow-x:auto; flex-shrink:0; border-bottom:1px solid rgba(255,255,255,0.05); scrollbar-width:none; }
        .gc2-members-strip::-webkit-scrollbar { display:none; }
        .gc2-member-chip { display:flex; flex-direction:column; align-items:center; gap:3px; min-width:44px; }
        .gc2-member-avatar { width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#000; flex-shrink:0; overflow:hidden; }
        .gc2-member-avatar.gc2-avatar-music { border-radius:50%; box-shadow:0 0 0 2px #c8f500, 0 0 10px 3px rgba(200,245,0,0.5); animation:musicRing 1.5s ease-in-out infinite; }
        @keyframes musicRing { 0%,100%{box-shadow:0 0 0 2px #c8f500,0 0 8px 2px rgba(200,245,0,0.4)} 50%{box-shadow:0 0 0 3px #ffe000,0 0 18px 6px rgba(255,224,0,0.6)} }
        .gc2-presence-dot { position:absolute; bottom:-2px; right:-2px; width:9px; height:9px; border-radius:50%; border:2px solid #0d0d0d; }
        .gc2-presence-dot.online { background:#30d158; box-shadow:0 0 4px rgba(48,209,88,0.8); animation:dotPulse 2s ease-in-out infinite; }
        .gc2-presence-dot.offline { background:#636366; }
        @keyframes dotPulse { 0%,100%{box-shadow:0 0 3px rgba(48,209,88,0.6)} 50%{box-shadow:0 0 8px rgba(48,209,88,1)} }
        .gc2-music-badge { position:absolute; top:-4px; right:-4px; font-size:9px; background:rgba(200,245,0,0.9); color:#000; border-radius:50%; width:14px; height:14px; display:flex; align-items:center; justify-content:center; font-weight:900; animation:musicNoteBounce .6s ease-in-out infinite alternate; }
        @keyframes musicNoteBounce { from{transform:scale(1) rotate(-10deg)} to{transform:scale(1.2) rotate(10deg)} }
        .gc2-member-name { font-size:9px; color:rgba(255,255,255,0.4); white-space:nowrap; max-width:44px; overflow:hidden; text-overflow:ellipsis; }
        .gc2-member-more { font-size:11px; color:rgba(255,255,255,0.3); align-self:center; }
        /* ── Active battles strip ── */
        .gc2-battles-strip { padding:8px 10px; border-bottom:1px solid rgba(200,245,0,0.08); background:rgba(200,245,0,0.02); flex-shrink:0; display:flex; flex-direction:column; gap:6px; }
        .gc2-battles-label { font-size:10px; font-weight:800; color:rgba(200,245,0,0.6); text-transform:uppercase; letter-spacing:.8px; }
        .gc2-battle-card { background:rgba(255,255,255,0.04); border:1px solid rgba(200,245,0,0.1); border-radius:10px; padding:8px 10px; }
        .gc2-battle-header { display:flex; align-items:center; gap:6px; font-size:11px; color:rgba(255,255,255,0.7); margin-bottom:6px; font-weight:600; }
        .gc2-battle-user { color:#c8f500; }
        .gc2-battle-vs { color:rgba(255,255,255,0.3); font-size:10px; }
        .gc2-battle-monster { color:#ff8080; }
        .gc2-battle-bars { display:flex; gap:8px; }
        /* ── Chat bubbles (ZZZ style) ── */
        .gc-messages { flex:1; overflow-y:auto; padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
        .gc-messages::-webkit-scrollbar { width:3px; }
        .gc-messages::-webkit-scrollbar-thumb { background:rgba(200,245,0,0.15); border-radius:2px; }
        .gc-msg-row { display:flex; align-items:flex-end; gap:8px; }
        .gc-msg-me { flex-direction:row-reverse; }
        .gc-msg-grouped { margin-top:-2px; }
        .gc-avatar { width:30px; height:30px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#000; flex-shrink:0; }
        .gc-avatar-img { width:100%; height:100%; object-fit:cover; border-radius:10px; }
        .gc-avatar-spacer { width:30px; flex-shrink:0; }
        .gc-msg-content { display:flex; flex-direction:column; max-width:72%; }
        .gc-msg-username { font-size:10px; color:rgba(255,255,255,0.4); margin-bottom:3px; font-weight:600; }
        .gc-bubble { padding:8px 11px; border-radius:14px; display:inline-flex; flex-direction:column; gap:3px; max-width:100%; word-break:break-word; }
        .gc-bubble-other { background:#1a1a1a; border:1px solid rgba(255,255,255,0.08); border-bottom-left-radius:4px; }
        .gc-bubble-me { background:linear-gradient(135deg,rgba(200,245,0,0.18),rgba(200,245,0,0.1)); border:1px solid rgba(200,245,0,0.2); border-bottom-right-radius:4px; }
        .gc-bubble-text { font-size:13px; color:#f0f0f0; line-height:1.45; }
        .gc-bubble-time { font-size:9px; color:rgba(255,255,255,0.3); align-self:flex-end; }
        /* ── Typing ── */
        .gc2-typing-row { display:flex; padding:2px 8px; }
        .gc2-typing-bubble { display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.06); border-radius:12px; padding:6px 12px; }
        .gc2-typing-dots { display:flex; gap:3px; align-items:center; }
        .gc2-typing-dots span { width:5px; height:5px; border-radius:50%; background:#c8f500; animation:typingDot 1.2s infinite; }
        .gc2-typing-dots span:nth-child(2) { animation-delay:.2s; }
        .gc2-typing-dots span:nth-child(3) { animation-delay:.4s; }
        @keyframes typingDot { 0%,60%,100%{transform:translateY(0);opacity:.4} 30%{transform:translateY(-4px);opacity:1} }
        .gc2-typing-text { font-size:11px; color:rgba(255,255,255,0.4); font-style:italic; }
        /* ── Input ── */
        .gc-input-area { padding:10px 12px; border-top:1px solid rgba(255,255,255,0.06); flex-shrink:0; background:#0d0d0d; }
        .gc-input-wrap { display:flex; gap:8px; align-items:center; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.09); border-radius:14px; padding:2px 2px 2px 12px; transition:border .2s; }
        .gc-input-wrap:focus-within { border-color:rgba(200,245,0,0.3); }
        .gc-input { flex:1; background:none; border:none; outline:none; font-size:13px; color:#f0f0f0; padding:8px 0; font-family:inherit; }
        .gc-input::placeholder { color:rgba(255,255,255,0.25); }
        .gc-send-btn { width:34px; height:34px; border-radius:11px; border:none; background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.3); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .2s; flex-shrink:0; }
        .gc-send-btn.active { background:#c8f500; color:#000; box-shadow:0 0 14px rgba(200,245,0,0.3); }
        .gc-input-info { display:flex; justify-content:space-between; font-size:10px; color:rgba(255,255,255,0.25); margin-top:5px; padding:0 2px; }
        /* ── Toast notifications ── */
        @keyframes toastIn { from{opacity:0;transform:translateY(-20px) scale(.94)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes toastOut { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(-10px)} }
        .kyoko-toast { display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:14px; backdrop-filter:blur(16px); animation:toastIn .35s cubic-bezier(.34,1.56,.64,1) forwards; position:relative; overflow:hidden; pointer-events:none; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
        .kyoko-toast-win { background:rgba(200,245,0,0.15); border:1px solid rgba(200,245,0,0.3); }
        .kyoko-toast-lose { background:rgba(255,60,60,0.15); border:1px solid rgba(255,60,60,0.3); }
        .kyoko-toast-info { background:rgba(0,200,255,0.12); border:1px solid rgba(0,200,255,0.25); }
        .kyoko-toast-icon { font-size:22px; flex-shrink:0; }
        .kyoko-toast-body { flex:1; }
        .kyoko-toast-title { font-size:13px; font-weight:800; color:#fff; letter-spacing:.2px; }
        .kyoko-toast-msg { font-size:11px; color:rgba(255,255,255,0.6); margin-top:1px; }
        .kyoko-toast-bar { position:absolute; bottom:0; left:0; height:2px; width:100%; animation:toastBarShrink 3.3s linear forwards; }
        .kyoko-toast-win .kyoko-toast-bar { background:#c8f500; }
        .kyoko-toast-lose .kyoko-toast-bar { background:#ff4444; }
        .kyoko-toast-info .kyoko-toast-bar { background:#00e5ff; }
        @keyframes toastBarShrink { from{width:100%} to{width:0%} }
        /* ── RPG ZZZ Style ── */
        .gc2-rpg-wrap { flex:1; overflow-y:auto; overflow-x:hidden; position:relative; background:#080810; }
        .gc2-rpg-wrap::-webkit-scrollbar { width:2px; }
        .gc2-rpg-wrap::-webkit-scrollbar-thumb { background:rgba(255,55,95,0.3); border-radius:2px; }
        .gc2-rpg-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:32px 24px; text-align:center; }
        .gc2-rpg-btn { border:none; border-radius:10px; padding:9px 18px; font-size:13px; font-weight:700; cursor:pointer; transition:all .2s; display:inline-flex; align-items:center; gap:6px; }
        .gc2-rpg-btn.primary { background:#c8f500; color:#0a0a0a; }
        .gc2-rpg-btn.primary:hover { background:#d4ff00; transform:translateY(-1px); box-shadow:0 4px 16px rgba(200,245,0,0.3); }
        .gc2-rpg-btn.secondary { background:rgba(255,255,255,0.07); color:rgba(255,255,255,0.8); border:1px solid rgba(255,255,255,0.1); }
        .gc2-rpg-btn.secondary:hover { background:rgba(255,255,255,0.12); }
        .gc2-rpg-btn.danger { background:rgba(255,80,80,0.12); color:#ff8080; border:1px solid rgba(255,80,80,0.2); }
        .gc2-rpg-btn.danger:hover { background:rgba(255,80,80,0.22); }
        .gc2-rpg-btn:disabled { opacity:.35; cursor:not-allowed; transform:none!important; box-shadow:none!important; }
        /* ── Bars ── */
        .gc2-bar-wrap { background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden; height:6px; }
        .gc2-bar-fill { height:100%; border-radius:4px; transition:width .4s; }
        .gc2-hp-fill { background:linear-gradient(90deg,#ff4444,#ff8800); }
        .gc2-mp-fill { background:linear-gradient(90deg,#4488ff,#00e5ff); }
        .gc2-exp-fill { background:linear-gradient(90deg,#c8f500,#00e5ff); }
        /* ── Loading ── */
        .gc2-loading-overlay { position:absolute; inset:0; background:rgba(8,8,8,0.94); display:flex; align-items:center; justify-content:center; z-index:10; backdrop-filter:blur(6px); }
        .gc2-loading-content { text-align:center; width:240px; }
        .gc2-loading-title { font-size:16px; font-weight:800; color:#c8f500; margin-bottom:16px; letter-spacing:.5px; }
        .gc2-loading-bar-bg { width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; }
        .gc2-loading-bar-fill { height:100%; background:linear-gradient(90deg,#c8f500,#00e5ff); border-radius:3px; transition:width .05s linear; box-shadow:0 0 12px rgba(200,245,0,0.5); }
        .gc2-loading-pct { font-size:13px; color:rgba(255,255,255,0.4); margin-top:8px; }
        /* ── Modal ── */
        .gc2-modal-overlay { position:absolute; inset:0; background:rgba(0,0,0,0.75); display:flex; align-items:flex-end; justify-content:center; z-index:20; backdrop-filter:blur(6px); }
        .gc2-modal { background:#131313; border-radius:20px 20px 0 0; width:100%; max-height:90%; overflow-y:auto; border-top:1px solid rgba(200,245,0,0.15); }
        .gc2-modal-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 10px; font-size:15px; font-weight:800; color:#fff; border-bottom:1px solid rgba(255,255,255,0.07); }
        .gc2-modal-body { padding:14px 16px 24px; display:flex; flex-direction:column; gap:6px; }
        .gc2-field-label { font-size:11px; font-weight:700; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:.6px; margin-top:8px; }
        .gc2-field-input { width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:9px 12px; color:#fff; font-size:13px; outline:none; transition:border .15s; box-sizing:border-box; font-family:inherit; }
        .gc2-field-input:focus { border-color:rgba(200,245,0,0.4); }
        /* ── Battle anim ── */
        @keyframes playerAtk { 0%{transform:translateX(0)} 30%{transform:translateX(8px)} 60%{transform:translateX(-3px)} 100%{transform:translateX(0)} }
        @keyframes enemyAtk { 0%{transform:translateX(0)} 30%{transform:translateX(-8px)} 60%{transform:translateX(3px)} 100%{transform:translateX(0)} }
        .battle-anim-player { animation:playerAtk .35s ease; }
        .battle-anim-enemy { animation:enemyAtk .35s ease; }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .gc2-fadein { animation:fadeInUp .25s ease; }

        /* ════════════════════════════════════════════════════
           SPRING / JIGGLE — semua button terasa kenyal
           ════════════════════════════════════════════════════ */

        /* State 1: saat ditekan — squash seketika */
        .btn-spring-down {
          transform: scale(0.86) !important;
          transition: transform 0.07s cubic-bezier(0.4, 0, 1, 1) !important;
        }

        /* State 2: saat dilepas — spring balik dengan overshoot */
        .btn-spring-up {
          transform: scale(1) !important;
          transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
        }

        /* Squash & stretch versi lebih playful */
        .btn-spring-down-stretch {
          transform: scaleX(1.1) scaleY(0.82) !important;
          transition: transform 0.07s cubic-bezier(0.4, 0, 1, 1) !important;
        }
        .btn-spring-up-stretch {
          transform: scaleX(1) scaleY(1) !important;
          transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
        }

        /* Jangan biarkan spring conflict sama focus outline */
        button:focus-visible { outline: 2px solid rgba(200,245,0,0.5); outline-offset: 2px; }
        button { -webkit-tap-highlight-color: transparent; user-select: none; }
        .gc2-sticker { max-width:120px; border-radius:12px; }
        

        /* ── Fan-out header menu ── */
        .gc-fanout-trigger {
          position: relative; z-index: 2;
          width: 34px; height: 34px; border-radius: 10px;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.55); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s, border-color 0.2s, transform 0.25s cubic-bezier(.34,1.56,.64,1);
        }
        .gc-fanout-trigger:hover { background: rgba(200,245,0,0.1); border-color: rgba(200,245,0,0.3); color: #c8f500; }
        .gc-fanout-trigger-open {
          background: rgba(200,245,0,0.12); border-color: rgba(200,245,0,0.4); color: #c8f500;
          transform: rotate(90deg) scale(1.1);
        }
        .gc-fanout-trigger-icon { display:flex; align-items:center; justify-content:center; transition: transform 0.25s; }

        .gc-fanout-btn {
          position: absolute; right: 42px;
          display: flex; align-items: center; gap: 4px;
          height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid transparent;
          font-size: 10px; font-weight: 700; letter-spacing: .5px; cursor: pointer;
          opacity: 0; pointer-events: none;
          transform: translateX(12px) scale(0.7);
          transform-origin: right center;
          transition: opacity 0.22s, transform 0.28s cubic-bezier(.34,1.56,.64,1), background 0.2s;
          white-space: nowrap;
        }
        .gc-fanout-btn.gc-fanout-visible {
          opacity: 1; pointer-events: all;
          transform: translateX(0) scale(1);
        }
        .gc-fanout-back {
          background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.65);
          right: 118px; transition-delay: 0.05s;
        }
        .gc-fanout-back.gc-fanout-visible { transition-delay: 0.08s; }
        .gc-fanout-back:hover { background: rgba(255,255,255,0.14); color: #fff; }
        .gc-fanout-logout {
          background: rgba(255,60,60,0.1); border-color: rgba(255,60,60,0.25); color: rgba(255,100,100,0.85);
          right: 46px; transition-delay: 0s;
        }
        .gc-fanout-logout.gc-fanout-visible { transition-delay: 0.04s; }
        .gc-fanout-logout:hover { background: rgba(255,60,60,0.2); color: #ff6060; }

        /* ── Swap transition overlay ── */
        .gc-swap-overlay {
          position: absolute; inset: 0; z-index: 100; border-radius: inherit; overflow: hidden; pointer-events: none;
        }
        .gc-swap-panel-a {
          position: absolute; inset: 0;
          background: var(--yellow, #c8f500);
          animation: gcSwapA 0.42s cubic-bezier(.77,0,.18,1) forwards;
        }
        .gc-swap-panel-b {
          position: absolute; inset: 0;
          background: #0a0a0a;
          animation: gcSwapB 0.42s cubic-bezier(.77,0,.18,1) 0.06s forwards;
        }
        .gc-swap-flash {
          position: absolute; inset: 0; background: #fff; opacity: 0;
          animation: gcSwapFlash 0.42s ease forwards;
        }
        .gc-swap-line {
          position: absolute; left: 0; right: 0; top: 50%; height: 2px;
          background: var(--yellow, #c8f500);
          box-shadow: 0 0 12px var(--yellow, #c8f500);
          opacity: 0;
          animation: gcSwapLine 0.42s ease forwards;
        }
        @keyframes gcSwapA {
          0%   { clip-path: polygon(-10% 0%, 0% 0%, -10% 100%, -20% 100%); }
          45%  { clip-path: polygon(-10% 0%, 110% 0%, 100% 100%, -10% 100%); }
          70%  { clip-path: polygon(-10% 0%, 110% 0%, 100% 100%, -10% 100%); }
          100% { clip-path: polygon(90% 0%, 110% 0%, 100% 100%, 80% 100%); }
        }
        @keyframes gcSwapB {
          0%   { clip-path: polygon(-20% 0%, -10% 0%, -20% 100%, -30% 100%); }
          50%  { clip-path: polygon(-20% 0%, 108% 0%, 98% 100%, -20% 100%); }
          72%  { clip-path: polygon(-20% 0%, 108% 0%, 98% 100%, -20% 100%); }
          100% { clip-path: polygon(88% 0%, 108% 0%, 98% 100%, 78% 100%); }
        }
        @keyframes gcSwapFlash {
          0%,30% { opacity: 0; }
          40%    { opacity: 0.55; }
          50%    { opacity: 0; }
          100%   { opacity: 0; }
        }
        @keyframes gcSwapLine {
          0%,30% { opacity: 0; transform: scaleX(0); }
          42%    { opacity: 1; transform: scaleX(1); }
          58%    { opacity: 0; }
          100%   { opacity: 0; }
        }
        /* ── ZZZ-style extra animations ── */
        @keyframes btnPulse { 0%,100%{box-shadow:0 0 0 0 rgba(200,245,0,0.4)} 50%{box-shadow:0 0 0 8px rgba(200,245,0,0)} }
        @keyframes autoPulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,214,0,0.4)} 50%{box-shadow:0 0 0 6px rgba(255,214,0,0)} }
        @keyframes popIn { 0%{transform:scale(0.5);opacity:0} 80%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
        @keyframes gachaSpin { 0%{transform:rotate(0deg) scale(0.5);opacity:0} 60%{transform:rotate(360deg) scale(1.2)} 100%{transform:rotate(720deg) scale(1);opacity:1} }
        @keyframes gachaCardIn { 0%{opacity:0;transform:translateY(30px) scale(0.8) rotateY(90deg)} 100%{opacity:1;transform:translateY(0) scale(1) rotateY(0deg)} }
        @keyframes star5Glow { 0%,100%{box-shadow:0 0 16px rgba(255,215,0,0.4),0 0 32px rgba(255,180,0,0.2)} 50%{box-shadow:0 0 32px rgba(255,215,0,0.8),0 0 64px rgba(255,180,0,0.4)} }
        @keyframes star4Glow { 0%,100%{box-shadow:0 0 10px rgba(160,100,255,0.4)} 50%{box-shadow:0 0 22px rgba(160,100,255,0.8)} }
        @keyframes star6Glow { 0%,100%{box-shadow:0 0 24px rgba(255,60,255,0.6),0 0 48px rgba(180,0,255,0.3)} 50%{box-shadow:0 0 48px rgba(255,60,255,1),0 0 96px rgba(180,0,255,0.6)} }
        @keyframes slideInLeft { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes zzzScan { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
        .gacha-6star { animation: gachaCardIn .7s cubic-bezier(.34,1.56,.64,1) forwards, star6Glow 1.5s ease-in-out infinite !important; }
        .gacha-5star { animation: gachaCardIn .6s cubic-bezier(.34,1.56,.64,1) forwards, star5Glow 2s ease-in-out infinite !important; }
        .gacha-4star { animation: gachaCardIn .5s cubic-bezier(.34,1.56,.64,1) forwards, star4Glow 2s ease-in-out infinite !important; }
        .gacha-3star { animation: gachaCardIn .4s ease forwards !important; }
        .slide-in-left { animation: slideInLeft .3s ease forwards; }
        .shimmer-bg { background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 75%); background-size: 200% 100%; animation: shimmer 2s infinite; }
        /* ── ZZZ Battle Buttons ── */
        .zzz-btn { border:none; border-radius:8px; padding:9px 14px; font-size:12px; font-weight:800; cursor:pointer; transition:all .18s; display:inline-flex; align-items:center; justify-content:center; gap:6px; width:100%; letter-spacing:.3px; font-family:inherit; }
        .zzz-btn-attack { background:linear-gradient(135deg,#ff375f,#c0192e); color:#fff; box-shadow:0 2px 12px rgba(255,55,95,0.4); }
        .zzz-btn-attack:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 4px 20px rgba(255,55,95,0.6); }
        .zzz-btn-heal { background:linear-gradient(135deg,#1c7c2e,#30d158); color:#fff; box-shadow:0 2px 10px rgba(48,209,88,0.3); }
        .zzz-btn-heal:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 4px 16px rgba(48,209,88,0.5); }
        .zzz-btn-skill { background:rgba(255,214,0,0.12); color:#ffd60a; border:1px solid rgba(255,214,0,0.3); }
        .zzz-btn-skill:hover:not(:disabled) { background:rgba(255,214,0,0.2); transform:translateY(-1px); }
        .zzz-btn-flee { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.5); border:1px solid rgba(255,255,255,0.1); }
        .zzz-btn-flee:hover:not(:disabled) { background:rgba(255,80,80,0.12); color:#ff8080; border-color:rgba(255,80,80,0.3); }
        .zzz-btn:disabled { opacity:.35; cursor:not-allowed; transform:none!important; box-shadow:none!important; }
        /* ── Dungeon styles ── */
        .gc2-dungeon-phase2 { animation: star5Glow 1s ease-in-out infinite; }
        @keyframes dungeonShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
        .gc2-shake { animation: dungeonShake .3s ease; }

        /* ── Delete message ── */
        .gc-msg-actions { position:absolute; top:50%; transform:translateY(-50%); display:flex; align-items:center; }
        .gc-msg-actions-me { left:-28px; }
        .gc-msg-actions-other { right:-28px; }
        .gc-msg-dots { background:none; border:none; color:rgba(255,255,255,0.25); font-size:16px; cursor:pointer; padding:0 4px; line-height:1; transition:color .15s; }
        .gc-msg-dots:hover { color:rgba(200,245,0,0.7); }
        .gc-msg-menu { position:absolute; z-index:50; background:#1a1a1a; border:1px solid rgba(200,245,0,0.2); border-radius:10px; padding:4px; white-space:nowrap; box-shadow:0 8px 24px rgba(0,0,0,0.6); }
        .gc-msg-menu-me { right:24px; top:0; }
        .gc-msg-menu-other { left:24px; top:0; }
        .gc-msg-menu button { display:flex; align-items:center; gap:6px; background:none; border:none; color:#ff5555; font-size:12px; font-weight:700; padding:7px 12px; cursor:pointer; border-radius:7px; transition:background .15s; width:100%; }
        .gc-msg-menu button:hover { background:rgba(255,80,80,0.12); }

        /* ── Input icon buttons ── */
        .gc-input-icon-btn { background:rgba(200,245,0,0.06); border:1px solid rgba(200,245,0,0.12); color:rgba(200,245,0,0.6); border-radius:8px; padding:6px 8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; flex-shrink:0; min-width:32px; min-height:32px; }
        .gc-input-icon-btn:hover { background:rgba(200,245,0,0.12); color:#c8f500; border-color:rgba(200,245,0,0.3); }
        .gc-input-icon-btn-active { background:rgba(200,245,0,0.15) !important; color:#c8f500 !important; border-color:rgba(200,245,0,0.4) !important; }

        /* ── Music panel ── */
        .gc-music-panel { background:#111; border:1px solid rgba(200,245,0,0.15); border-radius:14px; overflow:hidden; margin-bottom:8px; animation:fadeInUp .25s ease; }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .gc-music-header { display:flex; align-items:center; gap:8px; padding:10px 12px; background:rgba(200,245,0,0.05); border-bottom:1px solid rgba(200,245,0,0.1); font-size:12px; font-weight:800; color:#c8f500; letter-spacing:.8px; }
        .gc-music-header span { flex:1; }
        .gc-music-header button { background:none; border:none; color:rgba(255,255,255,0.4); cursor:pointer; font-size:14px; }
        .gc-music-header button:hover { color:#fff; }
        .gc-music-search-row { display:flex; gap:6px; padding:8px; }
        .gc-music-input { flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:7px 10px; color:#fff; font-size:13px; outline:none; font-family:inherit; }
        .gc-music-input:focus { border-color:rgba(200,245,0,0.4); }
        .gc-music-search-btn { background:rgba(200,245,0,0.1); border:1px solid rgba(200,245,0,0.2); color:#c8f500; border-radius:8px; padding:7px 10px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s; }
        .gc-music-search-btn:hover { background:rgba(200,245,0,0.2); }
        .gc-music-results { display:flex; flex-direction:column; gap:0; max-height:200px; overflow-y:auto; }
        .gc-music-item { display:flex; align-items:center; gap:10px; padding:8px 10px; cursor:pointer; transition:background .15s; border-top:1px solid rgba(255,255,255,0.04); }
        .gc-music-item:hover { background:rgba(200,245,0,0.05); }
        .gc-music-thumb { position:relative; width:56px; height:38px; border-radius:6px; overflow:hidden; flex-shrink:0; }
        .gc-music-thumb img { width:100%; height:100%; object-fit:cover; }
        .gc-music-play-icon { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:14px; background:rgba(0,0,0,0.4); opacity:0; transition:opacity .15s; color:#c8f500; }
        .gc-music-item:hover .gc-music-play-icon { opacity:1; }
        .gc-music-info { flex:1; overflow:hidden; }
        .gc-music-title { font-size:12px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .gc-music-channel { font-size:10px; color:rgba(255,255,255,0.35); margin-top:2px; }

        /* ── Now playing ── */
        .gc-now-playing { display:flex; align-items:center; gap:8px; padding:7px 10px; background:rgba(200,245,0,0.06); border:1px solid rgba(200,245,0,0.15); border-radius:10px; margin-bottom:6px; flex-wrap:nowrap; }
        .gc-now-playing-label { display:flex; align-items:center; gap:4px; font-size:10px; font-weight:800; color:#c8f500; letter-spacing:.5px; flex-shrink:0; }
        .gc-now-playing-title { flex:1; font-size:11px; color:rgba(255,255,255,0.7); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .gc-now-playing-close { background:none; border:none; color:rgba(255,255,255,0.3); font-size:13px; cursor:pointer; padding:0; }
        /* Music Visualizer */
        .gc-music-visualizer { display:flex; align-items:flex-end; gap:2px; height:14px; flex-shrink:0; }
        .gc-music-visualizer span { display:block; width:3px; border-radius:2px; background:#c8f500; animation:gcVisBounce 0.8s ease-in-out infinite alternate; }
        .gc-music-visualizer span:nth-child(1) { height:4px; animation-delay:0s; }
        .gc-music-visualizer span:nth-child(2) { height:10px; animation-delay:0.15s; }
        .gc-music-visualizer span:nth-child(3) { height:14px; animation-delay:0.3s; }
        .gc-music-visualizer span:nth-child(4) { height:8px; animation-delay:0.45s; }
        .gc-music-visualizer span:nth-child(5) { height:5px; animation-delay:0.6s; }
        @keyframes gcVisBounce { from { transform:scaleY(0.3); opacity:0.5; } to { transform:scaleY(1); opacity:1; } }
        /* API button */
        .gc-music-api-btn { background:rgba(200,245,0,0.06); border:1px dashed rgba(200,245,0,0.2); color:rgba(200,245,0,0.6); border-radius:6px; padding:4px 10px; font-size:10px; cursor:pointer; font-weight:700; letter-spacing:.5px; }

        /* ── Avatar picker ── */
        .gc-avatar-picker { background:#111; border:1px solid rgba(200,245,0,0.15); border-radius:14px; overflow:clip; margin-bottom:8px; animation:fadeInUp .25s ease; }
        .gc-avatar-admin-row { display:flex; gap:6px; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); }
        .gc-avatar-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; padding:10px; }
        .gc-avatar-item { position:relative; aspect-ratio:1; border-radius:50%; overflow:visible; cursor:pointer; }
        .gc-avatar-item img { width:100%; height:100%; object-fit:cover; border-radius:50%; border:2px solid transparent; transition:border-color .15s,transform .15s; }
        .gc-avatar-item:hover img { border-color:#c8f500; transform:scale(1.08); }
        .gc-avatar-del { position:absolute; top:-4px; right:-4px; background:#ff3b3b; border:none; color:#fff; border-radius:50%; width:16px; height:16px; font-size:9px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1; z-index:2; }

        /* ── Group info panel ── */
        .gc-group-info-panel { position:absolute; inset:0; background:#0a0a0a; z-index:25; display:flex; flex-direction:column; overflow-y:auto; }
        .gc-group-info-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid rgba(200,245,0,0.1); flex-shrink:0; }
        .gc-group-info-body { display:flex; flex-direction:column; align-items:center; padding:24px 16px 16px; gap:6px; }
        .gc-group-info-icon-wrap { position:relative; margin-bottom:8px; }
        .gc-group-info-icon { width:80px; height:80px; border-radius:50%; background:rgba(200,245,0,0.1); border:2px solid rgba(200,245,0,0.3); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow:0 0 24px rgba(200,245,0,0.15); }
        .gc-group-info-icon img { width:100%; height:100%; object-fit:cover; }
        .gc-group-info-ring { position:absolute; inset:-6px; border-radius:50%; border:1.5px solid rgba(200,245,0,0.15); animation:gcRingPulse 2s ease-in-out infinite; }
        @keyframes gcRingPulse { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:.9;transform:scale(1.04)} }
        .gc-group-info-name { font-size:18px; font-weight:900; color:#fff; letter-spacing:-.3px; text-align:center; }
        .gc-group-info-meta { font-size:13px; color:rgba(255,255,255,0.4); margin-bottom:4px; }
        .gc-group-info-desc { background:rgba(200,245,0,0.04); border:1px solid rgba(200,245,0,0.1); border-radius:12px; padding:12px 14px; width:100%; margin-top:8px; }
        .gc-group-info-desc-label { font-size:11px; font-weight:800; color:rgba(200,245,0,0.6); letter-spacing:.5px; margin-bottom:6px; }
        .gc-group-info-desc-text { font-size:13px; color:rgba(255,255,255,0.7); line-height:1.6; white-space:pre-wrap; }
        .gc-group-info-members-label { font-size:11px; font-weight:800; color:rgba(255,255,255,0.3); letter-spacing:.5px; margin-top:14px; align-self:flex-start; }
        .gc-group-info-members { display:flex; flex-direction:column; gap:6px; width:100%; margin-top:6px; }
        .gc-group-info-member { display:flex; align-items:center; gap:10px; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid rgba(255,255,255,0.05); }
        .gc-group-info-member-av { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:#000; flex-shrink:0; overflow:hidden; }
        .gc-group-info-member-name { flex:1; font-size:13px; color:rgba(255,255,255,0.8); }
        .gc-group-info-badge { font-size:12px; }
        .gc-group-info-badge.owner { color:#c8f500; }
        .gc-group-info-badge.admin { color:#00e5ff; }

        /* ── @mention ── */
        .gc-mention-dropdown { position:absolute; bottom:calc(100% + 6px); left:0; right:0; background:#161616; border:1px solid rgba(200,245,0,0.25); border-radius:10px; overflow:hidden; z-index:50; box-shadow:0 -8px 24px rgba(0,0,0,0.5); }
        .gc-mention-item { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:pointer; transition:background .15s; font-size:13px; color:#f0f0f0; }
        .gc-mention-item:hover, .gc-mention-item-active { background:rgba(200,245,0,0.1); color:#c8f500; }
        .gc-mention-av { width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; color:#000; flex-shrink:0; overflow:hidden; }
        .gc-mention-highlight { color:#c8f500; font-weight:700; background:rgba(200,245,0,0.1); border-radius:4px; padding:0 2px; }

        /* ── Moderasi panel ── */
        .gc-moderasi-panel { background:#111; border:1px solid rgba(200,245,0,0.15); border-radius:12px; padding:12px; margin-top:8px; }
        .gc-moderasi-title { font-size:11px; font-weight:800; color:#c8f500; letter-spacing:.08em; margin-bottom:10px; text-transform:uppercase; }
        .gc-moderasi-row { display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
        .gc-moderasi-row:last-of-type { border-bottom:none; }
        .gc-moderasi-info { display:flex; flex-direction:column; gap:2px; }
        .gc-moderasi-info span:first-child { font-size:12px; color:#f0f0f0; font-weight:600; }
        .gc-moderasi-desc { font-size:10px; color:rgba(255,255,255,0.35); }
        .gc-moderasi-toggle { padding:4px 12px; border-radius:20px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.4); font-size:11px; font-weight:800; cursor:pointer; transition:all .2s; letter-spacing:.05em; }
        .gc-moderasi-toggle.on { background:rgba(200,245,0,0.15); border-color:rgba(200,245,0,0.4); color:#c8f500; box-shadow:0 0 8px rgba(200,245,0,0.2); }
        .gc-moderasi-badwords { padding:8px 0; }
        .gc-moderasi-tags { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:4px; }
        .gc-moderasi-tag { display:inline-flex; align-items:center; gap:4px; background:rgba(255,59,59,0.1); border:1px solid rgba(255,59,59,0.25); color:#ff6b6b; border-radius:6px; padding:2px 8px; font-size:10px; font-weight:600; }
        .gc-moderasi-tag button { background:none; border:none; color:#ff6b6b; cursor:pointer; font-size:9px; padding:0; line-height:1; }
        .gc-moderasi-status { margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05); font-size:10px; color:rgba(200,245,0,0.7); }
        /* ── Scroll to bottom button ── */
        .gc-scroll-down-btn {
          position: sticky; bottom: 8px; left: 50%; transform: translateX(-50%);
          display: flex; align-items: center; gap: 5px;
          background: rgba(30,30,40,0.92); border: 1px solid rgba(200,245,0,0.3); border-radius: 20px;
          color: rgba(200,245,0,0.8); font-size: 11px; font-weight: 800; padding: 6px 10px;
          cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          animation: fadeInUp .2s ease; z-index: 10; margin: 0 auto;
          letter-spacing: .3px; transition: all .2s;
        }
        .gc-scroll-down-btn:hover { background: rgba(50,50,60,0.95); border-color: rgba(200,245,0,0.6); }
        .gc-scroll-down-new {
          background: rgba(200,245,0,0.92) !important; border-color: transparent !important;
          color: #000 !important; padding: 6px 14px !important;
        }
        .gc-scroll-down-new:hover { background: #d4ff00 !important; }

        /* ── Reply indicator above input ── */
        .gc-reply-indicator {
          display: flex; align-items: center; gap: 8px;
          background: rgba(200,245,0,0.08); border: 1px solid rgba(200,245,0,0.2);
          border-radius: 10px 10px 0 0; padding: 6px 10px;
          margin-bottom: -4px; position: relative;
        }
        .gc-reply-indicator-bar { width: 3px; height: 28px; background: #c8f500; border-radius: 2px; flex-shrink: 0; }
        .gc-reply-indicator-content { flex: 1; overflow: hidden; }
        .gc-reply-indicator-user { font-size: 11px; font-weight: 800; color: #c8f500; display: block; }
        .gc-reply-indicator-text { font-size: 11px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
        .gc-reply-indicator-close { background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; font-size: 13px; flex-shrink: 0; }

        /* ── Reply quote inside bubble ── */
        .gc-reply-quote {
          display: flex; gap: 6px; background: rgba(0,0,0,0.25); border-radius: 6px;
          padding: 5px 8px; margin-bottom: 5px; border-left: 2px solid #c8f500;
        }
        .gc-reply-quote-bar { width: 2px; background: rgba(200,245,0,0.4); border-radius: 1px; flex-shrink: 0; }
        .gc-reply-quote-user { font-size: 10px; font-weight: 800; color: #c8f500; margin-bottom: 1px; }
        .gc-reply-quote-text { font-size: 10px; color: rgba(255,255,255,0.5); line-height: 1.3; }

        /* ── Custom notification sound ── */
        .gc-notif-sound-wrap {
          width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px; padding: 10px 12px; margin-top: 10px;
        }
        .gc-notif-sound-label { font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
        .gc-notif-sound-row { display: flex; align-items: center; gap: 8px; }
        .gc-notif-sound-current { flex: 1; font-size: 12px; color: rgba(255,255,255,0.7); }
        .gc-notif-sound-btn { background: rgba(200,245,0,0.1); border: 1px solid rgba(200,245,0,0.2); color: #c8f500; border-radius: 7px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; transition: background .15s; }
        .gc-notif-sound-btn:hover { background: rgba(200,245,0,0.2); }
        .gc-notif-sound-btn.danger { background: rgba(255,60,60,0.1); border-color: rgba(255,60,60,0.25); color: #ff8080; }
        .gc-notif-sound-editor { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }

        /* ── Swipe to reply indicator ── */
        @keyframes swipeHint { 0%{opacity:0;transform:translateX(0)} 30%{opacity:.7;transform:translateX(-8px)} 60%{opacity:.7;transform:translateX(-8px)} 100%{opacity:0;transform:translateX(0)} }
        .gc-swipe-hint { position:absolute; right:-20px; top:50%; transform:translateY(-50%); font-size:14px; animation:swipeHint 1s ease; pointer-events:none; }

        /* ── rpgToastIn (for App.tsx RPG toasts) ── */
        @keyframes rpgToastIn { from{opacity:0;transform:translateY(8px) scale(.95)} to{opacity:1;transform:translateY(0) scale(1)} }

        /* ── Fishing Panel ── */
        .fish-wrap { display:flex; flex-direction:column; min-height:100%; }
        .fish-header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid rgba(79,195,247,0.1); background:rgba(79,195,247,0.03); flex-shrink:0; }
        .fish-back-btn { background:none; border:none; color:rgba(255,255,255,0.5); font-size:14px; font-weight:700; cursor:pointer; padding:4px 8px; border-radius:8px; transition:all .2s; }
        .fish-back-btn:hover { color:#4fc3f7; }
        .fish-main-btn { margin:12px; padding:16px; background:linear-gradient(135deg,rgba(79,195,247,0.15),rgba(79,195,247,0.05)); border:1px solid rgba(79,195,247,0.3); border-radius:16px; color:#fff; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all .2s; }
        .fish-main-btn:hover { background:linear-gradient(135deg,rgba(79,195,247,0.25),rgba(79,195,247,0.1)); transform:scale(1.01); }
        .fish-menu-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:0 12px 12px; }
        .fish-menu-btn { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px 10px; color:#fff; display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; font-size:12px; font-weight:700; transition:all .2s; }
        .fish-menu-btn:hover { background:rgba(79,195,247,0.08); border-color:rgba(79,195,247,0.25); }
        .fish-loc-btn { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:12px; padding:10px 12px; display:flex; align-items:center; gap:10px; cursor:pointer; transition:all .2s; width:100%; }
        .fish-loc-btn.active { background:rgba(79,195,247,0.1); border-color:rgba(79,195,247,0.35); }
        .fish-loc-btn.locked { cursor:default; opacity:.7; }
        .fish-unlock-btn { background:rgba(255,215,0,0.15); border:1px solid rgba(255,215,0,0.3); border-radius:6px; color:#ffd700; font-size:10px; font-weight:700; padding:3px 8px; cursor:pointer; margin-top:4px; }
        .fish-unlock-btn:disabled { opacity:.4; cursor:not-allowed; }
        .fish-scene { display:flex; flex-direction:column; }
        .fish-water-bg { position:relative; background:linear-gradient(180deg,#0d2744 0%,#0a1929 100%); margin:0 12px; border-radius:16px; height:140px; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid rgba(79,195,247,0.2); }
        .fish-ripple { position:absolute; border-radius:50%; border:1px solid rgba(79,195,247,0.3); animation:fishRipple 3s ease-out infinite; }
        .fish-ripple.r1 { width:60px; height:20px; bottom:30px; left:50%; transform:translateX(-50%); animation-delay:0s; }
        .fish-ripple.r2 { width:100px; height:30px; bottom:20px; left:50%; transform:translateX(-50%); animation-delay:1s; }
        .fish-ripple.r3 { width:140px; height:40px; bottom:10px; left:50%; transform:translateX(-50%); animation-delay:2s; }
        @keyframes fishRipple { 0%{opacity:.6;transform:translateX(-50%) scaleX(1)} 100%{opacity:0;transform:translateX(-50%) scaleX(1.4)} }
        @keyframes fishPulse { 0%,100%{opacity:1;transform:translateX(-50%) scale(1)} 50%{opacity:.6;transform:translateX(-50%) scale(1.1)} }
        .fish-bar-wrap { margin:12px 12px 0; }
        .fish-bar-track { position:relative; height:20px; background:rgba(255,255,255,0.08); border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); }
        .fish-bar-zone { position:absolute; top:0; height:100%; background:rgba(100,255,100,0.35); border:1px solid rgba(100,255,100,0.6); }
        .fish-bar-indicator { position:absolute; top:-2px; bottom:-2px; width:6px; background:#4fc3f7; border-radius:4px; transform:translateX(-50%); box-shadow:0 0 8px #4fc3f7; }
        .fish-msg { margin:10px 12px 0; padding:8px 12px; border-radius:10px; font-size:13px; font-weight:700; text-align:center; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.7); border:1px solid rgba(255,255,255,0.1); }
        .fish-msg.win { background:rgba(100,255,100,0.1); color:#4fc3f7; border-color:rgba(79,195,247,0.3); }
        .fish-msg.miss { background:rgba(255,100,100,0.1); color:#ff6b6b; border-color:rgba(255,107,107,0.3); }
        .fish-result-card { margin:10px 12px 0; padding:12px; border-radius:14px; border:2px solid; display:flex; align-items:center; gap:12px; animation:fishCatch .4s cubic-bezier(0.175,0.885,0.32,1.275); }
        @keyframes fishCatch { 0%{transform:scale(0.5);opacity:0} 100%{transform:scale(1);opacity:1} }
        .fish-action-btn { width:100%; padding:14px; border-radius:14px; border:none; font-size:15px; font-weight:900; cursor:pointer; letter-spacing:.5px; transition:all .15s; }
        .fish-action-btn.cast { background:linear-gradient(135deg,#4fc3f7,#0288d1); color:#fff; box-shadow:0 4px 20px rgba(79,195,247,0.4); }
        .fish-action-btn.cast:hover { transform:scale(1.02); }
        .fish-action-btn.catch { background:linear-gradient(135deg,#ff6b3d,#ff375f); color:#fff; box-shadow:0 4px 20px rgba(255,55,95,0.5); animation:catchGlow .4s ease-in-out infinite alternate; }
        @keyframes catchGlow { 0%{box-shadow:0 4px 20px rgba(255,55,95,0.4)} 100%{box-shadow:0 6px 30px rgba(255,55,95,0.8),0 0 40px rgba(255,55,95,0.3)} }
        .fish-action-btn.waiting { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.35); cursor:not-allowed; }
        .fish-pond-item { display:flex; align-items:center; gap:12px; padding:12px; border-radius:14px; border:1px solid; }
        .fish-sell-btn { background:rgba(255,215,0,0.15); border:1px solid rgba(255,215,0,0.3); border-radius:8px; color:#ffd700; font-size:10px; font-weight:700; padding:6px 10px; cursor:pointer; text-align:center; transition:all .2s; white-space:nowrap; }
        .fish-sell-btn:hover { background:rgba(255,215,0,0.25); }
        .fish-rod-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:12px; transition:all .2s; }
        .fish-rod-card.current { background:rgba(79,195,247,0.08); border-color:rgba(79,195,247,0.3); }
        .fish-rod-card.owned { background:rgba(200,245,0,0.05); border-color:rgba(200,245,0,0.15); }
        .fish-upgrade-btn { width:100%; margin-top:10px; padding:10px; border-radius:10px; border:none; font-size:13px; font-weight:800; cursor:pointer; background:linear-gradient(135deg,rgba(79,195,247,0.8),rgba(2,136,209,0.8)); color:#fff; transition:all .2s; }
        .fish-upgrade-btn.disabled { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.25); cursor:not-allowed; }
        .fish-quest-card { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:14px; padding:12px; transition:all .2s; }
        .fish-quest-card.done { border-color:rgba(200,245,0,0.2); background:rgba(200,245,0,0.04); }
        .fish-claim-btn { width:100%; margin-top:10px; padding:8px; border-radius:10px; border:none; font-size:13px; font-weight:800; cursor:pointer; background:linear-gradient(135deg,#c8f500,#a0c400); color:#000; transition:all .2s; }
        .fish-claim-btn:hover { transform:scale(1.02); }

        /* ══════════════════════════════════════════════════════════
           ZZZ DISCORD LAYOUT — FULL WIDTH (no sidebar)
        ══════════════════════════════════════════════════════════ */
        .zzz-discord-layout { display:flex !important; flex-direction:row !important; width:100%; max-width:100vw; height:100dvh; border-radius:0; overflow:hidden; border:none; box-shadow:none; }
        .zzz-main-content { flex:1; display:flex; flex-direction:column; overflow:hidden; min-height:0; position:relative; min-width:0; margin-left:52px; }

        /* ── Icon Nav Strip ── */
        .qc-icon-strip {
          position:absolute; top:0; left:0; bottom:0;
          width:52px; z-index:60;
          display:flex; flex-direction:column; align-items:center;
          padding:8px 0 10px;
          background:linear-gradient(180deg,#0b0b16 0%,#080810 100%);
          border-right:1px solid rgba(200,245,0,0.08);
          gap:2px;
        }
        .qc-strip-avatar {
          width:34px; height:34px; border-radius:50%;
          background:linear-gradient(135deg,#1a1a2e,#16213e);
          border:2px solid rgba(200,245,0,0.4);
          display:flex; align-items:center; justify-content:center;
          overflow:hidden; cursor:pointer; flex-shrink:0;
          box-shadow:0 0 10px rgba(200,245,0,0.12);
          transition:border-color .2s, box-shadow .2s;
          margin-bottom:4px;
        }
        .qc-strip-avatar:hover {
          border-color:rgba(200,245,0,0.8);
          box-shadow:0 0 16px rgba(200,245,0,0.28);
        }
        .qc-strip-divider {
          width:28px; height:1px; border-radius:2px;
          background:rgba(200,245,0,0.12);
          margin:2px 0 4px; flex-shrink:0;
        }
        .qc-strip-btn {
          position:relative;
          width:38px; height:38px; border-radius:10px;
          background:none; border:none; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          color:rgba(255,255,255,0.3);
          transition:background .15s, color .15s, border-radius .2s;
          flex-shrink:0;
        }
        .qc-strip-btn:hover {
          background:rgba(200,245,0,0.07);
          color:rgba(255,255,255,0.7);
          border-radius:12px;
        }
        .qc-strip-active {
          background:rgba(200,245,0,0.12) !important;
          color:#c8f500 !important;
          border-radius:12px !important;
        }
        .qc-strip-active::after {
          content:''; position:absolute; left:-1px; top:20%; height:60%;
          width:3px; border-radius:0 3px 3px 0;
          background:#c8f500; box-shadow:0 0 8px #c8f500;
        }
        .qc-strip-voice { color:#4ade80 !important; }
        .qc-strip-icon { font-size:17px; line-height:1; }
        .qc-strip-badge {
          position:absolute; top:4px; right:4px;
          background:#4ade80; color:#000; font-size:8px; font-weight:900;
          border-radius:8px; padding:0 4px; min-width:14px; text-align:center;
        }

        /* ── Backdrop ── */
        .qc-backdrop {
          position:absolute; inset:0; z-index:45;
          background:rgba(0,0,0,0.7);
          backdrop-filter:blur(6px);
          opacity:0; pointer-events:none;
          transition:opacity .3s ease;
        }
        .qc-backdrop-visible { opacity:1; pointer-events:all; }

        /* ── Nav Popup Panel ── */
        .qc-nav-panel {
          position:absolute; top:8px; left:58px;
          width:200px; max-height:85vh;
          z-index:50;
          background:linear-gradient(160deg,#0d0d1c 0%,#09090f 100%);
          border:1px solid rgba(200,245,0,0.12);
          border-radius:14px;
          display:flex; flex-direction:column;
          transform:translateX(-12px) scale(.94);
          transform-origin:top left;
          opacity:0;
          transition:transform .3s cubic-bezier(.22,1.15,.36,1), opacity .22s ease;
          pointer-events:none;
          overflow:hidden;
          box-shadow:0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(200,245,0,0.06);
        }
        .qc-nav-open {
          transform:translateX(0) scale(1);
          opacity:1; pointer-events:all;
        }
        .qc-group-info {
          padding:12px 14px 10px;
          border-bottom:1px solid rgba(200,245,0,0.07);
          flex-shrink:0;
        }
        .qc-channel-scroll {
          flex:1; overflow-y:auto; overflow-x:hidden;
          padding:6px 0 4px; scrollbar-width:none;
          max-height:calc(85vh - 110px);
        }
        .qc-channel-scroll::-webkit-scrollbar { display:none; }
        .qc-cat-label {
          font-size:9px; font-weight:800; letter-spacing:2px;
          color:rgba(200,245,0,0.28); text-transform:uppercase;
          padding:8px 14px 3px;
        }
        .qc-ch-item {
          display:flex; align-items:center; gap:8px;
          width:100%; padding:6px 12px;
          background:none; border:none; cursor:pointer;
          color:rgba(255,255,255,0.4); text-align:left;
          transition:background .15s, color .15s;
          position:relative; overflow:hidden;
          animation:none;
        }
        .qc-nav-open .qc-ch-item {
          animation:qcItemIn .28s ease both;
        }
        @keyframes qcItemIn {
          from { transform:translateX(-10px); opacity:0; }
          to   { transform:translateX(0); opacity:1; }
        }
        .qc-ch-item:hover { background:rgba(200,245,0,0.05); color:rgba(255,255,255,0.75); }
        .qc-ch-active {
          background:rgba(200,245,0,0.08) !important;
          color:#c8f500 !important;
        }
        .qc-ch-active::before {
          content:''; position:absolute; left:0; top:18%; height:64%;
          width:2.5px; border-radius:0 2px 2px 0;
          background:#c8f500; box-shadow:0 0 6px #c8f500;
        }
        .qc-ch-voice { color:#4ade80 !important; }
        .qc-ch-icon { font-size:13px; flex-shrink:0; width:16px; text-align:center; }
        .qc-ch-label { font-size:11px; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:.2px; }
        .qc-voice-badge { background:#4ade80; color:#000; font-size:9px; font-weight:800; border-radius:10px; padding:1px 5px; flex-shrink:0; }
        .qc-user-bar {
          display:flex; align-items:center; gap:8px;
          padding:9px 12px; border-top:1px solid rgba(200,245,0,0.07);
          background:#07070e; flex-shrink:0;
        }
        .qc-user-av {
          width:24px; height:24px; min-width:24px; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          font-size:10px; font-weight:800; color:#000;
          position:relative; flex-shrink:0; overflow:hidden;
        }
        .qc-status-dot {
          position:absolute; bottom:0; right:0;
          width:6px; height:6px; border-radius:50%;
          background:#4ade80; border:1.5px solid #07070e;
        }

                /* ── Sidebar compat (keep for any remaining refs) ── */
        .zzz-sidebar { display:none; }
        .zzz-sidebar-collapsed { display:none; }

        /* ── Channel header ── */
        .zzz-channel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#0a0a0f; border-bottom:1px solid rgba(200,245,0,0.08); flex-shrink:0; min-height:44px; }
        .zzz-channel-header-left { display:flex; align-items:center; gap:8px; }
        .zzz-channel-header-icon { font-size:16px; }
        .zzz-channel-header-name { font-size:12px; font-weight:800; color:rgba(255,255,255,0.7); letter-spacing:.3px; }

        /* ── Voice Room ── */
        .zzz-voice-room { flex:1; display:flex; flex-direction:column; overflow-y:auto; }
        .zzz-voice-room-header { text-align:center; padding:28px 20px 16px; border-bottom:1px solid rgba(255,255,255,0.05); flex-shrink:0; }
        .zzz-voice-participants { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding:16px; flex:1; align-content:start; }
        .zzz-voice-participant { display:flex; flex-direction:column; align-items:center; gap:4px; padding:12px 8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; transition:all .2s; }
        .zzz-voice-participant:not(.muted) { border-color:rgba(200,245,0,0.2); background:rgba(200,245,0,0.04); }
        .zzz-voice-participant.muted { opacity:.6; }
        .zzz-voice-avatar { width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:800; color:#000; position:relative; flex-shrink:0; }
        .zzz-voice-wave { position:absolute; bottom:-4px; left:50%; transform:translateX(-50%); display:flex; gap:2px; align-items:flex-end; height:8px; }
        .zzz-voice-wave span { width:3px; background:#c8f500; border-radius:2px; animation:voiceWave 0.6s ease-in-out infinite; }
        .zzz-voice-wave span:nth-child(2) { animation-delay:.15s; }
        .zzz-voice-wave span:nth-child(3) { animation-delay:.3s; }
        @keyframes voiceWave { 0%,100%{height:3px} 50%{height:8px} }
        .zzz-voice-controls { display:flex; gap:10px; padding:16px; border-top:1px solid rgba(255,255,255,0.05); flex-shrink:0; }
        .zzz-voice-btn { flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:11px; border-radius:10px; border:none; font-size:13px; font-weight:800; cursor:pointer; transition:all .2s; }
        .zzz-voice-btn.join { background:linear-gradient(135deg,rgba(200,245,0,0.2),rgba(200,245,0,0.08)); color:#c8f500; border:1px solid rgba(200,245,0,0.35); }
        .zzz-voice-btn.join:hover { background:linear-gradient(135deg,rgba(200,245,0,0.3),rgba(200,245,0,0.12)); }
        .zzz-voice-btn.join:disabled { opacity:.5; cursor:not-allowed; }
        .zzz-voice-btn.unmuted { background:rgba(74,222,128,0.1); color:#4ade80; border:1px solid rgba(74,222,128,0.25); }
        .zzz-voice-btn.muted { background:rgba(255,107,107,0.1); color:#ff6b6b; border:1px solid rgba(255,107,107,0.25); }
        .zzz-voice-btn.leave { background:rgba(255,55,95,0.12); color:#ff375f; border:1px solid rgba(255,55,95,0.3); max-width:90px; flex:none; }

        /* ── Override: container size for discord layout ── */
        .gc2-container.zzz-discord-layout { width:100vw !important; height:100dvh !important; border-radius:0 !important; max-width:100% !important; }

        /* ════════════════════════════════════════════════════
           KYOKO 3D SMOOTH — no glitch, pure depth & motion
           ════════════════════════════════════════════════════ */

        /* ── Keyframes ── */
        @keyframes k3d-slideUp {
          from { opacity:0; transform:translateY(22px) translateZ(-30px) rotateX(5deg); }
          to   { opacity:1; transform:translateY(0) translateZ(0) rotateX(0deg); }
        }
        @keyframes k3d-statPop {
          0%   { transform:scale(0.72) translateY(6px); opacity:0; }
          70%  { transform:scale(1.07) translateY(-2px); opacity:1; }
          100% { transform:scale(1) translateY(0); opacity:1; }
        }
        @keyframes k3d-barFill {
          from { transform:scaleX(0); }
          to   { transform:scaleX(1); }
        }
        @keyframes k3d-float {
          0%,100% { transform:translateY(0px); }
          50%      { transform:translateY(-3px); }
        }
        @keyframes k3d-shimmer {
          0%   { background-position:-200% center; }
          100% { background-position:200% center; }
        }
        @keyframes k3d-glow {
          0%,100% { box-shadow:0 4px 24px rgba(200,245,0,0.04),0 0 0 1px rgba(255,255,255,0.05) inset; }
          50%      { box-shadow:0 8px 40px rgba(200,245,0,0.10),0 0 0 1px rgba(255,255,255,0.08) inset; }
        }
        @keyframes k3d-battleGlow {
          0%,100% { box-shadow:0 4px 20px rgba(255,55,95,0.12),0 0 0 1px rgba(255,55,95,0.25) inset; }
          50%      { box-shadow:0 8px 36px rgba(255,55,95,0.28),0 0 0 1px rgba(255,55,95,0.5) inset; }
        }

        /* ── Scroll container ── */
        .rpg-dashboard-scroll {
          overflow-y:auto; height:100%; box-sizing:border-box;
          padding:12px 14px; scrollbar-width:none; scroll-behavior:smooth;
        }
        .rpg-dashboard-scroll::-webkit-scrollbar { display:none; }

        /* ── Character card ── */
        .rpg-char-card {
          position:relative;
          background:linear-gradient(135deg,#0f0f1a 0%,#120c1e 100%);
          border:1px solid rgba(255,255,255,0.10);
          border-radius:18px; padding:14px; margin-bottom:10px;
          overflow:hidden;
          will-change:transform;
          --rx:0deg; --ry:0deg;
          animation:k3d-slideUp 0.55s cubic-bezier(0.16,1,0.3,1) both,
                    k3d-float 5s ease-in-out 0.6s infinite;
          box-shadow:0 4px 24px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05) inset;
          transition:transform 0.14s ease, box-shadow 0.28s ease;
        }
        /* Holographic shimmer sweep */
        .rpg-char-card::before {
          content:''; position:absolute; inset:0; border-radius:inherit;
          background:linear-gradient(105deg,transparent 30%,rgba(200,245,0,0.05) 50%,transparent 70%);
          background-size:200% 100%;
          animation:k3d-shimmer 4s ease-in-out infinite;
          pointer-events:none; z-index:1;
        }
        /* Scanlines */
        .rpg-char-card::after {
          content:''; position:absolute; inset:0; border-radius:inherit;
          background:repeating-linear-gradient(transparent,transparent 3px,rgba(200,245,0,0.012) 3px,rgba(200,245,0,0.012) 4px);
          pointer-events:none; z-index:0; opacity:0.6;
        }
        /* 3D tilt state */
        .rpg-char-card.rpg-tilting {
          animation:none;
          transform:perspective(600px) rotateX(var(--rx)) rotateY(var(--ry)) translateZ(4px);
          box-shadow:0 14px 44px rgba(0,0,0,0.65),0 0 30px rgba(200,245,0,0.08);
        }

        /* ── Class icon ── */
        .rpg-class-icon {
          width:52px; height:52px; border-radius:12px;
          background:linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03));
          border:1px solid rgba(255,255,255,0.12);
          display:flex; align-items:center; justify-content:center;
          font-size:28px; flex-shrink:0;
          box-shadow:0 4px 16px rgba(0,0,0,0.5),0 1px 0 rgba(255,255,255,0.08) inset;
          position:relative; z-index:2;
          animation:k3d-slideUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.08s both;
        }

        /* ── Stat boxes ── */
        .rpg-stat-box {
          background:rgba(255,255,255,0.04);
          border:1px solid rgba(255,255,255,0.07);
          border-radius:9px; padding:6px 4px; text-align:center;
          transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1);
          cursor:default; position:relative; overflow:hidden;
        }
        .rpg-stat-box:nth-child(1) { animation:k3d-statPop 0.48s cubic-bezier(0.34,1.56,0.64,1) 0.50s both; }
        .rpg-stat-box:nth-child(2) { animation:k3d-statPop 0.48s cubic-bezier(0.34,1.56,0.64,1) 0.58s both; }
        .rpg-stat-box:nth-child(3) { animation:k3d-statPop 0.48s cubic-bezier(0.34,1.56,0.64,1) 0.66s both; }
        .rpg-stat-box:nth-child(4) { animation:k3d-statPop 0.48s cubic-bezier(0.34,1.56,0.64,1) 0.74s both; }
        .rpg-stat-box:hover {
          transform:translateY(-2px) scale(1.07);
          border-color:rgba(255,255,255,0.15);
          background:rgba(255,255,255,0.07);
          box-shadow:0 4px 16px rgba(0,0,0,0.3);
        }

        /* ── HP/MP/EXP bar fills ── */
        .rpg-bar-fill {
          height:100%; border-radius:4px;
          transform-origin:left center;
          animation:k3d-barFill 0.8s cubic-bezier(0.16,1,0.3,1) 0.35s both;
          position:relative; overflow:hidden;
        }
        .rpg-bar-fill::after {
          content:''; position:absolute; inset:0;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent);
          background-size:200% 100%;
          animation:k3d-shimmer 2.5s ease-in-out 1.2s infinite;
        }
        .rpg-bar-hp  { background:linear-gradient(90deg,#30d158,#30d15890); box-shadow:0 0 8px rgba(48,209,88,0.4); }
        .rpg-bar-mp  { background:linear-gradient(90deg,#007aff,#5ac8fa);   box-shadow:0 0 6px rgba(90,200,250,0.35); }
        .rpg-bar-exp { background:linear-gradient(90deg,#c8f500,#00e5ff); }

        /* ── Battle button (Berburu Monster) ── */
        .rpg-battle-btn {
          position:relative; display:flex; align-items:center; gap:10px;
          width:100%; grid-column:span 2;
          background:linear-gradient(135deg,rgba(255,55,95,0.15),rgba(255,55,95,0.05));
          border:1px solid rgba(255,55,95,0.4);
          border-radius:14px; padding:13px 15px;
          cursor:pointer; color:#fff; text-align:left; overflow:hidden;
          transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s ease, border-color 0.2s;
          animation:k3d-slideUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.55s both,
                    k3d-battleGlow 2.5s ease-in-out 1.2s infinite;
        }
        .rpg-battle-btn::before {
          content:''; position:absolute; inset:0;
          background:linear-gradient(105deg,transparent 30%,rgba(255,55,95,0.1) 50%,transparent 70%);
          background-size:200% 100%; animation:k3d-shimmer 2.8s ease-in-out infinite;
          border-radius:inherit; pointer-events:none;
        }
        .rpg-battle-btn:hover {
          transform:translateY(-2px) scale(1.01);
          box-shadow:0 10px 36px rgba(255,55,95,0.22);
          border-color:rgba(255,55,95,0.7);
        }
        .rpg-battle-btn:active { transform:scale(0.97) translateY(1px); transition-duration:0.08s; }

        /* ── Menu grid buttons ── */
        .rpg-menu-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:7px; }
        .rpg-menu-btn {
          position:relative; border-radius:12px; padding:11px 12px;
          cursor:pointer; text-align:left; color:#fff;
          border:1px solid rgba(255,255,255,0.08);
          overflow:hidden;
          transition:transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s, border-color 0.18s;
          opacity:0;
          animation:k3d-slideUp 0.42s cubic-bezier(0.16,1,0.3,1) calc(0.65s + var(--si,0) * 0.042s) forwards;
        }
        .rpg-menu-btn::before {
          content:''; position:absolute; inset:0;
          background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,0.06) 50%,transparent 100%);
          background-size:200% 100%; opacity:0; transition:opacity 0.2s;
          border-radius:inherit; pointer-events:none;
        }
        .rpg-menu-btn:hover::before { opacity:1; }
        .rpg-menu-btn:hover {
          transform:translateY(-2px) scale(1.025);
          border-color:rgba(255,255,255,0.18);
          box-shadow:0 6px 22px rgba(0,0,0,0.35);
        }
        .rpg-menu-btn:active { transform:scale(0.965) translateY(1px); transition-duration:0.07s; }
        .rpg-menu-btn.rpg-menu-reward {
          border-color:rgba(200,245,0,0.25);
          animation:k3d-slideUp 0.42s cubic-bezier(0.16,1,0.3,1) calc(0.65s + var(--si,0) * 0.042s) forwards,
                    k3d-glow 2s ease-in-out calc(1.5s + var(--si,0) * 0.042s) infinite;
        }
        .rpg-menu-btn-label { font-size:12px; font-weight:800; line-height:1.2; position:relative; z-index:1; }
        .rpg-menu-btn-sub   { font-size:10px; color:rgba(255,255,255,0.38); margin-top:2px; position:relative; z-index:1; }

        /* ── Class change button ── */
        .rpg-class-change-btn {
          width:100%; background:rgba(255,255,255,0.03);
          border:1px solid rgba(245,255,0,0.18); border-radius:11px;
          padding:10px 14px; cursor:pointer; color:#f5ff00;
          font-size:12px; font-weight:700; letter-spacing:0.3px;
          transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s, border-color 0.2s, background 0.2s;
          animation:k3d-slideUp 0.5s cubic-bezier(0.16,1,0.3,1) 1.5s both;
        }
        .rpg-class-change-btn:hover {
          transform:translateY(-1px);
          border-color:rgba(245,255,0,0.4);
          background:rgba(245,255,0,0.04);
          box-shadow:0 4px 20px rgba(245,255,0,0.07);
        }
        .rpg-class-change-btn:active { transform:scale(0.97); transition-duration:0.07s; }

        /* ── Chat messages smooth entrance ── */
        .gc-msg-row { animation:k3d-slideUp 0.32s cubic-bezier(0.16,1,0.3,1) both; }
        .gc-bubble { transition:transform 0.15s cubic-bezier(0.34,1.56,0.64,1); }
        .gc-bubble:hover { transform:translateY(-1px) scale(1.01); }

        /* ── Toast 3D ── */
        @keyframes k3d-toastIn {
          from { opacity:0; transform:translateY(-14px) scale(0.92) rotateX(5deg); }
          to   { opacity:1; transform:translateY(0) scale(1) rotateX(0deg); }
        }
        .kyoko-toast { animation:k3d-toastIn 0.38s cubic-bezier(0.34,1.56,0.64,1) both !important; }

        /* ── Fish buttons ── */
        .fish-menu-btn { transition:transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.18s; }
        .fish-menu-btn:hover { transform:translateY(-2px) scale(1.02); box-shadow:0 6px 20px rgba(0,0,0,0.3); }
        .fish-menu-btn:active { transform:scale(0.96); }
        .fish-main-btn { transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s; }
        .fish-main-btn:hover { transform:translateY(-2px) scale(1.01); box-shadow:0 8px 28px rgba(79,195,247,0.15); }

        /* ── Modal 3D ── */
        @keyframes k3d-modalUp {
          from { opacity:0; transform:translateY(36px) scale(0.96); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        .gc2-modal { animation:k3d-modalUp 0.42s cubic-bezier(0.16,1,0.3,1) both !important; }

        /* ── Scrollbar neon ── */
        .rpg-dashboard-scroll::-webkit-scrollbar { width:3px; }
        .rpg-dashboard-scroll::-webkit-scrollbar-thumb { background:rgba(200,245,0,0.15); border-radius:2px; }
        .rpg-dashboard-scroll::-webkit-scrollbar-thumb:hover { background:rgba(200,245,0,0.3); }

      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatBar({ val, max, type }: { val: number; max: number; type: 'hp'|'mp'|'exp' }) {
  const pct = Math.max(0, Math.min(1, val / max)) * 100
  const color = type === 'hp' ? 'linear-gradient(90deg,#ff2d55,#ff6b35)' : type === 'mp' ? 'linear-gradient(90deg,#007aff,#5ac8fa)' : 'linear-gradient(90deg,#f5ff00,#00e5ff)'
  return (
    <div style={{ position:'relative', background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden', height:8 }}>
      <div style={{ height:'100%', borderRadius:3, background:color, width:`${pct}%`, transition:'width .5s cubic-bezier(.4,0,.2,1)', boxShadow: type==='hp'?'0 0 8px rgba(255,45,85,0.6)':type==='mp'?'0 0 8px rgba(0,122,255,0.6)':'0 0 8px rgba(245,255,0,0.5)' }}/>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG MINING COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgMining({ char, msg, onMine, onSessionEnd, onBack }: {
  char: RpgChar; msg: string; onMine: () => void; onSessionEnd: () => void; onBack: () => void
}) {
  const ores = char.ores || {}
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sparkPos, setSparkPos] = useState<{x:number,y:number,id:number}[]>([])
  const [pickAngle, setPickAngle] = useState(0)
  const sessionEndCalledRef = React.useRef(false)

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 500)
    return () => clearInterval(iv)
  }, [])

  const now = Date.now()
  const sessionStart = char.mineSessionStart || 0
  const sessionActive = sessionStart > 0 && (now - sessionStart) < MINE_SESSION_MS
  const sessionElapsed = sessionActive ? now - sessionStart : 0
  const sessionPct = sessionActive ? Math.min(100, (sessionElapsed / MINE_SESSION_MS) * 100) : 0
  const sessionRemSec = sessionActive ? Math.ceil((MINE_SESSION_MS - sessionElapsed) / 1000) : 0
  const sessionRemMin = Math.floor(sessionRemSec / 60)
  const sessionRemS = sessionRemSec % 60

  const lastMine = (char.trainCooldowns?.mine || 0)
  const coolRemain = !sessionActive && lastMine > 0 ? Math.max(0, MINE_COOLDOWN_MS - (now - lastMine)) : 0
  const onCooldown = coolRemain > 0
  const coolMin = Math.floor(coolRemain / 60000)
  const coolSec = Math.floor((coolRemain % 60000) / 1000)
  const coolPct = onCooldown ? Math.min(100, ((MINE_COOLDOWN_MS - coolRemain) / MINE_COOLDOWN_MS) * 100) : 100

  // Auto-end session when timer runs out
  useEffect(() => {
    if (sessionActive && sessionRemSec <= 0 && !sessionEndCalledRef.current) {
      sessionEndCalledRef.current = true
      onSessionEnd()
    }
    if (!sessionActive) sessionEndCalledRef.current = false
  }, [sessionActive, sessionRemSec])

  // Pickaxe swing animation during session
  useEffect(() => {
    if (!sessionActive) return
    let dir = 1
    const iv = setInterval(() => {
      setPickAngle(a => {
        const next = a + dir * 22
        if (next > 40 || next < -40) dir *= -1
        return next
      })
      // Sparks
      if (Math.random() > 0.5) {
        setSparkPos(prev => [
          ...prev.slice(-6),
          { x: 48 + Math.random() * 20 - 10, y: 52 + Math.random() * 10 - 5, id: Date.now() }
        ])
      }
    }, 180)
    return () => clearInterval(iv)
  }, [sessionActive])

  const handleMine = async () => {
    if (onCooldown || loading) return
    setLoading(true)
    try { await (onMine as any)() } finally { setLoading(false) }
  }

  const S = {
    wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const},
    back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0},
    title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4},
    card:{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:12,marginBottom:8}
  }

  return (
    <div style={S.wrap} className="gc2-fadein">
      <style>{`
        @keyframes mine-rock-shake {
          0%,100% { transform: translateX(0); }
          25% { transform: translateX(-2px) rotate(-1deg); }
          75% { transform: translateX(2px) rotate(1deg); }
        }
        @keyframes mine-spark {
          0%   { transform: scale(1) translate(0,0); opacity:1; }
          100% { transform: scale(0) translate(var(--sx),var(--sy)); opacity:0; }
        }
        @keyframes mine-ore-drop {
          0%   { transform: translateY(-10px); opacity:0; }
          30%  { opacity:1; }
          100% { transform: translateY(0); opacity:1; }
        }
        @keyframes mine-glow-pulse {
          0%,100% { box-shadow: 0 0 0 rgba(200,120,30,0); }
          50%      { box-shadow: 0 0 20px rgba(200,120,30,0.4), 0 0 40px rgba(200,120,30,0.15); }
        }
        @keyframes mine-progress-shine {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes mine-cd-wave {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .mine-btn-active {
          animation: mine-glow-pulse 1.5s ease-in-out infinite;
          transition: transform 0.1s;
        }
        .mine-btn-active:active { transform: scale(0.97) !important; }
        .mine-scene {
          position: relative; width: 100%; height: 110px;
          background: linear-gradient(180deg, #1a0e06 0%, #2d1a0a 60%, #3d2211 100%);
          border-radius: 12px; overflow: hidden; margin-bottom: 12px;
          border: 1px solid rgba(200,120,30,0.25);
        }
        .mine-rock {
          position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
          font-size: 38px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));
          animation: mine-rock-shake 0.18s ease-in-out infinite;
        }
        .mine-rock.idle { animation: none; }
        .mine-pick {
          position: absolute; bottom: 42px; left: 50%;
          font-size: 28px; transform-origin: bottom right;
          transition: transform 0.12s ease-in-out;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        }
        .mine-spark {
          position: absolute; font-size: 10px;
          animation: mine-spark 0.4s ease-out forwards;
          pointer-events: none;
        }
        .mine-dust {
          position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
          width: 60px; height: 6px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(180,120,60,0.4) 0%, transparent 70%);
        }
        .mine-progress-bar {
          height: 8px; border-radius: 4px; overflow: hidden;
          background: rgba(255,255,255,0.07); position: relative;
        }
        .mine-progress-fill {
          height: 100%; border-radius: 4px; position: relative; overflow: hidden;
          background: linear-gradient(90deg, #7c4b1e, #c8721e, #ffa040, #c8721e);
          background-size: 200% 100%;
          animation: mine-progress-shine 1.5s linear infinite;
          transition: width 0.8s linear;
        }
        .mine-cd-bar {
          height: 6px; border-radius: 3px; overflow: hidden;
          background: rgba(255,255,255,0.07); position: relative;
        }
        .mine-cd-fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, rgba(100,100,100,0.4), rgba(150,150,150,0.6));
          position: relative; overflow: hidden;
          transition: width 1s linear;
        }
        .mine-cd-wave {
          position: absolute; top:0; left:0; width:25%; height:100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
          animation: mine-cd-wave 2.5s ease-in-out infinite;
        }
      `}</style>

      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>⛏️ Tambang</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>
        Tambang aktif 10 menit, dapat ore otomatis. Cooldown 30 menit setelah selesai.
      </p>

      {msg && (
        <div style={{background:'rgba(200,120,30,0.12)',border:'1px solid rgba(200,120,30,0.35)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#ffa040',marginBottom:10}}>
          {msg}
        </div>
      )}

      {/* Mining scene animation */}
      <div className="mine-scene">
        {/* Stars/dust particles in background */}
        {[...Array(6)].map((_,i) => (
          <div key={i} style={{
            position:'absolute', width:2, height:2, borderRadius:'50%',
            background:'rgba(255,200,100,0.4)',
            left:`${10+i*15}%`, top:`${15+i*10}%`,
            opacity: sessionActive ? 0.6+Math.sin(tick*0.5+i)*0.4 : 0.2
          }}/>
        ))}
        {/* Rock */}
        <div className={`mine-rock${sessionActive?'':' idle'}`}>🪨</div>
        {/* Pickaxe */}
        {sessionActive && (
          <div className="mine-pick" style={{transform:`translateX(-50%) rotate(${pickAngle}deg)`}}>⛏️</div>
        )}
        {!sessionActive && (
          <div style={{position:'absolute',bottom:44,left:'50%',transform:'translateX(-50%) rotate(-30deg)',fontSize:24,opacity:0.4}}>⛏️</div>
        )}
        {/* Sparks */}
        {sparkPos.map((s,i) => (
          <div key={s.id} className="mine-spark" style={{
            left:`${s.x}%`, bottom:`${s.y}%`,
            '--sx': `${(Math.random()-0.5)*20}px`,
            '--sy': `${-(Math.random()*15+5)}px`
          } as React.CSSProperties}>✨</div>
        ))}
        <div className="mine-dust" style={{opacity: sessionActive ? 0.8 : 0.2}}/>
        {/* Status overlay */}
        <div style={{position:'absolute',top:8,right:10,fontSize:10,fontWeight:700,
          color: sessionActive ? '#ffa040' : onCooldown ? 'rgba(255,255,255,0.3)' : '#30d158'}}>
          {sessionActive ? '⛏️ AKTIF' : onCooldown ? '💤 COOLDOWN' : '✅ SIAP'}
        </div>
        {sessionActive && (
          <div style={{position:'absolute',top:8,left:10,fontSize:9,color:'rgba(255,200,100,0.7)'}}>
            {sessionRemMin}:{String(sessionRemS).padStart(2,'0')} tersisa
          </div>
        )}
      </div>

      {/* Session progress bar */}
      {sessionActive && (
        <div style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4}}>
            <span>⏱ Sesi Tambang</span>
            <span style={{color:'#ffa040',fontWeight:700}}>{Math.round(sessionPct)}%</span>
          </div>
          <div className="mine-progress-bar">
            <div className="mine-progress-fill" style={{width:`${sessionPct}%`}}/>
          </div>
          <div style={{fontSize:10,color:'rgba(255,160,60,0.7)',marginTop:3,textAlign:'center'}}>
            Klik batu untuk bonus ore! Selesai dalam {sessionRemMin}:{String(sessionRemS).padStart(2,'0')}
          </div>
        </div>
      )}

      {/* Cooldown bar */}
      {onCooldown && (
        <div style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:4}}>
            <span>💤 Cooldown</span>
            <span>{coolMin}:{String(coolSec).padStart(2,'0')} lagi</span>
          </div>
          <div className="mine-cd-bar">
            <div className="mine-cd-fill" style={{width:`${coolPct}%`}}>
              <div className="mine-cd-wave"/>
            </div>
          </div>
        </div>
      )}

      {/* Action button */}
      <button
        onClick={handleMine}
        disabled={onCooldown || loading}
        className={!onCooldown && !loading ? 'mine-btn-active' : ''}
        style={{
          width:'100%',
          background: onCooldown ? 'rgba(255,255,255,0.04)' :
            sessionActive ? 'linear-gradient(135deg,#5a3010,#8c4f18)' :
            'linear-gradient(135deg,#7c4b1e,#c8721e)',
          border: `1px solid ${onCooldown?'rgba(255,255,255,0.08)':sessionActive?'rgba(140,80,30,0.6)':'rgba(200,120,30,0.6)'}`,
          borderRadius:12, padding:'14px',
          cursor: onCooldown||loading ? 'not-allowed' : 'pointer',
          color: onCooldown ? 'rgba(255,255,255,0.25)' : '#fff',
          fontSize:14, fontWeight:800, marginBottom:12, letterSpacing:0.5
        }}
      >
        {loading ? '⛏️ Menambang...' :
          onCooldown ? `💤 Cooldown ${coolMin}:${String(coolSec).padStart(2,'0')}` :
          sessionActive ? '⛏️ Klik untuk Tambang Bonus!' :
          '⛏️ Mulai Tambang!'}
      </button>

      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>📦 MATERIAL KAMU</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:12}}>
        {ORES.map(o => (
          <div key={o.id} style={{...S.card,display:'flex',alignItems:'center',gap:8,padding:'8px 10px'}}>
            <span style={{fontSize:18}}>{o.emoji}</span>
            <div>
              <div style={{fontSize:11,fontWeight:700}}>{o.name}</div>
              <div style={{fontSize:13,color:'#c8f500',fontWeight:900}}>{ores[o.id] || 0}x</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>📊 KEMUNGKINAN DROP</div>
      {ORES.map(o => (
        <div key={o.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,fontSize:11}}>
          <span>{o.emoji}</span><span style={{flex:1}}>{o.name}</span>
          <span style={{color:o.rarity==='Legendary'?'#ffd700':o.rarity==='Epic'?'#a855f7':o.rarity==='Rare'?'#38bdf8':'rgba(255,255,255,0.5)'}}>{o.chance}%</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG CRAFTING COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgCrafting({ char, msg, onCraft, onBack }: { char: RpgChar; msg: string; onCraft: (r: typeof CRAFT_RECIPES[0]) => void; onBack: () => void }) {
  const ores = char.ores || {}
  const canCraft = (r: typeof CRAFT_RECIPES[0]) => Object.entries(r.materials).every(([m,q]) => (ores[m]||0) >= (q as number))
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>🔨 Meracik / Crafting</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>Gabungkan material tambang menjadi item atau peningkatan stat permanen.</p>
      {msg && <div style={{background:msg.startsWith('✅')?'rgba(0,200,100,0.1)':'rgba(255,50,50,0.1)',border:`1px solid ${msg.startsWith('✅')?'rgba(0,200,100,0.3)':'rgba(255,50,50,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.startsWith('✅')?'#30d158':'#ff6b6b',marginBottom:10}}>{msg}</div>}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>🧪 MATERIAL: {Object.entries(ores).filter(([,v])=>v>0).map(([k,v])=>`${ORES.find(o=>o.id===k)?.emoji||''}${v}x`).join(' ')}</div>
      {CRAFT_RECIPES.map(r => {
        const ok = canCraft(r)
        return (
          <div key={r.id} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${ok?'rgba(200,245,0,0.3)':'rgba(255,255,255,0.08)'}`,borderRadius:12,padding:12,marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <span style={{fontSize:22}}>{r.emoji}</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:800}}>{r.name}</div><div style={{fontSize:10,color:'#c8f500'}}>{r.desc}</div></div>
              <button onClick={()=>onCraft(r)} disabled={!ok} style={{background:ok?'rgba(200,245,0,0.2)':'rgba(255,255,255,0.05)',border:`1px solid ${ok?'rgba(200,245,0,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:8,padding:'6px 10px',cursor:ok?'pointer':'not-allowed',color:ok?'#c8f500':'rgba(255,255,255,0.3)',fontSize:11,fontWeight:700}}>Craft</button>
            </div>
            <div style={{display:'flex',flexWrap:'wrap' as const,gap:4}}>
              {Object.entries(r.materials).map(([m,q])=>{const o=ORES.find(x=>x.id===m);const have=(ores[m]||0);return(<span key={m} style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:(have>=(q as number))?'rgba(0,200,100,0.15)':'rgba(255,50,50,0.15)',color:(have>=(q as number))?'#30d158':'#ff6b6b'}}>{o?.emoji}{o?.name} {have}/{q}</span>)})}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG FARMING COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgFarming({ char, msg, onPlant, onHarvest, onBack }: { char: RpgChar; msg: string; onPlant: (id:string) => void; onHarvest: (idx:number) => void; onBack: () => void }) {
  const crops = char.crops || []
  const [tick, setTick] = useState(0)
  const [harvesting, setHarvesting] = useState<number|null>(null)

  // live tick every second to update progress bars + countdowns
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  const plantedIds = crops.map(c => c.type)

  const handleHarvest = async (idx: number) => {
    if (harvesting !== null) return
    setHarvesting(idx)
    await onHarvest(idx)
    setHarvesting(null)
  }

  // animated floating particles for the empty space
  const particles = ['🌿','🍃','✨','🌱','💧','🌾','⭐','🍀']

  const S = {
    wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const},
    back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0},
    title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4},
    card:{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:12,marginBottom:8}
  }

  return (
    <div style={S.wrap} className="gc2-fadein">
      <style>{`
        @keyframes farm-float {
          0%   { transform: translateY(0px) rotate(0deg); opacity:0.7; }
          50%  { transform: translateY(-18px) rotate(15deg); opacity:1; }
          100% { transform: translateY(0px) rotate(0deg); opacity:0.7; }
        }
        @keyframes farm-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes farm-pulse-glow {
          0%,100% { box-shadow: 0 0 0px #30d158; }
          50%      { box-shadow: 0 0 12px #30d15866, 0 0 24px #30d15833; }
        }
        @keyframes farm-bounce-btn {
          0%,100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
        @keyframes farm-bar-glow {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.6; }
        }
        .farm-harvest-btn {
          background: linear-gradient(135deg, rgba(48,209,88,0.25), rgba(100,220,60,0.15));
          border: 1px solid rgba(48,209,88,0.5);
          border-radius: 8px; padding: 6px 12px; cursor: pointer;
          color: #30d158; font-size: 12px; font-weight: 800;
          animation: farm-bounce-btn 1.2s ease-in-out infinite, farm-pulse-glow 1.5s ease-in-out infinite;
          transition: transform 0.1s;
        }
        .farm-harvest-btn:active { transform: scale(0.95) !important; }
        .farm-harvest-btn.loading {
          opacity: 0.5; cursor: not-allowed;
          animation: none;
        }
        .farm-disabled-btn {
          opacity: 0.38; cursor: not-allowed !important;
          filter: grayscale(0.6);
        }
        .farm-plant-btn {
          background: rgba(60,180,60,0.1);
          border: 1px solid rgba(60,180,60,0.25);
          border-radius: 10px; padding: 10px 8px; cursor: pointer;
          text-align: left; color: #fff; transition: background 0.2s, border-color 0.2s, transform 0.1s;
        }
        .farm-plant-btn:hover:not(.farm-disabled-btn) {
          background: rgba(60,180,60,0.2);
          border-color: rgba(60,180,60,0.5);
          transform: translateY(-1px);
        }
        .farm-plant-btn:active:not(.farm-disabled-btn) { transform: scale(0.97); }
        .farm-progress-track {
          height: 6px; background: rgba(255,255,255,0.08);
          border-radius: 3px; margin: 5px 0; overflow: hidden; position: relative;
        }
        .farm-progress-fill-growing {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, #c8f500, #78e08f, #c8f500);
          background-size: 200% 100%;
          animation: farm-shimmer 1.8s linear infinite;
          transition: width 1s linear;
        }
        .farm-progress-fill-done {
          height: 100%; border-radius: 3px; width: 100%;
          background: linear-gradient(90deg, #30d158, #00e676);
          animation: farm-bar-glow 1s ease-in-out infinite;
        }
        .farm-particle {
          position: absolute; pointer-events: none;
          font-size: 18px; will-change: transform;
        }
        .farm-empty-zone {
          position: relative; min-height: 120px;
          border: 1px dashed rgba(60,180,60,0.15);
          border-radius: 12px; margin-top: 14px;
          overflow: hidden; display: flex;
          align-items: center; justify-content: center;
          background: rgba(30,60,30,0.08);
        }
        .farm-anim-bar-wrap {
          margin-top: 16px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(60,180,60,0.12);
          border-radius: 10px; padding: 10px 12px;
        }
        .farm-anim-bar-label {
          font-size: 10px; color: rgba(255,255,255,0.35);
          margin-bottom: 5px; font-family: monospace; letter-spacing: 0.5px;
        }
        .farm-anim-bar-track {
          height: 8px; background: rgba(255,255,255,0.06);
          border-radius: 4px; overflow: hidden; position: relative;
        }
        @keyframes farm-wave {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .farm-anim-bar-wave {
          position: absolute; top:0; left:0; width:25%; height:100%;
          background: linear-gradient(90deg, transparent, rgba(200,245,0,0.35), transparent);
          animation: farm-wave 2s ease-in-out infinite;
          border-radius: 4px;
        }
        .farm-anim-bar-fill {
          height: 100%; border-radius: 4px;
          background: linear-gradient(90deg, rgba(60,180,60,0.4), rgba(200,245,0,0.5));
          position: relative; overflow: hidden;
          transition: width 1s linear;
        }
      `}</style>

      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>🌾 Kebun</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>
        Tanam & panen tanaman. Hasil kebun dipakai untuk memasak makanan berbuff.
      </p>

      {msg && (
        <div style={{background:'rgba(60,180,60,0.1)',border:'1px solid rgba(60,180,60,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#30d158',marginBottom:10}}>
          {msg}
        </div>
      )}

      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>
        🌱 LAHAN ({crops.length}/{FARM_SLOTS})
      </div>

      {/* Active crops with live progress */}
      {crops.map((c, i) => {
        const crop = CROPS.find(x => x.id === c.type)!
        const elapsed = now - c.plantedAt
        const done = elapsed >= crop.growMs
        const pct = Math.min(100, (elapsed / crop.growMs) * 100)
        const mntLeft = Math.ceil((crop.growMs - elapsed) / 60000)
        const secLeft = Math.ceil((crop.growMs - elapsed) / 1000)
        const timeStr = secLeft <= 90
          ? `${secLeft}d lagi`
          : `${mntLeft} mnt lagi`
        const isLoading = harvesting === i
        return (
          <div key={i} style={{...S.card, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:28, filter: done ? 'drop-shadow(0 0 6px #30d15899)' : 'none', transition:'filter .5s'}}>
              {crop.emoji}
            </span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700,display:'flex',justifyContent:'space-between'}}>
                <span>{crop.name}</span>
                {!done && <span style={{fontSize:10,color:'rgba(255,255,255,0.35)',fontWeight:400}}>{timeStr}</span>}
                {done && <span style={{fontSize:10,color:'#30d158',fontWeight:700}}>✅ Siap!</span>}
              </div>
              <div className="farm-progress-track">
                {done
                  ? <div className="farm-progress-fill-done"/>
                  : <div className="farm-progress-fill-growing" style={{width:`${pct}%`}}/>
                }
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{Math.round(pct)}%</span>
                {!done && (
                  <span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>
                    jual {crop.sellGold}G
                  </span>
                )}
              </div>
            </div>
            {done && (
              <button
                className={`farm-harvest-btn${isLoading?' loading':''}`}
                onClick={() => handleHarvest(i)}
                disabled={isLoading || harvesting !== null}
              >
                {isLoading ? '⏳' : '🌾'}<br/>
                <span style={{fontSize:10}}>{isLoading?'...':'Panen'}</span>
              </button>
            )}
          </div>
        )
      })}

      {/* Plant new crops */}
      {crops.length < FARM_SLOTS && (
        <>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace',marginTop:8}}>
            🌱 TANAM BARU
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            {CROPS.map(c => {
              const alreadyPlanted = plantedIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  className={`farm-plant-btn${alreadyPlanted?' farm-disabled-btn':''}`}
                  onClick={() => !alreadyPlanted && onPlant(c.id)}
                  disabled={alreadyPlanted}
                  title={alreadyPlanted ? 'Sudah ditanam, tunggu panen dulu!' : ''}
                >
                  <div style={{fontSize:18, filter: alreadyPlanted?'grayscale(1)':'none'}}>{c.emoji}</div>
                  <div style={{fontSize:11,fontWeight:700,marginTop:2}}>
                    {c.name}
                    {alreadyPlanted && <span style={{fontSize:9,color:'rgba(255,200,0,0.6)',marginLeft:4}}>⏳</span>}
                  </div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{Math.round(c.growMs/60000)} mnt • jual {c.sellGold}G</div>
                  {alreadyPlanted && (
                    <div style={{fontSize:9,color:'rgba(255,200,80,0.5)',marginTop:2}}>Sedang tumbuh...</div>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── Animated progress display zone (empty space) ── */}
      <div className="farm-anim-bar-wrap">
        <div className="farm-anim-bar-label">📊 STATUS LAHAN AKTIF</div>
        {crops.length === 0 ? (
          <div style={{textAlign:'center',padding:'12px 0',color:'rgba(255,255,255,0.2)',fontSize:11}}>
            Tidak ada tanaman aktif
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {crops.map((c, i) => {
              const crop = CROPS.find(x => x.id === c.type)!
              const elapsed = now - c.plantedAt
              const done = elapsed >= crop.growMs
              const pct = Math.min(100, (elapsed / crop.growMs) * 100)
              const secLeft = Math.ceil((crop.growMs - elapsed) / 1000)
              const mntLeft = Math.floor(secLeft / 60)
              const sLeft = secLeft % 60
              return (
                <div key={i}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:3}}>
                    <span>{crop.emoji} {crop.name}</span>
                    <span style={{color: done ? '#30d158' : '#c8f500', fontWeight:700}}>
                      {done ? '✅ SIAP PANEN' : `⏱ ${mntLeft > 0 ? `${mntLeft}m ` : ''}${sLeft}s`}
                    </span>
                  </div>
                  <div className="farm-anim-bar-track">
                    <div
                      className="farm-anim-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: done
                          ? 'linear-gradient(90deg, #30d158, #00e676)'
                          : `linear-gradient(90deg, rgba(60,180,60,0.5), rgba(200,245,0,0.7))`,
                      }}
                    >
                      {!done && <div className="farm-anim-bar-wave"/>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Floating particle animation zone */}
      {crops.length > 0 && (
        <div className="farm-empty-zone" style={{minHeight:80}}>
          {particles.map((p, i) => (
            <span
              key={i}
              className="farm-particle"
              style={{
                left: `${(i * 12.5) % 92}%`,
                bottom: `${10 + (i * 7) % 60}%`,
                animationName: 'farm-float',
                animationDuration: `${1.8 + (i * 0.4) % 2}s`,
                animationDelay: `${(i * 0.35) % 2}s`,
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                opacity: 0.4 + (i % 3) * 0.15,
                fontSize: 14 + (i % 3) * 4,
              }}
            >
              {p}
            </span>
          ))}
          <span style={{fontSize:11,color:'rgba(255,255,255,0.15)',zIndex:1}}>🌿 Kebun aktif...</span>
        </div>
      )}

      <div style={{marginTop:12,fontSize:11,color:'rgba(255,255,255,0.4)'}}>
        📦 Material kebun: {CROPS.map(c => `${c.emoji}${(char.ores||{})[c.id]||0}x`).join(' ')}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG COOKING COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgCooking({ char, msg, onCook, onBack }: { char: RpgChar; msg: string; onCook: (r: typeof RECIPES_COOK[0]) => void; onBack: () => void }) {
  const ores = char.ores || {}
  const now = Date.now()
  const activeBuffs = (char.foodBuffs || []).filter(b => b.expiresAt > now)
  const canCook = (r: typeof RECIPES_COOK[0]) => Object.entries(r.ing).every(([m,q])=>(ores[m as string]||0)>=(q as number))
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>🍳 Memasak</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>Masak makanan dari hasil kebun untuk mendapat buff stat sementara!</p>
      {msg && <div style={{background:'rgba(255,150,50,0.1)',border:'1px solid rgba(255,150,50,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#fb923c',marginBottom:10}}>{msg}</div>}
      {activeBuffs.length > 0 && (
        <div style={{background:'rgba(255,215,0,0.08)',border:'1px solid rgba(255,215,0,0.2)',borderRadius:10,padding:10,marginBottom:10}}>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:6,fontFamily:'monospace'}}>✨ BUFF AKTIF</div>
          {activeBuffs.map((b,i)=>(
            <div key={i} style={{fontSize:11,color:'#ffd700',marginBottom:2}}>+{b.value} {b.stat.toUpperCase()} — {Math.ceil((b.expiresAt-now)/60000)} mnt lagi</div>
          ))}
        </div>
      )}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>
        Kebun: {CROPS.map(c=>`${c.emoji}${ores[c.id]||0}x`).join(' ')}
      </div>
      {RECIPES_COOK.map(r=>{
        const ok=canCook(r)
        return (
          <div key={r.id} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${ok?'rgba(255,150,50,0.35)':'rgba(255,255,255,0.08)'}`,borderRadius:12,padding:12,marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:24}}>{r.emoji}</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:800}}>{r.name}</div><div style={{fontSize:10,color:'#fb923c'}}>{r.desc}</div></div>
              <button onClick={()=>onCook(r)} disabled={!ok} style={{background:ok?'rgba(255,150,50,0.2)':'rgba(255,255,255,0.05)',border:`1px solid ${ok?'rgba(255,150,50,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:8,padding:'6px 10px',cursor:ok?'pointer':'not-allowed',color:ok?'#fb923c':'rgba(255,255,255,0.3)',fontSize:11,fontWeight:700}}>Masak</button>
            </div>
            <div style={{display:'flex',flexWrap:'wrap' as const,gap:4,marginTop:6}}>
              {Object.entries(r.ing).map(([m,q])=>{const crop=CROPS.find(c=>c.id===m);const have=ores[m]||0;return(<span key={m} style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:(have>=(q as number))?'rgba(0,200,100,0.15)':'rgba(255,50,50,0.15)',color:(have>=(q as number))?'#30d158':'#ff6b6b'}}>{crop?.emoji}{crop?.name} {have}/{q}</span>)})}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG TRAINING COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgTraining({ char, msg, onTrain, onBack }: { char: RpgChar; msg: string; onTrain: (t: typeof TRAININGS[0]) => void; onBack: () => void }) {
  const [tick, setTick] = useState(0)
  const [trainingId, setTrainingId] = useState<string|null>(null)
  const [trainAnim, setTrainAnim] = useState<Record<string,boolean>>({})

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  const now = Date.now()

  const handleTrain = async (t: typeof TRAININGS[0]) => {
    if (trainingId) return
    setTrainingId(t.id)
    setTrainAnim(prev => ({...prev, [t.id]: true}))
    await (onTrain as any)(t)
    setTimeout(() => {
      setTrainAnim(prev => ({...prev, [t.id]: false}))
      setTrainingId(null)
    }, 800)
  }

  const TRAIN_COLORS: Record<string,string> = {
    atk: '#ff6b6b', def: '#4fc3f7', spd: '#69ff69', luck: '#ffd700', hp: '#ff8a80', mp: '#82b1ff'
  }

  const S = {
    wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const},
    back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0},
    title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4}
  }

  return (
    <div style={S.wrap} className="gc2-fadein">
      <style>{`
        @keyframes train-pulse {
          0%,100% { transform: scale(1); }
          50%      { transform: scale(1.12); }
        }
        @keyframes train-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes train-ready-glow {
          0%,100% { box-shadow: 0 0 0 rgba(100,150,255,0); }
          50%      { box-shadow: 0 0 10px rgba(100,150,255,0.3); }
        }
        @keyframes train-cd-fill {
          from { opacity: 0.5; } to { opacity: 1; }
        }
        .train-card-ready {
          animation: train-ready-glow 2s ease-in-out infinite;
        }
        .train-btn {
          border-radius: 8px; padding: 7px 12px;
          font-size: 11px; font-weight: 800; cursor: pointer;
          transition: transform 0.1s, box-shadow 0.2s;
          border: none;
        }
        .train-btn:active { transform: scale(0.92); }
        .train-btn-ready {
          background: linear-gradient(135deg, rgba(100,150,255,0.3), rgba(130,177,255,0.2));
          border: 1px solid rgba(100,150,255,0.5) !important;
          color: #818cf8 !important;
          box-shadow: 0 0 8px rgba(100,150,255,0.2);
        }
        .train-btn-disabled {
          background: rgba(255,255,255,0.04) !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.25) !important;
          cursor: not-allowed !important;
        }
        .train-progress-track {
          height: 5px; border-radius: 3px; overflow: hidden;
          background: rgba(255,255,255,0.07); margin: 4px 0;
        }
        .train-progress-fill {
          height: 100%; border-radius: 3px;
          transition: width 1s linear;
        }
        .train-progress-active {
          background-size: 200% 100%;
          animation: train-shimmer 1.2s linear infinite;
        }
        .train-emoji-anim {
          display: inline-block;
          animation: train-pulse 0.4s ease-in-out 3;
        }
      `}</style>

      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>💪 Training</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>
        Habiskan Gold untuk meningkatkan stat permanen. Cooldown 1 jam per latihan.
      </p>
      {msg && (
        <div style={{background:'rgba(100,150,255,0.1)',border:'1px solid rgba(100,150,255,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#818cf8',marginBottom:10}}>
          {msg}
        </div>
      )}
      <div style={{fontSize:12,color:'#ffd700',marginBottom:10}}>💰 Gold: {char.gold.toLocaleString()}G</div>

      {TRAININGS.map(t => {
        const last = (char.trainCooldowns||{})[t.id] || 0
        const remain = Math.max(0, t.coolMs - (now - last))
        const ready = remain === 0
        const canTrain = ready && char.gold >= t.cost
        const cdPct = ready ? 100 : Math.min(100, ((t.coolMs - remain) / t.coolMs) * 100)
        const cdMin = Math.floor(remain / 60000)
        const cdSec = Math.floor((remain % 60000) / 1000)
        const curVal = t.stat==='maxHp' ? char.maxHp : t.stat==='maxMp' ? char.maxMp : (char as any)[t.stat] || 0
        const color = TRAIN_COLORS[t.id] || '#818cf8'
        const isAnimating = trainAnim[t.id]
        const isBusy = trainingId === t.id

        return (
          <div
            key={t.id}
            className={canTrain ? 'train-card-ready' : ''}
            style={{
              background: ready ? `${color}08` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${ready ? color+'30' : 'rgba(255,255,255,0.07)'}`,
              borderRadius:12, padding:12, marginBottom:8,
              transition: 'border-color 0.3s, background 0.3s'
            }}
          >
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span className={isAnimating ? 'train-emoji-anim' : ''} style={{fontSize:26}}>
                {t.emoji}
              </span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:800,color: ready ? '#fff' : 'rgba(255,255,255,0.5)'}}>
                  {t.name}
                </div>
                <div style={{fontSize:10,color}}>
                  {t.desc} • {t.cost}G
                </div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:1}}>
                  Saat ini: <span style={{color:'#fff',fontWeight:700}}>{curVal}</span>
                  {!ready && <span style={{color:'rgba(255,255,255,0.25)'}}> → {curVal + t.gain} setelah cooldown</span>}
                  {ready && <span style={{color}} > → {curVal + t.gain} setelah latihan</span>}
                </div>
              </div>
              <button
                className={`train-btn ${canTrain ? 'train-btn-ready' : 'train-btn-disabled'}`}
                onClick={() => canTrain && handleTrain(t)}
                disabled={!canTrain || !!trainingId}
                style={{border:'none',minWidth:52}}
              >
                {isBusy ? '💪' : ready ? 'Latih' : '⏳'}
              </button>
            </div>

            {/* Cooldown progress bar */}
            <div style={{marginTop:7}}>
              <div className="train-progress-track">
                <div
                  className={`train-progress-fill ${!ready ? 'train-progress-active' : ''}`}
                  style={{
                    width: `${cdPct}%`,
                    background: ready
                      ? `linear-gradient(90deg, ${color}, ${color}aa)`
                      : `linear-gradient(90deg, rgba(100,100,120,0.5), rgba(130,130,160,0.7), rgba(100,100,120,0.5))`,
                    backgroundSize: '200% 100%',
                  }}
                />
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:9,marginTop:2}}>
                <span style={{color: ready ? color : 'rgba(255,255,255,0.25)'}}>
                  {ready ? '✅ Siap!' : `⏳ ${cdMin}:${String(cdSec).padStart(2,'0')} lagi`}
                </span>
                <span style={{color:'rgba(255,255,255,0.2)'}}>{Math.round(cdPct)}%</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG DUEL COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgDuel({ char, leaderboard, msg, loading, onDuel, onBack }: { char: RpgChar; leaderboard: {username:string;level:number;class:RpgClass;kills:number}[]; msg: string; loading: boolean; onDuel: (opp:any) => void; onBack: () => void }) {
  const rec = char.duelRecord || { wins:0, losses:0 }
  const opponents = leaderboard.filter(l => l.username !== char.username).slice(0, 8)
  const now = Date.now()
  const duelCooldownUntil = char.duelCooldown || 0
  const duelOnCd = now < duelCooldownUntil
  const duelCdMin = duelOnCd ? Math.ceil((duelCooldownUntil - now) / 60000) : 0
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>⚔️ Duel PvP</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>Tantang player lain! Menang dapat Gold & EXP. Cooldown 5 menit per duel.</p>
      {duelOnCd && <div style={{background:'rgba(255,100,50,0.1)',border:'1px solid rgba(255,100,50,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#ff8a50',marginBottom:8}}>⏳ Cooldown duel: {duelCdMin} menit lagi</div>}
      <div style={{background:'rgba(255,60,60,0.1)',border:'1px solid rgba(255,60,60,0.2)',borderRadius:10,padding:'8px 12px',marginBottom:10,display:'flex',gap:20}}>
        <div style={{textAlign:'center' as const}}><div style={{fontSize:18,fontWeight:900,color:'#30d158'}}>{rec.wins}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Menang</div></div>
        <div style={{textAlign:'center' as const}}><div style={{fontSize:18,fontWeight:900,color:'#ff375f'}}>{rec.losses}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Kalah</div></div>
        <div style={{textAlign:'center' as const}}><div style={{fontSize:18,fontWeight:900,color:'#ffd700'}}>{rec.wins+rec.losses>0?Math.round(rec.wins/(rec.wins+rec.losses)*100):0}%</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Win Rate</div></div>
      </div>
      {msg && <div style={{background:msg.includes('MENANG')?'rgba(0,200,100,0.1)':msg.includes('⏳')?'rgba(255,100,50,0.1)':'rgba(255,50,50,0.1)',border:`1px solid ${msg.includes('MENANG')?'rgba(0,200,100,0.3)':msg.includes('⏳')?'rgba(255,100,50,0.3)':'rgba(255,50,50,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.includes('MENANG')?'#30d158':msg.includes('⏳')?'#ff8a50':'#ff6b6b',marginBottom:10}}>{msg}</div>}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>👥 PILIH LAWAN</div>
      {opponents.length === 0 && <div style={{fontSize:12,color:'rgba(255,255,255,0.3)',textAlign:'center' as const,padding:20}}>Belum ada player lain di leaderboard</div>}
      {opponents.map((opp,i)=>{
        const cls=RPG_CLASSES[opp.class]
        return (
          <div key={i} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,60,60,0.2)',borderRadius:12,padding:10,marginBottom:7,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:22}}>{cls.emoji}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:800}}>{opp.username}</div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Lv.{opp.level} {opp.class} • {opp.kills} kills</div>
            </div>
            <button onClick={()=>onDuel(opp)} disabled={loading||duelOnCd} style={{background:duelOnCd?'rgba(80,80,80,0.2)':'rgba(255,60,60,0.2)',border:`1px solid ${duelOnCd?'rgba(80,80,80,0.3)':'rgba(255,60,60,0.4)'}`,borderRadius:8,padding:'6px 10px',cursor:duelOnCd?'not-allowed':'pointer',color:duelOnCd?'rgba(255,255,255,0.3)':'#ff375f',fontSize:11,fontWeight:700}}>
              {loading?'...':duelOnCd?`⏳${duelCdMin}m`:'Duel!'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG WILD QUEST COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgWildQuest({ char, quest, msg, onRoll, onClaim, onBack }: { char: RpgChar; quest: typeof WILD_QUEST_POOL[0]|null; msg: string; onRoll: () => void; onClaim: () => void; onBack: () => void }) {
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  const now = Date.now()
  const cooldownUntil = char.wildQuestCooldown || 0
  const isOnCooldown = now < cooldownUntil
  const remainingMin = isOnCooldown ? Math.ceil((cooldownUntil - now) / 60000) : 0
  const remainingHr = Math.floor(remainingMin / 60)
  const remainingMinRem = remainingMin % 60
  const cooldownText = remainingHr > 0 ? `${remainingHr}j ${remainingMinRem}m` : `${remainingMin}m`

  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>🎲 Wild Quest</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:12}}>Quest acak dengan reward! Selesaikan misi dulu, lalu klaim reward.</p>
      {isOnCooldown && (
        <div style={{background:'rgba(255,100,50,0.1)',border:'1px solid rgba(255,100,50,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#ff8a50',marginBottom:10}}>
          ⏳ Cooldown: tersedia lagi dalam <b>{cooldownText}</b>
        </div>
      )}
      {msg && <div style={{background: msg.includes('❌') ? 'rgba(255,50,50,0.1)' : msg.includes('⏳') ? 'rgba(255,100,50,0.1)' : 'rgba(180,50,200,0.1)',border:`1px solid ${msg.includes('❌')?'rgba(255,50,50,0.3)':msg.includes('⏳')?'rgba(255,100,50,0.3)':'rgba(180,50,200,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.includes('❌')?'#ff6b6b':msg.includes('⏳')?'#ff8a50':'#d946ef',marginBottom:10}}>{msg}</div>}
      {!quest ? (
        <button onClick={onRoll} disabled={isOnCooldown} style={{width:'100%',background: isOnCooldown ? 'rgba(80,80,80,0.2)' : 'linear-gradient(135deg,rgba(180,50,200,0.3),rgba(100,50,200,0.2))',border:`1px solid ${isOnCooldown?'rgba(80,80,80,0.3)':'rgba(180,50,200,0.4)'}`,borderRadius:12,padding:16,cursor:isOnCooldown?'not-allowed':'pointer',color:isOnCooldown?'rgba(255,255,255,0.3)':'#d946ef',fontSize:15,fontWeight:800}}>
          {isOnCooldown ? `🔒 Terkunci (${cooldownText} lagi)` : '🎲 Roll Quest Acak!'}
        </button>
      ) : (
        <div style={{background:'rgba(180,50,200,0.08)',border:'1px solid rgba(180,50,200,0.3)',borderRadius:14,padding:14}}>
          <div style={{fontSize:13,fontWeight:800,marginBottom:4}}>{quest.desc}</div>
          <div style={{fontSize:10,color:'rgba(255,200,100,0.7)',marginBottom:8}}>⚠️ Harus diselesaikan dulu sebelum klaim!</div>
          <div style={{display:'flex',gap:12,marginBottom:12}}>
            <div style={{textAlign:'center' as const}}><div style={{fontSize:16,color:'#ffd700',fontWeight:900}}>+{quest.reward.gold}G</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Gold</div></div>
            <div style={{textAlign:'center' as const}}><div style={{fontSize:16,color:'#30d158',fontWeight:900}}>+{quest.reward.exp}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>EXP</div></div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={onClaim} style={{flex:1,background:'rgba(180,50,200,0.2)',border:'1px solid rgba(180,50,200,0.4)',borderRadius:10,padding:'10px',cursor:'pointer',color:'#d946ef',fontSize:13,fontWeight:700}}>✅ Klaim Reward</button>
            <button onClick={onRoll} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 12px',cursor:'pointer',color:'rgba(255,255,255,0.5)',fontSize:12}}>🔄 Re-roll</button>
          </div>
          <div style={{fontSize:10,color:'rgba(255,165,50,0.5)',marginTop:8,textAlign:'center' as const}}>⏱️ Setelah klaim, cooldown 2 jam berlaku</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG INVEST COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgInvest({ char, msg, input, onInput, onInvest, onClaim, onBack }: { char: RpgChar; msg: string; input: string; onInput: (v:string)=>void; onInvest: (p: typeof INVEST_PLANS[0])=>void; onClaim: (i:number)=>void; onBack: () => void }) {
  const now = Date.now()
  const investments = char.investments || []
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>💰 Investasi Gold</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>Investasikan Gold-mu dan dapatkan return! Risiko dan keuntungan berbeda-beda.</p>
      <div style={{fontSize:12,color:'#ffd700',marginBottom:8}}>💰 Gold tersedia: {char.gold.toLocaleString()}G</div>
      {msg && <div style={{background:msg.includes('📈')?'rgba(0,200,100,0.1)':msg.includes('📉')?'rgba(255,50,50,0.1)':'rgba(255,215,0,0.1)',border:`1px solid ${msg.includes('📈')?'rgba(0,200,100,0.3)':msg.includes('📉')?'rgba(255,50,50,0.3)':'rgba(255,215,0,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.includes('📈')?'#30d158':msg.includes('📉')?'#ff6b6b':'#ffd700',marginBottom:10}}>{msg}</div>}
      {investments.length > 0 && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:6,fontFamily:'monospace'}}>📊 INVESTASI AKTIF</div>
          {investments.map((inv,i)=>{
            const done=now>=inv.returnAt; const est=Math.floor(inv.amount*inv.mult)
            return (
              <div key={i} style={{background:'rgba(255,215,0,0.06)',border:`1px solid ${done?'rgba(255,215,0,0.4)':'rgba(255,215,0,0.15)'}`,borderRadius:10,padding:'8px 12px',marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700}}>{inv.amount.toLocaleString()}G → ~{est.toLocaleString()}G</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{done?'✅ Siap diclaim!':`⏳ ${Math.ceil((inv.returnAt-now)/60000)} mnt lagi`}</div>
                </div>
                {done && <button onClick={()=>onClaim(i)} style={{background:'rgba(255,215,0,0.2)',border:'1px solid rgba(255,215,0,0.4)',borderRadius:8,padding:'5px 10px',cursor:'pointer',color:'#ffd700',fontSize:11,fontWeight:700}}>Claim</button>}
              </div>
            )
          })}
        </div>
      )}
      <div style={{marginBottom:8}}>
        <input value={input} onChange={e=>onInput(e.target.value)} type="number" placeholder="Jumlah Gold (min. 100)" style={{width:'100%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'8px 10px',color:'#fff',fontSize:12,boxSizing:'border-box' as const,marginBottom:8}} />
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr',gap:7}}>
        {INVEST_PLANS.map(p=>(
          <button key={p.id} onClick={()=>onInvest(p)} style={{background:'rgba(255,215,0,0.07)',border:'1px solid rgba(255,215,0,0.2)',borderRadius:11,padding:'10px 12px',cursor:'pointer',textAlign:'left' as const,color:'#fff'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:20}}>{p.emoji}</span>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:800}}>{p.name}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Return: {Math.round(p.minMult*100)}–{Math.round(p.maxMult*100)}% • {Math.round(p.durMs/60000)} mnt • Risiko {p.risk}</div></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG WEAPON UPGRADE COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgWeaponUpgrade({ char, msg, onUpgrade, onBack }: { char: RpgChar; msg: string; onUpgrade: () => void; onBack: () => void }) {
  const curLvl = char.weaponLevel || 0
  const next = WEAPON_LEVELS[curLvl]
  const ores = char.ores || {}
  const maxed = curLvl >= WEAPON_LEVELS.length
  const canUpgrade = next && Object.entries(next.materials).every(([m,q])=>(ores[m]||0)>=(q as number)) && char.gold >= (next?.goldCost||0)
  const cls = RPG_CLASSES[char.class]
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>🗡️ Upgrade Senjata</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>Perkuat senjatamu menggunakan material tambang. Bonus ATK & DEF permanen!</p>
      <div style={{background:'linear-gradient(135deg,rgba(255,100,0,0.15),rgba(200,50,0,0.08))',border:'1px solid rgba(255,100,0,0.3)',borderRadius:14,padding:14,marginBottom:12,textAlign:'center' as const}}>
        <div style={{fontSize:32}}>{cls.emoji}</div>
        <div style={{fontSize:15,fontWeight:900,marginTop:4}}>Level Senjata: <span style={{color:'#ffd700'}}>{curLvl}/{WEAPON_LEVELS.length}</span></div>
        {curLvl > 0 && <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginTop:2}}>Bonus: +{WEAPON_LEVELS[curLvl-1].atkBonus} ATK +{WEAPON_LEVELS[curLvl-1].defBonus} DEF</div>}
        {maxed && <div style={{fontSize:13,color:'#ffd700',fontWeight:700,marginTop:4}}>🌟 MAX LEVEL!</div>}
      </div>
      {msg && <div style={{background:msg.startsWith('⚔️')?'rgba(255,100,0,0.1)':'rgba(255,50,50,0.1)',border:`1px solid ${msg.startsWith('⚔️')?'rgba(255,100,0,0.3)':'rgba(255,50,50,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.startsWith('⚔️')?'#fb923c':'#ff6b6b',marginBottom:10}}>{msg}</div>}
      {!maxed && next && (
        <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,100,0,0.2)',borderRadius:12,padding:12,marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:800,marginBottom:8}}>Upgrade ke Level {curLvl+1}</div>
          <div style={{fontSize:11,color:'#fb923c',marginBottom:6}}>+{next.atkBonus-(curLvl>0?WEAPON_LEVELS[curLvl-1].atkBonus:0)} ATK  +{next.defBonus-(curLvl>0?WEAPON_LEVELS[curLvl-1].defBonus:0)} DEF</div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4}}>Material dibutuhkan:</div>
            <div style={{display:'flex',flexWrap:'wrap' as const,gap:4}}>
              {Object.entries(next.materials).map(([m,q])=>{const o=ORES.find(x=>x.id===m);const have=ores[m]||0;return(<span key={m} style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:(have>=(q as number))?'rgba(0,200,100,0.15)':'rgba(255,50,50,0.15)',color:(have>=(q as number))?'#30d158':'#ff6b6b'}}>{o?.emoji}{o?.name} {have}/{q}</span>)})}
              <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:char.gold>=next.goldCost?'rgba(255,215,0,0.15)':'rgba(255,50,50,0.15)',color:char.gold>=next.goldCost?'#ffd700':'#ff6b6b'}}>💰{char.gold.toLocaleString()}/{next.goldCost.toLocaleString()}G</span>
            </div>
          </div>
          <button onClick={onUpgrade} disabled={!canUpgrade} style={{width:'100%',background:canUpgrade?'linear-gradient(135deg,rgba(255,100,0,0.3),rgba(200,50,0,0.2))':'rgba(255,255,255,0.05)',border:`1px solid ${canUpgrade?'rgba(255,100,0,0.5)':'rgba(255,255,255,0.1)'}`,borderRadius:10,padding:'12px',cursor:canUpgrade?'pointer':'not-allowed',color:canUpgrade?'#fb923c':'rgba(255,255,255,0.3)',fontWeight:800,fontSize:13}}>
            {canUpgrade?'⚡ Upgrade Senjata!':'❌ Material / Gold Kurang'}
          </button>
        </div>
      )}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:6,fontFamily:'monospace'}}>📊 SEMUA LEVEL</div>
      {WEAPON_LEVELS.map((wl,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.05)',opacity:i<curLvl?0.4:1}}>
          <span style={{fontSize:10,color:i<curLvl?'#30d158':i===curLvl?'#ffd700':'rgba(255,255,255,0.3)',minWidth:20}}>{i<curLvl?'✓':i===curLvl?'▶':''}{i+1}</span>
          <div style={{flex:1,fontSize:10}}><span style={{color:'#fb923c'}}>+{wl.atkBonus}ATK</span> <span style={{color:'#60a5fa'}}>+{wl.defBonus}DEF</span></div>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{wl.goldCost.toLocaleString()}G</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG TRANSFER COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgTransfer({ char, msg, target, amount, onTarget, onAmount, onTransfer, onBack, leaderboard, isOnline, pendingCount }: { char: RpgChar; msg: string; target: string; amount: string; onTarget: (v:string)=>void; onAmount: (v:string)=>void; onTransfer: () => void; onBack: () => void; leaderboard: {uid:string;username:string;gold?:number}[]; isOnline: boolean; pendingCount: number }) {
  const [showDrop, setShowDrop] = useState(false)
  const [syncedGold, setSyncedGold] = useState<number | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // Load last-synced gold dari meta (bukan real-time local gold, anti-abuse)
  useEffect(() => {
    getSyncMeta(char.uid).then(m => setSyncedGold(m.lastSyncedGold)).catch(() => setSyncedGold(char.gold))
  }, [char.uid, char.gold])
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4}, inp:{width:'100%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'9px 11px',color:'#fff',fontSize:12,boxSizing:'border-box' as const,marginBottom:0,outline:'none'} }
  const filtered = leaderboard.filter(l => l.username.toLowerCase() !== char.username?.toLowerCase() && l.username.toLowerCase().includes(target.toLowerCase())).slice(0, 8)
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>💸 Transfer Gold</div>
      {/* Online/Offline status */}
      <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap' as const}}>
        <span style={{fontSize:11,background:isOnline?'rgba(52,211,153,0.12)':'rgba(255,100,50,0.12)',border:`1px solid ${isOnline?'rgba(52,211,153,0.3)':'rgba(255,100,50,0.3)'}`,borderRadius:20,padding:'2px 8px',color:isOnline?'#34d399':'#ff6432',fontWeight:700}}>
          {isOnline ? '🌐 Online — transfer langsung' : '📴 Offline — transfer di-queue'}
        </span>
        {pendingCount > 0 && (
          <span style={{fontSize:11,background:'rgba(255,165,50,0.12)',border:'1px solid rgba(255,165,50,0.3)',borderRadius:20,padding:'2px 8px',color:'#ffa032',fontWeight:700}}>
            📤 {pendingCount} pending (akan kirim saat online)
          </span>
        )}
      </div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:12}}>Kirim Gold ke player lain. Masukkan username mereka yang ada di leaderboard.</p>
      <div style={{background:'rgba(0,200,150,0.08)',border:'1px solid rgba(0,200,150,0.2)',borderRadius:12,padding:'10px 12px',marginBottom:12}}>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.6)'}}>Gold kamu (tersinkronisasi)</div>
        <div style={{fontSize:22,fontWeight:900,color:'#ffd700'}}>{(syncedGold ?? char.gold).toLocaleString()} G</div>
        {syncedGold !== null && syncedGold !== char.gold && (
          <div style={{fontSize:10,color:'rgba(255,165,50,0.8)',marginTop:2}}>
            ⚡ Local: {char.gold.toLocaleString()} G (akan tersync nanti)
          </div>
        )}
      </div>
      {msg && <div style={{background:msg.startsWith('✅')?'rgba(0,200,150,0.1)':msg.startsWith('📤')?'rgba(255,165,50,0.1)':'rgba(255,50,50,0.1)',border:`1px solid ${msg.startsWith('✅')?'rgba(0,200,150,0.3)':msg.startsWith('📤')?'rgba(255,165,50,0.3)':'rgba(255,50,50,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.startsWith('✅')?'#34d399':msg.startsWith('📤')?'#ffa032':'#ff6b6b',marginBottom:10}}>{msg}</div>}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginBottom:4}}>Username tujuan</div>
      <div style={{position:'relative',marginBottom:8}}>
        <input
          ref={inputRef}
          value={target}
          onChange={e=>{ onTarget(e.target.value); setShowDrop(true) }}
          onFocus={()=>setShowDrop(true)}
          onBlur={()=>setTimeout(()=>setShowDrop(false),180)}
          placeholder="Ketik username..."
          style={S.inp}
        />
        {showDrop && filtered.length > 0 && (
          <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#1a1a2e',border:'1px solid rgba(255,255,255,0.15)',borderRadius:'0 0 10px 10px',zIndex:100,maxHeight:160,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.5)'}}>
            {filtered.map(l => (
              <div
                key={l.uid}
                onMouseDown={()=>{ onTarget(l.username); setShowDrop(false) }}
                style={{padding:'9px 12px',cursor:'pointer',fontSize:13,color:'#fff',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between',alignItems:'center',transition:'background .15s'}}
                onMouseEnter={e=>(e.currentTarget.style.background='rgba(200,245,0,0.08)')}
                onMouseLeave={e=>(e.currentTarget.style.background='transparent')}
              >
                <span>👤 {l.username}</span>
                {l.gold !== undefined && <span style={{fontSize:11,color:'#ffd700'}}>{l.gold.toLocaleString()} G</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginBottom:4}}>Jumlah Gold</div>
      <input value={amount} onChange={e=>onAmount(e.target.value)} type="number" placeholder="Min. 10 Gold" style={{...S.inp,marginBottom:8}}/>
      <button onClick={onTransfer} style={{width:'100%',background:'linear-gradient(135deg,rgba(0,200,150,0.25),rgba(0,150,100,0.15))',border:'1px solid rgba(0,200,150,0.4)',borderRadius:11,padding:'12px',cursor:'pointer',color:'#34d399',fontSize:14,fontWeight:800,marginTop:4}}>
        💸 Kirim Gold
      </button>
      <div style={{fontSize:10,color:'rgba(255,255,255,0.25)',marginTop:10,textAlign:'center' as const}}>Tip: klik kolom username untuk lihat daftar player</div>
    </div>
  )
}


function RpgCreate({ onCreate, loading }: { onCreate: (cls: RpgClass, elem: RpgElement) => void; loading: boolean }) {
  const [selClass, setSelClass] = useState<RpgClass | null>(null)
  const [selElem, setSelElem] = useState<RpgElement | null>(null)
  const classes = Object.entries(RPG_CLASSES) as [RpgClass, typeof RPG_CLASSES[RpgClass]][]

  return (
    <div style={{ padding: '16px', overflowY: 'auto', height: '100%' }} className="gc2-fadein">
      <h3 style={{ color: '#c8f500', fontSize: 16, margin: '0 0 4px', textAlign: 'center' }}>⚔️ Buat Karakter</h3>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center', marginBottom: 14 }}>Pilih kelas dan elemen</p>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Kelas</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
        {classes.map(([cls, data]) => (
          <button key={cls} onClick={() => setSelClass(cls)} style={{
            background: selClass === cls ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${selClass === cls ? '#c8f500' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 10, padding: '8px 10px', cursor: 'pointer', textAlign: 'left', transition: 'all .15s'
          }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>{data.emoji}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: selClass === cls ? '#c8f500' : '#fff' }}>{cls}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.3 }}>{data.desc}</div>
            {selClass === cls && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                <span style={{ fontSize: 9, color: '#ff8888' }}>ATK:{data.atk}</span>
                <span style={{ fontSize: 9, color: '#88aaff' }}>DEF:{data.def}</span>
                <span style={{ fontSize: 9, color: '#88ff88' }}>HP:{data.baseHp}</span>
                <span style={{ fontSize: 9, color: '#8888ff' }}>MP:{data.baseMp}</span>
              </div>
            )}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Elemen</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
        {ELEMENTS.map(e => (
          <button key={e} onClick={() => setSelElem(e)} style={{
            background: selElem === e ? 'rgba(200,245,0,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${selElem === e ? '#c8f500' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
            color: selElem === e ? '#c8f500' : 'rgba(255,255,255,0.7)', transition: 'all .15s'
          }}>
            {ELEMENT_EMOJI[e]} {e}
          </button>
        ))}
      </div>

      {selClass && selElem && (
        <div style={{ background: 'rgba(200,245,0,0.06)', border: '1px solid rgba(200,245,0,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
          <div style={{ color: '#c8f500', fontWeight: 700, marginBottom: 4 }}>{RPG_CLASSES[selClass].emoji} {selClass} · {ELEMENT_EMOJI[selElem]} {selElem}</div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>Skills: {RPG_CLASSES[selClass].skills.join(', ')}</div>
        </div>
      )}

      <button className="gc2-rpg-btn primary" style={{ width: '100%' }}
        disabled={!selClass || !selElem || loading}
        onClick={() => selClass && selElem && onCreate(selClass, selElem)}>
        {loading ? <><span className="gc-spinner-sm"/> Membuat...</> : '✨ Mulai Petualangan'}
      </button>
    </div>
  )
}

function RpgDashboard({ char, gachaData, onSellItem, onBattle, onQuest, onShop, onLeaderboard, onClassChange, onDungeon, onParty, onDaily, onFishing, onMining, onCrafting, onFarming, onCooking, onTraining, onDuel, onWildQuest, onInvest, onWeaponUp, onTransfer }: {
  char: RpgChar; gachaData: PlayerGacha | null
  onSellItem: (name: string) => void
  onBattle: () => void; onQuest: () => void; onShop: () => void; onLeaderboard: () => void; onClassChange: () => void
  onDungeon: () => void; onParty: () => void; onDaily: () => void; onFishing: () => void
  onMining: () => void; onCrafting: () => void; onFarming: () => void; onCooking: () => void
  onTraining: () => void; onDuel: () => void; onWildQuest: () => void; onInvest: () => void
  onWeaponUp: () => void; onTransfer: () => void
}) {
  const { current, needed, level } = getLevelExp(char.exp)
  const cls = RPG_CLASSES[char.class]
  const activeQ = char.activeQuest ? QUESTS.find(q => q.id === char.activeQuest) : null
  const todayStr = new Date().toDateString()
  const dailyData = char.dailyMissions?.date === todayStr ? char.dailyMissions : { date: todayStr, completed: [], claimed: [] }
  const pendingDaily = DAILY_MISSIONS.filter(m => dailyData.completed.includes(m.id) && !dailyData.claimed.includes(m.id))
  const partyChars = (char.party || []).map(id => GACHA_CHARS.find(c => c.id === id)).filter(Boolean) as typeof GACHA_CHARS
  const hpPct = (char.hp / char.maxHp) * 100
  const mpPct = (char.mp / char.maxMp) * 100
  const hpColor = hpPct > 60 ? '#30d158' : hpPct > 30 ? '#ffd60a' : '#ff375f'

  // ── 3D Card Tilt (touch + mouse) ──────────────────────────────
  useEffect(() => {
    const card = document.querySelector<HTMLElement>('.rpg-char-card')
    if (!card) return
    const onMove = (e: MouseEvent | TouchEvent) => {
      const touch = (e as TouchEvent).touches?.[0]
      const clientX = touch?.clientX ?? (e as MouseEvent).clientX
      const clientY = touch?.clientY ?? (e as MouseEvent).clientY
      const r = card.getBoundingClientRect()
      const rx = (((clientY - r.top)  - r.height / 2) / (r.height / 2) * -6).toFixed(2) + 'deg'
      const ry = (((clientX - r.left) - r.width  / 2) / (r.width  / 2) *  6).toFixed(2) + 'deg'
      card.style.setProperty('--rx', rx)
      card.style.setProperty('--ry', ry)
      card.classList.add('rpg-tilting')
    }
    const onLeave = () => {
      card.style.setProperty('--rx', '0deg')
      card.style.setProperty('--ry', '0deg')
      card.classList.remove('rpg-tilting')
    }
    card.addEventListener('mousemove', onMove)
    card.addEventListener('touchmove', onMove, { passive: true })
    card.addEventListener('mouseleave', onLeave)
    card.addEventListener('touchend', onLeave)
    return () => {
      card.removeEventListener('mousemove', onMove)
      card.removeEventListener('touchmove', onMove)
      card.removeEventListener('mouseleave', onLeave)
      card.removeEventListener('touchend', onLeave)
    }
  }, [])

  return (
    <div className="rpg-dashboard-scroll gc2-fadein">

      {/* ZZZ Character Card */}
      <div className="rpg-char-card">
        {/* BG accent */}
        <div style={{ position:'absolute', top:-30, right:-30, width:120, height:120, borderRadius:'50%', background:`radial-gradient(circle,${ELEMENT_EMOJI[char.element]==='🔥'?'rgba(255,100,0,0.15)':char.element==='Water'?'rgba(0,100,255,0.15)':'rgba(200,245,0,0.1)'} 0%,transparent 70%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:'linear-gradient(90deg,transparent,rgba(255,55,95,0.5),transparent)' }}/>

        {/* Header row */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
          <div className="rpg-class-icon">
            {cls.emoji}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:900, color:'#fff', letterSpacing:.3, marginBottom:2 }}>{char.username}</div>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:10, background:'rgba(255,55,95,0.15)', color:'#ff375f', border:'1px solid rgba(255,55,95,0.3)', borderRadius:4, padding:'1px 6px', fontWeight:700, letterSpacing:.5 }}>{char.class.toUpperCase()}</span>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:'monospace' }}>{ELEMENT_EMOJI[char.element]} {char.element}</span>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:'monospace' }}>LV.{level}</span>
            </div>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontSize:14, color:'#ffd60a', fontWeight:800, fontFamily:'monospace' }}>💰{char.gold}</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', fontFamily:'monospace' }}>⚔️ {char.kills} kills</div>
          </div>
        </div>

        {/* HP Bar */}
        <div style={{ marginBottom:6 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:3, fontFamily:'monospace' }}>
            <span style={{ color:hpColor, fontWeight:700 }}>HP</span>
            <span>{char.hp} / {char.maxHp}</span>
          </div>
          <div style={{ position:'relative', background:'rgba(255,255,255,0.06)', borderRadius:4, overflow:'hidden', height:10 }}>
            <div className="rpg-bar-fill rpg-bar-hp" style={{ width:`${hpPct}%` }}/>
            {[25,50,75].map(t=><div key={t} style={{position:'absolute',top:0,bottom:0,left:`${t}%`,width:1,background:'rgba(0,0,0,0.4)'}}/>)}
          </div>
        </div>

        {/* MP Bar */}
        <div style={{ marginBottom:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:3, fontFamily:'monospace' }}>
            <span style={{ color:'#5ac8fa', fontWeight:700 }}>MP</span>
            <span>{char.mp} / {char.maxMp}</span>
          </div>
          <div style={{ position:'relative', background:'rgba(255,255,255,0.06)', borderRadius:4, overflow:'hidden', height:7 }}>
            <div className="rpg-bar-fill rpg-bar-mp" style={{ width:`${mpPct}%` }}/>
          </div>
        </div>

        {/* EXP Bar */}
        <div style={{ marginBottom:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.3)', marginBottom:3, fontFamily:'monospace' }}>
            <span>EXP</span><span>{current}/{needed}</span>
          </div>
          <div style={{ background:'rgba(255,255,255,0.05)', borderRadius:3, overflow:'hidden', height:4 }}>
            <div className="rpg-bar-fill rpg-bar-exp" style={{ width:`${(current/needed)*100}%` }}/>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {[['ATK',char.atk,'#ff375f'],['DEF',char.def,'#5ac8fa'],['SPD',char.spd,'#ffd60a'],['LCK',char.luck,'#30d158']].map(([l,v,c])=>(
            <div key={String(l)} className="rpg-stat-box">
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', fontFamily:'monospace', letterSpacing:.5 }}>{l}</div>
              <div style={{ fontSize:14, fontWeight:900, color:String(c), fontFamily:'monospace' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Quest */}
      {activeQ && (() => {
        const qDone = char.questProgress >= activeQ.kills
        return (
          <div style={{ background: qDone ? 'rgba(245,255,0,0.06)' : 'rgba(255,200,0,0.06)', border:`1px solid ${qDone?'rgba(245,255,0,0.25)':'rgba(255,200,0,0.15)'}`, borderRadius:10, padding:'8px 12px', marginBottom:10, animation: qDone ? 'btnPulse 2s infinite' : 'none' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
              <span style={{ fontSize:11, fontWeight:800, color: qDone?'#f5ff00':'#ffd60a' }}>📜 {activeQ.name}</span>
              {qDone && <span style={{ fontSize:9, background:'rgba(245,255,0,0.15)', color:'#f5ff00', borderRadius:3, padding:'1px 5px', fontWeight:700 }}>KLAIM!</span>}
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', fontFamily:'monospace', marginBottom:4 }}>{char.questProgress} / {activeQ.kills} kills</div>
            <StatBar val={char.questProgress} max={activeQ.kills} type="exp"/>
          </div>
        )
      })()}

      {/* Action Grid */}
      <div className="rpg-menu-grid">
        <button onClick={onBattle} className="rpg-battle-btn">
          <span style={{ fontSize:24 }}>⚔️</span>
          <div style={{ textAlign:'left' }}>
            <div style={{ fontSize:13, fontWeight:900, letterSpacing:.3 }}>Berburu Monster</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>⚡ Auto-battle tersedia</div>
          </div>
          <div style={{ marginLeft:'auto', fontSize:18, color:'rgba(255,55,95,0.6)' }}>›</div>
        </button>

        {[
          { label:'📜 Quest', sub:'Klaim reward', onClick:onQuest, color:'rgba(255,214,0,0.3)' },
          { label:'🛒 Toko', sub:'Beli item', onClick:onShop, color:'rgba(90,200,250,0.2)' },
          { label:'🏰 Dungeon', sub:'Boss battle', onClick:onDungeon, color:'rgba(160,100,255,0.25)' },
          { label:`👥 Party`, sub:`${(char.party||[]).length}/4 chars`, onClick:onParty, color:'rgba(90,200,250,0.15)' },
          { label:'🏆 Skor', sub:'Ranking', onClick:onLeaderboard, color:'rgba(255,215,0,0.12)' },
          { label:`📋 Daily${pendingDaily.length>0?` (${pendingDaily.length}🎁)`:''}`, sub:'Misi harian', onClick:onDaily, color: pendingDaily.length>0?'rgba(245,255,0,0.15)':'rgba(255,255,255,0.05)' },
          { label:'🎣 Mancing', sub:'Pergi memancing', onClick:onFishing, color:'rgba(79,195,247,0.15)' },
          { label:'⛏️ Tambang', sub:'Mining material', onClick:onMining, color:'rgba(120,80,40,0.3)' },
          { label:'🔨 Meracik', sub:'Craft item', onClick:onCrafting, color:'rgba(200,100,50,0.25)' },
          { label:'🌾 Kebun', sub:'Tanam & panen', onClick:onFarming, color:'rgba(60,180,60,0.2)' },
          { label:'🍳 Masak', sub:'Buff sementara', onClick:onCooking, color:'rgba(255,150,50,0.2)' },
          { label:'💪 Training', sub:'Latih stat', onClick:onTraining, color:'rgba(100,150,255,0.2)' },
          { label:'⚔️ Duel', sub:'PvP player lain', onClick:onDuel, color:'rgba(255,60,60,0.2)' },
          { label:'🎲 Wild Quest', sub:'Quest acak', onClick:onWildQuest, color:'rgba(180,50,200,0.2)' },
          { label:'💰 Investasi', sub:'Kembangkan gold', onClick:onInvest, color:'rgba(255,215,0,0.2)' },
          { label:`🗡️ Upgrade ${char.weaponLevel||0}/10`, sub:'Perkuat senjata', onClick:onWeaponUp, color:'rgba(255,100,0,0.2)' },
          { label:'💸 Transfer', sub:'Kirim gold', onClick:onTransfer, color:'rgba(0,200,150,0.2)' },
        ].map((b,i)=>(
          <button
            key={i} onClick={b.onClick}
            className={`rpg-menu-btn${b.label.includes('🎁') ? ' rpg-menu-reward' : ''}`}
            style={{ background:b.color, '--si':i } as React.CSSProperties}
          >
            <div className="rpg-menu-btn-label">{b.label}</div>
            <div className="rpg-menu-btn-sub">{b.sub}</div>
          </button>
        ))}
      </div>

      <button onClick={onClassChange} className="rpg-class-change-btn">
        🔄 Ganti Class <span style={{ opacity:.4, fontWeight:400 }}>({CLASS_CHANGE_COST.toLocaleString()} Gold)</span>
      </button>

      {/* Global Inventory - semua item dari semua RPG */}
      {(() => {
        // Kumpulkan semua item dari seluruh RPG
        const allItems: {name:string; qty:number; source:string; color:string; sellable:boolean}[] = []

        // 1. Inventory utama (battle drops, quest rewards, shop items)
        const invCount: Record<string,number> = {};
        (char.inventory || []).forEach(i => { invCount[i] = (invCount[i]||0)+1 })
        Object.entries(invCount).forEach(([name,qty]) => allItems.push({name, qty, source:'⚔️', color:'rgba(255,100,100,0.7)', sellable: name in ITEM_SELL_PRICES}))

        // 2. Bijih tambang
        const ores = char.ores || {}
        const oreEmoji: Record<string,string> = {batu:'🪨',besi:'⚙️',emas:'🪙',kristal:'💎',miril:'🌟',obsidian:'🖤',gandum:'🌾',sayur:'🥦',buah:'🍎',jamur:'🍄'}
        Object.entries(ores).forEach(([ore,qty]) => {
          if (qty > 0) allItems.push({name:`${oreEmoji[ore]||'🪨'} ${ore}`, qty, source:'⛏️', color:'rgba(100,200,100,0.7)', sellable:false})
        })

        // 3. Tanaman kebun (sedang ditanam)
        const crops = char.crops || []
        const cropCount: Record<string,number> = {}
        crops.forEach(c => { cropCount[c.type] = (cropCount[c.type]||0)+1 })
        Object.entries(cropCount).forEach(([type,qty]) => allItems.push({name:`🌱 ${type}`, qty, source:'🌾', color:'rgba(100,220,150,0.7)', sellable:false}))

        // 4. Food buffs aktif
        const buffs = char.foodBuffs || []
        buffs.filter(b => Date.now() < b.expiresAt).forEach(b => {
          allItems.push({name:`🍽️ ${b.type}`, qty:1, source:'🍳', color:'rgba(255,200,100,0.7)', sellable:false})
        })

        if (allItems.length === 0) return null

        const sellableItems = allItems.filter(i => i.sellable)
        const regularItems = allItems.filter(i => !i.sellable)

        return (
          <div style={{ marginTop:10 }}>
            {sellableItems.length > 0 && (
              <>
                <div style={{ fontSize:10, color:'rgba(255,200,100,0.7)', marginBottom:6, fontFamily:'monospace', letterSpacing:1 }}>
                  💰 ITEM BISA DIJUAL ({sellableItems.length} jenis) — tap untuk jual
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:8 }}>
                  {sellableItems.map((item, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,200,100,0.06)', border:'1px solid rgba(255,200,100,0.15)', borderRadius:8, padding:'6px 10px' }}>
                      <span style={{fontSize:9,opacity:0.5}}>{item.source}</span>
                      <span style={{ fontSize:11, color:'rgba(255,255,255,0.8)', flex:1 }}>
                        {item.name}{item.qty > 1 ? <span style={{color:'rgba(255,255,100,0.8)',fontWeight:700}}> ×{item.qty}</span> : ''}
                      </span>
                      <span style={{ fontSize:10, color:'#ffd700' }}>+{(ITEM_SELL_PRICES[item.name]||0).toLocaleString()}G</span>
                      <button onClick={() => onSellItem(item.name)} style={{ background:'rgba(255,215,0,0.15)', border:'1px solid rgba(255,215,0,0.3)', borderRadius:6, padding:'3px 8px', fontSize:10, fontWeight:800, color:'#ffd700', cursor:'pointer' }}>
                        Jual
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {regularItems.length > 0 && (
              <>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginBottom:5, fontFamily:'monospace', letterSpacing:1 }}>🎒 SEMUA ITEM ({regularItems.length} jenis)</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {regularItems.map((item, i) => (
                    <span key={i} title={`Dari: ${item.source}`} style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${item.color.replace('0.7','0.2')}`, borderRadius:6, padding:'3px 8px', fontSize:10, color:item.color, display:'flex', gap:3, alignItems:'center' }}>
                      <span style={{opacity:0.5,fontSize:9}}>{item.source}</span>
                      {item.name}{item.qty > 1 ? <span style={{color:'rgba(255,255,100,0.8)',fontWeight:700}}>×{item.qty}</span> : ''}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}


function RpgMonsterSelect({ char, onSelect, onBack }: { char: RpgChar; onSelect: (idx: number) => void; onBack: () => void }) {
  const [filter, setFilter] = useState<string>('Semua')
  const ranks = ['Semua', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS']
  const rankColor: Record<string,string> = { F:'#9ca3af',E:'#6ee7b7',D:'#60a5fa',C:'#a78bfa',B:'#f472b6',A:'#fb923c',S:'#fbbf24',SS:'#ff375f' }
  const filtered = filter === 'Semua' ? MONSTERS : MONSTERS.filter(m => m.rank === filter)

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#080810', overflow:'hidden' }} className="gc2-fadein">
      {/* Header */}
      <div style={{ background:'rgba(255,55,95,0.08)', borderBottom:'1px solid rgba(255,55,95,0.15)', padding:'10px 14px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        <button onClick={onBack} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, padding:'5px 10px', color:'rgba(255,255,255,0.6)', fontSize:11, cursor:'pointer', fontWeight:700 }}>←</button>
        <span style={{ fontFamily:'monospace', fontSize:11, color:'rgba(255,55,95,0.8)', letterSpacing:2, fontWeight:700 }}>SELECT TARGET</span>
      </div>

      {/* Rank filter */}
      <div style={{ display:'flex', gap:4, overflowX:'auto', padding:'10px 14px 8px', flexShrink:0, scrollbarWidth:'none' }}>
        {ranks.map(r => (
          <button key={r} onClick={() => setFilter(r)} style={{
            background: filter === r ? 'rgba(255,55,95,0.2)' : 'rgba(255,255,255,0.04)',
            border: filter === r ? '1px solid rgba(255,55,95,0.5)' : '1px solid rgba(255,255,255,0.08)',
            color: filter === r ? '#ff375f' : 'rgba(255,255,255,0.4)',
            borderRadius:6, padding:'4px 10px', fontSize:10, fontWeight:800, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, fontFamily:'monospace', letterSpacing:.5
          }}>{r === 'Semua' ? 'ALL' : `${r}`}</button>
        ))}
      </div>

      {/* Monster list */}
      <div style={{ flex:1, overflowY:'auto', padding:'0 14px 14px', display:'flex', flexDirection:'column', gap:6, scrollbarWidth:'none' }}>
        {filtered.map((m, i) => {
          const realIdx = MONSTERS.indexOf(m)
          const tooHard = m.atk - char.def > char.hp * 0.5
          const rc = rankColor[m.rank] || '#fff'
          return (
            <button key={i} onClick={() => onSelect(realIdx)} style={{
              background:'rgba(255,255,255,0.03)', border:`1px solid ${tooHard?'rgba(255,55,95,0.15)':'rgba(255,255,255,0.07)'}`,
              borderRadius:10, padding:'10px 12px', cursor:'pointer', textAlign:'left', transition:'all .15s',
              display:'flex', alignItems:'center', gap:10
            }}
              onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = rc+'44' }}
              onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = tooHard?'rgba(255,55,95,0.15)':'rgba(255,255,255,0.07)' }}>
              <div style={{ fontSize:28, lineHeight:1, filter:`drop-shadow(0 0 6px ${rc}66)` }}>{m.emoji}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                  <span style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{m.name}</span>
                  <span style={{ fontSize:9, background:`${rc}18`, color:rc, border:`1px solid ${rc}44`, borderRadius:3, padding:'1px 5px', fontWeight:800, fontFamily:'monospace' }}>
                    {m.rank}
                  </span>
                  {tooHard && <span style={{ fontSize:9, color:'#ff375f', fontFamily:'monospace' }}>⚠️ KUAT</span>}
                </div>
                <div style={{ display:'flex', gap:8, fontSize:10, color:'rgba(255,255,255,0.35)', fontFamily:'monospace' }}>
                  <span style={{ color:'#ff375f88' }}>HP {m.hp}</span>
                  <span>ATK {m.atk}</span>
                  <span>DEF {m.def}</span>
                  <span style={{ color:'#ffd60a88' }}>+{m.exp}EXP</span>
                </div>
              </div>
              <div style={{ fontSize:18, color:'rgba(255,255,255,0.2)' }}>›</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}


// ── BATTLE CSS ANIMATIONS ─────────────────────────────────────
const BATTLE_REDESIGN_CSS = `
@keyframes floatDmg {
  0%   { transform:translateY(0) scale(1);   opacity:1; }
  40%  { transform:translateY(-28px) scale(1.1); opacity:1; }
  100% { transform:translateY(-65px) scale(0.6); opacity:0; }
}
@keyframes slashP {
  0%   { transform:rotate(-38deg) translateX(-120%) scaleY(0.5); opacity:0; }
  15%  { opacity:1; }
  100% { transform:rotate(-38deg) translateX(80%) scaleY(0.5); opacity:0; }
}
@keyframes slashE {
  0%   { transform:rotate(38deg) translateX(120%) scaleY(0.5); opacity:0; }
  15%  { opacity:1; }
  100% { transform:rotate(38deg) translateX(-80%) scaleY(0.5); opacity:0; }
}
@keyframes slashFlash { 0% { opacity:0.6; } 100% { opacity:0; } }
@keyframes battleShake {
  0%,100% { transform:translate(0,0); }
  15%  { transform:translate(-4px,3px); }
  30%  { transform:translate(4px,-3px); }
  50%  { transform:translate(-3px,4px); }
  70%  { transform:translate(3px,-2px); }
  85%  { transform:translate(-2px,1px); }
}
@keyframes battleBigShake {
  0%,100% { transform:translate(0,0); }
  10%  { transform:translate(-6px,5px); }
  25%  { transform:translate(6px,-5px); }
  40%  { transform:translate(-5px,6px); }
  60%  { transform:translate(5px,-4px); }
  80%  { transform:translate(-3px,3px); }
}
@keyframes comboIn {
  0%   { transform:scale(0.2) rotate(-12deg); opacity:0; }
  55%  { transform:scale(1.25) rotate(4deg); opacity:1; }
  75%  { transform:scale(0.95) rotate(-1deg); }
  100% { transform:scale(1) rotate(0); opacity:1; }
}
@keyframes comboPulse {
  0%,100% { text-shadow:0 0 10px #ffd60a; }
  50%      { text-shadow:0 0 28px #ffd60a, 0 0 50px #ffd60a; }
}
@keyframes rageFlicker {
  0%,100% { filter:drop-shadow(0 0 12px rgba(255,55,95,0.8)); }
  50%     { filter:drop-shadow(0 0 30px rgba(255,55,95,1)) brightness(1.25) saturate(1.5); }
}
@keyframes vsGlitch {
  0%,85%,100% { opacity:1; transform:scale(1) skewX(0); }
  87%  { opacity:0.2; transform:scale(1.08) skewX(-6deg); color:#ff375f; }
  89%  { opacity:1; transform:scale(0.92); }
  91%  { opacity:0.5; transform:skewX(4deg); color:#4fc3f7; }
  93%  { opacity:1; }
}
@keyframes scanMove { from { transform:translateY(-100%); } to { transform:translateY(200%); } }
@keyframes critBurst {
  0%   { transform:scale(0.5); opacity:1; }
  100% { transform:scale(2.5); opacity:0; }
}
@keyframes battleLogIn {
  from { transform:translateX(-8px); opacity:0; }
  to   { transform:translateX(0); opacity:1; }
}
@keyframes battleWinPop {
  0%   { transform:scale(0.3) rotate(-10deg); opacity:0; }
  50%  { transform:scale(1.2) rotate(3deg); }
  75%  { transform:scale(0.95); }
  100% { transform:scale(1) rotate(0); opacity:1; }
}
@keyframes battleAutoPulse {
  0%,100% { box-shadow:0 0 0 0 rgba(255,214,0,0.5); }
  50%      { box-shadow:0 0 0 5px rgba(255,214,0,0); }
}
@keyframes battleHpFlash  { 0% { background:rgba(255,55,95,0.3); } 100% { background:transparent; } }
@keyframes battleHealFlash { 0% { background:rgba(48,209,88,0.2); } 100% { background:transparent; } }
@keyframes battleIdleFloat { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
@keyframes battleGlitch {
  0%,90%,100% { clip-path:none; transform:none; }
  91%  { clip-path:polygon(0 20%,100% 20%,100% 35%,0 35%); transform:translateX(-4px); }
  93%  { clip-path:polygon(0 60%,100% 60%,100% 78%,0 78%); transform:translateX(4px); color:#ff375f; }
  95%  { clip-path:none; transform:none; }
}
@keyframes battlePopIn {
  0%   { transform:scale(0.4) translateY(20px); opacity:0; }
  65%  { transform:scale(1.12) translateY(-4px); }
  100% { transform:scale(1) translateY(0); opacity:1; }
}
`

// ── FLOATING DAMAGE NUMBER ────────────────────────────────────
function BattleFloatNum({ value, type, left, top }: { value: number|string; type: string; left: string; top: string }) {
  const C: Record<string,string> = { dmg:'#ff375f', heal:'#30d158', shield:'#4fc3f7', skill:'#ffd60a', crit:'#ff9500', mp:'#7dd3fc' }
  const sz = type==='crit' ? 22 : type==='skill' ? 18 : 15
  const col = C[type] || '#fff'
  return (
    <div style={{
      position:'absolute', left, top, pointerEvents:'none', zIndex:200,
      color: col, fontWeight:900, fontSize:sz, fontFamily:'monospace',
      textShadow:`0 0 10px ${col},0 0 20px ${col}`,
      animation:'floatDmg 1.3s ease-out forwards', whiteSpace:'nowrap'
    }}>
      {type==='crit' ? `💥 ${value}!` : type==='heal' ? `💚+${value}` : type==='shield' ? `🛡️ Shield!` : `-${value}`}
    </div>
  )
}

// ── SLASH EFFECT ──────────────────────────────────────────────
function BattleSlashFX({ slashKey, attacker }: { slashKey: number|null; attacker: string }) {
  if (!slashKey) return null
  const isPlayer = attacker === 'player'
  const color1 = isPlayer ? '#ffd60a' : '#ff375f'
  const color2 = isPlayer ? '#c8f500' : '#ff8080'
  const animName = isPlayer ? 'slashP' : 'slashE'
  return (
    <div key={slashKey} style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:60, overflow:'hidden' }}>
      <div style={{ position:'absolute', width:'220%', height:4, left:'-60%', top:'38%',
        background:`linear-gradient(90deg,transparent,${color1} 40%,#fff 50%,${color1} 60%,transparent)`,
        animation:`${animName} 0.4s ease-out forwards`,
        boxShadow:`0 0 12px ${color1},0 0 24px ${color1}66` }}/>
      <div style={{ position:'absolute', width:'220%', height:2, left:'-60%', top:'43%',
        background:`linear-gradient(90deg,transparent,${color2},transparent)`,
        animation:`${animName} 0.4s ease-out 0.06s forwards`, opacity:0.7 }}/>
      <div style={{ position:'absolute', inset:0,
        background: isPlayer ? 'rgba(255,214,0,0.06)' : 'rgba(255,55,95,0.08)',
        animation:'slashFlash 0.25s ease-out forwards' }}/>
    </div>
  )
}

// ── CRIT BURST RING ───────────────────────────────────────────
function BattleCritRing({ active, side }: { active: boolean; side: string }) {
  if (!active) return null
  return (
    <div style={{
      position:'absolute',
      [side==='monster' ? 'right' : 'left']: '20%', top:'15%',
      width:60, height:60, borderRadius:'50%',
      border:'3px solid #ffd60a',
      animation:'critBurst 0.5s ease-out forwards',
      pointerEvents:'none', zIndex:70
    }}/>
  )
}

// ── BATTLE STAT BAR ───────────────────────────────────────────
function BattleBar({ pct, color, height=8, glow=false }: { pct: number; color: string; height?: number; glow?: boolean }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden', height }}>
      <div style={{
        height:'100%', width:`${Math.max(0, pct)}%`,
        background:`linear-gradient(90deg,${color},${color}cc)`,
        transition:'width 0.5s cubic-bezier(.4,0,.2,1)', borderRadius:3,
        boxShadow: glow && pct > 0 ? `0 0 6px ${color}` : 'none'
      }}/>
    </div>
  )
}

// ── REDESIGNED RPGBATTLE ──────────────────────────────────────
function RpgBattle({ char, bs, onConfirm, onCancel, onEnd, autoBattle, onToggleAuto }: {
  char: RpgChar; bs: any
  onConfirm: () => void; onCancel: () => void; onEnd: () => void
  autoBattle?: boolean; onToggleAuto?: () => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  const floatCounter = useRef(0)
  const prevLogLen = useRef(0)

  const [combo, setCombo]         = useState(0)
  const [floats, setFloats]       = useState<any[]>([])
  const [slashKey, setSlashKey]   = useState<number|null>(null)
  const [slashSide, setSlashSide] = useState('player')
  const [shaking, setShaking]     = useState('')
  const [critRing, setCritRing]   = useState<string|null>(null)
  const [flashPanel, setFlashPanel] = useState('')

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [bs.log])

  // ── Visual FX helpers ──
  const addFloat = useCallback((value: number|string, type: string, side: string) => {
    const id = ++floatCounter.current
    const leftBase = side === 'monster' ? 58 : 8
    const left = `${leftBase + Math.random() * 12}%`
    const top  = `${20 + Math.random() * 15}%`
    setFloats(f => [...f.slice(-8), { id, value, type, left, top }])
    setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 1400)
  }, [])

  const triggerSlash = useCallback((side: string) => {
    const key = Date.now() + Math.random()
    setSlashKey(key as any); setSlashSide(side)
    setTimeout(() => setSlashKey(null), 420)
  }, [])

  const triggerShake = useCallback((intensity = 'light') => {
    setShaking(intensity)
    setTimeout(() => setShaking(''), intensity === 'big' ? 600 : 380)
  }, [])

  const triggerCrit = useCallback((side: string) => {
    setCritRing(side); setTimeout(() => setCritRing(null), 520)
  }, [])

  const triggerFlash = useCallback((type: string) => {
    setFlashPanel(type); setTimeout(() => setFlashPanel(''), 300)
  }, [])

  // ── Trigger visual FX from battle log changes ──
  useEffect(() => {
    if (!bs?.log?.length) return
    if (bs.log.length <= prevLogLen.current) { prevLogLen.current = bs.log.length; return }
    const newEntries = bs.log.slice(prevLogLen.current)
    prevLogLen.current = bs.log.length
    newEntries.forEach((entry: any) => {
      const nums = entry.text.match(/\d+/)
      const val = nums ? parseInt(nums[0]) : 10
      const isCrit = entry.text.includes('KRITIS') || entry.text.includes('CRIT')
      if (entry.type === 'dmg' || entry.type === 'skill') {
        const isMonsterAtk = entry.text.startsWith('🗡️') || entry.text.startsWith('🔥')
        if (!isMonsterAtk) {
          triggerSlash('player')
          addFloat(val, isCrit ? 'crit' : entry.type === 'skill' ? 'skill' : 'dmg', 'monster')
          if (isCrit) { triggerCrit('monster'); triggerShake('big') } else triggerShake('light')
          setCombo(c => c + 1)
        } else {
          triggerSlash('enemy')
          addFloat(val, isCrit ? 'crit' : 'dmg', 'player')
          triggerFlash('player-hit')
          if (isCrit) triggerShake('big'); else triggerShake('light')
          setCombo(0)
        }
      } else if (entry.type === 'heal') {
        const isPlayerHeal = entry.text.includes(char.username)
        addFloat(val, 'heal', isPlayerHeal ? 'player' : 'monster')
        triggerFlash('heal'); setCombo(0)
      } else if (entry.type === 'shield') {
        const isPlayerShield = entry.text.includes(char.username)
        addFloat(0, 'shield', isPlayerShield ? 'player' : 'monster'); setCombo(0)
      }
    })
  }, [bs?.log?.length])

  // Reset combo when battle resets
  useEffect(() => { if (bs?.phase === 'confirm') { setCombo(0); setFloats([]) } }, [bs?.phase])

  const pHpPct  = Math.max(0, (bs.playerHp / char.maxHp) * 100)
  const mHpPct  = Math.max(0, (bs.monsterHp / bs.monster.hp) * 100)
  const pShPct  = bs.playerShieldMax > 0 ? Math.max(0, (bs.playerShield / bs.playerShieldMax) * 100) : 0
  const mShPct  = bs.monsterShieldMax > 0 ? Math.max(0, (bs.monsterShield / bs.monsterShieldMax) * 100) : 0
  const pMpPct  = Math.max(0, (bs.playerMp / char.maxMp) * 100)
  const isResult  = bs.phase === 'result'
  const isConfirm = bs.phase === 'confirm'
  const isRunning = bs.phase === 'running'
  const mIsRage   = mHpPct < 30 && mHpPct > 0 && isRunning
  const RANK_COLOR: Record<string,string> = { F:'#9ca3af',E:'#6ee7b7',D:'#60a5fa',C:'#a78bfa',B:'#f472b6',A:'#fb923c',S:'#fbbf24',SS:'#f9a8d4' }
  const LOG_COLOR:  Record<string,string> = { dmg:'#ff6b6b', heal:'#30d158', skill:'#ffd60a', shield:'#4fc3f7', info:'rgba(255,255,255,0.45)' }
  const hpColor = pHpPct > 60 ? '#30d158' : pHpPct > 30 ? '#ffd60a' : '#ff375f'
  const rankCol = RANK_COLOR[bs.monster.rank] || '#fff'

  const bgGrad = (() => {
    if (isResult && bs.result === 'win')  return 'radial-gradient(ellipse at top,#0d2000 0%,#0a0a0f 60%)'
    if (isResult && bs.result === 'lose') return 'radial-gradient(ellipse at top,#200000 0%,#0a0a0f 60%)'
    if (pHpPct < 25) return 'radial-gradient(ellipse at bottom-left,#200005 0%,#0a0a0f 70%)'
    if (mHpPct < 25) return 'radial-gradient(ellipse at bottom-right,#200005 0%,#0a0a0f 70%)'
    return 'radial-gradient(ellipse at top,#0a0014 0%,#060610 50%,#0a0a0f 100%)'
  })()

  // ── CONFIRM SCREEN ────────────────────────────────────────────
  if (isConfirm) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#060610', overflow:'hidden', position:'relative' }}>
      <style>{BATTLE_REDESIGN_CSS}</style>
      <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)', backgroundSize:'40px 40px', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${rankCol},transparent)` }}/>

      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'16px 20px 20px', gap:16 }}>
        {/* Monster */}
        <div style={{ textAlign:'center', animation:'battleIdleFloat 3s ease-in-out infinite' }}>
          <div style={{ fontSize:72, filter:`drop-shadow(0 0 20px ${rankCol})`, marginBottom:8 }}>{bs.monster.emoji}</div>
          <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:2, fontFamily:'monospace' }}>{bs.monster.name}</div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:6 }}>
            <span style={{ background:`${rankCol}22`, color:rankCol, border:`1px solid ${rankCol}66`, fontSize:11, fontWeight:800, padding:'2px 10px', borderRadius:4, fontFamily:'monospace', letterSpacing:1 }}>RANK {bs.monster.rank}</span>
            {bs.monster.canHeal   && <span style={{ background:'rgba(147,51,234,0.15)', color:'#a855f7', border:'1px solid rgba(147,51,234,0.3)', fontSize:10, padding:'2px 8px', borderRadius:4, fontWeight:700 }}>💜 HEAL</span>}
            {bs.monster.canShield && <span style={{ background:'rgba(239,68,68,0.15)', color:'#f87171', border:'1px solid rgba(239,68,68,0.3)', fontSize:10, padding:'2px 8px', borderRadius:4, fontWeight:700 }}>🔴 SHIELD</span>}
          </div>
        </div>

        {/* Stats */}
        <div style={{ width:'100%', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:'12px 16px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:10 }}>
            {([['❤️ HP', bs.monster.hp.toLocaleString(), '#ff375f'],['⚔️ ATK', bs.monster.atk, '#fb923c'],['🛡️ DEF', bs.monster.def, '#60a5fa']] as [string,any,string][]).map(([label,val,color]) => (
              <div key={label} style={{ textAlign:'center', background:`${color}10`, border:`1px solid ${color}22`, borderRadius:8, padding:'6px 4px' }}>
                <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', fontFamily:'monospace', marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:900, color, fontFamily:'monospace' }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', textAlign:'center', borderTop:'1px solid rgba(255,255,255,0.06)', paddingTop:8 }}>
            🎁 {bs.monster.drop} &nbsp;·&nbsp; +{bs.monster.exp} EXP &nbsp;·&nbsp; +{bs.monster.gold} Gold
          </div>
        </div>

        {/* Auto note */}
        <div style={{ background:'rgba(255,214,0,0.05)', border:'1px solid rgba(255,214,0,0.2)', borderRadius:10, padding:'10px 14px', width:'100%', textAlign:'center' }}>
          <div style={{ fontSize:11, color:'rgba(255,214,0,0.9)', lineHeight:1.7, fontFamily:'monospace' }}>
            ⚡ FULL AUTO AI BATTLE<br/>
            <span style={{ color:'rgba(255,255,255,0.4)', fontSize:10 }}>Player & musuh akan heal, shield, dan skill secara cerdas</span>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
          <button onClick={onConfirm} style={{ width:'100%', padding:'14px 0',
            background:'linear-gradient(135deg,rgba(255,55,95,0.25),rgba(255,55,95,0.1))',
            border:'1px solid rgba(255,55,95,0.5)', borderRadius:10, color:'#fff',
            fontSize:15, fontWeight:900, cursor:'pointer', fontFamily:'monospace',
            letterSpacing:2, boxShadow:'0 0 20px rgba(255,55,95,0.2)' }}>
            ▶ &nbsp; MULAI PERTARUNGAN
          </button>
          <button onClick={onCancel} style={{ width:'100%', padding:'10px 0',
            background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)',
            borderRadius:10, color:'rgba(255,255,255,0.5)', fontSize:13, fontWeight:700,
            cursor:'pointer', fontFamily:'monospace', letterSpacing:1 }}>
            ← &nbsp; MUNDUR
          </button>
        </div>
      </div>
    </div>
  )

  // ── BATTLE SCREEN ─────────────────────────────────────────────
  return (
    <div style={{
      display:'flex', flexDirection:'column', height:'100%',
      background: bgGrad, position:'relative', overflow:'hidden',
      animation: shaking === 'big' ? 'battleBigShake 0.5s ease-out' : shaking === 'light' ? 'battleShake 0.35s ease-out' : 'none'
    }}>
      <style>{BATTLE_REDESIGN_CSS}</style>

      {/* Scanline */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:1, overflow:'hidden', opacity:0.05 }}>
        <div style={{ position:'absolute', left:0, right:0, height:'40%', background:'linear-gradient(transparent,rgba(255,255,255,0.15),transparent)', animation:'scanMove 4s linear infinite' }}/>
      </div>

      {/* Grid bg */}
      <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)', backgroundSize:'32px 32px', pointerEvents:'none', zIndex:0 }}/>

      {/* Slash FX */}
      <BattleSlashFX slashKey={slashKey} attacker={slashSide} />

      {/* Panel flash */}
      {flashPanel && (
        <div style={{ position:'absolute', inset:0, zIndex:55, pointerEvents:'none',
          background: flashPanel === 'player-hit' ? 'rgba(255,55,95,0.12)' : 'rgba(48,209,88,0.08)',
          animation:`${flashPanel === 'player-hit' ? 'battleHpFlash' : 'battleHealFlash'} 0.3s ease-out forwards` }}/>
      )}

      {/* Floating numbers */}
      {floats.map((f: any) => <BattleFloatNum key={f.id} {...f} />)}

      {/* Crit rings */}
      <BattleCritRing active={critRing === 'monster'} side="monster" />
      <BattleCritRing active={critRing === 'player'}  side="player" />

      {/* ── HEADER ── */}
      <div style={{ position:'relative', zIndex:10, background:'rgba(0,0,0,0.6)', borderBottom:'1px solid rgba(255,255,255,0.08)', padding:'7px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontFamily:'monospace', fontSize:9, color:'rgba(255,55,95,0.7)', letterSpacing:3, fontWeight:700 }}>COMBAT</span>
          <span style={{ background:`${rankCol}18`, color:rankCol, border:`1px solid ${rankCol}44`, fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:3, fontFamily:'monospace' }}>RANK {bs.monster.rank}</span>
          {isRunning && <span style={{ fontSize:9, color:'rgba(255,214,0,0.6)', fontFamily:'monospace' }}>TURN {bs.turn||0}</span>}
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <button onClick={onEnd} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.6)', borderRadius:6, padding:'3px 10px', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'monospace' }}>
            {isResult ? '← KEMBALI' : '← KABUR'}
          </button>
          {!isResult && (
            <button onClick={onToggleAuto} style={{
              background: autoBattle ? 'rgba(255,214,0,0.15)' : 'rgba(255,255,255,0.05)',
              border: autoBattle ? '1px solid rgba(255,214,0,0.6)' : '1px solid rgba(255,255,255,0.1)',
              color: autoBattle ? '#ffd60a' : 'rgba(255,255,255,0.35)',
              borderRadius:6, padding:'3px 10px', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'monospace',
              animation: autoBattle ? 'battleAutoPulse 1.5s infinite' : 'none'
            }}>
              ⚡ AUTO {autoBattle ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
      </div>

      {/* ── ARENA HP BARS ── */}
      <div style={{ position:'relative', zIndex:10, padding:'10px 12px 6px', flexShrink:0 }}>

        {/* Combo counter */}
        {combo >= 2 && isRunning && (
          <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', zIndex:20, textAlign:'center', animation:'comboIn 0.4s cubic-bezier(.34,1.56,.64,1)' }}>
            <div style={{ fontFamily:'monospace', fontWeight:900, fontSize:combo>=10?22:18, color:'#ffd60a', animation:'comboPulse 0.8s infinite', letterSpacing:1 }}>{combo} HIT!</div>
            <div style={{ fontSize:8, color:'rgba(255,214,0,0.5)', letterSpacing:2, marginTop:-2 }}>COMBO</div>
          </div>
        )}

        <div style={{ display:'flex', gap:8, alignItems:'stretch' }}>

          {/* ── PLAYER CARD ── */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4, padding:'10px 10px 8px',
            background:'rgba(0,100,255,0.06)', border:'1px solid rgba(0,100,255,0.15)', borderRadius:10,
            animation: flashPanel === 'player-hit' ? 'battleHpFlash 0.3s ease-out' : undefined }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
              <div style={{ fontSize:26, filter:'drop-shadow(0 0 8px rgba(0,122,255,0.6))' }}>{RPG_CLASSES[char.class].emoji}</div>
              <div>
                <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.8)', fontFamily:'monospace' }}>{char.username}</div>
                <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', fontFamily:'monospace' }}>{char.class.toUpperCase()}</div>
              </div>
            </div>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, fontFamily:'monospace', marginBottom:2 }}>
                <span style={{ color:hpColor, fontWeight:700 }}>HP</span><span style={{ color:hpColor }}>{bs.playerHp}</span>
              </div>
              <BattleBar pct={pHpPct} color={hpColor} height={7} glow={pHpPct<30} />
            </div>
            {bs.playerShieldMax > 0 && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, fontFamily:'monospace', marginBottom:2 }}>
                  <span style={{ color:'#4fc3f7' }}>🛡️</span><span style={{ color:'#4fc3f7' }}>{bs.playerShield}</span>
                </div>
                <BattleBar pct={pShPct} color='#4fc3f7' height={4} glow={pShPct>0} />
              </div>
            )}
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, fontFamily:'monospace', marginBottom:2 }}>
                <span style={{ color:'#5ac8fa' }}>MP</span><span style={{ color:'#5ac8fa' }}>{bs.playerMp}</span>
              </div>
              <BattleBar pct={pMpPct} color='#5ac8fa' height={4} />
            </div>
          </div>

          {/* ── CENTER VS ── */}
          <div style={{ flexShrink:0, width:36, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4 }}>
            <div style={{ fontSize:18, animation:'vsGlitch 5s infinite', fontWeight:900, fontFamily:'monospace', color:'rgba(255,255,255,0.7)' }}>⚔️</div>
            <div style={{ fontSize:8, fontFamily:'monospace', letterSpacing:2, color:'rgba(255,255,255,0.2)', fontWeight:700 }}>VS</div>
          </div>

          {/* ── MONSTER CARD ── */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4, padding:'10px 10px 8px',
            background: mIsRage ? 'rgba(255,55,95,0.12)' : 'rgba(255,55,95,0.06)',
            border: `1px solid ${mIsRage ? 'rgba(255,55,95,0.4)' : 'rgba(255,55,95,0.15)'}`,
            borderRadius:10,
            animation: mIsRage ? 'rageFlicker 1.2s infinite' : undefined }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, justifyContent:'flex-end' }}>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:10, fontWeight:800, color:'rgba(255,255,255,0.8)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:80 }}>{bs.monster.name}</div>
                <div style={{ fontSize:8, color: mIsRage ? '#ff375f' : 'rgba(255,255,255,0.3)', fontFamily:'monospace', fontWeight: mIsRage ? 700 : 400 }}>
                  {mIsRage ? '💢 RAGE!' : `RANK ${bs.monster.rank}`}
                </div>
              </div>
              <div style={{ fontSize:26, animation: mIsRage ? 'rageFlicker 0.8s infinite' : 'battleIdleFloat 2.5s ease-in-out infinite',
                filter:`drop-shadow(0 0 ${mIsRage ? '18px rgba(255,55,95,1)' : '10px rgba(255,55,95,0.5)'})` }}>
                {bs.monster.emoji}
              </div>
            </div>
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, fontFamily:'monospace', marginBottom:2 }}>
                <span style={{ color:'#ff375f', fontWeight:700 }}>HP</span><span style={{ color:'#ff375f88' }}>{bs.monsterHp}/{bs.monster.hp}</span>
              </div>
              <BattleBar pct={mHpPct} color={mIsRage ? '#ff375f' : '#ff6b6b'} height={7} glow={mIsRage} />
            </div>
            {bs.monsterShieldMax > 0 && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, fontFamily:'monospace', marginBottom:2 }}>
                  <span style={{ color:'#fb923c' }}>🛡️</span><span style={{ color:'#fb923c' }}>{bs.monsterShield}</span>
                </div>
                <BattleBar pct={mShPct} color='#fb923c' height={4} glow={mShPct>0} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BATTLE LOG ── */}
      <div ref={logRef} style={{
        flex:'1 1 0', overflowY:'auto', margin:'0 12px 8px',
        background:'rgba(0,0,0,0.55)', borderRadius:8, padding:'8px 10px',
        border:'1px solid rgba(255,255,255,0.06)', position:'relative', zIndex:10, scrollbarWidth:'none'
      }}>
        {bs.log.map((l: any, i: number) => (
          <div key={l.id ?? i} style={{
            color: LOG_COLOR[l.type as keyof typeof LOG_COLOR] || LOG_COLOR.info,
            marginBottom:3, fontFamily:'monospace', fontSize:10.5, lineHeight:1.5,
            animation:'battleLogIn 0.25s ease-out',
            opacity: i < bs.log.length - 8 ? 0.5 : 1,
            fontWeight: l.type === 'info' ? 700 : 400
          }}>
            {l.text}
          </div>
        ))}
        {isRunning && (
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'rgba(255,214,0,0.7)', marginTop:4 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:'#ffd60a', animation:'battleAutoPulse 1s infinite' }}/>
            <span style={{ fontFamily:'monospace', fontSize:9, letterSpacing:1 }}>BATTLE IN PROGRESS...</span>
          </div>
        )}
      </div>

      {/* ── RESULT ── */}
      {isResult && (
        <div style={{ padding:'0 12px 14px', position:'relative', zIndex:10, textAlign:'center' }}>
          <div style={{ fontSize:44, marginBottom:4, animation:'battleWinPop 0.5s cubic-bezier(.34,1.56,.64,1)' }}>
            {bs.result === 'win' ? '🏆' : '💀'}
          </div>
          <div style={{ fontSize:20, fontWeight:900, letterSpacing:3, fontFamily:'monospace', marginBottom:8,
            color: bs.result === 'win' ? '#ffd60a' : '#ff375f',
            textShadow: bs.result === 'win' ? '0 0 24px rgba(255,214,0,0.8)' : '0 0 24px rgba(255,55,95,0.8)',
            animation:'battleGlitch 4s infinite' }}>
            {bs.result === 'win' ? 'VICTORY' : 'DEFEATED'}
          </div>
          {autoBattle && bs.result === 'win' && (
            <div style={{ fontSize:10, color:'rgba(255,214,0,0.6)', fontFamily:'monospace', marginBottom:8, letterSpacing:1 }}>⚡ RESTARTING AUTO-BATTLE...</div>
          )}
          <button onClick={onEnd} style={{ width:'100%', padding:'12px 0',
            background: bs.result === 'win' ? 'rgba(255,214,0,0.15)' : 'rgba(255,55,95,0.15)',
            border:`1px solid ${bs.result === 'win' ? 'rgba(255,214,0,0.5)' : 'rgba(255,55,95,0.5)'}`,
            borderRadius:10, color:'#fff', fontSize:13, fontWeight:800, cursor:'pointer',
            fontFamily:'monospace', letterSpacing:1 }}>
            {bs.result === 'win' ? '⚔️ LANJUT BERTARUNG' : '🔄 COBA LAGI'}
          </button>
        </div>
      )}

      {/* ── TURN INDICATOR ── */}
      {isRunning && !isResult && (
        <div style={{ position:'relative', zIndex:10, padding:'0 12px 10px', display:'flex', justifyContent:'center' }}>
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ width: i === (bs.turn||0)%5 ? 14 : 6, height:3, borderRadius:3,
                background: i === (bs.turn||0)%5 ? '#ffd60a' : 'rgba(255,255,255,0.12)',
                transition:'all 0.3s' }}/>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RpgQuest({ char, msg, onAccept, onCancel, onClaim, onBack }: {
  char: RpgChar; msg: string; onAccept: (id: string) => void; onCancel: () => void; onClaim: () => void; onBack: () => void
}) {
  return (
    <div style={{ padding: 16 }} className="gc2-fadein">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding: '6px 12px', fontSize: 12 }}>← Kembali</button>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>📜 Quest Board</span>
      </div>
      {msg && <div style={{ background: 'rgba(200,245,0,0.1)', border: '1px solid rgba(200,245,0,0.2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#c8f500', marginBottom: 10 }}>{msg}</div>}

      {char.activeQuest && (
        <div style={{ background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#ffd700', fontWeight: 700, marginBottom: 4 }}>
            📌 Quest Aktif: {QUESTS.find(q => q.id === char.activeQuest)?.name}
          </div>
          {(() => { const q2 = QUESTS.find(q => q.id === char.activeQuest); const done = q2 && char.questProgress >= q2.kills; return (<>
          <div style={{ fontSize: 11, color: done?'#c8f500':'rgba(255,255,255,0.5)', marginBottom: 6, fontWeight: done?700:400 }}>
            Progress: {char.questProgress}/{q2?.kills} {done && '✅ SELESAI!'}
          </div>
          <StatBar val={char.questProgress} max={q2?.kills || 1} type="exp"/>
          <div style={{display:'flex',gap:6,marginTop:8}}>
            {done ? (
              <button className="gc2-rpg-btn primary" onClick={onClaim} style={{flex:1,animation:'btnPulse 1.5s infinite',fontSize:12}}>🎁 Klaim Reward!</button>
            ) : (
              <button className="gc2-rpg-btn danger" onClick={onCancel} style={{ flex:1, fontSize: 11, padding: '5px 10px' }}>❌ Batalkan Quest</button>
            )}
          </div>
          </>)})()}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {QUESTS.map(q => (
          <div key={q.id} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${char.activeQuest === q.id ? 'rgba(200,245,0,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{q.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{q.desc}</div>
                <div style={{ fontSize: 11, color: '#c8f500' }}>+{q.expReward} EXP · +{q.goldReward} Gold · 🎁 {q.itemReward}</div>
              </div>
              {!char.activeQuest && (
                <button className="gc2-rpg-btn primary" onClick={() => onAccept(q.id)} style={{ fontSize: 11, padding: '5px 10px', flexShrink: 0, marginLeft: 8 }}>
                  Terima
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RpgShop({ char, items, msg, onBuy, onBack }: {
  char: RpgChar; items: typeof ITEMS_SHOP; msg: string
  onBuy: (item: typeof ITEMS_SHOP[0]) => void; onBack: () => void
}) {
  const lvl = char.level || 1
  const [cooldownUntil, setCooldownUntil] = React.useState(0)
  const [buying, setBuying] = React.useState<string|null>(null)
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    if (cooldownUntil > Date.now()) {
      const t = setInterval(() => { setTick(v=>v+1); if (Date.now() >= cooldownUntil) clearInterval(t) }, 100)
      return () => clearInterval(t)
    }
  }, [cooldownUntil])

  const isPotion = (item: typeof ITEMS_SHOP[0]) => item.effect.includes('hp+') || item.effect.includes('mp+')

  const getPrice = (item: typeof ITEMS_SHOP[0]) => {
    if (isPotion(item)) return item.price
    const tiers = Math.min(Math.floor((lvl - 1) / 10), 2)
    return Math.round(item.price * (1 + tiers * 0.5))
  }

  const getDiscount = (item: typeof ITEMS_SHOP[0]) => {
    if (isPotion(item)) return null
    const tiers = Math.min(Math.floor((lvl - 1) / 10), 2)
    if (tiers === 0) return null
    return `+${tiers * 50}%`
  }

  const getMaxBuyCount = (item: typeof ITEMS_SHOP[0]) => {
    const price = getPrice(item)
    if (!isPotion(item)) return 1
    const efx = item.effect.split(',')
    let hpPerItem = 0, mpPerItem = 0
    efx.forEach(e => { const [k,v] = e.split('+'); if(k==='hp') hpPerItem=parseInt(v); if(k==='mp') mpPerItem=parseInt(v) })
    const hpNeeded = hpPerItem > 0 ? Math.max(0, char.maxHp - char.hp) : 0
    const mpNeeded = mpPerItem > 0 ? Math.max(0, char.maxMp - char.mp) : 0
    const neededCount = hpPerItem > 0 && mpPerItem > 0
      ? Math.max(Math.ceil(hpNeeded/hpPerItem), Math.ceil(mpNeeded/mpPerItem))
      : hpPerItem > 0 ? Math.ceil(hpNeeded/hpPerItem) : Math.ceil(mpNeeded/mpPerItem)
    const affordCount = Math.floor(char.gold / price)
    return Math.max(1, Math.min(neededCount, affordCount))
  }

  const getTotalCost = (item: typeof ITEMS_SHOP[0]) => getPrice(item) * getMaxBuyCount(item)

  const onBuyWithCooldown = (item: typeof ITEMS_SHOP[0]) => {
    const now = Date.now()
    if (now < cooldownUntil) return
    setCooldownUntil(now + 2000)
    setBuying(item.id)
    onBuy(item)
    setTimeout(() => setBuying(null), 600)
  }

  const cdLeft = Math.max(0, (cooldownUntil - Date.now()) / 1000)

  const ITEM_CATEGORIES = [
    { key: 'potion', label: '💊 Pemulihan', filter: (i: typeof ITEMS_SHOP[0]) => isPotion(i) },
    { key: 'equip',  label: '⚔️ Permanen',  filter: (i: typeof ITEMS_SHOP[0]) => !isPotion(i) },
  ]

  const [activeCategory, setActiveCategory] = React.useState<'potion'|'equip'>('potion')
  const cat = ITEM_CATEGORIES.find(c => c.key === activeCategory)!
  const filteredItems = items.filter(cat.filter)

  const levelUpTier = Math.min(Math.floor((lvl - 1) / 10), 2)

  return (
    <div className="gc2-fadein" style={{ display:'flex', flexDirection:'column', height:'100%', background:'#080810' }}>
      {/* ── ZZZ SHOP HEADER ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(200,245,0,0.08) 0%, rgba(0,0,0,0) 100%)',
        borderBottom: '1px solid rgba(200,245,0,0.12)',
        padding: '12px 16px 10px',
        flexShrink: 0,
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'5px 10px', fontSize:11, borderRadius:8 }}>← Kembali</button>
            <div>
              <div style={{ fontSize:15, fontWeight:900, color:'#c8f500', letterSpacing:.5, lineHeight:1 }}>🛒 TOKO</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', fontFamily:'monospace', letterSpacing:2 }}>ITEM SHOP • LV {lvl}</div>
            </div>
          </div>
          <div style={{
            display:'flex', alignItems:'center', gap:6,
            background:'rgba(255,215,0,0.1)', border:'1px solid rgba(255,215,0,0.25)',
            borderRadius:10, padding:'6px 12px'
          }}>
            <span style={{ fontSize:16 }}>💰</span>
            <span style={{ fontSize:15, fontWeight:900, color:'#ffd700', fontFamily:'monospace' }}>
              {char.gold.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Level tier warning */}
        {levelUpTier > 0 && (
          <div style={{
            marginTop:8,
            background:'rgba(255,120,0,0.1)', border:'1px solid rgba(255,120,0,0.25)',
            borderRadius:8, padding:'5px 10px', fontSize:10,
            color:'#ffaa44', display:'flex', alignItems:'center', gap:6
          }}>
            <span>⚠️</span>
            <span>Harga item permanen naik <strong style={{color:'#ffcc00'}}>{levelUpTier*50}%</strong> (Level {lvl} — setiap 10 level +50%, max 100% di Lv70+)</span>
          </div>
        )}
      </div>

      {/* ── CATEGORY TABS ── */}
      <div style={{ display:'flex', gap:0, padding:'8px 12px 0', flexShrink:0 }}>
        {ITEM_CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setActiveCategory(c.key as any)} style={{
            flex:1, padding:'7px 4px', fontSize:11, fontWeight:700, cursor:'pointer',
            background: activeCategory===c.key ? 'rgba(200,245,0,0.12)' : 'transparent',
            border:'none', borderBottom: activeCategory===c.key ? '2px solid #c8f500' : '2px solid transparent',
            color: activeCategory===c.key ? '#c8f500' : 'rgba(255,255,255,0.35)',
            transition:'all .2s', borderRadius:'6px 6px 0 0'
          }}>
            {c.label}
          </button>
        ))}
      </div>

      {/* ── MSG ── */}
      {msg && (
        <div style={{
          margin:'8px 12px 0', padding:'8px 12px', borderRadius:10, fontSize:12, fontWeight:700,
          background: msg.startsWith('✅') ? 'rgba(80,220,80,0.1)' : msg.startsWith('⏳') ? 'rgba(255,215,0,0.1)' : 'rgba(255,80,80,0.1)',
          border: `1px solid ${msg.startsWith('✅') ? 'rgba(80,220,80,0.25)' : msg.startsWith('⏳') ? 'rgba(255,215,0,0.25)' : 'rgba(255,80,80,0.25)'}`,
          color: msg.startsWith('✅') ? '#80ff99' : msg.startsWith('⏳') ? '#ffd700' : '#ff8080',
          animation:'fadeInUp .2s ease', flexShrink:0,
        }}>{msg}</div>
      )}

      {/* ── COOLDOWN BAR ── */}
      {cdLeft > 0 && (
        <div style={{ margin:'4px 12px 0', flexShrink:0 }}>
          <div style={{ height:3, background:'rgba(255,255,255,0.08)', borderRadius:2, overflow:'hidden' }}>
            <div style={{
              height:'100%', borderRadius:2,
              background:'linear-gradient(90deg,#c8f500,#00e5ff)',
              width:`${(cdLeft/2)*100}%`,
              transition:'width .1s linear'
            }}/>
          </div>
          <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginTop:2, fontFamily:'monospace' }}>
            ⏳ Cooldown: {cdLeft.toFixed(1)}s
          </div>
        </div>
      )}

      {/* ── ITEMS LIST ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'8px 12px 16px', display:'flex', flexDirection:'column', gap:8 }}>
        {filteredItems.map(item => {
          const price = getPrice(item)
          const discount = getDiscount(item)
          const canAfford = char.gold >= price
          const maxCount = getMaxBuyCount(item)
          const totalCost = getTotalCost(item)
          const isBuying = buying === item.id
          const onCooldown = cdLeft > 0
          const isHpMp = isPotion(item)
          const alreadyFull = isHpMp && (() => {
            const efx = item.effect.split(',')
            let full = true
            efx.forEach(e => { const [k] = e.split('+'); if(k==='hp' && char.hp < char.maxHp) full=false; if(k==='mp' && char.mp < char.maxMp) full=false })
            return full
          })()

          return (
            <div key={item.id} style={{
              background: isBuying ? 'rgba(200,245,0,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isBuying ? 'rgba(200,245,0,0.3)' : canAfford ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}`,
              borderRadius:14, padding:'11px 12px',
              display:'flex', alignItems:'center', gap:12,
              transition:'all .25s cubic-bezier(.4,0,.2,1)',
              transform: isBuying ? 'scale(1.01)' : 'scale(1)',
              opacity: (!canAfford && !isHpMp) ? 0.5 : 1,
            }}>
              {/* Icon */}
              <div style={{
                width:46, height:46, borderRadius:12, flexShrink:0,
                background: isHpMp ? 'rgba(79,195,247,0.1)' : 'rgba(200,245,0,0.07)',
                border: `1px solid ${isHpMp ? 'rgba(79,195,247,0.2)' : 'rgba(200,245,0,0.15)'}`,
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:26,
              }}>
                {item.emoji}
              </div>

              {/* Info */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ fontSize:13, fontWeight:800, color: alreadyFull ? 'rgba(255,255,255,0.4)' : '#fff', lineHeight:1.2 }}>{item.name}</div>
                  {isHpMp && <span style={{ fontSize:9, background:'rgba(79,195,247,0.15)', color:'#4fc3f7', border:'1px solid rgba(79,195,247,0.3)', borderRadius:4, padding:'1px 5px', fontWeight:700 }}>AUTO</span>}
                  {discount && <span style={{ fontSize:9, background:'rgba(255,120,0,0.15)', color:'#ff8844', border:'1px solid rgba(255,120,0,0.3)', borderRadius:4, padding:'1px 5px', fontWeight:700 }}>{discount}</span>}
                </div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginTop:1 }}>{item.desc}</div>
                {isHpMp && alreadyFull && <div style={{ fontSize:9, color:'#c8f500', marginTop:2, fontWeight:700 }}>✅ Sudah penuh!</div>}
                {isHpMp && !alreadyFull && maxCount > 1 && (
                  <div style={{ fontSize:9, color:'rgba(200,245,0,0.6)', marginTop:2 }}>
                    ×{maxCount} otomatis · Total: 💰{totalCost.toLocaleString()}
                  </div>
                )}
                {discount && <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', textDecoration:'line-through', marginTop:1 }}>💰{item.price}</div>}
              </div>

              {/* Buy button */}
              <button
                onClick={() => !onCooldown && !alreadyFull && onBuyWithCooldown(item)}
                disabled={(!canAfford && !isHpMp) || alreadyFull || onCooldown}
                style={{
                  minWidth:60, padding:'7px 12px', borderRadius:10,
                  border:'none', cursor: (!canAfford && !isHpMp) || alreadyFull || onCooldown ? 'not-allowed' : 'pointer',
                  background: alreadyFull ? 'rgba(200,245,0,0.07)'
                    : onCooldown ? 'rgba(255,255,255,0.05)'
                    : canAfford ? (isHpMp ? 'linear-gradient(135deg,#4fc3f7,#0288d1)' : 'linear-gradient(135deg,#c8f500,#a0c800)')
                    : 'rgba(255,255,255,0.06)',
                  color: alreadyFull ? 'rgba(200,245,0,0.4)'
                    : onCooldown ? 'rgba(255,255,255,0.3)'
                    : canAfford ? '#000'
                    : 'rgba(255,255,255,0.25)',
                  fontSize:11, fontWeight:900,
                  transition:'all .2s cubic-bezier(.4,0,.2,1)',
                  transform: isBuying ? 'scale(.95)' : 'scale(1)',
                  boxShadow: canAfford && !alreadyFull && !onCooldown
                    ? (isHpMp ? '0 3px 12px rgba(79,195,247,0.35)' : '0 3px 12px rgba(200,245,0,0.35)')
                    : 'none',
                  flexShrink:0, textAlign:'center', lineHeight:1.3,
                }}>
                {alreadyFull ? '✅' : onCooldown ? '⏳' : (
                  <>
                    <div>💰{price.toLocaleString()}</div>
                    {isHpMp && maxCount > 1 && <div style={{fontSize:9,opacity:.8}}>×{maxCount}</div>}
                  </>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* ── BOTTOM HINT ── */}
      <div style={{
        padding:'6px 16px 10px', flexShrink:0,
        fontSize:9, color:'rgba(255,255,255,0.18)', textAlign:'center', lineHeight:1.6
      }}>
        💊 Potion HP/MP: harga tetap • beli otomatis sampai full sesuai saldo<br/>
        ⚔️ Item permanen: harga naik +50% per 10 level (max +100% di Lv70+)<br/>
        🛡️ Cooldown 2 detik per pembelian untuk hemat Firebase
      </div>
    </div>
  )
}

function RpgLeaderboard({ data, onBack, onRefresh }: { data: {username:string;level:number;class:RpgClass;kills:number}[]; onBack: () => void; onRefresh?: () => void }) {
  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    if (!onRefresh) return
    setRefreshing(true)
    await onRefresh()
    setTimeout(() => setRefreshing(false), 1000)
  }
  return (
    <div style={{ padding: 16 }} className="gc2-fadein">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding: '6px 12px', fontSize: 12 }}>← Kembali</button>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, flex: 1 }}>🏆 Papan Skor</span>
        {onRefresh && (
          <button className="gc2-rpg-btn secondary" onClick={handleRefresh} disabled={refreshing} style={{ padding: '6px 10px', fontSize: 11 }}>
            {refreshing ? '⏳' : '🔄'} Refresh
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: 24 }}>Belum ada data</div>}
        {data.map((p, i) => (
          <div key={i} style={{
            background: i === 0 ? 'rgba(255,215,0,0.08)' : i === 1 ? 'rgba(200,200,200,0.06)' : i === 2 ? 'rgba(180,120,60,0.07)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${i === 0 ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12
          }}>
            <div style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
            </div>
            <div style={{ fontSize: 22, lineHeight: 1 }}>{RPG_CLASSES[p.class].emoji}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: i < 3 ? '#fff' : 'rgba(255,255,255,0.8)' }}>{p.username}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{p.class} · ⚔️{p.kills} kills</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#c8f500' }}>Lv.{p.level}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RPG CLASS CHANGE COMPONENT
// ═══════════════════════════════════════════════════════════════
function RpgClassChange({ char, cost, onChange, onBack }: {
  char: RpgChar; cost: number; onChange: (cls: RpgClass) => void; onBack: () => void
}) {
  const [confirm, setConfirm] = useState<RpgClass | null>(null)
  const classes = Object.entries(RPG_CLASSES) as [RpgClass, typeof RPG_CLASSES[RpgClass]][]
  const canAfford = char.gold >= cost

  return (
    <div style={{ position:'absolute', inset:0, background:'rgba(8,8,8,0.97)', zIndex:20, padding:16, overflowY:'auto' }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#fff', fontWeight:700, fontSize:15 }}>🔄 Ganti Class</span>
      </div>

      <div style={{ background:'rgba(255,215,0,0.07)', border:'1px solid rgba(255,215,0,0.2)', borderRadius:12, padding:'10px 14px', marginBottom:14, fontSize:12 }}>
        <div style={{ color:'#ffd700', fontWeight:700, marginBottom:2 }}>⚠️ Biaya Ganti Class</div>
        <div style={{ color:'rgba(255,255,255,0.6)', lineHeight:1.5 }}>
          Biaya: <strong style={{color:canAfford?'#c8f500':'#ff6b6b'}}>{cost.toLocaleString()} Gold</strong> · Kamu punya: <strong style={{color:'#ffd700'}}>{char.gold.toLocaleString()} Gold</strong><br/>
          Skill akan berganti sesuai class baru. Level & EXP tetap. Stat ambil nilai tertinggi.
        </div>
      </div>

      {!canAfford && (
        <div style={{ background:'rgba(255,80,80,0.1)', border:'1px solid rgba(255,80,80,0.2)', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:12, color:'#ff8080' }}>
          ❌ Gold tidak cukup! Kamu perlu {(cost - char.gold).toLocaleString()} Gold lagi.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {classes.map(([cls, data]) => {
          const isCurrent = cls === char.class
          return (
            <button key={cls} onClick={() => !isCurrent && canAfford && setConfirm(cls)} style={{
              background: isCurrent ? 'rgba(200,245,0,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isCurrent ? '#c8f500' : 'rgba(255,255,255,0.1)'}`,
              borderRadius:12, padding:'10px 12px', cursor: isCurrent || !canAfford ? 'not-allowed':'pointer',
              textAlign:'left', opacity: isCurrent ? 1 : canAfford ? 1 : 0.5, transition:'all .2s'
            }}>
              <div style={{ fontSize:22, marginBottom:2 }}>{data.emoji}</div>
              <div style={{ fontSize:12, fontWeight:700, color: isCurrent ? '#c8f500' : '#fff' }}>
                {cls} {isCurrent && '(Aktif)'}
              </div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', lineHeight:1.3, marginTop:2 }}>{data.desc}</div>
              <div style={{ marginTop:4, display:'flex', flexWrap:'wrap', gap:3 }}>
                {[['❤️',data.baseHp],['⚔️',data.atk],['🛡️',data.def],['💙',data.baseMp]].map(([e,v])=>(
                  <span key={String(e)} style={{fontSize:9, color:'rgba(255,255,255,0.5)'}}>{e}{v}</span>
                ))}
              </div>
            </button>
          )
        })}
      </div>

      {confirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:99, padding:24 }}>
          <div style={{ background:'#161616', border:'1px solid rgba(200,245,0,0.25)', borderRadius:18, padding:24, maxWidth:300, width:'100%' }}>
            <div style={{ fontSize:32, textAlign:'center', marginBottom:8 }}>{RPG_CLASSES[confirm].emoji}</div>
            <div style={{ fontSize:15, fontWeight:800, color:'#fff', textAlign:'center', marginBottom:6 }}>Ganti ke {confirm}?</div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', textAlign:'center', marginBottom:16, lineHeight:1.5 }}>
              Kamu akan kehilangan <strong style={{color:'#ff8080'}}>{cost.toLocaleString()} Gold</strong>.<br/>
              Class saat ini: <strong style={{color:'#c8f500'}}>{char.class}</strong> → <strong style={{color:'#ffd700'}}>{confirm}</strong>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="gc2-rpg-btn secondary" onClick={() => setConfirm(null)} style={{flex:1}}>Batal</button>
              <button className="gc2-rpg-btn primary" onClick={() => { onChange(confirm); setConfirm(null) }} style={{flex:1}}>✅ Konfirmasi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DUNGEON COMPONENTS
// ═══════════════════════════════════════════════════════════════

function DungeonSelect({ char, gachaData, onStart, onBack }: {
  char: RpgChar; gachaData: PlayerGacha | null
  onStart: (bossIdx: number, party: GachaChar[]) => void; onBack: () => void
}) {
  const [selBoss, setSelBoss] = useState<number | null>(null)
  const party = (char.party || []).map(id => GACHA_CHARS.find(c => c.id === id)).filter(Boolean) as GachaChar[]
  const owned = gachaData ? GACHA_CHARS.filter(c => gachaData.roster.includes(c.id)) : []

  return (
    <div style={{ padding:16, overflowY:'auto', height:'100%' }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#ff8080', fontWeight:800, fontSize:15 }}>🏰 Dungeon Boss</span>
      </div>

      {party.length === 0 && (
        <div style={{ background:'rgba(255,100,100,0.08)', border:'1px solid rgba(255,100,100,0.2)', borderRadius:10, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#ff9090' }}>
          ⚠️ Party kosong! Buka <strong>Atur Party</strong> di dashboard dulu untuk memilih karakter gacha.<br/>
          <span style={{color:'rgba(255,255,255,0.4)',fontSize:11}}>Kamu punya {owned.length} karakter: {owned.slice(0,3).map(c=>c.name).join(', ')}{owned.length>3?'...':''}</span>
        </div>
      )}

      {party.length > 0 && (
        <div style={{ background:'rgba(0,229,255,0.06)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:10, padding:'8px 12px', marginBottom:12 }}>
          <div style={{ fontSize:11, color:'rgba(0,229,255,0.7)', marginBottom:6, fontWeight:700 }}>👥 PARTY KAMU ({party.length}/4)</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {party.map(c => (
              <div key={c.id} style={{ background:'rgba(255,255,255,0.06)', borderRadius:8, padding:'4px 8px', fontSize:11, display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ color: GACHA_ELEM_COLOR[c.element] }}>{c.emoji}</span>
                <span style={{ color:'#fff', fontWeight:700 }}>{c.name}</span>
                <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)' }}>{c.element}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:8, fontWeight:700, textTransform:'uppercase', letterSpacing:.5 }}>Pilih Boss</div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {DUNGEON_BOSSES.map((boss, i) => {
          const rankColor = { Normal:'#80ff80', Elite:'#ffd700', Weekly:'#ff9d00', Archon:'#ff4444' }[boss.rank]
          const isSelected = selBoss === i
          const partyCanFight = party.some(c => boss.weakness.includes(c.element))
          return (
            <button key={boss.id} onClick={() => setSelBoss(isSelected ? null : i)} style={{
              background: isSelected ? 'rgba(255,80,80,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isSelected ? 'rgba(255,80,80,0.4)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius:12, padding:'10px 12px', cursor:'pointer', textAlign:'left', transition:'all .2s'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ fontSize:32, lineHeight:1 }}>{boss.emoji}</div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'#fff' }}>{boss.name}</span>
                    <span style={{ fontSize:9, background:`${rankColor}22`, color:rankColor, borderRadius:4, padding:'1px 5px', fontWeight:800 }}>{boss.rank}</span>
                    <span style={{ fontSize:10, color: GACHA_ELEM_COLOR[boss.element] }}>{boss.element}</span>
                  </div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{boss.desc}</div>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:2 }}>
                    ❤️{boss.hp} ⚔️{boss.atk} · +{boss.exp}EXP +{boss.gold}G +{boss.primogems}💎
                  </div>
                  <div style={{ fontSize:10, color:'rgba(255,150,150,0.7)', marginTop:2 }}>
                    ⚠️ Lemah vs: {boss.weakness.map(w => `${w}`).join(', ')}
                    {partyCanFight && <span style={{color:'#c8f500', marginLeft:4}}>✓ Party kamu efektif!</span>}
                  </div>
                </div>
              </div>
              {isSelected && (
                <button className="gc2-rpg-btn primary" style={{ marginTop:8, width:'100%', fontSize:12 }}
                  onClick={e => { e.stopPropagation(); if (party.length > 0) onStart(i, party) }}
                  disabled={party.length === 0}>
                  {party.length === 0 ? '❌ Atur Party Dulu' : `⚔️ Masuk Dungeon! (${party.length} chars)`}
                </button>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DungeonBattle({ char, ds, onEnd, onWin }: {
  char: RpgChar
  ds: { boss: DungeonBoss; activeChars: GachaChar[]; [key: string]: any }
  onEnd: () => void
  onWin: () => void
}) {
  const BOSS = ds.boss
  const PARTY = ds.activeChars

  const ELEM_COLOR: Record<string,string> = {
    Electro:'#c86eff', Pyro:'#ff6b3d', Hydro:'#00bfff', Anemo:'#74c2a0',
    Geo:'#daa520', Dendro:'#7cbb4a', Cryo:'#98d8ea', Spectro:'#ffd700', Havoc:'#9b59b6'
  }
  const RANK_COLOR: Record<string,string> = { Normal:'#80ff80', Elite:'#ffd700', Weekly:'#ff9d00', Archon:'#ff4444' }
  const BOSS_ULTIS: Record<string,{name:string;desc:string;color:string;dmgMult:number}> = {
    Archon: { name:'Musou no Hitotachi', desc:'Satu tebasan membelah dunia',   color:'#c86eff', dmgMult:2.8 },
    Weekly: { name:'Domain Assault',     desc:'Serangan domain merusak semua', color:'#ff9d00', dmgMult:2.2 },
    Elite:  { name:'Elemental Surge',    desc:'Ledakan elemen yang dahsyat',   color:'#ffd700', dmgMult:1.8 },
    Normal: { name:'Rage Burst',         desc:'Serangan brutal saat HP kritis',color:'#ff4444', dmgMult:1.5 },
  }

  const [bossHp,      setBossHp]      = useState(BOSS.hp)
  const [bossPhase,   setBossPhase]   = useState(1)
  const [bossEnergy,  setBossEnergy]  = useState(0)
  const [charHp,      setCharHp]      = useState(PARTY.map((c: GachaChar) => c.hp))
  const [charEnergy,  setCharEnergy]  = useState(PARTY.map(() => 0))
  const [charSkillCd, setCharSkillCd] = useState(PARTY.map(() => 0))
  const [currentChar, setCurrentChar] = useState(0)
  const [log,         setLog]         = useState([{ text: `⚔️ DUNGEON DIMULAI! ${PARTY.map((c: GachaChar)=>c.name).join(', ')} vs ${BOSS.emoji} ${BOSS.name}!`, type: 'info' as const }])
  const [done,        setDone]        = useState(false)
  const [result,      setResult]      = useState<'win'|'lose'|null>(null)
  const [turn,        setTurn]        = useState(1)

  const [shakeClass,  setShakeClass]  = useState('')
  const [bossFlash,   setBossFlash]   = useState(false)
  const [partyFlash,  setPartyFlash]  = useState<number|null>(null)
  const [floats,      setFloats]      = useState<{id:number;val:number;type:string;side:string}[]>([])
  const [combo,       setCombo]       = useState(0)
  const [bossRage,    setBossRage]    = useState(false)
  const [showUlti,    setShowUlti]    = useState<{name:string;desc:string;color:string;dmgMult:number}|null>(null)
  const [ultiPhase,   setUltiPhase]   = useState(0)

  const logRef  = useRef<HTMLDivElement>(null)
  const fId     = useRef(0)
  const stopped = useRef(false)
  const winCalled = useRef(false)

  const R = useRef<any>({})
  R.current = { bossHp, bossPhase, bossEnergy, charHp, charEnergy, charSkillCd, currentChar, turn }

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior:'smooth' }) }, [log])

  const addLog = useCallback((text: string, type = 'info') => setLog((p: any[]) => [...p.slice(-40), { text, type }]), [])

  const addFloat = useCallback((val: number, type: string, side: string) => {
    const id = ++fId.current
    setFloats((p: any[]) => [...p, { id, val, type, side }])
    setTimeout(() => setFloats((p: any[]) => p.filter((f: any) => f.id !== id)), 1500)
  }, [])

  const shake = useCallback((big = false) => {
    setShakeClass(big ? 'shake-lg' : 'shake-sm')
    setTimeout(() => setShakeClass(''), big ? 600 : 360)
  }, [])

  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

  useEffect(() => {
    stopped.current = false
    winCalled.current = false
    runLoop()
    return () => { stopped.current = true }
    // eslint-disable-next-line
  }, [])

  async function runLoop() {
    let { bossHp: bHp, bossPhase: bPhase, bossEnergy: bEn,
          charHp: cHp, charEnergy: cEn, charSkillCd: cCd, currentChar: cIdx } = R.current
    let localTurn = 1

    while (!stopped.current) {
      bHp    = R.current.bossHp
      bPhase = R.current.bossPhase
      bEn    = R.current.bossEnergy
      cHp    = [...R.current.charHp]
      cEn    = [...R.current.charEnergy]
      cCd    = [...R.current.charSkillCd]
      cIdx   = R.current.currentChar

      const alive = (cHp as number[]).map((h,i) => h > 0 ? i : -1).filter(x => x >= 0)
      if (alive.length === 0) break

      await wait(420)

      // ── PLAYER ACTION ──
      const char = PARTY[cIdx] as GachaChar
      // Scale stats based on character level stored in dungeon state
      const charLvDungeon = (ds.charLevels ?? {})[char.id] ?? 1
      const charStatMultDungeon = getCharStatMult(charLvDungeon, char.rarity)
      const scaledAtk = Math.floor(char.atk * charStatMultDungeon)
      const scaledDef = Math.floor(char.def * charStatMultDungeon)
      const isWeak = (BOSS.weakness || []).includes(char.element as any)
      let action = 'attack'
      if (cEn[cIdx] >= 100) action = 'burst'
      else if (cCd[cIdx] === 0 && Math.random() < 0.42) action = 'skill'

      if (action === 'burst') {
        const dmg = Math.max(30, Math.floor((scaledAtk * (isWeak?4:3.5) - BOSS.def*0.2) * (0.9+Math.random()*0.2)))
        bHp = Math.max(0, bHp - dmg)
        setBossHp(bHp); setBossFlash(true); setTimeout(()=>setBossFlash(false), 450)
        addFloat(dmg,'burst','boss')
        addLog(`💥 ${char.name} → ${char.burst}! ${dmg} BURST DMG!!!`, 'burst')
        setCombo((c: number) => c+3); cEn[cIdx]=0; setCharEnergy([...cEn])
        bEn=Math.min(100,bEn+22); setBossEnergy(bEn); shake(true)

      } else if (action === 'skill') {
        const dmg = Math.max(10, Math.floor((scaledAtk*(isWeak?1.9:1.5)-BOSS.def*0.3)*(0.95+Math.random()*0.1)))
        bHp = Math.max(0, bHp - dmg)
        setBossHp(bHp); setBossFlash(true); setTimeout(()=>setBossFlash(false), 350)
        addFloat(dmg,'skill','boss')
        addLog(`✨ ${char.name} → ${char.skill}! ${dmg} Skill DMG`, 'skill')
        setCombo((c: number) => c+1); cEn[cIdx]=Math.min(100,cEn[cIdx]+28); setCharEnergy([...cEn])
        cCd[cIdx]=2; setCharSkillCd([...cCd])
        bEn=Math.min(100,bEn+12); setBossEnergy(bEn); shake(false)

      } else {
        const isCrit = Math.random()<0.18
        const dmg = Math.max(5, Math.floor((scaledAtk*(isWeak?1.3:1)-BOSS.def*0.4)*(isCrit?2:1)*(0.88+Math.random()*0.24)))
        bHp = Math.max(0, bHp - dmg)
        setBossHp(bHp); setBossFlash(true); setTimeout(()=>setBossFlash(false), 280)
        addFloat(dmg, isCrit?'crit':'dmg', 'boss')
        addLog(`⚔️ ${char.name} menyerang! ${dmg}${isCrit?' CRIT!':''} DMG`, isCrit?'crit':'dmg')
        setCombo((c: number) => c+1); cEn[cIdx]=Math.min(100,cEn[cIdx]+(isCrit?22:14)); setCharEnergy([...cEn])
        bEn=Math.min(100,bEn+(isCrit?18:10)); setBossEnergy(bEn); shake(isCrit)
      }
      void scaledDef // used in future DEF reduction logic

      // ── Check WIN ──
      if (bHp <= 0) {
        await wait(350)
        addLog(`🏆 ${BOSS.name} dikalahkan! DUNGEON CLEAR!!! +${BOSS.exp}EXP +${BOSS.gold}G +${BOSS.primogems}💎`, 'win')
        if (!winCalled.current) { winCalled.current = true; onWin() }
        setResult('win'); setDone(true); return
      }

      // Phase 2
      if (bHp <= BOSS.phase2Hp && bPhase === 1) {
        bPhase = 2; setBossPhase(2)
        addLog(`🔥 ${BOSS.name} memasuki PHASE 2! Kekuatan meningkat!`, 'boss-ulti')
        await wait(500)
      }
      const bHpPct = (bHp / BOSS.hp) * 100
      setBossRage(bHpPct < 30)

      cCd = (cCd as number[]).map(cd => Math.max(0,cd-1)); setCharSkillCd([...cCd])

      const aliveNow = (cHp as number[]).map((h,i) => h>0?i:-1).filter(x=>x>=0)
      if (aliveNow.length > 0) {
        const nx = aliveNow[(aliveNow.indexOf(cIdx)+1) % aliveNow.length]
        cIdx = nx; setCurrentChar(nx)
      }

      await wait(380)

      // ── BOSS TURN ──
      const aliveForBoss = (cHp as number[]).map((h,i)=>h>0?i:-1).filter(x=>x>=0)
      if (aliveForBoss.length === 0) break

      // 1 — ULTI
      if (bEn >= 100) {
        bEn = 0; setBossEnergy(0)
        const ulti = BOSS_ULTIS[BOSS.rank] || BOSS_ULTIS.Normal
        setShowUlti(ulti); setUltiPhase(1)
        await wait(300); setUltiPhase(2)
        await wait(900); setUltiPhase(3)
        await wait(600); setUltiPhase(0); setShowUlti(null)
        aliveForBoss.forEach((i: number) => {
          const dmg = Math.max(10, Math.floor((BOSS.atk*ulti.dmgMult - (PARTY[i] as GachaChar).def*0.4)*(0.88+Math.random()*0.24)))
          cHp[i] = Math.max(0, cHp[i] - dmg)
          addFloat(dmg,'crit',`party_${i}`)
        })
        setCharHp([...cHp])
        addLog(`💥 ${BOSS.name} → ${ulti.name}! SEMUA karakter terkena!`, 'boss-ulti')
        shake(true)

      // 2 — HEAL
      } else if (bHpPct < 35 && Math.random() < 0.38) {
        const heal = Math.floor(BOSS.hp*0.07 + Math.random()*BOSS.hp*0.04)
        bHp = Math.min(BOSS.hp, bHp + heal); setBossHp(bHp)
        addFloat(heal,'heal','boss')
        addLog(`💚 ${BOSS.name} memulihkan ${heal} HP!`, 'heal')
        await wait(400)

      // 3 — RAGE hit
      } else if (bHpPct < 30 && Math.random() < 0.5) {
        const tgt = aliveForBoss[Math.floor(Math.random()*aliveForBoss.length)]
        const dmg = Math.max(12, Math.floor((BOSS.atk*(bPhase===2?1.9:1.6) - (PARTY[tgt] as GachaChar).def*0.3)*(1.1+Math.random()*0.3)))
        cHp[tgt] = Math.max(0,cHp[tgt]-dmg); setCharHp([...cHp])
        addFloat(dmg,'crit',`party_${tgt}`)
        addLog(`💢 RAGE! ${BOSS.name} → ${(PARTY[tgt] as GachaChar).name}: ${dmg} CRIT!`, 'boss-skill')
        setPartyFlash(tgt); setTimeout(()=>setPartyFlash(null), 400)
        bEn=Math.min(100,bEn+15); setBossEnergy(bEn); shake(true)

      // 4 — Normal
      } else {
        const tgt = aliveForBoss[Math.floor(Math.random()*aliveForBoss.length)]
        const isCrit = Math.random()<0.2
        const dmg = Math.max(8, Math.floor((BOSS.atk*(bPhase===2?1.25:1) - (PARTY[tgt] as GachaChar).def*0.45)*(isCrit?1.75:1)*(0.85+Math.random()*0.3)))
        cHp[tgt] = Math.max(0,cHp[tgt]-dmg); setCharHp([...cHp])
        addFloat(dmg, isCrit?'crit':'dmg', `party_${tgt}`)
        addLog(`🗡️ ${BOSS.name} → ${(PARTY[tgt] as GachaChar).name}: ${dmg}${isCrit?' CRIT!':''}`, isCrit?'boss-skill':'boss-dmg')
        setPartyFlash(tgt); setTimeout(()=>setPartyFlash(null), 350)
        bEn=Math.min(100,bEn+(isCrit?20:13)); setBossEnergy(bEn); shake(isCrit)
      }

      // ── Check LOSE ──
      if (!(cHp as number[]).some(h=>h>0)) {
        await wait(350)
        addLog('💀 Semua karakter KO! DUNGEON GAGAL...', 'lose')
        setResult('lose'); setDone(true); return
      }

      const aliveEnd = (cHp as number[]).map((h,i)=>h>0?i:-1).filter(x=>x>=0)
      if (!aliveEnd.includes(cIdx)) { cIdx=aliveEnd[0]; setCurrentChar(cIdx) }

      localTurn++; setTurn(localTurn)
    }
  }

  const bossHpPct = Math.max(0, (bossHp/BOSS.hp)*100)
  const rc = RANK_COLOR[BOSS.rank] || '#ff4444'
  const bc = ELEM_COLOR[BOSS.element] || '#ff4444'

  const DB_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700;900&family=Orbitron:wght@700;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
@keyframes shSm{0%,100%{transform:translate(0,0)}20%{transform:translate(-4px,3px)}40%{transform:translate(4px,-3px)}60%{transform:translate(-3px,4px)}80%{transform:translate(2px,-2px)}}
@keyframes shLg{0%,100%{transform:translate(0,0)}12%{transform:translate(-7px,6px)}28%{transform:translate(7px,-6px)}45%{transform:translate(-6px,7px)}62%{transform:translate(6px,-5px)}80%{transform:translate(-3px,3px)}}
.db2-shake-sm{animation:shSm .35s ease-out}.db2-shake-lg{animation:shLg .6s ease-out}
@keyframes fUp{0%{transform:translateY(0) scale(1);opacity:1}45%{transform:translateY(-34px) scale(1.15);opacity:1}100%{transform:translateY(-72px) scale(.55);opacity:0}}
.db2-float{position:absolute;left:50%;top:50%;transform:translateX(-50%);animation:fUp 1.4s ease-out forwards;pointer-events:none;z-index:99;font-family:'Orbitron',monospace;letter-spacing:1px;white-space:nowrap;font-weight:900}
@keyframes idleFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes rageFx{0%,100%{filter:drop-shadow(0 0 18px var(--bc,#f44))}40%{filter:drop-shadow(0 0 36px #ff1744) brightness(1.3) saturate(1.6)}}
@keyframes bossHitFx{0%{background:rgba(255,255,255,.2)}100%{background:transparent}}
.db2-idle-anim{animation:idleFloat 2.5s ease-in-out infinite}.db2-rage-anim{animation:rageFx .8s infinite}.db2-boss-hit{animation:bossHitFx .3s ease-out forwards}
@keyframes charHitFx{0%{background:rgba(255,55,95,.3)}100%{background:transparent}}
.db2-char-hit{animation:charHitFx .4s ease-out forwards}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes autoPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,214,0,.4)}50%{box-shadow:0 0 0 5px rgba(255,214,0,0)}}
@keyframes comboPulse{0%,100%{text-shadow:0 0 10px #ffd60a}50%{text-shadow:0 0 28px #ffd60a,0 0 50px #ffd60a}}
@keyframes comboIn{0%{transform:translateX(-50%) scale(.2) rotate(-12deg);opacity:0}55%{transform:translateX(-50%) scale(1.3) rotate(4deg);opacity:1}100%{transform:translateX(-50%) scale(1) rotate(0);opacity:1}}
@keyframes dotBlink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes scanMove{from{top:-35%}to{top:120%}}
@keyframes resultIn{0%{opacity:0;transform:scale(.8)}60%{transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
@keyframes iconPop{from{transform:scale(0) rotate(-20deg)}to{transform:scale(1) rotate(0)}}
@keyframes pBadge{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes particleOut{0%{transform:rotate(var(--a)) translateX(0) scale(0);opacity:1}100%{transform:rotate(var(--a)) translateX(var(--d)) scale(1);opacity:0}}
@keyframes ultiSlash{0%{transform:translateX(-130%) rotate(-22deg) scaleY(.3);opacity:0}8%{opacity:1}100%{transform:translateX(130%) rotate(-22deg) scaleY(.3);opacity:0}}
.db2-root{font-family:'Rajdhani','Segoe UI',sans-serif;background:linear-gradient(160deg,#0a0a18,#07070f);display:flex;flex-direction:column;height:100%;position:relative;overflow:hidden}
.db2-top-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,.5);border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0}
.db2-btn-small{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.55);border-radius:7px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Rajdhani',sans-serif;transition:all .2s}
.db2-btn-small:hover{background:rgba(255,255,255,.12);color:#fff}
.db2-mono-xs{font-family:'Orbitron',monospace;font-size:9px;color:rgba(255,255,255,.3);letter-spacing:2px;font-weight:700}
.db2-badge{font-family:'Orbitron',monospace;font-size:9px;font-weight:900;padding:2px 7px;border-radius:4px;letter-spacing:.5px}
.db2-badge-p{font-size:9px;font-weight:800;border:1px solid;border-radius:4px;padding:1px 6px;animation:pBadge .6s infinite}
.db2-auto-badge{font-family:'Orbitron',monospace;font-size:9px;font-weight:900;color:#ffd60a;background:rgba(255,214,0,.12);border:1px solid rgba(255,214,0,.4);border-radius:6px;padding:3px 8px;animation:autoPulse 1.5s infinite;letter-spacing:1px}
.db2-boss-sec{position:relative;padding:10px 14px 6px;border-bottom:1px solid rgba(255,55,95,.1);flex-shrink:0;overflow:hidden;min-height:130px}
.db2-boss-rage{background:linear-gradient(180deg,rgba(255,23,68,.12),rgba(255,55,95,.04))}
.db2-scan{position:absolute;left:0;right:0;height:35%;background:linear-gradient(transparent,rgba(255,255,255,.028),transparent);animation:scanMove 5s linear infinite;pointer-events:none}
.db2-bar-row{display:flex;align-items:center;gap:6px;margin-bottom:2px}
.db2-bar-lbl{font-size:10px;width:22px;text-align:center}
.db2-bar-wrap{flex:1;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden;position:relative}
.db2-bar-fill{border-radius:4px;transition:width .4s cubic-bezier(.25,.8,.25,1)}
.db2-bar-val{font-size:9px;color:rgba(255,255,255,.35);font-family:'Orbitron',monospace;width:64px;text-align:right}
.db2-boss-body{display:flex;flex-direction:column;align-items:center;padding:4px 0 2px;position:relative}
.db2-boss-floats{position:absolute;inset:0;pointer-events:none;overflow:visible}
.db2-boss-emoji{font-size:56px;line-height:1;margin-bottom:4px}
.db2-combo-wrap{position:absolute;top:6px;left:50%;transform:translateX(-50%);text-align:center;animation:comboIn .4s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:20;display:flex;flex-direction:column;align-items:center}
.db2-combo-num{font-family:'Orbitron',monospace;font-size:26px;font-weight:900;color:#ffd60a;animation:comboPulse .7s infinite}
.db2-party-row{display:grid;gap:5px;padding:7px 10px;background:rgba(0,0,0,.3);border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0}
.db2-char-card{position:relative;border-radius:8px;padding:6px 4px 5px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;gap:2px;overflow:hidden}
.db2-char-active{background:rgba(255,255,255,.07)}
.db2-char-ko{opacity:.35}
.db2-char-floats{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:10}
.db2-mini-bar{width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden}
.db2-active-info{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 12px;background:rgba(200,245,0,.03);border-bottom:1px solid rgba(200,245,0,.06);font-family:'Rajdhani',sans-serif;flex-shrink:0}
.db2-log{overflow-y:auto;padding:5px 10px;background:rgba(0,0,0,.35);border-bottom:1px solid rgba(255,255,255,.04);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.1) transparent;flex:1;min-height:60px;max-height:90px}
.db2-log-line{font-size:10.5px;line-height:1.45;padding:1px 0;font-family:'Rajdhani',sans-serif}
.db2-log-dmg{color:#ff8a80}.db2-log-crit{color:#ffd740;font-weight:700}.db2-log-skill{color:#c8f500}.db2-log-burst{color:#ff6b3d;font-weight:800}.db2-log-heal{color:#69f0ae}.db2-log-info{color:rgba(255,255,255,.4)}.db2-log-win{color:#c8f500;font-weight:800;font-size:12px}.db2-log-lose{color:#ff5252;font-weight:800;font-size:12px}.db2-log-boss-ulti{color:#c86eff;font-weight:800}.db2-log-boss-skill{color:#ff4081;font-weight:700}.db2-log-boss-dmg{color:#ff8a80}
.db2-status-row{display:flex;align-items:center;justify-content:center;gap:8px;padding:7px;background:rgba(0,0,0,.2);font-size:11px;color:rgba(255,255,255,.35);font-family:'Rajdhani',sans-serif;flex-shrink:0}
.db2-status-dot{width:7px;height:7px;border-radius:50%;background:#f44;animation:dotBlink .6s infinite}
.db2-result{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;animation:resultIn .5s cubic-bezier(.34,1.56,.64,1) forwards;z-index:80;padding:24px}
.db2-result-win{background:radial-gradient(ellipse at center,rgba(0,40,0,.97),rgba(7,7,15,.97))}.db2-result-lose{background:radial-gradient(ellipse at center,rgba(40,0,0,.97),rgba(7,7,15,.97))}
.db2-result-icon{font-size:52px;animation:iconPop .6s cubic-bezier(.34,1.56,.64,1) .2s both}
.db2-result-title{font-family:'Orbitron',monospace;font-size:20px;font-weight:900;letter-spacing:2px}
.db2-result-win .db2-result-title{color:#c8f500;text-shadow:0 0 20px rgba(200,245,0,.6)}.db2-result-lose .db2-result-title{color:#ff5252;text-shadow:0 0 20px rgba(255,82,82,.6)}
.db2-result-rewards{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;font-family:'Rajdhani',sans-serif;font-size:12px;color:rgba(255,255,255,.6)}
.db2-result-rewards span{background:rgba(255,255,255,.06);padding:3px 9px;border-radius:6px}
.db2-btn-back{width:100%;max-width:220px;padding:12px 0;background:linear-gradient(135deg,rgba(255,55,95,.25),rgba(255,55,95,.1));border:1px solid rgba(255,55,95,.5);border-radius:10px;color:#fff;font-size:13px;font-weight:900;cursor:pointer;font-family:'Orbitron',monospace;letter-spacing:2px;transition:all .2s}
.db2-btn-back:hover{background:linear-gradient(135deg,rgba(255,55,95,.35),rgba(255,55,95,.18));transform:translateY(-1px)}
.db2-ulti-overlay{position:absolute;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;pointer-events:none}
.db2-ulti-bg{position:absolute;inset:0;background:radial-gradient(ellipse at center,var(--uc,#c86eff) 0%,transparent 70%);opacity:0;transition:opacity .3s}
.db2-up0 .db2-ulti-bg{opacity:0}.db2-up1 .db2-ulti-bg{opacity:.16}.db2-up2 .db2-ulti-bg{opacity:.26}.db2-up3 .db2-ulti-bg{opacity:.45}
.db2-ulti-particles{position:absolute;inset:0;overflow:hidden}
.db2-up{position:absolute;top:50%;left:50%;border-radius:50%;transform-origin:0 0;opacity:0}
.db2-up1 .db2-up,.db2-up2 .db2-up,.db2-up3 .db2-up{animation:particleOut .85s var(--dl,0s) ease-out forwards}
.db2-ulti-slashes{position:absolute;inset:0;overflow:hidden;opacity:0;transition:opacity .1s}
.db2-up2 .db2-ulti-slashes,.db2-up3 .db2-ulti-slashes{opacity:1}
.db2-us{position:absolute;left:0;right:0;height:3px;top:calc(18% + calc(var(--i)*15%));background:linear-gradient(90deg,transparent,var(--uc,#c86eff),#fff,var(--uc,#c86eff),transparent);box-shadow:0 0 16px var(--uc,#c86eff);opacity:0}
.db2-up2 .db2-us,.db2-up3 .db2-us{animation:ultiSlash .55s calc(var(--i)*.065s) ease-in forwards}
.db2-ulti-text{position:relative;z-index:5;text-align:center;opacity:0;transform:scale(.7);transition:all .45s cubic-bezier(.34,1.56,.64,1)}
.db2-up2 .db2-ulti-text,.db2-up3 .db2-ulti-text{opacity:1;transform:scale(1)}
`

  return (
    <div className={`db2-root ${shakeClass==='shake-lg'?'db2-shake-lg':shakeClass==='shake-sm'?'db2-shake-sm':''}`} style={{ fontFamily:"'Rajdhani','Segoe UI',sans-serif" }}>
      <style>{DB_CSS}</style>

      {/* ── ULTI OVERLAY ── */}
      {showUlti && (
        <div className={`db2-ulti-overlay db2-up${ultiPhase}`} style={{ '--uc':showUlti.color } as any}>
          <div className="db2-ulti-bg"/>
          <div className="db2-ulti-particles">
            {[...Array(24)].map((_,i) => (
              <div key={i} className="db2-up" style={{
                '--a':`${(i/24)*360}deg`, '--d':`${50+Math.random()*100}px`,
                width:`${3+Math.random()*5}px`, height:`${3+Math.random()*5}px`,
                '--dl':`${Math.random()*.3}s`, background:showUlti.color
              } as any}/>
            ))}
          </div>
          <div className="db2-ulti-slashes">
            {[...Array(5)].map((_,i) => <div key={i} className="db2-us" style={{'--i':i} as any}/>)}
          </div>
          <div className="db2-ulti-text">
            <div style={{ fontFamily:"'Orbitron',monospace", fontSize:10, letterSpacing:4, color:'rgba(255,255,255,.5)', marginBottom:4, fontWeight:700 }}>ULTIMATE SKILL</div>
            <div style={{ fontFamily:"'Orbitron',monospace", fontSize:22, fontWeight:900, letterSpacing:2, color:showUlti.color, textShadow:`0 0 30px ${showUlti.color}` }}>{showUlti.name}</div>
            <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:13, color:'rgba(255,255,255,.5)', fontWeight:700 }}>{BOSS.name}</div>
            <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, color:'rgba(255,255,255,.35)', marginTop:3 }}>{showUlti.desc}</div>
          </div>
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div className="db2-top-bar">
        <button className="db2-btn-small" onClick={onEnd}>‹ Kembali</button>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span className="db2-mono-xs" style={{ color:'rgba(255,55,95,.7)' }}>DUNGEON</span>
          <span className="db2-badge" style={{ background:`${rc}22`, color:rc, border:`1px solid ${rc}55` }}>{BOSS.rank}</span>
          <span className="db2-mono-xs">TURN {turn}</span>
        </div>
        <span className="db2-auto-badge">⚡ AUTO</span>
      </div>

      {/* ── BOSS SECTION ── */}
      <div className={`db2-boss-sec ${bossRage?'db2-boss-rage':''} ${bossFlash?'db2-boss-hit':''}`} style={{ background: bossRage?'linear-gradient(180deg,rgba(255,23,68,.12),rgba(255,55,95,.04))':'linear-gradient(180deg,rgba(255,55,95,.06),transparent)' }}>
        <div className="db2-scan"/>

        {/* HP Bar */}
        <div className="db2-bar-row">
          <span className="db2-bar-lbl" style={{ color:'rgba(255,55,95,.7)' }}>❤️</span>
          <div className="db2-bar-wrap" style={{ height:8 }}>
            <div className="db2-bar-fill" style={{
              width:`${bossHpPct}%`, height:'100%',
              background: bossRage?'linear-gradient(90deg,#ff1744,#f44)':bossPhase===2?'linear-gradient(90deg,#f44,#ff9d00)':`linear-gradient(90deg,${bc}bb,${bc})`,
              boxShadow:`0 0 8px ${bc}88`
            }}/>
            {bossPhase===2 && <div style={{ position:'absolute', top:0, bottom:0, left:`${(BOSS.phase2Hp/BOSS.hp)*100}%`, width:2, background:'rgba(255,255,255,.4)' }}/>}
          </div>
          <span className="db2-bar-val">{bossHp}/{BOSS.hp}</span>
        </div>

        {/* Energy Bar */}
        <div className="db2-bar-row" style={{ marginTop:3 }}>
          <span className="db2-bar-lbl" style={{ color:bossEnergy>=80?'#f44':'#555' }}>⚡</span>
          <div className="db2-bar-wrap" style={{ height:4 }}>
            <div className="db2-bar-fill" style={{ width:`${bossEnergy}%`, height:'100%', background:'linear-gradient(90deg,#f44,#ff9d00)', boxShadow:'0 0 6px rgba(255,68,68,.6)', transition:'width .25s' }}/>
          </div>
          <span className="db2-bar-val" style={{ color:bossEnergy>=100?'#f44':'rgba(255,255,255,.3)', fontWeight:bossEnergy>=100?900:400 }}>
            {bossEnergy>=100?'⚠️ ULTI!':bossEnergy+'/100'}
          </span>
        </div>

        {/* Boss Body */}
        <div className="db2-boss-body">
          <div className="db2-boss-floats">
            {floats.filter((f: any) => f.side==='boss').map((f: any) => {
              const c = f.type==='crit'?'#ffd700':f.type==='burst'?'#ff6b3d':f.type==='skill'?'#c86eff':f.type==='heal'?'#30d158':'#ff8a80'
              const sz = (f.type==='crit'||f.type==='burst')?22:16
              return <div key={f.id} className="db2-float" style={{ color:c, fontSize:sz, textShadow:`0 0 12px ${c}` }}>
                {f.type==='heal'?'+':''}{f.val}{(f.type==='crit'||f.type==='burst')&&<span style={{fontSize:9,marginLeft:2}}>{f.type.toUpperCase()}!</span>}
              </div>
            })}
          </div>
          <div className={bossRage?'db2-rage-anim':'db2-idle-anim'} style={{ fontSize:56, lineHeight:1, marginBottom:4, filter:`drop-shadow(0 0 ${bossRage?'28px':'14px'} ${bc})` }}>
            {BOSS.emoji}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
            <span style={{ fontFamily:"'Orbitron',monospace", fontSize:14, fontWeight:900, color:'#fff', letterSpacing:1 }}>{BOSS.name}</span>
            {bossPhase===2 && <span className="db2-badge-p" style={{ color:'#f44', borderColor:'rgba(255,68,68,.4)' }}>PHASE 2</span>}
            {bossRage && <span className="db2-badge-p" style={{ color:'#ff1744', borderColor:'rgba(255,23,68,.5)' }}>💢 RAGE</span>}
            {bossEnergy>=80 && bossEnergy<100 && <span style={{ fontSize:9, color:'#ff9d00', fontWeight:800, animation:'blink .7s infinite' }}>⚡ Charging...</span>}
          </div>
          <div style={{ fontSize:10, color:bc, marginTop:2, fontWeight:700 }}>{BOSS.element} · {BOSS.skills[0]}</div>
        </div>

        {combo>=2 && (
          <div className="db2-combo-wrap">
            <span className="db2-combo-num">{combo}</span>
            <span style={{ fontSize:8, letterSpacing:3, color:'rgba(255,214,0,.6)', fontFamily:"'Orbitron',monospace", fontWeight:700 }}>HIT COMBO</span>
          </div>
        )}
      </div>

      {/* ── PARTY ── */}
      <div className="db2-party-row" style={{ gridTemplateColumns:`repeat(${PARTY.length},1fr)` }}>
        {PARTY.map((c: GachaChar, i: number) => {
          const alive = charHp[i] > 0
          const hpPct = Math.max(0, (charHp[i]/c.hp)*100)
          const enPct = charEnergy[i]
          const isActive = i === currentChar
          const cColor = ELEM_COLOR[c.element] || '#c8f500'
          return (
            <div key={c.id} className={`db2-char-card ${isActive?'db2-char-active':''} ${!alive?'db2-char-ko':''} ${partyFlash===i?'db2-char-hit':''}`} style={{ borderColor:isActive?cColor:'rgba(255,255,255,.07)', boxShadow:isActive?`0 0 10px ${cColor}44`:undefined }}>
              <div className="db2-char-floats">
                {floats.filter((f: any) => f.side===`party_${i}`).map((f: any) => {
                  const col = f.type==='crit'?'#ffd700':f.type==='heal'?'#30d158':'#ff8a80'
                  return <div key={f.id} className="db2-float" style={{ color:col, fontSize:14, textShadow:`0 0 10px ${col}` }}>{f.val}</div>
                })}
              </div>
              <div style={{ fontSize:18 }}>{c.emoji}</div>
              <div style={{ fontSize:9, fontWeight:700, color:isActive?cColor:'rgba(255,255,255,.65)', textAlign:'center' }}>{c.name.split(' ')[0]}</div>
              <div className="db2-mini-bar">
                <div style={{ height:'100%', borderRadius:2, width:`${hpPct}%`, background:hpPct>60?'#30d158':hpPct>30?'#ffd60a':'#f44', transition:'width .3s' }}/>
              </div>
              <div style={{ fontSize:8, color:'rgba(255,255,255,.3)', fontFamily:'monospace' }}>{alive?charHp[i]:'KO'}</div>
              <div className="db2-mini-bar" style={{ marginTop:1 }}>
                <div style={{ height:'100%', borderRadius:2, width:`${enPct}%`, background:enPct>=100?'linear-gradient(90deg,#a064ff,#ffd700)':'#a064ff88', transition:'width .3s', boxShadow:enPct>=100?'0 0 6px #a064ff':undefined }}/>
              </div>
              {enPct>=100 && <div style={{ fontSize:7, color:'#ffd700', fontWeight:900, animation:'blink .6s infinite', fontFamily:'monospace' }}>BURST!</div>}
              {charSkillCd[i]>0 && isActive && <div style={{ fontSize:7, color:'rgba(255,255,255,.3)', fontFamily:'monospace' }}>CD:{charSkillCd[i]}</div>}
            </div>
          )
        })}
      </div>

      {/* ── ACTIVE CHAR INFO ── */}
      <div className="db2-active-info">
        <span style={{ fontSize:12, fontWeight:700, color:ELEM_COLOR[PARTY[currentChar].element]||'#c8f500' }}>{(PARTY[currentChar] as GachaChar).emoji} {(PARTY[currentChar] as GachaChar).name}</span>
        <span style={{ fontSize:10, color:ELEM_COLOR[(PARTY[currentChar] as GachaChar).element]||'#fff', fontWeight:700 }}>{(PARTY[currentChar] as GachaChar).element}</span>
        <span style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginLeft:'auto' }}>Skill: {(PARTY[currentChar] as GachaChar).skill}</span>
      </div>

      {/* ── BATTLE LOG ── */}
      <div className="db2-log" ref={logRef}>
        {log.map((l: any, i: number) => (
          <div key={i} className={`db2-log-line db2-log-${l.type}`}>{l.text}</div>
        ))}
      </div>

      {/* ── STATUS ── */}
      {!done && (
        <div className="db2-status-row">
          <div className="db2-status-dot"/>
          <span>Pertarungan berlangsung otomatis...</span>
        </div>
      )}

      {/* ── RESULT ── */}
      {result && (
        <div className={`db2-result db2-result-${result}`}>
          <div className="db2-result-icon">{result==='win'?'🏆':'💀'}</div>
          <div className="db2-result-title">{result==='win'?'DUNGEON CLEAR!':'DUNGEON GAGAL!'}</div>
          {result==='win' && (
            <div className="db2-result-rewards">
              <span>+{BOSS.exp} EXP</span>
              <span>+{BOSS.gold} Gold</span>
              <span>+{BOSS.primogems} 💎</span>
              <span>🎁 {BOSS.dropItem}</span>
            </div>
          )}
          <button className="db2-btn-back" onClick={onEnd}>← Kembali</button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PARTY MANAGER COMPONENT
// ═══════════════════════════════════════════════════════════════
function PartyManager({ char, gachaData, onSave, onBack }: {
  char: RpgChar; gachaData: PlayerGacha | null
  onSave: (ids: string[]) => void; onBack: () => void
}) {
  const [selected, setSelected] = useState<string[]>(char.party || [])
  const owned = gachaData ? GACHA_CHARS.filter(c => gachaData.roster.includes(c.id)) : []
  const [filter, setFilter] = useState<GachaRarity|'Semua'|GachaSource>('Semua')
  const filtered = filter === 'Semua' ? owned
    : (['6★','5★','4★','3★'] as GachaRarity[]).includes(filter as GachaRarity)
      ? owned.filter(c => c.rarity === filter)
      : owned.filter(c => c.source === filter)

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev)
  }

  return (
    <div style={{ padding:16, overflowY:'auto', height:'100%' }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#00e5ff', fontWeight:800, fontSize:15 }}>👥 Atur Party</span>
      </div>

      <div style={{ background:'rgba(0,229,255,0.06)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:10, padding:'8px 12px', marginBottom:12, fontSize:12 }}>
        <div style={{ color:'#00e5ff', fontWeight:700, marginBottom:4 }}>Party ({selected.length}/4) — tap untuk pilih/hapus</div>
        {selected.length === 0 ? (
          <div style={{ color:'rgba(255,255,255,0.3)' }}>Belum ada karakter dipilih</div>
        ) : (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {selected.map(id => {
              const c = GACHA_CHARS.find(x => x.id === id)!
              return <span key={id} style={{ background:'rgba(0,229,255,0.1)', border:'1px solid rgba(0,229,255,0.25)', borderRadius:8, padding:'3px 8px', fontSize:11, color:'#00e5ff' }}>
                {c.emoji} {c.name}
              </span>
            })}
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:4, marginBottom:10, flexWrap:'wrap' }}>
        {(['Semua','6★','5★','4★','3★','genshin','wuwa','hsr'] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)} style={{
            background: filter===r ? (r==='6★'?'#ff3cff':r==='5★'?'#ffd700':r==='4★'?'#c878ff':r==='genshin'?'#5ab4ff':r==='wuwa'?'#7fffd4':r==='hsr'?'#ff9ebc':'#c8f500'):'rgba(255,255,255,0.06)', border:'none',
            color: filter===r ? '#000' : 'rgba(255,255,255,0.6)', borderRadius:6,
            padding:'3px 8px', fontSize:10, fontWeight:700, cursor:'pointer'
          }}>
            {r === 'genshin' ? '⚙️GI' : r === 'wuwa' ? '🌊WW' : r === 'hsr' ? '🚂HSR' : r}
          </button>
        ))}
      </div>

      {owned.length === 0 && (
        <div style={{ textAlign:'center', color:'rgba(255,255,255,0.3)', fontSize:13, padding:24 }}>
          Belum ada karakter gacha! Pull dulu di tab Gacha ✨
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
        {filtered.map(c => {
          const isSel = selected.includes(c.id)
          const rarityColor = RARITY_COLOR[c.rarity] ?? '#aaa'
          const lv = (gachaData?.charLevels??{})[c.id] ?? 1
          const conste = (gachaData?.constellations??{})[c.id] ?? 0
          const statMult = getCharStatMult(lv, c.rarity)
          return (
            <button key={c.id} onClick={() => toggle(c.id)} style={{
              background: isSel ? 'rgba(200,245,0,0.1)' : 'rgba(255,255,255,0.04)',
              border:`1.5px solid ${isSel ? '#c8f500' : rarityColor+'30'}`,
              borderRadius:12, padding:'10px 10px', cursor:'pointer', textAlign:'left', transition:'all .2s',
              boxShadow: c.rarity==='6★' ? `0 0 10px ${rarityColor}30` : 'none'
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                <span style={{ fontSize:22 }}>{c.emoji}</span>
                <div style={{ textAlign:'right' }}>
                  <span style={{ fontSize:9, fontWeight:800, color:rarityColor, display:'block' }}>{c.rarity}</span>
                  <span style={{ fontSize:8, color: GACHA_SOURCE_COLOR[c.source] }}>{c.source==='hsr'?'HSR':c.source==='wuwa'?'WW':'GI'}</span>
                </div>
              </div>
              <div style={{ fontSize:12, fontWeight:800, color: isSel ? '#c8f500' : '#fff', marginBottom:2 }}>{c.name}</div>
              <div style={{ fontSize:10, color: GACHA_ELEM_COLOR[c.element] }}>{c.element} · {c.weapon}</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', marginTop:2 }}>Lv{lv} · C{conste}</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginTop:2 }}>⚔️{Math.floor(c.atk*statMult)} 🛡️{Math.floor(c.def*statMult)} ❤️{Math.floor(c.hp*statMult)}</div>
              {isSel && <div style={{ marginTop:4, fontSize:9, color:'#c8f500', fontWeight:700 }}>✅ DALAM PARTY</div>}
            </button>
          )
        })}
      </div>

      <button className="gc2-rpg-btn primary" style={{ width:'100%' }} onClick={() => { onSave(selected); onBack() }}>
        💾 Simpan Party ({selected.length}/4)
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DAILY MISSIONS COMPONENT
// ═══════════════════════════════════════════════════════════════
function DailyMissions({ char, gachaData, onClaim, onBack }: {
  char: RpgChar; gachaData: PlayerGacha | null
  onClaim: (id: string) => void; onBack: () => void
}) {
  const todayStr = new Date().toDateString()
  const dailyData = char.dailyMissions?.date === todayStr
    ? char.dailyMissions
    : { date: todayStr, completed: [], claimed: [] }

  const totalRewards = DAILY_MISSIONS.reduce((acc, m) => ({
    primogems: acc.primogems + m.reward.primogems,
    tickets: acc.tickets + m.reward.tickets,
    gold: acc.gold + m.reward.gold
  }), { primogems: 0, tickets: 0, gold: 0 })

  return (
    <div style={{ padding:16, overflowY:'auto', height:'100%' }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#c8f500', fontWeight:800, fontSize:15 }}>📋 Daily Missions</span>
      </div>

      <div style={{ background:'rgba(200,245,0,0.06)', border:'1px solid rgba(200,245,0,0.15)', borderRadius:12, padding:'10px 14px', marginBottom:14 }}>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:6 }}>
          📅 {new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long' })} — Reset tiap hari
        </div>
        <div style={{ display:'flex', gap:12, fontSize:12 }}>
          <span style={{ color:'#00e5ff' }}>💎 {totalRewards.primogems} Primogems</span>
          <span style={{ color:'#ffd700' }}>🎫 {totalRewards.tickets} Tiket</span>
          <span style={{ color:'#c8f500' }}>💰 {totalRewards.gold} Gold</span>
        </div>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:4 }}>Total reward jika semua selesai</div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {DAILY_MISSIONS.map(m => {
          const done = dailyData.completed.includes(m.id)
          const claimed = dailyData.claimed.includes(m.id)
          return (
            <div key={m.id} style={{
              background: claimed ? 'rgba(255,255,255,0.03)' : done ? 'rgba(200,245,0,0.07)' : 'rgba(255,255,255,0.04)',
              border:`1px solid ${claimed ? 'rgba(255,255,255,0.06)' : done ? 'rgba(200,245,0,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius:12, padding:'10px 12px', opacity: claimed ? 0.55 : 1
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                    <span style={{ fontSize:16 }}>{m.icon}</span>
                    <span style={{ fontSize:13, fontWeight:700, color: done ? '#c8f500' : '#fff' }}>{m.name}</span>
                    {done && !claimed && <span style={{ fontSize:9, background:'rgba(200,245,0,0.15)', color:'#c8f500', borderRadius:4, padding:'1px 5px', fontWeight:800 }}>SELESAI!</span>}
                    {claimed && <span style={{ fontSize:9, color:'rgba(255,255,255,0.3)' }}>✅ Sudah diklaim</span>}
                  </div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:6 }}>{m.desc}</div>
                  <div style={{ display:'flex', gap:8, fontSize:11 }}>
                    {m.reward.primogems > 0 && <span style={{ color:'#00e5ff' }}>💎 +{m.reward.primogems}</span>}
                    {m.reward.tickets > 0 && <span style={{ color:'#ffd700' }}>🎫 +{m.reward.tickets}</span>}
                    {m.reward.gold > 0 && <span style={{ color:'#c8f500' }}>💰 +{m.reward.gold}</span>}
                  </div>
                </div>
                <button
                  className="gc2-rpg-btn primary"
                  onClick={() => onClaim(m.id)}
                  disabled={!done || claimed}
                  style={{
                    fontSize:11, padding:'6px 12px', flexShrink:0, marginLeft:10,
                    opacity: !done || claimed ? 0.4 : 1,
                    animation: done && !claimed ? 'btnPulse 1.5s infinite' : 'none'
                  }}>
                  {claimed ? '✅' : done ? '🎁 Klaim' : '🔒'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop:14, background:'rgba(255,215,0,0.06)', border:'1px solid rgba(255,215,0,0.15)', borderRadius:12, padding:'10px 14px' }}>
        <div style={{ fontSize:12, color:'#ffd700', fontWeight:700, marginBottom:6 }}>💡 Cara dapat Primogems & Tiket</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.6 }}>
          🏰 Kalahkan boss dungeon → +💎 Primogems langsung<br/>
          📋 Daily missions → +💎 Primogems + 🎫 Tiket<br/>
          📜 Klaim quest → +💰 Gold + items<br/>
          🎫 Tiket bisa dipakai untuk pull gacha (1 Tiket = 1 Pull)
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// GACHA COMPONENTS
// ═══════════════════════════════════════════════════════════════

const ELEMENT_COLOR: Record<GachaElement, string> = {
  Pyro:'#ff6b3d', Hydro:'#00bfff', Anemo:'#74c2a0', Geo:'#daa520',
  Electro:'#c86eff', Dendro:'#7cbb4a', Cryo:'#98d8ea', Spectro:'#ffd700', Havoc:'#9b59b6',
  Quantum:'#7b5cff', Imaginary:'#f5c842', Physical:'#aaaaaa',
  Ice:'#a8d8f0', Wind:'#80d9b0', Fire:'#ff7755', Lightning:'#bb88ff'
}

function GachaHome({ data, onBanner, onRoster, onEvents, onPass }: {
  data: PlayerGacha; onBanner:()=>void; onRoster:()=>void; onEvents:()=>void; onPass:()=>void
}) {
  const mats = data.charMats ?? { fish:0, ore:0, herb:0 }
  const pity6 = data.pity6 ?? 0
  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      {/* Header */}
      <div style={{ textAlign:'center', marginBottom:16 }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', letterSpacing:2, textTransform:'uppercase', marginBottom:4 }}>Genshin × WuWa × HSR</div>
        <div style={{ fontSize:22, fontWeight:900, background:'linear-gradient(90deg,#ffd700,#ff3cff,#00e5ff)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', letterSpacing:1 }}>✨ WISH WORLD</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:4 }}>Crossover gacha — karakter dari 3 universe!</div>
      </div>

      {/* Currency bar */}
      <div style={{ background:'rgba(255,215,0,0.06)', border:'1px solid rgba(255,215,0,0.15)', borderRadius:12, padding:'10px 14px', marginBottom:12, display:'flex', justifyContent:'space-around' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>💎 Primo</div>
          <div style={{ fontSize:15, fontWeight:800, color:'#00e5ff' }}>{data.primogems.toLocaleString()}</div>
        </div>
        <div style={{ width:1, background:'rgba(255,255,255,0.08)' }}/>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>🎫 Tiket</div>
          <div style={{ fontSize:15, fontWeight:800, color:'#ffd700' }}>{data.tickets}</div>
        </div>
        <div style={{ width:1, background:'rgba(255,255,255,0.08)' }}/>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>🎰 Pulls</div>
          <div style={{ fontSize:15, fontWeight:800, color:'#c8f500' }}>{data.pulls}</div>
        </div>
      </div>

      {/* Pity trackers */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <div style={{ flex:1, background:'rgba(160,100,255,0.07)', border:'1px solid rgba(160,100,255,0.2)', borderRadius:10, padding:'8px 10px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:3 }}>
            <span style={{ color:'#a064ff' }}>Pity 5★</span>
            <span style={{ color:'#ffd700', fontWeight:700 }}>{data.pity}/{PITY_HARD}</span>
          </div>
          <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:3, overflow:'hidden', height:5 }}>
            <div style={{ height:'100%', borderRadius:3, background:'linear-gradient(90deg,#a064ff,#ffd700)', width:`${(data.pity/PITY_HARD)*100}%` }}/>
          </div>
          {data.pity >= PITY_SOFT && <div style={{ fontSize:9, color:'#ffd700', marginTop:3 }}>⚡ Soft pity aktif!</div>}
          {data.guaranteed && <div style={{ fontSize:9, color:'#c8f500', marginTop:2 }}>🔒 Guaranteed!</div>}
        </div>
        <div style={{ flex:1, background:'rgba(255,60,255,0.07)', border:'1px solid rgba(255,60,255,0.2)', borderRadius:10, padding:'8px 10px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:3 }}>
            <span style={{ color:'#ff3cff' }}>Pity 6★ 💫</span>
            <span style={{ color:'#ff3cff', fontWeight:700 }}>{pity6}/{PITY_6STAR}</span>
          </div>
          <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:3, overflow:'hidden', height:5 }}>
            <div style={{ height:'100%', borderRadius:3, background:'linear-gradient(90deg,#ff3cff,#7700ff)', width:`${(pity6/PITY_6STAR)*100}%` }}/>
          </div>
          <div style={{ fontSize:9, color:'rgba(255,60,255,0.6)', marginTop:3 }}>0.1% chance · max lv 100</div>
        </div>
      </div>

      {/* Char materials */}
      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'8px 12px', marginBottom:12, display:'flex', gap:12, alignItems:'center' }}>
        <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)', fontWeight:700 }}>🧪 Materials:</span>
        <span style={{ fontSize:11, color:'#4fc3f7' }}>🐟 {mats.fish}</span>
        <span style={{ fontSize:11, color:'#aaa' }}>⛏️ {mats.ore}</span>
        <span style={{ fontSize:11, color:'#7cbb4a' }}>🌿 {mats.herb}</span>
        <span style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginLeft:'auto' }}>Dari mancing/battle/dungeon</span>
      </div>

      {/* Menu grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {[
          { label:'🌟 Gacha Banner', sub:'Pull dari 3 universe!', color:'#ffd700', bg:'rgba(255,215,0,0.08)', onClick: onBanner },
          { label:'👥 Koleksi', sub:`${data.roster.length} char dimiliki`, color:'#00e5ff', bg:'rgba(0,229,255,0.07)', onClick: onRoster },
          { label:'📅 Event', sub:'Reward spesial aktif', color:'#c8f500', bg:'rgba(200,245,0,0.07)', onClick: onEvents },
          { label:'🎖️ Battle Pass', sub:'Hadiah harian & mingguan', color:'#ff9d00', bg:'rgba(255,157,0,0.07)', onClick: onPass },
        ].map(m => (
          <button key={m.label} onClick={m.onClick} style={{
            background: m.bg, border:`1px solid ${m.color}25`,
            borderRadius:14, padding:'14px 12px', cursor:'pointer', textAlign:'left', transition:'all .2s'
          }}>
            <div style={{ fontSize:14, fontWeight:800, color:m.color, marginBottom:4 }}>{m.label}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{m.sub}</div>
          </button>
        ))}
      </div>

      {/* Roster preview */}
      {data.roster.length > 0 && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:8, fontWeight:700 }}>👥 KARAKTER TERBARU</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {data.roster.slice(-8).map(id => {
              const c = GACHA_CHARS.find(g => g.id === id)
              if (!c) return null
              const col = GACHA_ELEM_COLOR[c.element] ?? '#c8f500'
              const lv = (data.charLevels??{})[c.id] ?? 1
              return (
                <div key={id} style={{ background:`${col}15`, border:`1px solid ${RARITY_COLOR[c.rarity]}40`, borderRadius:8, padding:'4px 8px', fontSize:11 }}>
                  <span style={{ color: RARITY_COLOR[c.rarity] }}>{c.emoji} {c.name}</span>
                  <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)', marginLeft:4 }}>Lv{lv}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function GachaBanner({ data, onPull, onBack }: { data: PlayerGacha; onPull:(n:1|10)=>void; onBack:()=>void }) {
  const featured = GACHA_CHARS.filter(c => GACHA_BANNER.featured.includes(c.id))
  const cost1 = 160, cost10 = 1600
  const hasTicket = data.tickets >= 1
  const canPull1 = hasTicket || data.primogems >= cost1
  const canPull10 = data.tickets >= 10 || data.primogems >= cost10
  const pity6 = data.pity6 ?? 0

  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#ffd700', fontWeight:800, fontSize:15 }}>✨ {GACHA_BANNER.name}</span>
      </div>

      {/* Banner card */}
      <div style={{ background:'linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,100,0,0.08))', border:'1px solid rgba(255,215,0,0.25)', borderRadius:16, padding:16, marginBottom:12 }}>
        <div style={{ fontSize:11, color:'rgba(255,215,0,0.7)', fontWeight:700, letterSpacing:1, textTransform:'uppercase', marginBottom:8 }}>⬆️ Rate Up Characters</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {featured.map(c => {
            const col = GACHA_ELEM_COLOR[c.element] ?? '#c8f500'
            const rarityCol = RARITY_COLOR[c.rarity]
            return (
              <div key={c.id} style={{ background:`${col}15`, border:`1px solid ${rarityCol}50`, borderRadius:10, padding:'8px 10px', flex:1, minWidth:80 }}>
                <div style={{ fontSize:20 }}>{c.emoji}</div>
                <div style={{ fontSize:12, fontWeight:700, color:'#fff', marginTop:2 }}>{c.name}</div>
                <div style={{ fontSize:10, color: rarityCol, fontWeight:700 }}>{c.rarity}</div>
                <div style={{ fontSize:9, color: GACHA_SOURCE_COLOR[c.source] }}>{GACHA_SOURCE_LABEL[c.source]}</div>
                <div style={{ fontSize:10, color:`${col}cc` }}>{c.element}</div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop:10, fontSize:11, color:'rgba(255,255,255,0.4)', lineHeight:1.7 }}>
          🎯 Rate 5★: 0.6% (Soft pity: pull ke-{PITY_SOFT})<br/>
          🔒 Hard pity: pull ke-{PITY_HARD} pasti 5★<br/>
          💫 Rate 6★: 0.1% — Hard pity ke-{PITY_6STAR}<br/>
          🌟 Karakter dari Genshin · WuWa · HSR dalam 1 banner!<br/>
          💡 50/50: Rate-up vs standard{data.guaranteed && ' · 🔒 Guaranteed aktif!'}
        </div>
      </div>

      {/* Pull buttons */}
      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        <button className="gc2-rpg-btn primary" onClick={() => onPull(1)} disabled={!canPull1} style={{ flex:1, flexDirection:'column', gap:2, padding:'10px 8px', animation: canPull1 ? 'btnPulse 2s infinite' : 'none' }}>
          <div>🎫 × 1 Pull</div>
          <div style={{ fontSize:10, opacity:0.7 }}>{hasTicket ? '1 Tiket' : `${cost1} 💎`}</div>
        </button>
        <button className="gc2-rpg-btn primary" onClick={() => onPull(10)} disabled={!canPull10} style={{ flex:1, flexDirection:'column', gap:2, padding:'10px 8px', background:'linear-gradient(135deg,#c8f500,#00e5ff)', color:'#000' }}>
          <div>🎫 × 10 Pull</div>
          <div style={{ fontSize:10, opacity:0.7 }}>{data.tickets>=10 ? '10 Tiket' : `${cost10} 💎`}</div>
        </button>
      </div>

      {/* Currency + pity */}
      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'8px 12px', display:'flex', gap:10, fontSize:11, flexWrap:'wrap' }}>
        <span>💎 {data.primogems.toLocaleString()}</span>
        <span>🎫 {data.tickets} Tiket</span>
        <span style={{ color:'#a064ff' }}>Pity 5★: {data.pity}/{PITY_HARD}</span>
        <span style={{ color:'#ff3cff' }}>Pity 6★: {pity6}/{PITY_6STAR}</span>
      </div>

      {/* All chars preview by source */}
      <div style={{ marginTop:12 }}>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', fontWeight:700, marginBottom:8 }}>📋 Pool Karakter (Genshin · WuWa · HSR)</div>
        {(['6★','5★','4★','3★'] as GachaRarity[]).map(r => {
          const pool = GACHA_CHARS.filter(c => c.rarity === r)
          if (!pool.length) return null
          return (
            <div key={r} style={{ marginBottom:6 }}>
              <span style={{ fontSize:10, fontWeight:800, color: RARITY_COLOR[r] }}>{r} ({pool.length})</span>
              <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:3 }}>
                {pool.map(c => {
                  const col = GACHA_ELEM_COLOR[c.element] ?? '#aaa'
                  const owned = data.roster.includes(c.id)
                  return (
                    <span key={c.id} style={{
                      fontSize:9, borderRadius:4, padding:'2px 5px',
                      background: owned ? `${col}25` : 'rgba(255,255,255,0.04)',
                      border: owned ? `1px solid ${col}50` : '1px solid rgba(255,255,255,0.08)',
                      color: owned ? col : 'rgba(255,255,255,0.4)'
                    }}>
                      {c.emoji}{c.name}
                      <span style={{ color: GACHA_SOURCE_COLOR[c.source], marginLeft:2, fontSize:8 }}>
                        {c.source==='hsr'?'HSR':c.source==='wuwa'?'WW':'GI'}
                      </span>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GachaResultScreen({ results, onClose, roster, constellations }: { results: GachaChar[]; onClose:()=>void; roster:string[]; constellations: Record<string,number> }) {
  const [revealed, setRevealed] = useState(0)
  const hasSixStar = results.some(c => c.rarity === '6★')
  const hasFiveStar = results.some(c => c.rarity === '5★' || c.rarity === '6★')

  useEffect(() => {
    if (results.length === 1) { setRevealed(1); return }
    const timer = setInterval(() => {
      setRevealed(prev => { if (prev >= results.length) { clearInterval(timer); return prev } return prev + 1 })
    }, 180)
    return () => clearInterval(timer)
  }, [results])

  return (
    <div style={{ position:'absolute', inset:0, background: hasSixStar ? 'linear-gradient(180deg,#1a0020,#000010)' : hasFiveStar ? 'linear-gradient(180deg,#1a0a00,#0a0015)' : '#0a0a0a', zIndex:30, display:'flex', flexDirection:'column', padding:16 }} className="gc2-fadein">
      {hasSixStar && (
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center, rgba(255,60,255,0.18) 0%, transparent 70%)', pointerEvents:'none' }}/>
      )}
      {hasFiveStar && !hasSixStar && (
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center, rgba(255,215,0,0.12) 0%, transparent 70%)', pointerEvents:'none' }}/>
      )}
      <div style={{ textAlign:'center', marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:900, color: hasSixStar?'#ff3cff':hasFiveStar?'#ffd700':'#fff' }}>
          {hasSixStar ? '💫 LUAR BIASA!! 6★!!!' : hasFiveStar ? '🌟 LUAR BIASA!' : results.some(c=>c.rarity==='4★') ? '✨ Bagus!' : '🎫 Hasil Gacha'}
        </div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{results.length}x Pull</div>
      </div>

      <div style={{ flex:1, display:'grid', gridTemplateColumns: results.length === 1 ? '1fr' : 'repeat(2,1fr)', gap:8, overflowY:'auto' }}>
        {results.map((c, i) => {
          const prevConste = constellations[c.id] ?? -1
          const isNew = prevConste < 0
          const isDupe = !isNew
          const newConste = isDupe ? Math.min(prevConste + 1, 6) : 0
          const col = GACHA_ELEM_COLOR[c.element] ?? '#c8f500'
          const rarityCol = RARITY_COLOR[c.rarity]
          const starClass = c.rarity === '6★' ? 'gacha-6star' : c.rarity === '5★' ? 'gacha-5star' : c.rarity === '4★' ? 'gacha-4star' : 'gacha-3star'
          return (
            <div key={i} className={starClass} style={{
              animationDelay: `${i * 0.1}s`,
              background: `linear-gradient(135deg,${col}20,${col}08)`,
              border: `1.5px solid ${rarityCol}60`,
              borderRadius:14, padding: results.length===1 ? '24px 16px' : '10px 10px',
              textAlign:'center', position:'relative', overflow:'hidden',
              opacity: i < revealed ? 1 : 0, transition:'opacity .2s',
              boxShadow: c.rarity==='6★' ? `0 0 20px ${rarityCol}50` : 'none'
            }}>
              {isNew && (
                <div style={{ position:'absolute', top:6, right:6, background:'#c8f500', color:'#000', fontSize:8, fontWeight:800, borderRadius:4, padding:'1px 4px' }}>NEW!</div>
              )}
              {isDupe && prevConste < 6 && (
                <div style={{ position:'absolute', top:6, right:6, background: rarityCol, color:'#000', fontSize:8, fontWeight:800, borderRadius:4, padding:'1px 4px' }}>C{newConste}!</div>
              )}
              {isDupe && prevConste >= 6 && (
                <div style={{ position:'absolute', top:6, right:6, background:'#ffd700', color:'#000', fontSize:8, fontWeight:800, borderRadius:4, padding:'1px 4px' }}>+💎</div>
              )}
              <div style={{ fontSize: results.length===1 ? 48 : 28 }}>{c.emoji}</div>
              <div style={{ fontSize: results.length===1 ? 16:12, fontWeight:800, color:'#fff', margin:'4px 0 2px' }}>{c.name}</div>
              <div style={{ fontSize:10, color: rarityCol, fontWeight:700 }}>{c.rarity}</div>
              <div style={{ fontSize:9, color: GACHA_SOURCE_COLOR[c.source], marginTop:1 }}>{GACHA_SOURCE_LABEL[c.source]}</div>
              <div style={{ fontSize:10, color: col, marginTop:2 }}>{c.element} · {c.weapon}</div>
              {results.length === 1 && (
                <div style={{ marginTop:10, fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.5 }}>
                  {c.desc}<br/>
                  <span style={{color:col}}>Skill: {c.skill}</span><br/>
                  <span style={{color:'#ffd700'}}>Burst: {c.burst}</span>
                </div>
              )}
              {isDupe && prevConste < 6 && <div style={{ fontSize:9, color: rarityCol, marginTop:2, fontWeight:700 }}>✨ Constellation C{newConste}!</div>}
              {isDupe && prevConste >= 6 && <div style={{ fontSize:9, color:'#ffd700', marginTop:2, fontWeight:700 }}>💎 Dikonversi ke Primogems!</div>}
            </div>
          )
        })}
      </div>

      <button className="gc2-rpg-btn primary" onClick={onClose} style={{ marginTop:12, width:'100%' }}>✅ Selesai</button>
    </div>
  )
}

function GachaRoster({ data, onBack, onLevelUp }: { data: PlayerGacha; onBack:()=>void; onLevelUp:(id:string)=>void }) {
  const [filter, setFilter] = useState<GachaRarity|'Semua'|GachaSource>('Semua')
  const owned = GACHA_CHARS.filter(c => data.roster.includes(c.id))
  const filtered = filter === 'Semua' ? owned
    : (['6★','5★','4★','3★'] as GachaRarity[]).includes(filter as GachaRarity)
      ? owned.filter(c => c.rarity === filter)
      : owned.filter(c => c.source === filter)
  const mats = data.charMats ?? { fish:0, ore:0, herb:0 }

  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#fff', fontWeight:800, fontSize:15 }}>👥 Koleksi ({owned.length}/{GACHA_CHARS.length})</span>
      </div>
      {/* Material display */}
      <div style={{ display:'flex', gap:8, marginBottom:10, background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'8px 12px' }}>
        <span style={{ fontSize:11, color:'#4fc3f7' }}>🐟 Ikan: {mats.fish}</span>
        <span style={{ fontSize:11, color:'#aaa' }}>⛏️ Ore: {mats.ore}</span>
        <span style={{ fontSize:11, color:'#7cbb4a' }}>🌿 Herb: {mats.herb}</span>
        <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginLeft:'auto', alignSelf:'center' }}>Dari mancing/battle/dungeon</span>
      </div>
      {/* Filter row */}
      <div style={{ display:'flex', gap:5, marginBottom:12, flexWrap:'wrap' }}>
        {(['Semua','6★','5★','4★','3★','genshin','wuwa','hsr'] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)} style={{
            background: filter===r ? (r==='6★'?'#ff3cff':r==='5★'?'#ffd700':r==='4★'?'#c878ff':r==='genshin'?'#5ab4ff':r==='wuwa'?'#7fffd4':r==='hsr'?'#ff9ebc':'#c8f500'):'rgba(255,255,255,0.06)',
            border:'none', color: filter===r ? '#000':'rgba(255,255,255,0.6)',
            borderRadius:6, padding:'3px 8px', fontSize:10, fontWeight:700, cursor:'pointer'
          }}>
            {r === 'genshin' ? '⚙️ Genshin' : r === 'wuwa' ? '🌊 WuWa' : r === 'hsr' ? '🚂 HSR' : r}
          </button>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {filtered.map(c => {
          const col = GACHA_ELEM_COLOR[c.element] ?? '#c8f500'
          const charLv = (data.charLevels ?? {})[c.id] ?? 1
          const maxLv = CHAR_MAX_LEVEL[c.rarity]
          const conste = (data.constellations ?? {})[c.id] ?? 0
          const statMult = getCharStatMult(charLv, c.rarity)
          const rarityCol = RARITY_COLOR[c.rarity]
          const cost = getCharLevelCost(charLv)
          const canLvUp = charLv < maxLv && mats.fish >= cost.fish && mats.ore >= cost.ore && mats.herb >= cost.herb
          const charExpCur = (data.charExp ?? {})[c.id] ?? 0
          const charExpNeed = charLv < maxLv ? getCharExpNeeded(charLv) : 1
          const charExpPct = charLv < maxLv ? Math.min(100, Math.round(charExpCur / charExpNeed * 100)) : 100
          return (
            <div key={c.id} style={{
              background:`${col}10`, border:`1.5px solid ${rarityCol}50`,
              borderRadius:12, padding:'10px 12px',
              boxShadow: c.rarity==='6★' ? `0 0 12px ${rarityCol}40` : 'none'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <div style={{ fontSize:26 }}>{c.emoji}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#fff', lineHeight:1.2 }}>{c.name}</div>
                  <div style={{ display:'flex', gap:4, alignItems:'center', marginTop:2 }}>
                    <span style={{ fontSize:10, color:rarityCol, fontWeight:800 }}>{c.rarity}</span>
                    <span style={{ fontSize:9, color: GACHA_SOURCE_COLOR[c.source], background:`${GACHA_SOURCE_COLOR[c.source]}18`, borderRadius:4, padding:'1px 5px' }}>{GACHA_SOURCE_LABEL[c.source]}</span>
                  </div>
                </div>
              </div>
              {/* Level bar */}
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                <span style={{ fontSize:10, color:'#ffd700', fontWeight:700 }}>Lv.{charLv}</span>
                <div style={{ flex:1, height:4, background:'rgba(255,255,255,0.1)', borderRadius:2 }}>
                  <div style={{ width:`${(charLv/maxLv)*100}%`, height:'100%', background: rarityCol, borderRadius:2 }} />
                </div>
                <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)' }}>{maxLv}</span>
              </div>
              {/* Dungeon EXP progress bar */}
              {charLv < maxLv && (
                <div style={{ marginBottom:5 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'rgba(255,255,255,0.35)', marginBottom:2 }}>
                    <span>⚔️ EXP Battle</span>
                    <span style={{ color: charExpPct >= 100 ? '#30d158' : 'rgba(255,255,255,0.35)' }}>
                      {charExpCur}/{charExpNeed} ({charExpPct}%)
                    </span>
                  </div>
                  <div style={{ height:3, background:'rgba(255,255,255,0.07)', borderRadius:2, overflow:'hidden' }}>
                    <div style={{
                      width:`${charExpPct}%`, height:'100%', borderRadius:2,
                      background: charExpPct >= 80
                        ? 'linear-gradient(90deg,#30d158,#00e676)'
                        : 'linear-gradient(90deg,rgba(100,200,255,0.6),rgba(150,240,200,0.8))',
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                </div>
              )}
              {/* Constellation */}
              <div style={{ display:'flex', gap:3, marginBottom:5 }}>
                {[0,1,2,3,4,5,6].map(i => (
                  <div key={i} style={{
                    width:8, height:8, borderRadius:'50%',
                    background: i <= conste ? rarityCol : 'rgba(255,255,255,0.1)',
                    boxShadow: i <= conste ? `0 0 4px ${rarityCol}` : 'none'
                  }} />
                ))}
                <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)', marginLeft:2 }}>C{conste}</span>
              </div>
              {/* Stats (scaled by level) */}
              <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:6 }}>
                {[['⚔️',Math.floor(c.atk*statMult)],['🛡️',Math.floor(c.def*statMult)],['❤️',Math.floor(c.hp*statMult)],['💨',c.spd]].map(([e,v]) => (
                  <span key={String(e)} style={{fontSize:9, color:'rgba(255,255,255,0.6)'}}>{e}{v}</span>
                ))}
              </div>
              {/* Level up button */}
              {charLv < maxLv && (
                <button onClick={() => onLevelUp(c.id)} style={{
                  width:'100%', padding:'5px 0', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontWeight:700,
                  background: canLvUp ? `linear-gradient(90deg,${rarityCol},${col})` : 'rgba(255,255,255,0.07)',
                  color: canLvUp ? '#000' : 'rgba(255,255,255,0.3)'
                }}>
                  {canLvUp ? `⬆️ Level Up → ${charLv+1}` : `🐟${cost.fish} ⛏️${cost.ore} 🌿${cost.herb} 💰${cost.gold}G`}
                </button>
              )}
              {charLv >= maxLv && (
                <div style={{ textAlign:'center', fontSize:10, color: rarityCol, fontWeight:800 }}>✅ MAX LEVEL</div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn:'span 2', textAlign:'center', color:'rgba(255,255,255,0.3)', fontSize:13, padding:24 }}>
            Belum ada karakter ini — yuk gacha!
          </div>
        )}
      </div>
    </div>
  )
}

function GachaEvents({ onBack }: { onBack:()=>void }) {
  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#c8f500', fontWeight:800, fontSize:15 }}>📅 Event Aktif</span>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {GACHA_EVENTS.map((ev, i) => (
          <div key={ev.id} className="slide-in-left" style={{
            animationDelay:`${i*0.1}s`,
            background:'rgba(200,245,0,0.05)', border:'1px solid rgba(200,245,0,0.15)',
            borderRadius:14, padding:'12px 14px'
          }}>
            <div style={{ fontSize:15, fontWeight:800, color:'#fff', marginBottom:4 }}>{ev.name}</div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginBottom:8, lineHeight:1.5 }}>{ev.desc}</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:10, background:'rgba(200,245,0,0.1)', color:'#c8f500', borderRadius:4, padding:'2px 8px', fontWeight:700, border:'1px solid rgba(200,245,0,0.2)' }}>
                🟢 Aktif
              </span>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)' }}>Berakhir dalam: 2 hari</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:16, background:'rgba(0,229,255,0.05)', border:'1px solid rgba(0,229,255,0.15)', borderRadius:12, padding:'12px 14px' }}>
        <div style={{ fontSize:13, fontWeight:800, color:'#00e5ff', marginBottom:6 }}>💡 Tips Event</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.7 }}>
          • Login setiap hari untuk bonus Primogems<br/>
          • Selesaikan quest event untuk Tiket eksklusif<br/>
          • Event baru hadir setiap minggu — pantau terus!
        </div>
      </div>
    </div>
  )
}

function GachaPass({ data, rpgChar, onBack, onBuyRequest, onClaimTier, bpClaimMsg }: {
  data: PlayerGacha; rpgChar: RpgChar | null; onBack:()=>void
  onBuyRequest: () => void
  onClaimTier: (tier: typeof BATTLE_PASS_TIERS[0], isPremium: boolean) => void
  bpClaimMsg: string
}) {
  const passLevel = Math.min(Math.floor(data.pulls / 5), 50)
  const hasPremium = !!(data as any).hasPremiumPass
  const claimed: string[] = (data as any).claimedBPTiers || []

  return (
    <div style={{ padding:16, overflowY:'auto', height:'100%' }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#ff9d00', fontWeight:800, fontSize:15 }}>🎖️ Battle Pass</span>
      </div>

      {/* Pass level */}
      <div style={{ background:'linear-gradient(135deg,rgba(255,157,0,0.12),rgba(255,80,0,0.06))', border:'1px solid rgba(255,157,0,0.25)', borderRadius:14, padding:'14px 16px', marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'#ff9d00' }}>Level {passLevel} / 50</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{data.pulls % 5}/5 pulls ke level berikutnya</div>
        </div>
        <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:4, overflow:'hidden', height:8 }}>
          <div style={{ height:'100%', borderRadius:4, background:'linear-gradient(90deg,#ff9d00,#ffd700)', width:`${((data.pulls % 5)/5)*100}%`, transition:'width .4s', boxShadow:'0 0 8px rgba(255,157,0,0.5)' }}/>
        </div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:6 }}>
          Total pull: {data.pulls} · Setiap 5 pull = +1 Pass Level
        </div>
      </div>

      {/* Premium status / buy button */}
      {hasPremium ? (
        <div style={{ background:'rgba(255,215,0,0.1)', border:'1px solid rgba(255,215,0,0.35)', borderRadius:12, padding:'10px 14px', marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:22 }}>👑</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#ffd700' }}>Premium Pass AKTIF</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>Semua reward premium tersedia</div>
          </div>
        </div>
      ) : (
        <button onClick={onBuyRequest} style={{ width:'100%', background:'linear-gradient(135deg,rgba(255,157,0,0.2),rgba(255,80,0,0.1))', border:'1px dashed rgba(255,157,0,0.5)', borderRadius:12, padding:'12px 14px', marginBottom:14, cursor:'pointer', display:'flex', alignItems:'center', gap:10, color:'#fff', transition:'all .2s' }}
          onMouseOver={e=>e.currentTarget.style.background='linear-gradient(135deg,rgba(255,157,0,0.3),rgba(255,80,0,0.15))'}
          onMouseOut={e=>e.currentTarget.style.background='linear-gradient(135deg,rgba(255,157,0,0.2),rgba(255,80,0,0.1))'}>
          <span style={{ fontSize:22 }}>👑</span>
          <div style={{ textAlign:'left', flex:1 }}>
            <div style={{ fontSize:13, fontWeight:800, color:'#ff9d00' }}>Beli Premium Pass</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>Unlock semua reward premium + exclusive items</div>
          </div>
          <span style={{ fontSize:18, color:'rgba(255,157,0,0.6)' }}>›</span>
        </button>
      )}

      {/* Claim message */}
      {bpClaimMsg && (
        <div style={{ background:'rgba(200,245,0,0.1)', border:'1px solid rgba(200,245,0,0.3)', borderRadius:10, padding:'8px 12px', marginBottom:10, fontSize:12, color:'#c8f500', textAlign:'center' }}>
          {bpClaimMsg}
        </div>
      )}

      {/* Tiers */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {BATTLE_PASS_TIERS.map((tier, i) => {
          const unlocked = passLevel >= tier.level
          const freeClaimed = claimed.includes(`bp_free_${tier.level}`)
          const premClaimed = claimed.includes(`bp_premium_${tier.level}`)
          return (
            <div key={tier.level} className="slide-in-left" style={{
              animationDelay:`${i*0.06}s`,
              background: unlocked ? 'rgba(255,157,0,0.06)':'rgba(255,255,255,0.03)',
              border:`1px solid ${unlocked?'rgba(255,157,0,0.2)':'rgba(255,255,255,0.07)'}`,
              borderRadius:12, padding:'10px 12px',
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:800, color: unlocked?'#ff9d00':'rgba(255,255,255,0.3)', minWidth:40, background: unlocked?'rgba(255,157,0,0.15)':'rgba(255,255,255,0.05)', borderRadius:6, padding:'2px 6px', textAlign:'center' }}>
                  Lv{tier.level}
                </div>
                {!unlocked && <span style={{ fontSize:10, color:'rgba(255,255,255,0.2)' }}>🔒 {tier.level - passLevel} level lagi</span>}
              </div>
              {/* Free reward row */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:10, background:'rgba(200,245,0,0.1)', color:'#c8f500', borderRadius:4, padding:'1px 5px', fontWeight:700, flexShrink:0 }}>FREE</span>
                <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)', flex:1 }}>{tier.free}</span>
                {unlocked && (
                  freeClaimed
                    ? <span style={{ fontSize:10, color:'rgba(200,245,0,0.5)' }}>✅</span>
                    : <button onClick={() => onClaimTier(tier, false)} style={{ fontSize:10, background:'rgba(200,245,0,0.15)', border:'1px solid rgba(200,245,0,0.3)', color:'#c8f500', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontWeight:700, flexShrink:0 }}>KLAIM</button>
                )}
              </div>
              {/* Premium reward row */}
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:10, background: hasPremium?'rgba(255,215,0,0.15)':'rgba(255,255,255,0.06)', color: hasPremium?'#ffd700':'rgba(255,255,255,0.3)', borderRadius:4, padding:'1px 5px', fontWeight:700, flexShrink:0 }}>👑</span>
                <span style={{ fontSize:11, color: hasPremium?'rgba(255,215,0,0.9)':'rgba(255,255,255,0.3)', flex:1 }}>{tier.premium}</span>
                {unlocked && hasPremium && (
                  premClaimed
                    ? <span style={{ fontSize:10, color:'rgba(255,215,0,0.5)' }}>✅</span>
                    : <button onClick={() => onClaimTier(tier, true)} style={{ fontSize:10, background:'rgba(255,215,0,0.15)', border:'1px solid rgba(255,215,0,0.4)', color:'#ffd700', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontWeight:700, flexShrink:0 }}>KLAIM</button>
                )}
                {unlocked && !hasPremium && (
                  <span style={{ fontSize:9, color:'rgba(255,255,255,0.2)' }}>🔒 Premium</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop:14, background:'rgba(255,157,0,0.06)', border:'1px solid rgba(255,157,0,0.15)', borderRadius:12, padding:'10px 14px' }}>
        <div style={{ fontSize:12, color:'#ff9d00', fontWeight:700, marginBottom:6 }}>💡 Info Battle Pass</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.7 }}>
          ⭐ Level naik setiap 5x pull Gacha<br/>
          🆓 Free reward bisa diklaim semua orang<br/>
          👑 Premium reward hanya untuk pemilik Pass<br/>
          🌟 Item bertanda <strong style={{color:'#ffd700'}}>BP EXCLUSIVE</strong> hanya ada di sini!
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FISHING PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════
interface FishingPanelProps {
  uid: string
  rpgChar: RpgChar | null
  fishingData: FishingData | null
  setFishingData: (d: FishingData | null) => void
  fishingView: string; setFishingView: (v: any) => void
  fishingPhase: string; setFishingPhase: (p: any) => void
  fishingProgress: number; setFishingProgress: (n: number) => void
  fishingTarget: number; setFishingTarget: (n: number) => void
  fishingTargetWidth: number; setFishingTargetWidth: (n: number) => void
  fishingResult: FishData | null; setFishingResult: (f: FishData | null) => void
  fishingMissed: boolean; setFishingMissed: (b: boolean) => void
  fishingLocation: number; setFishingLocation: (n: number) => void
  fishingMsg: string; setFishingMsg: (s: string) => void
  fishingHearts: number; setFishingHearts: React.Dispatch<React.SetStateAction<number>>
  fishingIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>
  fishingWaitRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  onGoldChange: (newGold: number) => Promise<void>
  onFishCaught?: () => void   // callback saat ikan berhasil ditangkap (untuk update charMats)
  onBack?: () => void
}


function FishingPanel({
  uid, rpgChar, fishingData, setFishingData,
  fishingView, setFishingView,
  fishingPhase, setFishingPhase,
  fishingProgress, setFishingProgress,
  fishingTarget, setFishingTarget,
  fishingTargetWidth, setFishingTargetWidth,
  fishingResult, setFishingResult,
  fishingMissed, setFishingMissed,
  fishingLocation, setFishingLocation,
  fishingMsg, setFishingMsg,
  fishingHearts, setFishingHearts,
  fishingIntervalRef, fishingWaitRef,
  onGoldChange, onFishCaught, onBack,
}: FishingPanelProps) {
  // Load fishing data: getDoc sekali, update lokal via saveData setelah setiap aksi
  React.useEffect(() => {
    if (!uid) return
    const fetchFishing = async () => {
      const snap = await getDoc(doc(getRpgDb(uid), 'fishingData', uid))
      if (snap.exists()) {
        setFishingData(snap.data() as FishingData)
      } else {
        const init: FishingData = {
          uid, rodId: 'kayu', pond: {}, unlockedLocations: [0],
          quests: FISHING_QUESTS_TEMPLATE.map(q => ({...q, progress:0, completed:false, claimed:false})),
          totalCaught: 0, rodUpgrades: ['kayu']
        }
        setDoc(doc(getRpgDb(uid), 'fishingData', uid), init)
        setFishingData(init)
      }
    }
    fetchFishing()
  }, [uid])

  const saveData = async (newData: FishingData) => {
    if (!uid) return
    setFishingData(newData)
    await updateDoc(doc(getRpgDb(uid), 'fishingData', uid), newData as any).catch(async () => {
      await setDoc(doc(getRpgDb(uid), 'fishingData', uid), newData as any)
    })
  }

  const currentRod = FISHING_RODS.find(r => r.id === (fishingData?.rodId || 'kayu')) || FISHING_RODS[0]
  const currentLoc = FISHING_LOCATIONS[fishingLocation]
  const gold = rpgChar?.gold || 0

  // ── FISHING MINIGAME ──
  const startCasting = () => {
    if (fishingPhase !== 'idle' || !fishingData) return
    setFishingPhase('casting')
    setFishingMsg('Melempar kail... 🎣')
    fishingWaitRef.current = setTimeout(() => {
      setFishingPhase('waiting')
      setFishingMsg('Menunggu ikan... tunggu gigitan! 🌊')
      // Random wait 1.5-4s before bite
      const waitMs = 1500 + Math.random() * 2500
      fishingWaitRef.current = setTimeout(() => {
        // BITE!
        setFishingPhase('struggle')
        setFishingMsg('⚡ IKAN GIGIT! Klik tombol saat bar masuk zona hijau!')
        // Set target zone
        const tw = currentRod.timingWidth
        const targetPos = 10 + Math.random() * (80 - tw)
        setFishingTarget(targetPos)
        setFishingTargetWidth(tw)
        setFishingProgress(0)
        // Animate bar oscillating
        let dir = 1
        let pos = 0
        let speed = 0.8 + Math.random() * 0.6
        fishingIntervalRef.current = setInterval(() => {
          pos += dir * speed
          if (pos >= 100) { pos = 100; dir = -1 }
          if (pos <= 0) { pos = 0; dir = 1 }
          setFishingProgress(pos)
        }, 16)
        // Auto-miss after 5s
        fishingWaitRef.current = setTimeout(() => {
          clearInterval(fishingIntervalRef.current!)
          setFishingPhase('result')
          setFishingResult(null)
          setFishingMissed(true)
          setFishingHearts((prev: number) => {
            const newHearts = Math.max(0, prev - 1)
            if (newHearts === 0) {
              setFishingMsg('💔 Kehabisan nyawa! Ikan semua kabur...')
              fishingWaitRef.current = setTimeout(() => {
                setFishingPhase('idle'); setFishingMissed(false); setFishingMsg(''); setFishingHearts(3)
              }, 2000)
            } else {
              setFishingMsg(`😔 Ikan kabur... ❤️ Sisa ${newHearts} nyawa!`)
              fishingWaitRef.current = setTimeout(() => {
                setFishingPhase('idle'); setFishingMissed(false); setFishingMsg('')
              }, 2000)
            }
            return newHearts
          })
        }, 5000)
      }, waitMs)
    }, 1000)
  }

  const handleCatch = async () => {
    if (fishingPhase !== 'struggle' || !fishingData) return
    clearInterval(fishingIntervalRef.current!)
    clearTimeout(fishingWaitRef.current!)
    // Lock phase immediately so button disappears
    setFishingPhase('result')
    // Check if in target zone
    const inZone = fishingProgress >= fishingTarget && fishingProgress <= fishingTarget + fishingTargetWidth
    if (inZone) {
      const fish = rollFish(fishingLocation, fishingData.rodId)
      setFishingResult(fish)
      setFishingMissed(false)
      setFishingMsg(`🎉 DAPAT ${fish.name}! (${fish.rarity})`)
      // Reset hearts on success
      setFishingHearts(3)
      // Update data
      const newPond = {...fishingData.pond, [fish.id]: (fishingData.pond[fish.id] || 0) + 1}
      let newQuests = fishingData.quests.map(q => {
        if (q.completed) return q
        if (q.type === 'catch') {
          if (!q.fishId) return {...q, progress: q.progress + 1, completed: q.progress + 1 >= q.target}
          if (q.fishId === fish.id) return {...q, progress: q.progress + 1, completed: q.progress + 1 >= q.target}
        }
        if (q.type === 'location' && q.locationId === fishingLocation) return {...q, progress: q.progress + 1, completed: q.progress + 1 >= q.target}
        return q
      })
      const newData = {...fishingData, pond: newPond, quests: newQuests, totalCaught: fishingData.totalCaught + 1}
      await saveData(newData)
      // ── Tambah 1 fish material ke charMats via callback ──
      if (onFishCaught) onFishCaught()
      // Auto-clear result after 2.5s, let user press button again
      fishingWaitRef.current = setTimeout(() => {
        setFishingPhase('idle')
        setFishingResult(null)
        setFishingMsg('')
      }, 2500)
    } else {
      // Miss: reduce a heart
      setFishingHearts((prev: number) => {
        const newHearts = Math.max(0, prev - 1)
        if (newHearts === 0) {
          setFishingMsg('💔 Kehabisan nyawa! Ikan semua kabur...')
          fishingWaitRef.current = setTimeout(() => {
            setFishingPhase('idle'); setFishingMissed(false); setFishingMsg(''); setFishingHearts(3)
          }, 2000)
        } else {
          setFishingMsg(`❌ Meleset! ❤️ Sisa ${newHearts} nyawa. Klik pas zona hijau ya!`)
          fishingWaitRef.current = setTimeout(() => {
            setFishingPhase('idle'); setFishingMissed(false); setFishingMsg('')
          }, 1800)
        }
        return newHearts
      })
    }
  }

  const sellFish = async (fishId: string, count: number) => {
    if (!fishingData || !rpgChar) return
    const fish = FISH_LIST.find(f => f.id === fishId)
    if (!fish) return
    const earned = fish.sellPrice * count
    const newPond = {...fishingData.pond}
    delete newPond[fishId]
    let newQuests = fishingData.quests.map(q => {
      if (q.type === 'sell' && !q.completed) {
        const np = Math.min(q.progress + earned, q.target)
        return {...q, progress: np, completed: np >= q.target}
      }
      return q
    })
    const newData = {...fishingData, pond: newPond, quests: newQuests}
    await saveData(newData)
    await onGoldChange(rpgChar.gold + earned)
  }

  const claimQuest = async (qid: string) => {
    if (!fishingData || !rpgChar) return
    const q = fishingData.quests.find(x => x.id === qid)
    if (!q || !q.completed || q.claimed) return
    const newQuests = fishingData.quests.map(x => x.id === qid ? {...x, claimed:true} : x)
    const newData = {...fishingData, quests: newQuests}
    await saveData(newData)
    if (q.reward.gold) await onGoldChange(rpgChar.gold + q.reward.gold)
  }

  const upgradeRod = async () => {
    if (!fishingData || !rpgChar) return
    const curTier = FISHING_RODS.findIndex(r => r.id === fishingData.rodId)
    const nextRod = FISHING_RODS[curTier + 1]
    if (!nextRod) return
    const curRod = FISHING_RODS[curTier]
    // Check gold
    if (rpgChar.gold < curRod.upgradeGold) return
    // Check fish
    for (const req of curRod.upgradeFish) {
      if ((fishingData.pond[req.fishId] || 0) < req.count) return
    }
    // Deduct
    const newPond = {...fishingData.pond}
    for (const req of curRod.upgradeFish) {
      newPond[req.fishId] = (newPond[req.fishId] || 0) - req.count
      if (newPond[req.fishId] <= 0) delete newPond[req.fishId]
    }
    await onGoldChange(rpgChar.gold - curRod.upgradeGold)
    const newData = {...fishingData, rodId: nextRod.id, pond: newPond, rodUpgrades: [...(fishingData.rodUpgrades||[]), nextRod.id]}
    await saveData(newData)
  }

  const unlockLocation = async (locId: number) => {
    if (!fishingData || !rpgChar) return
    const loc = FISHING_LOCATIONS[locId]
    if (rpgChar.gold < loc.unlockGold) return
    if (loc.unlockFish.fishId && (fishingData.pond[loc.unlockFish.fishId] || 0) < loc.unlockFish.count) return
    // ── Bug Fix: cek unlockMaterial dari inventory ──────────────
    if (loc.unlockMaterial && !(rpgChar.inventory || []).includes(loc.unlockMaterial)) {
      return
    }
    const newPond = {...fishingData.pond}
    if (loc.unlockFish.fishId) {
      newPond[loc.unlockFish.fishId] = (newPond[loc.unlockFish.fishId] || 0) - loc.unlockFish.count
      if (newPond[loc.unlockFish.fishId] <= 0) delete newPond[loc.unlockFish.fishId]
    }
    await onGoldChange(rpgChar.gold - loc.unlockGold)
    const newData = {...fishingData, pond: newPond, unlockedLocations: [...fishingData.unlockedLocations, locId]}
    await saveData(newData)
  }

  if (!fishingData) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200,flexDirection:'column',gap:12}}>
      <div style={{fontSize:32,animation:'spin 1s linear infinite'}}>🎣</div>
      <div style={{color:'rgba(255,255,255,0.4)',fontSize:13}}>Memuat data mancing...</div>
    </div>
  )

  // ─── HOME VIEW ───
  if (fishingView === 'home') return (
    <div className="fish-wrap">
      {/* Header */}
      <div className="fish-header">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {onBack && (
            <button onClick={onBack} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'5px 10px',color:'rgba(255,255,255,0.6)',fontSize:11,cursor:'pointer',fontWeight:700,flexShrink:0}}>←</button>
          )}
          <div style={{fontSize:28}}>🎣</div>
          <div>
            <div style={{fontSize:16,fontWeight:900,color:'#4fc3f7',letterSpacing:-.3}}>Isekai Fishing</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>Total tangkapan: {fishingData.totalCaught} ikan</div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:13,fontWeight:800,color:'#ffd700'}}>💰 {gold.toLocaleString()}</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>Rod: {currentRod.emoji} {currentRod.name}</div>
        </div>
      </div>

      {/* Quick action - fishing button */}
      <button className="fish-main-btn" onClick={() => setFishingView('fishing')}>
        <span style={{fontSize:32}}>🎣</span>
        <div>
          <div style={{fontSize:16,fontWeight:900}}>Mulai Mancing</div>
          <div style={{fontSize:11,opacity:.7}}>{currentLoc.emoji} {currentLoc.name}</div>
        </div>
        <span style={{fontSize:20,opacity:.5}}>›</span>
      </button>

      {/* Menu grid */}
      <div className="fish-menu-grid">
        <button className="fish-menu-btn" onClick={() => setFishingView('pond')}>
          <span style={{fontSize:24}}>🐟</span>
          <span>Kolam Koleksi</span>
          <span style={{fontSize:11,opacity:.5}}>{Object.keys(fishingData.pond).length} jenis</span>
        </button>
        <button className="fish-menu-btn" onClick={() => setFishingView('rods')}>
          <span style={{fontSize:24}}>🪵</span>
          <span>Upgrade Rod</span>
          <span style={{fontSize:11,opacity:.5}}>Tier {currentRod.tier}/6</span>
        </button>
        <button className="fish-menu-btn" onClick={() => setFishingView('quests')}>
          <span style={{fontSize:24}}>📋</span>
          <span>Misi Mancing</span>
          <span style={{fontSize:11,opacity:.5,color:'#c8f500'}}>{fishingData.quests.filter(q=>q.completed&&!q.claimed).length} siap klaim</span>
        </button>
        <button className="fish-menu-btn" onClick={() => setFishingView('fishing')}>
          <span style={{fontSize:24}}>📍</span>
          <span>Lokasi</span>
          <span style={{fontSize:11,opacity:.5}}>{fishingData.unlockedLocations.length}/5 dibuka</span>
        </button>
      </div>

      {/* Location selector */}
      <div style={{padding:'0 12px 12px'}}>
        <div style={{fontSize:11,fontWeight:800,color:'rgba(255,255,255,0.3)',letterSpacing:.5,marginBottom:8}}>📍 PILIH LOKASI</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {FISHING_LOCATIONS.map((loc,i) => {
            const unlocked = fishingData.unlockedLocations.includes(i)
            return (
              <button key={i} onClick={() => unlocked && setFishingLocation(i)}
                className={`fish-loc-btn ${fishingLocation===i?'active':''} ${!unlocked?'locked':''}`}>
                <span style={{fontSize:20}}>{loc.emoji}</span>
                <div style={{flex:1,textAlign:'left'}}>
                  <div style={{fontSize:13,fontWeight:700,color:unlocked?'#fff':'rgba(255,255,255,0.3)'}}>{loc.name}</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{loc.desc}</div>
                </div>
                {!unlocked ? (
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:10,color:'#ffd700'}}>🔒 {loc.unlockGold.toLocaleString()} G</div>
                    {loc.unlockMaterial && <div style={{fontSize:9,color:'#ff9d00',marginTop:1}}>📦 {loc.unlockMaterial}</div>}
                    <button className="fish-unlock-btn" onClick={e => {e.stopPropagation(); unlockLocation(i)}} disabled={
                      rpgChar!.gold < loc.unlockGold ||
                      (!!loc.unlockMaterial && !(rpgChar!.inventory||[]).includes(loc.unlockMaterial))
                    }>
                      {loc.unlockMaterial && !(rpgChar!.inventory||[]).includes(loc.unlockMaterial) ? `Butuh ${loc.unlockMaterial}` : 'Buka'}
                    </button>
                  </div>
                ) : (
                  <span style={{fontSize:16,color:'#4fc3f7'}}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ─── FISHING MINIGAME VIEW ───
  if (fishingView === 'fishing') return (
    <div className="fish-wrap">
      <div className="fish-header">
        <button className="fish-back-btn" onClick={() => { setFishingView('home'); setFishingPhase('idle'); setFishingHearts(3); setFishingMsg('') }}>‹ Kembali</button>
        <div style={{fontSize:14,fontWeight:800,color:'#4fc3f7'}}>{currentLoc.emoji} {currentLoc.name}</div>
        <div style={{fontSize:12,color:'#ffd700'}}>💰 {gold.toLocaleString()}</div>
      </div>

      {/* Hearts display */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'8px 12px 0'}}>
        {[1,2,3].map(i => (
          <span key={i} style={{fontSize:22,filter: i <= fishingHearts ? 'none' : 'grayscale(1) opacity(0.25)',transition:'all .3s'}}>❤️</span>
        ))}
        <span style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginLeft:4}}>Nyawa</span>
      </div>

      {/* Water scene */}
      <div className="fish-scene">
        <div className="fish-water-bg">
          <div className="fish-ripple r1"/>
          <div className="fish-ripple r2"/>
          <div className="fish-ripple r3"/>
          <div style={{fontSize:40,position:'relative',zIndex:2,filter: fishingPhase==='struggle'?'drop-shadow(0 0 12px #4fc3f7)':'none', transition:'filter .3s'}}>
            {fishingPhase==='idle'?'🎣': fishingPhase==='casting'?'🌊': fishingPhase==='waiting'?'🎣': fishingPhase==='struggle'?'⚡': fishingResult?'🎉':'😔'}
          </div>
          {fishingPhase==='struggle' && (
            <div style={{position:'absolute',bottom:12,left:'50%',transform:'translateX(-50%)',fontSize:12,color:'#4fc3f7',fontWeight:800,animation:'fishPulse .5s ease-in-out infinite'}}>
              KLIK SEKARANG!
            </div>
          )}
        </div>

        {/* Struggle bar */}
        {(fishingPhase==='struggle'||fishingPhase==='result') && (
          <div className="fish-bar-wrap">
            <div className="fish-bar-track">
              {/* Target zone (green) */}
              <div className="fish-bar-zone" style={{left:`${fishingTarget}%`, width:`${fishingTargetWidth}%`}}/>
              {/* Moving indicator */}
              <div className="fish-bar-indicator" style={{left:`${fishingProgress}%`}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>← Kiri</span>
              <span style={{fontSize:10,color:'#4fc3f7',fontWeight:700}}>ZONA TANGKAP</span>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Kanan →</span>
            </div>
          </div>
        )}

        {/* Message */}
        {fishingMsg && (
          <div className={`fish-msg ${fishingResult?'win':fishingMissed?'miss':''}`}>{fishingMsg}</div>
        )}

        {/* Result card */}
        {fishingPhase==='result' && fishingResult && (
          <div className="fish-result-card" style={{borderColor:FISH_RARITY_COLOR[fishingResult.rarity], background:FISH_RARITY_BG[fishingResult.rarity]}}>
            <span style={{fontSize:36}}>{fishingResult.emoji}</span>
            <div>
              <div style={{fontSize:15,fontWeight:900,color:FISH_RARITY_COLOR[fishingResult.rarity]}}>{fishingResult.name}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>{fishingResult.rarity} • Jual: {fishingResult.sellPrice} Gold</div>
            </div>
          </div>
        )}

        {/* Action button */}
        <div style={{padding:'16px 12px'}}>
          {fishingPhase === 'idle' && (
            <button className="fish-action-btn cast" onClick={startCasting}>
              🎣 Lempar Kail
            </button>
          )}
          {fishingPhase === 'struggle' && (
            <button className="fish-action-btn catch" onClick={handleCatch}>
              ⚡ TANGKAP!
            </button>
          )}
          {(fishingPhase === 'casting' || fishingPhase === 'waiting') && (
            <button className="fish-action-btn waiting" disabled>
              {fishingPhase === 'casting' ? '🌊 Melempar...' : '⏳ Menunggu gigitan...'}
            </button>
          )}
          {fishingPhase === 'result' && (
            <button className="fish-action-btn cast" onClick={() => { setFishingPhase('idle'); setFishingResult(null); setFishingMissed(false); setFishingMsg('') }}>
              🎣 Mancing Lagi
            </button>
          )}
        </div>

        {/* Rod info */}
        <div style={{margin:'0 12px 12px', background:'rgba(79,195,247,0.05)', border:'1px solid rgba(79,195,247,0.15)', borderRadius:10, padding:'8px 12px', display:'flex', alignItems:'center', gap:10}}>
          <span style={{fontSize:20}}>{currentRod.emoji}</span>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:'#4fc3f7'}}>{currentRod.name}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Zona tangkap: {currentRod.timingWidth}% • Bonus rarity: +{currentRod.rarityBonus}%</div>
          </div>
        </div>
      </div>
    </div>
  )

  // ─── POND VIEW ───
  if (fishingView === 'pond') return (
    <div className="fish-wrap">
      <div className="fish-header">
        <button className="fish-back-btn" onClick={() => setFishingView('home')}>‹ Kembali</button>
        <div style={{fontSize:14,fontWeight:800,color:'#4fc3f7'}}>🐟 Kolam Koleksi</div>
        <div/>
      </div>
      <div style={{padding:'0 12px 12px'}}>
        {Object.keys(fishingData.pond).length === 0 ? (
          <div style={{textAlign:'center',padding:40,color:'rgba(255,255,255,0.3)',fontSize:13}}>
            <div style={{fontSize:36,marginBottom:8}}>🎣</div>
            Kolam kosong, mulai mancing!
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {Object.entries(fishingData.pond).map(([fishId, count]) => {
              const fish = FISH_LIST.find(f => f.id === fishId)
              if (!fish || count <= 0) return null
              return (
                <div key={fishId} className="fish-pond-item" style={{borderColor:FISH_RARITY_COLOR[fish.rarity]+'44',background:FISH_RARITY_BG[fish.rarity]}}>
                  <span style={{fontSize:28}}>{fish.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:800,color:FISH_RARITY_COLOR[fish.rarity]}}>{fish.name}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{fish.rarity} • {fish.desc}</div>
                    <div style={{fontSize:11,color:'#ffd700',marginTop:2}}>× {count} ekor • Jual: {(fish.sellPrice*count).toLocaleString()} Gold</div>
                  </div>
                  <button className="fish-sell-btn" onClick={() => sellFish(fishId, count)}>
                    Jual<br/>Semua
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  // ─── ROD UPGRADE VIEW ───
  if (fishingView === 'rods') return (
    <div className="fish-wrap">
      <div className="fish-header">
        <button className="fish-back-btn" onClick={() => setFishingView('home')}>‹ Kembali</button>
        <div style={{fontSize:14,fontWeight:800,color:'#4fc3f7'}}>🪵 Upgrade Rod</div>
        <div/>
      </div>
      <div style={{padding:'0 12px 12px',display:'flex',flexDirection:'column',gap:10}}>
        {FISHING_RODS.map((rod, i) => {
          const isOwned = fishingData.rodUpgrades?.includes(rod.id)
          const isCurrent = fishingData.rodId === rod.id
          const isNext = FISHING_RODS[FISHING_RODS.findIndex(r=>r.id===fishingData.rodId)+1]?.id === rod.id
          const prevRod = FISHING_RODS[i-1]
          const canUpgrade = isNext && prevRod && rpgChar && rpgChar.gold >= prevRod.upgradeGold &&
            prevRod.upgradeFish.every(req => (fishingData.pond[req.fishId]||0) >= req.count)
          return (
            <div key={rod.id} className={`fish-rod-card ${isCurrent?'current':isOwned?'owned':''}`}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                <span style={{fontSize:28}}>{rod.emoji}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:900,color:isCurrent?'#4fc3f7':isOwned?'#c8f500':'rgba(255,255,255,0.5)'}}>
                    {rod.name} {isCurrent&&'✓'}
                  </div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{rod.desc}</div>
                </div>
                <div style={{marginLeft:'auto',textAlign:'right'}}>
                  <div style={{fontSize:11,color:'#4fc3f7'}}>Zona: {rod.timingWidth}%</div>
                  <div style={{fontSize:11,color:'#c8f500'}}>+{rod.rarityBonus}% Rarity</div>
                </div>
              </div>
              {isNext && prevRod && (
                <div style={{borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:8,marginTop:4}}>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Butuh upgrade dari {prevRod.name}:</div>
                  <div style={{fontSize:12,color:'#ffd700',marginBottom:4}}>💰 {prevRod.upgradeGold.toLocaleString()} Gold</div>
                  {prevRod.upgradeFish.map(req => {
                    const fish = FISH_LIST.find(f => f.id === req.fishId)
                    const have = fishingData.pond[req.fishId] || 0
                    return (
                      <div key={req.fishId} style={{fontSize:11,color:have>=req.count?'#c8f500':'#ff6b6b'}}>
                        {fish?.emoji} {fish?.name} × {req.count} (punya: {have})
                      </div>
                    )
                  })}
                  <button className={`fish-upgrade-btn ${canUpgrade?'':'disabled'}`} onClick={() => canUpgrade && upgradeRod()} disabled={!canUpgrade}>
                    {canUpgrade ? '⬆️ Upgrade Sekarang' : '🔒 Belum Bisa Upgrade'}
                  </button>
                </div>
              )}
              {!isOwned && !isNext && (
                <div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:4}}>🔒 Upgrade rod sebelumnya terlebih dahulu</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  // ─── QUESTS VIEW ───
  if (fishingView === 'quests') return (
    <div className="fish-wrap">
      <div className="fish-header">
        <button className="fish-back-btn" onClick={() => setFishingView('home')}>‹ Kembali</button>
        <div style={{fontSize:14,fontWeight:800,color:'#4fc3f7'}}>📋 Misi Mancing</div>
        <div/>
      </div>
      <div style={{padding:'0 12px 12px',display:'flex',flexDirection:'column',gap:8}}>
        {fishingData.quests.map(q => (
          <div key={q.id} className={`fish-quest-card ${q.completed?'done':''}`}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
              <span style={{fontSize:24}}>{q.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:q.completed?'#c8f500':'#fff'}}>{q.name}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:6}}>{q.desc}</div>
                {/* Progress bar */}
                <div style={{background:'rgba(255,255,255,0.08)',borderRadius:4,height:6,overflow:'hidden',marginBottom:4}}>
                  <div style={{height:'100%',borderRadius:4,background:q.completed?'#c8f500':'#4fc3f7',width:`${Math.min(100,(q.progress/q.target)*100)}%`,transition:'width .3s'}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{q.type==='sell'?`${q.progress}/${q.target} Gold`:`${q.progress}/${q.target}`}</span>
                  <span style={{fontSize:10,color:'#ffd700'}}>💰 +{q.reward.gold} Gold{q.reward.primogems?` • 💎 +${q.reward.primogems}`:''}</span>
                </div>
              </div>
            </div>
            {q.completed && !q.claimed && (
              <button className="fish-claim-btn" onClick={() => claimQuest(q.id)}>Klaim Reward</button>
            )}
            {q.claimed && (
              <div style={{fontSize:11,color:'rgba(200,245,0,0.6)',textAlign:'center',padding:'4px 0'}}>✅ Sudah diklaim</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  return null
}

