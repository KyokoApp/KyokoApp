import React, { useState, useEffect, useRef, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════

type ChessPiece = 'wK'|'wQ'|'wR'|'wB'|'wN'|'wP'|'bK'|'bQ'|'bR'|'bB'|'bN'|'bP'|null
type ChessBoard = ChessPiece[][]
type CaturDiff = 'easy'|'medium'|'hard'
type SnakeDiff = 'easy'|'medium'|'hard'
type Dir = 'UP'|'DOWN'|'LEFT'|'RIGHT'
interface Pos { x:number; y:number }

const CHESS_UNICODE: Record<string,string> = {
  wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
  bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
}
const CHESS_PIECE_VAL: Record<string,number> = { P:10,N:32,B:33,R:50,Q:90,K:900 }
const SNAKE_GRID = 20
const SNAKE_SPEED: Record<SnakeDiff,number> = { easy:200, medium:120, hard:65 }

const OFFLINE_GAMES = [
  { id:'catur',  emoji:'♟️', name:'Catur',       desc:'Game strategi papan klasik. Lawan AI cerdas dengan 3 tingkat kesulitan.', tag:'Strategi', color:'#c8f500', status:'available' },
  { id:'ttt',    emoji:'❌', name:'Tic-Tac-Toe', desc:'Susun 3 simbol berurutan dan kalahkan lawan. Cepat & seru!',              tag:'Kasual',   color:'#4fc3f7', status:'available' },
  { id:'snake',  emoji:'🐍', name:'Snake',       desc:'Kendalikan ular, makan apel, jangan sampai menabrak diri sendiri!',        tag:'Arkade',   color:'#fb923c', status:'available' },
  { id:'memory', emoji:'🃏', name:'Memory Card', desc:'Balik kartu dan temukan pasangan yang cocok. Latih ingatanmu!',            tag:'Puzzle',   color:'#a78bfa', status:'available' },

]

// ═══════════════════════════════════════════════════════════════
// CHESS LOGIC (dipakai CaturGame)
// ═══════════════════════════════════════════════════════════════

function initChessBoard(): ChessBoard {
  const b: ChessBoard = Array(8).fill(null).map(()=>Array(8).fill(null))
  b[0] = ['bR','bN','bB','bQ','bK','bB','bN','bR'] as ChessPiece[]
  b[1] = Array(8).fill('bP' as ChessPiece)
  b[7] = ['wR','wN','wB','wQ','wK','wB','wN','wR'] as ChessPiece[]
  b[6] = Array(8).fill('wP' as ChessPiece)
  return b
}
function chessGetRawMoves(board: ChessBoard, r: number, c: number): [number,number][] {
  const piece = board[r][c]; if (!piece) return []
  const color = piece[0], type = piece[1], enemy = color==='w'?'b':'w'
  const moves:[number,number][] = []
  const inB = (r:number,c:number) => r>=0&&r<8&&c>=0&&c<8
  const empty = (r:number,c:number) => inB(r,c)&&!board[r][c]
  const isEn = (r:number,c:number) => inB(r,c)&&board[r][c]!==null&&board[r][c]![0]===enemy
  const slide = (dr:number,dc:number) => {
    let nr=r+dr,nc=c+dc
    while(inB(nr,nc)){
      if(!board[nr][nc]){moves.push([nr,nc]);nr+=dr;nc+=dc}
      else{if(board[nr][nc]![0]===enemy)moves.push([nr,nc]);break}
    }
  }
  if(type==='P'){
    const d=color==='w'?-1:1,sr=color==='w'?6:1
    if(empty(r+d,c)){moves.push([r+d,c]);if(r===sr&&empty(r+2*d,c))moves.push([r+2*d,c])}
    if(isEn(r+d,c-1))moves.push([r+d,c-1])
    if(isEn(r+d,c+1))moves.push([r+d,c+1])
  } else if(type==='R'){
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr,dc])=>slide(dr,dc))
  } else if(type==='B'){
    [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc])=>slide(dr,dc))
  } else if(type==='Q'){
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc])=>slide(dr,dc))
  } else if(type==='N'){
    [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc])=>{
      const nr=r+dr,nc=c+dc
      if(inB(nr,nc)&&board[nr][nc]?.[0]!==color)moves.push([nr,nc])
    })
  } else if(type==='K'){
    [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc])=>{
      const nr=r+dr,nc=c+dc
      if(inB(nr,nc)&&board[nr][nc]?.[0]!==color)moves.push([nr,nc])
    })
  }
  return moves
}
function chessApplyMove(board:ChessBoard,fr:number,fc:number,tr:number,tc:number):ChessBoard {
  const b=board.map(row=>[...row])
  b[tr][tc]=b[fr][fc]; b[fr][fc]=null
  if(b[tr][tc]==='wP'&&tr===0)b[tr][tc]='wQ'
  if(b[tr][tc]==='bP'&&tr===7)b[tr][tc]='bQ'
  return b
}
function chessIsInCheck(board:ChessBoard,color:string):boolean {
  let kr=-1,kc=-1
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(board[r][c]===color+'K'){kr=r;kc=c}
  if(kr<0)return false
  const en=color==='w'?'b':'w'
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    if(board[r][c]&&board[r][c]![0]===en){
      if(chessGetRawMoves(board,r,c).some(([mr,mc])=>mr===kr&&mc===kc))return true
    }
  }
  return false
}
function chessGetLegal(board:ChessBoard,r:number,c:number):[number,number][] {
  const piece=board[r][c]; if(!piece)return []
  const color=piece[0]
  return chessGetRawMoves(board,r,c).filter(([tr,tc])=>!chessIsInCheck(chessApplyMove(board,r,c,tr,tc),color))
}
function chessAllLegal(board:ChessBoard,color:string):{fr:number;fc:number;tr:number;tc:number}[] {
  const moves:{fr:number;fc:number;tr:number;tc:number}[]=[]
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    if(board[r][c]&&board[r][c]![0]===color){
      chessGetLegal(board,r,c).forEach(([tr,tc])=>moves.push({fr:r,fc:c,tr,tc}))
    }
  }
  return moves
}
const PST_P=[[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]]
const PST_N=[[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]]
function chessEval(board:ChessBoard):number {
  let s=0
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const p=board[r][c]; if(!p)continue
    const v=CHESS_PIECE_VAL[p[1]]||0
    const sign=p[0]==='w'?1:-1
    let pst=0
    if(p[1]==='P')pst=p[0]==='w'?PST_P[r][c]:PST_P[7-r][c]
    if(p[1]==='N')pst=p[0]==='w'?PST_N[r][c]:PST_N[7-r][c]
    s+=sign*(v+pst*0.1)
  }
  return s
}
function chessMinimax(board:ChessBoard,depth:number,alpha:number,beta:number,maxing:boolean):number {
  if(depth===0)return chessEval(board)
  const col=maxing?'w':'b'
  const moves=chessAllLegal(board,col)
  if(moves.length===0)return chessIsInCheck(board,col)?(maxing?-9999:9999):0
  if(maxing){
    let best=-Infinity
    for(const m of moves){
      const v=chessMinimax(chessApplyMove(board,m.fr,m.fc,m.tr,m.tc),depth-1,alpha,beta,false)
      if(v>best)best=v; alpha=Math.max(alpha,best); if(beta<=alpha)break
    }
    return best
  }else{
    let best=Infinity
    for(const m of moves){
      const v=chessMinimax(chessApplyMove(board,m.fr,m.fc,m.tr,m.tc),depth-1,alpha,beta,true)
      if(v<best)best=v; beta=Math.min(beta,best); if(beta<=alpha)break
    }
    return best
  }
}
function chessGetAIMove(board:ChessBoard,diff:CaturDiff):{fr:number;fc:number;tr:number;tc:number}|null {
  const moves=chessAllLegal(board,'b'); if(!moves.length)return null
  if(diff==='easy')return moves[Math.floor(Math.random()*moves.length)]
  const depth=diff==='medium'?2:3
  let best=Infinity,bestM=moves[0]
  for(const m of moves){
    const v=chessMinimax(chessApplyMove(board,m.fr,m.fc,m.tr,m.tc),depth-1,-Infinity,Infinity,true)
    if(v<best){best=v;bestM=m}
  }
  return bestM
}

// ─── Snake helpers ───────────────────────────────────────────────
function snakeRandPos(snake: Pos[], apples: Pos[]): Pos {
  let p:Pos
  do { p={x:Math.floor(Math.random()*SNAKE_GRID),y:Math.floor(Math.random()*SNAKE_GRID)} }
  while (snake.some(s=>s.x===p.x&&s.y===p.y) || apples.some(a=>a.x===p.x&&a.y===p.y))
  return p
}

// ═══════════════════════════════════════════════════════════════
// OFFLINE GAMES MENU
// ═══════════════════════════════════════════════════════════════

export function OfflineGamesMenu({ onSelectGame, onBack }: { onSelectGame:(id:string)=>void; onBack:()=>void }) {
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#0a0a12',overflow:'hidden'}}>
      <div style={{padding:'14px 16px 10px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:2}}>
          <span style={{fontSize:20}}>🕹️</span>
          <div>
            <div style={{fontSize:16,fontWeight:900,color:'#fff',letterSpacing:.5}}>Game Offline</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Tidak butuh koneksi internet · Progres tersimpan lokal</div>
          </div>
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'12px 12px 20px',display:'flex',flexDirection:'column',gap:10}}>
        {OFFLINE_GAMES.map(game => {
          const avail = game.status === 'available'
          return (
            <button key={game.id} onClick={() => avail && onSelectGame(game.id)} disabled={!avail}
              style={{display:'flex',alignItems:'center',gap:14,background:avail?`linear-gradient(135deg,rgba(255,255,255,0.05) 0%,rgba(255,255,255,0.02) 100%)`:'rgba(255,255,255,0.02)',border:`1.5px solid ${avail?game.color+'33':'rgba(255,255,255,0.06)'}`,borderRadius:16,padding:'14px 16px',cursor:avail?'pointer':'default',textAlign:'left',width:'100%',transition:'all .2s',opacity:avail?1:0.55,position:'relative',overflow:'hidden'}}
              onMouseEnter={e=>{if(avail)(e.currentTarget as HTMLElement).style.borderColor=game.color+'77'}}
              onMouseLeave={e=>{if(avail)(e.currentTarget as HTMLElement).style.borderColor=game.color+'33'}}
            >
              {avail && <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:game.color,borderRadius:'16px 0 0 16px'}}/>}
              <div style={{fontSize:36,flexShrink:0,marginLeft:avail?6:0}}>{game.emoji}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:14,fontWeight:900,color:avail?'#fff':'rgba(255,255,255,0.4)'}}>{game.name}</span>
                  <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:99,background:`${game.color}22`,color:game.color,flexShrink:0}}>{game.tag}</span>
                  {game.status==='soon'&&<span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:99,background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.3)'}}>Segera</span>}
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',lineHeight:1.5}}>{game.desc}</div>
              </div>
              {avail&&<div style={{flexShrink:0,width:32,height:32,borderRadius:'50%',background:`${game.color}22`,display:'flex',alignItems:'center',justifyContent:'center',color:game.color,fontSize:16}}>›</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CATUR (CHESS) GAME
// ═══════════════════════════════════════════════════════════════

interface CaturStats { wins:number; losses:number; draws:number }

export function CaturGame({ onBack }: { onBack:()=>void }) {
  const [phase, setPhase] = useState<'menu'|'playing'|'over'>('menu')
  const [difficulty, setDifficulty] = useState<CaturDiff>('medium')
  const [board, setBoard] = useState<ChessBoard>(initChessBoard)
  const [turn, setTurn] = useState<'w'|'b'>('w')
  const [selected, setSelected] = useState<[number,number]|null>(null)
  const [validMoves, setValidMoves] = useState<[number,number][]>([])
  const [result, setResult] = useState<'win'|'lose'|'draw'|null>(null)
  const [inCheck, setInCheck] = useState(false)
  const [aiThinking, setAiThinking] = useState(false)
  const [lastMove, setLastMove] = useState<{fr:number;fc:number;tr:number;tc:number}|null>(null)
  const [stats, setStats] = useState<CaturStats>(()=>{
    try{return JSON.parse(localStorage.getItem('kyoko_chess_stats')||'{"wins":0,"losses":0,"draws":0}')}
    catch{return{wins:0,losses:0,draws:0}}
  })

  const saveStats=(s:CaturStats)=>{setStats(s);localStorage.setItem('kyoko_chess_stats',JSON.stringify(s))}
  const startGame=(diff:CaturDiff)=>{
    setDifficulty(diff);setBoard(initChessBoard());setTurn('w')
    setSelected(null);setValidMoves([]);setResult(null)
    setInCheck(false);setLastMove(null);setPhase('playing')
  }
  const endGame=(res:'win'|'lose'|'draw',curStats:CaturStats)=>{
    setResult(res)
    const ns=res==='win'?{...curStats,wins:curStats.wins+1}:res==='lose'?{...curStats,losses:curStats.losses+1}:{...curStats,draws:curStats.draws+1}
    saveStats(ns);setPhase('over')
  }
  const handleSquare=(r:number,c:number)=>{
    if(turn!=='w'||aiThinking||result)return
    const piece=board[r][c]
    if(selected&&validMoves.some(([vr,vc])=>vr===r&&vc===c)){
      const nb=chessApplyMove(board,selected[0],selected[1],r,c)
      const mv={fr:selected[0],fc:selected[1],tr:r,tc:c}
      setLastMove(mv);setBoard(nb);setSelected(null);setValidMoves([])
      const bMoves=chessAllLegal(nb,'b')
      if(!bMoves.length){endGame(chessIsInCheck(nb,'b')?'win':'draw',stats);return}
      setInCheck(chessIsInCheck(nb,'b'));setTurn('b');setAiThinking(true)
      setTimeout(()=>{
        const ai=chessGetAIMove(nb,difficulty)
        if(!ai){setAiThinking(false);return}
        const nb2=chessApplyMove(nb,ai.fr,ai.fc,ai.tr,ai.tc)
        setLastMove(ai);setBoard(nb2);setAiThinking(false)
        const wMoves=chessAllLegal(nb2,'w')
        if(!wMoves.length){endGame(chessIsInCheck(nb2,'w')?'lose':'draw',stats);return}
        setInCheck(chessIsInCheck(nb2,'w'));setTurn('w')
      },difficulty==='hard'?900:400)
      return
    }
    if(piece&&piece[0]==='w'){setSelected([r,c]);setValidMoves(chessGetLegal(board,r,c))}
    else{setSelected(null);setValidMoves([])}
  }
  const DIFF_INFO:{[k in CaturDiff]:{label:string;emoji:string;desc:string;color:string}}={
    easy:{label:'Mudah',emoji:'🌱',desc:'AI pilih langkah acak — untuk pemula',color:'#4ade80'},
    medium:{label:'Sedang',emoji:'⚔️',desc:'AI bermain dengan strategi dasar',color:'#fbbf24'},
    hard:{label:'Sulit',emoji:'💀',desc:'AI berpikir jauh — tantangan sesungguhnya',color:'#f87171'},
  }

  if(phase==='menu') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',padding:'20px 16px',gap:16,background:'#0a0a12'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:52,marginBottom:6,filter:'drop-shadow(0 0 20px rgba(200,245,0,0.3))'}}>♟️</div>
        <div style={{fontSize:24,fontWeight:900,color:'#fff',letterSpacing:2}}>CATUR</div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:4,letterSpacing:1}}>Chess · Offline · vs AI</div>
      </div>
      <div style={{display:'flex',gap:20,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'12px 28px'}}>
        {([['Menang',stats.wins,'#4ade80'],['Kalah',stats.losses,'#f87171'],['Seri',stats.draws,'#94a3b8']] as [string,number,string][]).map(([lbl,val,col])=>(
          <div key={lbl} style={{textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:900,color:col}}>{val}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',alignSelf:'flex-start',width:'100%',maxWidth:300}}>Pilih Tingkat Kesulitan:</div>
      {(['easy','medium','hard'] as CaturDiff[]).map(d=>{
        const info=DIFF_INFO[d]
        return(
          <button key={d} onClick={()=>startGame(d)} style={{width:'100%',maxWidth:300,background:`linear-gradient(135deg,${info.color}12 0%,transparent 100%)`,border:`2px solid ${info.color}44`,borderRadius:16,padding:'16px 18px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',textAlign:'left',transition:'all .2s'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=info.color}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${info.color}44`}}
          >
            <span style={{fontSize:30}}>{info.emoji}</span>
            <div>
              <div style={{fontSize:15,fontWeight:900,color:info.color}}>{info.label}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{info.desc}</div>
            </div>
            <span style={{marginLeft:'auto',color:info.color,fontSize:20}}>›</span>
          </button>
        )
      })}
      <button onClick={onBack} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'8px 22px',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginTop:4}}>← Kembali</button>
    </div>
  )

  if(phase==='over') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',gap:18,padding:20,background:'#0a0a12'}}>
      <div style={{fontSize:68,filter:`drop-shadow(0 0 30px ${result==='win'?'#4ade80':result==='lose'?'#f87171':'#94a3b8'}66)`}}>
        {result==='win'?'🏆':result==='lose'?'💀':'🤝'}
      </div>
      <div style={{fontSize:26,fontWeight:900,color:result==='win'?'#4ade80':result==='lose'?'#f87171':'#94a3b8',letterSpacing:2}}>
        {result==='win'?'MENANG!':result==='lose'?'KALAH!':'SERI!'}
      </div>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.45)',textAlign:'center',lineHeight:1.6}}>
        {result==='win'?'Selamat! Kamu berhasil mengalahkan AI 🎉':result==='lose'?'AI lebih unggul kali ini. Coba lagi! 💪':'Permainan berakhir imbang'}
      </div>
      <div style={{display:'flex',gap:12,marginTop:8}}>
        <button onClick={()=>startGame(difficulty)} style={{background:'rgba(200,245,0,0.15)',border:'1px solid rgba(200,245,0,0.5)',borderRadius:12,padding:'11px 22px',color:'#c8f500',fontWeight:900,fontSize:13,cursor:'pointer'}}>🔄 Main Lagi</button>
        <button onClick={()=>setPhase('menu')} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:12,padding:'11px 22px',color:'rgba(255,255,255,0.6)',fontWeight:700,fontSize:13,cursor:'pointer'}}>🏠 Menu</button>
      </div>
    </div>
  )

  const files=['a','b','c','d','e','f','g','h']
  const ranks=['8','7','6','5','4','3','2','1']
  const sqSize=Math.min(Math.floor((Math.min(typeof window!=='undefined'?window.innerWidth:360,420)-52)/8),44)

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#0a0a12',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
        <button onClick={()=>setPhase('menu')} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'4px 10px',color:'rgba(255,255,255,0.5)',fontSize:11,cursor:'pointer'}}>← Menu</button>
        <div style={{flex:1,textAlign:'center'}}>
          <span style={{fontSize:13,fontWeight:900,color:'#fff'}}>♟️ Catur</span>
          <span style={{fontSize:10,color:DIFF_INFO[difficulty].color,marginLeft:6}}>{DIFF_INFO[difficulty].label}</span>
        </div>
        <div style={{fontSize:10,color:aiThinking?'#fbbf24':turn==='w'?'#c8f500':'rgba(255,255,255,0.4)',fontWeight:700}}>
          {aiThinking?'🤖 Berpikir...':turn==='w'?'⬜ Giliran kamu':'⬛ Giliran AI'}
        </div>
      </div>
      {inCheck&&<div style={{background:'rgba(248,113,113,0.18)',borderBottom:'1px solid rgba(248,113,113,0.35)',padding:'5px',textAlign:'center',fontSize:11,color:'#fca5a5',fontWeight:800,flexShrink:0}}>⚠️ Raja dalam bahaya — Check!</div>}
      <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:6,padding:'4px 0',flexShrink:0}}>
        <span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>🤖 AI</span>
        <div style={{display:'flex',gap:1}}>
          {Array(3).fill(0).map((_,i)=><div key={i} style={{width:4,height:4,borderRadius:'50%',background:aiThinking?'#fbbf24':'rgba(255,255,255,0.15)'}}/>)}
        </div>
      </div>
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:8,overflow:'hidden'}}>
        <div>
          {board.map((rowArr,r)=>(
            <div key={r} style={{display:'flex',alignItems:'center'}}>
              <div style={{width:14,fontSize:8,color:'rgba(255,255,255,0.3)',textAlign:'right',paddingRight:3,flexShrink:0}}>{ranks[r]}</div>
              {rowArr.map((piece,c)=>{
                const isLight=(r+c)%2===0
                const isSel=selected&&selected[0]===r&&selected[1]===c
                const isVM=validMoves.some(([vr,vc])=>vr===r&&vc===c)
                const isLM=lastMove&&((lastMove.fr===r&&lastMove.fc===c)||(lastMove.tr===r&&lastMove.tc===c))
                const isKingCheck=inCheck&&piece==='wK'
                let bg=isLight?'#f0d9b5':'#b58863'
                if(isSel)bg='#f6f669'
                else if(isLM)bg=isLight?'#cdd26a':'#aaa23a'
                else if(isKingCheck)bg='#e74c3c'
                return (
                  <div key={c} onClick={()=>handleSquare(r,c)} style={{width:sqSize,height:sqSize,background:bg,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',cursor:turn==='w'&&!aiThinking?'pointer':'default',fontSize:sqSize*0.62,lineHeight:1,userSelect:'none',transition:'background .12s'}}>
                    {isVM&&<div style={{position:'absolute',width:piece?'88%':'34%',height:piece?'88%':'34%',borderRadius:piece?3:'50%',background:piece?'rgba(0,0,0,0)':'rgba(0,0,0,0.22)',border:piece?'3px solid rgba(0,0,0,0.28)':'none',pointerEvents:'none',zIndex:1}}/>}
                    {piece&&<span style={{position:'relative',zIndex:2,textShadow:piece[0]==='w'?'0 1px 3px rgba(0,0,0,0.6)':'0 1px 2px rgba(0,0,0,0.3)'}}>{CHESS_UNICODE[piece]}</span>}
                  </div>
                )
              })}
            </div>
          ))}
          <div style={{display:'flex',paddingLeft:17}}>
            {files.map(f=><div key={f} style={{width:sqSize,fontSize:8,color:'rgba(255,255,255,0.3)',textAlign:'center',paddingTop:3}}>{f}</div>)}
          </div>
        </div>
      </div>
      <div style={{padding:'6px 14px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,borderTop:'1px solid rgba(255,255,255,0.04)'}}>
        <div style={{display:'flex',gap:10}}>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>W:{stats.wins}</span>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>L:{stats.losses}</span>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>D:{stats.draws}</span>
        </div>
        <button onClick={()=>{if(window.confirm('Menyerah dan kembali ke menu?')){endGame('lose',stats)}}} style={{background:'rgba(248,113,113,0.12)',border:'1px solid rgba(248,113,113,0.25)',borderRadius:8,padding:'4px 12px',color:'#fca5a5',fontSize:10,cursor:'pointer',fontWeight:700}}>🏳️ Menyerah</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SNAKE GAME 🐍
// ═══════════════════════════════════════════════════════════════

interface SnakeStats { bestEasy:number; bestMedium:number; bestHard:number; totalApples:number }

const SNAKE_DIFF_INFO: Record<SnakeDiff,{label:string;emoji:string;desc:string;color:string}> = {
  easy:   {label:'Mudah', emoji:'🌱', desc:'Kecepatan lambat, santai',          color:'#4ade80'},
  medium: {label:'Sedang',emoji:'⚔️', desc:'Kecepatan standar, seru',           color:'#fbbf24'},
  hard:   {label:'Sulit', emoji:'💀', desc:'Kecepatan tinggi, reflek cepat!',   color:'#f87171'},
}

export function SnakeGame({ onBack }: { onBack:()=>void }) {
  const [difficulty, setDifficulty] = useState<SnakeDiff>('medium')
  const [snake, setSnake] = useState<Pos[]>([{x:10,y:10},{x:9,y:10},{x:8,y:10}])
  const [apple, setApple] = useState<Pos>({x:15,y:10})
  const [bonusApple, setBonusApple] = useState<Pos|null>(null)
  const [bonusTimer, setBonusTimer] = useState(0)
  const [dir, setDir] = useState<Dir>('RIGHT')
  const [score, setScore] = useState(0)
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<'menu'|'playing'|'over'>('menu')
  const [stats, setStats] = useState<SnakeStats>(()=>{
    try{return JSON.parse(localStorage.getItem('kyoko_snake_stats')||'{"bestEasy":0,"bestMedium":0,"bestHard":0,"totalApples":0}')}
    catch{return{bestEasy:0,bestMedium:0,bestHard:0,totalApples:0}}
  })

  const snakeRef = useRef(snake)
  const appleRef = useRef(apple)
  const bonusRef = useRef(bonusApple)
  const dirRef = useRef(dir)
  const nextDirRef = useRef(dir)   // queued next direction (fixes input bug)
  const scoreRef = useRef(score)
  const pausedRef = useRef(false)
  const loopRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const bonusIntervalRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const touchStartRef = useRef<{x:number;y:number}|null>(null)

  snakeRef.current = snake
  appleRef.current = apple
  bonusRef.current = bonusApple
  dirRef.current = dir
  scoreRef.current = score

  const cellSize = Math.min(Math.floor((Math.min(typeof window!=='undefined'?window.innerWidth:360,420)-24)/SNAKE_GRID),20)

  const saveStats=(s:SnakeStats)=>{setStats(s);localStorage.setItem('kyoko_snake_stats',JSON.stringify(s))}

  const stopLoop=useCallback(()=>{
    if(loopRef.current){clearInterval(loopRef.current);loopRef.current=null}
    if(bonusIntervalRef.current){clearInterval(bonusIntervalRef.current);bonusIntervalRef.current=null}
  },[])

  const startGame=(diff:SnakeDiff)=>{
    stopLoop()
    const initSnake=[{x:10,y:10},{x:9,y:10},{x:8,y:10}]
    const initApple=snakeRandPos(initSnake,[])
    setDifficulty(diff);setSnake(initSnake);setApple(initApple)
    setDir('RIGHT');setScore(0);setBonusApple(null);setBonusTimer(0)
    pausedRef.current=false;setPaused(false);setPhase('playing')
    snakeRef.current=initSnake;appleRef.current=initApple;bonusRef.current=null
    dirRef.current='RIGHT';nextDirRef.current='RIGHT';scoreRef.current=0
  }

  const endGame=useCallback((finalScore:number,diff:SnakeDiff)=>{
    stopLoop()
    setStats(prev=>{
      const bestKey=`best${diff.charAt(0).toUpperCase()+diff.slice(1)}` as keyof SnakeStats
      const ns={...prev,totalApples:prev.totalApples+finalScore,[bestKey]:Math.max(prev[bestKey] as number,finalScore)}
      saveStats(ns);return ns
    })
    setPhase('over')
  },[stopLoop])

  useEffect(()=>{
    if(phase!=='playing')return
    loopRef.current=setInterval(()=>{
      if(pausedRef.current)return
      const s=snakeRef.current,a=appleRef.current,b=bonusRef.current
      // consume queued direction
      const d=nextDirRef.current
      dirRef.current=d
      setDir(d)
      const head={...s[0]}
      if(d==='UP')head.y-=1
      else if(d==='DOWN')head.y+=1
      else if(d==='LEFT')head.x-=1
      else head.x+=1
      if(head.x<0||head.x>=SNAKE_GRID||head.y<0||head.y>=SNAKE_GRID||s.some(seg=>seg.x===head.x&&seg.y===head.y)){
        endGame(scoreRef.current,difficulty);return
      }
      let newSnake=[head,...s]
      let gotBonus=false
      if(b&&head.x===b.x&&head.y===b.y){
        scoreRef.current+=3;setScore(scoreRef.current);setBonusApple(null);bonusRef.current=null;gotBonus=true
      }
      if(head.x===a.x&&head.y===a.y){
        scoreRef.current+=1;setScore(scoreRef.current)
        const newApple=snakeRandPos(newSnake,[])
        appleRef.current=newApple;setApple(newApple)
        if(scoreRef.current%5===0&&!bonusRef.current){
          const bp=snakeRandPos(newSnake,[newApple])
          bonusRef.current=bp;setBonusApple(bp);setBonusTimer(8)
        }
      } else if(!gotBonus){
        newSnake=newSnake.slice(0,-1)
      }
      snakeRef.current=newSnake;setSnake(newSnake)
    },SNAKE_SPEED[difficulty])
    return ()=>stopLoop()
  },[phase,difficulty,endGame,stopLoop])

  useEffect(()=>{
    if(!bonusApple)return
    let t=8
    bonusIntervalRef.current=setInterval(()=>{
      t--;setBonusTimer(t)
      if(t<=0){setBonusApple(null);bonusRef.current=null;clearInterval(bonusIntervalRef.current!)}
    },1000)
    return ()=>{if(bonusIntervalRef.current)clearInterval(bonusIntervalRef.current)}
  },[bonusApple])

  const changeDir=useCallback((nd:Dir)=>{
    const cur=dirRef.current
    if((nd==='UP'&&cur==='DOWN')||(nd==='DOWN'&&cur==='UP')||(nd==='LEFT'&&cur==='RIGHT')||(nd==='RIGHT'&&cur==='LEFT'))return
    nextDirRef.current=nd
  },[])

  useEffect(()=>{
    if(phase!=='playing')return
    const h=(e:KeyboardEvent)=>{
      if(e.key==='ArrowUp')changeDir('UP')
      else if(e.key==='ArrowDown')changeDir('DOWN')
      else if(e.key==='ArrowLeft')changeDir('LEFT')
      else if(e.key==='ArrowRight')changeDir('RIGHT')
      else if(e.key===' '){pausedRef.current=!pausedRef.current;setPaused(p=>!p)}
    }
    window.addEventListener('keydown',h)
    return ()=>window.removeEventListener('keydown',h)
  },[phase,changeDir])

  const onTouchStart=(e:React.TouchEvent)=>{touchStartRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY}}
  const onTouchEnd=(e:React.TouchEvent)=>{
    if(!touchStartRef.current)return
    const dx=e.changedTouches[0].clientX-touchStartRef.current.x
    const dy=e.changedTouches[0].clientY-touchStartRef.current.y
    if(Math.abs(dx)>Math.abs(dy)){changeDir(dx>0?'RIGHT':'LEFT')}else{changeDir(dy>0?'DOWN':'UP')}
    touchStartRef.current=null
  }

  const diffInfo=SNAKE_DIFF_INFO[difficulty]
  const bestKey=`best${difficulty.charAt(0).toUpperCase()+difficulty.slice(1)}` as keyof SnakeStats
  const dpadBtn:React.CSSProperties={width:62,height:62,background:'rgba(251,146,60,0.15)',border:'2px solid rgba(251,146,60,0.4)',borderRadius:14,color:'#fb923c',fontSize:22,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,touchAction:'manipulation',WebkitTapHighlightColor:'transparent'}

  if(phase==='menu') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',padding:'20px 16px',gap:16,background:'#0a0a12'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:52,marginBottom:6,filter:'drop-shadow(0 0 20px rgba(251,146,60,0.3))'}}>🐍</div>
        <div style={{fontSize:24,fontWeight:900,color:'#fff',letterSpacing:2}}>SNAKE</div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:4,letterSpacing:1}}>Arkade · Offline · Skor Tinggi</div>
      </div>
      <div style={{display:'flex',gap:16,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'12px 20px'}}>
        {(['easy','medium','hard'] as SnakeDiff[]).map(d=>{
          const bk=`best${d.charAt(0).toUpperCase()+d.slice(1)}` as keyof SnakeStats
          return(
            <div key={d} style={{textAlign:'center'}}>
              <div style={{fontSize:18,fontWeight:900,color:SNAKE_DIFF_INFO[d].color}}>{stats[bk]}</div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.35)'}}>{SNAKE_DIFF_INFO[d].label}</div>
            </div>
          )
        })}
      </div>
      <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',alignSelf:'flex-start',width:'100%',maxWidth:300}}>Pilih Tingkat Kesulitan:</div>
      {(['easy','medium','hard'] as SnakeDiff[]).map(d=>{
        const info=SNAKE_DIFF_INFO[d]
        return(
          <button key={d} onClick={()=>startGame(d)} style={{width:'100%',maxWidth:300,background:`linear-gradient(135deg,${info.color}12 0%,transparent 100%)`,border:`2px solid ${info.color}44`,borderRadius:16,padding:'16px 18px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',textAlign:'left',transition:'all .2s'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=info.color}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${info.color}44`}}
          >
            <span style={{fontSize:30}}>{info.emoji}</span>
            <div>
              <div style={{fontSize:15,fontWeight:900,color:info.color}}>{info.label}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{info.desc}</div>
            </div>
            <span style={{marginLeft:'auto',color:info.color,fontSize:20}}>›</span>
          </button>
        )
      })}
      <button onClick={onBack} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'8px 22px',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginTop:4}}>← Kembali</button>
    </div>
  )

  if(phase==='over') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',gap:16,padding:20,background:'#0a0a12'}}>
      <div style={{fontSize:68}}>💀</div>
      <div style={{fontSize:26,fontWeight:900,color:'#f87171',letterSpacing:2}}>GAME OVER</div>
      <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'16px 32px',textAlign:'center'}}>
        <div style={{fontSize:36,fontWeight:900,color:'#fb923c'}}>{score}</div>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>SKOR</div>
      </div>
      <div style={{display:'flex',gap:12}}>
        <button onClick={()=>startGame(difficulty)} style={{background:'rgba(251,146,60,0.15)',border:'1px solid rgba(251,146,60,0.5)',borderRadius:12,padding:'11px 22px',color:'#fb923c',fontWeight:900,fontSize:13,cursor:'pointer'}}>🔄 Main Lagi</button>
        <button onClick={()=>setPhase('menu')} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:12,padding:'11px 22px',color:'rgba(255,255,255,0.6)',fontWeight:700,fontSize:13,cursor:'pointer'}}>🏠 Menu</button>
      </div>
    </div>
  )

  const gridPx=cellSize*SNAKE_GRID
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#0a0a12',overflow:'hidden',userSelect:'none'}} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
        <button onClick={()=>{stopLoop();setPhase('menu')}} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'4px 10px',color:'rgba(255,255,255,0.5)',fontSize:11,cursor:'pointer'}}>← Menu</button>
        <div style={{flex:1,textAlign:'center'}}>
          <span style={{fontSize:13,fontWeight:900,color:'#fff'}}>🐍 Snake</span>
          <span style={{fontSize:10,color:diffInfo.color,marginLeft:6}}>{diffInfo.label}</span>
        </div>
        <button onClick={()=>{pausedRef.current=!pausedRef.current;setPaused(p=>!p)}} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'4px 10px',color:'rgba(255,255,255,0.7)',fontSize:11,cursor:'pointer',fontWeight:700}}>
          {paused?'▶ Lanjut':'⏸ Pause'}
        </button>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',padding:'6px 16px',flexShrink:0}}>
        <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:900,color:'#fb923c'}}>{score}</div><div style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>SKOR</div></div>
        <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:900,color:'#c8f500'}}>{stats[bestKey]}</div><div style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>REKOR</div></div>
        <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:900,color:'#fff'}}>{snake.length}</div><div style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>PANJANG</div></div>
      </div>
      {paused&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.75)',zIndex:20,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}>
        <div style={{fontSize:36}}>⏸</div>
        <div style={{fontSize:18,fontWeight:900,color:'#fff'}}>PAUSE</div>
        <button onClick={()=>{pausedRef.current=false;setPaused(false)}} style={{background:'rgba(251,146,60,0.2)',border:'1px solid rgba(251,146,60,0.5)',borderRadius:12,padding:'10px 28px',color:'#fb923c',fontWeight:900,fontSize:14,cursor:'pointer'}}>▶ Lanjutkan</button>
      </div>}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
        <div style={{position:'relative',width:gridPx,height:gridPx,flexShrink:0,background:'#0f1923',border:'2px solid rgba(251,146,60,0.2)',borderRadius:4,backgroundImage:'linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)',backgroundSize:`${cellSize}px ${cellSize}px`}}>
          <div style={{position:'absolute',left:apple.x*cellSize,top:apple.y*cellSize,width:cellSize,height:cellSize,display:'flex',alignItems:'center',justifyContent:'center',fontSize:cellSize*0.8,lineHeight:1}}>🍎</div>
          {bonusApple&&<>
            <div style={{position:'absolute',left:bonusApple.x*cellSize,top:bonusApple.y*cellSize,width:cellSize,height:cellSize,display:'flex',alignItems:'center',justifyContent:'center',fontSize:cellSize*0.8,lineHeight:1,zIndex:2}}>⭐</div>
            <div style={{position:'absolute',top:2,left:'50%',transform:'translateX(-50%)',fontSize:9,color:'#fbbf24',fontWeight:700,background:'rgba(0,0,0,0.6)',padding:'2px 8px',borderRadius:6,zIndex:3,whiteSpace:'nowrap'}}>⭐ Bonus! {bonusTimer}s</div>
          </>}
          {snake.map((seg,i)=>{
            const isHead=i===0
            const ratio=1-i/snake.length
            const g=Math.round(180+ratio*75),r2=Math.round(ratio*80)
            const color=isHead?'#fb923c':`rgb(${r2},${g},60)`
            return(
              <div key={i} style={{position:'absolute',left:seg.x*cellSize+1,top:seg.y*cellSize+1,width:cellSize-2,height:cellSize-2,background:color,borderRadius:isHead?4:3,zIndex:isHead?3:1,display:isHead?'flex':'block',alignItems:'center',justifyContent:'center',fontSize:isHead?cellSize*0.55:undefined}}>
                {isHead&&'👁'}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'10px 0 14px',gap:4,flexShrink:0}}>
        <button onPointerDown={()=>changeDir('UP')} style={dpadBtn}>▲</button>
        <div style={{display:'flex',gap:4}}>
          <button onPointerDown={()=>changeDir('LEFT')} style={dpadBtn}>◄</button>
          <div style={{width:62,height:62,background:'rgba(255,255,255,0.04)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'rgba(255,255,255,0.2)'}}>🐍</div>
          <button onPointerDown={()=>changeDir('RIGHT')} style={dpadBtn}>►</button>
        </div>
        <button onPointerDown={()=>changeDir('DOWN')} style={dpadBtn}>▼</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TIC-TAC-TOE GAME ❌⭕
// ═══════════════════════════════════════════════════════════════

type TTTCell = 'X'|'O'|null
type TTTDiff = 'easy'|'medium'|'hard'
interface TTTStats { wins:number; losses:number; draws:number }

function tttCheckWinner(board: TTTCell[]): {winner:'X'|'O'; line:number[]}|null {
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
  for(const [a,b,c] of lines){
    if(board[a]&&board[a]===board[b]&&board[a]===board[c])return{winner:board[a] as 'X'|'O',line:[a,b,c]}
  }
  return null
}
function tttMinimax(board:TTTCell[],depth:number,isMax:boolean,alpha:number,beta:number):number {
  const w=tttCheckWinner(board)
  if(w)return w.winner==='O'?10-depth:depth-10
  if(!board.includes(null))return 0
  if(isMax){
    let best=-Infinity
    for(let i=0;i<9;i++){
      if(!board[i]){const nb=[...board];nb[i]='O';const v=tttMinimax(nb,depth+1,false,alpha,beta);best=Math.max(best,v);alpha=Math.max(alpha,best);if(beta<=alpha)break}
    }
    return best
  }else{
    let best=Infinity
    for(let i=0;i<9;i++){
      if(!board[i]){const nb=[...board];nb[i]='X';const v=tttMinimax(nb,depth+1,true,alpha,beta);best=Math.min(best,v);beta=Math.min(beta,best);if(beta<=alpha)break}
    }
    return best
  }
}
function tttGetAIMove(board:TTTCell[],diff:TTTDiff):number {
  const empty=board.map((c,i)=>c===null?i:-1).filter(i=>i>=0)
  if(diff==='easy')return empty[Math.floor(Math.random()*empty.length)]
  if(diff==='medium'&&Math.random()<0.35)return empty[Math.floor(Math.random()*empty.length)]
  let best=-Infinity,bestIdx=empty[0]
  for(const i of empty){
    const nb=[...board];nb[i]='O'
    const v=tttMinimax(nb,0,false,-Infinity,Infinity)
    if(v>best){best=v;bestIdx=i}
  }
  return bestIdx
}

export function TicTacToeGame({ onBack }: { onBack:()=>void }) {
  const [phase, setPhase] = useState<'menu'|'playing'|'over'>('menu')
  const [difficulty, setDifficulty] = useState<TTTDiff>('medium')
  const [board, setBoard] = useState<TTTCell[]>(Array(9).fill(null))
  const [turn, setTurn] = useState<'X'|'O'>('X')
  const [winLine, setWinLine] = useState<number[]|null>(null)
  const [result, setResult] = useState<'win'|'lose'|'draw'|null>(null)
  const [aiThinking, setAiThinking] = useState(false)
  const [stats, setStats] = useState<TTTStats>(()=>{
    try{return JSON.parse(localStorage.getItem('kyoko_ttt_stats')||'{"wins":0,"losses":0,"draws":0}')}
    catch{return{wins:0,losses:0,draws:0}}
  })

  const saveStats=(s:TTTStats)=>{setStats(s);localStorage.setItem('kyoko_ttt_stats',JSON.stringify(s))}

  const startGame=(diff:TTTDiff)=>{
    setDifficulty(diff);setBoard(Array(9).fill(null));setTurn('X')
    setWinLine(null);setResult(null);setAiThinking(false);setPhase('playing')
  }

  const handleCell=(idx:number)=>{
    if(board[idx]||turn!=='X'||aiThinking||result)return
    const nb=[...board];nb[idx]='X'
    const w=tttCheckWinner(nb)
    const empty=nb.includes(null)
    if(w){setBoard(nb);setWinLine(w.line);const ns={...stats,wins:stats.wins+1};saveStats(ns);setResult('win');setPhase('over');return}
    if(!empty){setBoard(nb);const ns={...stats,draws:stats.draws+1};saveStats(ns);setResult('draw');setPhase('over');return}
    setBoard(nb);setTurn('O');setAiThinking(true)
    setTimeout(()=>{
      const aiIdx=tttGetAIMove(nb,difficulty)
      const nb2=[...nb];nb2[aiIdx]='O'
      const w2=tttCheckWinner(nb2)
      const empty2=nb2.includes(null)
      setBoard(nb2);setAiThinking(false)
      if(w2){setWinLine(w2.line);const ns={...stats,losses:stats.losses+1};saveStats(ns);setResult('lose');setPhase('over');return}
      if(!empty2){const ns={...stats,draws:stats.draws+1};saveStats(ns);setResult('draw');setPhase('over');return}
      setTurn('X')
    },400)
  }

  const DIFF_INFO:{[k in TTTDiff]:{label:string;emoji:string;desc:string;color:string}}={
    easy:{label:'Mudah',emoji:'🌱',desc:'AI acak — cocok untuk pemula',color:'#4ade80'},
    medium:{label:'Sedang',emoji:'⚔️',desc:'AI cukup pintar, perlu strategi',color:'#fbbf24'},
    hard:{label:'Sulit',emoji:'💀',desc:'AI sempurna — bisakah kamu menang?',color:'#f87171'},
  }

  if(phase==='menu') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',padding:'20px 16px',gap:16,background:'#0a0a12'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:52,marginBottom:6,filter:'drop-shadow(0 0 20px rgba(79,195,247,0.3))'}}>❌</div>
        <div style={{fontSize:24,fontWeight:900,color:'#fff',letterSpacing:2}}>TIC-TAC-TOE</div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:4,letterSpacing:1}}>Kasual · Offline · Kamu (X) vs AI (O)</div>
      </div>
      <div style={{display:'flex',gap:20,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'12px 28px'}}>
        {([['Menang',stats.wins,'#4ade80'],['Kalah',stats.losses,'#f87171'],['Seri',stats.draws,'#94a3b8']] as [string,number,string][]).map(([lbl,val,col])=>(
          <div key={lbl} style={{textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:900,color:col}}>{val}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',alignSelf:'flex-start',width:'100%',maxWidth:300}}>Pilih Tingkat Kesulitan:</div>
      {(['easy','medium','hard'] as TTTDiff[]).map(d=>{
        const info=DIFF_INFO[d]
        return(
          <button key={d} onClick={()=>startGame(d)} style={{width:'100%',maxWidth:300,background:`linear-gradient(135deg,${info.color}12 0%,transparent 100%)`,border:`2px solid ${info.color}44`,borderRadius:16,padding:'16px 18px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',textAlign:'left',transition:'all .2s'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=info.color}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${info.color}44`}}
          >
            <span style={{fontSize:30}}>{info.emoji}</span>
            <div>
              <div style={{fontSize:15,fontWeight:900,color:info.color}}>{info.label}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{info.desc}</div>
            </div>
            <span style={{marginLeft:'auto',color:info.color,fontSize:20}}>›</span>
          </button>
        )
      })}
      <button onClick={onBack} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'8px 22px',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginTop:4}}>← Kembali</button>
    </div>
  )

  if(phase==='over') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',gap:18,padding:20,background:'#0a0a12'}}>
      <div style={{fontSize:68,filter:`drop-shadow(0 0 30px ${result==='win'?'#4ade80':result==='lose'?'#f87171':'#94a3b8'}66)`}}>
        {result==='win'?'🏆':result==='lose'?'💀':'🤝'}
      </div>
      <div style={{fontSize:26,fontWeight:900,color:result==='win'?'#4ade80':result==='lose'?'#f87171':'#94a3b8',letterSpacing:2}}>
        {result==='win'?'MENANG!':result==='lose'?'KALAH!':'SERI!'}
      </div>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.45)',textAlign:'center',lineHeight:1.6}}>
        {result==='win'?'Hebat! Kamu berhasil mengalahkan AI 🎉':result==='lose'?'AI lebih unggul. Coba lagi! 💪':'Permainan berakhir seri — coba kalahkan AI!'}
      </div>
      {/* Final board preview */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,60px)',gap:4}}>
        {board.map((cell,i)=>{
          const isWin=winLine?.includes(i)
          return(
            <div key={i} style={{width:60,height:60,background:isWin?'rgba(200,245,0,0.12)':'rgba(255,255,255,0.04)',border:`1.5px solid ${isWin?'#c8f500':'rgba(255,255,255,0.1)'}`,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,fontWeight:900,color:cell==='X'?'#4fc3f7':cell==='O'?'#f87171':'transparent'}}>
              {cell||'·'}
            </div>
          )
        })}
      </div>
      <div style={{display:'flex',gap:12,marginTop:4}}>
        <button onClick={()=>startGame(difficulty)} style={{background:'rgba(79,195,247,0.15)',border:'1px solid rgba(79,195,247,0.5)',borderRadius:12,padding:'11px 22px',color:'#4fc3f7',fontWeight:900,fontSize:13,cursor:'pointer'}}>🔄 Main Lagi</button>
        <button onClick={()=>setPhase('menu')} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:12,padding:'11px 22px',color:'rgba(255,255,255,0.6)',fontWeight:700,fontSize:13,cursor:'pointer'}}>🏠 Menu</button>
      </div>
    </div>
  )

  // ── PLAYING ──
  const cellStyle=(idx:number):React.CSSProperties=>{
    const cell=board[idx]
    const isWin=winLine?.includes(idx)
    return{
      width:'100%',aspectRatio:'1',background:isWin?'rgba(200,245,0,0.1)':cell?'rgba(255,255,255,0.04)':'rgba(255,255,255,0.02)',
      border:`2px solid ${isWin?'#c8f500':cell?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.08)'}`,
      borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',
      fontSize:'clamp(28px,9vw,48px)',fontWeight:900,cursor:cell||turn!=='X'||aiThinking?'default':'pointer',
      color:cell==='X'?'#4fc3f7':'#f87171',transition:'all .15s',userSelect:'none',
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#0a0a12',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
        <button onClick={()=>setPhase('menu')} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'4px 10px',color:'rgba(255,255,255,0.5)',fontSize:11,cursor:'pointer'}}>← Menu</button>
        <div style={{flex:1,textAlign:'center'}}>
          <span style={{fontSize:13,fontWeight:900,color:'#fff'}}>❌ Tic-Tac-Toe</span>
          <span style={{fontSize:10,color:DIFF_INFO[difficulty].color,marginLeft:6}}>{DIFF_INFO[difficulty].label}</span>
        </div>
        <div style={{fontSize:10,fontWeight:700,color:aiThinking?'#fbbf24':turn==='X'?'#4fc3f7':'#f87171'}}>
          {aiThinking?'🤖 Berpikir...':turn==='X'?'❌ Giliran kamu':'⭕ Giliran AI'}
        </div>
      </div>

      {/* Player legend */}
      <div style={{display:'flex',justifyContent:'center',gap:24,padding:'8px 0',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6,opacity:turn==='X'&&!aiThinking?1:0.4,transition:'opacity .2s'}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:'#4fc3f7'}}/>
          <span style={{fontSize:11,color:'#4fc3f7',fontWeight:700}}>Kamu (X)</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,opacity:turn==='O'||aiThinking?1:0.4,transition:'opacity .2s'}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:'#f87171'}}/>
          <span style={{fontSize:11,color:'#f87171',fontWeight:700}}>AI (O)</span>
        </div>
      </div>

      {/* Board */}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'8px 24px'}}>
        <div style={{width:'100%',maxWidth:280,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
          {board.map((_,i)=>(
            <div key={i} style={cellStyle(i)} onClick={()=>handleCell(i)}>
              {board[i]}
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'flex',justifyContent:'center',gap:24,padding:'10px 0 16px',borderTop:'1px solid rgba(255,255,255,0.04)',flexShrink:0}}>
        <span style={{fontSize:11,color:'#4ade80'}}>W: {stats.wins}</span>
        <span style={{fontSize:11,color:'#f87171'}}>L: {stats.losses}</span>
        <span style={{fontSize:11,color:'#94a3b8'}}>D: {stats.draws}</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// MEMORY CARD GAME 🃏
// ═══════════════════════════════════════════════════════════════

interface MemoryStats { bestTime4x4:number; bestTime6x4:number; gamesPlayed:number }

const MEMORY_EMOJIS = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🦆','🦉','🦇','🐺','🐗','🦋','🐛']
type MemorySize = '4x4'|'6x4'

interface MemCard {
  id: number
  emoji: string
  flipped: boolean
  matched: boolean
}

export function MemoryCardGame({ onBack }: { onBack:()=>void }) {
  const [phase, setPhase] = useState<'menu'|'playing'|'over'>('menu')
  const [gridSize, setGridSize] = useState<MemorySize>('4x4')
  const [cards, setCards] = useState<MemCard[]>([])
  const [flipped, setFlipped] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [matched, setMatched] = useState(0)
  const [timer, setTimer] = useState(0)
  const [canClick, setCanClick] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const [stats, setStats] = useState<MemoryStats>(()=>{
    try{return JSON.parse(localStorage.getItem('kyoko_memory_stats')||'{"bestTime4x4":0,"bestTime6x4":0,"gamesPlayed":0}')}
    catch{return{bestTime4x4:0,bestTime6x4:0,gamesPlayed:0}}
  })

  const saveStats=(s:MemoryStats)=>{setStats(s);localStorage.setItem('kyoko_memory_stats',JSON.stringify(s))}

  const stopTimer=()=>{if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null}}

  const startGame=(size:MemorySize)=>{
    stopTimer()
    const total=size==='4x4'?16:24
    const pairCount=total/2
    const emojis=MEMORY_EMOJIS.slice(0,pairCount)
    const doubled=[...emojis,...emojis]
    // shuffle
    for(let i=doubled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[doubled[i],doubled[j]]=[doubled[j],doubled[i]]}
    const newCards:MemCard[]=doubled.map((emoji,i)=>({id:i,emoji,flipped:false,matched:false}))
    setGridSize(size);setCards(newCards);setFlipped([]);setMoves(0);setMatched(0);setTimer(0);setCanClick(true);setPhase('playing')
    timerRef.current=setInterval(()=>setTimer(t=>t+1),1000)
  }

  useEffect(()=>()=>{stopTimer()},[])

  const handleCard=(idx:number)=>{
    if(!canClick)return
    const card=cards[idx]
    if(card.flipped||card.matched||flipped.length>=2)return

    const newFlipped=[...flipped,idx]
    const newCards=cards.map((c,i)=>i===idx?{...c,flipped:true}:c)
    setCards(newCards);setFlipped(newFlipped)

    if(newFlipped.length===2){
      setMoves(m=>m+1);setCanClick(false)
      const [a,b]=newFlipped
      if(newCards[a].emoji===newCards[b].emoji){
        // match!
        setTimeout(()=>{
          const mc=newCards.map((c,i)=>newFlipped.includes(i)?{...c,matched:true}:c)
          const newMatched=matched+1
          setCards(mc);setFlipped([]);setMatched(newMatched);setCanClick(true)
          const total=gridSize==='4x4'?8:12
          if(newMatched===total){
            stopTimer()
            setStats(prev=>{
              const key=`bestTime${gridSize}` as 'bestTime4x4'|'bestTime6x4'
              const best=prev[key]
              const ns={...prev,gamesPlayed:prev.gamesPlayed+1,[key]:best===0||timer<best?timer:best}
              saveStats(ns);return ns
            })
            setPhase('over')
          }
        },300)
      }else{
        // no match — flip back
        setTimeout(()=>{
          setCards(cards.map((c,i)=>newFlipped.includes(i)?{...c,flipped:false}:c))
          setFlipped([]);setCanClick(true)
        },900)
      }
    }
  }

  const fmtTime=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`

  const GRID_INFO:{[k in MemorySize]:{label:string;emoji:string;desc:string;cols:number;color:string}}={
    '4x4':{label:'4×4 (16 Kartu)', emoji:'🟢',desc:'Mudah — 8 pasang kartu',cols:4,color:'#4ade80'},
    '6x4':{label:'6×4 (24 Kartu)', emoji:'🔴',desc:'Sulit — 12 pasang kartu',cols:6,color:'#f87171'},
  }

  if(phase==='menu') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',padding:'20px 16px',gap:16,background:'#0a0a12'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:52,marginBottom:6,filter:'drop-shadow(0 0 20px rgba(167,139,250,0.3))'}}>🃏</div>
        <div style={{fontSize:24,fontWeight:900,color:'#fff',letterSpacing:2}}>MEMORY CARD</div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:4,letterSpacing:1}}>Puzzle · Offline · Latih Ingatanmu</div>
      </div>
      <div style={{display:'flex',gap:20,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'12px 28px'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:18,fontWeight:900,color:'#a78bfa'}}>{stats.gamesPlayed}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>Main</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:18,fontWeight:900,color:'#4ade80'}}>{stats.bestTime4x4?fmtTime(stats.bestTime4x4):'—'}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>Best 4×4</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:18,fontWeight:900,color:'#f87171'}}>{stats.bestTime6x4?fmtTime(stats.bestTime6x4):'—'}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>Best 6×4</div>
        </div>
      </div>
      <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',alignSelf:'flex-start',width:'100%',maxWidth:300}}>Pilih Ukuran Grid:</div>
      {(['4x4','6x4'] as MemorySize[]).map(sz=>{
        const info=GRID_INFO[sz]
        return(
          <button key={sz} onClick={()=>startGame(sz)} style={{width:'100%',maxWidth:300,background:`linear-gradient(135deg,${info.color}12 0%,transparent 100%)`,border:`2px solid ${info.color}44`,borderRadius:16,padding:'16px 18px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',textAlign:'left',transition:'all .2s'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=info.color}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${info.color}44`}}
          >
            <span style={{fontSize:30}}>{info.emoji}</span>
            <div>
              <div style={{fontSize:15,fontWeight:900,color:info.color}}>{info.label}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{info.desc}</div>
            </div>
            <span style={{marginLeft:'auto',color:info.color,fontSize:20}}>›</span>
          </button>
        )
      })}
      <button onClick={onBack} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'8px 22px',color:'rgba(255,255,255,0.4)',fontSize:12,cursor:'pointer',marginTop:4}}>← Kembali</button>
    </div>
  )

  if(phase==='over') return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',alignItems:'center',justifyContent:'center',gap:18,padding:20,background:'#0a0a12'}}>
      <div style={{fontSize:68,filter:'drop-shadow(0 0 30px rgba(200,245,0,0.4))'}}>🎉</div>
      <div style={{fontSize:26,fontWeight:900,color:'#c8f500',letterSpacing:2}}>SELESAI!</div>
      <div style={{display:'flex',gap:20,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'16px 28px'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:26,fontWeight:900,color:'#4fc3f7'}}>{fmtTime(timer)}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>WAKTU</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:26,fontWeight:900,color:'#fbbf24'}}>{moves}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>LANGKAH</div>
        </div>
      </div>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.45)',textAlign:'center'}}>
        {gridSize==='4x4'&&stats.bestTime4x4===timer?'🏅 Rekor baru 4×4!':gridSize==='6x4'&&stats.bestTime6x4===timer?'🏅 Rekor baru 6×4!':'Bagus! Coba pecahkan rekordmu.'}
      </div>
      <div style={{display:'flex',gap:12,marginTop:4}}>
        <button onClick={()=>startGame(gridSize)} style={{background:'rgba(167,139,250,0.15)',border:'1px solid rgba(167,139,250,0.5)',borderRadius:12,padding:'11px 22px',color:'#a78bfa',fontWeight:900,fontSize:13,cursor:'pointer'}}>🔄 Main Lagi</button>
        <button onClick={()=>setPhase('menu')} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:12,padding:'11px 22px',color:'rgba(255,255,255,0.6)',fontWeight:700,fontSize:13,cursor:'pointer'}}>🏠 Menu</button>
      </div>
    </div>
  )

  // ── PLAYING ──
  const info=GRID_INFO[gridSize]
  const total=gridSize==='4x4'?8:12

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#0a0a12',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
        <button onClick={()=>{stopTimer();setPhase('menu')}} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'4px 10px',color:'rgba(255,255,255,0.5)',fontSize:11,cursor:'pointer'}}>← Menu</button>
        <div style={{flex:1,textAlign:'center'}}>
          <span style={{fontSize:13,fontWeight:900,color:'#fff'}}>🃏 Memory Card</span>
          <span style={{fontSize:10,color:info.color,marginLeft:6}}>{gridSize}</span>
        </div>
        <div style={{fontSize:13,fontWeight:900,color:'#4fc3f7'}}>{fmtTime(timer)}</div>
      </div>

      {/* Progress & moves */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 16px',flexShrink:0}}>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>Pasangan: <span style={{color:'#c8f500',fontWeight:900}}>{matched}/{total}</span></div>
        <div style={{flex:1,margin:'0 12px',height:4,background:'rgba(255,255,255,0.08)',borderRadius:4,overflow:'hidden'}}>
          <div style={{height:'100%',background:'#a78bfa',borderRadius:4,width:`${(matched/total)*100}%`,transition:'width .4s'}}/>
        </div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>Langkah: <span style={{color:'#fbbf24',fontWeight:900}}>{moves}</span></div>
      </div>

      {/* Cards grid */}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'8px',overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:`repeat(${info.cols},1fr)`,gap:6,width:'100%',maxWidth:gridSize==='4x4'?320:420}}>
          {cards.map((card,i)=>(
            <div key={card.id} onClick={()=>handleCard(i)}
              style={{
                aspectRatio:'1',borderRadius:10,cursor:card.flipped||card.matched?'default':'pointer',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:gridSize==='4x4'?'clamp(20px,6vw,32px)':'clamp(16px,4.5vw,26px)',
                transition:'all .25s',userSelect:'none',
                background:card.matched?'rgba(200,245,0,0.08)':card.flipped?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.04)',
                border:`1.5px solid ${card.matched?'rgba(200,245,0,0.35)':card.flipped?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.08)'}`,
                transform:card.flipped||card.matched?'scale(1)':'scale(0.97)',
                boxShadow:card.matched?'0 0 10px rgba(200,245,0,0.15)':'none',
              }}>
              {card.flipped||card.matched ? card.emoji : <span style={{fontSize:gridSize==='4x4'?22:18,opacity:0.25}}>?</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════
// DEFAULT EXPORT — GameOfflinePanel (router utama)
// ═══════════════════════════════════════════════════════════════

export default function GameOfflinePanel({ onBack }: { onBack:()=>void }) {
  const [selectedGame, setSelectedGame] = useState<string|null>(null)

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#0a0a12'}}>
      {selectedGame === null ? (
        <OfflineGamesMenu onSelectGame={setSelectedGame} onBack={onBack} />
      ) : selectedGame === 'catur' ? (
        <CaturGame onBack={()=>setSelectedGame(null)} />
      ) : selectedGame === 'snake' ? (
        <SnakeGame onBack={()=>setSelectedGame(null)} />
      ) : selectedGame === 'ttt' ? (
        <TicTacToeGame onBack={()=>setSelectedGame(null)} />
      ) : selectedGame === 'memory' ? (
        <MemoryCardGame onBack={()=>setSelectedGame(null)} />
      ) : null}
    </div>
  )
}
