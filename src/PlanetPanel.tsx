// ═══════════════════════════════════════════════════════════════
//   🌌 PLANET BUILDER — HSR EDITION (Web React + Firebase)
//   Standalone module, import ke GlobalChatPanel.tsx
//   Tab baru: 'planet' di samping chat | rpg | gacha | fishing
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { db } from './firebase'
import {
  doc, setDoc, getDoc, onSnapshot, collection, getDocs,
  updateDoc, query, where, orderBy, limit, serverTimestamp
} from 'firebase/firestore'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
export interface PlanetData {
  uid: string
  username: string
  name: string
  population: number
  stability: number
  defense: number
  tier: number            // 1-5
  resources: { dust: number; spore: number; core: number; anti: number }
  regions: PlanetRegion[]
  inventory: Record<string, number>
  alliance?: string | null
  lastMining: number
  lastHunt: number
  lastExplore: number
  lastWeather: number
  lastSpy: number
  lastInvade: number
  currentWeather: string
  weatherMsg: string
  planetXp: number        // untuk tier-up
  shieldActive: boolean   // aktif kalau offline >30 menit
  lastSeen: number        // timestamp terakhir online
  totalInvadeWins: number
  totalInvadeLosses: number
  createdAt: number
}

interface PlanetRegion {
  name: string
  hp: number
  buildings: string[]
}

// ═══════════════════════════════════════════════════════════════
// DATA CONSTANTS
// ═══════════════════════════════════════════════════════════════
const HSR_PLANET_NAMES = [
  'Jarilo-VI','Xianzhou Luofu','Penacony','Amphoreus','Belobog',
  'Luofu Outer Ring','Scalegorge','Fyxestroll','Herta Station',
  'IPC Nexus','Stellaron Core','Abyss Reach','Reverie Drift',
  'Astral Hollow','Voidrift Basin','Mara Expanse','Silvermane Frontier',
  'Elenium Shelf','Vulkan Ridge','Arakhnid Depths'
]

const WEATHERS = [
  { n:'Stellar Calm',   emoji:'☀️', m:'Langit tenang. Populasi tumbuh perlahan.',       pop:8,   stability:2,  xp:5  },
  { n:'Mana Surge',     emoji:'✨', m:'Gelombang Mana! Populasi melonjak drastis.',      pop:40,  stability:-5, xp:15 },
  { n:'Grand Order',    emoji:'⚔️', m:'Era Keemasan! Stabilitas & Populasi meningkat.',  pop:30,  stability:10, xp:20 },
  { n:'Stellar Wind',   emoji:'🌪️', m:'Badai Bintang. Populasi berkurang.',              pop:-15, stability:-3, xp:3  },
  { n:'Lostbelt Fog',   emoji:'🌫️', m:'Kabut Lostbelt menyelimuti. Pertumbuhan berhenti.', pop:0, stability:-8, xp:0  },
  { n:'Void Storm',     emoji:'🌀', m:'Badai Void! Kehancuran melanda planet.',          pop:-30, stability:-15,xp:0  },
  { n:'Stellaron Rain', emoji:'☄️', m:'Hujan Stellaron! Sumber daya berlimpah.',         pop:10,  stability:5,  xp:12 },
  { n:'Harmony Tide',   emoji:'🌊', m:'Gelombang Harmoni. Semua sektor stabil.',         pop:20,  stability:15, xp:18 },
  { n:'Aurora Veil',    emoji:'🌌', m:'Cahaya aurora menyelimuti. Eksplorasi berhasil +bonus.', pop:5, stability:8, xp:25 },
]

export const PLANET_BUILDINGS: Record<string, {
  name:string; emoji:string; cost:{[k:string]:number}
  defense:number; desc:string; effect?:string
}> = {
  barracks:   { name:'Barracks',       emoji:'🏯', cost:{dust:30,core:10},        defense:20, desc:'Tambah pertahanan planet' },
  shield_gen: { name:'Shield Gen',     emoji:'🔰', cost:{dust:50,core:25},        defense:40, desc:'Generator perisai energi' },
  cannon:     { name:'Orbital Cannon', emoji:'💥', cost:{core:20,anti:2},         defense:60, desc:'Meriam orbital jarak jauh' },
  farm:       { name:'Bio-Farm',       emoji:'🌾', cost:{spore:20,dust:15},       defense:0,  desc:'Kapasitas populasi +1000', effect:'pop_cap+1000' },
  lab:        { name:'Research Lab',   emoji:'🔬', cost:{core:30,anti:1},         defense:0,  desc:'Hasil mining +50%', effect:'mining_bonus' },
  market:     { name:'Stellar Market', emoji:'🏪', cost:{dust:40,gold:500000},    defense:0,  desc:'Harga jual resource +20%', effect:'sell_bonus' },
  oracle:     { name:'Oracle Tower',   emoji:'🔭', cost:{core:15,spore:20},       defense:5,  desc:'Bisa spy planet lain', effect:'spy_enabled' },
  starport:   { name:'Starport',       emoji:'🚀', cost:{core:40,anti:2},         defense:0,  desc:'Buka trade antar player', effect:'trade_enabled' },
}

const CRAFTABLE: Record<string, {
  name:string; emoji:string; cost:{[k:string]:number}; effect:string; desc:string
}> = {
  stabilizer: { name:'Stabilizer',  emoji:'🛡️', cost:{dust:20,spore:10},  effect:'stability+30', desc:'Pulihkan stabilitas +30%' },
  growth_pod:  { name:'Growth Pod',  emoji:'🌱', cost:{spore:25,core:5},   effect:'pop+200',      desc:'Tambah populasi +200' },
  anti_bomb:   { name:'Anti Bomb',   emoji:'💣', cost:{anti:3,core:15},    effect:'atk_bonus',    desc:'Bonus serangan invasi +40%' },
  void_shield: { name:'Void Shield', emoji:'🌑', cost:{anti:2,dust:30},    effect:'def_bonus',    desc:'Kurangi damage invasi -40%' },
  terra_core:  { name:'Terra Core',  emoji:'🌍', cost:{core:50,anti:5},    effect:'xp+500',       desc:'Boost XP planet +500' },
  warp_drive:  { name:'Warp Drive',  emoji:'⚡', cost:{anti:8,core:30},    effect:'invade_cooldown_half', desc:'Cooldown invasi jadi 50%' },
}

const SELL_PRICE: Record<string, number> = {
  dust:2000, spore:3500, core:8000, anti:50000,
}

const TIER_XP = [0, 500, 1500, 3500, 7000, 12000]
const TIER_NAMES = ['Barren','Inhabited','Developed','Advanced','Stellar','Cosmic']
const TIER_COLORS = ['#888','#4fc3f7','#c8f500','#ff9a3c','#ff375f','#a855f7']

const PLANET_XP_PER_ACTION: Record<string, number> = {
  mining:5, hunt:6, explore:12, build:30, craft:10, sell:3, invade_win:80, defend_win:50,
}

// NPC Raid events (terjadi random tiap beberapa jam)
const NPC_RAID_MSGS = [
  '☄️ Void Fleet menyerang galaksi! Semua planet kehilangan 5% populasi!',
  '🌀 Gelombang Stellaron menghantam! Stabilitas turun -10% untuk semua planet!',
  '👾 Invasi Interlopers! Resource tercemar, pertambangan terganggu 1 jam!',
]

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function newPlanet(uid: string, username: string, name: string): PlanetData {
  return {
    uid, username, name,
    population: 1000, stability: 100, defense: 0, tier: 1,
    resources: { dust:0, spore:0, core:0, anti:0 },
    regions: [{ name:'Central Singularity', hp:100, buildings:[] }],
    inventory: {}, alliance: null,
    lastMining:0, lastHunt:0, lastExplore:0, lastWeather:0, lastSpy:0, lastInvade:0,
    currentWeather:'Stellar Calm', weatherMsg:'☀️ Langit tenang. Populasi tumbuh perlahan.',
    planetXp:0, shieldActive:false, lastSeen:Date.now(),
    totalInvadeWins:0, totalInvadeLosses:0, createdAt:Date.now(),
  }
}

function calcTotalDefense(p: PlanetData): number {
  let def = p.defense || 0
  p.regions.forEach(r => {
    ;(r.buildings || []).forEach(b => {
      if (PLANET_BUILDINGS[b]) def += PLANET_BUILDINGS[b].defense || 0
    })
  })
  return def
}

function hasBuildingEffect(p: PlanetData, effect: string): boolean {
  return p.regions.some(r => (r.buildings||[]).some(b => PLANET_BUILDINGS[b]?.effect === effect))
}

function getMaxPop(p: PlanetData): number {
  let base = p.regions.length * 10000
  p.regions.forEach(r => {
    ;(r.buildings||[]).forEach(b => {
      if (PLANET_BUILDINGS[b]?.effect === 'pop_cap+1000') base += 1000
    })
  })
  return base
}

function getTierProgress(p: PlanetData): number {
  if (p.tier >= 5) return 1
  const start = TIER_XP[p.tier - 1] || 0
  const end = TIER_XP[p.tier] || 1
  return Math.min(1, (p.planetXp - start) / (end - start))
}

function clockStr(ms: number): string {
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${m}m ${s}s`
}

function isShielded(p: PlanetData): boolean {
  return Date.now() - p.lastSeen > 30 * 60 * 1000
}

// ═══════════════════════════════════════════════════════════════
// CSS STYLES
// ═══════════════════════════════════════════════════════════════
const PLANET_CSS = `
/* ─── Planet Panel Base ─── */
.planet-wrap {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  background: #050510; color: #fff; position: relative;
  font-family: 'Noto Sans JP', system-ui, sans-serif;
}
.planet-wrap::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse 80% 60% at 50% -20%, rgba(88,28,255,0.18) 0%, transparent 70%),
              radial-gradient(ellipse 60% 40% at 80% 80%, rgba(255,55,95,0.08) 0%, transparent 60%);
}
.planet-wrap > * { position: relative; z-index: 1; }

/* ─── Star field ─── */
.planet-stars {
  position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0;
}
.planet-star {
  position: absolute; border-radius: 50%; background: rgba(255,255,255,0.7);
  animation: planet-twinkle var(--dur, 3s) ease-in-out infinite var(--delay, 0s);
}
@keyframes planet-twinkle {
  0%,100%{opacity:0.15;transform:scale(1)} 50%{opacity:0.9;transform:scale(1.5)}
}

/* ─── Header ─── */
.planet-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid rgba(138,43,226,0.3);
  background: rgba(5,5,16,0.9); backdrop-filter: blur(8px);
  flex-shrink: 0;
}
.planet-header-back {
  background: rgba(255,255,255,0.06); border: none; color: rgba(255,255,255,0.6);
  border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer;
  transition: all .2s;
}
.planet-header-back:hover { background: rgba(255,255,255,0.12); color:#fff; }
.planet-header-title {
  flex: 1; font-size: 14px; font-weight: 800; color: #fff;
  letter-spacing: .5px; text-shadow: 0 0 20px rgba(138,43,226,0.5);
}

/* ─── Scrollable Body ─── */
.planet-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.planet-body::-webkit-scrollbar { width: 3px; }
.planet-body::-webkit-scrollbar-thumb { background: rgba(138,43,226,0.4); border-radius: 3px; }

/* ─── Cards ─── */
.planet-card {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(138,43,226,0.2);
  border-radius: 14px; padding: 14px; backdrop-filter: blur(4px);
  animation: planet-fadein .3s ease;
}
.planet-card-title {
  font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.45);
  text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px;
}
@keyframes planet-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

/* ─── Planet Name Display ─── */
.planet-name-badge {
  display: inline-flex; align-items: center; gap: 8px;
  background: linear-gradient(135deg, rgba(138,43,226,0.25), rgba(255,55,95,0.15));
  border: 1px solid rgba(138,43,226,0.4); border-radius: 12px;
  padding: 8px 14px; margin-bottom: 8px;
}
.planet-name-text { font-size: 18px; font-weight: 900; color: #fff; letter-spacing: .5px; }
.planet-tier-badge {
  font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px;
  border: 1px solid currentColor;
}

/* ─── Stat Bars ─── */
.planet-stat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.planet-stat-label { font-size: 11px; color: rgba(255,255,255,0.5); width: 80px; flex-shrink: 0; }
.planet-stat-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
.planet-stat-bar-fill { height: 100%; border-radius: 3px; transition: width .5s ease; }
.planet-stat-val { font-size: 11px; font-weight: 700; width: 50px; text-align: right; flex-shrink: 0; }

/* ─── Resource Grid ─── */
.planet-res-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.planet-res-item {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; padding: 10px; text-align: center;
}
.planet-res-val { font-size: 16px; font-weight: 900; color: #fff; }
.planet-res-name { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; }

/* ─── Action Buttons ─── */
.planet-action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.planet-action-btn {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(138,43,226,0.25);
  border-radius: 12px; padding: 12px 8px; cursor: pointer; color: #fff;
  font-size: 12px; font-weight: 700; text-align: center;
  transition: all .2s; display: flex; flex-direction: column; align-items: center; gap: 4px;
  position: relative; overflow: hidden;
}
.planet-action-btn::before {
  content:''; position:absolute; inset:0; opacity:0;
  background: linear-gradient(135deg, rgba(138,43,226,0.2), rgba(255,55,95,0.1));
  transition: opacity .2s;
}
.planet-action-btn:hover::before, .planet-action-btn:active::before { opacity:1; }
.planet-action-btn:active { transform: scale(0.97); }
.planet-action-btn .p-btn-emoji { font-size: 22px; }
.planet-action-btn .p-btn-label { font-size: 11px; font-weight: 800; }
.planet-action-btn .p-btn-sub { font-size: 9px; color: rgba(255,255,255,0.4); }
.planet-action-btn.p-btn-danger { border-color: rgba(255,55,95,0.35); }
.planet-action-btn.p-btn-primary { border-color: rgba(200,245,0,0.35); }
.planet-action-btn:disabled, .planet-action-btn.p-btn-cd { opacity: 0.45; cursor: not-allowed; }
.planet-action-btn.p-btn-cd::before { opacity:0!important; }

/* ─── Cooldown badge ─── */
.planet-cd-badge {
  position: absolute; top: 4px; right: 6px;
  font-size: 9px; color: #ff9a3c; font-weight: 700;
}

/* ─── Planet List Items ─── */
.planet-list-item {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(138,43,226,0.2);
  border-radius: 12px; padding: 12px; cursor: pointer;
  transition: all .2s; display: flex; align-items: center; gap: 12px;
}
.planet-list-item:hover { border-color: rgba(138,43,226,0.5); background: rgba(138,43,226,0.08); }
.planet-list-item.shielded { border-color: rgba(79,195,247,0.3); }
.planet-list-globe { font-size: 32px; flex-shrink: 0; }
.planet-list-info { flex: 1; min-width: 0; }
.planet-list-name { font-size: 13px; font-weight: 800; color: #fff; }
.planet-list-meta { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; }
.planet-list-stats { display: flex; gap: 8px; margin-top: 4px; }
.planet-list-stat { font-size: 10px; }
.planet-shield-badge {
  font-size: 9px; background: rgba(79,195,247,0.15); color: #4fc3f7;
  border: 1px solid rgba(79,195,247,0.3); border-radius: 999px; padding: 2px 8px;
}
.planet-attack-btn {
  background: rgba(255,55,95,0.15); border: 1px solid rgba(255,55,95,0.4);
  color: #ff375f; border-radius: 8px; padding: 6px 12px; font-size: 11px;
  font-weight: 800; cursor: pointer; transition: all .2s; flex-shrink: 0;
  white-space: nowrap;
}
.planet-attack-btn:hover { background: rgba(255,55,95,0.3); }
.planet-attack-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* ─── Weather Banner ─── */
.planet-weather-banner {
  border-radius: 12px; padding: 10px 14px;
  background: linear-gradient(135deg, rgba(138,43,226,0.15), rgba(255,55,95,0.08));
  border: 1px solid rgba(138,43,226,0.3);
  display: flex; align-items: center; gap: 10px;
}
.planet-weather-emoji { font-size: 28px; flex-shrink: 0; }
.planet-weather-name { font-size: 12px; font-weight: 800; color: #c8f500; }
.planet-weather-msg { font-size: 11px; color: rgba(255,255,255,0.5); }

/* ─── Region Cards ─── */
.planet-region-card {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(138,43,226,0.2);
  border-radius: 12px; padding: 10px; margin-bottom: 8px;
}
.planet-region-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.planet-region-name { font-size: 13px; font-weight: 800; color: #fff; }
.planet-region-hp { font-size: 10px; color: rgba(255,255,255,0.4); margin-left: auto; }
.planet-region-hp-bar { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
.planet-region-hp-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg,#4fc3f7,#c8f500); transition: width .4s; }
.planet-region-buildings { display: flex; flex-wrap: wrap; gap: 4px; }
.planet-building-chip {
  font-size: 10px; padding: 3px 8px; border-radius: 999px;
  background: rgba(138,43,226,0.15); border: 1px solid rgba(138,43,226,0.3);
  color: rgba(255,255,255,0.7);
}

/* ─── Message Toast ─── */
.planet-toast {
  background: rgba(138,43,226,0.2); border: 1px solid rgba(138,43,226,0.4);
  border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #fff;
  animation: planet-fadein .3s ease; line-height: 1.5;
}
.planet-toast.success { background: rgba(0,200,80,0.15); border-color: rgba(0,200,80,0.4); color: #4dff91; }
.planet-toast.danger { background: rgba(255,55,95,0.15); border-color: rgba(255,55,95,0.4); color: #ff6b8a; }
.planet-toast.warning { background: rgba(255,154,60,0.15); border-color: rgba(255,154,60,0.4); color: #ffb347; }

/* ─── Tier Progress ─── */
.planet-tier-bar-wrap { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow:hidden; }
.planet-tier-bar-fill { height:100%; border-radius:3px; background: linear-gradient(90deg,#8b5cf6,#ff375f); transition:width .6s ease; }

/* ─── Leaderboard ─── */
.planet-lb-item {
  display: flex; align-items: center; gap: 10px; padding: 10px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(138,43,226,0.15);
  border-radius: 10px; margin-bottom: 6px;
}
.planet-lb-rank { font-size: 18px; width: 28px; text-align: center; flex-shrink:0; }
.planet-lb-name { font-size: 13px; font-weight: 800; color:#fff; }
.planet-lb-meta { font-size: 10px; color: rgba(255,255,255,0.4); }
.planet-lb-score { margin-left:auto; font-size:12px; font-weight:800; color:#c8f500; }

/* ─── Create Planet ─── */
.planet-create-wrap { display:flex; flex-direction:column; align-items:center; padding:24px 16px; gap:16px; }
.planet-create-globe { font-size:64px; animation:planet-float 3s ease-in-out infinite; }
@keyframes planet-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
.planet-create-title { font-size:20px; font-weight:900; color:#fff; text-align:center; }
.planet-create-sub { font-size:12px; color:rgba(255,255,255,0.5); text-align:center; line-height:1.6; }
.planet-create-input {
  width:100%; max-width:280px; background:rgba(255,255,255,0.06); border:1px solid rgba(138,43,226,0.4);
  border-radius:10px; padding:12px 14px; color:#fff; font-size:14px; font-weight:700;
  outline:none; transition:border-color .2s;
}
.planet-create-input:focus { border-color: rgba(138,43,226,0.8); }
.planet-create-btn {
  background: linear-gradient(135deg,#8b5cf6,#ff375f); border:none; border-radius:12px;
  padding:14px 32px; color:#fff; font-size:14px; font-weight:800; cursor:pointer;
  transition:all .2s; width:100%; max-width:280px;
}
.planet-create-btn:hover { filter:brightness(1.1); transform:scale(1.02); }
.planet-create-btn:disabled { opacity:.5; cursor:not-allowed; }
.planet-name-random-btn {
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);
  border-radius:8px; padding:8px 16px; color:rgba(255,255,255,0.7); font-size:11px;
  cursor:pointer; transition:all .2s;
}
.planet-name-random-btn:hover { background:rgba(255,255,255,0.1); color:#fff; }

/* ─── Invasion Result ─── */
.planet-invasion-result {
  border-radius:14px; padding:16px; text-align:center;
  animation: planet-fadein .4s ease;
}
.planet-invasion-result.win {
  background: rgba(0,200,80,0.1); border:1px solid rgba(0,200,80,0.3);
}
.planet-invasion-result.lose {
  background: rgba(255,55,95,0.1); border:1px solid rgba(255,55,95,0.3);
}
.planet-inv-emoji { font-size:48px; margin-bottom:8px; }
.planet-inv-title { font-size:18px; font-weight:900; margin-bottom:8px; }
.planet-inv-detail { font-size:12px; color:rgba(255,255,255,0.6); line-height:1.7; }

/* ─── Input Field ─── */
.planet-input {
  width:100%; background:rgba(255,255,255,0.06); border:1px solid rgba(138,43,226,0.3);
  border-radius:10px; padding:10px 12px; color:#fff; font-size:13px;
  outline:none; transition:border-color .2s; box-sizing:border-box;
}
.planet-input:focus { border-color:rgba(138,43,226,0.7); }
.planet-input-label { font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px; font-weight:600; }

/* ─── Primary/Secondary Buttons ─── */
.planet-btn-primary {
  background: linear-gradient(135deg,#8b5cf6,#6d28d9); border:none; border-radius:10px;
  padding:10px 20px; color:#fff; font-size:12px; font-weight:800; cursor:pointer;
  transition:all .2s; width:100%;
}
.planet-btn-primary:hover { filter:brightness(1.15); }
.planet-btn-primary:disabled { opacity:.4; cursor:not-allowed; }
.planet-btn-secondary {
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12);
  border-radius:10px; padding:10px 20px; color:rgba(255,255,255,0.7);
  font-size:12px; font-weight:700; cursor:pointer; transition:all .2s; width:100%;
}
.planet-btn-secondary:hover { background:rgba(255,255,255,0.1); color:#fff; }

/* ─── Section Tabs ─── */
.planet-subtabs { display:flex; gap:4px; margin-bottom:12px; flex-shrink:0; }
.planet-subtab {
  flex:1; padding:8px; border:none; border-radius:8px; font-size:11px; font-weight:800;
  cursor:pointer; transition:all .2s; color:rgba(255,255,255,0.5);
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06);
}
.planet-subtab.active {
  background: linear-gradient(135deg,rgba(138,43,226,0.3),rgba(255,55,95,0.2));
  border-color:rgba(138,43,226,0.5); color:#fff;
}

/* ─── Spy result ─── */
.planet-spy-card {
  background: rgba(255,154,60,0.08); border:1px solid rgba(255,154,60,0.25);
  border-radius:12px; padding:12px;
}

/* ─── Notification dot for shield ─── */
.planet-shield-active {
  display:inline-flex; align-items:center; gap:4px; font-size:10px;
  color:#4fc3f7; background:rgba(79,195,247,0.12); border:1px solid rgba(79,195,247,0.3);
  border-radius:999px; padding:2px 10px; flex-shrink:0;
}
`

// ═══════════════════════════════════════════════════════════════
// STAR FIELD COMPONENT
// ═══════════════════════════════════════════════════════════════
function StarField() {
  const stars = React.useMemo(() => Array.from({ length: 50 }, (_, i) => ({
    id: i,
    top: Math.random() * 100,
    left: Math.random() * 100,
    size: Math.random() * 2 + 0.5,
    dur: 2 + Math.random() * 5,
    delay: Math.random() * 6,
  })), [])

  return (
    <div className="planet-stars" aria-hidden>
      {stars.map(s => (
        <div key={s.id} className="planet-star" style={{
          top: `${s.top}%`, left: `${s.left}%`,
          width: s.size, height: s.size,
          ['--dur' as string]: `${s.dur}s`,
          ['--delay' as string]: `${s.delay}s`,
        }} />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SUBVIEWS
// ═══════════════════════════════════════════════════════════════

// ── Dashboard (main planet view) ──────────────────────────────
function PlanetDashboard({ p, onAction, onNavigate }: {
  p: PlanetData
  onAction: (action: string, payload?: any) => Promise<void>
  onNavigate: (view: PlanetView) => void
}) {
  const [cd, setCd] = useState<Record<string, number>>({})
  const now = Date.now()

  useEffect(() => {
    const interval = setInterval(() => {
      setCd({
        mining: Math.max(0, 300000 - (Date.now() - p.lastMining)),
        hunt:   Math.max(0, 420000 - (Date.now() - p.lastHunt)),
        explore:Math.max(0, 600000 - (Date.now() - p.lastExplore)),
        invade: Math.max(0, 1800000 - (Date.now() - p.lastInvade)),
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [p])

  const totalDef = calcTotalDefense(p)
  const maxPop = getMaxPop(p)
  const tierColor = TIER_COLORS[p.tier - 1]
  const tierProgress = getTierProgress(p)
  const weather = WEATHERS.find(w => w.n === p.currentWeather) || WEATHERS[0]
  const shielded = isShielded(p)

  return (
    <div className="planet-body">
      {/* Planet Identity */}
      <div className="planet-card">
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <div style={{ fontSize:40 }}>🪐</div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <div className="planet-name-text">{p.name}</div>
              <div className="planet-tier-badge" style={{ color:tierColor, borderColor:tierColor }}>
                T{p.tier} {TIER_NAMES[p.tier-1]}
              </div>
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>
              👥 {p.population.toLocaleString()} / {maxPop.toLocaleString()} pop
              &nbsp;·&nbsp; 🔰 {totalDef} def
            </div>
          </div>
          {shielded && (
            <div className="planet-shield-active">🛡 Shield ON</div>
          )}
        </div>

        {/* Tier progress */}
        <div style={{ marginBottom:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:3 }}>
            <span>XP: {p.planetXp}</span>
            <span>{p.tier < 5 ? `→ T${p.tier+1} (${TIER_XP[p.tier]} XP)` : '✨ MAX TIER'}</span>
          </div>
          <div className="planet-tier-bar-wrap">
            <div className="planet-tier-bar-fill" style={{ width:`${Math.round(tierProgress*100)}%` }}/>
          </div>
        </div>

        {/* Stats */}
        {[
          { label:'Populasi', val: p.population/maxPop, valStr: `${Math.round(p.population/maxPop*100)}%`, color:'#4fc3f7' },
          { label:'Stabilitas', val: p.stability/100, valStr:`${p.stability}%`, color: p.stability>60?'#c8f500':p.stability>30?'#ff9a3c':'#ff375f' },
        ].map(s => (
          <div className="planet-stat-row" key={s.label}>
            <div className="planet-stat-label">{s.label}</div>
            <div className="planet-stat-bar">
              <div className="planet-stat-bar-fill" style={{ width:`${Math.round(s.val*100)}%`, background:s.color }}/>
            </div>
            <div className="planet-stat-val" style={{ color:s.color }}>{s.valStr}</div>
          </div>
        ))}
      </div>

      {/* Weather */}
      <div className="planet-weather-banner">
        <div className="planet-weather-emoji">{weather.emoji}</div>
        <div>
          <div className="planet-weather-name">{weather.n}</div>
          <div className="planet-weather-msg">{weather.m}</div>
        </div>
      </div>

      {/* Resources */}
      <div className="planet-card">
        <div className="planet-card-title">⚙ Resources</div>
        <div className="planet-res-grid">
          {[
            { key:'dust',  emoji:'⚫', label:'Dust',      val:p.resources.dust  },
            { key:'spore', emoji:'🟢', label:'Spore',     val:p.resources.spore },
            { key:'core',  emoji:'🔵', label:'Core',      val:p.resources.core  },
            { key:'anti',  emoji:'☄️', label:'Anti-Matter',val:p.resources.anti },
          ].map(r => (
            <div className="planet-res-item" key={r.key}>
              <div style={{ fontSize:20 }}>{r.emoji}</div>
              <div className="planet-res-val">{r.val}</div>
              <div className="planet-res-name">{r.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="planet-card">
        <div className="planet-card-title">⚡ Ekspedisi</div>
        <div className="planet-action-grid">
          {[
            { id:'mining', emoji:'⛏️', label:'Mining',  sub:'Dust & Core', cdKey:'mining' },
            { id:'hunt',   emoji:'🏹', label:'Hunter',  sub:'Spore + Migrasi', cdKey:'hunt' },
            { id:'explore',emoji:'🚀', label:'Explore', sub:'Anti-Matter + Gold', cdKey:'explore' },
          ].map(a => {
            const cdMs = cd[a.cdKey] || 0
            return (
              <button key={a.id} className={`planet-action-btn ${cdMs>0?'p-btn-cd':''}`}
                disabled={cdMs>0} onClick={() => onAction(a.id)}>
                <div className="p-btn-emoji">{a.emoji}</div>
                <div className="p-btn-label">{a.label}</div>
                <div className="p-btn-sub">{cdMs>0 ? clockStr(cdMs) : a.sub}</div>
              </button>
            )
          })}
          <button className="planet-action-btn p-btn-primary" onClick={() => onNavigate('sell')}>
            <div className="p-btn-emoji">💰</div>
            <div className="p-btn-label">Jual</div>
            <div className="p-btn-sub">Resource → Gold</div>
          </button>
        </div>
      </div>

      {/* Build & Craft */}
      <div className="planet-action-grid">
        <button className="planet-action-btn" onClick={() => onNavigate('build')}>
          <div className="p-btn-emoji">🏗️</div>
          <div className="p-btn-label">Build</div>
          <div className="p-btn-sub">Bangun gedung</div>
        </button>
        <button className="planet-action-btn" onClick={() => onNavigate('craft')}>
          <div className="p-btn-emoji">🛠️</div>
          <div className="p-btn-label">Craft</div>
          <div className="p-btn-sub">Buat item</div>
        </button>
        <button className="planet-action-btn p-btn-danger" onClick={() => onNavigate('invade')}>
          <div className="p-btn-emoji">⚔️</div>
          <div className="p-btn-label">Invade</div>
          <div className="p-btn-sub">{cd.invade>0?clockStr(cd.invade):'Serang planet'}</div>
        </button>
        <button className="planet-action-btn" onClick={() => onNavigate('regions')}>
          <div className="p-btn-emoji">🗺️</div>
          <div className="p-btn-label">Sektor</div>
          <div className="p-btn-sub">{p.regions.length}/5 aktif</div>
        </button>
      </div>

      {/* Inventory */}
      {Object.keys(p.inventory).filter(k => (p.inventory[k]||0)>0).length > 0 && (
        <div className="planet-card">
          <div className="planet-card-title">🎒 Inventory</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {Object.entries(p.inventory).filter(([,v]) => v>0).map(([k,v]) => (
              <div key={k} className="planet-building-chip" style={{ fontSize:11 }}>
                {CRAFTABLE[k]?.emoji} {CRAFTABLE[k]?.name || k} ×{v}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rename button */}
      <button className="planet-btn-secondary" onClick={() => onNavigate('rename')}>
        ✏️ Ganti Nama Planet (500,000 Gold)
      </button>
    </div>
  )
}

// ── Regions View ──────────────────────────────────────────────
function RegionsView({ p, gold, onBuild, onFix, onAddRegion, onBack }: {
  p: PlanetData; gold: number
  onBuild: (regionIdx: number, buildingId: string) => Promise<void>
  onFix: (regionIdx: number) => Promise<void>
  onAddRegion: (name: string) => Promise<void>
  onBack: () => void
}) {
  const [newRegionName, setNewRegionName] = useState('')
  const [buildingFor, setBuildingFor] = useState<number|null>(null)
  const [msg, setMsg] = useState('')

  const handleFix = async (i: number) => {
    await onFix(i)
    setMsg(`✅ Sektor ${p.regions[i].name} diperbaiki!`)
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div className="planet-body">
      <div className="planet-header" style={{ position:'sticky', top:0, zIndex:5 }}>
        <button className="planet-header-back" onClick={onBack}>‹ Kembali</button>
        <div className="planet-header-title">🗺️ Sektor Map</div>
      </div>

      {msg && <div className="planet-toast success">{msg}</div>}

      {p.regions.map((reg, i) => {
        const hpColor = reg.hp > 70 ? '#4fc3f7' : reg.hp > 30 ? '#ff9a3c' : '#ff375f'
        return (
          <div key={i} className="planet-region-card">
            <div className="planet-region-header">
              <div style={{ fontSize:16 }}>{reg.hp > 70 ? '💠' : reg.hp > 30 ? '⚠️' : '🔴'}</div>
              <div className="planet-region-name">{i+1}. {reg.name}</div>
              <div className="planet-region-hp" style={{ color:hpColor }}>{reg.hp}% HP</div>
            </div>
            <div className="planet-region-hp-bar">
              <div className="planet-region-hp-fill" style={{ width:`${reg.hp}%`, background:hpColor }}/>
            </div>
            <div className="planet-region-buildings">
              {(reg.buildings||[]).length === 0
                ? <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Kosong</span>
                : (reg.buildings||[]).map(b => (
                    <div key={b} className="planet-building-chip">
                      {PLANET_BUILDINGS[b]?.emoji} {PLANET_BUILDINGS[b]?.name || b}
                    </div>
                  ))
              }
            </div>
            <div style={{ display:'flex', gap:6, marginTop:8 }}>
              {reg.hp < 100 && (
                <button className="planet-btn-primary" style={{padding:'6px',fontSize:11}}
                  onClick={() => handleFix(i)}>
                  🔧 Fix ({(100-reg.hp)*5000 >=1000?`${((100-reg.hp)*5000/1000).toFixed(0)}k`:`${(100-reg.hp)*5000}`}G)
                </button>
              )}
              {(reg.buildings||[]).length < 3 && (
                <button className="planet-btn-secondary" style={{padding:'6px',fontSize:11}}
                  onClick={() => setBuildingFor(buildingFor===i?null:i)}>
                  🏗️ Build
                </button>
              )}
            </div>

            {buildingFor === i && (
              <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
                <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>Pilih building:</div>
                {Object.entries(PLANET_BUILDINGS).map(([id, b]) => {
                  const alreadyHas = (reg.buildings||[]).includes(id)
                  const canAfford = Object.entries(b.cost).every(([res, amt]) =>
                    res === 'gold' ? gold >= amt : (p.resources[res as keyof typeof p.resources] || 0) >= amt
                  )
                  const costStr = Object.entries(b.cost).map(([r,v]) =>
                    r==='gold' ? `${(v as number).toLocaleString()}G` : `${v} ${r}`
                  ).join(' + ')
                  return (
                    <button key={id}
                      className={`planet-action-btn ${alreadyHas||!canAfford?'p-btn-cd':''}`}
                      style={{ flexDirection:'row', justifyContent:'space-between', padding:'8px 12px', textAlign:'left' }}
                      disabled={alreadyHas || !canAfford}
                      onClick={() => { onBuild(i, id); setBuildingFor(null) }}>
                      <span>{b.emoji} {b.name}</span>
                      <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>{costStr}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {p.regions.length < 5 && (
        <div className="planet-card">
          <div className="planet-card-title">➕ Tambah Sektor</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>
            Butuh {(p.regions.length*10000).toLocaleString()} pop &amp; {(p.regions.length*2000000).toLocaleString()} Gold
          </div>
          <input className="planet-input" placeholder="Nama sektor baru..." value={newRegionName}
            onChange={e => setNewRegionName(e.target.value)} style={{marginBottom:8}}/>
          <button className="planet-btn-primary" onClick={() => { onAddRegion(newRegionName); setNewRegionName('') }}>
            🌍 Buka Sektor Baru
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sell View ─────────────────────────────────────────────────
function SellView({ p, hasSellBonus, onSell, onBack }: {
  p: PlanetData; hasSellBonus: boolean
  onSell: (res: string, amt: number) => Promise<void>
  onBack: () => void
}) {
  const [amounts, setAmounts] = useState<Record<string,string>>({})
  const [msg, setMsg] = useState('')

  const doSell = async (res: string) => {
    const amt = parseInt(amounts[res]) || 0
    if (amt <= 0) { setMsg('❌ Masukkan jumlah valid!'); return }
    await onSell(res, amt)
    setMsg(`✅ Sold ${amt}x ${res}!`)
    setAmounts(a => ({...a, [res]:''}))
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div className="planet-body">
      <div className="planet-header" style={{ position:'sticky', top:0, zIndex:5 }}>
        <button className="planet-header-back" onClick={onBack}>‹ Kembali</button>
        <div className="planet-header-title">💰 Jual Resource</div>
      </div>
      {msg && <div className={`planet-toast ${msg.startsWith('✅')?'success':'danger'}`}>{msg}</div>}
      {hasSellBonus && <div className="planet-toast">🏪 Stellar Market aktif: harga +20%!</div>}

      {Object.entries(SELL_PRICE).map(([res, price]) => {
        const have = p.resources[res as keyof typeof p.resources] || 0
        const actualPrice = hasSellBonus ? Math.floor(price * 1.2) : price
        return (
          <div key={res} className="planet-card">
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontWeight:800 }}>
                {res==='dust'?'⚫':res==='spore'?'🟢':res==='core'?'🔵':'☄️'} {res.toUpperCase()}
              </div>
              <div style={{ fontSize:11, color:'#c8f500' }}>{actualPrice.toLocaleString()} Gold/unit</div>
            </div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:8 }}>Punya: {have}</div>
            <div style={{ display:'flex', gap:8 }}>
              <input className="planet-input" type="number" min="1" max={have}
                placeholder="Jumlah..." value={amounts[res]||''}
                onChange={e => setAmounts(a=>({...a,[res]:e.target.value}))}
                style={{ flex:1 }} />
              <button className="planet-btn-primary" style={{ flex:1, padding:'10px' }}
                onClick={() => doSell(res)}>
                Jual
              </button>
            </div>
            {amounts[res] && parseInt(amounts[res]) > 0 && (
              <div style={{ fontSize:11, color:'#ffd700', marginTop:4 }}>
                = {(parseInt(amounts[res]) * actualPrice).toLocaleString()} Gold
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Craft View ────────────────────────────────────────────────
function CraftView({ p, onCraft, onBack }: {
  p: PlanetData
  onCraft: (id: string) => Promise<void>
  onBack: () => void
}) {
  const [msg, setMsg] = useState('')

  const doCraft = async (id: string) => {
    await onCraft(id)
    setMsg(`✅ ${CRAFTABLE[id].name} berhasil di-craft!`)
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div className="planet-body">
      <div className="planet-header" style={{ position:'sticky', top:0, zIndex:5 }}>
        <button className="planet-header-back" onClick={onBack}>‹ Kembali</button>
        <div className="planet-header-title">🛠️ Workshop</div>
      </div>
      {msg && <div className="planet-toast success">{msg}</div>}

      {Object.entries(CRAFTABLE).map(([id, item]) => {
        const canAfford = Object.entries(item.cost).every(([r,v]) =>
          (p.resources[r as keyof typeof p.resources]||0) >= v
        )
        const owned = p.inventory[id] || 0
        return (
          <div key={id} className="planet-card" style={{ opacity: canAfford?1:0.6 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
              <div style={{ fontSize:28 }}>{item.emoji}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:800, fontSize:14 }}>{item.name}</div>
                <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{item.desc}</div>
              </div>
              {owned > 0 && <div className="planet-building-chip">×{owned}</div>}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
              {Object.entries(item.cost).map(([r,v]) => {
                const have = p.resources[r as keyof typeof p.resources]||0
                return (
                  <div key={r} style={{ fontSize:11, color: have>=v?'#c8f500':'#ff6b6b' }}>
                    {r==='dust'?'⚫':r==='spore'?'🟢':r==='core'?'🔵':'☄️'} {v} {r} ({have})
                  </div>
                )
              })}
            </div>
            <button className="planet-btn-primary" disabled={!canAfford} onClick={() => doCraft(id)}>
              {canAfford ? '🔨 Craft' : '❌ Resource Kurang'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ── Invasion View (Planet List) ───────────────────────────────
function InvadeView({ myPlanet, allPlanets, canInvade, onSpy, onInvade, onBack }: {
  myPlanet: PlanetData
  allPlanets: PlanetData[]
  canInvade: boolean
  onSpy: (targetUid: string) => Promise<{success:boolean;data?:any;msg:string}>
  onInvade: (targetUid: string) => Promise<void>
  onBack: () => void
}) {
  const [spyResult, setSpyResult] = useState<{uid:string;data:any}|null>(null)
  const [spyLoading, setSpyLoading] = useState<string|null>(null)
  const [msg, setMsg] = useState('')

  const targets = allPlanets.filter(p => p.uid !== myPlanet.uid)

  const handleSpy = async (uid: string) => {
    if (!hasBuildingEffect(myPlanet, 'spy_enabled')) {
      setMsg('❌ Butuh Oracle Tower untuk spy!'); setTimeout(()=>setMsg(''),3000); return
    }
    setSpyLoading(uid)
    const res = await onSpy(uid)
    if (res.success && res.data) setSpyResult({ uid, data: res.data })
    else { setMsg(res.msg); setTimeout(()=>setMsg(''),3000) }
    setSpyLoading(null)
  }

  return (
    <div className="planet-body">
      <div className="planet-header" style={{ position:'sticky', top:0, zIndex:5 }}>
        <button className="planet-header-back" onClick={onBack}>‹ Kembali</button>
        <div className="planet-header-title">⚔️ Galactic War</div>
      </div>

      {msg && <div className={`planet-toast ${msg.startsWith('✅')?'success':'danger'}`}>{msg}</div>}

      {!canInvade && (
        <div className="planet-toast warning">
          ⚠️ Butuh 8,000 pop &amp; stabilitas ≥30% untuk invasi
        </div>
      )}

      <div className="planet-card" style={{marginBottom:0}}>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',lineHeight:1.6}}>
          🛡️ Planet dengan <span style={{color:'#4fc3f7'}}>Shield ON</span> tidak bisa diserang (owner offline &gt;30 menit).
          Spy membutuhkan <strong>Oracle Tower</strong>. Invasi CD: 30 menit.
        </div>
      </div>

      {targets.length === 0 && (
        <div style={{textAlign:'center',padding:'32px 0',color:'rgba(255,255,255,0.3)',fontSize:13}}>
          Belum ada planet lain di galaksi ini.
        </div>
      )}

      {targets.map(t => {
        const shielded = isShielded(t)
        const totalDef = calcTotalDefense(t)
        const tierColor = TIER_COLORS[t.tier-1]
        const spied = spyResult?.uid === t.uid

        return (
          <div key={t.uid} className={`planet-list-item ${shielded?'shielded':''}`}>
            <div className="planet-list-globe">🪐</div>
            <div className="planet-list-info">
              <div className="planet-list-name">{t.name}</div>
              <div style={{fontSize:10,color:tierColor}}>T{t.tier} {TIER_NAMES[t.tier-1]} · {t.username}</div>
              <div className="planet-list-stats">
                <span className="planet-list-stat">👥 {t.population.toLocaleString()}</span>
                <span className="planet-list-stat">🔰 {totalDef}</span>
                <span className="planet-list-stat">🛡️ {t.stability}%</span>
              </div>

              {spied && spyResult?.data && (
                <div className="planet-spy-card" style={{marginTop:6}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#ff9a3c',marginBottom:4}}>🔭 Spy Report:</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.6)',lineHeight:1.6}}>
                    ⚫ Dust: {spyResult.data.dust} &nbsp;|&nbsp; 🔵 Core: {spyResult.data.core}<br/>
                    🏗️ Buildings: {spyResult.data.buildings}<br/>
                    ☄️ Anti: {spyResult.data.anti > 0 ? '⚠️ PUNYA!' : '—'}
                  </div>
                </div>
              )}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
              {shielded
                ? <div className="planet-shield-badge">🛡 SHIELD</div>
                : (
                  <>
                    <button className="planet-attack-btn"
                      style={{background:'rgba(255,154,60,0.15)',borderColor:'rgba(255,154,60,0.4)',color:'#ff9a3c',fontSize:10}}
                      disabled={!!spyLoading}
                      onClick={() => handleSpy(t.uid)}>
                      {spyLoading===t.uid ? '...' : '🔭 Spy'}
                    </button>
                    <button className="planet-attack-btn"
                      disabled={!canInvade}
                      onClick={() => onInvade(t.uid)}>
                      ⚔️ Serang
                    </button>
                  </>
                )
              }
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Leaderboard View ──────────────────────────────────────────
function PlanetLeaderboard({ planets, onBack }: {
  planets: PlanetData[]
  onBack: () => void
}) {
  const sorted = [...planets]
    .filter(p => p.name)
    .sort((a,b) => (b.population + calcTotalDefense(b) + b.planetXp*2) - (a.population + calcTotalDefense(a) + a.planetXp*2))
    .slice(0, 15)

  const medals = ['🥇','🥈','🥉']

  return (
    <div className="planet-body">
      <div className="planet-header" style={{position:'sticky',top:0,zIndex:5}}>
        <button className="planet-header-back" onClick={onBack}>‹ Kembali</button>
        <div className="planet-header-title">🏆 Galactic Leaderboard</div>
      </div>

      {sorted.map((p,i) => {
        const tierColor = TIER_COLORS[p.tier-1]
        return (
          <div key={p.uid} className="planet-lb-item">
            <div className="planet-lb-rank">{medals[i] || `${i+1}`}</div>
            <div style={{flex:1}}>
              <div className="planet-lb-name">{p.name}</div>
              <div className="planet-lb-meta">
                <span style={{color:tierColor}}>T{p.tier} {TIER_NAMES[p.tier-1]}</span>
                {' · '}{p.username}
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:2}}>
                👥 {p.population.toLocaleString()} · 🔰 {calcTotalDefense(p)} def · {p.totalInvadeWins}W/{p.totalInvadeLosses}L
              </div>
            </div>
            <div className="planet-lb-score">{(p.population + calcTotalDefense(p) + p.planetXp*2).toLocaleString()}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Invasion Result ───────────────────────────────────────────
function InvasionResult({ result, details, onClose }: {
  result: 'win'|'lose'
  details: string
  onClose: () => void
}) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,padding:'20px 12px'}}>
      <div className={`planet-invasion-result ${result}`}>
        <div className="planet-inv-emoji">{result==='win'?'🏆':'💥'}</div>
        <div className="planet-inv-title" style={{color:result==='win'?'#c8f500':'#ff375f'}}>
          {result==='win' ? '⚔️ WARP STRIKE: SUCCESS!' : '💥 WARP STRIKE: FAILED!'}
        </div>
        <div className="planet-inv-detail">{details}</div>
      </div>
      <button className="planet-btn-primary" onClick={onClose}>← Kembali</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN PLANET PANEL
// ═══════════════════════════════════════════════════════════════
type PlanetView =
  'home' | 'dashboard' | 'create' | 'regions' | 'build' | 'craft' |
  'sell' | 'invade' | 'leaderboard' | 'rename' | 'invasion_result'

interface PlanetPanelProps {
  uid: string
  username: string
  gold: number
  onGoldChange: (newGold: number) => Promise<void>
  onBack: () => void
}

export default function PlanetPanel({ uid, username, gold, onGoldChange, onBack }: PlanetPanelProps) {
  const [planet, setPlanet] = useState<PlanetData | null | undefined>(undefined) // undefined = loading
  const [allPlanets, setAllPlanets] = useState<PlanetData[]>([])
  const [view, setView] = useState<PlanetView>('home')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'success'|'danger'|'warning'|''>('')
  const [loading, setLoading] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [invasionResult, setInvasionResult] = useState<{result:'win'|'lose';details:string}|null>(null)

  // Inject CSS once
  useEffect(() => {
    if (!document.getElementById('planet-panel-css')) {
      const style = document.createElement('style')
      style.id = 'planet-panel-css'
      style.textContent = PLANET_CSS
      document.head.appendChild(style)
    }
  }, [])

  // Load planet data: getDoc sekali + throttle lastSeen update (max tiap 5 menit)
  const lastSeenUpdateRef = useRef<number>(0)
  useEffect(() => {
    if (!uid) { setPlanet(null); return }
    let cancelled = false
    const fetchPlanet = async () => {
      try {
        const snap = await getDoc(doc(db, 'planets', uid))
        if (cancelled) return
        if (snap.exists()) {
          const data = snap.data() as PlanetData
          setPlanet(data)
          const now = Date.now()
          if (now - lastSeenUpdateRef.current > 300000) {
            lastSeenUpdateRef.current = now
            updateDoc(doc(db, 'planets', uid), { lastSeen: now, shieldActive: false }).catch(() => {})
          }
        } else {
          setPlanet(null)
        }
      } catch (e) {
        console.error('fetchPlanet error:', e)
        if (!cancelled) setPlanet(null)
      }
    }
    // Timeout fallback: kalau 10 detik masih loading, anggap tidak ada planet
    const timeout = setTimeout(() => { if (!cancelled) setPlanet(null) }, 10000)
    fetchPlanet().finally(() => clearTimeout(timeout))
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [uid])

  // Load all planets: hanya di-fetch saat masuk view invade/leaderboard + polling 5 menit
  const allPlanetsLoadedRef = useRef(false)
  const fetchAllPlanets = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'planets'))
      const list: PlanetData[] = []
      snap.forEach(d => list.push(d.data() as PlanetData))
      setAllPlanets(list)
      allPlanetsLoadedRef.current = true
    } catch (e) { console.error('fetchAllPlanets:', e) }
  }, [])

  useEffect(() => {
    if (view === 'invade' || view === 'leaderboard') {
      fetchAllPlanets()
    }
  }, [view, fetchAllPlanets])

  useEffect(() => {
    const interval = setInterval(() => {
      if (allPlanetsLoadedRef.current) fetchAllPlanets()
    }, 300000)
    return () => clearInterval(interval)
  }, [fetchAllPlanets])

  // Auto-weather every 10 minutes
  useEffect(() => {
    if (!planet || !uid) return
    const now = Date.now()
    if (now - (planet.lastWeather || 0) < 600000) return
    const w = WEATHERS[Math.floor(Math.random() * WEATHERS.length)]
    const newPop = Math.max(100, planet.population + w.pop)
    const newStability = Math.max(0, Math.min(100, (planet.stability || 100) + w.stability))
    updateDoc(doc(db, 'planets', uid), {
      currentWeather: w.n, weatherMsg: `${w.emoji} ${w.m}`,
      population: newPop, stability: newStability,
      planetXp: (planet.planetXp || 0) + w.xp,
      lastWeather: now,
    }).catch(() => {})
  }, [planet, uid])

  const toast = useCallback((text: string, type: 'success'|'danger'|'warning' = 'success') => {
    setMsg(text); setMsgType(type)
    setTimeout(() => { setMsg(''); setMsgType('') }, 4000)
  }, [])

  // Update planet: write ke Firestore + update local state (tanpa perlu re-fetch)
  const updatePlanet = async (updates: Partial<PlanetData>) => {
    if (!uid) return
    await updateDoc(doc(db, 'planets', uid), updates as any)
    setPlanet(prev => prev ? { ...prev, ...updates } : prev)
  }

  // ── CREATE PLANET ──────────────────────────────────────────
  const handleCreate = async (name: string) => {
    if (!name.trim()) { toast('❌ Masukkan nama planet!', 'danger'); return }
    setLoading(true)
    const p = newPlanet(uid, username, name.trim())
    await setDoc(doc(db, 'planets', uid), p)
    setLoading(false)
    toast(`✨ Planet "${name}" berhasil dibuat!`)
  }

  // ── ACTION HANDLERS ────────────────────────────────────────
  const handleAction = async (action: string) => {
    if (!planet) return
    const now = Date.now()

    if (action === 'mining') {
      const cdMs = 300000 - (now - planet.lastMining)
      if (cdMs > 0) { toast(`⏳ Cooldown ${clockStr(cdMs)}`, 'warning'); return }
      const bonus = hasBuildingEffect(planet, 'mining_bonus') ? 1.5 : 1
      const d = Math.floor((Math.floor(Math.random()*20)+10)*bonus)
      const c = Math.floor((Math.floor(Math.random()*3)+1)*bonus)
      await updatePlanet({
        resources: { ...planet.resources, dust: planet.resources.dust+d, core: planet.resources.core+c },
        lastMining: now,
        planetXp: (planet.planetXp||0) + PLANET_XP_PER_ACTION.mining,
      })
      toast(`⛏️ +${d} Dust  +${c} Core${bonus>1?' (+50% Lab bonus)':''}`)
      return
    }

    if (action === 'hunt') {
      const cdMs = 420000 - (now - planet.lastHunt)
      if (cdMs > 0) { toast(`⏳ Cooldown ${clockStr(cdMs)}`, 'warning'); return }
      const s = Math.floor(Math.random()*10)+5
      const migrate = Math.floor(Math.random()*20)+1
      const maxPop = getMaxPop(planet)
      const newPop = Math.min(maxPop, planet.population + migrate)
      await updatePlanet({
        resources: { ...planet.resources, spore: planet.resources.spore+s },
        population: newPop,
        lastHunt: now,
        planetXp: (planet.planetXp||0) + PLANET_XP_PER_ACTION.hunt,
      })
      toast(`🏹 +${s} Spore  👣 +${migrate} migran baru`)
      return
    }

    if (action === 'explore') {
      const cdMs = 600000 - (now - planet.lastExplore)
      if (cdMs > 0) { toast(`⏳ Cooldown ${clockStr(cdMs)}`, 'warning'); return }
      const a = Math.random() > 0.75 ? 1 : 0
      const base = Math.floor(Math.random()*50000)+20000
      const erisGain = hasBuildingEffect(planet, 'sell_bonus') ? Math.floor(base*1.2) : base
      await updatePlanet({
        resources: { ...planet.resources, anti: planet.resources.anti+a },
        lastExplore: now,
        planetXp: (planet.planetXp||0) + PLANET_XP_PER_ACTION.explore,
      })
      await onGoldChange(gold + erisGain)
      toast(`🚀 +${a} Anti-Matter${a?' 🌟(Rare!)':''}\n💰 +${erisGain.toLocaleString()} Gold${hasBuildingEffect(planet,'sell_bonus')?' (+20%)':''}`)
      return
    }
  }

  // ── BUILD ──────────────────────────────────────────────────
  const handleBuild = async (regionIdx: number, buildingId: string) => {
    if (!planet) return
    const reg = planet.regions[regionIdx]
    if (!reg) return
    const bld = PLANET_BUILDINGS[buildingId]
    if (!bld) return
    if ((reg.buildings||[]).includes(buildingId)) { toast('❌ Sudah ada!','danger'); return }
    if ((reg.buildings||[]).length >= 3) { toast('❌ Maks 3 building/sektor','danger'); return }

    // Check cost
    for (const [res, amt] of Object.entries(bld.cost)) {
      if (res === 'gold') {
        if (gold < amt) { toast(`❌ Gold kurang! Butuh ${(amt as number).toLocaleString()}G`, 'danger'); return }
      } else {
        if ((planet.resources[res as keyof typeof planet.resources]||0) < (amt as number)) {
          toast(`❌ ${res} kurang! Butuh ${amt}`, 'danger'); return
        }
      }
    }

    const newRegions = planet.regions.map((r,i) =>
      i === regionIdx ? { ...r, buildings: [...(r.buildings||[]), buildingId] } : r
    )
    const newResources = { ...planet.resources }
    let newGold = gold
    for (const [res, amt] of Object.entries(bld.cost)) {
      if (res === 'gold') newGold -= amt as number
      else (newResources as any)[res] -= amt
    }

    await updatePlanet({
      regions: newRegions, resources: newResources,
      planetXp: (planet.planetXp||0) + PLANET_XP_PER_ACTION.build,
    })
    await onGoldChange(newGold)
    toast(`✅ ${bld.emoji} ${bld.name} dibangun di ${reg.name}!`)
  }

  // ── FIX REGION ─────────────────────────────────────────────
  const handleFix = async (regionIdx: number) => {
    if (!planet) return
    const reg = planet.regions[regionIdx]
    if (!reg) return
    const damage = 100 - reg.hp
    const cost = damage * 5000
    if (gold < cost) { toast(`❌ Butuh ${cost.toLocaleString()} Gold untuk perbaikan`, 'danger'); return }
    const newRegions = planet.regions.map((r,i) => i===regionIdx ? {...r, hp:100} : r)
    await updatePlanet({ regions: newRegions })
    await onGoldChange(gold - cost)
    toast(`🔧 Sektor diperbaiki! -${cost.toLocaleString()} Gold`)
  }

  // ── ADD REGION ─────────────────────────────────────────────
  const handleAddRegion = async (name: string) => {
    if (!planet) return
    if (!name.trim()) { toast('❌ Nama sektor kosong!','danger'); return }
    if (planet.regions.length >= 5) { toast('❌ Maks 5 sektor!','danger'); return }
    const reqPop = planet.regions.length * 10000
    if (planet.population < reqPop) {
      toast(`❌ Butuh ${reqPop.toLocaleString()} populasi!`,'danger'); return
    }
    const cost = planet.regions.length * 2000000
    if (gold < cost) { toast(`❌ Butuh ${cost.toLocaleString()} Gold!`,'danger'); return }
    await updatePlanet({ regions: [...planet.regions, { name: name.trim(), hp:100, buildings:[] }] })
    await onGoldChange(gold - cost)
    toast(`🌍 Sektor "${name}" dibuka! -${cost.toLocaleString()} Gold`)
  }

  // ── CRAFT ──────────────────────────────────────────────────
  const handleCraft = async (id: string) => {
    if (!planet) return
    const item = CRAFTABLE[id]
    const newRes = { ...planet.resources }
    for (const [r,v] of Object.entries(item.cost)) {
      if ((newRes as any)[r] < v) { toast(`❌ ${r} kurang!`, 'danger'); return }
      ;(newRes as any)[r] -= v
    }
    const newInv = { ...planet.inventory, [id]: (planet.inventory[id]||0) + 1 }
    await updatePlanet({ resources: newRes, inventory: newInv, planetXp: (planet.planetXp||0)+PLANET_XP_PER_ACTION.craft })
    toast(`✅ ${item.emoji} ${item.name} berhasil di-craft!`)
  }

  // ── SELL ────────────────────────────────────────────────────
  const handleSell = async (res: string, amt: number) => {
    if (!planet) return
    const have = planet.resources[res as keyof typeof planet.resources] || 0
    if (have < amt) { toast(`❌ ${res} kurang!`,'danger'); return }
    const price = hasBuildingEffect(planet,'sell_bonus')
      ? Math.floor(SELL_PRICE[res]*1.2) : SELL_PRICE[res]
    const total = price * amt
    const newRes = { ...planet.resources, [res]: have - amt }
    await updatePlanet({ resources: newRes, planetXp: (planet.planetXp||0)+PLANET_XP_PER_ACTION.sell })
    await onGoldChange(gold + total)
  }

  // ── SPY ─────────────────────────────────────────────────────
  const handleSpy = async (targetUid: string): Promise<{success:boolean;data?:any;msg:string}> => {
    const now = Date.now()
    if (!planet) return { success:false, msg:'❌ No planet' }
    if (!hasBuildingEffect(planet,'spy_enabled')) return { success:false, msg:'❌ Butuh Oracle Tower!' }
    const cdMs = 300000 - (now - (planet.lastSpy||0))
    if (cdMs > 0) return { success:false, msg:`⏳ Spy cooldown: ${clockStr(cdMs)}` }
    const target = allPlanets.find(p => p.uid === targetUid)
    if (!target) return { success:false, msg:'❌ Target tidak ditemukan' }
    await updatePlanet({ lastSpy: now })
    return {
      success: true,
      data: {
        dust: target.resources.dust,
        core: target.resources.core,
        anti: target.resources.anti,
        buildings: target.regions.flatMap(r=>r.buildings||[]).map(b=>PLANET_BUILDINGS[b]?.name||b).join(', ')||'Kosong',
      },
      msg: '✅ Spy berhasil!'
    }
  }

  // ── INVADE ─────────────────────────────────────────────────
  const handleInvade = async (targetUid: string) => {
    if (!planet) return
    const now = Date.now()
    const cdMs = 1800000 - (now - (planet.lastInvade||0))
    if (cdMs > 0) { toast(`⏳ Invade cooldown: ${clockStr(cdMs)}`,'warning'); return }
    if (planet.population < 8000) { toast('❌ Butuh 8,000 pop!','danger'); return }
    if (planet.stability < 30) { toast('❌ Stabilitas terlalu rendah!','danger'); return }

    const target = allPlanets.find(p => p.uid === targetUid)
    if (!target) { toast('❌ Target hilang!','danger'); return }
    if (isShielded(target)) { toast('🛡️ Target dilindungi shield!','warning'); return }

    // Calc power
    const hasAntiBomb = (planet.inventory['anti_bomb']||0) > 0
    const hasVoidShield = (target.inventory['void_shield']||0) > 0
    const myPower = (planet.population + planet.resources.anti*3000) * (hasAntiBomb?1.4:1)
    const enemyPower = (target.population + calcTotalDefense(target)) * (hasVoidShield?1.4:1)

    const win = myPower > enemyPower
    let details = ''

    if (win) {
      const lootGoldEst = Math.floor((target.resources.dust*2000 + target.resources.core*8000) * 0.1)
      const dustLoot = Math.floor(target.resources.dust * 0.1)
      const coreLoot = Math.floor(target.resources.core * 0.05)

      // Update attacker
      const newInv = { ...planet.inventory }
      if (hasAntiBomb) { newInv.anti_bomb = Math.max(0, (newInv.anti_bomb||0)-1) }
      await updatePlanet({
        resources: { ...planet.resources, dust:planet.resources.dust+dustLoot, core:planet.resources.core+coreLoot },
        inventory: newInv,
        lastInvade: now,
        totalInvadeWins: (planet.totalInvadeWins||0)+1,
        planetXp: (planet.planetXp||0)+PLANET_XP_PER_ACTION.invade_win,
      })

      // Update target
      const newTargetInv = { ...target.inventory }
      if (hasVoidShield) newTargetInv.void_shield = Math.max(0,(newTargetInv.void_shield||0)-1)
      const newTargetRegions = target.regions.map((r,i) => i===0 ? {...r, hp:Math.max(0,r.hp-20)} : r)
      await setDoc(doc(db,'planets',targetUid), {
        ...target,
        population: Math.floor(target.population*0.9),
        stability: Math.max(0,(target.stability||100)-15),
        resources: { ...target.resources, dust:Math.max(0,target.resources.dust-dustLoot), core:Math.max(0,target.resources.core-coreLoot) },
        regions: newTargetRegions,
        inventory: newTargetInv,
        totalInvadeLosses: (target.totalInvadeLosses||0)+1,
      } as any)

      details = `Rampasan: +${dustLoot} Dust, +${coreLoot} Core\n💥 Sektor utama target rusak -20%\n📉 Stabilitas target -15%`
      setInvasionResult({ result:'win', details })
    } else {
      const lostPop = Math.floor(planet.population * 0.15)
      await updatePlanet({
        population: planet.population - lostPop,
        stability: Math.max(0, (planet.stability||100) - 10),
        lastInvade: now,
        totalInvadeLosses: (planet.totalInvadeLosses||0)+1,
      })
      // Defender gets XP
      await setDoc(doc(db,'planets',targetUid), {
        ...target,
        planetXp: (target.planetXp||0)+PLANET_XP_PER_ACTION.defend_win,
        totalInvadeWins: (target.totalInvadeWins||0)+1,
      } as any)

      details = `Pasukanmu mundur!\n👥 Populasi -${lostPop.toLocaleString()}\n🛡️ Stabilitas -10%\n\n${target.name} berhasil bertahan!`
      setInvasionResult({ result:'lose', details })
    }

    setView('invasion_result')
  }

  // ── RENAME ─────────────────────────────────────────────────
  const handleRename = async (newName: string) => {
    if (!newName.trim()) { toast('❌ Nama kosong!','danger'); return }
    const cost = 500000
    if (gold < cost) { toast(`❌ Butuh ${cost.toLocaleString()} Gold!`,'danger'); return }
    await updatePlanet({ name: newName.trim() })
    await onGoldChange(gold - cost)
    toast(`✅ Nama diubah jadi "${newName}"!`)
    setView('dashboard')
  }

  // ── CHECK TIER UP ──────────────────────────────────────────
  useEffect(() => {
    if (!planet || planet.tier >= 5) return
    const nextTierXp = TIER_XP[planet.tier]
    if (planet.planetXp >= nextTierXp) {
      const newTier = planet.tier + 1
      updatePlanet({ tier: newTier })
      toast(`🌟 TIER UP! Planet ${planet.name} naik ke T${newTier} ${TIER_NAMES[newTier-1]}!`)
    }
  }, [planet?.planetXp])

  // ═══════════ RENDER ═════════════════════════════════════════
  if (planet === undefined) {
    return (
      <div className="planet-wrap" style={{alignItems:'center',justifyContent:'center'}}>
        <StarField/>
        <div style={{fontSize:40,animation:'planet-float 3s ease-in-out infinite'}}>🪐</div>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:12}}>Memuat galaksi...</div>
      </div>
    )
  }

  // ── CREATE PLANET SCREEN ────────────────────────────────────
  if (planet === null) {
    return (
      <div className="planet-wrap">
        <StarField/>
        <div className="planet-header">
          <button className="planet-header-back" onClick={onBack}>✕</button>
          <div className="planet-header-title">🌌 Planet Builder</div>
        </div>
        <div className="planet-body">
          <div className="planet-create-wrap">
            <div className="planet-create-globe">🪐</div>
            <div className="planet-create-title">Ciptakan Planetmu</div>
            <div className="planet-create-sub">
              Bangun peradaban di galaksi KyokoMd.<br/>
              Tambang resource, bangun gedung, dan serang planet lain!
            </div>
            <input className="planet-create-input" placeholder="Nama planet..." value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleCreate(nameInput)} autoFocus/>
            <button className="planet-name-random-btn" onClick={() => {
              setNameInput(HSR_PLANET_NAMES[Math.floor(Math.random()*HSR_PLANET_NAMES.length)])
            }}>🎲 Nama HSR Random</button>
            <button className="planet-create-btn" disabled={loading} onClick={() => handleCreate(nameInput)}>
              {loading ? '✨ Membuat...' : '🚀 Ciptakan Planet'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── INVASION RESULT ─────────────────────────────────────────
  if (view === 'invasion_result' && invasionResult) {
    return (
      <div className="planet-wrap">
        <StarField/>
        <div className="planet-header">
          <div className="planet-header-title">⚔️ Battle Result</div>
        </div>
        <InvasionResult
          result={invasionResult.result}
          details={invasionResult.details}
          onClose={() => { setInvasionResult(null); setView('dashboard') }}
        />
      </div>
    )
  }

  // ── HOME (tab selector) ─────────────────────────────────────
  if (view === 'home') {
    return (
      <div className="planet-wrap">
        <StarField/>
        <div className="planet-header">
          <button className="planet-header-back" onClick={onBack}>✕</button>
          <div className="planet-header-title">🌌 {planet.name}</div>
          <div style={{ display:'flex', gap:6 }}>
            <button className="planet-header-back" onClick={() => setView('leaderboard')}>🏆</button>
          </div>
        </div>
        <div className="planet-body" style={{paddingTop:8}}>
          {msg && <div className={`planet-toast ${msgType}`}>{msg}</div>}
          <div className="planet-subtabs">
            {[
              {id:'dashboard',label:'🪐 Planet'},
              {id:'regions',label:'🗺️ Sektor'},
              {id:'craft',label:'🛠️ Craft'},
              {id:'sell',label:'💰 Jual'},
              {id:'invade',label:'⚔️ War'},
            ].map(t => (
              <button key={t.id} className={`planet-subtab ${view===t.id?'active':''}`}
                onClick={() => setView(t.id as PlanetView)}>
                {t.label}
              </button>
            ))}
          </div>
          <PlanetDashboard p={planet} onAction={handleAction} onNavigate={setView}/>
        </div>
      </div>
    )
  }

  // ── LEADERBOARD ─────────────────────────────────────────────
  if (view === 'leaderboard') {
    return (
      <div className="planet-wrap">
        <StarField/>
        <PlanetLeaderboard planets={allPlanets} onBack={() => setView('home')}/>
      </div>
    )
  }

  // ── RENAME ──────────────────────────────────────────────────
  if (view === 'rename') {
    return (
      <div className="planet-wrap">
        <StarField/>
        <div className="planet-header">
          <button className="planet-header-back" onClick={() => setView('home')}>‹ Kembali</button>
          <div className="planet-header-title">✏️ Rename Planet</div>
        </div>
        <div className="planet-body">
          <div className="planet-card">
            <div className="planet-input-label">Nama baru (biaya 500,000 Gold)</div>
            <input className="planet-input" placeholder={planet.name} value={nameInput}
              onChange={e => setNameInput(e.target.value)} style={{marginBottom:12}}/>
            <button className="planet-name-random-btn" style={{marginBottom:12,width:'100%'}}
              onClick={() => setNameInput(HSR_PLANET_NAMES[Math.floor(Math.random()*HSR_PLANET_NAMES.length)])}>
              🎲 Random HSR
            </button>
            <button className="planet-btn-primary" onClick={() => handleRename(nameInput)}>
              ✅ Ganti Nama
            </button>
          </div>
          {msg && <div className={`planet-toast ${msgType}`}>{msg}</div>}
        </div>
      </div>
    )
  }

  // ── MAIN VIEWS ──────────────────────────────────────────────
  return (
    <div className="planet-wrap">
      <StarField/>
      <div className="planet-header" style={{ position:'sticky', top:0, zIndex:5 }}>
        <button className="planet-header-back" onClick={() => setView('home')}>‹ Kembali</button>
        <div className="planet-header-title">
          {view==='dashboard' && `🪐 ${planet.name}`}
          {view==='regions' && '🗺️ Sektor Map'}
          {view==='craft' && '🛠️ Workshop'}
          {view==='sell' && '💰 Jual Resource'}
          {view==='invade' && '⚔️ Galactic War'}
        </div>
        {view==='dashboard' && <button className="planet-header-back" onClick={()=>setView('leaderboard')}>🏆</button>}
      </div>

      {msg && view !== 'invade' && (
        <div style={{padding:'0 12px'}}>
          <div className={`planet-toast ${msgType}`}>{msg}</div>
        </div>
      )}

      {view === 'dashboard' && (
        <PlanetDashboard p={planet} onAction={handleAction} onNavigate={setView}/>
      )}
      {view === 'regions' && (
        <RegionsView p={planet} gold={gold} onBuild={handleBuild} onFix={handleFix}
          onAddRegion={handleAddRegion} onBack={() => setView('home')}/>
      )}
      {view === 'craft' && (
        <CraftView p={planet} onCraft={handleCraft} onBack={() => setView('home')}/>
      )}
      {view === 'sell' && (
        <SellView p={planet} hasSellBonus={hasBuildingEffect(planet,'sell_bonus')}
          onSell={handleSell} onBack={() => setView('home')}/>
      )}
      {view === 'invade' && (
        <InvadeView
          myPlanet={planet} allPlanets={allPlanets}
          canInvade={planet.population >= 8000 && planet.stability >= 30}
          onSpy={handleSpy} onInvade={handleInvade} onBack={() => setView('home')}/>
      )}
    </div>
  )
}
