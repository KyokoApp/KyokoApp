import React, { useEffect, useRef, useState, useCallback } from 'react'
import AnimeStreamPanel from './AnimeStreamPanel'
import { auth, googleProvider, dbChat, getRpgDb } from './firebase'
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
  titles: string[]; element: Element; wins: number; losses: number
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
}
interface ActiveBattleInfo {
  uid: string; username: string; class: RpgClass
  playerHp: number; playerMaxHp: number; playerMp: number; playerMaxMp: number
  monsterName: string; monsterEmoji: string; monsterHp: number; monsterMaxHp: number
  updatedAt: number
}
type RpgClass = 'Warrior' | 'Mage' | 'Rogue' | 'Paladin' | 'Archer' | 'Necromancer' | 'Berserker' | 'Summoner'
type Element = 'Fire' | 'Water' | 'Earth' | 'Wind' | 'Dark' | 'Light' | 'Thunder' | 'Ice'

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
const ELEMENTS: Element[] = ['Fire','Water','Earth','Wind','Dark','Light','Thunder','Ice']
const ELEMENT_EMOJI: Record<Element, string> = {
  Fire:'🔥', Water:'💧', Earth:'🌿', Wind:'🌪️', Dark:'🌑', Light:'✨', Thunder:'⚡', Ice:'❄️'
}
const MONSTERS = [
  { name: 'Slime Biru',     emoji: '🟦', hp: 150,  atk: 8,  def: 2,  exp: 15,  gold: 8,   rank: 'F', drop: 'Lendir Slime' },
  { name: 'Goblin',         emoji: '👺', hp: 220,  atk: 12, def: 4,  exp: 25,  gold: 15,  rank: 'F', drop: 'Telinga Goblin' },
  { name: 'Wolf Hutan',     emoji: '🐺', hp: 300,  atk: 18, def: 6,  exp: 40,  gold: 22,  rank: 'E', drop: 'Taring Wolf' },
  { name: 'Orc Prajurit',   emoji: '👹', hp: 450, atk: 24, def: 10, exp: 65,  gold: 35,  rank: 'E', drop: 'Baju Orc Rusak' },
  { name: 'Undead Knight',  emoji: '💀', hp: 600, atk: 30, def: 15, exp: 90,  gold: 50,  rank: 'D', drop: 'Tulang Rune' },
  { name: 'Dark Elf',       emoji: '🧝', hp: 520, atk: 35, def: 12, exp: 110, gold: 60,  rank: 'D', drop: 'Busur Gelap' },
  { name: 'Ice Golem',      emoji: '🧊', hp: 800, atk: 28, def: 25, exp: 140, gold: 75,  rank: 'C', drop: 'Kristal Es' },
  { name: 'Thunder Wyvern', emoji: '🦅', hp: 720, atk: 42, def: 18, exp: 170, gold: 90,  rank: 'C', drop: 'Sisik Petir' },
  { name: 'Demon Samurai',  emoji: '👿', hp: 1000, atk: 50, def: 22, exp: 220, gold: 120, rank: 'B', drop: 'Katana Setan' },
  { name: 'Ancient Lich',   emoji: '🦴', hp: 1200, atk: 60, def: 20, exp: 280, gold: 150, rank: 'B', drop: 'Mahkota Lich' },
  { name: 'Fire Dragon',    emoji: '🐲', hp: 1800, atk: 75, def: 30, exp: 400, gold: 220, rank: 'A', drop: 'Sisik Naga Api' },
  { name: 'Void Titan',     emoji: '🌌', hp: 2000, atk: 80, def: 35, exp: 500, gold: 280, rank: 'A', drop: 'Inti Kehampaan' },
  { name: 'Abyss Lord',     emoji: '😈', hp: 2800, atk: 100,def: 45, exp: 700, gold: 400, rank: 'S', drop: 'Jiwa Jurang' },
  { name: 'Celestial Beast',emoji: '🦁', hp: 3200, atk: 110,def: 50, exp: 900, gold: 500, rank: 'S', drop: 'Kristal Langit' },
  { name: 'World Serpent',  emoji: '🐍', hp:4000, atk: 130,def: 55, exp:1200, gold: 700, rank: 'SS',drop: 'Sisik Dunia' },
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
type GachaRarity = '5★' | '4★' | '3★'
type GachaElement = 'Pyro'|'Hydro'|'Anemo'|'Geo'|'Electro'|'Dendro'|'Cryo'|'Spectro'|'Havoc'
interface GachaChar {
  id: string; name: string; rarity: GachaRarity; element: GachaElement
  weapon: string; emoji: string; desc: string
  atk: number; def: number; hp: number; spd: number
  skill: string; burst: string
  img?: string
}
const GACHA_CHARS: GachaChar[] = [
  { id:'aether',    name:'Aether',      rarity:'5★', element:'Anemo',   weapon:'Sword',    emoji:'⚡', desc:'Pengelana dari dunia lain, ahli semua elemen.',    atk:42,def:36,hp:280,spd:20, skill:'Wind Blade',    burst:'Elemental Surge' },
  { id:'lumine',    name:'Lumine',      rarity:'5★', element:'Anemo',   weapon:'Sword',    emoji:'🌙', desc:'Saudari Aether, kekuatan misterius tersembunyi.',   atk:40,def:38,hp:290,spd:19, skill:'Star Shower',   burst:'Celestial Rift' },
  { id:'hu_tao',    name:'Hu Tao',      rarity:'5★', element:'Pyro',    weapon:'Polearm',  emoji:'🔥', desc:'Direktur Rumah Duka, api kematian di tangannya.',   atk:55,def:22,hp:250,spd:17, skill:'Searing Grasp', burst:'Spirit Soother' },
  { id:'raiden',    name:'Raiden Ei',   rarity:'5★', element:'Electro', weapon:'Polearm',  emoji:'⚡', desc:'Shogun Abadi Inazuma, penguasa petir.',             atk:52,def:26,hp:265,spd:18, skill:'Transcendence', burst:'Musou Isshin' },
  { id:'furina',    name:'Furina',      rarity:'5★', element:'Hydro',   weapon:'Sword',    emoji:'💧', desc:'Archon Hydro Fontaine, diva panggung keadilan.',    atk:48,def:28,hp:275,spd:21, skill:'Style Change',  burst:'Let the Show Begin' },
  { id:'nahida',    name:'Nahida',      rarity:'5★', element:'Dendro',  weapon:'Catalyst', emoji:'🌿', desc:'Archon Kecil Sumeru, kebijaksanaan tak terbatas.',  atk:46,def:30,hp:260,spd:22, skill:'TDM Link',      burst:'Illusory Heart' },
  { id:'kazuha',    name:'Kazuha',      rarity:'5★', element:'Anemo',   weapon:'Sword',    emoji:'🍂', desc:'Samurai Ronin, puisi angin di setiap langkahnya.',  atk:50,def:24,hp:270,spd:24, skill:'Chihayaburu',   burst:'Kazuha Slash' },
  { id:'zhongli',   name:'Zhongli',     rarity:'5★', element:'Geo',     weapon:'Polearm',  emoji:'🪨', desc:'Morax, Archon Batu, kontrak adalah segalanya.',     atk:44,def:45,hp:310,spd:15, skill:'Dominus Lapidis','burst':'Planet Befall' },
  { id:'yelan',     name:'Yelan',       rarity:'5★', element:'Hydro',   weapon:'Bow',      emoji:'🎯', desc:'Agen misterius Liyue, informasi adalah kekuatan.',  atk:51,def:20,hp:285,spd:23, skill:'Lingering Lifeline','burst':'Depth-Clarion Dice' },
  { id:'arlecchino',name:'Arlecchino',  rarity:'5★', element:'Pyro',    weapon:'Polearm',  emoji:'🎪', desc:'Fatui Harbormaster, nyala abadi Knave.',            atk:58,def:18,hp:245,spd:20, skill:'All Is Ash',    burst:'Balemoon Shadesire' },
  // 4★
  { id:'xiangling', name:'Xiangling',   rarity:'4★', element:'Pyro',    weapon:'Polearm',  emoji:'🍜', desc:'Chef berbakat Liyue dengan beruang api Guoba.',     atk:38,def:20,hp:200,spd:18, skill:'Guoba Attack',  burst:'Pyronado' },
  { id:'fischl',    name:'Fischl',      rarity:'4★', element:'Electro', weapon:'Bow',      emoji:'🦅', desc:'Prinzessin der Verurteilung, menyayangi Oz.',       atk:40,def:18,hp:190,spd:19, skill:'Nightrider',    burst:'Midnight Phantasmagoria' },
  { id:'bennett',   name:'Bennett',     rarity:'4★', element:'Pyro',    weapon:'Sword',    emoji:'🍀', desc:'Petualang sial tapi paling berhati emas.',           atk:35,def:22,hp:215,spd:17, skill:'Passion Overload','burst':'Fantastic Voyage' },
  { id:'sucrose',   name:'Sucrose',     rarity:'4★', element:'Anemo',   weapon:'Catalyst', emoji:'🧪', desc:'Alkemis Mondstadt, peneliti reaksi elemen.',        atk:33,def:24,hp:195,spd:20, skill:'Isotoma',       burst:'Forbidden Creation' },
  { id:'beidou',    name:'Beidou',      rarity:'4★', element:'Electro', weapon:'Claymore', emoji:'⚓', desc:'Kapten Laut Crux Fleet, petir di samudera.',        atk:42,def:26,hp:210,spd:16, skill:'Tidecaller',    burst:'Stormbreaker' },
  { id:'noelle',    name:'Noelle',      rarity:'4★', element:'Geo',     weapon:'Claymore', emoji:'🌹', desc:'Penjaga Kastil Knight Favonius paling gigih.',      atk:30,def:42,hp:230,spd:14, skill:'Breastplate',   burst:'Sweeping Time' },
  // WuWa chars
  { id:'rover',     name:'Rover',       rarity:'5★', element:'Spectro', weapon:'Sword',    emoji:'🌟', desc:'Resonator misterius, kekuatan Spectro terpendam.',  atk:50,def:30,hp:275,spd:21, skill:'Resonance Skill','burst':'Resonance Liberation' },
  { id:'jiyan',     name:'Jiyan',       rarity:'5★', element:'Anemo',   weapon:'Broadblade',emoji:'🌀',desc:'Komandan Resonator Jinzhou, angin pedang tajam.',  atk:54,def:25,hp:260,spd:22, skill:'Emerald Storm', burst:'Emerald Tempest' },
  { id:'calcharo',  name:'Calcharo',    rarity:'5★', element:'Electro', weapon:'Rectifier',emoji:'⚡', desc:'Resonator Electro dengan kekuatan destruktif.',     atk:57,def:20,hp:250,spd:19, skill:'Execute',       burst:'Death Messenger' },
  { id:'jinhsi',    name:'Jinhsi',      rarity:'5★', element:'Spectro', weapon:'Rectifier',emoji:'✨', desc:'Wali Jinzhou, cahaya Spectro yang menyilaukan.',    atk:49,def:32,hp:270,spd:20, skill:'Temporal Bender','burst':'Purification Light' },
  // 3★
  { id:'amber',     name:'Amber',       rarity:'3★', element:'Pyro',    weapon:'Bow',      emoji:'🐰', desc:'Outrider Knight Mondstadt satu-satunya.',           atk:28,def:18,hp:175,spd:16, skill:'Explosive Puppet','burst':'Fiery Rain' },
  { id:'kaeya',     name:'Kaeya',       rarity:'3★', element:'Cryo',    weapon:'Sword',    emoji:'❄️', desc:'Cavalry Captain Mondstadt berbakat.',               atk:30,def:20,hp:180,spd:17, skill:'Frostgnaw',     burst:'Glacial Waltz' },
  { id:'lisa',      name:'Lisa',        rarity:'3★', element:'Electro', weapon:'Catalyst', emoji:'📚', desc:'Perpustakaan Knight Favonius yang malas tapi jenius.',atk:32,def:16,hp:170,spd:18, skill:'Violet Arc',   burst:'Lightning Rose' },
]

const GACHA_BANNER: { name: string; featured: string[]; rateUp: boolean } = {
  name: '✨ Wishing Star Banner', featured: ['hu_tao','furina','jiyan'], rateUp: true
}

const PITY_SOFT = 74   // soft pity mulai
const PITY_HARD = 90   // hard pity

interface PlayerGacha {
  uid: string; primogems: number; tickets: number
  pity: number; guaranteed: boolean
  roster: string[]   // char ids
  pulls: number      // total pulls
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
  Electro:'#c86eff', Dendro:'#7cbb4a', Cryo:'#98d8ea', Spectro:'#ffd700', Havoc:'#9b59b6'
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
const MINE_COOLDOWN_MS = 10 * 60 * 1000  // 10 menit

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

export default function GlobalChatPanel({ onClose, onUnread, onMusicChange }: {
  onClose: () => void
  onUnread?: () => void
  onMusicChange?: (info: { playing: boolean; title: string; audioRef: React.RefObject<HTMLAudioElement | null> } | null) => void
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

  const [activeTab, setActiveTab] = useState<'chat'|'rpg'|'fishing'|'voice'|'music'|'anime'>('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
  // Helper: update rpgChar di Firestore + local state sekaligus (hemat re-fetch)
  const updateRpgChar = useCallback(async (updates: Partial<RpgChar>) => {
    if (!user) return
    await updateDoc(doc(getRpgDb(user.uid), 'rpgChars', user.uid), updates as any)
    setRpgChar(prev => prev ? { ...prev, ...updates } as RpgChar : prev)
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
    monster: typeof MONSTERS[0]; monsterHp: number; playerHp: number; playerMp: number
    log: {text:string;type:'dmg'|'heal'|'skill'|'info'}[]; phase: 'idle'|'player'|'enemy'|'result'
    result?: 'win'|'lose'; loading: boolean
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
    const q = query(collection(dbChat, 'globalChat'), orderBy('createdAt', 'desc'), limit(100))
    return onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({
        id: d.id, ...(d.data() as Omit<GcMessage,'id'>),
        createdAt: d.data().createdAt?.toMillis?.() ?? Date.now()
      })).reverse()
      setMessages(msgs)
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
    // rpgChar: getDoc sekali, update local state setelah setiap write
    const fetchRpgChar = async () => {
      const snap = await getDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid))
      if (snap.exists()) setRpgChar(snap.data() as RpgChar)
      else setRpgChar(null)
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
          pity: 0, guaranteed: false, roster: ['amber','kaeya','lisa'], pulls: 0
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

  // Leaderboard: on-demand + cache 1 hari — fetch hanya saat buka leaderboard/duel/transfer
  const LEADERBOARD_CACHE_MS = 24 * 60 * 60 * 1000
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
      await signInWithPopup(auth, googleProvider)
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') {
        try { await signInWithRedirect(auth, googleProvider) } catch {}
      }
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

  const createCharacter = async (cls: RpgClass, elem: Element) => {
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
      monster: m, monsterHp: m.hp,
      playerHp: rpgChar.hp, playerMp: rpgChar.mp,
      log: [{ text: `⚔️ ${rpgChar.username} vs ${m.emoji} ${m.name}!`, type: 'info' as const }],
      phase: 'player' as const, loading: false
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

  const doAttack = async (type: 'normal'|'skill', skillIdx?: number) => {
    if (!battleState || !rpgChar || battleState.phase !== 'player') return
    const bs = { ...battleState }
    bs.loading = true
    setBattleAnim('player-atk')
    setTimeout(() => setBattleAnim(''), 400)

    let dmg = 0
    let logEntry: {text:string;type:'dmg'|'heal'|'skill'|'info'} = { text: '', type: 'dmg' }

    // Apply active food buffs to ATK and DEF
    const nowTs = Date.now()
    const activeFoodBuffs = (rpgChar.foodBuffs || []).filter(b => b.expiresAt > nowTs)
    const buffedAtk = activeFoodBuffs.filter(b => b.stat === 'atk').reduce((acc, b) => acc + b.value, rpgChar.atk)
    const buffedDef = activeFoodBuffs.filter(b => b.stat === 'def').reduce((acc, b) => acc + b.value, rpgChar.def)

    if (type === 'normal') {
      dmg = Math.max(1, buffedAtk - bs.monster.def + Math.floor(Math.random() * 8) - 4)
      const crit = Math.random() * 100 < rpgChar.luck
      if (crit) { dmg = Math.floor(dmg * 1.8); logEntry = { text: `💥 KRITIS! Kamu menyerang ${bs.monster.name} -${dmg} HP!`, type: 'dmg' } }
      else logEntry = { text: `⚔️ Kamu menyerang ${bs.monster.name} -${dmg} HP`, type: 'dmg' }
    } else if (type === 'skill' && skillIdx !== undefined) {
      const skill = rpgChar.skills[skillIdx]
      const mpCost = 15 + skillIdx * 5
      if (bs.playerMp < mpCost) {
        bs.log.push({ text: `💙 MP tidak cukup! Butuh ${mpCost} MP, kamu punya ${bs.playerMp} MP.`, type: 'info' })
        setBattleState({ ...bs, loading: false })
        return
      }
      bs.playerMp -= mpCost
      dmg = Math.max(1, Math.floor(buffedAtk * (1.5 + skillIdx * 0.3)) - bs.monster.def + Math.floor(Math.random() * 12))
      logEntry = { text: `✨ ${skill}! Kamu menyerang ${bs.monster.name} -${dmg} HP [MP -${mpCost}]`, type: 'skill' }
    }

    bs.monsterHp = Math.max(0, bs.monsterHp - dmg)
    bs.log.push(logEntry)

    if (bs.monsterHp <= 0) {
      bs.phase = 'result'; bs.result = 'win'
      const expGain = bs.monster.exp; const goldGain = bs.monster.gold
      bs.log.push({ text: `🏆 Menang! +${expGain} EXP +${goldGain} Gold | Drop: ${bs.monster.drop}`, type: 'info' })
      setBattleState({ ...bs, loading: false })
      clearActiveBattle()
      showToast('win', '🏆 MENANG!', `+${expGain} EXP · +${goldGain} Gold · Drop: ${bs.monster.drop}`)

      const newExp = rpgChar.exp + expGain
      const newGold = rpgChar.gold + goldGain
      const newLevel = getLevel(newExp)
      const newKills = rpgChar.kills + 1
      const inv = [...rpgChar.inventory, bs.monster.drop]
      const lvlUp = newLevel > rpgChar.level

      let newQuestProgress = rpgChar.questProgress
      let newActiveQuest = rpgChar.activeQuest
      if (rpgChar.activeQuest) {
        const quest = QUESTS.find(q => q.id === rpgChar.activeQuest)
        if (quest && quest.ranks.includes(bs.monster.rank)) {
          newQuestProgress = Math.min(newQuestProgress + 1, quest.kills)
          if (newQuestProgress >= quest.kills) {
            bs.log.push({ text: `✅ Quest "${quest.name}" SELESAI! Pergi ke Quest Board untuk klaim reward!`, type: 'info' })
            // Tidak auto-clear — user harus klaim manual di Quest Board
          }
        }
      }

      const updates: Partial<RpgChar> = {
        exp: newExp, gold: newGold, level: newLevel, kills: newKills,
        inventory: inv.slice(-20), activeQuest: newActiveQuest, questProgress: newQuestProgress,
        hp: Math.min(bs.playerHp, rpgChar.maxHp + (lvlUp ? 20 : 0)),
        mp: Math.min(bs.playerMp, rpgChar.maxMp + (lvlUp ? 15 : 0)),
        wins: (rpgChar.wins || 0) + 1
      }
      // Track daily mission progress for battle
      const todayStr = new Date().toDateString()
      const dm = rpgChar.dailyMissions?.date === todayStr ? rpgChar.dailyMissions : { date: todayStr, completed: [], claimed: [] }
      if (!dm.completed.includes('dm_battle') && newKills % 3 === 0) {
        dm.completed = [...dm.completed, 'dm_battle']
        showToast('info', '📋 Daily Done!', 'Mission "Berburu Monster" selesai! Klaim di Daily Missions.')
      }
      updates.dailyMissions = dm
      if (lvlUp) {
        updates.maxHp = rpgChar.maxHp + 20; updates.maxMp = rpgChar.maxMp + 15
        updates.atk = rpgChar.atk + 3; updates.def = rpgChar.def + 2
        const titleIdx = Math.min(Math.floor(newLevel / 5), TITLES.length - 1)
        updates.titles = [TITLES[titleIdx]]
        showToast('info', '🎉 LEVEL UP!', `${rpgChar.username} naik ke Level ${newLevel}!`)
      }
      await updateRpgChar(updates)
      return
    }

    // Enemy turn
    bs.phase = 'enemy'
    setBattleState({ ...bs })
    updateActiveBattle({ ...bs })
    setTimeout(() => {
      setBattleAnim('enemy-atk')
      setTimeout(() => setBattleAnim(''), 400)
      // Rank-based armor penetration: high-rank monsters bypass a portion of player defense
      const rankPen: Record<string,number> = { F:0, E:0.1, D:0.2, C:0.35, B:0.5, A:0.65, S:0.8, SS:1.0 }
      const pen = rankPen[bs.monster.rank] || 0
      const effectiveDef = Math.floor(buffedDef * (1 - pen))
      const baseEDmg = bs.monster.atk - effectiveDef + Math.floor(Math.random() * 6) - 3
      // Minimum damage = 15% of monster ATK regardless of defense
      const minDmg = Math.max(1, Math.floor(bs.monster.atk * 0.15))
      const eDmg = Math.max(minDmg, baseEDmg)
      bs.playerHp = Math.max(0, bs.playerHp - eDmg)
      bs.log.push({ text: `${bs.monster.emoji} ${bs.monster.name} menyerang kamu -${eDmg} HP!`, type: 'dmg' })

      if (bs.playerHp <= 0) {
        bs.phase = 'result'; bs.result = 'lose'
        bs.log.push({ text: '💀 Kamu kalah! HP dipulihkan sebagian.', type: 'info' })
        clearActiveBattle()
        showToast('lose', '💀 KALAH!', `${bs.monster.name} mengalahkanmu. HP dipulihkan 30%.`)
        updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), {
          hp: Math.floor(rpgChar.maxHp * 0.3),
          mp: Math.floor(rpgChar.maxMp * 0.5), // restore some MP too
          losses: (rpgChar.losses || 0) + 1
        })
      } else {
        bs.phase = 'player'
        updateActiveBattle({ ...bs, loading: false })
      }
      setBattleState({ ...bs, loading: false })
    }, 700)
  }
  // Keep ref updated so auto-battle interval always calls fresh doAttack

  const doFlee = () => {
    if (!battleState) return
    const success = Math.random() < 0.6
    if (success) {
      clearActiveBattle()
      setBattleState(null); setRpgView('dashboard')
    } else {
      const eDmg = Math.max(1, battleState.monster.atk - (rpgChar?.def || 0))
      const newHp = Math.max(1, battleState.playerHp - eDmg)
      const newBs = { ...battleState, playerHp: newHp, log: [...battleState.log, { text: `🏃 Gagal kabur! ${battleState.monster.name} menyerang -${eDmg} HP`, type: 'dmg' as const }] }
      setBattleState(newBs)
      updateActiveBattle(newBs)
    }
  }

  const doHeal = () => {
    if (!battleState || !rpgChar) return
    const mpCost = 20
    if (battleState.playerMp < mpCost) {
      const newBs = { ...battleState, log: [...battleState.log, { text: `💙 MP tidak cukup untuk Heal! Butuh ${mpCost} MP.`, type: 'info' as const }] }
      setBattleState(newBs)
      return
    }
    const healAmt = Math.floor(rpgChar.maxHp * 0.25)
    const newHp = Math.min(rpgChar.maxHp, battleState.playerHp + healAmt)
    const newBs = {
      ...battleState, playerHp: newHp, playerMp: battleState.playerMp - mpCost,
      log: [...battleState.log, { text: `💚 Kamu memulihkan ${healAmt} HP [MP -${mpCost}]`, type: 'heal' as const }]
    }
    setBattleState(newBs)
    updateActiveBattle(newBs)
  }

  const endBattle = async () => {
    if (!rpgChar) return
    // Stop auto-battle
    setAutoBattle(false)
    autoBattleRef.current = false
    try {
      if (battleState) {
        await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), {
          hp: Math.max(1, battleState.playerHp),
          mp: battleState.playerMp
        })
      }
    } catch (e) { console.error('endBattle save error:', e) }
    clearActiveBattle()
    setBattleState(null)
    setRpgView('dashboard')
  }

  // ── RPG: Auto-Battle ──────────────────────────────────────────
  useEffect(() => { autoBattleRef.current = autoBattle }, [autoBattle])

  // Auto-battle: use refs to always read fresh battleState inside interval
  const battleStateRef = useRef<typeof battleState>(battleState)
  useEffect(() => { battleStateRef.current = battleState }, [battleState])

  // Store doAttack in a ref so interval always calls the latest version
  const doAttackRef = useRef<(type: 'normal'|'skill', idx?: number) => void>(() => {})
  doAttackRef.current = doAttack

  useEffect(() => {
    if (!autoBattle) return
    const interval = setInterval(() => {
      if (!autoBattleRef.current) return
      const bs = battleStateRef.current
      if (!bs || bs.phase !== 'player' || !!bs.result || bs.loading) return
      // Auto-use skill if MP available, else normal attack
      if (bs.playerMp >= 15) {
        doAttackRef.current('skill', 0)
      } else {
        doAttackRef.current('normal')
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [autoBattle])

  // Auto-restart battle after win (monitored inside the auto-battle interval above via ref)
  // Separate effect to catch win state and restart
  const autoWinHandled = useRef(false)
  useEffect(() => {
    if (!autoBattle || !battleState) { autoWinHandled.current = false; return }
    if (battleState.result === 'win' && !autoWinHandled.current) {
      autoWinHandled.current = true
      const char = rpgChar
      if (!char || battleState.playerHp <= 0) return
      setTimeout(async () => {
        if (!autoBattleRef.current) return
        await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user!.uid), {
          hp: Math.max(1, battleState.playerHp),
          mp: battleState.playerMp
        })
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
    let guaranteed = gachaData.guaranteed

    for (let i = 0; i < count; i++) {
      pity++
      let rarity: GachaRarity = '3★'
      const roll = Math.random() * 100
      if (pity >= PITY_HARD) { rarity = '5★'; pity = 0 }
      else if (pity >= PITY_SOFT) { if (roll < (5 + (pity - PITY_SOFT) * 5)) { rarity = '5★'; pity = 0 } else if (roll < 15) rarity = '4★' }
      else if (roll < 0.6) { rarity = '5★'; pity = 0 }
      else if (roll < 6.6) rarity = '4★'

      let pool: GachaChar[]
      if (rarity === '5★') {
        const featured = GACHA_CHARS.filter(c => GACHA_BANNER.featured.includes(c.id))
        if (guaranteed || Math.random() < 0.5) { pool = featured; guaranteed = false }
        else { pool = GACHA_CHARS.filter(c => c.rarity === '5★'); guaranteed = true }
      } else if (rarity === '4★') pool = GACHA_CHARS.filter(c => c.rarity === '4★')
      else pool = GACHA_CHARS.filter(c => c.rarity === '3★')

      // Avoid duplicates in same pull
      const picked = pool[Math.floor(Math.random() * pool.length)]
      results.push(picked)
    }

    const updates: Partial<PlayerGacha> = {
      pity,
      guaranteed,
      pulls: gachaData.pulls + count,
      roster: [...new Set([...gachaData.roster, ...results.map(r => r.id)])],
    }
    if (useTickets) updates.tickets = gachaData.tickets - ticketCost
    else updates.primogems = gachaData.primogems - cost

    await updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user.uid), updates)
    // Update local state supaya tiket/primogems langsung berkurang
    setGachaData(prev => prev ? { ...prev, ...updates } as PlayerGacha : prev)
    // Mark daily pull mission
    if (rpgChar) {
      const todayStr = new Date().toDateString()
      const dm = rpgChar.dailyMissions?.date === todayStr ? rpgChar.dailyMissions : { date: todayStr, completed: [], claimed: [] }
      if (!dm.completed.includes('dm_pull')) {
        await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { dailyMissions: { ...dm, completed: [...dm.completed, 'dm_pull'] } })
      }
    }
    setGachaAnim(true)
    setTimeout(() => { setGachaAnim(false); setGachaResult(results) }, 800)
  }

  // ── RPG: Shop ─────────────────────────────────────────────────
  const buyItem = async (item: typeof ITEMS_SHOP[0]) => {
    if (!rpgChar || rpgChar.gold < item.price) { setShopMsg('Gold tidak cukup!'); return }
    const updates: Partial<RpgChar> = { gold: rpgChar.gold - item.price }
    const efx = item.effect.split(',')
    efx.forEach(e => {
      const [k, v] = e.split('+')
      const val = parseInt(v)
      if (k === 'hp') updates.hp = Math.min(rpgChar.maxHp, rpgChar.hp + val)
      else if (k === 'mp') updates.mp = Math.min(rpgChar.maxMp, rpgChar.mp + val)
      else if (k === 'atk') updates.atk = rpgChar.atk + val
      else if (k === 'def') updates.def = rpgChar.def + val
      else if (k === 'spd') updates.spd = rpgChar.spd + val
      else if (k === 'luck') updates.luck = rpgChar.luck + val
      else if (k === 'maxHp') { updates.maxHp = rpgChar.maxHp + val; updates.hp = rpgChar.hp + val }
      else if (k === 'maxMp') { updates.maxMp = rpgChar.maxMp + val; updates.mp = rpgChar.mp + val }
    })
    if (!item.effect.includes('hp+') && !item.effect.includes('mp+')) {
      updates.inventory = [...(rpgChar.inventory || []), item.name].slice(-20)
    }
    await updateRpgChar(updates)
    setShopMsg(`✅ ${item.name} berhasil dibeli!`)
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
    const charHp = party.map(c => c.hp)
    setDungeonState({
      boss, bossHp: boss.hp, bossPhase: 1, frozenTurns: 0,
      superconduct: false, activeChars: party, charHp,
      currentChar: 0, energy: 0,
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
      await updateDoc(doc(getRpgDb(user!.uid), 'playerGacha', user!.uid), { primogems: (gachaData?.primogems || 0) + boss.primogems })
      setGachaData(prev => prev ? { ...prev, primogems: (prev.primogems || 0) + boss.primogems } : prev)
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
    if (now - lastMine < MINE_COOLDOWN_MS) {
      const rem = Math.ceil((MINE_COOLDOWN_MS - (now - lastMine)) / 60000)
      setMineMsg(`⏳ Tambang cooldown ${rem} menit lagi!`); return
    }
    const roll = Math.random() * 100
    let cum = 0; let ore = ORES[0]
    for (const o of ORES) { cum += o.chance; if (roll < cum) { ore = o; break } }
    const count = Math.floor(Math.random() * 3) + 1
    const newOres = { ...(rpgChar.ores || {}), [ore.id]: ((rpgChar.ores || {})[ore.id] || 0) + count }
    const newCooldowns = { ...(rpgChar.trainCooldowns || {}), mine: now }
    await updateRpgChar({ ores: newOres, trainCooldowns: newCooldowns })
    setMineMsg(`⛏️ Kamu mendapat ${count}x ${ore.emoji}${ore.name}!`)
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
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), {
      crops: [...crops, { type: cropId, plantedAt: Date.now(), slots: 1 }]
    })
    const crop = CROPS.find(c => c.id === cropId)!
    setFarmMsg(`🌱 ${crop.emoji}${crop.name} ditanam! Siap dalam ${Math.round(crop.growMs/60000)} menit.`)
    setTimeout(() => setFarmMsg(''), 3000)
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
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { crops, ores: newOres })
    setFarmMsg(`🌾 Panen ${count}x ${crop.emoji}${crop.name}! Tersimpan di material.`)
    setTimeout(() => setFarmMsg(''), 3000)
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
    // Find target by username in leaderboard
    const target = leaderboard.find(l => l.username.toLowerCase() === transferTarget.trim().toLowerCase())
    if (!target) { setTransferMsg('❌ Player tidak ditemukan! Cek leaderboard.'); return }
    if (target.uid === user.uid) { setTransferMsg('❌ Tidak bisa transfer ke diri sendiri!'); return }
    // Deduct from sender
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', user.uid), { gold: rpgChar.gold - amount })
    // Add to receiver
    await updateDoc(doc(getRpgDb(user!.uid), 'rpgChars', target.uid), { gold: (target.gold || 0) + amount }).catch(() => {})
    setTransferMsg(`✅ Berhasil transfer ${amount}G ke ${transferTarget}!`)
    setTransferTarget(''); setTransferAmount('')
    setTimeout(() => setTransferMsg(''), 4000)
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
    { id: 'rpg',    icon: '⚔️', label: 'rpg-arena',     category: 'GAME',    type: 'text' },
    { id: 'fishing',icon: '🎣', label: 'fishing-zone',  category: 'GAME',    type: 'text' },
    { id: 'gacha',  icon: '✨', label: 'gacha-pull',    category: 'GAME',    type: 'text' },
    { id: 'planet', icon: '🪐', label: 'planet-explore',category: 'GAME',    type: 'text' },
    { id: 'music',  icon: '🎵', label: 'music-room',    category: 'MEDIA',   type: 'voice' },
    { id: 'voice',  icon: '📞', label: 'voice-room',    category: 'MEDIA',   type: 'voice' },
    { id: 'anime',  icon: '🎌', label: 'anime-stream',  category: 'MEDIA',   type: 'text'  },
  ] as const

  type ChannelId = typeof CHANNELS[number]['id']

  const handleChannelClick = (id: ChannelId) => {
    if (id === 'rpg') { setActiveTab('rpg'); setActiveGachaTab('rpg'); fetchActiveBattles(); }
    else if (id === 'gacha') { setActiveTab('rpg'); setActiveGachaTab('gacha'); }
    else if (id === 'planet') { setActiveTab('rpg'); setActiveGachaTab('planet'); }
    else if (id === 'fishing') { setActiveTab('fishing' as any); }
    else if (id === 'voice') { setActiveTab('voice'); }
    else if (id === 'music') { setActiveTab('music'); }
    else if (id === 'anime') { setActiveTab('anime' as any); }
    else { setActiveTab('chat'); }
  }

  const getActiveChannelId = (): ChannelId => {
    if ((activeTab as string) === 'fishing') return 'fishing'
    if ((activeTab as string) === 'anime') return 'anime'
    if (activeTab === 'voice') return 'voice'
    if (activeTab === 'music') return 'music'
    if (activeTab === 'rpg') {
      if (activeGachaTab === 'gacha') return 'gacha'
      if (activeGachaTab === 'planet') return 'planet'
      return 'rpg'
    }
    return 'chat'
  }

  const categories = ['SOCIAL', 'GAME', 'MEDIA']

  return (
    <div className="gc-overlay" onClick={() => { if (battleState) clearActiveBattle(); onClose() }} style={{ zIndex: 9999, position:'fixed', inset:0, display:'flex', alignItems:'stretch', justifyContent:'stretch' }}>
      <div className="gc-container gc2-container zzz-discord-layout" onClick={e => e.stopPropagation()} style={{ position: 'relative', display: 'flex', flexDirection: 'row', padding: 0, overflow: 'hidden', width:'100vw', height:'100dvh', borderRadius:0, flex:1 }}>

        {/* ── ZZZ DISCORD SIDEBAR ── */}
        <div className={`zzz-sidebar${sidebarCollapsed ? ' zzz-sidebar-collapsed' : ''}`}>
          {/* Server header */}
          <div className="zzz-server-header">
            <div
              className="zzz-server-icon"
              onClick={sidebarCollapsed ? () => setSidebarCollapsed(false) : undefined}
              style={sidebarCollapsed ? {cursor:'pointer',boxShadow:'0 0 0 2px rgba(200,245,0,0.4)'} : undefined}
              title={sidebarCollapsed ? 'Buka sidebar' : undefined}
            >
              {groupInfo?.iconUrl
                ? <img src={groupInfo.iconUrl} alt="server" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'}}/>
                : <span style={{fontSize:18}}>⚡</span>}
            </div>
            {!sidebarCollapsed && (
              <div className="zzz-server-name">
                <div style={{fontSize:13,fontWeight:800,color:'#fff',letterSpacing:.5,lineHeight:1.2}}>{groupInfo?.name || 'KyokoMd'}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',letterSpacing:.3}}>{groupInfo?.members?.length||0} members</div>
              </div>
            )}
            {!sidebarCollapsed && (
              <button className="zzz-sidebar-toggle" onClick={() => setSidebarCollapsed(true)} title="Collapse">
                <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fillRule="evenodd" d="M12.707 4.293a1 1 0 0 1 0 1.414L8.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414l-5-5a1 1 0 0 1 0-1.414l5-5a1 1 0 0 1 1.414 0z" clipRule="evenodd"/></svg>
              </button>
            )}
          </div>

          {/* Channel categories */}
          <div className="zzz-channel-list">
            {categories.map(cat => (
              <div key={cat} className="zzz-category">
                {!sidebarCollapsed && <div className="zzz-category-label">{cat}</div>}
                {CHANNELS.filter(c => c.category === cat).map(ch => {
                  const isActive = getActiveChannelId() === ch.id
                  const isVoiceActive = ch.id === 'voice' && voiceCallActive
                  return (
                    <button
                      key={ch.id}
                      className={`zzz-channel-item${isActive ? ' active' : ''}${isVoiceActive ? ' voice-active' : ''}`}
                      onClick={() => handleChannelClick(ch.id as ChannelId)}
                      title={sidebarCollapsed ? ch.label : undefined}
                    >
                      <span className="zzz-channel-icon">{ch.icon}</span>
                      {!sidebarCollapsed && (
                        <>
                          <span className="zzz-channel-name">{ch.label}</span>
                          {ch.id === 'voice' && voiceCallActive && (
                            <span className="zzz-voice-badge">{Object.keys(voiceParticipants).length}</span>
                          )}
                          {ch.type === 'voice' && <span className="zzz-channel-type-badge">🔊</span>}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* User panel at bottom */}
          {step === 'main' && user && (
            <div className="zzz-user-panel">
              <div className="zzz-user-avatar" style={{background: avatarColor(user.uid)}}>
                {user.photoURL
                  ? <img src={user.photoURL} alt="" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                  : username[0]?.toUpperCase()}
                <span className="zzz-user-status-dot"/>
              </div>
              {!sidebarCollapsed && (
                <div className="zzz-user-info">
                  <div style={{fontSize:11,fontWeight:700,color:'#fff',lineHeight:1.2,maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{username}</div>
                  <div style={{fontSize:9,color:'rgba(200,245,0,0.7)'}}>● Online</div>
                </div>
              )}
              {!sidebarCollapsed && (
                <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
                  <button className="zzz-icon-btn" title="Logout" onClick={handleLogout}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fillRule="evenodd" d="M3 3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 1 0 0-2H4V5h7a1 1 0 1 0 0-2H3zm12.293 4.293a1 1 0 0 1 1.414 1.414L14.414 11H9a1 1 0 1 1 0-2h5.414l2.293-2.293z" clipRule="evenodd"/></svg>
                  </button>
                  <button className="zzz-icon-btn" title="Kembali" onClick={() => { if (battleState) clearActiveBattle(); onClose() }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414z" clipRule="evenodd"/></svg>
                  </button>
                </div>
              )}
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
        <div className="zzz-channel-header">
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
          <>
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
                  {messages.map((msg, i) => {
                    const isMe = msg.uid === user?.uid
                    const prev = messages[i-1]
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
              <div className="gc2-rpg-wrap">
                {loadingActive && (
                  <div className="gc2-loading-overlay">
                    <div className="gc2-loading-content">
                      <div className="gc2-loading-title">⚔️ Memproses...</div>
                      <div className="gc2-loading-bar-bg">
                        <div className="gc2-loading-bar-fill" style={{ width: `${loadingBar * 100}%` }}/>
                      </div>
                      <div className="gc2-loading-pct">{Math.round(loadingBar * 100)}%</div>
                    </div>
                  </div>
                )}

                {!rpgChar && rpgView !== 'create' && (
                  <div className="gc2-rpg-empty">
                    <div style={{fontSize:48}}>⚔️</div>
                    <h3 style={{margin:'12px 0 6px',color:'#c8f500',fontSize:18}}>Dunia RPG Menantimu!</h3>
                    <p style={{color:'rgba(255,255,255,0.5)',fontSize:13,marginBottom:20,textAlign:'center',lineHeight:1.5}}>
                      Pilih kelas dan elemen untuk memulai petualangan epik di komunitas KyokoMd.
                    </p>
                    <button className="gc2-rpg-btn primary" onClick={() => setRpgView('create')}>✨ Buat Karakter</button>
                  </div>
                )}

                {!rpgChar && rpgView === 'create' && <RpgCreate onCreate={createCharacter} loading={rpgLoading || loadingActive}/>}

                {rpgChar && rpgView === 'dashboard' && (
                  <RpgDashboard char={rpgChar} gachaData={gachaData}
                    onSellItem={sellInventoryItem}
                    onBattle={() => setRpgView('battle')}
                    onQuest={() => setRpgView('quest')}
                    onShop={() => setRpgView('shop')}
                    onLeaderboard={() => { setRpgView('leaderboard'); fetchLeaderboard(); }}
                    onClassChange={() => setShowClassChange(true)}
                    onDungeon={() => setRpgView('dungeon')}
                    onParty={() => setRpgView('party')}
                    onDaily={() => setRpgView('daily')}
                    onFishing={() => setActiveTab('fishing')}
                    onMining={() => setRpgView('mining')}
                    onCrafting={() => setRpgView('crafting')}
                    onFarming={() => setRpgView('farming')}
                    onCooking={() => setRpgView('cooking')}
                    onTraining={() => setRpgView('training')}
                    onDuel={() => { setRpgView('duel'); fetchLeaderboard(); }}
                    onWildQuest={() => setRpgView('wildquest')}
                    onInvest={() => setRpgView('invest')}
                    onWeaponUp={() => setRpgView('weaponup')}
                    onTransfer={() => { setRpgView('transfer'); fetchLeaderboard(); }}
                  />
                )}

                {rpgChar && rpgView === 'battle' && !battleState && (
                  <RpgMonsterSelect char={rpgChar} onSelect={startBattle} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'battle' && battleState && (
                  <RpgBattle
                    char={rpgChar} bs={battleState} anim={battleAnim}
                    onAttack={() => doAttack('normal')}
                    onSkill={(i) => doAttack('skill', i)}
                    onHeal={doHeal} onFlee={doFlee} onEnd={endBattle}
                    autoBattle={autoBattle} onToggleAuto={() => { setAutoBattle(v => !v); autoBattleRef.current = !autoBattleRef.current }}
                  />
                )}

                {rpgChar && rpgView === 'quest' && (
                  <RpgQuest char={rpgChar} msg={questMsg || questClaimMsg} onAccept={acceptQuest} onCancel={cancelQuest} onClaim={claimQuest} onBack={() => setRpgView('dashboard')}/>
                )}

                {rpgChar && rpgView === 'shop' && (
                  <RpgShop char={rpgChar} items={ITEMS_SHOP} msg={shopMsg} onBuy={buyItem} onBack={() => setRpgView('dashboard')}/>
                )}

                {rpgChar && showClassChange && (
                  <RpgClassChange char={rpgChar} cost={CLASS_CHANGE_COST} onChange={changeClass} onBack={() => setShowClassChange(false)}/>
                )}

                {rpgView === 'leaderboard' && (
                  <RpgLeaderboard data={leaderboard} onBack={() => setRpgView('dashboard')} onRefresh={() => fetchLeaderboard(true)}/>
                )}

                {rpgChar && rpgView === 'dungeon' && !dungeonState && (
                  <DungeonSelect char={rpgChar} gachaData={gachaData} onStart={startDungeon} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'dungeon' && dungeonState && (
                  <DungeonBattle char={rpgChar} ds={dungeonState}
                    onAttack={() => doDungeonAttack('normal')}
                    onSkill={() => doDungeonAttack('skill')}
                    onBurst={() => doDungeonAttack('burst')}
                    onSwitch={switchDungeonChar}
                    onEnd={endDungeon}
                  />
                )}

                {rpgChar && rpgView === 'party' && (
                  <PartyManager char={rpgChar} gachaData={gachaData} onSave={setParty} onBack={() => setRpgView('dashboard')}/>
                )}

                {rpgChar && rpgView === 'daily' && (
                  <DailyMissions char={rpgChar} gachaData={gachaData} onClaim={claimDailyMission} onBack={() => setRpgView('dashboard')}/>
                )}

                {rpgChar && rpgView === 'mining' && (
                  <RpgMining char={rpgChar} msg={mineMsg} onMine={doMine} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'crafting' && (
                  <RpgCrafting char={rpgChar} msg={craftMsg} onCraft={doCraft} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'farming' && (
                  <RpgFarming char={rpgChar} msg={farmMsg} onPlant={doPlant} onHarvest={doHarvest} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'cooking' && (
                  <RpgCooking char={rpgChar} msg={cookMsg} onCook={doCook} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'training' && (
                  <RpgTraining char={rpgChar} msg={trainMsg} onTrain={doTrain} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'duel' && (
                  <RpgDuel char={rpgChar} leaderboard={leaderboard} msg={duelMsg} loading={duelLoading} onDuel={doDuel} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'wildquest' && (
                  <RpgWildQuest char={rpgChar} quest={wildQuest} msg={wildQuestMsg} onRoll={rollWildQuest} onClaim={claimWildQuest} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'invest' && (
                  <RpgInvest char={rpgChar} msg={investMsg} input={investInput} onInput={setInvestInput} onInvest={doInvest} onClaim={claimInvestment} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'weaponup' && (
                  <RpgWeaponUpgrade char={rpgChar} msg={weaponMsg} onUpgrade={doWeaponUpgrade} onBack={() => setRpgView('dashboard')}/>
                )}
                {rpgChar && rpgView === 'transfer' && (
                  <RpgTransfer char={rpgChar} msg={transferMsg} target={transferTarget} amount={transferAmount} onTarget={setTransferTarget} onAmount={setTransferAmount} onTransfer={doTransfer} onBack={() => setRpgView('dashboard')} leaderboard={leaderboard}/>
                )}
              </div>
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
                  <GachaResultScreen results={gachaResult} onClose={() => setGachaResult(null)} roster={gachaData?.roster||[]}/>
                )}
                {!gachaResult && !gachaAnim && (
                  <>
                    {!gachaData && <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:200,color:'rgba(255,255,255,0.3)',fontSize:13}}>Memuat data gacha...</div>}
                    {gachaData && gachaView === 'home' && <GachaHome data={gachaData} onBanner={()=>setGachaView('banner')} onRoster={()=>setGachaView('roster')} onEvents={()=>setGachaView('events')} onPass={()=>setGachaView('pass')}/>}
                    {gachaData && gachaView === 'banner' && <GachaBanner data={gachaData} onPull={doGachaPull} onBack={()=>setGachaView('home')}/>}
                    {gachaData && gachaView === 'roster' && <GachaRoster data={gachaData} onBack={()=>setGachaView('home')}/>}
                    {gachaView === 'events' && <GachaEvents onBack={()=>setGachaView('home')}/>}
                    {gachaData && gachaView === 'pass' && <GachaPass data={gachaData} rpgChar={rpgChar} onBack={()=>setGachaView('home')} onBuyRequest={() => setShowBpBuyConfirm(true)} onClaimTier={claimBattlePassTier} bpClaimMsg={bpClaimMsg}/>}
                  </>
                )}
              </div>
            )}
          </>
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
                  onBack={() => { setActiveTab('rpg'); setFishingView('home') }}
                />
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
        .gc2-container { display:flex; flex-direction:column; height:620px; width:420px; max-width:100%; border-radius:20px; background:#0a0a0a; border:1px solid rgba(200,245,0,0.15); overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.04),inset 0 1px 0 rgba(200,245,0,0.08); }
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
        .gc2-sticker { max-width:120px; border-radius:12px; }
        @media(max-width:520px) { .gc2-container { width:100vw; height:100dvh; border-radius:0; } }

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
        @keyframes slideInLeft { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes zzzScan { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
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
        .gc-input-icon-btn { background:rgba(200,245,0,0.06); border:1px solid rgba(200,245,0,0.12); color:rgba(200,245,0,0.6); border-radius:8px; padding:6px 8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; flex-shrink:0; }
        .gc-input-icon-btn:hover { background:rgba(200,245,0,0.12); color:#c8f500; border-color:rgba(200,245,0,0.3); }

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
           ZZZ DISCORD LAYOUT — SIDEBAR + MAIN
        ══════════════════════════════════════════════════════════ */
        .zzz-discord-layout { display:flex !important; flex-direction:row !important; width:100vw; height:100dvh; max-width:100%; border-radius:0; overflow:hidden; border:none; box-shadow:none; }

        /* ── Sidebar ── */
        .zzz-sidebar { width:175px; min-width:175px; background:#0a0a0f; border-right:1px solid rgba(200,245,0,0.07); display:flex; flex-direction:column; flex-shrink:0; transition:width .25s cubic-bezier(.4,0,.2,1),min-width .25s; overflow:hidden; }
        .zzz-sidebar-collapsed { width:46px; min-width:46px; }

        .zzz-server-header { display:flex; align-items:center; gap:8px; padding:12px 10px 10px; border-bottom:1px solid rgba(200,245,0,0.08); flex-shrink:0; min-height:52px; }
        .zzz-server-icon { width:28px; height:28px; min-width:28px; border-radius:8px; background:linear-gradient(135deg,rgba(200,245,0,0.2),rgba(200,245,0,0.05)); border:1.5px solid rgba(200,245,0,0.3); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow:0 0 10px rgba(200,245,0,0.1); flex-shrink:0; }
        .zzz-server-name { flex:1; min-width:0; overflow:hidden; }
        .zzz-sidebar-toggle { background:none; border:none; cursor:pointer; color:rgba(255,255,255,0.3); padding:4px; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .2s; }
        .zzz-sidebar-toggle:hover { color:#c8f500; background:rgba(200,245,0,0.08); }

        .zzz-channel-list { flex:1; overflow-y:auto; padding:8px 0 4px; scrollbar-width:none; }
        .zzz-channel-list::-webkit-scrollbar { display:none; }
        .zzz-category { margin-bottom:4px; }
        .zzz-category-label { font-size:9px; font-weight:800; color:rgba(255,255,255,0.22); letter-spacing:1.2px; padding:6px 10px 3px; text-transform:uppercase; }
        .zzz-channel-item { display:flex; align-items:center; gap:7px; width:100%; padding:6px 8px; background:none; border:none; cursor:pointer; border-radius:6px; margin:1px 4px; width:calc(100% - 8px); transition:all .15s; color:rgba(255,255,255,0.38); text-align:left; }
        .zzz-channel-item:hover { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.7); }
        .zzz-channel-item.active { background:rgba(200,245,0,0.1); color:#c8f500; border-left:2px solid #c8f500; }
        .zzz-channel-item.voice-active { background:rgba(100,220,100,0.1); color:#4ade80; border-left:2px solid #4ade80; }
        .zzz-channel-icon { font-size:14px; flex-shrink:0; }
        .zzz-channel-name { font-size:11px; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:.1px; }
        .zzz-channel-type-badge { font-size:9px; opacity:.5; flex-shrink:0; }
        .zzz-voice-badge { background:#4ade80; color:#000; font-size:9px; font-weight:800; border-radius:10px; padding:1px 5px; flex-shrink:0; }

        /* ── User panel ── */
        .zzz-user-panel { display:flex; align-items:center; gap:7px; padding:8px 10px; border-top:1px solid rgba(200,245,0,0.07); background:#080810; flex-shrink:0; }
        .zzz-user-avatar { width:26px; height:26px; min-width:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; color:#000; position:relative; flex-shrink:0; }
        .zzz-user-status-dot { position:absolute; bottom:0; right:0; width:7px; height:7px; border-radius:50%; background:#4ade80; border:1.5px solid #080810; }
        .zzz-user-info { flex:1; min-width:0; overflow:hidden; }
        .zzz-icon-btn { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:6px; cursor:pointer; color:rgba(255,255,255,0.35); padding:4px 6px; display:flex; align-items:center; justify-content:center; transition:all .2s; }
        .zzz-icon-btn:hover { background:rgba(200,245,0,0.1); color:#c8f500; border-color:rgba(200,245,0,0.2); }

        /* ── Main content area ── */
        .zzz-main-content { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; background:#0d0d12; position:relative; }

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
function RpgMining({ char, msg, onMine, onBack }: { char: RpgChar; msg: string; onMine: () => void; onBack: () => void }) {
  const ores = char.ores || {}
  const [loading, setLoading] = React.useState(false)
  const [, forceUpdate] = React.useReducer(x => x + 1, 0)
  React.useEffect(() => {
    const iv = setInterval(forceUpdate, 1000)
    return () => clearInterval(iv)
  }, [])
  const lastMine = (char.trainCooldowns?.mine || 0)
  const coolRemain = Math.max(0, MINE_COOLDOWN_MS - (Date.now() - lastMine))
  const canMine = coolRemain === 0 && !loading
  const coolMin = Math.floor(coolRemain / 60000)
  const coolSec = Math.floor((coolRemain % 60000) / 1000)
  const coolLabel = coolRemain > 0 ? `⏳ ${coolMin}:${String(coolSec).padStart(2,'0')}` : '⛏️ Tambang Sekarang!'
  const handleMine = async () => {
    if (!canMine) return
    setLoading(true)
    try { await (onMine as any)() } finally { setLoading(false) }
  }
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4}, card:{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:12,marginBottom:8} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>⛏️ Tambang</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:12}}>Tambang ore setiap 10 menit. Gunakan untuk crafting & upgrade senjata.</p>
      {msg && <div style={{background:'rgba(200,245,0,0.1)',border:'1px solid rgba(200,245,0,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#c8f500',marginBottom:10}}>{msg}</div>}
      <button onClick={handleMine} disabled={!canMine} style={{width:'100%',background:canMine?'linear-gradient(135deg,#7c4b1e,#c8721e)':'rgba(255,255,255,0.05)',border:'1px solid rgba(200,120,30,0.4)',borderRadius:12,padding:'14px',cursor:canMine?'pointer':'not-allowed',color:canMine?'#fff':'rgba(255,255,255,0.3)',fontSize:14,fontWeight:800,marginBottom:12}}>
        {loading ? '⛏️ Menambang...' : coolLabel}
      </button>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>📦 MATERIAL KAMU</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:12}}>
        {ORES.map(o => (
          <div key={o.id} style={{...S.card,display:'flex',alignItems:'center',gap:8,padding:'8px 10px'}}>
            <span style={{fontSize:18}}>{o.emoji}</span>
            <div><div style={{fontSize:11,fontWeight:700}}>{o.name}</div><div style={{fontSize:13,color:'#c8f500',fontWeight:900}}>{ores[o.id] || 0}x</div></div>
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
  const now = Date.now()
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4}, card:{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:12,marginBottom:8} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>🌾 Kebun</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>Tanam & panen tanaman. Hasil kebun dipakai untuk memasak makanan berbuff.</p>
      {msg && <div style={{background:'rgba(60,180,60,0.1)',border:'1px solid rgba(60,180,60,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#30d158',marginBottom:10}}>{msg}</div>}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace'}}>🌱 LAHAN ({crops.length}/{FARM_SLOTS})</div>
      {crops.map((c,i)=>{
        const crop=CROPS.find(x=>x.id===c.type)!
        const elapsed=now-c.plantedAt; const done=elapsed>=crop.growMs
        const pct=Math.min(100,Math.round(elapsed/crop.growMs*100))
        return (
          <div key={i} style={{...S.card,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:28}}>{crop.emoji}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700}}>{crop.name}</div>
              <div style={{height:4,background:'rgba(255,255,255,0.1)',borderRadius:2,margin:'4px 0'}}><div style={{height:'100%',width:`${pct}%`,background:done?'#30d158':'#c8f500',borderRadius:2,transition:'width .5s'}}/></div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{done?'Siap dipanen!':(`${pct}% - ${Math.ceil((crop.growMs-elapsed)/60000)} mnt lagi`)}</div>
            </div>
            {done && <button onClick={()=>onHarvest(i)} style={{background:'rgba(60,180,60,0.2)',border:'1px solid rgba(60,180,60,0.4)',borderRadius:8,padding:'6px 10px',cursor:'pointer',color:'#30d158',fontSize:11,fontWeight:700}}>Panen</button>}
          </div>
        )
      })}
      {crops.length < FARM_SLOTS && (
        <>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8,fontFamily:'monospace',marginTop:8}}>🌱 TANAM BARU</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
            {CROPS.map(c=>(
              <button key={c.id} onClick={()=>onPlant(c.id)} style={{background:'rgba(60,180,60,0.1)',border:'1px solid rgba(60,180,60,0.25)',borderRadius:10,padding:'10px 8px',cursor:'pointer',textAlign:'left' as const,color:'#fff'}}>
                <div style={{fontSize:18}}>{c.emoji}</div>
                <div style={{fontSize:11,fontWeight:700,marginTop:2}}>{c.name}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{Math.round(c.growMs/60000)} mnt • jual {c.sellGold}G</div>
              </button>
            ))}
          </div>
        </>
      )}
      <div style={{marginTop:12,fontSize:11,color:'rgba(255,255,255,0.4)'}}>
        📦 Material kebun: {CROPS.map(c=>`${c.emoji}${(char.ores||{})[c.id]||0}x`).join(' ')}
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
  const now = Date.now()
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4} }
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>💪 Training</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:10}}>Habiskan Gold untuk meningkatkan stat permanen. Cooldown 1 jam per latihan.</p>
      {msg && <div style={{background:'rgba(100,150,255,0.1)',border:'1px solid rgba(100,150,255,0.3)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#818cf8',marginBottom:10}}>{msg}</div>}
      <div style={{fontSize:12,color:'#ffd700',marginBottom:10}}>💰 Gold: {char.gold.toLocaleString()}G</div>
      {TRAININGS.map(t=>{
        const last=(char.trainCooldowns||{})[t.id]||0
        const remain=Math.max(0,t.coolMs-(now-last))
        const ready=remain===0
        const curVal = t.stat==='maxHp'?char.maxHp:t.stat==='maxMp'?char.maxMp:(char as any)[t.stat]||0
        return (
          <div key={t.id} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${ready?'rgba(100,150,255,0.35)':'rgba(255,255,255,0.08)'}`,borderRadius:12,padding:12,marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:28}}>{t.emoji}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:800}}>{t.name}</div>
              <div style={{fontSize:10,color:'#818cf8'}}>{t.desc} • Biaya {t.cost}G</div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Saat ini: {curVal} {ready?'':'• ⏳ '+Math.ceil(remain/60000)+' mnt'}</div>
            </div>
            <button onClick={()=>onTrain(t)} disabled={!ready||char.gold<t.cost} style={{background:ready&&char.gold>=t.cost?'rgba(100,150,255,0.2)':'rgba(255,255,255,0.05)',border:`1px solid ${ready&&char.gold>=t.cost?'rgba(100,150,255,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:8,padding:'6px 10px',cursor:ready&&char.gold>=t.cost?'pointer':'not-allowed',color:ready&&char.gold>=t.cost?'#818cf8':'rgba(255,255,255,0.3)',fontSize:11,fontWeight:700}}>Latih</button>
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
function RpgTransfer({ char, msg, target, amount, onTarget, onAmount, onTransfer, onBack, leaderboard }: { char: RpgChar; msg: string; target: string; amount: string; onTarget: (v:string)=>void; onAmount: (v:string)=>void; onTransfer: () => void; onBack: () => void; leaderboard: {uid:string;username:string;gold?:number}[] }) {
  const [showDrop, setShowDrop] = useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const S = { wrap:{padding:'14px',overflowY:'auto' as const,height:'100%',boxSizing:'border-box' as const}, back:{background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginBottom:10,padding:0}, title:{fontSize:16,fontWeight:900,color:'#c8f500',marginBottom:4}, inp:{width:'100%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'9px 11px',color:'#fff',fontSize:12,boxSizing:'border-box' as const,marginBottom:0,outline:'none'} }
  const filtered = leaderboard.filter(l => l.username.toLowerCase() !== char.username?.toLowerCase() && l.username.toLowerCase().includes(target.toLowerCase())).slice(0, 8)
  return (
    <div style={S.wrap} className="gc2-fadein">
      <button style={S.back} onClick={onBack}>← Kembali</button>
      <div style={S.title}>💸 Transfer Gold</div>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:12}}>Kirim Gold ke player lain. Masukkan username mereka yang ada di leaderboard.</p>
      <div style={{background:'rgba(0,200,150,0.08)',border:'1px solid rgba(0,200,150,0.2)',borderRadius:12,padding:'10px 12px',marginBottom:12}}>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.6)'}}>Gold kamu</div>
        <div style={{fontSize:22,fontWeight:900,color:'#ffd700'}}>{char.gold.toLocaleString()} G</div>
      </div>
      {msg && <div style={{background:msg.startsWith('✅')?'rgba(0,200,150,0.1)':'rgba(255,50,50,0.1)',border:`1px solid ${msg.startsWith('✅')?'rgba(0,200,150,0.3)':'rgba(255,50,50,0.3)'}`,borderRadius:8,padding:'8px 12px',fontSize:12,color:msg.startsWith('✅')?'#34d399':'#ff6b6b',marginBottom:10}}>{msg}</div>}
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


function RpgCreate({ onCreate, loading }: { onCreate: (cls: RpgClass, elem: Element) => void; loading: boolean }) {
  const [selClass, setSelClass] = useState<RpgClass | null>(null)
  const [selElem, setSelElem] = useState<Element | null>(null)
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

  return (
    <div style={{ padding:'12px 14px', overflowY:'auto', height:'100%', boxSizing:'border-box', scrollbarWidth:'none' }} className="gc2-fadein">

      {/* ZZZ Character Card */}
      <div style={{ position:'relative', background:'linear-gradient(135deg,#0f0f1a,#1a0f1a)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:16, padding:14, marginBottom:10, overflow:'hidden' }}>
        {/* BG accent */}
        <div style={{ position:'absolute', top:-30, right:-30, width:120, height:120, borderRadius:'50%', background:`radial-gradient(circle,${ELEMENT_EMOJI[char.element]==='🔥'?'rgba(255,100,0,0.15)':char.element==='Water'?'rgba(0,100,255,0.15)':'rgba(200,245,0,0.1)'} 0%,transparent 70%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:'linear-gradient(90deg,transparent,rgba(255,55,95,0.5),transparent)' }}/>

        {/* Header row */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
          <div style={{ width:52, height:52, borderRadius:12, background:'linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))', border:'1px solid rgba(255,255,255,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, flexShrink:0, boxShadow:'0 4px 16px rgba(0,0,0,0.4)' }}>
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
            <div style={{ height:'100%', width:`${hpPct}%`, background:`linear-gradient(90deg,${hpColor},${hpColor}aa)`, transition:'width .5s', borderRadius:4, boxShadow:`0 0 8px ${hpColor}66` }}/>
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
            <div style={{ height:'100%', width:`${mpPct}%`, background:'linear-gradient(90deg,#007aff,#5ac8fa)', transition:'width .5s', borderRadius:4, boxShadow:'0 0 6px rgba(90,200,250,0.4)' }}/>
          </div>
        </div>

        {/* EXP Bar */}
        <div style={{ marginBottom:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.3)', marginBottom:3, fontFamily:'monospace' }}>
            <span>EXP</span><span>{current}/{needed}</span>
          </div>
          <div style={{ background:'rgba(255,255,255,0.05)', borderRadius:3, overflow:'hidden', height:4 }}>
            <div style={{ height:'100%', width:`${(current/needed)*100}%`, background:'linear-gradient(90deg,#f5ff00,#00e5ff)', borderRadius:3 }}/>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {[['ATK',char.atk,'#ff375f'],['DEF',char.def,'#5ac8fa'],['SPD',char.spd,'#ffd60a'],['LCK',char.luck,'#30d158']].map(([l,v,c])=>(
            <div key={String(l)} style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:'5px 4px', textAlign:'center' }}>
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
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, marginBottom:7 }}>
        <button onClick={onBattle} style={{ gridColumn:'span 2', background:'linear-gradient(135deg,#ff375f22,#ff375f0a)', border:'1px solid rgba(255,55,95,0.4)', borderRadius:12, padding:'12px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:10, transition:'all .18s', color:'#fff', animation:'btnPulse 2s infinite' }}
          onMouseOver={e=>{e.currentTarget.style.background='linear-gradient(135deg,rgba(255,55,95,0.2),rgba(255,55,95,0.05)'}}
          onMouseOut={e=>{e.currentTarget.style.background='linear-gradient(135deg,#ff375f22,#ff375f0a)'}}>
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
          <button key={i} onClick={b.onClick} style={{ background:b.color, border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'10px 12px', cursor:'pointer', textAlign:'left', color:'#fff', transition:'all .15s', animation: b.label.includes('🎁') ? 'btnPulse 1.5s infinite' : 'none' }}
            onMouseOver={e=>{e.currentTarget.style.opacity='0.8'}} onMouseOut={e=>{e.currentTarget.style.opacity='1'}}>
            <div style={{ fontSize:12, fontWeight:800 }}>{b.label}</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', marginTop:1 }}>{b.sub}</div>
          </button>
        ))}
      </div>

      <button onClick={onClassChange} style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(245,255,0,0.2)', borderRadius:10, padding:'9px 14px', cursor:'pointer', color:'#f5ff00', fontSize:12, fontWeight:700, letterSpacing:.3 }}>
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


function RpgBattle({ char, bs, anim, onAttack, onSkill, onHeal, onFlee, onEnd, autoBattle, onToggleAuto }: {
  char: RpgChar; bs: any; anim: string
  onAttack: () => void; onSkill: (i: number) => void; onHeal: () => void; onFlee: () => void; onEnd: () => void
  autoBattle?: boolean; onToggleAuto?: () => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [bs.log])

  const pHpPct = Math.max(0, (bs.playerHp / char.maxHp) * 100)
  const mHpPct = Math.max(0, (bs.monsterHp / bs.monster.hp) * 100)
  const isPlayerTurn = bs.phase === 'player' && !bs.result
  const isResult = !!bs.result
  const rankColor: Record<string,string> = { F:'#9ca3af',E:'#6ee7b7',D:'#60a5fa',C:'#a78bfa',B:'#f472b6',A:'#fb923c',S:'#fbbf24',SS:'#f9a8d4' }
  const hpColor = pHpPct > 60 ? '#30d158' : pHpPct > 30 ? '#ffd60a' : '#ff375f'

  // Sword tilt: player-atk → tilt right, enemy-atk → tilt left
  const swordStyle: React.CSSProperties = {
    fontSize: 28,
    transition: 'transform .35s cubic-bezier(.34,1.56,.64,1), filter .35s',
    transform: anim === 'player-atk' ? 'rotate(40deg) scale(1.25)' : anim === 'enemy-atk' ? 'rotate(-40deg) scale(1.25)' : 'rotate(0deg) scale(1)',
    filter: anim === 'player-atk' ? 'drop-shadow(0 0 8px #ffd60a)' : anim === 'enemy-atk' ? 'drop-shadow(0 0 8px #ff375f)' : 'drop-shadow(0 0 4px rgba(255,255,255,0.2))',
    display: 'inline-block',
    userSelect: 'none',
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#0a0a0f', position:'relative', overflow:'hidden' }} className="gc2-fadein">
      {/* Scanline BG */}
      <div style={{ position:'absolute', inset:0, backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.012) 2px,rgba(255,255,255,0.012) 4px)', pointerEvents:'none', zIndex:0 }}/>

      {/* Header bar */}
      <div style={{ background:'linear-gradient(135deg,rgba(255,55,95,0.15),rgba(10,10,20,0.9))', borderBottom:'1px solid rgba(255,55,95,0.2)', padding:'8px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'relative', zIndex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontFamily:'monospace', fontSize:10, color:'rgba(255,55,95,0.8)', letterSpacing:2, fontWeight:700 }}>COMBAT</span>
          <span style={{ background:'rgba(255,55,95,0.15)', border:'1px solid rgba(255,55,95,0.3)', color: rankColor[bs.monster.rank] || '#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:3 }}>
            {bs.monster.rank}
          </span>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {/* Kembali always available */}
          <button onClick={onEnd} style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.7)', borderRadius:6, padding:'3px 10px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
            ← Kembali
          </button>
          <button onClick={onToggleAuto} style={{
            background: autoBattle ? 'rgba(255,214,0,0.15)' : 'rgba(255,255,255,0.06)',
            border: autoBattle ? '1px solid rgba(255,214,0,0.5)' : '1px solid rgba(255,255,255,0.12)',
            color: autoBattle ? '#ffd600' : 'rgba(255,255,255,0.4)',
            borderRadius:6, padding:'3px 10px', fontSize:11, fontWeight:700, cursor:'pointer',
            animation: autoBattle ? 'autoPulse 1.5s ease-in-out infinite' : 'none',
            transition:'all .2s'
          }}>
            {autoBattle ? '⚡ AUTO ON' : '⚡ AUTO OFF'}
          </button>
        </div>
      </div>

      {/* ── ARENA: side-by-side bars with sword center ── */}
      <div style={{ padding:'12px 14px 8px', position:'relative', zIndex:1, flex:'0 0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {/* Player side */}
          <div style={{ flex:1 }}>
            <div className={anim === 'player-atk' ? 'battle-anim-player' : ''} style={{ fontSize:32, textAlign:'center', marginBottom:4, filter:`drop-shadow(0 0 10px rgba(0,122,255,0.5))` }}>
              {RPG_CLASSES[char.class].emoji}
            </div>
            <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.7)', textAlign:'center', marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{char.username}</div>
            {/* HP bar */}
            <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:4, overflow:'hidden', height:8, marginBottom:2 }}>
              <div style={{ height:'100%', width:`${pHpPct}%`, background:`linear-gradient(90deg,${hpColor},${hpColor}99)`, transition:'width .5s', borderRadius:4 }}/>
            </div>
            {/* MP bar */}
            <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:4, overflow:'hidden', height:5, marginBottom:2 }}>
              <div style={{ height:'100%', width:`${(bs.playerMp/char.maxMp)*100}%`, background:'linear-gradient(90deg,#007aff,#5ac8fa)', transition:'width .5s', borderRadius:4 }}/>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, fontFamily:'monospace' }}>
              <span style={{ color:hpColor }}>❤️ {bs.playerHp}</span>
              <span style={{ color:'#5ac8fa' }}>💙 {bs.playerMp}</span>
            </div>
          </div>

          {/* Center sword icon */}
          <div style={{ flexShrink:0, width:44, textAlign:'center' }}>
            <div style={swordStyle}>⚔️</div>
            <div style={{ fontSize:8, color:'rgba(255,255,255,0.2)', fontFamily:'monospace', marginTop:2, letterSpacing:1 }}>VS</div>
          </div>

          {/* Monster side */}
          <div style={{ flex:1 }}>
            <div className={anim === 'enemy-atk' ? 'battle-anim-enemy' : ''} style={{ fontSize:32, textAlign:'center', marginBottom:4, filter:'drop-shadow(0 0 12px rgba(255,55,95,0.6))' }}>
              {bs.monster.emoji}
            </div>
            <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.7)', textAlign:'center', marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{bs.monster.name}</div>
            {/* Monster HP bar */}
            <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:4, overflow:'hidden', height:8, marginBottom:2 }}>
              <div style={{ height:'100%', width:`${mHpPct}%`, background:'linear-gradient(90deg,#ff375f,#ff9f0a)', transition:'width .5s', borderRadius:4, boxShadow:'0 0 6px rgba(255,55,95,0.5)' }}/>
            </div>
            <div style={{ height:5, marginBottom:2 }}/>
            <div style={{ display:'flex', justifyContent:'flex-end', fontSize:9, fontFamily:'monospace' }}>
              <span style={{ color:'rgba(255,100,100,0.8)' }}>❤️ {bs.monsterHp}/{bs.monster.hp}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Battle log */}
      <div ref={logRef} style={{ flex:'1 1 0', overflowY:'auto', margin:'0 14px 8px', background:'rgba(0,0,0,0.5)', borderRadius:8, padding:'8px 10px', fontSize:11, border:'1px solid rgba(255,255,255,0.06)', position:'relative', zIndex:1, scrollbarWidth:'none' }}>
        {bs.log.map((l: any, i: number) => (
          <div key={i} style={{ color: l.type==='dmg'?'#ff6b6b':l.type==='heal'?'#30d158':l.type==='skill'?'#ffd60a':'rgba(255,255,255,0.45)', marginBottom:3, fontFamily:'monospace', fontSize:11, animation:'fadeInUp .2s ease' }}>
            {l.text}
          </div>
        ))}
        {bs.phase === 'enemy' && !bs.result && (
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'rgba(255,100,100,0.6)', marginTop:4 }}>
            <span className="gc-spinner-sm"/>
            <span style={{ fontFamily:'monospace', fontSize:10 }}>Enemy turn...</span>
          </div>
        )}
        {autoBattle && isPlayerTurn && (
          <div style={{ display:'flex', alignItems:'center', gap:6, color:'rgba(255,214,0,0.7)', marginTop:4 }}>
            <span className="gc-spinner-sm"/>
            <span style={{ fontFamily:'monospace', fontSize:10 }}>Auto attacking...</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {isPlayerTurn && !autoBattle && (
        <div style={{ padding:'0 14px 14px', display:'flex', flexDirection:'column', gap:6, position:'relative', zIndex:1 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            <button className="zzz-btn zzz-btn-attack" onClick={onAttack} disabled={bs.loading}>
              <span style={{ fontSize:16 }}>⚔️</span> Serang
            </button>
            <button className="zzz-btn zzz-btn-heal" onClick={onHeal} disabled={bs.loading || bs.playerMp < 20} style={{ opacity: bs.playerMp < 20 ? 0.45 : 1 }}>
              <span style={{ fontSize:16 }}>💚</span> Heal
            </button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {char.skills.slice(0, 4).map((s, i) => {
              const mpCost = 15 + i * 5
              const noMp = bs.playerMp < mpCost
              return (
                <button key={i} className="zzz-btn zzz-btn-skill" onClick={() => onSkill(i)} disabled={bs.loading} style={{ opacity: noMp ? 0.4 : 1, fontSize:11 }}>
                  ✨ {s} <span style={{ fontSize:9, opacity:.6 }}>-{mpCost}MP</span>
                </button>
              )
            })}
          </div>
          <button className="zzz-btn zzz-btn-flee" onClick={onFlee} disabled={bs.loading}>🏃 Kabur</button>
        </div>
      )}

      {isPlayerTurn && autoBattle && (
        <div style={{ padding:'0 14px 14px', position:'relative', zIndex:1 }}>
          <button className="zzz-btn zzz-btn-flee" onClick={onFlee}>🛑 Stop & Kabur</button>
        </div>
      )}

      {/* Result panel - always shows Kembali */}
      {isResult && (
        <div style={{ padding:'0 14px 14px', position:'relative', zIndex:1, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:6, animation:'popIn .4s cubic-bezier(.34,1.56,.64,1)' }}>{bs.result === 'win' ? '🏆' : '💀'}</div>
          <div style={{ fontSize:16, fontWeight:900, letterSpacing:2, marginBottom:10, color: bs.result === 'win' ? '#ffd60a' : '#ff375f', textShadow: bs.result === 'win' ? '0 0 20px rgba(255,214,0,0.6)' : '0 0 20px rgba(255,55,95,0.6)' }}>
            {bs.result === 'win' ? 'VICTORY' : 'DEFEATED'}
          </div>
          {autoBattle && bs.result === 'win' && (
            <div style={{ fontSize:11, color:'rgba(255,214,0,0.6)', fontFamily:'monospace', marginBottom:8 }}>⚡ Restarting auto-battle...</div>
          )}
          <button className="zzz-btn zzz-btn-attack" onClick={onEnd} style={{ width:'100%' }}>← Kembali</button>
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
  return (
    <div style={{ padding: 16 }} className="gc2-fadein">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding: '6px 12px', fontSize: 12 }}>← Kembali</button>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>🛒 Toko</span>
        </div>
        <div style={{ fontSize: 13, color: '#ffd700', fontWeight: 700 }}>💰 {char.gold}</div>
      </div>
      {msg && <div style={{ background: msg.startsWith('✅') ? 'rgba(80,200,80,0.1)' : 'rgba(255,80,80,0.1)', border: `1px solid ${msg.startsWith('✅') ? 'rgba(80,200,80,0.2)' : 'rgba(255,80,80,0.2)'}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: msg.startsWith('✅') ? '#80ff80' : '#ff8080', marginBottom: 10 }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => (
          <div key={item.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{item.emoji}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{item.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{item.desc}</div>
            </div>
            <button className="gc2-rpg-btn primary" onClick={() => onBuy(item)}
              disabled={char.gold < item.price}
              style={{ fontSize: 11, padding: '5px 10px', flexShrink: 0 }}>
              💰{item.price}
            </button>
          </div>
        ))}
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

function DungeonBattle({ char, ds, onAttack, onSkill, onBurst, onSwitch, onEnd }: {
  char: RpgChar
  ds: { boss: DungeonBoss; bossHp: number; bossPhase: 1|2; frozenTurns: number; superconduct: boolean
        activeChars: GachaChar[]; charHp: number[]; currentChar: number; energy: number
        log: {text:string;type:string}[]; result?: 'win'|'lose'; phase: string }
  onAttack: () => void; onSkill: () => void; onBurst: () => void
  onSwitch: (idx: number) => void; onEnd: () => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [ds.log])

  const boss = ds.boss
  const char_ = ds.activeChars[ds.currentChar]
  const bossHpPct = (ds.bossHp / boss.hp) * 100
  const charHpPct = char_ ? (ds.charHp[ds.currentChar] / char_.hp) * 100 : 0
  const energyPct = ds.energy
  const isPlayerTurn = ds.phase === 'player' && !ds.result
  const rankColor = { Normal:'#80ff80', Elite:'#ffd700', Weekly:'#ff9d00', Archon:'#ff4444' }[boss.rank]

  return (
    <div style={{ padding:12, display:'flex', flexDirection:'column', gap:8, height:'100%', boxSizing:'border-box', overflowY:'auto' }} className="gc2-fadein">
      {/* Boss bar */}
      <div style={{ background:'linear-gradient(135deg,rgba(255,50,50,0.08),rgba(100,0,0,0.05))', border:'1px solid rgba(255,80,80,0.15)', borderRadius:12, padding:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:22 }}>{boss.emoji}</span>
            <div>
              <span style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{boss.name}</span>
              {ds.bossPhase === 2 && <span style={{ fontSize:9, color:'#ff4444', marginLeft:6, fontWeight:800 }}>PHASE 2!</span>}
              {ds.frozenTurns > 0 && <span style={{ fontSize:9, color:'#98d8ea', marginLeft:4 }}>❄️FROZEN</span>}
            </div>
          </div>
          <span style={{ fontSize:9, background:`${rankColor}22`, color:rankColor, borderRadius:4, padding:'1px 6px', fontWeight:800 }}>{boss.rank}</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:3 }}>
          <span>❤️ HP</span><span>{ds.bossHp}/{boss.hp}</span>
        </div>
        <div className="gc2-bar-wrap">
          <div className="gc2-bar-fill gc2-hp-fill" style={{ width:`${bossHpPct}%`, background: ds.bossPhase===2 ? 'linear-gradient(90deg,#ff4444,#ff0000)' : undefined }}/>
        </div>
        {ds.superconduct && <div style={{ fontSize:9, color:'#c86eff', marginTop:3 }}>⚡ Superconduct: DEF -40%</div>}
      </div>

      {/* Party chars */}
      <div style={{ display:'flex', gap:6 }}>
        {ds.activeChars.map((c, i) => {
          const alive = ds.charHp[i] > 0
          const isActive = i === ds.currentChar
          return (
            <button key={c.id} onClick={() => !isActive && alive && onSwitch(i)} style={{
              flex:1, background: isActive ? 'rgba(200,245,0,0.1)' : alive ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.3)',
              border:`1px solid ${isActive ? '#c8f500' : alive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}`,
              borderRadius:10, padding:'6px 4px', cursor: alive && !isActive ? 'pointer' : 'default',
              opacity: alive ? 1 : 0.4, textAlign:'center'
            }}>
              <div style={{ fontSize:16 }}>{c.emoji}</div>
              <div style={{ fontSize:9, color: GACHA_ELEM_COLOR[c.element], fontWeight:700, marginBottom:2 }}>{c.name.split(' ')[0]}</div>
              <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:3, overflow:'hidden', height:4 }}>
                <div style={{ height:'100%', background:'linear-gradient(90deg,#4ade80,#22c55e)', width:`${(ds.charHp[i]/c.hp)*100}%`}}/>
              </div>
              <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', marginTop:1 }}>{alive ? ds.charHp[i] : 'KO'}</div>
            </button>
          )
        })}
      </div>

      {/* Active char info + energy */}
      {char_ && (
        <div style={{ background:'rgba(200,245,0,0.05)', border:'1px solid rgba(200,245,0,0.1)', borderRadius:8, padding:'6px 10px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
            <span style={{ fontSize:12, color:'#c8f500', fontWeight:700 }}>{char_.emoji} {char_.name} · <span style={{ color: GACHA_ELEM_COLOR[char_.element] }}>{char_.element}</span></span>
            <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>Skill: {char_.skill}</span>
          </div>
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            <span style={{ fontSize:9, color:'rgba(255,255,255,0.4)' }}>⚡Energy</span>
            <div style={{ flex:1, background:'rgba(255,255,255,0.08)', borderRadius:3, overflow:'hidden', height:5 }}>
              <div style={{ height:'100%', background:'linear-gradient(90deg,#a064ff,#ffd700)', width:`${energyPct}%`, transition:'width .3s' }}/>
            </div>
            <span style={{ fontSize:9, color: energyPct >= 100 ? '#ffd700' : 'rgba(255,255,255,0.3)', fontWeight: energyPct>=100?800:400 }}>{energyPct}/100 {energyPct>=100?'✨':''}</span>
          </div>
        </div>
      )}

      {/* Battle log */}
      <div ref={logRef} style={{ background:'rgba(0,0,0,0.4)', borderRadius:8, padding:8, height:80, overflowY:'auto', fontSize:11 }}>
        {ds.log.map((l, i) => (
          <div key={i} style={{
            color: l.type==='dmg'?'#ff9090':l.type==='heal'?'#80ff80':l.type==='skill'?'#c8f500':l.type==='reaction'?'#ffd700':'rgba(255,255,255,0.5)',
            marginBottom:2, lineHeight:1.4
          }}>{l.text}</div>
        ))}
      </div>

      {/* Actions */}
      {isPlayerTurn && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
          <button className="gc2-rpg-btn primary" onClick={onAttack} style={{ fontSize:11 }}>⚔️ Attack</button>
          <button className="gc2-rpg-btn secondary" onClick={onSkill} style={{ fontSize:11 }}>✨ {char_?.skill || 'Skill'}</button>
          <button className="gc2-rpg-btn secondary" onClick={onBurst} style={{
            fontSize:10, opacity: ds.energy >= 100 ? 1 : 0.4,
            background: ds.energy >= 100 ? 'rgba(160,100,255,0.2)' : undefined,
            border: ds.energy >= 100 ? '1px solid rgba(160,100,255,0.5)' : undefined,
            color: ds.energy >= 100 ? '#ffd700' : 'rgba(255,255,255,0.4)',
            animation: ds.energy >= 100 ? 'btnPulse 1.5s infinite' : 'none'
          }}>
            {ds.energy >= 100 ? '💥' : '⚡'} Burst
          </button>
        </div>
      )}
      {ds.phase === 'enemy' && !ds.result && (
        <div style={{ textAlign:'center', color:'rgba(255,255,255,0.4)', fontSize:12, padding:8 }}>
          <span className="gc-spinner-sm" style={{ marginRight:8 }}/>Boss menyerang...
        </div>
      )}
      {ds.result && (
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:6 }}>{ds.result==='win'?'🏆':'💀'}</div>
          <div style={{ fontSize:15, fontWeight:800, color:ds.result==='win'?'#c8f500':'#ff8080', marginBottom:10 }}>
            {ds.result==='win'?'DUNGEON CLEAR!':'DUNGEON GAGAL!'}
          </div>
          {ds.result==='win' && <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginBottom:10 }}>
            +{boss.exp} EXP · +{boss.gold} Gold · +{boss.primogems}💎 · 🎁 {boss.dropItem}
          </div>}
          <button className="gc2-rpg-btn primary" onClick={onEnd}>← Kembali</button>
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
  const [filter, setFilter] = useState<GachaRarity|'Semua'>('Semua')
  const filtered = filter === 'Semua' ? owned : owned.filter(c => c.rarity === filter)

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
        {(['Semua','5★','4★','3★'] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)} style={{
            background: filter===r ? '#c8f500' : 'rgba(255,255,255,0.06)', border:'none',
            color: filter===r ? '#000' : 'rgba(255,255,255,0.6)', borderRadius:6,
            padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer'
          }}>{r}</button>
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
          const rarityColor = c.rarity==='5★' ? '#ffd700' : c.rarity==='4★' ? '#c86eff' : '#aaa'
          return (
            <button key={c.id} onClick={() => toggle(c.id)} style={{
              background: isSel ? 'rgba(200,245,0,0.1)' : 'rgba(255,255,255,0.04)',
              border:`1px solid ${isSel ? '#c8f500' : 'rgba(255,255,255,0.08)'}`,
              borderRadius:12, padding:'10px 10px', cursor:'pointer', textAlign:'left', transition:'all .2s'
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                <span style={{ fontSize:22 }}>{c.emoji}</span>
                <span style={{ fontSize:9, fontWeight:800, color:rarityColor }}>{c.rarity}</span>
              </div>
              <div style={{ fontSize:12, fontWeight:800, color: isSel ? '#c8f500' : '#fff', marginBottom:2 }}>{c.name}</div>
              <div style={{ fontSize:10, color: GACHA_ELEM_COLOR[c.element] }}>{c.element} · {c.weapon}</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginTop:3 }}>⚔️{c.atk} 🛡️{c.def} ❤️{c.hp}</div>
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
  Electro:'#c86eff', Dendro:'#7cbb4a', Cryo:'#98d8ea', Spectro:'#ffd700', Havoc:'#9b59b6'
}

function GachaHome({ data, onBanner, onRoster, onEvents, onPass }: {
  data: PlayerGacha; onBanner:()=>void; onRoster:()=>void; onEvents:()=>void; onPass:()=>void
}) {
  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      {/* Header */}
      <div style={{ textAlign:'center', marginBottom:20 }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', letterSpacing:3, textTransform:'uppercase', marginBottom:4 }}>Genshin × WuWa</div>
        <div style={{ fontSize:22, fontWeight:900, color:'#ffd700', letterSpacing:1, textShadow:'0 0 20px rgba(255,215,0,0.5)' }}>✨ WISH WORLD</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:4 }}>Kumpulkan karakter legendary</div>
      </div>

      {/* Currency bar */}
      <div style={{ background:'rgba(255,215,0,0.06)', border:'1px solid rgba(255,215,0,0.15)', borderRadius:12, padding:'10px 14px', marginBottom:16, display:'flex', justifyContent:'space-around' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>💎 Primogems</div>
          <div style={{ fontSize:16, fontWeight:800, color:'#00e5ff' }}>{data.primogems.toLocaleString()}</div>
        </div>
        <div style={{ width:1, background:'rgba(255,255,255,0.08)' }}/>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>🎫 Tiket</div>
          <div style={{ fontSize:16, fontWeight:800, color:'#ffd700' }}>{data.tickets}</div>
        </div>
        <div style={{ width:1, background:'rgba(255,255,255,0.08)' }}/>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>🎰 Total Pull</div>
          <div style={{ fontSize:16, fontWeight:800, color:'#c8f500' }}>{data.pulls}</div>
        </div>
      </div>

      {/* Pity tracker */}
      <div style={{ background:'rgba(160,100,255,0.07)', border:'1px solid rgba(160,100,255,0.2)', borderRadius:10, padding:'8px 12px', marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:11 }}>
          <span style={{ color:'rgba(255,255,255,0.5)' }}>⭐ Pity Counter</span>
          <span style={{ color:'#a064ff', fontWeight:700 }}>{data.pity}/{PITY_HARD}</span>
        </div>
        <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:4, overflow:'hidden', height:6 }}>
          <div style={{ height:'100%', borderRadius:4, background:'linear-gradient(90deg,#a064ff,#ffd700)', width:`${(data.pity/PITY_HARD)*100}%`, transition:'width .4s' }}/>
        </div>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:4 }}>
          {data.pity >= PITY_SOFT ? '⚡ Soft pity aktif! 5★ lebih mungkin!' : `${PITY_SOFT - data.pity} pull lagi untuk soft pity`}
          {data.guaranteed && ' · 🔒 Guaranteed 5★ featured!'}
        </div>
      </div>

      {/* Menu grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {[
          { label:'🌟 Gacha Banner', sub:'Pull karakter baru', color:'#ffd700', bg:'rgba(255,215,0,0.08)', onClick: onBanner },
          { label:'👥 Koleksi', sub:`${data.roster.length} karakter dimiliki`, color:'#00e5ff', bg:'rgba(0,229,255,0.07)', onClick: onRoster },
          { label:'📅 Event', sub:'Reward spesial aktif', color:'#c8f500', bg:'rgba(200,245,0,0.07)', onClick: onEvents },
          { label:'🎖️ Battle Pass', sub:'Hadiah harian & mingguan', color:'#ff9d00', bg:'rgba(255,157,0,0.07)', onClick: onPass },
        ].map(m => (
          <button key={m.label} onClick={m.onClick} style={{
            background: m.bg, border:`1px solid ${m.color}25`,
            borderRadius:14, padding:'14px 12px', cursor:'pointer', textAlign:'left',
            transition:'all .2s'
          }}>
            <div style={{ fontSize:15, fontWeight:800, color:m.color, marginBottom:4 }}>{m.label}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{m.sub}</div>
          </button>
        ))}
      </div>

      {/* Roster preview */}
      {data.roster.length > 0 && (
        <div style={{ marginTop:16 }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:8, fontWeight:700 }}>👥 KARAKTER TERBARU</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {data.roster.slice(-8).map(id => {
              const c = GACHA_CHARS.find(g => g.id === id)
              if (!c) return null
              const col = ELEMENT_COLOR[c.element]
              return (
                <div key={id} style={{ background:`${col}15`, border:`1px solid ${col}40`, borderRadius:8, padding:'4px 8px', fontSize:12, color:col, fontWeight:700 }}>
                  {c.emoji} {c.name}
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

  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#ffd700', fontWeight:800, fontSize:15 }}>✨ {GACHA_BANNER.name}</span>
      </div>

      {/* Banner card */}
      <div style={{ background:'linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,100,0,0.08))', border:'1px solid rgba(255,215,0,0.25)', borderRadius:16, padding:16, marginBottom:14 }}>
        <div style={{ fontSize:11, color:'rgba(255,215,0,0.7)', fontWeight:700, letterSpacing:1, textTransform:'uppercase', marginBottom:8 }}>⬆️ Rate Up Characters</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {featured.map(c => (
            <div key={c.id} style={{ background:`${ELEMENT_COLOR[c.element]}15`, border:`1px solid ${ELEMENT_COLOR[c.element]}40`, borderRadius:10, padding:'8px 10px', flex:1, minWidth:80 }}>
              <div style={{ fontSize:20 }}>{c.emoji}</div>
              <div style={{ fontSize:12, fontWeight:700, color:'#fff', marginTop:2 }}>{c.name}</div>
              <div style={{ fontSize:10, color:'#ffd700' }}>{c.rarity} · {c.element}</div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginTop:2 }}>{c.weapon}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop:10, fontSize:11, color:'rgba(255,255,255,0.4)', lineHeight:1.6 }}>
          🎯 Rate 5★: 0.6% (Soft pity: pull ke-{PITY_SOFT})<br/>
          🔒 Hard pity: pull ke-{PITY_HARD} pasti 5★<br/>
          💡 50/50: Rate-up vs standard 5★{data.guaranteed && ' · 🔒 Guaranteed aktif!'}
        </div>
      </div>

      {/* Pull buttons */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <button className="gc2-rpg-btn primary" onClick={() => onPull(1)} disabled={!canPull1} style={{ flex:1, flexDirection:'column', gap:2, padding:'10px 8px', animation: canPull1 ? 'btnPulse 2s infinite' : 'none' }}>
          <div>🎫 × 1 Pull</div>
          <div style={{ fontSize:10, opacity:0.7 }}>{hasTicket ? '1 Tiket' : `${cost1} 💎`}</div>
        </button>
        <button className="gc2-rpg-btn primary" onClick={() => onPull(10)} disabled={!canPull10} style={{ flex:1, flexDirection:'column', gap:2, padding:'10px 8px', background:'linear-gradient(135deg,#c8f500,#00e5ff)', color:'#000' }}>
          <div>🎫 × 10 Pull</div>
          <div style={{ fontSize:10, opacity:0.7 }}>{data.tickets>=10 ? '10 Tiket' : `${cost10} 💎`}</div>
        </button>
      </div>

      {/* Currency */}
      <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'8px 12px', display:'flex', gap:16, fontSize:12 }}>
        <span>💎 {data.primogems.toLocaleString()}</span>
        <span>🎫 {data.tickets} Tiket</span>
        <span style={{ color:'#a064ff' }}>Pity: {data.pity}/{PITY_HARD}</span>
      </div>

      {/* All chars preview */}
      <div style={{ marginTop:14 }}>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', fontWeight:700, marginBottom:8 }}>📋 Semua Karakter di Pool</div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {(['5★','4★','3★'] as GachaRarity[]).map(r => {
            const pool = GACHA_CHARS.filter(c => c.rarity === r)
            return (
              <div key={r} style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center' }}>
                <span style={{ fontSize:11, fontWeight:700, color: r==='5★'?'#ffd700':r==='4★'?'#c878ff':'rgba(255,255,255,0.4)', minWidth:28 }}>{r}</span>
                {pool.map(c => (
                  <span key={c.id} style={{ fontSize:10, background:data.roster.includes(c.id)?`${ELEMENT_COLOR[c.element]}20`:'rgba(255,255,255,0.05)', border:data.roster.includes(c.id)?`1px solid ${ELEMENT_COLOR[c.element]}50`:'none', borderRadius:4, padding:'2px 6px', color: data.roster.includes(c.id)?ELEMENT_COLOR[c.element]:'rgba(255,255,255,0.5)' }}>
                    {c.emoji}{c.name}
                  </span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GachaResultScreen({ results, onClose, roster }: { results: GachaChar[]; onClose:()=>void; roster:string[] }) {
  const [revealed, setRevealed] = useState(0)
  const hasFiveStar = results.some(c => c.rarity === '5★')

  useEffect(() => {
    if (results.length === 1) { setRevealed(1); return }
    const timer = setInterval(() => {
      setRevealed(prev => { if (prev >= results.length) { clearInterval(timer); return prev } return prev + 1 })
    }, 180)
    return () => clearInterval(timer)
  }, [results])

  return (
    <div style={{ position:'absolute', inset:0, background: hasFiveStar ? 'linear-gradient(180deg,#1a0a00,#0a0015)' : '#0a0a0a', zIndex:30, display:'flex', flexDirection:'column', padding:16 }} className="gc2-fadein">
      {hasFiveStar && (
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at center, rgba(255,215,0,0.12) 0%, transparent 70%)', pointerEvents:'none' }}/>
      )}
      <div style={{ textAlign:'center', marginBottom:14 }}>
        <div style={{ fontSize:18, fontWeight:900, color: hasFiveStar?'#ffd700':'#fff' }}>
          {hasFiveStar ? '🌟 LUAR BIASA!' : results.some(c=>c.rarity==='4★') ? '✨ Bagus!' : '🎫 Hasil Gacha'}
        </div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{results.length}x Pull</div>
      </div>

      <div style={{ flex:1, display:'grid', gridTemplateColumns: results.length === 1 ? '1fr' : 'repeat(2,1fr)', gap:8, overflowY:'auto' }}>
        {results.map((c, i) => {
          const isNew = !roster.includes(c.id)
          const col = ELEMENT_COLOR[c.element]
          const starClass = c.rarity === '5★' ? 'gacha-5star' : c.rarity === '4★' ? 'gacha-4star' : 'gacha-3star'
          return (
            <div key={i} className={starClass} style={{
              animationDelay: `${i * 0.1}s`,
              background: `linear-gradient(135deg,${col}20,${col}08)`,
              border: `1.5px solid ${c.rarity==='5★'?'#ffd700':c.rarity==='4★'?'#c878ff':col}40`,
              borderRadius:14, padding: results.length===1 ? '24px 16px' : '10px 10px',
              textAlign:'center', position:'relative', overflow:'hidden',
              opacity: i < revealed ? 1 : 0, transition:'opacity .2s'
            }}>
              {isNew && (
                <div style={{ position:'absolute', top:6, right:6, background:'#c8f500', color:'#000', fontSize:8, fontWeight:800, borderRadius:4, padding:'1px 4px' }}>NEW!</div>
              )}
              <div style={{ fontSize: results.length===1 ? 48 : 28 }}>{c.emoji}</div>
              <div style={{ fontSize: results.length===1 ? 16:12, fontWeight:800, color:'#fff', margin:'4px 0 2px' }}>{c.name}</div>
              <div style={{ fontSize:10, color: c.rarity==='5★'?'#ffd700':c.rarity==='4★'?'#c878ff':'rgba(255,255,255,0.5)', fontWeight:700 }}>{c.rarity}</div>
              <div style={{ fontSize:10, color: col, marginTop:2 }}>{c.element} · {c.weapon}</div>
              {results.length === 1 && (
                <div style={{ marginTop:10, fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.5 }}>
                  {c.desc}<br/>
                  <span style={{color:col}}>Skill: {c.skill}</span><br/>
                  <span style={{color:'#ffd700'}}>Burst: {c.burst}</span>
                </div>
              )}
              {!isNew && <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginTop:2 }}>Sudah dimiliki</div>}
            </div>
          )
        })}
      </div>

      <button className="gc2-rpg-btn primary" onClick={onClose} style={{ marginTop:12, width:'100%' }}>✅ Selesai</button>
    </div>
  )
}

function GachaRoster({ data, onBack }: { data: PlayerGacha; onBack:()=>void }) {
  const [filter, setFilter] = useState<GachaRarity|'Semua'>('Semua')
  const owned = GACHA_CHARS.filter(c => data.roster.includes(c.id))
  const filtered = filter === 'Semua' ? owned : owned.filter(c => c.rarity === filter)

  return (
    <div style={{ padding:16 }} className="gc2-fadein">
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <button className="gc2-rpg-btn secondary" onClick={onBack} style={{ padding:'6px 12px', fontSize:12 }}>← Kembali</button>
        <span style={{ color:'#fff', fontWeight:800, fontSize:15 }}>👥 Koleksi Karakter</span>
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        {(['Semua','5★','4★','3★'] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)} style={{
            background: filter===r ? '#c8f500':'rgba(255,255,255,0.06)', border:'none',
            color: filter===r ? '#000':'rgba(255,255,255,0.6)', borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer'
          }}>{r}</button>
        ))}
        <span style={{ marginLeft:'auto', fontSize:11, color:'rgba(255,255,255,0.4)', alignSelf:'center' }}>{owned.length}/{GACHA_CHARS.length}</span>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {filtered.map(c => {
          const col = ELEMENT_COLOR[c.element]
          return (
            <div key={c.id} style={{
              background:`${col}10`, border:`1px solid ${col}30`,
              borderRadius:12, padding:'10px 12px',
              animation: c.rarity==='5★' ? 'star5Glow 3s ease-in-out infinite' : c.rarity==='4★' ? 'star4Glow 3s ease-in-out infinite' : 'none'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <div style={{ fontSize:28 }}>{c.emoji}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#fff' }}>{c.name}</div>
                  <div style={{ fontSize:10, color: c.rarity==='5★'?'#ffd700':c.rarity==='4★'?'#c878ff':'rgba(255,255,255,0.4)' }}>{c.rarity}</div>
                </div>
              </div>
              <div style={{ fontSize:10, color:col, marginBottom:4 }}>{c.element} · {c.weapon}</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {[['⚔️',c.atk],['🛡️',c.def],['❤️',c.hp],['💨',c.spd]].map(([e,v]) => (
                  <span key={String(e)} style={{fontSize:9, color:'rgba(255,255,255,0.5)'}}>{e}{v}</span>
                ))}
              </div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginTop:4, lineHeight:1.4 }}>
                ✨ {c.skill} · 🌀 {c.burst}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn:'span 2', textAlign:'center', color:'rgba(255,255,255,0.3)', fontSize:13, padding:24 }}>
            Belum ada karakter {filter !== 'Semua' ? filter : ''} — yuk gacha!
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
  onGoldChange, onBack,
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

