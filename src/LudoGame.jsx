import { useState, useEffect, useRef, useCallback } from "react"

// ══════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════
const LUDO_COLORS    = ['#3b82f6','#ef4444','#22c55e','#eab308']   // Blue(0) Red(1) Green(2) Yellow(3)
const LUDO_DARK      = ['#1d4ed8','#b91c1c','#15803d','#a16207']
const LUDO_LIGHT     = ['#bfdbfe','#fecaca','#bbf7d0','#fef08a']
const LUDO_NAMES     = ['Biru','Merah','Hijau','Kuning']
const LUDO_HOME_EMOJI= ['🔵','🔴','🟢','🟡']
// Player labels per corner
// 0=Blue(top-left), 1=Red(top-right), 2=Yellow(bottom-left), 3=Green(bottom-right)
// Layout matches image: Blue TL, Red TR, Yellow BL, Green BR
// We re-map colors so corners match the image:
// Slot 0 → Blue (TL) → Player 1
// Slot 1 → Red (TR)  → Player 3 (inverted label)
// Slot 2 → Yellow (BL) → Player 2
// Slot 3 → Green (BR) → no label visible

const START_POS  = [0, 13, 26, 39]
const ENTRY_POS  = [50, 11, 24, 37]
const SAFE_CELLS = [0, 8, 13, 21, 26, 34, 39, 47]

function rollDice() { return Math.floor(Math.random()*6)+1 }

function ludoAdvance(curPos, color, steps) {
  if(curPos===58) return 58
  const ep = ENTRY_POS[color]
  if(curPos>=100){
    const np = curPos+steps
    if(np>105) return curPos
    if(np===105) return 58
    return np
  }
  let pos=curPos
  for(let i=0;i<steps;i++){
    if(pos===ep){ pos=100; let rem=steps-(i+1); pos=ludoAdvanceHome(pos,rem); break }
    pos=(pos+1)%52
  }
  return pos
}
function ludoAdvanceHome(pos,steps){
  const np=pos+steps
  if(np>105) return pos
  if(np===105) return 58
  return np>105?pos:np
}
function ludoCanMove(player,dice){
  return player.tokens.some(t=>{
    if(t.pos===58) return false
    if(t.pos===-1) return dice===6
    return true
  })
}
function ludoAIChoose(player,dice,allPlayers){
  const movable=player.tokens.filter(t=>{
    if(t.pos===58) return false
    if(t.pos===-1) return dice===6
    return true
  })
  if(!movable.length) return -1
  for(const t of movable){
    const np=t.pos===-1?START_POS[player.color]:ludoAdvance(t.pos,player.color,dice)
    if(np===58) return t.id
  }
  for(const t of movable){
    if(t.pos===-1) continue
    const np=ludoAdvance(t.pos,player.color,dice)
    const capture=allPlayers.some(p=>p.index!==player.index&&p.tokens.some(et=>et.pos===np&&np<100&&np!==-1&&!SAFE_CELLS.includes(np)))
    if(capture) return t.id
  }
  const onBoard=movable.filter(t=>t.pos!==-1).sort((a,b)=>b.pos-a.pos)
  if(onBoard.length) return onBoard[0].id
  if(dice===6) return movable.find(t=>t.pos===-1)?.id??movable[0].id
  return movable[0].id
}

// ══════════════════════════════════════════
// DICE FACES
// ══════════════════════════════════════════
const DICE_DOTS = {
  1:[[50,50]],
  2:[[28,28],[72,72]],
  3:[[28,28],[50,50],[72,72]],
  4:[[28,28],[72,28],[28,72],[72,72]],
  5:[[28,28],[72,28],[50,50],[28,72],[72,72]],
  6:[[28,22],[72,22],[28,50],[72,50],[28,78],[72,78]],
}

function DiceBox({ value, rolling, size=72, highlight=false }) {
  const dots = DICE_DOTS[value||1]||DICE_DOTS[1]
  return (
    <div style={{
      width:size, height:size, flexShrink:0, position:'relative',
      borderRadius:size*0.2,
      background:'linear-gradient(145deg,#ffffff 0%,#f0ede8 50%,#ddd8d0 100%)',
      boxShadow: highlight
        ? `0 0 0 3px #facc15, 0 6px 20px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.9)`
        : `0 6px 18px rgba(0,0,0,0.45), inset 0 2px 4px rgba(255,255,255,0.85), 3px 5px 10px rgba(0,0,0,0.3)`,
      animation: rolling ? 'diceSpin 0.15s linear infinite' : 'none',
    }}>
      {/* shine */}
      <div style={{position:'absolute',top:'6%',left:'10%',width:'38%',height:'25%',background:'rgba(255,255,255,0.6)',borderRadius:'50%',filter:'blur(3px)',transform:'rotate(-15deg)'}}/>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{position:'absolute',inset:0}}>
        {dots.map(([cx,cy],i)=>(
          <g key={i}>
            <circle cx={cx+1} cy={cy+2} r={9.5} fill="rgba(0,0,0,0.2)"/>
            <circle cx={cx} cy={cy} r={9.5} fill="#1e1b4b"/>
            <circle cx={cx-3} cy={cy-3} r={3} fill="rgba(255,255,255,0.25)"/>
          </g>
        ))}
      </svg>
      {/* right 3d edge */}
      <div style={{position:'absolute',top:'8%',right:'-5%',bottom:'8%',width:'9%',background:'linear-gradient(to right,#c0bbb3,#8a8078)',borderRadius:`0 ${size*0.1}px ${size*0.1}px 0`,transform:'skewY(-3deg)'}}/>
      {/* bottom 3d edge */}
      <div style={{position:'absolute',bottom:'-5%',left:'8%',right:'8%',height:'9%',background:'linear-gradient(to bottom,#aaa49c,#706860)',borderRadius:`0 0 ${size*0.1}px ${size*0.1}px`,transform:'skewX(-3deg)'}}/>
    </div>
  )
}

// ══════════════════════════════════════════
// MAP PIN (pion) — mirip gambar
// ══════════════════════════════════════════
function MapPin({ color, size=26, glow=false, num=1 }) {
  const h = size, w = size*0.8
  return (
    <svg width={w} height={h} viewBox="0 0 80 100" style={{
      filter: glow
        ? `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 10px ${color}88)`
        : `drop-shadow(0 3px 3px rgba(0,0,0,0.5))`
    }}>
      {/* shadow */}
      <ellipse cx={40} cy={97} rx={14} ry={4} fill="rgba(0,0,0,0.3)"/>
      {/* tail */}
      <path d="M40,92 Q28,72 22,55 Q16,40 40,38 Q64,38 58,55 Q52,72 40,92Z" fill={color} opacity={0.88}/>
      {/* head bg */}
      <circle cx={40} cy={34} r={32} fill={color}/>
      {/* radial shading */}
      <circle cx={40} cy={34} r={32} fill="url(#pg1)"/>
      {/* inner ring */}
      <circle cx={40} cy={34} r={20} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.55)" strokeWidth={2}/>
      {/* shine */}
      <ellipse cx={30} cy={24} rx={12} ry={8} fill="rgba(255,255,255,0.55)" transform="rotate(-20 30 24)"/>
      {/* number */}
      <text x={40} y={40} textAnchor="middle" fontSize={16} fill="white" fontWeight="bold" fontFamily="Arial"
        style={{textShadow:'0 1px 3px rgba(0,0,0,0.5)'}}>{num}</text>
      <defs>
        <radialGradient id="pg1" cx="38%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.4)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.35)"/>
        </radialGradient>
      </defs>
    </svg>
  )
}

// ══════════════════════════════════════════
// LUDO BOARD — full SVG 15×15
// ══════════════════════════════════════════
// Colors per image: TL=Blue, TR=Red, BL=Yellow, BR=Green
// color index: 0=Blue(TL), 1=Red(TR), 2=Yellow(BL), 3=Green(BR)
const BOARD_COLORS = ['#3b82f6','#ef4444','#eab308','#22c55e']
const BOARD_COLORS_LIGHT = ['#60a5fa','#f87171','#fde047','#4ade80']

const PATH_COORDS = [
  [6,14],[6,13],[6,12],[6,11],[6,10],[6,9],
  [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
  [0,7],
  [0,6],[1,6],[2,6],[3,6],[4,6],[5,6],
  [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
  [7,0],
  [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],
  [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
  [14,7],
  [14,8],[13,8],[12,8],[11,8],[10,8],[9,8],
  [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
  [7,14],
]
const HOME_STRETCH = [
  [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],   // Blue(0) → from bottom
  [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],        // Red(1)  → from left
  [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],        // Yellow(2) → from top  (was Green)
  [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],    // Green(3) → from right (was Yellow)
]
const HOME_BASE = [
  [[1.5,11.5],[3.5,11.5],[1.5,13.5],[3.5,13.5]], // Blue(0) BL quad
  [[11.5,1.5],[13.5,1.5],[11.5,3.5],[13.5,3.5]], // Red(1) TR quad
  [[1.5,1.5],[3.5,1.5],[1.5,3.5],[3.5,3.5]],     // Yellow(2) TL quad
  [[11.5,11.5],[13.5,11.5],[11.5,13.5],[13.5,13.5]], // Green(3) BR quad
]

function LudoBoard({ players, movable, onTokenClick, animPos }) {
  const CELL = 30
  const BOARD = 15*CELL

  const getPosXY = (pos, color) => {
    if(pos===-1) return [-999,-999]
    if(pos===58) return [7*CELL+CELL/2, 7*CELL+CELL/2]
    if(pos>=100){
      const step=Math.min(pos-100,5)
      const [col,row]=HOME_STRETCH[color][step]
      return [col*CELL+CELL/2, row*CELL+CELL/2]
    }
    const [col,row]=PATH_COORDS[pos]
    return [col*CELL+CELL/2, row*CELL+CELL/2]
  }

  const getTokenDisplayPos = (token, pIdx) => {
    const key=`${pIdx}-${token.id}`
    const override=animPos[key]
    if(override!==undefined) return getPosXY(override, token.color)
    if(token.pos===-1){
      const [bx,by]=HOME_BASE[token.color][token.id]
      return [bx*CELL, by*CELL]
    }
    return getPosXY(token.pos, token.color)
  }

  // Home zone rectangles: TL=Blue, TR=Red, BL=Yellow, BR=Green
  const homeZones = [
    {x:0,     y:CELL*9, color:BOARD_COLORS[0], light:BOARD_COLORS_LIGHT[0]},  // Blue BL? 
    {x:CELL*9,y:0,      color:BOARD_COLORS[1], light:BOARD_COLORS_LIGHT[1]},  // Red TR
    {x:0,     y:0,      color:BOARD_COLORS[2], light:BOARD_COLORS_LIGHT[2]},  // Yellow TL
    {x:CELL*9,y:CELL*9, color:BOARD_COLORS[3], light:BOARD_COLORS_LIGHT[3]},  // Green BR
  ]
  // Match image: Blue=TL, Red=TR, Yellow=BL, Green=BR
  const homeZonesFixed = [
    {x:0,     y:0,      color:BOARD_COLORS[0], light:BOARD_COLORS_LIGHT[0], idx:0}, // Blue TL
    {x:CELL*9,y:0,      color:BOARD_COLORS[1], light:BOARD_COLORS_LIGHT[1], idx:1}, // Red TR
    {x:0,     y:CELL*9, color:BOARD_COLORS[2], light:BOARD_COLORS_LIGHT[2], idx:2}, // Yellow BL
    {x:CELL*9,y:CELL*9, color:BOARD_COLORS[3], light:BOARD_COLORS_LIGHT[3], idx:3}, // Green BR
  ]

  // Home stretch fill colors (home lanes)
  const homeStretchColors = [
    BOARD_COLORS[0], // Blue
    BOARD_COLORS[1], // Red
    BOARD_COLORS[2], // Yellow
    BOARD_COLORS[3], // Green
  ]

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${BOARD} ${BOARD}`}
      style={{
        borderRadius:8,
        border:'3px solid #d97706',
        boxShadow:'0 4px 32px rgba(0,0,0,0.7)',
        display:'block',
      }}
    >
      {/* Board background white */}
      <rect width={BOARD} height={BOARD} fill="#ffffff"/>

      {/* HOME ZONES — 6×6 colored quadrants */}
      {homeZonesFixed.map((z,i)=>(
        <g key={i}>
          <rect x={z.x} y={z.y} width={CELL*6} height={CELL*6} fill={z.color}/>
          {/* inner lighter panel */}
          <rect x={z.x+CELL*0.5} y={z.y+CELL*0.5} width={CELL*5} height={CELL*5} fill={z.light} rx={6}/>
          {/* 4 token circles */}
          {HOME_BASE[i].map(([bx,by],k)=>(
            <g key={k}>
              <circle cx={bx*CELL} cy={by*CELL} r={CELL*0.45} fill="rgba(255,255,255,0.5)" stroke={z.color} strokeWidth={2.5}/>
              <circle cx={bx*CELL} cy={by*CELL} r={CELL*0.32} fill="rgba(255,255,255,0.35)"/>
            </g>
          ))}
        </g>
      ))}

      {/* PATH CELLS */}
      {PATH_COORDS.map(([col,row],i)=>{
        const isSafe=SAFE_CELLS.includes(i)
        const startIdx=[0,13,26,39].indexOf(i)
        let fill='#ffffff'
        // colored start cells
        if(startIdx===0)  fill=BOARD_COLORS[0]  // Blue
        else if(startIdx===1) fill=BOARD_COLORS[1] // Red
        else if(startIdx===2) fill=BOARD_COLORS[2] // Yellow
        else if(startIdx===3) fill=BOARD_COLORS[3] // Green
        // home stretch approach lanes
        else if(col===7&&row<=6&&row>=1) fill='#bbf7d0'   // green lane top
        else if(col===7&&row>=9&&row<=13) fill='#bfdbfe'  // blue lane bottom
        else if(row===7&&col<=6&&col>=1) fill='#fecaca'   // red lane left
        else if(row===7&&col>=9&&col<=13) fill='#fef08a'  // yellow lane right
        return (
          <g key={i}>
            <rect x={col*CELL+1} y={row*CELL+1} width={CELL-2} height={CELL-2}
              fill={fill} rx={2}
              stroke={isSafe?'#aaa':'#e0e0e0'}
              strokeWidth={isSafe?1.5:0.5}/>
            {isSafe&&<text x={col*CELL+CELL/2} y={row*CELL+CELL/2+5} textAnchor="middle" fontSize={14} fill="#aaa">★</text>}
            {startIdx>=0&&<text x={col*CELL+CELL/2} y={row*CELL+CELL/2+5} textAnchor="middle" fontSize={10} fill="white" fontWeight="bold">▶</text>}
          </g>
        )
      })}

      {/* HOME STRETCH LANES */}
      {HOME_STRETCH.map((path,c)=>
        path.map(([col,row],step)=>(
          <rect key={`hs-${c}-${step}`}
            x={col*CELL+1} y={row*CELL+1} width={CELL-2} height={CELL-2}
            fill={homeStretchColors[c]}
            opacity={step===5?1:0.45} rx={2}
            stroke={step===5?'#fff':'none'} strokeWidth={step===5?1:0}/>
        ))
      )}

      {/* CENTER — 4 triangles + star */}
      <polygon points={`${7*CELL},${7*CELL} ${7*CELL},${8*CELL} ${7.5*CELL},${7.5*CELL}`} fill={BOARD_COLORS[0]}/>
      <polygon points={`${8*CELL},${7*CELL} ${8*CELL},${8*CELL} ${7.5*CELL},${7.5*CELL}`} fill={BOARD_COLORS[1]}/>
      <polygon points={`${7*CELL},${7*CELL} ${8*CELL},${7*CELL} ${7.5*CELL},${7.5*CELL}`} fill={BOARD_COLORS[2]}/>
      <polygon points={`${7*CELL},${8*CELL} ${8*CELL},${8*CELL} ${7.5*CELL},${7.5*CELL}`} fill={BOARD_COLORS[3]}/>
      <circle cx={7.5*CELL} cy={7.5*CELL} r={CELL*0.58} fill="white" opacity={0.9}/>
      <text x={7.5*CELL} y={7.5*CELL+7} textAnchor="middle" fontSize={18} fill="#f59e0b">★</text>

      {/* Grid lines subtle */}
      {Array.from({length:16},(_,i)=>(
        <line key={`v${i}`} x1={i*CELL} y1={0} x2={i*CELL} y2={BOARD} stroke="#d1d5db" strokeWidth={0.4}/>
      ))}
      {Array.from({length:16},(_,i)=>(
        <line key={`h${i}`} x1={0} y1={i*CELL} x2={BOARD} y2={i*CELL} stroke="#d1d5db" strokeWidth={0.4}/>
      ))}

      {/* TOKENS */}
      {players.flatMap(p=>
        p.tokens.map(token=>{
          const [tx,ty]=getTokenDisplayPos(token,p.index)
          if(tx===-999) return null
          const isMovable=movable.includes(token.id)&&true
          const pinW=20, pinH=28
          return (
            <g key={`tok-${p.index}-${token.id}`}
              onClick={()=>isMovable&&onTokenClick(p.index,token.id)}
              style={{cursor:isMovable?'pointer':'default'}}
              transform={`translate(${tx-pinW/2},${ty-pinH+4})`}>
              {/* bounce ring */}
              {isMovable&&(
                <ellipse cx={pinW/2} cy={pinH+2} rx={pinW*0.7} ry={4} fill={BOARD_COLORS[p.color]} opacity={0.35}>
                  <animate attributeName="rx" values={`${pinW*0.5};${pinW*0.9};${pinW*0.5}`} dur="0.8s" repeatCount="indefinite"/>
                </ellipse>
              )}
              <ellipse cx={pinW/2} cy={pinH+1} rx={pinW*0.45} ry={2.5} fill="rgba(0,0,0,0.3)"/>
              <path d={`M${pinW/2},${pinH} Q${pinW*0.3},${pinH*0.75} ${pinW*0.2},${pinH*0.55} Q${pinW*0.05},${pinH*0.42} ${pinW/2},${pinH*0.42} Q${pinW*0.95},${pinH*0.42} ${pinW*0.8},${pinH*0.55} Q${pinW*0.7},${pinH*0.75} ${pinW/2},${pinH}Z`}
                fill={BOARD_COLORS[p.color]} opacity={0.88}/>
              <circle cx={pinW/2} cy={pinW*0.48} r={pinW*0.46} fill={BOARD_COLORS[p.color]}/>
              <circle cx={pinW/2} cy={pinW*0.48} r={pinW*0.46} fill="url(#pGrad)"/>
              <circle cx={pinW/2} cy={pinW*0.48} r={pinW*0.28} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.5)" strokeWidth={0.8}/>
              <ellipse cx={pinW*0.37} cy={pinW*0.34} rx={pinW*0.16} ry={pinW*0.11} fill="rgba(255,255,255,0.6)" transform={`rotate(-20,${pinW*0.37},${pinW*0.34})`}/>
              <text x={pinW/2} y={pinW*0.54+3} textAnchor="middle" fontSize={7} fill="white" fontWeight="bold">{token.id+1}</text>
              {isMovable&&<circle cx={pinW/2} cy={pinW*0.48} r={pinW*0.46} fill="none" stroke="white" strokeWidth={2} opacity={0.9}>
                <animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite"/>
              </circle>}
            </g>
          )
        })
      )}

      <defs>
        <radialGradient id="pGrad" cx="38%" cy="32%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)"/>
          <stop offset="100%" stopColor="rgba(0,0,0,0.3)"/>
        </radialGradient>
      </defs>
    </svg>
  )
}

// ══════════════════════════════════════════
// PLAYER PANEL (top/bottom bars like image)
// ══════════════════════════════════════════
function PlayerPanel({ player, side, dice, isActive, rolling }) {
  if(!player) return <div style={{flex:1}}/>
  const color = BOARD_COLORS[player.color]
  const isHuman = !player.isAI

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:6,
      background: isActive ? `${color}22` : 'rgba(255,255,255,0.05)',
      border:`2px solid ${isActive?color:'transparent'}`,
      borderRadius:10, padding:'6px 8px', flex:1,
      boxShadow: isActive?`0 0 12px ${color}55`:'none',
      transition:'all 0.3s',
      flexDirection: side==='right' ? 'row-reverse':'row',
    }}>
      {/* color pin icon */}
      <div style={{
        width:32,height:32,borderRadius:'50%',
        background:`radial-gradient(circle at 40% 35%,${color}dd,${LUDO_DARK[player.color]})`,
        border:`2px solid rgba(255,255,255,0.4)`,
        display:'flex',alignItems:'center',justifyContent:'center',
        flexShrink:0,
        boxShadow: isActive?`0 0 8px ${color}88`:undefined,
      }}>
        <span style={{fontSize:14}}>{LUDO_HOME_EMOJI[player.color]}</span>
      </div>
      {/* dice box */}
      {isActive && (
        <div style={{
          width:44,height:44,flexShrink:0,
          background:'linear-gradient(145deg,#fff 0%,#f0ede8 50%,#ddd8d0 100%)',
          borderRadius:8,
          boxShadow:'0 3px 10px rgba(0,0,0,0.4), inset 0 1px 3px rgba(255,255,255,0.8)',
          display:'flex',alignItems:'center',justifyContent:'center',
          position:'relative',overflow:'hidden',
        }}>
          {dice!==null ? (
            <DiceBox value={dice} rolling={rolling} size={44}/>
          ):(
            <span style={{fontSize:22}}>🎲</span>
          )}
        </div>
      )}
      {!isActive && (
        <div style={{
          width:44,height:44,flexShrink:0,
          background:'rgba(255,255,255,0.08)',
          borderRadius:8,opacity:0.4,
        }}/>
      )}
    </div>
  )
}

// ══════════════════════════════════════════
// DIRECTION ARROW overlay on board
// ══════════════════════════════════════════
function Arrow({ dir }) {
  const arrows = { up:'↑', down:'↓', left:'←', right:'→' }
  return <span style={{fontSize:14,color:'#666'}}>{arrows[dir]}</span>
}

// ══════════════════════════════════════════
// LOBBY
// ══════════════════════════════════════════
function LudoLobby({ slots, setSlots, onStart, onBack }) {
  const activeCount = slots.filter(s=>s!=='empty').length
  const presets = [
    {label:'1 vs AI',   cfg:['human','ai','empty','empty']},
    {label:'1 vs 3 AI', cfg:['human','ai','ai','ai']},
    {label:'2 Pemain',  cfg:['human','human','empty','empty']},
    {label:'4 Pemain',  cfg:['human','human','human','human']},
  ]
  return (
    <div style={{
      minHeight:'100vh',display:'flex',flexDirection:'column',
      background:'linear-gradient(135deg,#1e3a5f 0%,#0f1c2e 100%)',
      fontFamily:"'Segoe UI',sans-serif",padding:'0 16px 24px',
    }}>
      <style>{`
        @keyframes diceSpin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes bounceIn { 0%{transform:scale(0.8)}60%{transform:scale(1.05)}100%{transform:scale(1)} }
      `}</style>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'20px 0 16px'}}>
        <button onClick={onBack} style={{background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:8,padding:'6px 14px',color:'rgba(255,255,255,0.7)',fontSize:13,cursor:'pointer'}}>←</button>
        <div style={{flex:1,textAlign:'center'}}>
          <div style={{fontSize:28,fontWeight:900,color:'#f59e0b',letterSpacing:2,textShadow:'0 0 20px rgba(245,158,11,0.5)'}}>🎲 LUDO</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1}}>Atur Pemain</div>
        </div>
      </div>
      {/* Preset buttons */}
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16,justifyContent:'center'}}>
        {presets.map(p=>(
          <button key={p.label} onClick={()=>setSlots(p.cfg)}
            style={{padding:'6px 14px',borderRadius:20,background:'rgba(245,158,11,0.12)',border:'1px solid rgba(245,158,11,0.35)',color:'#f59e0b',fontSize:11,fontWeight:700,cursor:'pointer'}}>
            {p.label}
          </button>
        ))}
      </div>
      {/* Player slots */}
      <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:20}}>
        {[0,1,2,3].map(i=>{
          const s=slots[i]
          const color=BOARD_COLORS[i]
          return (
            <button key={i} onClick={()=>{
              const next=[...slots]
              next[i]=s==='human'?'ai':s==='ai'?'empty':'human'
              setSlots(next)
            }} style={{
              display:'flex',alignItems:'center',gap:12,
              background:s==='empty'?'rgba(255,255,255,0.02)':`${color}18`,
              border:`1.5px solid ${s==='empty'?'rgba(255,255,255,0.08)':color+'44'}`,
              borderRadius:14,padding:'12px 14px',cursor:'pointer',textAlign:'left',
            }}>
              <div style={{
                width:38,height:38,borderRadius:'50%',flexShrink:0,
                background:s==='empty'?'rgba(255,255,255,0.06)':`radial-gradient(circle at 40% 35%,${color}cc,${LUDO_DARK[i]})`,
                display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,
                boxShadow:s!=='empty'?`0 0 10px ${color}55`:undefined,
              }}>
                {s==='empty'?'—':LUDO_HOME_EMOJI[i]}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:800,color:s==='empty'?'rgba(255,255,255,0.3)':'#fff'}}>
                  {LUDO_NAMES[i]}
                </div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:1}}>
                  {s==='human'?'👤 Pemain Manusia':s==='ai'?'🤖 AI Komputer':'Slot kosong'}
                </div>
              </div>
              <span style={{
                fontSize:11,padding:'3px 10px',borderRadius:99,fontWeight:700,
                background:s==='human'?'rgba(59,130,246,0.2)':s==='ai'?'rgba(245,158,11,0.2)':'rgba(255,255,255,0.06)',
                color:s==='human'?'#60a5fa':s==='ai'?'#f59e0b':'rgba(255,255,255,0.3)',
              }}>
                {s==='human'?'MANUSIA':s==='ai'?'AI':'KOSONG'}
              </span>
            </button>
          )
        })}
      </div>
      {activeCount<2&&<div style={{textAlign:'center',fontSize:11,color:'#f87171',marginBottom:10}}>⚠️ Minimal 2 pemain untuk mulai</div>}
      <button onClick={onStart} disabled={activeCount<2} style={{
        width:'100%',padding:'16px',borderRadius:14,border:'none',
        background:activeCount>=2?'linear-gradient(135deg,#f59e0b,#d97706)':'rgba(255,255,255,0.05)',
        color:activeCount>=2?'#000':'rgba(255,255,255,0.2)',
        fontSize:16,fontWeight:900,cursor:activeCount>=2?'pointer':'default',
        boxShadow:activeCount>=2?'0 6px 24px rgba(245,158,11,0.5)':undefined,
        letterSpacing:1,
      }}>
        {activeCount>=2?`🎲 MULAI MAIN! (${activeCount} Pemain)`:'Min. 2 Pemain'}
      </button>
    </div>
  )
}

// ══════════════════════════════════════════
// GAME OVER
// ══════════════════════════════════════════
function GameOver({ players, onReplay, onMenu }) {
  const sorted=[...players].sort((a,b)=>(a.rank||99)-(b.rank||99))
  return (
    <div style={{
      minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      background:'linear-gradient(135deg,#1e3a5f 0%,#0f1c2e 100%)',
      fontFamily:"'Segoe UI',sans-serif",gap:16,padding:24,
    }}>
      <div style={{fontSize:52,filter:'drop-shadow(0 0 20px rgba(245,158,11,0.6))'}}>🏆</div>
      <div style={{fontSize:26,fontWeight:900,color:'#f59e0b',letterSpacing:2}}>GAME SELESAI!</div>
      <div style={{width:'100%',maxWidth:360,display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((p,i)=>(
          <div key={p.index} style={{
            display:'flex',alignItems:'center',gap:12,
            background:`${BOARD_COLORS[p.color]}18`,
            border:`1.5px solid ${BOARD_COLORS[p.color]}44`,
            borderRadius:14,padding:'12px 16px',
          }}>
            <div style={{fontSize:24}}>{['🥇','🥈','🥉','4️⃣'][i]}</div>
            <div style={{
              width:12,height:12,borderRadius:'50%',
              background:BOARD_COLORS[p.color],flexShrink:0
            }}/>
            <div style={{flex:1,fontSize:15,fontWeight:800,color:'#fff'}}>{p.name}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{p.isAI?'🤖':'👤'}</div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:10,width:'100%',maxWidth:360}}>
        <button onClick={onReplay} style={{flex:1,padding:'13px',background:'rgba(245,158,11,0.15)',border:'1px solid rgba(245,158,11,0.4)',borderRadius:12,color:'#f59e0b',fontWeight:900,fontSize:13,cursor:'pointer'}}>🔄 Main Lagi</button>
        <button onClick={onMenu} style={{flex:1,padding:'13px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.15)',borderRadius:12,color:'rgba(255,255,255,0.6)',fontWeight:700,fontSize:13,cursor:'pointer'}}>🏠 Menu</button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════
// MAIN LUDO GAME — mirip gambar
// ══════════════════════════════════════════
export default function LudoGame({ onBack }) {
  const [phase, setPhase]             = useState('lobby')
  const [slots, setSlots]             = useState(['human','ai','ai','ai'])
  const [players, setPlayers]         = useState([])
  const [currentTurn, setCurrentTurn] = useState(0)
  const [dice, setDice]               = useState(null)
  const [rolling, setRolling]         = useState(false)
  const [movable, setMovable]         = useState([])
  const [log, setLog]                 = useState([])
  const [aiThinking, setAiThinking]   = useState(false)
  const [diceCount, setDiceCount]     = useState(0)
  const [animPos, setAnimPos]         = useState({})

  // ── Refs untuk hindari stale closure ──
  const playersRef      = useRef([])
  const currentTurnRef  = useRef(0)
  const diceRef         = useRef(null)
  const diceCountRef    = useRef(0)
  const rollingRef      = useRef(false)
  const aiThinkingRef   = useRef(false)
  const phaseRef        = useRef('lobby')
  const aiTimerRef      = useRef(null)
  const animTimerRef    = useRef(null)

  // Sync refs ke state
  useEffect(()=>{ playersRef.current=players },[players])
  useEffect(()=>{ currentTurnRef.current=currentTurn },[currentTurn])
  useEffect(()=>{ diceRef.current=dice },[dice])
  useEffect(()=>{ diceCountRef.current=diceCount },[diceCount])
  useEffect(()=>{ rollingRef.current=rolling },[rolling])
  useEffect(()=>{ aiThinkingRef.current=aiThinking },[aiThinking])
  useEffect(()=>{ phaseRef.current=phase },[phase])

  const curPlayer = players[currentTurn]||null

  const addLog = useCallback((msg) => setLog(prev=>[msg,...prev].slice(0,8)),[])

  // ── turn advance — pakai ref, bukan closure ──
  const advanceTurn = useCallback((playersState, fromIdx, gotSix, sixCount) => {
    if(gotSix && sixCount<3){
      setCurrentTurn(fromIdx)
      setDice(null); diceRef.current=null
      setMovable([])
      setLog(prev=>[`${playersState[fromIdx]?.name||'?'} dapat 6 → giliran lagi!`,...prev].slice(0,8))
    } else {
      let next=(fromIdx+1)%playersState.length
      let tries=0
      while(playersState[next]?.finished && tries<playersState.length){
        next=(next+1)%playersState.length; tries++
      }
      setCurrentTurn(next)
      setDice(null); diceRef.current=null
      setMovable([])
    }
  },[])

  // ── move token — semua baca dari ref, bukan closure ──
  const moveToken = useCallback((tokenId) => {
    const curDice    = diceRef.current
    const curTurnIdx = currentTurnRef.current
    const allPlayers = playersRef.current
    const curDiceCount = diceCountRef.current

    const cp = allPlayers[curTurnIdx]
    if(!curDice||!cp) return
    setMovable([])

    const token = cp.tokens.find(t=>t.id===tokenId)
    if(!token) return
    const key = `${cp.index}-${tokenId}`

    // Build step path
    let steps=[]
    if(token.pos===-1){
      steps=[START_POS[cp.color]]
    } else if(token.pos>=100){
      let cur=token.pos
      for(let i=0;i<curDice;i++){
        const nx=cur+1
        if(nx>105) break
        cur=nx>=105?58:nx
        steps.push(cur)
        if(cur===58) break
      }
    } else {
      let cur=token.pos
      for(let i=0;i<curDice;i++){
        const ep=ENTRY_POS[cp.color]
        if(cur===ep){
          // masuk jalur aman
          let homePos=100
          const rem=curDice-(i+1)
          for(let j=0;j<rem;j++){
            if(homePos>=105){ homePos=homePos; break }
            homePos = homePos+1>=105 ? 58 : homePos+1
            if(homePos===58) break
          }
          steps.push(homePos)
          break
        }
        cur=(cur+1)%52
        steps.push(cur)
      }
    }
    if(!steps.length) return

    const finalPos = steps[steps.length-1]
    setAnimPos(prev=>({...prev,[key]:token.pos}))

    let stepIdx=0
    const doStep=()=>{
      stepIdx++
      if(stepIdx>=steps.length){
        // Animasi selesai → terapkan state
        setAnimPos(prev=>{ const n={...prev}; delete n[key]; return n })

        // Kumpulkan log messages dulu, baru set state
        const logMessages=[]

        setPlayers(prev=>{
          const next=prev.map(p=>({...p,tokens:p.tokens.map(t=>({...t}))}))
          const pl=next.find(p=>p.index===cp.index)
          if(!pl) return prev
          const tk=pl.tokens.find(t=>t.id===tokenId)
          if(!tk) return prev
          tk.pos=finalPos

          logMessages.push(`${pl.name} pion ${tokenId+1} → ${finalPos===58?'FINISH!':finalPos}`)

          let captured=false
          if(finalPos>=0&&finalPos<52&&!SAFE_CELLS.includes(finalPos)){
            next.forEach(p=>{
              if(p.index===pl.index) return
              p.tokens.forEach(et=>{
                if(et.pos===finalPos){
                  et.pos=-1
                  logMessages.push(`💥 ${pl.name} hajar pion ${p.name}!`)
                  captured=true
                }
              })
            })
          }

          const allDone=pl.tokens.every(t=>t.pos===58)
          if(allDone){
            const ranks=next.filter(p=>p.rank>0).length
            pl.finished=true; pl.rank=ranks+1
            logMessages.push(`🏆 ${pl.name} selesai! #${pl.rank}`)
            const active=next.filter(p=>!p.finished)
            if(active.length<=1){
              if(active.length===1) active[0].rank=next.filter(p=>p.rank>0).length+1
              // flush log lalu game over
              setLog(old=>[...logMessages,...old].slice(0,8))
              setTimeout(()=>setPhase('over'),800)
              return next
            }
          }

          const gotSix  = curDice===6
          const newSixCount = gotSix ? curDiceCount+1 : 0
          setDiceCount(newSixCount); diceCountRef.current=newSixCount
          const gotExtra = (gotSix||captured)&&!allDone

          // flush log
          setLog(old=>[...logMessages,...old].slice(0,8))
          setTimeout(()=>advanceTurn(next, curTurnIdx, gotExtra, newSixCount), 250)
          return next
        })
        return
      }
      setAnimPos(prev=>({...prev,[key]:steps[stepIdx-1]}))
      animTimerRef.current=setTimeout(doStep,160)
    }
    animTimerRef.current=setTimeout(doStep,80)
  },[advanceTurn])

  // ── Fungsi shared untuk proses hasil dadu ──
  const processDiceResult = useCallback((fd, cp, allPlayers, curTurnIdx, curDiceCount) => {
    const canMove = cp.tokens
      .filter(t=>{
        if(t.pos===58) return false
        if(t.pos===-1) return fd===6
        return true
      })
      .map(t=>t.id)

    if(!canMove.length){
      setLog(old=>[`${cp.name} dapat ${fd} — tidak bisa gerak`,...old].slice(0,8))
      setTimeout(()=>advanceTurn(allPlayers, curTurnIdx, fd===6, fd===6?curDiceCount+1:0), 800)
    } else if(canMove.length===1){
      setTimeout(()=>moveToken(canMove[0]), 400)
    } else {
      setMovable(canMove)
    }
  },[advanceTurn, moveToken])

  // ── roll (human) ──
  const handleRoll = useCallback(()=>{
    if(rollingRef.current||aiThinkingRef.current) return
    const cp = playersRef.current[currentTurnRef.current]
    if(!cp||cp.isAI||diceRef.current!==null) return

    setRolling(true); rollingRef.current=true
    let count=0
    const anim=setInterval(()=>{
      setDice(rollDice()); count++
      if(count>=10){
        clearInterval(anim)
        const fd=rollDice()
        setDice(fd); diceRef.current=fd
        setRolling(false); rollingRef.current=false
        processDiceResult(fd, cp, playersRef.current, currentTurnRef.current, diceCountRef.current)
      }
    },70)
  },[processDiceResult])

  // ── AI turn ──
  useEffect(()=>{
    if(phase!=='playing') return
    const cp=players[currentTurn]
    if(!cp?.isAI||dice!==null||rolling) return

    setAiThinking(true); aiThinkingRef.current=true
    aiTimerRef.current=setTimeout(()=>{
      setRolling(true); rollingRef.current=true
      let count=0
      const anim=setInterval(()=>{
        setDice(rollDice()); count++
        if(count>=8){
          clearInterval(anim)
          const fd=rollDice()
          setDice(fd); diceRef.current=fd
          setRolling(false); rollingRef.current=false
          setAiThinking(false); aiThinkingRef.current=false

          // Snapshot terkini dari ref
          const snapPlayers = playersRef.current
          const snapTurn    = currentTurnRef.current
          const snapCp      = snapPlayers[snapTurn]
          const snapDiceCount = diceCountRef.current

          if(!snapCp) return

          const canMove = snapCp.tokens
            .filter(t=>{
              if(t.pos===58) return false
              if(t.pos===-1) return fd===6
              return true
            })
            .map(t=>t.id)

          if(!canMove.length){
            setLog(old=>[`${snapCp.name} dapat ${fd} — tidak bisa gerak`,...old].slice(0,8))
            setTimeout(()=>advanceTurn(snapPlayers, snapTurn, fd===6, fd===6?snapDiceCount+1:0), 700)
          } else {
            const chosen=ludoAIChoose(snapCp, fd, snapPlayers)
            setTimeout(()=>{
              if(chosen>=0) moveToken(chosen)
              else advanceTurn(snapPlayers, snapTurn, false, 0)
            }, 500)
          }
        }
      },70)
    },700)
    return ()=>{ if(aiTimerRef.current) clearTimeout(aiTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[phase, currentTurn, dice, rolling])

  const startGame=()=>{
    const activePlayers=slots
      .map((slot,i)=>({slot,i}))
      .filter(({slot})=>slot!=='empty')
      .map(({slot,i})=>({
        index:i,
        name: slot==='human'?(i===0?'Kamu':`Pemain ${i+1}`):`AI ${LUDO_NAMES[i]}`,
        isAI: slot==='ai', color:i,
        tokens: Array.from({length:4},(_,id)=>({id,color:i,pos:-1})),
        finished:false, rank:0,
      }))
    if(activePlayers.length<2) return
    // Reset semua ref
    playersRef.current=activePlayers
    currentTurnRef.current=0
    diceRef.current=null
    diceCountRef.current=0
    rollingRef.current=false
    aiThinkingRef.current=false
    setPlayers(activePlayers); setCurrentTurn(0); setDice(null)
    setMovable([]); setLog([]); setDiceCount(0)
    setAnimPos({}); setPhase('playing')
  }

  const handleTokenClick=(pIdx,tokenId)=>{
    const cp=playersRef.current[currentTurnRef.current]
    if(!cp||cp.index!==pIdx) return
    if(!movable.includes(tokenId)) return
    moveToken(tokenId)
  }

  if(phase==='lobby') return <LudoLobby slots={slots} setSlots={setSlots} onStart={startGame} onBack={onBack||(() =>{})}/>
  if(phase==='over') return <GameOver players={players} onReplay={()=>setPhase('lobby')} onMenu={onBack||(() =>{})}/>

  // ── Playing screen ──
  // Layout per image:
  // [top: Player 1 (blue, left) ← arrow → Player 3 (red, right)]
  // [board full width]
  // [bottom: Player 2 (yellow)]

  // Find players by color slot
  const pByColor = (c) => players.find(p=>p.color===c)||null
  const p0=pByColor(0), p1=pByColor(1), p2=pByColor(2), p3=pByColor(3)
  const isActive=(p)=>p&&curPlayer&&p.index===curPlayer.index

  return (
    <div style={{
      height:'100vh', display:'flex', flexDirection:'column',
      background:'#2563eb', // blue surrounding background like image
      fontFamily:"'Segoe UI',sans-serif",
      overflow:'hidden',
      position:'relative',
    }}>
      <style>{`
        @keyframes diceSpin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        @keyframes arrowPulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(0.8)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 6px currentColor}50%{box-shadow:0 0 18px currentColor} }
      `}</style>

      {/* TOP ROW — back btn (top-left), run btn (top-right) like image */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 14px 4px', flexShrink:0,
      }}>
        <button onClick={()=>{ if(aiTimerRef.current)clearTimeout(aiTimerRef.current); if(animTimerRef.current)clearTimeout(animTimerRef.current); if(onBack)onBack() }} style={{
          width:36,height:36,borderRadius:'50%',
          background:'rgba(255,255,255,0.15)',border:'2px solid rgba(255,255,255,0.3)',
          color:'white',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
        }}>⏎</button>
        <div style={{
          background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'3px 12px',
          color:'rgba(255,255,255,0.7)',fontSize:11,fontWeight:700,letterSpacing:1,
        }}>
          🎲 LUDO
        </div>
        <button onClick={()=>setPhase('lobby')} style={{
          width:36,height:36,borderRadius:'50%',
          background:'rgba(255,255,255,0.15)',border:'2px solid rgba(255,255,255,0.3)',
          color:'white',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
        }}>🏠</button>
      </div>

      {/* PLAYER PANELS ROW — top (Player 1 left, Player 3 right) */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'4px 10px', flexShrink:0,
      }}>
        {/* Player 1 (Blue, left) */}
        <div style={{
          flex:1, display:'flex', alignItems:'center', gap:6,
          background:'rgba(255,255,255,0.1)', borderRadius:10, padding:'6px 8px',
          border:`2px solid ${isActive(p0)?'#facc15':'transparent'}`,
          boxShadow: isActive(p0)?'0 0 14px rgba(250,204,21,0.5)':'none',
        }}>
          <div style={{
            width:32,height:32,borderRadius:'50%',
            background:'radial-gradient(circle at 40% 35%,#60a5fa,#1d4ed8)',
            border:'2px solid rgba(255,255,255,0.5)',flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            <span style={{fontSize:14}}>🔵</span>
          </div>
          {/* Dice for player 0 */}
          <div style={{
            width:46,height:46,borderRadius:10,flexShrink:0,
            background:'linear-gradient(145deg,#fff,#f0ede8,#ddd8d0)',
            boxShadow:'0 3px 10px rgba(0,0,0,0.4)',
            display:'flex',alignItems:'center',justifyContent:'center',
            position:'relative',overflow:'visible',
          }}>
            {isActive(p0)&&dice!==null ? <DiceBox value={dice} rolling={rolling} size={46}/> : <span style={{fontSize:20,opacity:0.3}}>⬜</span>}
          </div>
          {/* active arrow */}
          {isActive(p0)&&(
            <div style={{fontSize:22,color:'#f97316',animation:'arrowPulse 1s ease-in-out infinite'}}>◀</div>
          )}
        </div>

        {/* Player 3 (Red, right) */}
        <div style={{
          flex:1, display:'flex', alignItems:'center', flexDirection:'row-reverse', gap:6,
          background:'rgba(255,255,255,0.1)', borderRadius:10, padding:'6px 8px',
          border:`2px solid ${isActive(p1)?'#facc15':'transparent'}`,
          boxShadow: isActive(p1)?'0 0 14px rgba(250,204,21,0.5)':'none',
        }}>
          <div style={{
            width:32,height:32,borderRadius:'50%',
            background:'radial-gradient(circle at 40% 35%,#f87171,#b91c1c)',
            border:'2px solid rgba(255,255,255,0.5)',flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            <span style={{fontSize:14}}>🔴</span>
          </div>
          <div style={{
            width:46,height:46,borderRadius:10,flexShrink:0,
            background:'linear-gradient(145deg,#fff,#f0ede8,#ddd8d0)',
            boxShadow:'0 3px 10px rgba(0,0,0,0.4)',
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            {isActive(p1)&&dice!==null ? <DiceBox value={dice} rolling={rolling} size={46}/> : <span style={{fontSize:20,opacity:0.3}}>⬜</span>}
          </div>
          {isActive(p1)&&(
            <div style={{fontSize:22,color:'#f97316',animation:'arrowPulse 1s ease-in-out infinite'}}>▶</div>
          )}
        </div>
      </div>

      {/* Player names row */}
      <div style={{display:'flex',justifyContent:'space-between',padding:'0 12px',flexShrink:0,marginBottom:2}}>
        <div style={{
          fontSize:10,fontWeight:900,color:isActive(p0)?'#facc15':'rgba(255,255,255,0.7)',
          textShadow:isActive(p0)?'0 0 8px rgba(250,204,21,0.8)':'none',
          writingMode:'vertical-rl',transform:'rotate(180deg)',
          letterSpacing:1,
        }}>
          {p0?.name||'Player 1'}
        </div>
        <div style={{
          fontSize:10,fontWeight:900,color:isActive(p1)?'#facc15':'rgba(255,255,255,0.7)',
          textShadow:isActive(p1)?'0 0 8px rgba(250,204,21,0.8)':'none',
          writingMode:'vertical-rl',
          letterSpacing:1,
        }}>
          {p1?.name||'Player 3'}
        </div>
      </div>

      {/* BOARD — center */}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'2px 8px',position:'relative'}}>
        {/* left arrow (→ direction indicator) */}
        <div style={{position:'absolute',left:4,fontSize:13,color:'rgba(255,255,255,0.5)'}}>→</div>
        {/* right arrow */}
        <div style={{position:'absolute',right:4,fontSize:13,color:'rgba(255,255,255,0.5)'}}>←</div>
        <LudoBoard
          players={players}
          movable={movable}
          onTokenClick={handleTokenClick}
          animPos={animPos}
        />
      </div>

      {/* BOTTOM: Player 2 (Yellow) + roll button */}
      <div style={{flexShrink:0,padding:'4px 10px 8px'}}>
        {/* Player 2 panel */}
        <div style={{
          display:'flex', alignItems:'center', gap:8, marginBottom:6,
          background:'rgba(255,255,255,0.1)',borderRadius:10,padding:'6px 10px',
          border:`2px solid ${isActive(p2)?'#facc15':'transparent'}`,
          boxShadow: isActive(p2)?'0 0 14px rgba(250,204,21,0.5)':'none',
        }}>
          <div style={{
            width:32,height:32,borderRadius:'50%',
            background:'radial-gradient(circle at 40% 35%,#fde047,#a16207)',
            border:'2px solid rgba(255,255,255,0.5)',flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            <span style={{fontSize:14}}>🟡</span>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:900,color:isActive(p2)?'#facc15':'rgba(255,255,255,0.7)',letterSpacing:1}}>
              {p2?p2.name:'Player 2'}
            </div>
            {isActive(p2)&&movable.length>0&&(
              <div style={{fontSize:9,color:'#fbbf24',marginTop:1}}>👆 Pilih pion</div>
            )}
          </div>
          <div style={{
            width:46,height:46,borderRadius:10,flexShrink:0,
            background:'linear-gradient(145deg,#fff,#f0ede8,#ddd8d0)',
            boxShadow:'0 3px 10px rgba(0,0,0,0.4)',
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            {isActive(p2)&&dice!==null ? <DiceBox value={dice} rolling={rolling} size={46}/> : <span style={{fontSize:20,opacity:0.3}}>⬜</span>}
          </div>
          {p3&&(
            <>
              <div style={{width:2,height:32,background:'rgba(255,255,255,0.15)',borderRadius:1}}/>
              <div style={{
                width:32,height:32,borderRadius:'50%',
                background:'radial-gradient(circle at 40% 35%,#4ade80,#15803d)',
                border:'2px solid rgba(255,255,255,0.5)',flexShrink:0,
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>
                <span style={{fontSize:14}}>🟢</span>
              </div>
            </>
          )}
        </div>

        {/* Roll button / status */}
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {curPlayer&&!curPlayer.isAI&&dice===null&&!rolling ? (
            <button onClick={handleRoll} style={{
              flex:1,padding:'12px',
              background:`linear-gradient(135deg,${BOARD_COLORS[curPlayer.color]},${LUDO_DARK[curPlayer.color]})`,
              border:'none',borderRadius:12,color:'white',fontSize:14,fontWeight:900,cursor:'pointer',
              boxShadow:`0 4px 18px ${BOARD_COLORS[curPlayer.color]}55`,letterSpacing:.5,
            }}>
              🎲 LEMPAR DADU!
            </button>
          ):movable.length>0?(
            <div style={{
              flex:1,textAlign:'center',color:'#fbbf24',fontWeight:800,fontSize:12,
              padding:10,background:'rgba(251,191,36,0.1)',borderRadius:10,
              border:'1px solid rgba(251,191,36,0.3)',
            }}>
              👆 Pilih pion yang mau digerakkan
            </div>
          ):(
            <div style={{flex:1,textAlign:'center',color:'rgba(255,255,255,0.45)',fontSize:11,padding:10}}>
              {aiThinking||rolling?`⚙️ ${curPlayer?.name||''} melempar dadu...`:curPlayer?`Giliran: ${curPlayer.name}`:''}
            </div>
          )}
        </div>

        {/* Log */}
        <div style={{marginTop:4,background:'rgba(0,0,0,0.25)',borderRadius:6,padding:'4px 8px',minHeight:22}}>
          {log.slice(0,2).map((l,i)=>(
            <div key={i} style={{fontSize:9,color:i===0?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.25)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
