/* 警察抓小偷 (Politi og røver): type the textbook to outrun the other side. Loaded on demand; nothing touches the page until open().
   Every letter typed right moves your runner one step round the loop, and the vehicle grows with your speed. Police catch a thief
   by reaching it; a thief taunts an officer by lapping it (coming round the loop to it from behind). Played against the computer in the
   browser, or with classmates in a room, where the server referees (scripts/community_api.py runs the same rules). */
(() => {
  'use strict';
  if (window.NorskChase) return;
  // Interface language (docs/i18n.md): tx() gives the Chinese back unchanged on Chinese devices.
  const L10N = window.NorskI18n || {lang:'zh',english:false,t:(text,vars) => vars ? text.replace(/\{(\w+)\}/g,(match,key) => key in vars ? String(vars[key]) : match) : text,gloss:item => String(item?.meaning ?? item?.zh ?? ''),data:() => Promise.resolve(null),name:nickname => String(nickname ?? ''),set() {}};
  const tx = L10N.t, EN = Boolean(L10N.english);
  // A name as shown: my own runner is 我 (Me), a default nickname reads "Learner 1234" on English devices.
  const ME = tx('我');
  const nameOf = name => name === '我' ? ME : L10N.name(name);

  /* ---------- Rules and tuning ---------- */
  const PREFS_KEY = 'norsk-chase-v1', RECORDS_KEY = 'norsk-chase-records-v1', MAX_RECORDS = 120, MAX_RECORD_SENTENCES = 40;
  const LEFT_KEY = 'norsk-chase-left-v1';
  // The chase is measured in letters: the thief starts GAP letters ahead; the officer catches up by gaining those GAP
  // letters, the thief taunts by lapping the officer, a lead of one whole lap of the map (its `lap` in letters; the
  // user, 2026-11-06, went back to lapping from "twice the start gap").
  const GAP = 30;
  const METERS_PER_LETTER = 2.5;     // how far one letter carries a runner on the map: an easy jog at 120/min
  const EASE = .42;                  // seconds a typed letter takes to turn into distance on the track
  const FOLLOW = .5;                 // seconds in which another player's runner in a room closes a gap to where they are
  const RATE_WINDOW = 8000;          // speed is measured over the last eight seconds
  const IMMUNE_MS = 2200, POSE_MS = 1100, END_HOLD_MS = 1800, COUNTDOWN_MS = 3200, CATCH_CAP_MS = 10*60*1000;
  const MINUTES = [3,5,8];
  const TIER_AT = [0,60,100,150,210];   // letters per minute that reach tiers 1–5
  const TIER_DOWN = .86, TIER_UP_MS = 500, TIER_DOWN_MS = 1600;
  const TIER_HOLD_MS = 8000;         // a vehicle is kept at least this long before the next one up
  const SIDES = {police:{name:tx('警察'),team:tx('警方')},thief:{name:tx('小偷'),team:tx('小偷团')}};
  const VEHICLES = {police:[tx('跑步'),tx('自行车'),tx('警用摩托'),tx('警车'),tx('直升机')],thief:[tx('跑步'),tx('滑板'),tx('越野摩托'),tx('黑色跑车'),tx('直升机')]};
  const SPRITES = {police:['police-run','police-bike','police-moto','police-car','police-heli'],thief:['thief-run','thief-skate','thief-moto','thief-car','thief-heli']};
  // Bot speeds in letters per minute (user, 2026-11-06: 新手 20, 高手 240; the server's CHASE_LEVELS holds the same).
  const LEVELS = {easy:{name:tx('新手'),rate:20},normal:{name:EN ? tx('熟练（电脑水平）') : '熟练',rate:110},hard:{name:tx('高手'),rate:240},match:{name:tx('旗鼓相当'),rate:0}};
  const ENDS = {catch:{name:tx('抓到为止')},timed:{name:tx('限时')}};
  // 朗读 (user, 2026-11-11): the player may read the text aloud instead of typing it, against the computer or in a room
  // (the host chooses for everyone). The page's own recogniser hears it (chase-speech.mjs). A reader's speed is words a
  // minute (the user's choice): each word heard is WORD_STEP letters of the chase, so the rules, laps and vehicles stay as
  // they are and a reader's speed is shown as letters / WORD_STEP. 40 words a minute then runs like typing 100 letters
  // (vehicles at 24 / 40 / 60 / 84 words a minute), and the server's one-word-per-two-letters XP check still holds.
  // Readers are averaged apart from typists (the server's chase_results.input). The server's CHASE_WORD_STEP and
  // CHASE_READ_LEVELS hold the same numbers.
  const WORD_STEP = 2.5;
  const READ_LEVELS = {easy:{name:LEVELS.easy.name,rate:37.5},normal:{name:LEVELS.normal.name,rate:87.5},hard:{name:LEVELS.hard.name,rate:175},match:LEVELS.match};
  const levelsFor = reading => reading ? READ_LEVELS : LEVELS;
  // A speed as shown: letters a minute, or for a reader words a minute.
  const speedValue = (rate,reading) => Math.round((Number(rate) || 0)/(reading ? WORD_STEP : 1));
  const speedUnit = reading => reading ? tx('词/分') : '/min';
  const speedHTML = (rate,reading) => `<b>${speedValue(rate,reading)}</b>${reading ? `<small class="pc-unit">${speedUnit(true)}</small>` : '/min'}`;
  // (朗读 elsewhere on the site means playing a recording, hence the note on the English key.)
  const READ_NAME = EN ? tx('朗读（玩法）') : '朗读';
  const INPUTS = {type:{name:tx('打字'),hint:tx('用键盘')},read:{name:READ_NAME,hint:tx('念出课文')}};
  const STUCK_MS = 5000;             // reading but no word heard this long: offer to pass the word
  const HEAR_TAIL_MS = 300;          // after a tapped word's reading has ended, the microphone waits this long
  // How the 3D scene is drawn: each player chooses for their own picture (it changes nothing in the game, so a room's
  // players may each see their own). chase-brunstad.mjs builds all three; the cast follows the look.
  const LOOKS = {pixel:{name:tx('像素'),hint:tx('复古像素画')},town:{name:tx('Q版'),hint:tx('手绘贴图')},anime:{name:'3D',hint:tx('动画风建模')}};
  const DEFAULT_LOOK = 'anime';
  const BOT_NAMES = ['Ola','Kari','Nora','Jonas','Ingrid','Emil','Sofie','Henrik'];
  // Maps: every Brunstad region (its loop from the map pipeline, work/brunstad-map → scripts/import_chase_map.py; the
  // campus itself modelled in three.js from one data pack, scripts/export_brunstad_world.py), picked on a plan of
  // Brunstad (scripts/build_chase_plan.py), and the lakeside village drawn in code, which loads fastest. Each region
  // goes by the name people use at Brunstad, in Chinese and Norwegian (the user's list, 2026-11-05); the region ids
  // stay as they are because records and rooms keep them.
  // `lap` is one lap of the map's loop in letters: its length / METERS_PER_LETTER, rounded. The rules use it (the server's
  // CHASE_LAPS holds the same numbers) and the picture spreads the loop over exactly that many letters, so a lap in the
  // rules is a lap on screen. test_chase_rules.py checks both against the maps' loops.
  // `en` is the English gloss shown on English devices under the Norwegian name (which leads there).
  const REGIONS = [
    {id:'festival',name:'会议中心',no:'Konferansesenter',en:tx('会议中心'),color:'#c08f3a',lap:453},
    {id:'garden',name:'花园城',no:'Hageby',en:tx('花园城'),color:'#b0523c',lap:504},
    {id:'village',name:'山坡村',no:'Rekketun',en:tx('山坡村'),color:'#4e7b68',lap:498},
    {id:'arena',name:'体育馆',no:'Arena',en:tx('体育馆'),color:'#596e9e',lap:221},
    {id:'beach',name:'海滩',no:'Stranda',en:tx('海滩'),color:'#3a8a9e',lap:392},
    {id:'fields',name:'节日广场',no:'Festplass',en:tx('节日广场'),color:'#8a7a35',lap:665},
  ];
  const MAPS = [
    ...REGIONS.map(region => ({...region,place:'Brunstad',kind:'brunstad',manifest:`assets/chase/maps/${region.id}/map.json`,
      files:{'world.json':'assets/chase/brunstad/world.json','terrain.png':'assets/chase/brunstad/terrain.png'}})),
    {id:'lakeside',name:'湖畔小镇',en:tx('湖畔小镇'),place:'练习图 · 载入最快',kind:'lakeside',color:'#7a8f4a',lap:168},
  ];
  const mapOf = id => MAPS.find(item => item.id === id) || MAPS[0];
  const lapOf = id => mapOf(id).lap;
  // A map's short name: Chinese on Chinese devices, the Norwegian name (or English for the practice map) on English ones.
  const mapName = item => EN ? item.no || item.en : item.name;
  const mapTitle = id => { const item = mapOf(id); return EN ? mapName(item) : item.no ? `${item.name} ${item.no}` : item.name; };
  const BOOKS = [{id:'god-i-norsk',name:'God i norsk',prefix:''},{id:'pa-vei',name:'På vei',prefix:'pa-vei-'},{id:'ty-conversation',name:'Norwegian Conversation',prefix:'ty-conversation-'}];
  const TYPEABLE = /[0-9A-Za-zÀ-ÖØ-öø-ÿ]/, RUNS = /[0-9A-Za-zÀ-ÖØ-öø-ÿ]+/g;
  const ALTERNATES = {'å':'å[{','ø':'ø;:ö','æ':'æ\'"ä'};
  // Rooms: in a game I report my letters every 0.4 s and hear where everyone is; the lobby is polled more slowly.
  const POLL_MS = {lobby:1500,soon:500,watch:500,game:400,hidden:4000};
  const MAX_MARKERS = 6;

  /* ---------- Pure logic (exercised by scripts/check_chase.cjs) ---------- */

  const clamp = (value,low,high) => Math.max(low,Math.min(high,value));
  const mod = (value,size) => ((value % size) + size) % size;
  const bookOf = id => BOOKS.find(book => book.prefix && String(id).startsWith(book.prefix)) || BOOKS[0];
  const sectionLabel = id => String(id).slice(bookOf(id).prefix.length);
  // Letters compare without case and accents, except that æ, ø and å are letters of their own. On a keyboard
  // without them the keys where a Norwegian keyboard has them ([ ; ') also count.
  function fold(char) {
    const lower = String(char).toLocaleLowerCase('nb');
    return 'æøå'.includes(lower) ? lower : lower.normalize('NFD').replace(/[̀-ͯ]/g,'');
  }
  function accepts(expected,typed) {
    const want = fold(expected);
    if ('æøå'.includes(want)) return ALTERNATES[want].includes(String(typed).toLocaleLowerCase('nb'));
    return fold(typed) === want;
  }
  // A reader section as typing material: every letter and digit is typed, everything else is passed over.
  // Words come from the reader's timing data, so each can sound with its own clip once typed.
  // `english` is the section's English (data/en/reader/<id>.json, English devices only), keyed by the sentence text.
  function buildSection(reader,meta,clipFor,english=null) {
    const sentences = [], translated = english?.sentences || {};
    for (const sentence of reader?.sentences || []) {
      if (sentence?.heading) continue;
      const text = String(sentence.text || '').normalize('NFC');
      if (!TYPEABLE.test(text)) continue;
      const words = [], covered = new Set();
      for (const entry of sentence.words || []) {
        const [start,end] = entry, key = entry[4] || '';
        if (!(end > start) || start < 0 || end > text.length) continue;
        const piece = text.slice(start,end);
        if (!TYPEABLE.test(piece)) continue;
        words.push({start,end,text:piece,key,...(reader?.lexicon?.[key]?.pos === '专名' ? {name:true} : {})});
        for (let i = start; i < end; i++) covered.add(i);
      }
      for (const match of text.matchAll(RUNS)) {
        if (!covered.has(match.index)) words.push({start:match.index,end:match.index+match[0].length,text:match[0],key:''});
      }
      words.sort((a,b) => a.start-b.start);
      const en = translated[sentence.text] ?? translated[text];
      sentences.push({text,zh:String(sentence.zh || ''),...(typeof en === 'string' && en ? {en} : {}),speaker:String(sentence.speaker || ''),section:meta.id,audio:meta.audio || reader.audio || '',
        from:Number(sentence.start) || 0,to:Number(sentence.end) || 0,
        words:words.map(word => ({...word,clip:clipFor ? clipFor(word.text,word.key) || '' : ''}))});
    }
    return {id:meta.id,title:meta.title || reader?.title || '',sentences};
  }
  function createText() { return {sentences:[],letters:[],words:[],sections:[]}; }
  // Sections are added as the fastest player nears the end, so a long game never runs out of text.
  function appendSection(text,section) {
    text.sections.push(section.id);
    // Each appended run of a section knows where it starts and how long it is, for "sentence 3 / 19" (a section can come round twice).
    const block = text.sentences.length, blockSize = section.sentences.length;
    for (const sentence of section.sentences) {
      const s = text.sentences.length, prefix = [0];
      for (let c = 0; c < sentence.text.length; c++) prefix.push(prefix[c]+(TYPEABLE.test(sentence.text[c]) ? 1 : 0));
      const item = {...sentence,firstLetter:text.letters.length,block,blockSize};
      text.sentences.push(item);
      for (let c = 0; c < sentence.text.length; c++) if (TYPEABLE.test(sentence.text[c])) text.letters.push({s,c,ch:sentence.text[c]});
      item.endLetter = text.letters.length;
      for (const word of sentence.words) {
        const letterEnd = item.firstLetter+prefix[word.end];
        if (prefix[word.end] > prefix[word.start]) text.words.push({text:word.text,clip:word.clip,s,letterEnd,letterStart:item.firstLetter+prefix[word.start],start:word.start,end:word.end,...(word.name ? {name:true} : {})});
      }
    }
    text.words.sort((a,b) => a.letterEnd-b.letterEnd);
    return text;
  }
  // A word range as typing material: one entry per line with its meaning under it, in an order drawn from the seed
  // (the same seed gives the same order on every device in a room). Each entry sounds as a whole once typed.
  function buildWordList(list,seed,clipFor) {
    const items = list.filter(item => TYPEABLE.test(item.no));
    const sentences = seededOrder(seed,items.length).map(index => {
      const item = items[index], text = String(item.no).normalize('NFC'), clip = item.clip || (clipFor ? clipFor(text,'') || '' : '');
      return {text,zh:String(item.zh || ''),...(item.en ? {en:String(item.en)} : {}),speaker:'',section:'words',audio:clip,from:0,to:clip ? 30 : 0,
        words:[{start:0,end:text.length,text,key:'',clip}]};
    });
    return {id:'words',title:'',sentences};
  }
  function seededOrder(seed,count) {
    let h = 2166136261;
    for (const char of String(seed)) h = Math.imul(h ^ char.codePointAt(0),16777619);
    const random = () => {
      h = (h+0x6D2B79F5) | 0;
      let t = Math.imul(h ^ (h >>> 15),1 | h);
      t = (t+Math.imul(t ^ (t >>> 7),61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0)/4294967296;
    };
    const order = [...Array(count).keys()];
    for (let i = count-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [order[i],order[j]] = [order[j],order[i]]; }
    return order;
  }
  // Letters per minute over the last few seconds; early in a game the window is the time played so far.
  function rateAt(times,now,started) {
    let count = 0;
    for (let i = times.length-1; i >= 0 && times[i] > now-RATE_WINDOW; i--) count++;
    return count*60000/Math.min(RATE_WINDOW,Math.max(2500,now-started));
  }
  function tierFor(rate) {
    for (let i = TIER_AT.length-1; i > 0; i--) if (rate >= TIER_AT[i]) return i+1;
    return 1;
  }
  // Gear changes wait a moment, and a vehicle is kept until the speed has dropped well below it, so a short
  // pause or burst never makes the runner flicker between vehicles. Going up is one vehicle at a time, each held for
  // TIER_HOLD_MS first (after a step down too), so the top takes a sustained effort. Returns 'up', 'down' or ''.
  function stepTier(player,rate,now) {
    const target = tierFor(rate);
    if (target > player.tier) {
      player.downSince = 0;
      player.upSince ||= now;
      if (now-player.upSince >= TIER_UP_MS && now-(player.tierSince || 0) >= TIER_HOLD_MS) {
        player.tier += 1;
        player.tierSince = now;
        player.upSince = 0;
        player.maxTier = Math.max(player.maxTier || 1,player.tier);
        return 'up';
      }
      return '';
    }
    player.upSince = 0;
    if (target < player.tier && rate < TIER_AT[player.tier-1]*TIER_DOWN) {
      player.downSince ||= now;
      if (now-player.downSince >= TIER_DOWN_MS) { player.tier -= 1; player.downSince = now; player.tierSince = now; return 'down'; }
      return '';
    }
    player.downSince = 0;
    return '';
  }
  const position = player => player.offset+player.dist;
  const immune = (player,now) => now < (player.immuneUntil || 0);
  const pairKey = (police,thief) => `${police.id}|${thief.id}`;
  // Where a pair stands on the road: -1 once the officer has reached the thief, 1 once the thief has lapped the officer
  // (a lead of one whole lap: the thief has come round to the officer from behind), 0 in between; only moving out of 0
  // is a catch or a taunt. A new pair starts from where it stands, so a thief already a lap ahead of a newly placed
  // officer is not a taunt: the officer has to close in first.
  const leadOf = (police,thief) => position(thief)-position(police);
  const zoneOf = (police,thief,lap) => { const lead = leadOf(police,thief); return lead <= 0 ? -1 : lead >= lap ? 1 : 0; };
  const freshPair = (game,police,thief) => ({zone:zoneOf(police,thief,game.lap)});
  // A respawned or side-switched player starts at the start gap from the nearest opponent: a thief GAP letters ahead of
  // the front officer, an officer GAP letters behind the last thief. So every score takes GAP letters, nobody scores
  // straight away, and every catch or taunt happens where the two really are.
  function placeAtGap(game,player) {
    const others = game.players.filter(other => other !== player && other.side !== player.side).map(position);
    if (!others.length) return;
    const target = player.side === 'thief' ? Math.max(...others)+GAP : Math.min(...others)-GAP;
    player.offset += target-position(player);
  }
  function refreshPairs(game,only=null) {
    for (const key of [...game.pairs.keys()]) if (!only || key.split('|').includes(only.id)) game.pairs.delete(key);
    for (const police of game.players) {
      if (police.side !== 'police') continue;
      for (const thief of game.players) if (thief.side === 'thief' && (!only || police === only || thief === only)) game.pairs.set(pairKey(police,thief),freshPair(game,police,thief));
    }
  }
  function settle(game,now) {
    const found = [];
    for (const police of game.players) {
      if (police.side !== 'police') continue;
      for (const thief of game.players) {
        if (thief.side !== 'thief' || police.side !== 'police') continue;
        const key = pairKey(police,thief);
        if (!game.pairs.has(key)) game.pairs.set(key,freshPair(game,police,thief));
        const pair = game.pairs.get(key), zone = zoneOf(police,thief,game.lap), before = pair.zone;
        if (zone === before) continue;
        pair.zone = zone;
        // Only leaving the middle counts; coming back into it (or a grace period) is silent.
        if (before !== 0 || immune(police,now) || immune(thief,now) || game.over) continue;
        const event = zone < 0 ? {type:'catch',winner:police,loser:thief} : {type:'taunt',winner:thief,loser:police};
        apply(game,event,now);
        found.push(event);
      }
    }
    return found;
  }
  function apply(game,event,now) {
    const {winner,loser,type} = event;
    winner[type === 'catch' ? 'catches' : 'taunts']++;
    loser[type === 'catch' ? 'caught' : 'taunted']++;
    game.score[type]++;
    loser.pose = {name:type === 'catch' ? 'thief-caught' : 'police-taunted',until:now+POSE_MS,at:position(loser),side:loser.side};
    loser.immuneUntil = now+IMMUNE_MS;
    event.at = now;
    event.winnerSide = winner.side;
    if (game.mode === 'timed') {
      // The loser is put back at the start gap: a caught thief slips the cuffs and runs off ahead, a taunted officer is
      // redeployed behind the thieves.
      placeAtGap(game,loser);
      event.respawn = true;
    } else if (game.players.length > 2) {
      // With more than two players the loser changes sides and plays on from the start gap of its new side.
      loser.side = loser.side === 'police' ? 'thief' : 'police';
      loser.switched = (loser.switched || 0)+1;
      event.switched = true;
      placeAtGap(game,loser);
    }
    refreshPairs(game,loser);
    game.events.push({type,winner:winner.id,loser:loser.id,at:now});
  }
  // 'police', 'thief', 'draw' or '' while the game goes on.
  function verdict(game,now) {
    if (game.mode === 'timed') {
      if (now < game.duration) return '';
      return game.score.catch > game.score.taunt ? 'police' : game.score.taunt > game.score.catch ? 'thief' : 'draw';
    }
    if (game.players.length === 2 && game.events.length) return game.events[0].type === 'catch' ? 'police' : 'thief';
    const police = game.players.filter(player => player.side === 'police').length, thieves = game.players.length-police;
    if (!police) return 'thief';
    if (!thieves) return 'police';
    if (now >= CATCH_CAP_MS) return police > thieves ? 'police' : thieves > police ? 'thief' : 'draw';
    return '';
  }
  function newPlayer(id,name,side,extra={}) {
    return {id,name,side,startSide:side,offset:side === 'thief' ? GAP : 0,letters:0,dist:0,vel:0,times:[],rate:0,tier:1,maxTier:1,
      upSince:0,downSince:0,tierSince:0,errors:0,words:0,wordIndex:0,catches:0,taunts:0,caught:0,taunted:0,immuneUntil:0,pose:null,switched:0,lane:0,bot:null,me:false,...extra};
  }
  function createGame({side,map='lakeside',opponents=1,teammates=0,level='match',end='catch',minutes=3,usual=0,random=Math.random,names=BOT_NAMES,me='我'}={}) {
    const other = side === 'police' ? 'thief' : 'police', pool = [...names];
    for (let i = pool.length-1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [pool[i],pool[j]] = [pool[j],pool[i]]; }
    const players = [newPlayer('me',me,side,{me:true})];
    // Bots react a moment after the start signal, like people do.
    const bot = (index,botSide) => newPlayer(`bot${index}`,pool[index % pool.length],botSide,{bot:{level,drift:1,driftAt:0,nextAt:250+random()*550}});
    for (let i = 0; i < teammates; i++) players.push(bot(players.length-1,side));
    for (let i = 0; i < opponents; i++) players.push(bot(players.length-1,other));
    // Lanes keep runners on one spot side by side: me in the middle, the others alternating outward.
    players.forEach((player,index) => { player.lane = index === 0 ? 0 : (index % 2 ? 1 : -1)*Math.ceil(index/2); });
    const game = {mode:end,duration:(MINUTES.includes(minutes) ? minutes : 3)*60000,players,pairs:new Map(),score:{catch:0,taunt:0},events:[],usual,over:'',
      map,lap:lapOf(map)};
    refreshPairs(game);
    return game;
  }
  function addLetter(game,player,now) {
    player.letters++;
    player.times.push(now);
    if (player.times.length > 400) player.times.splice(0,player.times.length-300);
    const done = [];
    const words = game.text?.words || [];
    while (player.wordIndex < words.length && words[player.wordIndex].letterEnd <= player.letters) {
      done.push(words[player.wordIndex]);
      player.wordIndex++;
      player.words++;
    }
    return done;
  }
  // Where a player is in the text. A typist's letters are both the text and the chase; a reader (player.read) moves
  // through the text by words heard, and the chase gets WORD_STEP letters for each.
  const textAt = player => player.read ? player.read.pos : player.letters;
  const wordAt = player => player.read ? player.read.word : player.wordIndex;
  // A word read aloud: the text moves on to its end, and the chase by WORD_STEP letters, whatever the word's length.
  // A word passed by hand (`passed`) moves the text on but gives no letters.
  function readWord(game,player,word,now,passed=false) {
    const read = player.read;
    read.pos = Math.max(read.pos,word.letterEnd);
    read.word++;
    if (passed) { read.passed++; return; }
    player.words++;
    read.carry += WORD_STEP;
    while (read.carry >= 1) {
      read.carry--;
      player.letters++;
      player.times.push(now);
    }
    if (player.times.length > 400) player.times.splice(0,player.times.length-300);
  }
  function advance(game,dt,now=0) {
    const keep = 1-Math.exp(-dt/EASE);
    for (const player of game.players) {
      if (player.net) { follow(player,dt,now); continue; }
      player.dist += (player.letters-player.dist)*keep;
      player.vel = (player.letters-player.dist)/EASE;
    }
  }
  // Someone else in a room: the server says how far they had got at game time `heardAt` and how fast they type. While
  // they are typing (their letters grew within the last second) they run on at that speed from there, for at most
  // 0.9 s past the report. The runner eases towards that point, a little slower when a report finds it ahead (whole
  // letters arrive in steps) and never backwards, so reports that arrive unevenly still make one steady run.
  function follow(player,dt,now) {
    const heard = player.heardAt ?? now, typing = heard-(player.grewAt ?? -Infinity) <= 1000;
    const speed = typing ? Math.max(0,player.rate || 0)/60 : 0, before = player.dist;
    const goal = player.letters+speed*clamp((now-heard)/1000,0,.9);
    player.dist = Math.max(before,Math.min(goal+1,before+Math.max(0,speed+(goal-before)/FOLLOW)*dt));
    if (dt > 0) player.vel = (player.dist-before)/dt;
  }
  // Bots type letter by letter at their level's speed, with a pause at each word and the odd hesitation.
  // A matched bot follows the human's recent speed, a little faster or slower in turns, so it stays close
  // without ever being out of reach; for the first seconds it goes at a gentle start (or my usual speed).
  function botRate(game,player,now) {
    const level = levelsFor(game.read)[player.bot.level] || LEVELS.match;
    if (level.rate) return level.rate*player.bot.drift;
    const me = game.players.find(item => item.me);
    const base = now < 4000 || !me ? Math.min(game.usual || 70,110) : Math.max(me.rate,25);
    return clamp(base*player.bot.drift,25,420);
  }
  function botStep(game,player,now,random=Math.random) {
    const bot = player.bot, done = [];
    if (now >= bot.driftAt) {
      const [low,high] = bot.level === 'match' ? [.9,1.07] : [.86,1.12];
      bot.drift = clamp(bot.drift+(random()-.5)*.09,low,high);
      bot.driftAt = now+3000+random()*2500;
    }
    let guard = 0;
    while (bot.nextAt <= now && guard++ < 20) {
      const at = bot.nextAt;
      done.push(...addLetter(game,player,at));
      const unit = 60000/botRate(game,player,at)*.85;
      let gap = unit*Math.exp((random()-.5)*.55);
      const word = game.text?.words?.[player.wordIndex-1];
      if (word && word.letterEnd === player.letters) {
        gap += unit*(.3+random()*1.2);
        if (random() < .035) gap += 400+random()*800;
      }
      bot.nextAt = at+gap;
    }
    return done;
  }
  function summarize(records) {
    const list = Array.isArray(records) ? records : [];
    const total = {games:list.length,wins:0,losses:0,draws:0,catches:0,taunts:0,best:0,bestTier:0,police:{games:0,wins:0},thief:{games:0,wins:0}};
    for (const record of list) {
      const result = record?.result;
      if (result === 'win') total.wins++; else if (result === 'loss') total.losses++; else total.draws++;
      total.catches += Number(record?.me?.catches) || 0;
      total.taunts += Number(record?.me?.taunts) || 0;
      if (record?.input !== 'read') total.best = Math.max(total.best,Number(record?.me?.rate) || 0);
      const tier = Number(record?.me?.maxTier) || 0;
      if (tier > total.bestTier) { total.bestTier = tier; total.bestSide = record?.finalSide || record?.side; }
      const side = total[record?.side];
      if (side) { side.games++; if (result === 'win') side.wins++; }
    }
    total.winRate = total.games ? Math.round(total.wins/total.games*100) : 0;
    return total;
  }
  // The speed shown on my avatar: the average of my last ten games (typed ones; read ones have an average of their own).
  function usualRate(records,input='type') {
    const recent = (Array.isArray(records) ? records : []).filter(record => (record?.input || 'type') === input).slice(0,10).map(record => Number(record?.me?.rate) || 0).filter(Boolean);
    return recent.length ? Math.round(recent.reduce((a,b) => a+b,0)/recent.length) : 0;
  }
  // Where another runner is from me on the loop, the short way round, in metres (+ ahead, − behind), and whether meeting
  // it that way is a lap: the thief's lead on the officer is more than half a lap but not yet a whole one, so the thief
  // comes up behind the officer. The edge markers and the plain line say it the same way.
  function loopGap(game,me,other) {
    const lap = game.lap, apart = position(other)-position(me);
    const lead = me.side === other.side ? 0 : me.side === 'police' ? apart : -apart;
    return {metres:Math.round((mod(apart+lap/2,lap)-lap/2)*METERS_PER_LETTER),lapping:lead > lap/2 && lead < lap};
  }
  // (Called every frame: the wording is looked up once, here.)
  const GAP_WORDS = {level:tx('并排'),ahead:tx('前方 {n} 米').split('{n}'),behind:tx('后方 {n} 米').split('{n}'),lap:tx(' · 套圈')};
  const gapText = ({metres,lapping}) => {
    if (Math.abs(metres) < 1) return GAP_WORDS.level;
    const [before,after = ''] = metres > 0 ? GAP_WORDS.ahead : GAP_WORDS.behind;
    return `${before}${Math.abs(metres)}${after}${lapping ? GAP_WORDS.lap : ''}`;
  };
  const formatClock = ms => { const s = Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(s/60)}:${String(s % 60).padStart(2,'0')}`; };

  /* ---------- Overlay state ---------- */

  const ui = {open:false,opts:{},root:null,view:'home',prefs:null,records:[],index:null,clips:null,assets:null,images:new Map(),game:null,
    picker:null,stage:null,loop:0,timers:new Set(),sfx:{context:null},slice:null,resultsFor:null,expanded:'',
    room:null,joining:false,joinCode:'',busy:false,botMenu:'',botMenuNew:false,roomEdit:false,serverUsual:0,clock:null,pollTimer:0,historyKind:'all',uploading:new Set(),english:new Map()};
  const $ = selector => ui.root?.querySelector(selector);
  const e = value => (ui.opts.escapeHTML || (text => String(text ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))))(value);
  const versioned = path => `${path}${ui.opts.version ? `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(ui.opts.version)}` : ''}`;
  const ICONS = {
    close:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back:'<path d="M14.5 6 8.5 12l6 6"/>',
    next:'<path d="m9.5 6 6 6-6 6"/>',
    down:'<path d="m6 9.5 6 6 6-6"/>',
    play:'<path d="M8 5.5v13l10.5-6.5z"/>',
    sound:'<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4M18.3 6a8.6 8.6 0 0 1 0 12"/>',
    mute:'<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    music:'<path d="M9 17.5V6l10-2.2v11.7"/><circle cx="6.6" cy="17.6" r="2.4"/><circle cx="16.6" cy="15.6" r="2.4"/>',
    'music-off':'<path d="M9 17.5V6l10-2.2v11.7"/><circle cx="6.6" cy="17.6" r="2.4"/><circle cx="16.6" cy="15.6" r="2.4"/><path d="M3.5 3.5l17 17"/>',
    follow:'<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3v2.5M12 18.5V21M3 12h-.5M21.5 12H21"/>',
    still:'<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M7 15.5c2-3 3.5-4.5 5-4.5s3 1.5 5 4.5"/>',
    book:'<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H18v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H18v-3"/>',
    cuffs:'<circle cx="7.5" cy="14.5" r="4"/><circle cx="16.5" cy="14.5" r="4"/><path d="M10 11.5c.6-2.6 3.4-2.6 4 0M7.5 10.5V8.8M16.5 10.5V8.8"/>',
    taunt:'<circle cx="12" cy="12" r="8"/><path d="M8.6 10h.01M15.4 10h.01M8.5 14c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5"/><path d="M11 15.4v1.6a1 1 0 0 0 2 0v-1.6"/>',
    clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    history:'<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9M12 8v4l2.8 1.8"/>',
    check:'<path d="m5.5 12.5 4 4 9-9"/>',
    plus:'<path d="M12 5.5v13M5.5 12h13"/>',
    link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    map:'<path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
    eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    scene:'<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m3.8 16 4.7-4.5 3.5 3.2 2.5-2.2 6 5"/><circle cx="15.5" cy="9.3" r="1.4"/>',
    track:'<path d="M3.5 12h17"/><circle cx="8" cy="12" r="2"/><circle cx="16.5" cy="12" r="2"/>',
    people:'<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="9.5" r="2.5"/><path d="M3.5 19a5 5 0 0 1 10 0M13.5 15.2a4.5 4.5 0 0 1 7 3.8"/>',
    keyboard:'<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.2h8"/>',
    mic:'<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6"/>',
    'keyboard-hide':'<rect x="2.5" y="3.5" width="19" height="11" rx="2.5"/><path d="M6.5 7.3h.01M10 7.3h.01M14 7.3h.01M17.5 7.3h.01M8 11h8"/><path d="m9 18 3 2.5 3-2.5"/>',
  };
  const icon = name => `<svg class="pc-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const button = (action,text,kind='',extra='') => `<button type="button" class="pc-button ${kind}" data-pc="${action}" ${extra}>${text}</button>`;
  // The mark on an avatar: a name's first character; the last two digits of a default name (学习者1234 → 34, as a class
  // of 学习者 would otherwise all show 学); a room's computer player shows its noun's last character (帅气的小明 → 明).
  const initial = (name,bot) => { const text = String(name || '').trim(), chars = [...text]; return /^学习者\d{2,}$/.test(text) ? text.slice(-2) : (bot && text.includes('的') ? chars[chars.length-1] : chars[0]) || '?'; };
  const avatar = (name,side,extra='',bot=false) => `<span class="pc-avatar is-${side}${extra}" aria-hidden="true">${e(initial(name === '我' ? ME : name,bot))}</span>`;
  const sprite = name => versioned(`assets/chase/${name}.webp`);
  const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const later = (fn,ms) => { const id = setTimeout(() => { ui.timers.delete(id); fn(); },ms); ui.timers.add(id); return id; };

  function readJSON(key,fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; }
  }
  function writeJSON(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { return false; } }
  function readPrefs() {
    const saved = readJSON(PREFS_KEY,{}) || {};
    return {side:saved.side === 'thief' ? 'thief' : 'police',section:typeof saved.section === 'string' ? saved.section : '1.1',
      // Typing material: a 听读 section, or a word range from 练习 (its token and the name it had when picked).
      text:saved.text === 'words' && typeof saved.words === 'string' && saved.words ? 'words' : 'section',
      words:typeof saved.words === 'string' ? saved.words : '',wordsTitle:typeof saved.wordsTitle === 'string' ? saved.wordsTitle.slice(0,60) : '',
      opponents:[1,2,3].includes(saved.opponents) ? saved.opponents : 1,teammates:[0,1,2].includes(saved.teammates) ? saved.teammates : 0,
      input:saved.input === 'read' ? 'read' : 'type',
      level:LEVELS[saved.level] ? saved.level : 'match',end:ENDS[saved.end] ? saved.end : 'catch',minutes:MINUTES.includes(saved.minutes) ? saved.minutes : 3,
      // Someone who asked their device for less motion starts in the wide view (they can still switch).
      // Background music starts out as the sound does (someone who silenced the game before keeps it silent).
      sound:saved.sound !== false,music:saved.music == null ? saved.sound !== false : saved.music !== false,camera:saved.camera === 'still' || (saved.camera == null && reduceMotion()) ? 'still' : 'follow',map:mapOf(saved.map).id,
      // 3D is the look for everyone (2026-11-06); a look is kept only when the player picked it (`lookPicked`), since
      // the whole prefs object is saved and every earlier player has the old default 像素 stored.
      look:saved.lookPicked && LOOKS[saved.look] ? saved.look : DEFAULT_LOOK,lookPicked:Boolean(saved.lookPicked && LOOKS[saved.look]),
      // The game's own keyboard can be put away (a touch-screen laptop types on its real keys).
      keys:saved.keys !== false,
      // The picture can be switched off for a plain track line (quiet, and light on the computer).
      scene:saved.scene !== false};
  }
  const savePrefs = () => writeJSON(PREFS_KEY,ui.prefs);
  const readRecords = () => { const list = readJSON(RECORDS_KEY,[]); return Array.isArray(list) ? list.filter(item => item && typeof item === 'object') : []; };

  async function fetchJSON(path) {
    const response = await fetch(versioned(path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  // The section list, the word clips and the artwork are fetched once per page.
  function loadIndex() {
    ui.indexLoad ||= fetchJSON('data/reader-index.json').then(data => { ui.index = data; return data; }).catch(error => { ui.indexLoad = null; throw error; });
    return ui.indexLoad;
  }
  function loadClips() {
    ui.clipsLoad ||= Promise.all([fetchJSON('data/pronunciation.json'),fetchJSON('data/chase-clips.json').catch(() => ({}))]).then(([main,extra]) => {
      ui.clips = {main:main || {},extra:extra || {}};
      return ui.clips;
    }).catch(error => { ui.clipsLoad = null; throw error; });
    return ui.clipsLoad;
  }
  function loadImage(name) {
    if (ui.images.has(name)) return ui.images.get(name).ready;
    const image = new Image();
    image.decoding = 'async';
    const entry = {image,ok:false};
    entry.ready = new Promise(resolve => {
      image.onload = () => { entry.ok = true; resolve(entry); };
      image.onerror = () => resolve(entry);
    });
    image.src = sprite(name);
    ui.images.set(name,entry);
    return entry.ready;
  }
  function loadAssets() {
    ui.assetsLoad ||= fetchJSON('assets/chase/manifest.json').then(manifest => {
      ui.assets = manifest;
      const names = [...Object.keys(manifest.sprites || {}),manifest.track?.image?.replace(/\.webp$/,'')].filter(Boolean);
      return Promise.all(names.map(loadImage)).then(() => manifest);
    }).catch(error => { ui.assetsLoad = null; throw error; });
    return ui.assetsLoad;
  }
  function clipFor(word,key,lexicon) {
    const clips = ui.clips || {main:{},extra:{}}, lower = word.toLocaleLowerCase('nb');
    return lexicon?.[key]?.clip || clips.main[lower] || clips.main[word] || clips.extra[lower] || '';
  }
  async function loadSection(id) {
    const index = await loadIndex(), meta = index.sections.find(section => section.id === id);
    if (!meta) throw new Error(`unknown section ${id}`);
    const [reader,,english] = await Promise.all([fetchJSON(`data/${meta.file}`),loadClips().catch(() => null),loadEnglish(id)]);
    return buildSection(reader,meta,(word,key) => clipFor(word,key,reader.lexicon),english);
  }
  // A section's English sentences (English devices only; null elsewhere or while a section has none yet).
  function loadEnglish(id) {
    if (!EN) return Promise.resolve(null);
    return Promise.resolve(L10N.data(`reader/${id}`)).catch(() => null).then(data => {
      const sentences = data?.sentences && typeof data.sentences === 'object' ? data.sentences : null;
      ui.english.set(id,sentences);
      return data;
    });
  }
  // The meaning under a sentence or a word: Chinese on Chinese devices. On English ones a sentence shows its English or
  // nothing (never the Chinese); a word falls back to its Chinese when it has no English.
  function meaningOf(item) {
    if (!EN) return String(item?.zh || '');
    if (item?.en) return String(item.en);
    if (item?.section === 'words') return String(item.zh || '');
    const known = ui.english.get(item?.section);
    if (known) return String(known[item.text] ?? known[String(item.text || '').normalize('NFC')] ?? '');
    // An older record: its section's English is fetched once, and the page drawn again when it comes.
    if (item?.section && !ui.english.has(item.section)) {
      ui.english.set(item.section,null);
      void loadEnglish(item.section).then(data => { if (data && ui.open && ['results','history'].includes(ui.view)) render(); });
    }
    return '';
  }
  // The next section of the same book, or the chapter's first one again at the end of the book.
  function nextSectionId(id) {
    const sections = ui.index?.sections || [], book = bookOf(id), list = sections.filter(section => bookOf(section.id) === book);
    const at = list.findIndex(section => section.id === id);
    if (at >= 0 && at < list.length-1) return list[at+1].id;
    return list.find(section => section.chapter === list[at]?.chapter)?.id || list[0]?.id || id;
  }

  // Word ranges come from 练习 (its current textbook, the basics and my wordbook), as 联机翻翻乐 uses them.
  // `name` is what the room's title carries (the same on every device); `label` is what this device shows.
  const WORD_GROUPS = [{id:'textbook',name:'课本单词',label:tx('课本单词'),groups:['chapter','section']},{id:'basics',name:'基础常识',label:tx('基础常识'),groups:['basics']},{id:'mine',name:'我的词本',label:tx('我的词本'),groups:['wordbook','mine']}];
  const ROOM_WORDS = 120, ROOM_WORD_BYTES = 14000;
  function wordSources() { try { const list = ui.opts.sources?.(); return Array.isArray(list) ? list : []; } catch { return []; } }
  const wordGroupOf = source => WORD_GROUPS.find(group => group.groups.includes(source?.group)) || WORD_GROUPS[0];
  const wordRangeName = source => `${wordGroupOf(source).name} · ${source.label}`.slice(0,60);
  // A title made on any device ("词语 · 课本单词 · …") in this device's words; other titles are Norwegian already.
  function titleText(title) {
    const text = String(title || '');
    if (!EN) return text;
    let rest = text.startsWith('词语 · ') ? text.slice(5) : null;
    if (rest == null) return text;
    const group = WORD_GROUPS.find(item => rest.startsWith(`${item.name} · `));
    if (group) rest = `${group.label} · ${rest.slice(group.name.length+3)}`;
    return `${tx('词语')} · ${rest}`;
  }
  // The words of a range, once each, with the first sense of their meaning (Chinese, and English where 练习 has it).
  // A room gets at most ROOM_WORDS of them, drawn at random, so the list sent to everyone stays small: a word whose
  // English would pass the budget goes without it.
  const firstSense = (text,split) => String(text || '').split(split)[0].trim().slice(0,40);
  function wordList(token,room=false) {
    const source = wordSources().find(item => item.token === token);
    if (!source) return null;
    const seen = new Set(), list = [];
    for (const word of source.words || []) {
      const no = String(word?.word || '').normalize('NFC').trim(), key = no.toLocaleLowerCase('nb');
      if (!no || no.length > 40 || !TYPEABLE.test(no) || seen.has(key)) continue;
      seen.add(key);
      const en = firstSense(word.english || word.en,/;/);
      list.push({no,zh:firstSense(word.meaning,/[；;]/),...(en ? {en} : {})});
    }
    if (!room) return list.length ? {title:wordRangeName(source),list} : null;
    const picked = [], encoder = new TextEncoder(), sizeOf = item => encoder.encode(JSON.stringify(item)).length+1;
    let bytes = 0;
    for (const index of seededOrder(Math.random(),list.length)) {
      if (picked.length >= ROOM_WORDS) break;
      let item = list[index], size = sizeOf(item);
      if (bytes+size > ROOM_WORD_BYTES && item.en) { item = {no:item.no,zh:item.zh}; size = sizeOf(item); }
      if (bytes+size > ROOM_WORD_BYTES) break;
      picked.push(item);
      bytes += size;
    }
    return picked.length ? {title:wordRangeName(source),list:picked} : null;
  }
  const textName = (p = ui.prefs) => p.text === 'words' ? (p.wordsTitle ? titleText(`词语 · ${p.wordsTitle}`) : tx('选择词语')) : sectionName(p.section);

  /* ---------- Sound ---------- */
  // A few quiet synthesised cues; word readings go through the site's own player.
  function sfxContext() {
    if (!ui.prefs?.sound) return null;
    let context = ui.sfx.context;
    if (context && (context.state === 'closed' || context.state === 'interrupted')) { try { context.close(); } catch {} context = null; }
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      try { context = new Context(); } catch { return null; }
      const master = context.createGain();
      master.gain.value = .22;
      master.connect(context.destination);
      ui.sfx = {context,master};
    }
    if (context.state === 'suspended') Promise.resolve(context.resume()).catch(() => {});
    return context;
  }
  function releaseSfx() {
    const context = ui.sfx.context;
    ui.sfx = {context:null};
    if (context && context.state !== 'closed') { try { Promise.resolve(context.close()).catch(() => {}); } catch {} }
  }
  function tone(frequency,length,{type='sine',gain=.5,delay=0,glide=0}={}) {
    const context = sfxContext();
    if (!context) return;
    gain *= ui.sfx.level ?? 1;
    const at = context.currentTime+delay, oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency,at);
    if (glide) oscillator.frequency.exponentialRampToValueAtTime(glide,at+length);
    envelope.gain.setValueAtTime(0,at);
    envelope.gain.linearRampToValueAtTime(gain,at+.008);
    envelope.gain.exponentialRampToValueAtTime(.0001,at+length);
    oscillator.connect(envelope).connect(ui.sfx.master);
    oscillator.start(at);
    oscillator.stop(at+length+.02);
  }
  function whoosh(length=.45,gain=.35) {
    const context = sfxContext();
    if (!context) return;
    gain *= ui.sfx.level ?? 1;
    const at = context.currentTime, size = Math.floor(context.sampleRate*length), buffer = context.createBuffer(1,size,context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random()*2-1)*(1-i/size);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(500,at);
    filter.frequency.exponentialRampToValueAtTime(2600,at+length*.8);
    envelope.gain.setValueAtTime(0,at);
    envelope.gain.linearRampToValueAtTime(gain,at+length*.35);
    envelope.gain.linearRampToValueAtTime(0,at+length);
    source.connect(filter).connect(envelope).connect(ui.sfx.master);
    source.start(at);
  }
  const SOUNDS = {
    tick:() => tone(784,.09,{type:'triangle',gain:.35}),
    go:() => { tone(587,.22,{type:'triangle',gain:.32}); tone(880,.42,{gain:.28,delay:.07}); },
    gear:() => whoosh(.42,.3),
    cuffs:() => { tone(2093,.07,{type:'triangle',gain:.22}); tone(2794,.09,{gain:.18,delay:.05}); tone(1568,.24,{gain:.16,delay:.11}); },
    taunt:() => { tone(523,.1,{type:'triangle',gain:.3}); tone(659,.1,{type:'triangle',gain:.3,delay:.11}); tone(440,.24,{type:'triangle',gain:.3,delay:.22,glide:330}); },
    finish:() => { tone(523,.5,{gain:.22}); tone(659,.5,{gain:.2,delay:.09}); tone(784,.8,{gain:.2,delay:.18}); },
  };
  // Other players' catches and taunts sound softer than mine.
  const play = (name,level=1) => { try { if (!sfxContext()) return; ui.sfx.level = level; SOUNDS[name]?.(); } catch {} finally { ui.sfx.level = 1; } };
  // Safari only lets sound start inside a tap or a key press, so the cues are woken up there (and again after the tab
  // was hidden, which closes them).
  function wakeSfx() {
    const context = ui.sfx.context;
    if (ui.prefs?.sound && (!context || context.state !== 'running')) sfxContext();
    wakeMusic();
  }

  /* ---------- Music ---------- */
  // The songs play quietly under the game in a shuffled order, with a short pause between two. The order comes from a
  // seed and the place in it from the game clock, so in a room (seeded by the game's id, timed on the server's clock)
  // everyone hears the same song at the same moment, and someone arriving late or coming back joins it where it is.
  const MUSIC_LEVEL = .3, MUSIC_GAP = 2, MUSIC_FADE = 1.2;
  function loadMusic() {
    ui.musicLoad ||= fetchJSON('assets/chase/music.json')
      .then(data => (ui.musicTracks = (Array.isArray(data?.tracks) ? data.tracks : []).filter(track => track?.file && track.duration > 0)))
      .catch(() => { ui.musicLoad = null; return []; });
    return ui.musicLoad;
  }
  // The song and the second in it at game time t (seconds); null in the pause between two songs.
  function musicAt(tracks,order,t) {
    const round = order.reduce((sum,index) => sum+tracks[index].duration+MUSIC_GAP,0);
    let at = ((t % round)+round) % round;
    for (const index of order) {
      const track = tracks[index];
      if (at < track.duration) return {track,offset:at};
      at -= track.duration+MUSIC_GAP;
      if (at < 0) return null;
    }
    return null;
  }
  // One audio element per visit. With Web Audio it plays through a gain node: iPhones and iPads ignore an element's
  // volume, and the songs must stay well under the word readings.
  function musicPlayer() {
    if (ui.music) return ui.music;
    const audio = new Audio();
    audio.preload = 'auto';
    const player = ui.music = {audio,context:null,gain:null,level:0,file:'',timer:0,blocked:false,pending:false,seek:false};
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const gain = context.createGain();
      gain.gain.value = 0;
      context.createMediaElementSource(audio).connect(gain).connect(context.destination);
      Object.assign(player,{context,gain});
    } catch { audio.volume = 0; }
    audio.addEventListener('loadedmetadata',() => { player.seek = true; musicTick(); });
    return player;
  }
  function setMusicLevel(player,level) {
    player.level = level;
    if (player.gain) player.gain.gain.value = level; else player.audio.volume = level;
  }
  // A game gets its order once the list is here; the player then follows the game clock until the game is gone.
  function prepareMusic(game,seed) {
    void loadMusic().then(tracks => {
      if (ui.game !== game || !tracks.length) return;
      game.music = seededOrder(seed,tracks.length);
      const player = musicPlayer();
      player.timer ||= setInterval(musicTick,120);
      musicTick();
    });
  }
  function musicTick() {
    const player = ui.music;
    if (!player) return;
    const {audio} = player, game = ui.game, tracks = ui.musicTracks || [];
    const live = Boolean(ui.prefs?.music && game?.music && game.status === 'playing' && !game.paused && !game.over && !document.hidden);
    const spot = live ? musicAt(tracks,game.music,gameNow(game)/1000) : null;
    const now = performance.now(), dt = Math.min(.25,(now-(player.stamp || now))/1000);
    player.stamp = now;
    if (spot) {
      const url = new URL(versioned(spot.track.file),location.href).href;
      if (player.file !== url) {
        // A new song comes in from silence (heard from its first note when it is just beginning).
        Object.assign(player,{file:url,track:spot.track,seek:false,shown:false});
        setMusicLevel(player,0);
        audio.src = url;
      } else if (audio.readyState >= 1) {
        const drift = audio.currentTime-spot.offset;
        if (player.seek || Math.abs(drift) > 1.5) {
          player.seek = false;
          if (Math.abs(drift) > .05) { try { audio.currentTime = spot.offset; } catch {} }
          audio.playbackRate = 1;
        } else if (game.room) {
          // In a room a small drift is taken back by playing a touch faster or slower, which nobody hears.
          audio.playbackRate = Math.abs(drift) < .03 ? 1 : 1-Math.max(-.04,Math.min(.04,drift/5));
        }
        if (audio.paused && !audio.ended && !player.blocked && !player.pending) {
          player.pending = true;
          if (player.context?.state === 'suspended') Promise.resolve(player.context.resume()).catch(() => {});
          // Safari starts sound only from a tap or a key; then the next one starts it (see wakeMusic).
          audio.play().then(() => { if (!player.shown && ui.music === player) { player.shown = true; songCaption(player.track); } })
            .catch(() => { player.blocked = true; }).finally(() => { player.pending = false; });
        }
      }
    }
    const playing = Boolean(spot && !audio.paused && !audio.seeking);
    const target = playing && player.context?.state !== 'suspended' ? MUSIC_LEVEL : 0;
    const step = MUSIC_LEVEL*dt/MUSIC_FADE;
    const level = playing && spot.offset < .6 ? target : player.level+Math.max(-step,Math.min(step,target-player.level));
    if (level !== player.level) setMusicLevel(player,level);
    if (!spot && player.level <= 0) {
      if (!audio.paused) audio.pause();
      if (!ui.game) { clearInterval(player.timer); player.timer = 0; }
    }
  }
  function wakeMusic() {
    const player = ui.music;
    if (!player || !ui.prefs?.music) return;
    if (player.context?.state === 'suspended') Promise.resolve(player.context.resume()).catch(() => {});
    if (player.blocked) { player.blocked = false; musicTick(); }
  }
  function pauseMusic() {
    const player = ui.music;
    if (!player) return;
    try { player.audio.pause(); } catch {}
    setMusicLevel(player,0);
  }
  function stopMusic() {
    const player = ui.music;
    if (!player) return;
    ui.music = null;
    clearInterval(player.timer);
    try { player.audio.pause(); player.audio.removeAttribute('src'); player.audio.load(); } catch {}
    if (player.context) { try { Promise.resolve(player.context.close()).catch(() => {}); } catch {} }
  }
  // The song's name comes up for a moment in the corner of the picture when it starts.
  function songCaption(track) {
    const stage = $('#pc-stage');
    if (!stage || !track) return;
    stage.querySelector('.pc-song')?.remove();
    stage.insertAdjacentHTML('beforeend',`<p class="pc-song" aria-hidden="true">${icon('music')}<span><b>${e(track.title)}</b><small>${e(track.artist)}</small></span></p>`);
    const caption = stage.querySelector('.pc-song');
    later(() => caption.classList.add('is-gone'),5200);
    later(() => caption.remove(),6200);
  }

  /* ---------- Open, close, navigation ---------- */
  function open(options={}) {
    if (ui.open) return Promise.resolve(true);
    if (!document?.body) return Promise.resolve(false);
    Object.assign(ui,{open:true,opts:options,view:'home',prefs:readPrefs(),records:readRecords(),game:null,picker:null,expanded:'',resultsFor:null,
      lastFocus:document.activeElement,historyToken:'pc-'+Date.now().toString(36)});
    const root = document.createElement('div');
    root.className = 'pc-root';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label',tx('警察抓小偷'));
    ui.root = root;
    ui.handlers = {click:onClick,submit:onSubmit,input:onFieldInput};
    for (const [type,handler] of Object.entries(ui.handlers)) root.addEventListener(type,handler);
    // Before the game's own handlers, so a finger never focuses the hidden field first.
    root.addEventListener('pointerdown',onPointer,true);
    document.addEventListener('keydown',onRootKey);
    document.addEventListener('focusin',onFocusIn);
    ui.onVisibility = onVisibility;
    ui.onResize = () => { fitViewport(); if (ui.stage) layoutStage(); };
    ui.onPopState = () => { if (ui.open) requestClose(true); };
    document.addEventListener('visibilitychange',ui.onVisibility);
    window.addEventListener('resize',ui.onResize);
    window.visualViewport?.addEventListener('resize',ui.onResize);
    window.visualViewport?.addEventListener('scroll',fitViewport);
    window.addEventListener('popstate',ui.onPopState);
    window.addEventListener('pagehide',ui.onPageHide = () => { releaseSfx(); pauseMusic(); });
    try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskChase:ui.historyToken},'',location.href); } catch {}
    document.body.append(root);
    document.body.classList.add('pc-open');
    render();
    $('h2')?.focus?.({preventScroll:true});
    // (Not while the room code form is open on the home page: drawing it again would put the phone's keyboard away.)
    void loadIndex().then(() => { if (ui.open && ui.view !== 'game' && !(ui.view === 'home' && ui.joining)) render(); }).catch(() => {});
    void loadPlan();
    void loadAssets().catch(() => {});
    void loadClips().catch(() => {});
    void (async () => {
      try {
        const community = await ui.opts.community?.();
        const profile = await community?.profile?.();
        if (profile?.nickname && ui.open) { ui.nickname = profile.nickname; if (ui.view === 'home' && !ui.joining) render(); }
        // The speed on my avatar is the average of my last ten games on any device with my nickname.
        const mine = await community?.request?.('/chase/usual',{timeout:8000});
        if (Number.isFinite(mine?.usual) && ui.open) { ui.serverUsual = mine.usual; if ((ui.view === 'home' && !ui.joining) || ui.view === 'history') render(); }
        for (const record of ui.records.filter(item => item.synced === false).slice(0,5)) await uploadRecord(record);
        const left = readJSON(LEFT_KEY,[]);
        for (const record of (Array.isArray(left) ? left : []).filter(item => item?.id && Date.now()-Number(item.at) < 3*86400000).slice(0,5)) await uploadRecord({...record,synced:false});
      } catch {}
    })();
    if (/^\d{4}$/.test(String(options.join || ''))) void joinRoom(String(options.join));
    return Promise.resolve(true);
  }
  function exit() {
    if (!ui.open) return;
    closeRoomMic();
    leaveRoom();
    creditLeft(ui.game);
    stopGame();
    stopSlice();
    releaseSfx();
    stopMusic();
    for (const id of ui.timers) clearTimeout(id);
    ui.timers.clear();
    for (const [type,handler] of Object.entries(ui.handlers || {})) ui.root?.removeEventListener(type,handler);
    ui.root?.removeEventListener('pointerdown',onPointer,true);
    document.removeEventListener('visibilitychange',ui.onVisibility);
    document.removeEventListener('keydown',onRootKey);
    document.removeEventListener('focusin',onFocusIn);
    clearTimeout(ui.toastTimer);
    ui.toast?.remove();
    ui.toast = null;
    window.removeEventListener('resize',ui.onResize);
    window.visualViewport?.removeEventListener('resize',ui.onResize);
    window.visualViewport?.removeEventListener('scroll',fitViewport);
    window.removeEventListener('popstate',ui.onPopState);
    window.removeEventListener('pagehide',ui.onPageHide);
    ui.root?.remove();
    document.body.classList.remove('pc-open');
    ui.open = false;
    ui.root = null;
    if (history.state?.norskChase === ui.historyToken) {
      // The page the overlay goes back to may still carry an invitation's room code.
      try { window.addEventListener('popstate',() => setRoomInURL(null),{once:true}); history.back(); } catch {}
    }
    try { ui.lastFocus?.focus?.({preventScroll:true}); } catch {}
    try { ui.opts.onExit?.(); } catch {}
  }
  // Back and Esc step out one level: a sheet, then a page, then a game (after asking), then the overlay.
  function requestClose(fromHistory=false) {
    if (fromHistory) {
      try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskChase:ui.historyToken},'',location.href); } catch {}
    }
    if (ui.confirming) { hideConfirm(); return; }
    if (ui.picker) { closePicker(); return; }
    // Watching (or still loading a game to watch): back to the room.
    if (ui.game?.watch || (ui.view === 'game' && ui.starting?.watch)) { ui.game = null; ui.starting = null; show('room'); return; }
    // A game just decided shows its results now instead of after the pause.
    if (ui.game?.over) {
      const game = ui.game;
      ui.game = null;
      if (game.record) { ui.resultsFor = {game,record:game.record,room:Boolean(game.room)}; show('results'); }
      else show(game.room ? 'room' : 'home');
      return;
    }
    // A game in play, or a room game still loading (leaving it means leaving the room), asks first.
    if (ui.game || (ui.view === 'game' && ui.starting?.room)) { showConfirm(); return; }
    if (ui.joining) { closeJoin(); return; }
    if (ui.view === 'room' && (ui.botMenu || ui.roomEdit)) { ui.botMenu = ''; ui.roomEdit = false; render(); return; }
    if (ui.view === 'room' && ui.room) { showConfirm('room'); return; }
    if (ui.view === 'results' && ui.room) { show('room'); return; }
    if (ui.view !== 'home') { show('home'); return; }
    exit();
  }
  // The page behind the overlay is out of reach: Tab and Shift+Tab come back into the game.
  function onFocusIn(event) {
    if (!ui.open || !ui.root || ui.root.contains(event.target)) return;
    // A spectator has no typing field: the bar's close button takes the focus.
    if (ui.view === 'game' && !ui.confirming) { if ($('#pc-type')?.hidden) $('[data-pc="close"]')?.focus?.({preventScroll:true}); else focusInput(); }
    else (ui.root.querySelector('.pc-confirm [data-pc]') || $('h2'))?.focus?.({preventScroll:true});
  }
  // The site's own toast sits under this overlay, so the game shows its messages itself. It stands where the on-screen
  // keyboard and the sticky buttons never cover it: near the top of the visible page, or in a game at the foot of the
  // picture, clear of the score banner and the sentence being typed. A notice with no duration stays until the next one.
  function notify(message,duration=3600,{select=false}={}) {
    if (!ui.open) return;
    if (!ui.toast) {
      ui.toast = document.createElement('p');
      ui.toast.className = 'pc-toast is-top';
      ui.toast.setAttribute('role','status');
      ui.toast.setAttribute('aria-live','polite');
      document.body.append(ui.toast);
    }
    ui.toast.textContent = message;
    // A link offered for copying by hand can be selected.
    ui.toast.classList.toggle('is-select',select);
    placeToast();
    ui.toast.classList.remove('is-on');
    void ui.toast.offsetWidth;
    ui.toast.classList.add('is-on');
    clearTimeout(ui.toastTimer);
    if (duration > 0) ui.toastTimer = setTimeout(() => ui.toast?.classList.remove('is-on'),duration);
  }
  // (Placed again when the page changes under a notice still showing.)
  function placeToast() {
    if (!ui.toast) return;
    const stage = ui.view === 'game' ? $('#pc-stage')?.getBoundingClientRect() : null;
    const bar = ui.view === 'game' ? null : $('.pc-top')?.getBoundingClientRect();
    const top = stage?.height ? stage.bottom-14-ui.toast.offsetHeight
      : Math.max((window.visualViewport?.offsetTop || 0)+14,bar && bar.bottom > 0 ? bar.bottom+6 : 0);
    ui.toast.style.top = `max(calc(env(safe-area-inset-top) + 10px),${Math.round(top)}px)`;
  }
  function show(view) {
    // Stepping out of the room's pages leaves the room.
    if (ui.room && !['room','game','results'].includes(view)) leaveRoom();
    ui.view = view;
    if (view !== 'game') stopGame();
    stopSlice();
    // A re-render removes the leave dialog, so it is no longer open.
    ui.confirming = false;
    render();
    ui.root?.scrollTo?.(0,0);
    $('h2')?.focus?.({preventScroll:true});
    if (ui.toast?.classList.contains('is-on')) placeToast();
    if (view === 'setup' && ui.prefs.input === 'read') void checkSpeech();
  }
  function onVisibility() {
    if (ui.room && !document.hidden) schedulePoll(0);
    if (document.hidden) {
      releaseSfx();
      pauseMusic();
      pauseGame();
    } else if (isHeld(ui.game) && !ui.confirming) {
      resumeGame();
    }
  }
  // On phones the keyboard covers the bottom of the layout viewport; the game follows the visible part.
  function fitViewport() {
    if (!ui.root) return;
    const viewport = window.visualViewport;
    if (!viewport || ui.view !== 'game') { ui.root.style.removeProperty('--pc-vh'); ui.root.style.removeProperty('--pc-top'); ui.root.classList.remove('is-cramped'); return; }
    ui.root.style.setProperty('--pc-vh',`${Math.round(viewport.height)}px`);
    ui.root.style.setProperty('--pc-top',`${Math.round(viewport.offsetTop)}px`);
    // The page lost a keyboard's worth of height at the same width while typing in the hidden field: a system keyboard
    // came up after all (some browsers resize the whole page, so keyboardHeight() alone may read 0).
    const tall = Math.round(viewport.height), wide = window.innerWidth;
    if (navigator.maxTouchPoints > 0 && Math.abs((viewport.scale || 1)-1) <= .01) {
      if (ui.tallAt !== wide) { ui.tallAt = wide; ui.tall = tall; } else ui.tall = Math.max(ui.tall,tall);
      if (!ui.ownKeys && ui.game && (keyboardHeight() >= 120 || ui.tall-tall >= 120)) useOwnKeys();
    }
    // Little room left above the keyboard: the typing panel gets more compact.
    ui.root.classList.toggle('is-cramped',viewport.height < 560);
    // The keyboard is up: the note asking for a tap has done its work.
    if (keyboardHeight() >= 80) $('#pc-type')?.classList.remove('is-tap');
    if (ui.stage) requestAnimationFrame(layoutStage);
  }
  // How much of the window the on-screen keyboard covers (not counted while the page is pinch-zoomed).
  function keyboardHeight() {
    const viewport = window.visualViewport;
    if (!viewport || Math.abs((viewport.scale || 1)-1) > .01) return 0;
    return Math.max(0,Math.round(window.innerHeight-viewport.height));
  }

  /* ---------- Pages ---------- */
  function render() {
    if (!ui.root) return;
    ui.root.classList.toggle('is-game',ui.view === 'game');
    if (ui.view === 'game') return;
    const body = ui.view === 'setup' ? setupPage() : ui.view === 'results' ? resultsPage() : ui.view === 'history' ? historyPage() : ui.view === 'room' ? roomPage() : homePage();
    ui.root.innerHTML = `<div class="pc-shell">${body}</div>${ui.picker ? pickerSheet() : ''}`;
    // A recording still playing keeps its button lit when the page is drawn again (when the XP arrives, say).
    const slice = ui.slice;
    if (slice?.button && slice.owner != null) {
      const again = ui.root.querySelector(`[data-pc="slice"][data-owner="${CSS.escape(slice.owner)}"][data-index="${slice.index}"]`);
      if (again) { again.classList.add('is-playing'); slice.button = again; }
    }
  }
  const topBar = (title,back='home') => `<header class="pc-top">${back ? `<button type="button" class="pc-icon-button" data-pc="go" data-view="${back}" aria-label="${tx('返回')}">${icon('back')}</button>` : ''}<h2 tabindex="-1">${title}</h2><button type="button" class="pc-icon-button" data-pc="close" aria-label="${tx('离开警察抓小偷')}" title="${tx('离开')}">${icon('close')}</button></header>`;
  function meCard() {
    const usual = ui.serverUsual || usualRate(ui.records), name = ui.nickname || '我';
    return `<div class="pc-me">${avatar(name,ui.prefs.side)}<div class="pc-me-text"><strong>${e(nameOf(name))}</strong><span>${usual ? tx('平均 <b>{n}</b>/min',{n:usual}) : ui.records.length ? tx('最近几局还没有速度') : tx('还没有战绩')}</span></div>
      ${ui.view === 'history' ? '' : `<button type="button" class="pc-link" data-pc="go" data-view="history">${icon('history')}${tx('战绩')}</button>`}</div>`;
  }
  function homePage() {
    const recent = ui.records.slice(0,3);
    return `${topBar(tx('警察抓小偷'),'')}
      <section class="pc-hero"><img class="pc-hero-art" src="${sprite('key-art')}" alt="" decoding="async" draggable="false">
        <div class="pc-hero-text"><span class="pc-kicker">Politi og røver</span><p class="pc-hero-title">${tx('打课文，比速度')}</p><p class="pc-hero-note">${tx('打对一个字母就前进一步，打完一个词会念给你听。警察追上小偷算抓到；小偷多跑一圈、从后面追上警察，就是套圈，可以嘲笑他。')}${tx('人机对战也可以选「朗读」，念出课文来跑。')}</p></div></section>
      <div class="pc-actions">${button('go',`<span>${tx('人机对战')}</span>`,'pc-primary pc-wide','data-view="setup"')}
        ${ui.joining ? `<form class="pc-join" novalidate><label for="pc-join-code">${tx('房间号')}</label><input id="pc-join-code" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="${tx('4 位数字')}" value="${e(ui.joinCode)}">
          ${button('room-join',ui.busy ? tx('正在加入…') : tx('加入'),'pc-primary',`type="submit"${ui.busy ? ' disabled' : ''}`).replace('type="button" ','')}${button('room-join-cancel',tx('取消'),'pc-quiet')}</form>`
          : `<div class="pc-actions-row pc-room-actions">${button('room-create',ui.busy ? tx('正在开房间…') : tx('开房间'),'pc-ghost',ui.busy ? 'disabled' : '')}${button('room-join-open',tx('加入房间'),'pc-ghost')}</div>`}</div>
      ${meCard()}
      ${recent.length ? `<section class="pc-panel"><div class="pc-section-head"><h3>${tx('最近几局')}</h3><button type="button" class="pc-link" data-pc="go" data-view="history">${tx('全部')}${icon('next')}</button></div><ul class="pc-games">${recent.map(gameRow).join('')}</ul></section>` : ''}`;
  }
  function sectionMeta(id) { return ui.index?.sections?.find(section => section.id === id) || null; }
  function sectionName(id) {
    const meta = sectionMeta(id);
    return meta ? `${bookOf(id).name} · ${sectionLabel(id)} ${meta.title}` : (ui.index ? tx('选择课文') : tx('正在载入课文…'));
  }
  function option(group,value,label,current,hint='') {
    return `<button type="button" class="pc-option" role="radio" aria-checked="${current === value}" tabindex="${current === value ? 0 : -1}" data-pc="set" data-key="${group}" data-value="${value}"><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</button>`;
  }
  function setupPage() {
    const p = ui.prefs;
    const sideTile = side => `<button type="button" class="pc-side is-${side}" role="radio" aria-checked="${p.side === side}" tabindex="${p.side === side ? 0 : -1}" data-pc="set" data-key="side" data-value="${side}">
      <img src="${sprite(side === 'police' ? 'police-catch' : 'thief-taunt')}" alt="" decoding="async" draggable="false"><span class="pc-side-name">${SIDES[side].name}</span><small>${side === 'police' ? tx('追上小偷就是抓到') : tx('套警察一圈就能嘲笑他')}</small></button>`;
    return `${topBar(tx('人机对战'))}
      <section class="pc-panel pc-setup">
        <div class="pc-field"><span class="pc-label">${tx('地图 · 在 Brunstad 平面图上点选赛道')}</span>${planMarkup()}</div>
        <div class="pc-field"><span class="pc-label">${tx('玩法')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('玩法')}">${Object.entries(INPUTS).map(([key,item]) => option('input',key,item.name,p.input,item.hint)).join('')}</div>
          ${p.input === 'read' ? `<p class="pc-hint pc-read-state" id="pc-read-state" aria-live="polite">${e(readState())}</p>` : ''}</div>
        <div class="pc-field"><span class="pc-label">${tx('你当')}</span><div class="pc-sides" role="radiogroup" aria-label="${tx('身份')}">${sideTile('police')}${sideTile('thief')}</div></div>
        <div class="pc-field"><span class="pc-label">${p.input === 'read' ? tx('朗读内容') : tx('打字内容')}</span><button type="button" class="pc-pick" data-pc="picker">${icon('book')}<span>${e(textName(p))}</span>${icon('down')}</button></div>
        <div class="pc-field"><span class="pc-label">${tx('电脑对手')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('电脑对手')}">${[1,2,3].map(n => option('opponents',n,tx('{n} 名',{n}),p.opponents)).join('')}</div></div>
        <div class="pc-field"><span class="pc-label">${tx('电脑队友')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('电脑队友')}">${[0,1,2].map(n => option('teammates',n,n ? tx('{n} 名',{n}) : tx('不要'),p.teammates)).join('')}</div></div>
        <div class="pc-field"><span class="pc-label">${tx('电脑水平')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('电脑水平')}">${Object.entries(levelsFor(p.input === 'read')).map(([key,level]) => option('level',key,level.name,p.level,level.rate ? `${speedValue(level.rate,p.input === 'read')}${speedUnit(p.input === 'read')}` : tx('跟着你'))).join('')}</div></div>
        <div class="pc-field"><span class="pc-label">${tx('结束方式')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('结束方式')}">${option('end','catch',tx('抓到为止'),p.end,p.opponents+p.teammates > 1 ? tx('输了换阵营') : tx('一次定胜负'))}${MINUTES.map(n => option('minutes',n,tx('{n} 分钟',{n}),p.end === 'timed' ? p.minutes : 0,tx('比次数'))).join('')}</div></div>
        ${lookField()}
      </section>
      <div class="pc-actions pc-start-bar">${button('start',`<span>${tx('开始')}</span>`,'pc-primary pc-wide',ui.index ? '' : 'disabled')}</div>`;
  }
  // The picture's look, a choice of my own (in a room too: it is not part of the room's settings).
  function lookField(label = tx('画面')) {
    return `<div class="pc-field"><span class="pc-label">${label}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('画面')}">${Object.entries(LOOKS).map(([key,look]) => option('look',key,look.name,ui.prefs.look,look.hint)).join('')}</div></div>`;
  }
  // Brunstad drawn from the real map data: water, woods, roads, paths and buildings, with every region's loop on top in
  // its own colour. A loop, its label or its row in the list beside the plan picks that map.
  function planMarkup() {
    const p = ui.prefs, plan = ui.plan;
    const row = item => `<button type="button" class="pc-region${p.map === item.id ? ' is-on' : ''}" role="radio" aria-checked="${p.map === item.id}" tabindex="${p.map === item.id ? 0 : -1}" data-pc="set" data-key="map" data-value="${item.id}" style="--pc-region:${item.color}"><i aria-hidden="true"></i><span class="pc-region-name">${regionName(item)}</span><small>${item.kind === 'brunstad' ? (regionLength(item.id) ? tx('{n} 公里',{n:(regionLength(item.id)/1000).toFixed(1)}) : '') : tx('练习图')}</small></button>`;
    const list = `<div class="pc-regions" role="radiogroup" aria-label="${tx('地图')}">${MAPS.map(row).join('')}</div>`;
    if (!plan) return `<div class="pc-plan-wrap"><div class="pc-plan is-loading">${tx('正在载入 Brunstad 平面图…')}</div>${list}</div>`;
    const [x0,z0,x1,z1] = plan.bounds, width = x1-x0, height = z1-z0;
    const d = (points,close) => `M${points.map(point => `${point[0]} ${point[1]}`).join('L')}${close ? 'Z' : ''}`;
    const shapes = (list,cls) => list.map(points => `<path class="${cls}" d="${d(points,true)}"/>`).join('');
    const strokes = (list,cls) => list.map(points => `<path class="${cls}" d="${d(points,false)}"/>`).join('');
    const loops = plan.regions.map(region => {
      const item = mapOf(region.id), on = p.map === region.id;
      return `<g class="pc-plan-loop${on ? ' is-on' : ''}" data-pc="set" data-key="map" data-value="${region.id}" style="--pc-region:${item.color}"><path class="pc-plan-hit" d="${d(region.loop,true)}"/><path class="pc-plan-line" d="${d(region.loop,true)}"/></g>`;
    }).join('');
    const labels = plan.regions.map(region => {
      const item = mapOf(region.id), on = p.map === region.id;
      return `<button type="button" class="pc-plan-label${on ? ' is-on' : ''}" tabindex="-1" data-pc="set" data-key="map" data-value="${region.id}" style="left:${((region.label[0]-x0)/width*100).toFixed(2)}%;top:${((region.label[1]-z0)/height*100).toFixed(2)}%;--pc-region:${item.color}">${EN ? `<span lang="nb">${e(mapName(item))}</span>` : `${e(item.name)}${item.no ? `<span lang="nb">${e(item.no)}</span>` : ''}`}</button>`;
    }).join('');
    return `<div class="pc-plan-wrap"><div class="pc-plan" style="aspect-ratio:${width.toFixed(0)}/${height.toFixed(0)}"><svg viewBox="${x0} ${z0} ${width} ${height}" aria-hidden="true">
      <rect x="${x0}" y="${z0}" width="${width}" height="${height}" class="pc-plan-land"/>${shapes(plan.fields,'pc-plan-field')}${shapes(plan.woods,'pc-plan-wood')}${shapes(plan.water,'pc-plan-water')}
      ${strokes(plan.paths,'pc-plan-path')}${strokes(plan.roads,'pc-plan-road')}${shapes(plan.squares,'pc-plan-square')}${shapes(plan.buildings,'pc-plan-building')}${loops}</svg>${labels}
      <span class="pc-plan-north" aria-hidden="true">N</span>${plan.attribution ? `<small class="pc-plan-credit">${e(plan.credit || plan.attribution)}</small>` : ''}</div>${list}</div>
      <p class="pc-hint">${e(mapOf(p.map).kind === 'brunstad' ? tx('一圈 {km} 公里，每分钟打 120 个字母大约 {n} 分钟跑一圈。',{km:(regionLength(p.map)/1000).toFixed(2),n:Math.max(1,Math.round(regionLength(p.map)/METERS_PER_LETTER/120))}) : tx('湖畔小镇是用代码画的练习图，任何手机都能流畅载入。'))}</p>`;
  }
  // A map's row in the list: Chinese with the Norwegian under it; on English devices the Norwegian with English under it.
  function regionName(item) {
    if (!EN) return `${e(item.name)}${item.no ? `<span lang="nb">${e(item.no)}</span>` : ''}`;
    if (!item.no) return e(item.en);
    return `<b lang="nb">${e(item.no)}</b>${item.en && item.en !== item.no ? `<span>${e(item.en)}</span>` : ''}`;
  }
  const regionLength = id => ui.plan?.regions?.find(region => region.id === id)?.length_m || 0;
  function loadPlan() {
    ui.planLoad ||= fetchJSON('assets/chase/maps/plan.json').then(plan => {
      ui.plan = plan;
      if (ui.open && !ui.picker && (ui.view === 'setup' || (ui.view === 'room' && ui.roomEdit))) renderRoom();
      return plan;
    })
      .catch(() => { ui.planLoad = null; });
    return ui.planLoad;
  }
  // Two kinds of material in one sheet: 课文 (the 听读 sections, by book) and 词语 (the word ranges of 练习).
  function pickerSheet() {
    const picker = ui.picker, words = picker.kind === 'words';
    const kinds = `<div class="pc-kinds" role="tablist" aria-label="${tx('打字内容')}">${[['section',tx('课文')],['words',tx('词语')]].map(([kind,name]) => `<button type="button" role="tab" aria-selected="${picker.kind === kind}" data-pc="pick-kind" data-value="${kind}">${name}</button>`).join('')}</div>`;
    const tabs = words ? WORD_GROUPS.map(group => [group.id,group.label,group.id === picker.group]) : BOOKS.map(book => [book.id,book.name,book.id === picker.book]);
    return `<div class="pc-sheet-layer" data-pc="picker-close"><div class="pc-sheet" role="dialog" aria-modal="true" aria-label="${tx('选择打字内容')}">
      <div class="pc-sheet-head">${kinds}<button type="button" class="pc-icon-button" data-pc="picker-close" aria-label="${tx('关闭')}">${icon('close')}</button></div>
      <div class="pc-books" role="tablist">${tabs.map(([id,name,on]) => `<button type="button" role="tab" aria-selected="${on}" data-pc="${words ? 'word-group' : 'book'}" data-value="${id}">${e(name)}</button>`).join('')}</div>
      <div class="pc-chapters">${words ? wordRanges(picker.group) : sectionRanges(picker.book)}</div>
    </div></div>`;
  }
  function sectionRanges(book) {
    const sections = (ui.index?.sections || []).filter(section => bookOf(section.id).id === book), chapters = [...new Set(sections.map(section => section.chapter))];
    const current = ui.prefs.text === 'section' ? ui.prefs.section : '';
    return chapters.map(chapter => `<section class="pc-chapter"><h4>${tx('第 {n} 章',{n:chapter})}</h4><div class="pc-section-list">${sections.filter(section => section.chapter === chapter).map(section => `<button type="button" class="pc-section${section.id === current ? ' is-current' : ''}" data-pc="section" data-value="${e(section.id)}"><b>${e(sectionLabel(section.id))}</b><span>${e(section.title)}</span><small>${tx('{n} 词',{n:section.words})}</small></button>`).join('')}</div></section>`).join('');
  }
  // A textbook chapter heads its sections (the whole chapter is its first row); the basics and my wordbook are one list.
  function wordRanges(groupId) {
    const group = WORD_GROUPS.find(item => item.id === groupId) || WORD_GROUPS[0], all = wordSources();
    const sources = all.filter(source => group.groups.includes(source.group));
    const current = ui.prefs.text === 'words' ? ui.prefs.words : '';
    const row = (source,mark,name) => `<button type="button" class="pc-section${source.token === current ? ' is-current' : ''}" data-pc="words" data-value="${e(source.token)}"><b>${e(mark)}</b><span>${e(name)}</span><small>${tx('{n} 词',{n:source.words.length})}</small></button>`;
    if (!sources.length) {
      const note = !all.length ? tx('词语来自「练习」，请先打开一次练习页再来选。') : group.id === 'mine' ? tx('我的词本里还没有词语，收藏词和薄弱词也是空的。') : tx('这里还没有词语。');
      return `<p class="pc-picker-empty">${note}</p>`;
    }
    if (group.id !== 'textbook') return `<div class="pc-section-list">${sources.map((source,index) => row(source,source.group === 'mine' ? '★' : String(index+1),source.label)).join('')}</div>`;
    return sources.filter(source => source.group === 'chapter').map(chapter => {
      const parts = sources.filter(source => source.group === 'section' && source.parent === chapter.token);
      return `<section class="pc-chapter"><h4>${e(chapter.label)}</h4><div class="pc-section-list">${row(chapter,tx('全'),tx('整章'))}${parts.map(part => {
        const [mark,...rest] = part.label.split(' ');
        return /^[\d.]+$/.test(mark) && rest.length ? row(part,mark,rest.join(' ')) : row(part,'·',part.label);
      }).join('')}</div></section>`;
    }).join('');
  }
  function openPicker() {
    const source = ui.prefs.text === 'words' ? wordSources().find(item => item.token === ui.prefs.words) : null;
    ui.picker = {kind:ui.prefs.text,book:bookOf(ui.prefs.section).id,group:source ? wordGroupOf(source).id : 'textbook'};
    render();
    later(() => $('.pc-section.is-current')?.scrollIntoView?.({block:'center'}),30);
  }
  function closePicker() { ui.picker = null; render(); $('.pc-pick')?.focus?.({preventScroll:true}); }
  const RESULT_NAMES = {win:tx('胜'),loss:tx('负'),draw:tx('平')};
  const resultName = result => RESULT_NAMES[result] || '';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function gameRow(record) {
    const date = new Date(Number(record.at) || 0), clock = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    const when = Number.isFinite(Number(record.at)) && record.at ? EN ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${clock}` : `${date.getMonth()+1}月${date.getDate()}日 ${clock}` : '';
    return `<li class="pc-game-row"><button type="button" class="pc-game-button" data-pc="expand" data-value="${e(record.id)}" aria-expanded="${ui.expanded === record.id}">
      <span class="pc-result is-${e(record.result)}">${resultName(record.result)}</span>
      <span class="pc-game-main"><strong>${e(titleText(record.title || ''))}</strong><small>${record.kind === 'room' ? tx('房间局') : tx('人机局')}${record.input === 'read' ? ` · ${READ_NAME}` : ''} · ${when} · ${e(mapName(mapOf(record.map || 'lakeside')))} · ${SIDES[record.side]?.name || ''} · ${record.end === 'timed' ? tx('{n} 分钟',{n:record.minutes}) : tx('抓到为止')}</small></span>
      <span class="pc-game-score">${icon('cuffs')}${Number(record.score?.catch) || 0}<i>:</i>${Number(record.score?.taunt) || 0}${icon('taunt')}</span>
      <span class="pc-game-rate">${speedHTML(record.me?.rate,record.input === 'read')}</span></button>
      ${ui.expanded === record.id ? recordDetail(record) : ''}</li>`;
  }
  function recordDetail(record) {
    const me = record.me || {}, others = (record.players || []).filter(player => !player.me);
    const names = list => list.map(player => `${nameOf(player.name)}${player.side && player.startSide && player.side !== player.startSide ? tx('（换了阵营）') : ''}`).join(tx('、'));
    const mates = others.filter(player => (player.startSide || player.side) === record.side), rivals = others.filter(player => (player.startSide || player.side) !== record.side);
    const people = [mates.length ? tx('队友 {names}',{names:names(mates)}) : '', rivals.length ? tx('对手 {names}',{names:names(rivals)}) : ''].filter(Boolean).join(' · ');
    const vehicle = VEHICLES[record.finalSide || record.side]?.[(me.maxTier || 1)-1] || '';
    const line = record.input === 'read' ? tx('念了 {words} 个词 · 最高 {vehicle}',{words:Number(me.words) || 0,vehicle}) : tx('正确率 {n}% · {words} 个词 · 最高 {vehicle}',{n:Number(me.accuracy) || 0,words:Number(me.words) || 0,vehicle});
    return `<div class="pc-detail"><p class="pc-detail-line">${e(`${line}${people ? ` · ${people}` : ''}`)}</p>${sentenceList(record.sentences || [],record.id)}</div>`;
  }
  function sentenceList(sentences,owner) {
    if (!sentences.length) return '';
    return `<ol class="pc-sentences">${sentences.map((sentence,index) => { const meaning = meaningOf(sentence); return `<li><button type="button" class="pc-play" data-pc="slice" data-owner="${e(owner)}" data-index="${index}" aria-label="${sentence.section === 'words' ? tx('播放读音') : tx('播放原书录音')}"${sentence.audio && sentence.to > sentence.from ? '' : ' disabled'}>${icon('play')}</button><span><span lang="nb">${e(sentence.text)}</span>${EN && !meaning ? '' : `<small>${e(meaning)}</small>`}</span></li>`; }).join('')}</ol>`;
  }
  function historyPage() {
    const total = summarize(ui.records), rooms = ui.records.filter(record => record.kind === 'room').length;
    const list = ui.historyKind === 'all' ? ui.records : ui.records.filter(record => (record.kind === 'room' ? 'room' : 'bot') === ui.historyKind);
    const kinds = {all:tx('全部'),bot:tx('人机'),room:EN ? tx('房间（对局类型）') : '房间'};
    const tile = (label,value,note='') => `<div class="pc-tile"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
    return `${topBar(tx('我的战绩'))}
      ${meCard()}
      <section class="pc-panel"><div class="pc-tiles">${tile(tx('总局数'),total.games)}${tile(tx('胜率'),`${total.winRate}%`,tx('{wins} 胜 {losses} 负 {draws} 平',{wins:total.wins,losses:total.losses,draws:total.draws}))}${tile(tx('累计抓到'),total.catches)}${tile(tx('累计嘲笑'),total.taunts)}${tile(tx('最快一局'),total.best ? `${total.best}/min` : '—')}${tile(tx('最高开到'),total.bestTier ? VEHICLES[total.bestSide]?.[total.bestTier-1] || tx('第 {n} 档',{n:total.bestTier}) : '—')}</div>
        <p class="pc-sides-line"><span>${tx('当警察 {n} 局 · 胜 {wins}',{n:total.police.games,wins:total.police.wins})}</span><span>${tx('当小偷 {n} 局 · 胜 {wins}',{n:total.thief.games,wins:total.thief.wins})}</span><span>${tx('人机 {n} 局 · 房间 {rooms} 局',{n:total.games-rooms,rooms})}</span></p></section>
      <section class="pc-panel"><div class="pc-section-head"><h3>${tx('每局记录')}</h3>${ui.records.length ? `<div class="pc-segment pc-kinds" role="radiogroup" aria-label="${tx('对局类型')}">${Object.entries(kinds).map(([key,name]) => option('kind',key,name,ui.historyKind)).join('')}</div>` : ''}</div>
        ${list.length ? `<ul class="pc-games">${list.map(gameRow).join('')}</ul>` : `<p class="pc-empty">${ui.records.length ? (ui.historyKind === 'room' ? tx('还没有房间局的记录。') : tx('还没有人机局的记录。')) : tx('还没有记录，先来一局人机对战吧。')}</p>`}</section>`;
  }

  /* ---------- Clicks and keys ---------- */
  function onClick(event) {
    if (ui.view === 'game' && ui.game?.read && event.target.closest?.('#pc-line')) { hearWord(event.target); return; }
    const target = event.target.closest('[data-pc]');
    if (!target || !ui.root.contains(target)) return;
    // A tap inside the sheet is not a tap on the dimmed layer around it.
    if (target.classList.contains('pc-sheet-layer') && event.target.closest('.pc-sheet')) return;
    const action = target.dataset.pc, value = target.dataset.value;
    if (action === 'close') { requestClose(); return; }
    if (action === 'go') { show(target.dataset.view); return; }
    if (action === 'set') {
      const key = target.dataset.key, number = Number(value);
      if (key === 'kind') { ui.historyKind = value; render(); ui.root.querySelector('[data-key="kind"][aria-checked="true"]')?.focus?.({preventScroll:true}); return; }
      if (key === 'minutes') { ui.prefs.end = 'timed'; ui.prefs.minutes = number; }
      else if (key === 'end') ui.prefs.end = value;
      else ui.prefs[key] = Number.isNaN(number) ? value : number;
      if (key === 'look') ui.prefs.lookPicked = true;
      savePrefs();
      // Choosing 朗读 starts getting the recogniser at once (a download the first time; the setup page says so).
      if (key === 'input' && value === 'read') void prepareSpeech();
      // (the picture's look is mine alone, never the room's)
      if (ui.view === 'room' && key !== 'look') pushRoomSettings();
      render();
      const scroll = ui.root.scrollTop;
      ui.root.querySelector(`.pc-region[data-key="${key}"][aria-checked="true"],[data-key="${key}"][aria-checked="true"]`)?.focus?.({preventScroll:true});
      ui.root.scrollTop = scroll;
      return;
    }
    if (action === 'picker') { openPicker(); return; }
    if (action === 'picker-close') { closePicker(); return; }
    if (action === 'book') { ui.picker.book = value; render(); return; }
    if (action === 'pick-kind') { ui.picker.kind = value; render(); return; }
    if (action === 'word-group') { ui.picker.group = value; render(); return; }
    if (action === 'section') { Object.assign(ui.prefs,{section:value,text:'section'}); savePrefs(); if (ui.view === 'room') pushRoomSettings(); closePicker(); return; }
    if (action === 'words') {
      const source = wordSources().find(item => item.token === value);
      if (!source) return;
      Object.assign(ui.prefs,{text:'words',words:value,wordsTitle:wordRangeName(source)});
      savePrefs();
      // A newly picked range is drawn again for the room; otherwise the room keeps the words it has.
      ui.wordsFresh = true;
      if (ui.view === 'room') pushRoomSettings();
      closePicker();
      return;
    }
    if (action === 'start') { startGame(); return; }
    if (action === 'skip-word') { passWord(); return; }
    if (action === 'room-create') { void createRoom(); return; }
    if (action === 'room-join-open') { ui.joining = true; render(); $('#pc-join-code')?.focus?.(); return; }
    if (action === 'room-join-cancel') { closeJoin(); return; }
    if (action === 'room-side') { void roomAction('side',{side:value}); ui.prefs.side = value; savePrefs(); return; }
    if (action === 'room-ready') { if (value === 'on' && ui.room?.state?.settings?.input === 'read') void readyToRead(); else { closeRoomMic(); void roomAction('ready',{ready:value === 'on'}); } return; }
    if (action === 'mic-open') { void openMicNow(); return; }
    if (action === 'room-start') { void startRoom(); return; }
    if (action === 'room-bot-menu') { ui.botMenu = ui.botMenu === value ? '' : value; ui.botMenuNew = Boolean(ui.botMenu); renderRoom(); return; }
    if (action === 'room-bot-add') { ui.botMenu = ''; void roomAction('bot',{side:target.dataset.side,level:value}); return; }
    if (action === 'room-bot-remove') { void roomAction('bot',{remove:value}); return; }
    if (action === 'room-edit') { toggleRoomEditor(); return; }
    if (action === 'room-copy') { void copyInvite(); return; }
    if (action === 'room-leave') { showConfirm('room'); return; }
    if (action === 'room-watch') { if (ui.room) void startRoomGame(ui.room.state,true); return; }
    if (action === 'again') { startGame(); return; }
    if (action === 'expand') { ui.expanded = ui.expanded === value ? '' : value; render(); ui.root.querySelector(`[data-value="${CSS.escape(value)}"]`)?.focus?.({preventScroll:true}); return; }
    if (action === 'slice') { playSlice(target.dataset.owner,Number(target.dataset.index),target); return; }
    // The speaker button silences the whole game: the cues and the word readings.
    if (action === 'sound') {
      ui.prefs.sound = !ui.prefs.sound;
      savePrefs();
      if (ui.prefs.sound) wakeSfx(); else { releaseSfx(); ui.opts.stopAudio?.(); }
      target.innerHTML = icon(ui.prefs.sound ? 'sound' : 'mute');
      target.setAttribute('aria-label',soundLabel(ui.prefs.sound));
      target.title = soundLabel(ui.prefs.sound);
      focusInput();
      return;
    }
    // The music has its own switch: a class may want the songs from one speaker only, or the words without music.
    if (action === 'music') {
      ui.prefs.music = !ui.prefs.music;
      savePrefs();
      if (ui.prefs.music) { if (ui.game?.music) musicPlayer().timer ||= setInterval(musicTick,120); wakeMusic(); musicTick(); }
      target.innerHTML = icon(ui.prefs.music ? 'music' : 'music-off');
      target.setAttribute('aria-label',musicLabel(ui.prefs.music));
      target.title = musicLabel(ui.prefs.music);
      focusInput();
      return;
    }
    // The picture can be switched off: the stage turns to plain paper with one line showing who is how far ahead or
    // behind, and the 3D world stops drawing. Switching it on draws the world again at once.
    if (action === 'scene') {
      ui.prefs.scene = !ui.prefs.scene;
      savePrefs();
      ui.root.querySelector('.pc-game')?.classList.toggle('is-plain',!ui.prefs.scene);
      target.innerHTML = icon(ui.prefs.scene ? 'scene' : 'track');
      target.setAttribute('aria-label',sceneLabel(ui.prefs.scene));
      target.title = sceneLabel(ui.prefs.scene);
      if (ui.prefs.scene && ui.stage) { ui.stage.width = 0; layoutStage(); }
      focusInput();
      return;
    }
    if (action === 'camera') {
      ui.prefs.camera = ui.prefs.camera === 'still' ? 'follow' : 'still';
      savePrefs();
      target.innerHTML = icon(ui.prefs.camera === 'still' ? 'still' : 'follow');
      target.setAttribute('aria-label',cameraLabel(ui.prefs.camera));
      target.title = cameraLabel(ui.prefs.camera);
      notify(ui.prefs.camera === 'still' ? tx('镜头拉远，画面里只有赛区；整圈放不下时随你慢慢移动。') : tx('镜头缓慢跟随，只随你移动一小段。'));
      focusInput();
      return;
    }
    if (action === 'confirm-stay') { hideConfirm(); return; }
    if (action === 'confirm-leave') { hideConfirm(); creditLeft(ui.game); ui.game = null; show('home'); return; }
  }
  // The room code form on the home page; closing it gives the focus back to 加入房间.
  function closeJoin() {
    ui.joining = false;
    render();
    $('[data-pc="room-join-open"]')?.focus?.({preventScroll:true});
  }
  function onSubmit(event) {
    if (!event.target.closest?.('.pc-join')) return;
    event.preventDefault();
    void joinRoom(($('#pc-join-code')?.value || '').trim());
  }
  function onFieldInput(event) {
    if (event.target?.id !== 'pc-join-code') return;
    const digits = event.target.value.replace(/\D/g,'').slice(0,4);
    if (digits !== event.target.value) event.target.value = digits;
    ui.joinCode = digits;
  }
  function onRootKey(event) {
    if (!ui.open) return;
    // Esc while an input method shows its candidates only closes the candidates.
    if (event.key === 'Escape') { if (event.isComposing || event.keyCode === 229) return; event.preventDefault(); requestClose(); return; }
    const radio = event.target?.closest?.('[role="radio"]');
    if (radio && /^Arrow(Left|Right|Up|Down)$/.test(event.key)) {
      const group = [...(radio.closest('[role="radiogroup"]')?.querySelectorAll('[role="radio"]') || [])];
      const next = group[(group.indexOf(radio)+(/Left|Up/.test(event.key) ? group.length-1 : 1)) % group.length];
      if (next) { event.preventDefault(); next.click(); }
      return;
    }
    // During a game, letters typed while the page itself has focus (not a control) still go to the game.
    const input = $('#pc-input');
    if (ui.game && !ui.confirming && input && event.target !== input && !event.target?.closest?.('button,a,input,textarea,select,summary')
      && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      focusInput();
      feed(event.key);
    }
  }
  // Leaving a game in play asks first; so does leaving a room's lobby (a phone's Back is easily pressed by mistake, and
  // a host who leaves hands the room on).
  function showConfirm(kind='game') {
    if (ui.confirming || !ui.root) return;
    ui.confirming = true;
    pauseGame();
    const layer = document.createElement('div');
    layer.className = 'pc-confirm-layer';
    const host = ui.room?.state && ui.room.state.hostId === ui.room.state.me;
    const text = kind === 'room' ? `${tx('离开这个房间吗？')}${host ? tx('房主会交给下一位同学。') : tx('之后可以用房间号再回来。')}`
      : ui.game?.room || (!ui.game && ui.room) ? tx('离开这一局吗？你会退出这个房间。已打好的词照样计经验，这一局不记入战绩。') : tx('离开这一局吗？已打好的词照样计经验，这一局不记入战绩。');
    layer.innerHTML = `<div class="pc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="pc-confirm-text"><p id="pc-confirm-text">${text}</p><div class="pc-confirm-actions">${button('confirm-stay',kind === 'room' ? tx('留下') : tx('继续'),'pc-primary')}${button('confirm-leave',kind === 'room' ? tx('离开房间') : tx('离开'),'pc-quiet')}</div></div>`;
    ui.root.append(layer);
    layer.querySelector('[data-pc="confirm-stay"]')?.focus();
  }
  function hideConfirm() {
    ui.confirming = false;
    ui.root?.querySelector('.pc-confirm-layer')?.remove();
    if (isHeld(ui.game) && !document.hidden) resumeGame();
  }

  /* ---------- Rooms ---------- */
  // The server keeps the room and referees its games (the rules above, in Python). This page shows the lobby, reports my
  // letters and draws what it hears. serverNow() follows the server's clock, so a countdown ends together on every screen.
  const serverNow = () => Date.now()+(ui.clock?.offset || 0);
  function syncClock(serverTime,sentAt,receivedAt) {
    if (!Number.isFinite(serverTime)) return;
    const clock = ui.clock, rtt = Math.max(0,receivedAt-sentAt), offset = serverTime-(sentAt+receivedAt)/2;
    // Samples with quick round trips are trusted most.
    ui.clock = !clock || rtt <= clock.rtt*1.25+30 || clock.age >= 20 ? {offset,rtt,age:0} : {...clock,rtt:clock.rtt*1.05,age:clock.age+1};
  }
  const ROOM_ERRORS = {room_not_found:tx('房间不存在或已过期，请核对房间号。'),room_full:tx('这个房间已经满了。'),not_in_room:tx('你已不在这个房间。'),
    rate_limited:tx('请求太频繁，请稍后再试。'),not_host:tx('只有房主可以这样做。'),room_busy:tx('这一局正在进行，等它结束再改。'),too_many_bots:tx('电脑已经加满了。'),
    cannot_start:tx('还不能开始：警察和小偷都要有人，并且至少 2 位同学准备好。'),timeout:tx('网络有点慢，请再试一次。'),too_many_rooms:tx('现在开着的房间太多了，请稍后再试。'),
    unauthorized:tx('联机身份失效了，请刷新页面后再试。'),invalid_request:tx('这个请求没有成功，请刷新页面后再试。'),not_found:tx('联机服务还没有准备好，请稍后再试。')};
  const roomError = error => ROOM_ERRORS[error?.code] || tx('联机暂时连不上，请检查网络后重试。');
  async function roomCall(path,body,timeout=8000) {
    const community = await ui.opts.community?.();
    if (!community?.request) throw Object.assign(new Error('community unavailable'),{code:'offline'});
    const sentAt = Date.now();
    const data = await community.request(path,body === undefined ? {timeout} : {method:'POST',body,timeout});
    syncClock(Number(data?.serverTime),sentAt,Date.now());
    return data;
  }
  const roomTitle = id => sectionMeta(id) ? sectionName(id).slice(0,80) : '';
  // A room that answers after the player moved on (to a game against the computer, or out of the game) is left again.
  const stillWaiting = opened => ui.open && ui.historyToken === opened && ui.view === 'home';
  async function createRoom() {
    if (ui.busy) return;
    ui.busy = true;
    render();
    const p = ui.prefs, opened = ui.historyToken;
    try {
      ui.wordsFresh = true;
      const state = await roomCall('/chase/rooms',{...roomSettings(),side:p.side});
      if (stillWaiting(opened)) { ui.busy = false; enterRoom(state); }
      else void roomCall(`/chase/rooms/${state.code}/leave`,{}).catch(() => {});
    } catch (error) { if (stillWaiting(opened)) notify(roomError(error)); }
    finally { ui.busy = false; if (ui.open && ui.view === 'home') render(); }
  }
  async function joinRoom(code) {
    if (!/^\d{4}$/.test(code)) { notify(tx('请输入 4 位数字的房间号。')); $('#pc-join-code')?.focus?.(); return; }
    if (ui.busy) return;
    ui.busy = true;
    ui.joinCode = code;
    // The form shows the code being joined (an invitation opens it filled in); the field keeps its keyboard.
    if (!ui.joining || !$('.pc-join')) { ui.joining = true; render(); }
    const submit = $('.pc-join [data-pc="room-join"]'), opened = ui.historyToken;
    if (submit) { submit.disabled = true; submit.textContent = tx('正在加入…'); }
    try {
      // Newcomers go to the side with fewer people (the server decides); anyone can change side in the lobby.
      const state = await roomCall(`/chase/rooms/${code}/join`,{});
      if (stillWaiting(opened)) { ui.joining = false; ui.joinCode = ''; ui.busy = false; enterRoom(state); }
      else void roomCall(`/chase/rooms/${state.code}/leave`,{}).catch(() => {});
    } catch (error) { if (stillWaiting(opened)) notify(roomError(error)); }
    finally {
      ui.busy = false;
      if (submit?.isConnected) { submit.disabled = false; submit.textContent = tx('加入'); }
    }
  }
  function enterRoom(state) {
    if (ui.room && ui.room.code !== state.code) leaveRoom();
    ui.room = {code:state.code,state,version:state.version,failures:0,started:'',polling:false,offline:false};
    ui.roomEdit = false;
    ui.botMenu = '';
    setRoomInURL(state.code);
    show('room');
    // Coming back to a game in play opens it at once.
    applyRoom(state);
    schedulePoll(POLL_MS.lobby);
  }
  function dropRoom() {
    clearTimeout(ui.pollTimer);
    clearTimeout(ui.settingsTimer);
    ui.pollTimer = 0;
    ui.settingsTimer = 0;
    ui.room = null;
    ui.roomEdit = false;
    ui.botMenu = '';
    setRoomInURL(null);
  }
  // The room's code rides in the address, so a reload comes straight back to the room (and to a game in play).
  function setRoomInURL(code) {
    try {
      const url = new URL(location.href);
      if (code) url.searchParams.set('chase',code); else if (url.searchParams.has('chase')) url.searchParams.delete('chase'); else return;
      history.replaceState(history.state,'',url.href);
    } catch {}
  }
  function leaveRoom() {
    const room = ui.room;
    if (!room) return;
    closeRoomMic();
    dropRoom();
    if (ui.game?.room) ui.game = null;
    void roomCall(`/chase/rooms/${room.code}/leave`,{}).catch(() => {});
  }
  function lostRoom(message) {
    dropRoom();
    if (ui.game?.room) ui.game = null;
    // The page changes first, so the notice stands where the new page puts it.
    if (['room','game'].includes(ui.view)) show('home');
    notify(message);
  }
  function schedulePoll(delay) {
    clearTimeout(ui.pollTimer);
    if (!ui.open || !ui.room) return;
    ui.pollTimer = setTimeout(pollRoom,Math.max(0,delay));
  }
  function pollDelay() {
    const game = ui.game?.room ? ui.game : null;
    if (game && !game.over && !game.watch) return POLL_MS.game;
    if (document.hidden) return POLL_MS.hidden;
    if (game?.watch) return POLL_MS.watch;
    return ['loading','countdown'].includes(ui.room?.state?.status) ? POLL_MS.soon : POLL_MS.lobby;
  }
  // One request at a time: a player in a game sends its progress and hears the game back; everyone else polls the room.
  async function pollRoom() {
    const room = ui.room;
    if (!room || !ui.open || room.polling) return;
    room.polling = true;
    let delay = -1, playing = false;
    const sentAt = performance.now();
    try {
      const game = ui.game?.room && ui.game.code === room.code && !ui.game.over ? ui.game : null;
      const me = game && !game.watch ? game.players.find(player => player.me) : null;
      // In a game the reports are what keeps me in it (the server protects a player it has not heard from for 3 s and
      // takes them off the track after 20 more), so a report that hangs is given up quickly and sent again.
      playing = Boolean(me);
      const reply = me
        ? await roomCall(`/chase/rooms/${room.code}/sync`,{v:room.version,since:game.seq,loaded:Boolean(game.loaded),letters:me.letters,words:me.words,
          errors:me.errors,tier:me.tier,maxTier:me.maxTier || 1},2500)
        : await roomCall(`/chase/rooms/${room.code}?v=${room.version}${game ? `&live=1&since=${game.seq}` : ''}`);
      if (ui.room !== room) return;
      room.failures = 0;
      roomOffline(room,false);
      applyRoom(reply);
      // Reports keep their beat from one send to the next, so the round trip is not added to every gap (a slow
      // connection used to report every 0.4 s + its round trip); a short pause still follows a slow answer.
      delay = Math.max(80,pollDelay()-(performance.now()-sentAt));
    } catch (error) {
      if (ui.room !== room) return;
      if (['room_not_found','not_in_room','unauthorized'].includes(error?.code)) { lostRoom(error.code === 'room_not_found' ? tx('房间已经关闭了。') : roomError(error)); return; }
      room.failures++;
      if (room.failures >= (playing ? 2 : 3)) roomOffline(room,true);
      delay = error?.code === 'rate_limited' ? 3000 : playing ? Math.min(1200,300*room.failures) : Math.min(4000,400*2**Math.min(room.failures,4));
    } finally {
      room.polling = false;
      if (ui.room === room && delay >= 0) schedulePoll(delay);
    }
  }
  // While the connection is down the notice stays up (shown again if another message took its place).
  function roomOffline(room,offline) {
    if (room.offline === offline && !(offline && !ui.toast?.classList.contains('is-on'))) return;
    const was = room.offline;
    room.offline = offline;
    if (offline) notify(tx('网络不稳，正在重新连接…'),0);
    else if (was) notify(tx('已重新连上。'),2000);
  }
  function applyRoom(reply) {
    const room = ui.room;
    if (!reply || (!reply.unchanged && reply.version < room.version)) return;
    if (!reply.unchanged) {
      const host = room.state?.hostId;
      room.state = reply;
      room.version = reply.version;
      if (host && host !== reply.hostId && reply.hostId === reply.me) notify(tx('房主交给你了：现在可以更改这一局、加电脑和开始。'),5000);
    }
    const state = room.state, match = state.match;
    const game = ui.game?.room && ui.game.code === room.code ? ui.game : null;
    // A game I take part in opens as soon as everyone starts loading it (or at once, coming back to one in play).
    if (match && ['loading','countdown','playing'].includes(state.status) && match.participants.includes(state.me)
      && room.started !== match.id && !(game && !game.watch && game.number === match.number)) {
      room.started = match.id;
      void startRoomGame(state,false);
      return;
    }
    // While the others load the map: how many are ready.
    if (game?.ready && state.status === 'loading' && match) {
      const loading = $('#pc-loading');
      if (loading) loading.textContent = tx('等大家载入地图 · {done}/{all}',{done:Math.min(match.loaded.length,match.participants.length),all:match.participants.length});
    }
    if (game && reply.live) applyLive(game,reply.live);
    if (game && !game.over) {
      if (state.status === 'finished' && state.results?.number === game.number) finishRoomGame(game,state.results);
      else if (!match || match.number !== game.number || state.status === 'lobby') {
        // Called off before it began (people left while it was loading).
        const watched = game.watch;
        ui.game = null;
        show('room');
        notify(watched ? tx('这一局结束了。') : tx('这一局没能开始，回到房间。'));
        return;
      } else if (['countdown','playing'].includes(state.status)) roomCountdown(game,match.startsAt);
    }
    if (state.results && ui.resultsFor?.room) roomXp(state.results);
    if (state.settings?.input === 'read') void checkSpeech();
    else if (ui.roomMic && !game) closeRoomMic();
    // The lesson picker keeps its scroll while open; closing it draws the room afresh.
    if (ui.view === 'room' && !reply.unchanged && !ui.picker) renderRoom();
  }
  // Everyone's place in the game: catches and taunts first (each loser's pose stays where it was caught), then the
  // positions the server has, and finally the banners.
  function applyLive(game,live) {
    if (!live || live.number !== game.number) return;
    const now = shownNow(game);
    // Arriving in a game already in play (to watch it, or after a reload): everyone simply is where they are, and the
    // catches and taunts that came before are not played back.
    const arriving = !game.heard && live.t > 1500;
    game.heard = true;
    const fresh = arriving ? [] : (live.events || []).filter(event => event.seq > game.seq);
    game.seq = Math.max(game.seq,live.seq || 0);
    for (const event of fresh) {
      const loser = game.byId.get(event.loser);
      // Someone else is caught where the server saw it happen; my own runner stays where I see it.
      const at = loser && !loser.me && Number.isFinite(event.poseAt) ? event.poseAt : loser && position(loser);
      if (loser) loser.pose = {name:event.type === 'catch' ? 'thief-caught' : 'police-taunted',until:now+POSE_MS,at,side:loser.side};
    }
    const listed = new Set();
    for (const runner of live.runners || []) {
      const player = game.byId.get(runner.id);
      if (!player) continue;
      listed.add(player);
      Object.assign(player,{side:runner.side,offset:runner.offset,catches:runner.catches,taunts:runner.taunts,switched:runner.switched,
        immuneUntil:now+(runner.immune || 0),away:Boolean(runner.offline)});
      if (runner.left && !player.gone) { player.gone = true; if (player.me) leftRoomGame(game); }
      if (player.me) {
        // Coming back to a game in play (after a reload): carry on from where the server has me.
        if (!game.adopted) { game.adopted = true; if (runner.letters > player.letters) adoptLetters(game,player,runner.letters); }
        continue;
      }
      // The runner goes on from this report at this speed (see follow); a long silence ends with a jump, not a dash.
      player.rate = runner.rate;
      player.heardAt = live.t;
      if (runner.letters > player.letters) { player.grewAt = live.t; catchUp(game,player,runner.letters,now,arriving); }
      if (arriving) { player.dist = player.letters; player.warp = 'quiet'; }
      else if (player.letters-player.dist > 40) player.dist = player.letters;
      player.tier = runner.tier;
      player.maxTier = Math.max(player.maxTier || 1,runner.tier);
    }
    // Someone who left before the start is no longer in the game at all.
    for (const player of game.players) if (!player.me && !player.gone && !listed.has(player)) player.gone = true;
    game.score = {...live.score};
    // The deciding catch arrives with the end of the game, after which the HUD no longer ticks: show the score now.
    if (ui.hud && game.status === 'playing') updateHud(game,now);
    for (const event of fresh) {
      const winner = game.byId.get(event.winner), loser = game.byId.get(event.loser);
      if (winner && loser) announce(game,{type:event.type,winner,loser,respawn:event.respawn,switched:event.switched},now);
    }
  }
  // Someone else's progress arrives a few letters at a time; the last word they finished pops up over them.
  function catchUp(game,player,letters,now,quiet=false) {
    player.letters = letters;
    const words = game.text?.words || [];
    let last = null;
    if (game.read) {
      // A reader's letters are WORD_STEP a word.
      const reached = Math.min(words.length,Math.floor(letters/WORD_STEP+1e-9));
      while (player.wordIndex < reached) { last = words[player.wordIndex]; player.wordIndex++; player.words++; }
    } else while (player.wordIndex < words.length && words[player.wordIndex].letterEnd <= letters) { last = words[player.wordIndex]; player.wordIndex++; player.words++; }
    if (last && !quiet && game.status === 'playing') bubble(player,last.text,now);
  }
  function adoptLetters(game,player,letters) {
    player.letters = player.dist = letters;
    if (player.read) {
      // Reading again after a reload: the words read so far are the letters / WORD_STEP.
      const words = game.text?.words || [], done = Math.min(words.length,Math.floor(letters/WORD_STEP+1e-9));
      Object.assign(player.read,{word:done,pos:done ? words[done-1].letterEnd : 0,carry:letters-done*WORD_STEP > 0 ? letters-done*WORD_STEP : 0});
      player.words = done;
    } else passTyped(game,player);
    renderLine(true);
  }
  // Words I typed before a reload are passed over without a sound (also when more of the text arrives later).
  function passTyped(game,player) {
    if (player.read) return;
    const words = game.text?.words || [];
    while (player.wordIndex < words.length && words[player.wordIndex].letterEnd <= player.letters) { player.wordIndex++; player.words++; }
  }
  // Away for too long: the server has taken me off the track, so the rest of the game is watched.
  function leftRoomGame(game) {
    game.watch = true;
    $('#pc-type')?.setAttribute('hidden','');
    $('.pc-game')?.classList.add('is-watch');
    notify(tx('你离线太久，已离开这一局赛道，可以继续观战。'),5000);
  }
  async function startRoomGame(state,watch) {
    const match = state.match;
    if (!match || !ui.root) return;
    const token = ui.starting = {room:true,watch};
    const current = () => ui.starting === token && ui.open && ui.view === 'game' && ui.room?.code === state.code;
    const settings = match.settings, mine = watch ? null : match.runners.find(runner => runner.id === state.me);
    stopGame();
    ui.game = null;
    ui.confirming = false;
    ui.picker = null;
    stopSlice();
    wakeSfx();
    ui.calm = reduceMotion();
    ui.view = 'game';
    ui.root.classList.add('is-game');
    const reading = settings.input === 'read' && !watch;
    ui.root.innerHTML = gameMarkup({end:settings.end,minutes:settings.minutes,side:mine?.side || 'police',map:settings.map,watch,input:reading ? 'read' : 'type'});
    $('#pc-loading').textContent = tx('正在载入{map}…',{map:mapTitle(settings.map)});
    ui.hud = {};
    ui.typed = '';
    ui.composing = '';
    ui.lineFrom = ui.lineTo = -1;
    if (!watch) focusInput();
    fitViewport();
    if (ui.toast?.classList.contains('is-on')) placeToast();
    try {
      const words = settings.words?.length ? settings.words : null;
      const [section] = await Promise.all([words ? loadClips().catch(() => null).then(() => buildWordList(words,`${match.id}-0`,clipFor)) : loadSection(settings.section),loadAssets(),
        reading ? prepareSpeech() : true]);
      if (!current()) return;
      // Everyone but me is drawn from the server's reports (`net`: see follow).
      const players = match.runners.map(runner => {
        const me = Boolean(mine) && runner.id === mine.id;
        return newPlayer(runner.id,runner.name,runner.side,{me,net:!me,level:runner.level});
      });
      // Lanes keep runners side by side on one spot: me in the middle, the others alternating outward.
      [...players.filter(player => player.me),...players.filter(player => !player.me)]
        .forEach((player,index) => { player.lane = index === 0 ? 0 : (index % 2 ? 1 : -1)*Math.ceil(index/2); });
      const game = {mode:settings.end,duration:match.duration,players,pairs:new Map(),score:{catch:0,taunt:0},events:[],usual:0,over:'',
        lap:lapOf(settings.map),room:true,watch,code:state.code,number:match.number,seq:0,byId:new Map(players.map(player => [player.id,player])),status:'loading',
        title:settings.title || sectionName(settings.section),map:settings.map,firstSection:settings.section,lastSection:settings.section,
        words,wordsSeed:match.id,wordsPass:0,
        paused:false,bubbles:[],fresh:[],read:settings.input === 'read'};
      game.text = appendSection(createText(),section);
      game.sectionsLoaded = [section];
      if (reading) {
        // The microphone was opened at 准备 (a tap); without it the mic chip asks for a tap (see syncMic).
        const me = game.players.find(player => player.me);
        if (me) me.read = {pos:0,word:0,carry:0,passed:0,soft:0,movedAt:0};
        Object.assign(ui,{mic:ui.roomMic || null,micStarted:false,micOn:false,voiceAt:0,heardAt:0,hearing:false});
        ui.roomMic = null;
      }
      ui.game = game;
      // No background music while reading: the microphones would hear it.
      if (!game.read) prepareMusic(game,match.id || `${state.code}-${match.number}`);
      await setupStage(current,settings.map);
      if (!current() || ui.game !== game) return;
      game.ready = game.loaded = true;
      if (!watch) {
        renderLine(true);
        prefetchAhead();
        // A room game starts on the server's word, not on a tap, so a phone or tablet does not open its keyboard by
        // itself: a quiet note over the sentence asks for one tap (it goes at the first key or when the keyboard is up).
        if (!reading && !ui.ownKeys && window.matchMedia?.('(pointer: coarse)').matches && keyboardHeight() < 80) $('#pc-type')?.classList.add('is-tap');
      }
      const loading = $('#pc-loading');
      if (loading) { loading.textContent = tx('等大家载入地图…'); loading.classList.add('is-wait'); }
      if (!ui.loop) ui.loop = requestAnimationFrame(frame);
      const latest = ui.room?.state;
      if (latest?.match?.number === game.number && ['countdown','playing'].includes(latest.status)) roomCountdown(game,latest.match.startsAt);
      schedulePoll(0);
    } catch (error) {
      if (!current()) return;
      console.warn('警察抓小偷的房间局没有开始',error);
      ui.game = null;
      const fallback = error?.graphics ? lighterLook() : '';
      if (fallback && pictureAgain(true,watch)) { notify(tx('{fallback}。',{fallback}),5000); return; }
      show('room');
      notify(error?.graphics ? PICTURE_FAILED : tx('课文或地图没有载入，请检查网络。'));
    } finally {
      if (ui.starting === token) ui.starting = null;
    }
  }
  // 3, 2, 1, 出发 on the server's clock. Arriving late (or to watch a game in play) simply joins it where it is.
  function roomCountdown(game,startsAt) {
    if (!game.ready || !Number.isFinite(startsAt) || game.countdownFor === startsAt) return;
    game.countdownFor = startsAt;
    clearCountdown(game);
    $('#pc-loading')?.remove();
    const count = $('#pc-count'), wait = startsAt-serverNow();
    const go = () => {
      game.status = 'playing';
      game.startedAt = performance.now()-Math.max(0,serverNow()-startsAt);
    };
    if (wait <= -1500) { go(); return; }
    game.status = 'countdown';
    const steps = ['3','2','1',tx('出发')];
    game.countdown = steps.map((label,index) => {
      const at = wait-(steps.length-1-index)*1000;
      if (at < -300 && index < steps.length-1) return 0;
      return later(() => {
        if (ui.game !== game) return;
        if (count) {
          count.textContent = label;
          count.classList.remove('is-on');
          void count.offsetWidth;
          count.classList.add('is-on');
        }
        play(index === steps.length-1 ? 'go' : 'tick');
        if (index === steps.length-1) { go(); later(() => count?.classList.remove('is-on'),700); }
      },Math.max(0,at));
    }).filter(Boolean);
  }
  function roomTick(game) {
    const now = gameNow(game), me = game.players.find(player => player.me && !player.gone);
    if (me) {
      me.rate = rateAt(me.times,now,0);
      if (stepTier(me,me.rate,now) === 'up') play('gear');
    }
    ensureText(game);
    updateHud(game,now);
  }
  function finishRoomGame(game,results) {
    game.over = results.winner || 'draw';
    // The picture holds the last moment for the pause before the results (see shownNow).
    game.endNow = game.status === 'playing' ? gameNow(game) : 0;
    game.status = 'over';
    clearCountdown(game);
    if (game.watch) {
      const line = results.winner === 'draw' ? tx('两边打成平手') : `${SIDES[results.winner]?.team || ''}${EN ? tx('获胜（阵营）') : '获胜'}`;
      later(() => {
        if (ui.game !== game) return;
        ui.game = null;
        if (ui.view === 'game') show('room');
        notify(tx('这一局结束了：{line}。',{line}));
      },END_HOLD_MS);
      return;
    }
    play('finish');
    const record = game.record = saveRoomRecord(game,results);
    later(() => {
      if (ui.game !== game) return;
      ui.game = null;
      ui.resultsFor = {game,record,room:true};
      if (ui.view === 'game') show(record ? 'results' : 'room');
    },END_HOLD_MS);
  }
  function saveRoomRecord(game,results) {
    const me = game.players.find(player => player.me), mine = results.players.find(player => player.id === me?.id);
    if (!me || !mine || mine.result === 'left') return null;
    const record = {id:`r${Date.now().toString(36)}`,at:Date.now(),kind:'room',room:game.code,gameId:results.id,map:game.map,side:mine.startSide,finalSide:mine.side,
      end:game.mode,minutes:game.mode === 'timed' ? game.duration/60000 : 0,sections:[...game.text.sections],title:game.title,result:mine.result,
      winner:results.winner,durationMs:results.durationMs,score:{...results.score},xp:mine.xp ?? null,
      ...(game.read ? {input:'read'} : {}),
      me:{rate:mine.rate,accuracy:game.read ? null : me.letters+me.errors ? Math.round(me.letters/(me.letters+me.errors)*100) : 100,words:me.words,letters:me.letters,errors:me.errors,
        ...(game.read && me.read ? {passed:me.read.passed} : {}),
        catches:mine.catches,taunts:mine.taunts,caught:mine.caught,taunted:mine.taunted,maxTier:Math.max(me.maxTier || 1,mine.maxTier || 1)},
      players:results.players.map(player => ({name:player.name,me:player.id === me.id,side:player.side,startSide:player.startSide,level:player.level || '',
        rate:player.rate,catches:player.catches,taunts:player.taunts,caught:player.caught,taunted:player.taunted,maxTier:player.maxTier,result:player.result})),
      sentences:typedSentences(game,me)};
    storeRecord(record);
    return record;
  }
  // The server writes the XP a moment after the game; it reaches the results page and the record when it is known.
  function roomXp(results) {
    const record = ui.resultsFor?.record;
    if (!record || record.gameId !== results.id || record.xp != null || results.xpPending) return;
    const xp = results.players.find(player => player.id === ui.room?.state?.me)?.xp;
    if (xp == null) return;
    record.xp = xp;
    if (ui.records.includes(record)) writeJSON(RECORDS_KEY,ui.records);
    if (ui.view === 'results') render();
  }
  // A room types words when the host picked a range: the words drawn for it go to everyone with the settings.
  function roomSettings() {
    const p = ui.prefs, base = {section:p.section,title:roomTitle(p.section),map:p.map,end:p.end,minutes:p.minutes,input:p.input === 'read' ? 'read' : 'type'};
    if (p.text !== 'words') return base;
    const held = ui.room?.state?.settings;
    if (!ui.wordsFresh && held?.words?.length) return {...base,title:held.title,words:held.words};
    const range = wordList(p.words,true);
    ui.wordsFresh = false;
    return range ? {...base,title:`词语 · ${range.title}`.slice(0,80),words:range.list} : base;
  }
  function pushRoomSettings() {
    const room = ui.room;
    if (!room || room.state.hostId !== room.state.me) return;
    clearTimeout(ui.settingsTimer);
    ui.settingsTimer = setTimeout(() => { ui.settingsTimer = 0; void roomAction('settings',roomSettings()); },250);
  }
  // 开始: a change of lesson or map still waiting to be sent goes first, so the game is the one the host chose. If
  // everyone readied and the game began by itself a moment earlier, there is nothing to say.
  async function startRoom() {
    if (ui.settingsTimer) { clearTimeout(ui.settingsTimer); ui.settingsTimer = 0; await roomAction('settings',roomSettings()); }
    await roomAction('start',{},['room_busy']);
  }
  function toggleRoomEditor() {
    const settings = ui.room?.state?.settings;
    ui.roomEdit = !ui.roomEdit;
    // The editor starts from what the room plays now.
    if (ui.roomEdit && settings) {
      Object.assign(ui.prefs,{section:settings.section,map:settings.map,end:settings.end,minutes:settings.minutes,input:settings.input === 'read' ? 'read' : 'type',text:settings.words?.length ? 'words' : 'section'});
      if (settings.words?.length) ui.prefs.wordsTitle = String(settings.title || '').replace(/^词语 · /,'');
    }
    renderRoom();
    if (ui.roomEdit) void loadPlan();
  }
  async function roomAction(name,body,quiet=[]) {
    const room = ui.room;
    if (!room) return;
    try {
      const state = await roomCall(`/chase/rooms/${room.code}/${name}`,body);
      if (ui.room === room) applyRoom(state);
    } catch (error) {
      if (ui.room !== room) return;
      if (['room_not_found','not_in_room','unauthorized'].includes(error?.code)) { lostRoom(roomError(error)); return; }
      if (!quiet.includes(error?.code)) notify(roomError(error));
    }
  }
  // On a phone or tablet the system's share sheet sends the link straight to a chat; elsewhere it is copied.
  const canShare = () => Boolean(navigator.share) && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  async function copyInvite() {
    const room = ui.room;
    if (!room) return;
    const link = `${location.origin}${location.pathname}?chase=${room.code}#practice`;
    if (canShare()) {
      try { await navigator.share({title:tx('警察抓小偷 · 联机房间'),text:tx('来警察抓小偷的房间 {code}，一起打课文！',{code:room.code}),url:link}); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(link); notify(tx('邀请链接已复制，同学打开就能进房间。')); }
    catch { notify(tx('邀请链接：{link}',{link}),12000,{select:true}); }
  }
  // A poll re-draws the lobby; the control that had the keyboard focus keeps it (the one that takes focus: the plan's
  // loops share their values with the list's rows). 准备 turns into 取消准备 and keeps the focus too.
  function renderRoom() {
    const active = document.activeElement, pc = ui.root?.contains(active) ? active.dataset?.pc : '';
    const value = pc ? active.dataset.value || '' : '';
    render();
    if (!pc) return;
    const controls = [...ui.root.querySelectorAll(`[data-pc="${pc}"]`)].filter(element => element.matches('button:not([tabindex="-1"]),input'));
    const same = controls.find(element => (element.dataset.value || '') === value) || (pc === 'room-ready' ? controls[0] : null);
    (same || $('h2'))?.focus?.({preventScroll:true});
  }
  function roomPage() {
    const state = ui.room?.state;
    if (!state) return homePage();
    const host = state.hostId === state.me, between = ['lobby','finished'].includes(state.status), s = state.settings, reading = s.input === 'read';
    const me = state.players.find(player => player.id === state.me), menuFresh = ui.botMenuNew;
    const person = player => {
      const notes = [player.host ? tx('房主') : '',!player.online ? tx('离线') : '',!between && !player.playing ? tx('观战') : ''].filter(Boolean).join(' · ');
      return `<li class="pc-person${player.id === state.me ? ' is-me' : ''}${player.online ? '' : ' is-away'}">${avatar(player.name,player.side)}
        <span class="pc-person-name"><span class="pc-person-line"><b>${e(nameOf(player.name))}</b>${player.id === state.me ? `<i>${ME}</i>` : ''}</span>${notes ? `<small>${notes}</small>` : ''}</span>
        <span class="pc-person-rate">${(reading ? player.usualRead : player.usual) ? speedHTML(reading ? player.usualRead : player.usual,reading) : `<small>${tx('新选手')}</small>`}</span>
        <span class="pc-person-state${between && player.ready ? ' is-ready' : ''}">${between && player.ready ? `${icon('check')}<span>${tx('已准备')}</span>` : ''}</span></li>`;
    };
    const bot = item => `<li class="pc-person is-bot">${avatar(item.name,item.side,'',true)}
      <span class="pc-person-name"><b>${e(item.name)}</b><small>${tx('电脑')} · ${LEVELS[item.level]?.name || ''}</small></span>
      <span class="pc-person-rate">${item.level === 'match' ? `<small>${tx('跟着对手')}</small>` : speedHTML(levelsFor(reading)[item.level]?.rate || item.usual,reading)}</span>
      ${host && between ? `<button type="button" class="pc-person-remove" data-pc="room-bot-remove" data-value="${e(item.id)}" aria-label="${e(tx('移除{name}',{name:item.name}))}" title="${tx('移除')}">${icon('close')}</button>` : '<span class="pc-person-state"></span>'}</li>`;
    const team = side => {
      const people = state.players.filter(player => player.side === side), bots = state.bots.filter(item => item.side === side);
      const menu = ui.botMenu === side && host && between;
      return `<section class="pc-team is-${side}"><header class="pc-team-head"><img src="${sprite(side === 'police' ? 'police-catch' : 'thief-taunt')}" alt="" decoding="async" draggable="false">
          <h3>${SIDES[side].team}</h3><span>${tx('{n} 人',{n:people.length+bots.length})}</span></header>
        ${people.length+bots.length ? `<ul class="pc-people">${people.map(person).join('')}${bots.map(bot).join('')}</ul>` : `<p class="pc-team-empty">${side === 'police' ? tx('还没有人当警察') : tx('还没有人当小偷')}</p>`}
        ${between && ((me && me.side !== side) || (host && state.bots.length < state.maxBots)) ? `<div class="pc-team-foot">
          ${me && me.side !== side ? `<button type="button" class="pc-link" data-pc="room-side" data-value="${side}">${side === 'police' ? tx('换到警方') : tx('换到小偷团')}</button>` : ''}
          ${host && state.bots.length < state.maxBots ? `<button type="button" class="pc-link" data-pc="room-bot-menu" data-value="${side}" aria-expanded="${menu}">${icon('plus')}${tx('加电脑')}</button>` : ''}</div>` : ''}
        ${menu ? `<div class="pc-segment pc-bot-levels${menuFresh ? ' is-new' : ''}" role="group" aria-label="${tx('电脑水平')}">${Object.entries(levelsFor(reading)).map(([key,level]) => `<button type="button" class="pc-option" data-pc="room-bot-add" data-side="${side}" data-value="${key}"><span>${level.name}</span><small>${level.rate ? `${speedValue(level.rate,reading)}${speedUnit(reading)}` : tx('跟着对手')}</small></button>`).join('')}</div>` : ''}
      </section>`;
    };
    // The bot menu rises in once, when it opens, not again with every poll.
    ui.botMenuNew = false;
    const lesson = titleText(s.title) || sectionName(s.section);
    const facts = `<div class="pc-room-facts"><span>${icon(reading ? 'mic' : 'keyboard')}<b>${reading ? READ_NAME : tx('打字')}</b></span><span>${icon('map')}<b>${e(mapTitle(s.map))}</b></span><span title="${e(lesson)}">${icon('book')}<b>${e(lesson)}</b></span><span>${icon('clock')}<b>${s.end === 'timed' ? tx('限时 {n} 分钟',{n:s.minutes}) : tx('抓到为止')}</b></span></div>`;
    // One on one, the first catch or taunt decides; with more players the loser changes sides.
    const many = state.players.filter(player => player.online).length+state.bots.length > 2;
    const editor = host && between && ui.roomEdit ? `<div class="pc-setup pc-room-editor">
        <div class="pc-field"><span class="pc-label">${tx('地图')}</span>${planMarkup()}</div>
        <div class="pc-field"><span class="pc-label">${tx('玩法')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('玩法')}">${Object.entries(INPUTS).map(([key,item]) => option('input',key,item.name,ui.prefs.input,item.hint)).join('')}</div></div>
        <div class="pc-field"><span class="pc-label">${ui.prefs.input === 'read' ? tx('朗读内容') : tx('打字内容')}</span><button type="button" class="pc-pick" data-pc="picker">${icon('book')}<span>${e(textName())}</span>${icon('down')}</button></div>
        <div class="pc-field"><span class="pc-label">${tx('结束方式')}</span><div class="pc-segment" role="radiogroup" aria-label="${tx('结束方式')}">${option('end','catch',tx('抓到为止'),ui.prefs.end,many ? tx('输了换阵营') : tx('一次定胜负'))}${MINUTES.map(n => option('minutes',n,tx('{n} 分钟',{n}),ui.prefs.end === 'timed' ? ui.prefs.minutes : 0,tx('比次数'))).join('')}</div></div></div>` : '';
    const issue = {people:tx('至少要 2 位同学准备好'),police:tx('还需要有人当警察'),thief:tx('还需要有人当小偷')}[state.startIssue] || '';
    const counted = tx('{ready}/{here} 人已准备',{ready:state.readyCount,here:state.here});
    const hint = issue ? `${counted} · ${issue}` : host && state.readyCount < state.here ? `${counted} · ${tx('也可以现在开始，没准备的人观战')}` : `${counted} · ${tx('大家都准备好就自动开始')}`;
    const bar = between
      ? `<div class="pc-actions pc-start-bar pc-room-bar"><p class="pc-room-hint">${e(hint)}</p><div class="pc-room-buttons">
          ${button('room-ready',me?.ready ? tx('取消准备') : tx('准备'),me?.ready || host ? 'pc-ghost' : 'pc-primary',`data-value="${me?.ready ? 'off' : 'on'}"`)}
          ${host ? button('room-start',tx('开始'),issue ? 'pc-ghost' : 'pc-primary',issue ? 'disabled' : '') : ''}</div></div>`
      : `<div class="pc-actions pc-start-bar pc-room-bar"><p class="pc-room-hint">${state.status === 'playing' ? tx('这一局正在进行，下一局一起玩') : tx('这一局马上开始，下一局一起玩')}</p><div class="pc-room-buttons">${button('room-watch',`${icon('eye')}<span>${tx('观战')}</span>`,'pc-primary',state.status === 'loading' ? 'disabled' : '')}</div></div>`;
    return `<header class="pc-top"><button type="button" class="pc-icon-button" data-pc="room-leave" aria-label="${tx('离开房间')}" title="${tx('离开房间')}">${icon('back')}</button><h2 tabindex="-1">${tx('联机房间')}</h2><button type="button" class="pc-icon-button" data-pc="close" aria-label="${tx('离开警察抓小偷')}" title="${tx('离开')}">${icon('close')}</button></header>
      <section class="pc-room-head"><div class="pc-room-code"><span class="pc-kicker">${tx('房间号')}</span><b>${e(state.code)}</b></div><p>${tx('告诉同学这 4 位数字，或者把邀请链接发给他们。')}</p>${button('room-copy',`${icon('link')}<span>${canShare() ? tx('邀请同学') : tx('复制邀请链接')}</span>`,'pc-ghost')}</section>
      ${reading ? `<p class="pc-hint pc-room-read" id="pc-read-state-wrap">${icon('mic')}<span><span id="pc-read-state">${e(readState())}</span> ${tx('大家要念课文来跑。在教室里最好戴耳机麦克风，旁边同学的声音也会被听到。')}</span></p>` : ''}
      <section class="pc-panel pc-room-game"><div class="pc-section-head"><h3>${tx('这一局')}</h3>${host ? (between ? `<button type="button" class="pc-link" data-pc="room-edit" aria-expanded="${ui.roomEdit}">${ui.roomEdit ? EN ? tx('收起（房间设置）') : '收起' : tx('更改')}</button>` : '') : `<small class="pc-hint">${tx('房主选择')}</small>`}</div>${facts}${editor}</section>
      <div class="pc-teams">${team('police')}${team('thief')}</div>
      ${between ? `<section class="pc-panel pc-room-look">${lookField(tx('我的画面 · 只改自己看到的'))}</section>` : ''}
      ${bar}`;
  }

  /* ---------- A game ---------- */
  async function startGame() {
    // A second tap while this start is still loading changes nothing; a start left behind (Back during loading) is
    // simply dropped when it finishes, so a new one can begin at once.
    if (ui.starting && ui.view === 'game') return;
    const token = ui.starting = {};
    const current = () => ui.starting === token && ui.open && ui.view === 'game';
    const prefs = ui.prefs;
    // A finished game still waiting to show its results gives way to the new one.
    ui.game = null;
    ui.confirming = false;
    closeMic();
    // 朗读: the microphone is asked for inside this tap (iOS starts audio only in a tap). A start left behind closes it.
    const reading = prefs.input === 'read';
    const micAsk = reading ? (ui.speech ? ui.speech.openMic() : loadSpeech().then(speech => speech.openMic())) : null;
    micAsk?.catch(() => {});
    const dropMic = () => micAsk?.then(mic => mic.close(),() => {});
    stopSlice();
    wakeSfx();
    ui.calm = reduceMotion();
    // Building the game screen and focusing its input inside this tap is what lets a phone open its keyboard.
    ui.view = 'game';
    ui.root.classList.add('is-game');
    ui.root.innerHTML = gameMarkup(prefs);
    ui.hud = {};
    ui.typed = '';
    ui.composing = '';
    ui.lineFrom = ui.lineTo = -1;
    focusInput();
    fitViewport();
    if (ui.toast?.classList.contains('is-on')) placeToast();
    try {
      // A word range is read from 练习 now; when it is gone (another textbook there now), the player picks again.
      const range = prefs.text === 'words' ? wordList(prefs.words) : null;
      if (prefs.text === 'words' && !range) { dropMic(); ui.game = null; show('setup'); notify(tx('这个词语范围现在不可用，请重新选择打字内容。')); return; }
      const seed = Math.random();
      const [section,,heard] = await Promise.all([range ? loadClips().catch(() => null).then(() => buildWordList(range.list,`${seed}-0`,clipFor)) : loadSection(prefs.section),loadAssets(),
        reading ? prepareSpeech() : true]);
      if (!current()) { dropMic(); return; }
      let mic = null;
      if (reading) {
        if (!heard) { dropMic(); ui.game = null; show('setup'); notify(readState(),6000); return; }
        try { mic = await micAsk; }
        catch (error) {
          if (!current()) return;
          ui.game = null;
          show('setup');
          notify(error?.code === 'denied' ? tx('没有允许使用麦克风。请在浏览器设置里允许这个网站使用麦克风，再开始。') : tx('没有找到麦克风，请检查后再开始。'),6000);
          return;
        }
        if (!current()) { mic.close(); return; }
      }
      const game = createGame({side:prefs.side,map:prefs.map,opponents:prefs.opponents,teammates:prefs.teammates,level:prefs.level,end:prefs.end,minutes:prefs.minutes,
        usual:usualRate(ui.records,reading ? 'read' : 'type'),me:ui.nickname || '我'});
      game.text = appendSection(createText(),section);
      game.sectionsLoaded = [section];
      game.title = range ? `词语 · ${range.title}` : sectionName(prefs.section);
      if (range) Object.assign(game,{words:range.list,wordsSeed:seed,wordsPass:0});
      game.firstSection = prefs.section;
      game.map = prefs.map;
      game.lastSection = prefs.section;
      game.paused = false;
      game.bubbles = [];
      game.fresh = [];
      if (reading) {
        game.read = true;
        game.players.find(player => player.me).read = {pos:0,word:0,carry:0,passed:0,soft:0,movedAt:0};
        Object.assign(ui,{mic,micStarted:false,micOn:false,voiceAt:0,heardAt:0,hearing:false});
      }
      ui.game = game;
      // No background music while reading: the microphone would hear it.
      if (!reading) prepareMusic(game,Math.random());
      await setupStage(current,prefs.map);
      if (!current() || ui.game !== game) return;
      renderLine(true);
      prefetchAhead();
      // Hidden while loading, or the leave dialog is up: the countdown waits until the player is back.
      if (document.hidden || ui.confirming) { game.status = 'held'; $('#pc-loading')?.remove(); if (!ui.loop) ui.loop = requestAnimationFrame(frame); }
      else startCountdown();
    } catch (error) {
      if (!current()) { dropMic(); return; }
      console.warn('警察抓小偷没有开始',error);
      ui.game = null;
      closeMic();
      dropMic();
      const fallback = error?.graphics ? lighterLook() : '';
      if (fallback && pictureAgain(false)) { notify(tx('{fallback}。',{fallback}),5000); return; }
      show('setup');
      notify(error?.graphics ? PICTURE_FAILED : tx('课文或图片没有载入，请检查网络后重试。'));
    } finally {
      if (ui.starting === token) ui.starting = null;
    }
  }
  function gameMarkup(p) {
    // Phones and tablets type on the game's own keyboard; a new game screen starts on its letter page. A reader has no
    // keyboard: the panel shows the microphone instead.
    const reading = p.input === 'read' && !p.watch;
    ui.ownKeys = reading ? false : ownKeyboard();
    ui.kbWant = '';
    ui.tallAt = -1;
    const own = ui.ownKeys;
    return `<div class="pc-game${p.watch ? ' is-watch' : ''}${own ? ' has-kb' : ''}${ui.prefs.scene ? '' : ' is-plain'}">
      <header class="pc-gbar"><button type="button" class="pc-icon-button" data-pc="close" aria-label="${p.watch ? tx('退出观战') : tx('离开这一局')}">${icon('close')}</button>
        <div class="pc-clock" id="pc-clock" aria-label="${tx('时间')}">${icon('clock')}<span>${p.end === 'timed' ? formatClock(p.minutes*60000) : '0:00'}</span></div>
        <div class="pc-score" aria-label="${tx('比分')}"><span class="pc-score-side" title="${tx('抓到')}">${icon('cuffs')}<b id="pc-catch">0</b></span><i>:</i><span class="pc-score-side" title="${tx('嘲笑')}"><b id="pc-taunt">0</b>${icon('taunt')}</span></div>
        <div class="pc-speed" aria-live="off"><b id="pc-rate">0</b><small>${speedUnit(p.input === 'read')}</small><span id="pc-tier">${VEHICLES[p.side][0]}</span></div>
        ${p.watch ? `<span class="pc-watch-tag">${tx('观战')}</span>` : `<button type="button" class="pc-icon-button" data-pc="camera" aria-label="${cameraLabel(ui.prefs.camera)}" title="${cameraLabel(ui.prefs.camera)}">${icon(ui.prefs.camera === 'still' ? 'still' : 'follow')}</button>`}
        <button type="button" class="pc-icon-button" data-pc="scene" aria-label="${sceneLabel(ui.prefs.scene)}" title="${sceneLabel(ui.prefs.scene)}">${icon(ui.prefs.scene ? 'scene' : 'track')}</button>
        ${reading ? '' : `<button type="button" class="pc-icon-button" data-pc="music" aria-label="${musicLabel(ui.prefs.music)}" title="${musicLabel(ui.prefs.music)}">${icon(ui.prefs.music ? 'music' : 'music-off')}</button>`}
        <button type="button" class="pc-icon-button" data-pc="sound" aria-label="${soundLabel(ui.prefs.sound)}" title="${soundLabel(ui.prefs.sound)}">${icon(ui.prefs.sound ? 'sound' : 'mute')}</button></header>
      <div class="pc-stage" id="pc-stage"><canvas id="pc-canvas" aria-hidden="true"></canvas><canvas class="pc-fx" id="pc-fx" aria-hidden="true"></canvas><div class="pc-overlay" id="pc-overlay" aria-hidden="true"></div><div class="pc-veil" id="pc-veil" aria-hidden="true"></div><div class="pc-plain" id="pc-plain" aria-hidden="true"><div class="pc-plain-track"><span class="pc-plain-end">${tx('后方半圈')}</span><span class="pc-plain-end is-ahead">${tx('前方半圈')}</span></div></div><canvas class="pc-minimap" id="pc-minimap" aria-hidden="true"></canvas><div class="pc-count" id="pc-count" aria-live="assertive"></div><div class="pc-event" id="pc-event" role="status" aria-live="polite"></div><p class="pc-loading" id="pc-loading">${tx('正在载入{map}…',{map:e(mapTitle(p.map))})}</p></div>
      ${reading ? readPanel() : `<div class="pc-panel-type${own ? ` has-kb${ui.prefs.keys ? '' : ' kb-off'}` : ''}" id="pc-type"${p.watch ? ' hidden' : ''}>
        <div class="pc-line-wrap" id="pc-line-wrap"><p class="pc-line" id="pc-line" lang="nb"></p></div>
        <p class="pc-zh" id="pc-zh"></p>
        <div class="pc-type-foot"><span class="pc-progress" id="pc-progress"></span><span class="pc-ime" id="pc-ime" hidden>${tx('出现候选框时，请把输入法切到英文')}</span>${letterKeys()}${own ? showKeysMarkup() : ''}</div>
        ${own ? keyboardMarkup() : ''}
        <textarea class="pc-input" id="pc-input" aria-label="${tx('在这里打字')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" rows="1"${own ? ' inputmode="none"' : ''}></textarea>
      </div>`}</div>`;
  }
  // The reading panel: the sentence to read (a tap on a word plays its reading), its meaning, and below it the microphone
  // (its dot breathes with my voice), where I am, what the recogniser last heard, and — when a word will not get
  // through — a button to pass it.
  function readPanel() {
    return `<div class="pc-panel-type is-read" id="pc-type">
        <div class="pc-line-wrap" id="pc-line-wrap"><p class="pc-line" id="pc-line" lang="nb"></p></div>
        <p class="pc-zh" id="pc-zh"></p>
        <div class="pc-type-foot"><span class="pc-mic" id="pc-mic" role="status">${icon('mic')}<span id="pc-mic-text">${tx('出发后开始听')}</span></span><span class="pc-progress" id="pc-progress"></span>
          <button type="button" class="pc-skip" id="pc-skip" data-pc="skip-word" hidden>${tx('跳过这个词')}</button></div>
        <p class="pc-heard" id="pc-heard" aria-live="off">${tx('不会念的词，点一下听读音')}</p>
      </div>`;
  }
  // On a touch screen the system keyboard would cover half the picture (and some phones shrink or shift the page for
  // it), so the game brings its own keyboard, laid out like 练习's: Å right of P, Ø and Æ right of L. Only letters and
  // digits are ever typed, so there is no space or backspace, and the page turns to digits by itself when a number
  // comes. The hidden field never takes the focus there; a hardware keyboard still types through onRootKey.
  // A touch screen is known by a finger on the game (the tap on 开始 counts), by a coarse pointer, or by a phone or
  // tablet browser: some Android browsers (Bing, in-app ones) report a fine pointer. If a system keyboard comes up all
  // the same, the game switches over at once (useOwnKeys).
  function ownKeyboard() {
    if (ui.touched) return true;
    try {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
      if (window.matchMedia('(any-pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) return true;
    } catch {}
    const agent = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OpenHarmony/i.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
  }
  function onPointer(event) {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    ui.touched = true;
    if (ui.view === 'game' && !ui.ownKeys) useOwnKeys();
  }
  const keyboardMarkup = () => `<div class="pc-kb" id="pc-kb" role="group" aria-label="${tx('挪威语键盘')}" data-page="letters">${keyRows('letters')}</div>`;
  // æ ø å for a real keyboard without them (on a touch screen they show only while the game's keyboard is put away).
  const letterKeys = () => `<span class="pc-keys" aria-label="${tx('挪威字母')}">${['æ','ø','å'].map(char => `<button type="button" class="pc-key" data-char="${char}" tabindex="-1">${char}</button>`).join('')}</span>`;
  const showKeysMarkup = () => `<button type="button" class="pc-kb-show" data-kb-show="1" tabindex="-1" aria-label="${tx('显示键盘')}">${icon('keyboard')}<span>${tx('键盘')}</span></button>`;
  // Put the game's keyboard away or bring it back; the picture takes the room (at the same scale, see layoutStage).
  function setKeys(on) {
    const type = $('#pc-type');
    ui.prefs.keys = on;
    savePrefs();
    type?.classList.toggle('kb-off',!on);
    if (ui.stage) requestAnimationFrame(layoutStage);
  }
  // The game screen was drawn for a physical keyboard, yet this is a touch screen: put the system keyboard away and
  // bring the game's own.
  function useOwnKeys() {
    const type = $('#pc-type');
    if (ui.ownKeys || !type || ui.game?.read) return;
    ui.ownKeys = true;
    ui.kbWant = '';
    const input = $('#pc-input');
    input?.setAttribute('inputmode','none');
    if (document.activeElement === input) input.blur();
    ui.root.querySelector('.pc-game')?.classList.add('has-kb');
    type.classList.add('has-kb');
    type.classList.toggle('kb-off',!ui.prefs.keys);
    type.classList.remove('is-tap');
    type.querySelector('.pc-type-foot')?.insertAdjacentHTML('beforeend',showKeysMarkup());
    type.querySelector('.pc-type-foot')?.insertAdjacentHTML('afterend',keyboardMarkup());
    const game = ui.game, me = game?.players.find(player => player.me), letter = me && game.text.letters[textAt(me)];
    if (letter) followKeyboard(letter);
    if (ui.stage) requestAnimationFrame(layoutStage);
  }
  function keyRows(page) {
    const key = char => `<button type="button" class="pc-kb-key" data-kb="${char}" tabindex="-1">${char}</button>`;
    const turn = page === 'digits' ? ['letters','ABC',tx('切换字母')] : ['digits','123',tx('切换数字')];
    // A phone's own layout: æ ø å on a row of their own above qwertyuiop / asdfghjkl / zxcvbnm, ten keys at most a row.
    const rows = page === 'digits' ? ['12345','67890'] : ['æøå','qwertyuiop','asdfghjkl','zxcvbnm'];
    const kinds = page === 'digits' ? ['is-digits','is-digits'] : ['is-nordic','','is-mid','is-bottom'];
    const bottom = page === 'digits' ? -1 : 3;
    const last = `<button type="button" class="pc-kb-key is-turn" data-kb-page="${turn[0]}" tabindex="-1" aria-label="${turn[2]}">${turn[1]}</button>`;
    // Like a tablet's keyboard, the bottom row ends in a key that puts the keyboard away.
    const hide = `<button type="button" class="pc-kb-key is-turn is-hide" data-kb-hide="1" tabindex="-1" aria-label="${tx('收起键盘')}" title="${tx('收起键盘')}">${icon('keyboard-hide')}</button>`;
    return rows.map((row,index) => `<div class="pc-kb-row${kinds[index] ? ` ${kinds[index]}` : ''}">${index === bottom ? last : ''}${[...row].map(key).join('')}${index === bottom ? hide : ''}</div>`).join('')
      +(page === 'digits' ? `<div class="pc-kb-row is-bottom">${last}${hide}</div>` : '');
  }
  function keyboardPage(page) {
    const board = $('#pc-kb');
    if (!board || board.dataset.page === page) return;
    board.dataset.page = page;
    board.innerHTML = keyRows(page);
  }
  // The page follows the next letter only when it changes kind, so a page turned by hand stays until then.
  function followKeyboard(letter) {
    if (!ui.ownKeys) return;
    const want = /[0-9]/.test(letter.ch) ? 'digits' : 'letters';
    if (want !== ui.kbWant) { ui.kbWant = want; keyboardPage(want); }
  }
  function pressKey(button) {
    button.classList.remove('is-down');
    void button.offsetWidth;
    button.classList.add('is-down');
    setTimeout(() => button.classList.remove('is-down'),120);
    if (button.dataset.kbHide) setKeys(false);
    else if (button.dataset.kbPage) keyboardPage(button.dataset.kbPage);
    else feed(button.dataset.kb);
  }
  function focusInput() {
    if (ui.ownKeys) return;
    const input = $('#pc-input');
    if (input && document.activeElement !== input) { try { input.focus({preventScroll:true}); } catch {} }
  }
  const soundLabel = on => on ? tx('声音：开（点按关闭音效和单词读音）') : tx('声音：关（点按打开音效和单词读音）');
  const musicLabel = on => on ? tx('背景音乐：开（点按关闭）') : tx('背景音乐：关（点按打开）');
  const sceneLabel = on => on ? tx('画面：开（点按关闭画面，只留一条距离线）') : tx('画面：关（点按打开画面）');
  const cameraLabel = mode => mode === 'still' ? tx('镜头：全景（点按改为缓慢跟随）') : tx('镜头：缓慢跟随（点按改为全景）');
  function startCountdown() {
    const game = ui.game;
    game.status = 'countdown';
    clearCountdown(game);
    $('#pc-loading')?.remove();
    const count = $('#pc-count');
    const steps = ['3','2','1',tx('出发')];
    game.countdown = steps.map((label,index) => later(() => {
      if (ui.game !== game || !count) return;
      count.textContent = label;
      count.classList.remove('is-on');
      void count.offsetWidth;
      count.classList.add('is-on');
      play(index === steps.length-1 ? 'go' : 'tick');
      if (index === steps.length-1) { game.status = 'playing'; game.startedAt = performance.now(); later(() => count.classList.remove('is-on'),700); }
    },index*(COUNTDOWN_MS/(steps.length-1)) - (index === steps.length-1 ? 200 : 0)));
    if (!ui.loop) ui.loop = requestAnimationFrame(frame);
  }
  function clearCountdown(game) {
    for (const id of game.countdown || []) { clearTimeout(id); ui.timers.delete(id); }
    game.countdown = [];
  }
  function stopGame() {
    closeMic();
    if (ui.loop) cancelAnimationFrame(ui.loop);
    ui.loop = 0;
    ui.stage?.observer?.disconnect?.();
    try { ui.stage?.world?.dispose(); } catch {}
    ui.stage = null;
  }
  function pauseGame() {
    const game = ui.game;
    // A room game cannot wait for one player: it runs on, and the server protects someone who is away.
    if (!game || game.over || game.room) return;
    if (game.status === 'countdown') { clearCountdown(game); game.status = 'held'; $('#pc-count')?.classList.remove('is-on'); return; }
    if (game.paused || game.status !== 'playing') return;
    game.paused = true;
    game.pausedAt = performance.now();
  }
  const isHeld = game => Boolean(game && !game.over && (game.paused || game.status === 'held'));
  function resumeGame() {
    const game = ui.game;
    if (!isHeld(game)) return;
    if (game.status === 'held') { startCountdown(); focusInput(); return; }
    game.startedAt += performance.now()-game.pausedAt;
    game.paused = false;
    focusInput();
  }
  // Game time in milliseconds since the start signal, not counting pauses.
  const gameNow = game => (game.paused ? game.pausedAt : performance.now())-game.startedAt;
  // The moment the picture shows: before the start it is 0; a room game decided holds its last moment until the results.
  const shownNow = game => game.status === 'playing' ? gameNow(game) : game.status === 'over' ? game.endNow || 0 : 0;

  function frame(stamp) {
    const game = ui.game;
    if (!game || !ui.stage) return;
    ui.loop = requestAnimationFrame(frame);
    // About sixty pictures a second are plenty: a 120 Hz screen would otherwise draw twice as many for nothing.
    if (ui.stage.lastStamp && stamp-ui.stage.lastStamp < 10) return;
    const elapsed = Math.min(.1,Math.max(0,(stamp-(ui.stage.lastStamp || stamp))/1000));
    ui.stage.lastStamp = stamp;
    if (game.read && !game.watch) syncMic(game);
    if (game.status === 'playing' && !game.paused && !game.over) tick(game);
    // The world runs on its own clock, which stands still while the game is paused (behind the leave dialog).
    const dt = game.paused ? 0 : elapsed;
    advance(game,dt,shownNow(game));
    ui.stage.clock += dt*1000;
    renderWorld(game,dt);
  }
  function tick(game) {
    if (game.room) { roomTick(game); return; }
    const now = gameNow(game);
    for (const player of game.players) {
      if (player.bot) for (const word of botStep(game,player,now)) bubble(player,word.text,now);
      player.rate = rateAt(player.times,now,0);
      const change = stepTier(player,player.rate,now);
      if (change === 'up' && player.me) play('gear');
    }
    for (const event of settle(game,now)) announce(game,event,now);
    const result = verdict(game,now);
    if (result) finishGame(game,result,now);
    ensureText(game);
    updateHud(game,now);
  }
  // More text is fetched while the leader still has a few sentences to go.
  function ensureText(game) {
    if (game.loadingText || performance.now() < (game.textRetryAt || 0)) return;
    const leader = Math.max(...game.players.map(textAt));
    if (game.text.letters.length-leader > 260) return;
    if (game.words) {
      appendSection(game.text,buildWordList(game.words,`${game.wordsSeed}-${++game.wordsPass}`,clipFor));
      const me = game.players.find(player => player.me);
      if (me && game.room) passTyped(game,me);
      renderLine(false);
      return;
    }
    game.loadingText = true;
    const id = nextSectionId(game.lastSection);
    loadSection(id).then(section => {
      if (ui.game !== game) return;
      appendSection(game.text,section);
      game.sectionsLoaded.push(section);
      game.lastSection = id;
      const me = game.players.find(player => player.me);
      if (me && game.room) passTyped(game,me);
      renderLine(false);
    }).catch(() => {
      // Offline or a missing file: try again later, and go round the text already here so nobody runs out of letters.
      game.textRetryAt = performance.now()+8000;
      if (ui.game === game) { appendSection(game.text,game.sectionsLoaded[0]); renderLine(false); }
    }).finally(() => { game.loadingText = false; });
  }
  function updateHud(game,now) {
    const me = game.players.find(player => player.me);
    const clock = game.mode === 'timed' ? formatClock(game.duration-now) : formatClock(now);
    if (ui.hud?.clock !== clock) { $('#pc-clock span').textContent = clock; (ui.hud ||= {}).clock = clock; }
    $('#pc-clock')?.classList.toggle('is-late',game.mode === 'timed' && game.duration-now < 15000);
    if (ui.hud.catch !== game.score.catch) { $('#pc-catch').textContent = game.score.catch; ui.hud.catch = game.score.catch; }
    if (ui.hud.taunt !== game.score.taunt) { $('#pc-taunt').textContent = game.score.taunt; ui.hud.taunt = game.score.taunt; }
    if (!me) return;
    const rate = speedValue(me.rate,game.read);
    if (ui.hud.rate !== rate) { $('#pc-rate').textContent = rate; ui.hud.rate = rate; }
    const tier = VEHICLES[me.side][me.tier-1];
    if (ui.hud.tier !== tier) { $('#pc-tier').textContent = tier; ui.hud.tier = tier; }
  }

  /* ---------- 朗读: reading the text aloud ---------- */
  // The recogniser (chase-speech.mjs + dist/asr) loads only for 朗读. Its state for the setup page and the loading screen:
  // 'unknown' (not looked yet), 'unsupported', 'idle' (not downloaded), 'loading' (downloading or starting), 'ready', 'failed'.
  const speechOf = () => ui.speech;
  function loadSpeech() {
    ui.speechLoad ||= import(versioned('./chase-speech.mjs')).then(module => (ui.speech = module)).catch(error => { ui.speechLoad = null; throw error; });
    return ui.speechLoad;
  }
  function readState() {
    const r = ui.reading || {status:'unknown'};
    if (r.status === 'unsupported') return tx('这个浏览器用不了朗读，请换用较新的 Chrome、Edge 或 Safari。');
    if (r.status === 'failed') return tx('语音识别没有准备好，请检查网络后再试。');
    // (the page becomes cross-origin isolated from the load after isolate-sw.js took over; the recogniser then has threads)
    if (r.status === 'ready') return tx('语音识别已准备好。开始时会请你允许使用麦克风。')+(document.documentElement.dataset.isolate === 'next' && navigator.serviceWorker?.controller ? tx('刷新一次页面，识别会更快。') : '');
    if (r.status === 'loading') return r.total && r.loaded < r.total ? tx('正在下载语音识别 {loaded} / {total} MB…',{loaded:Math.round(r.loaded/1e6),total:Math.round(r.total/1e6)}) : tx('正在准备语音识别…');
    if (r.status === 'idle') return tx('第一次要下载语音识别（约 120 MB，建议用 Wi-Fi），之后存在这台设备上。');
    return tx('正在检查语音识别…');
  }
  function showReadState() {
    const line = $('#pc-read-state');
    if (line) line.textContent = readState();
    const loading = $('#pc-loading');
    if (loading && ui.view === 'game' && ui.reading?.status === 'loading') loading.textContent = readState();
  }
  // On the setup page with 朗读 chosen: find out whether the model is here (then start it: no download, only a few seconds).
  async function checkSpeech() {
    if (ui.reading && ui.reading.status !== 'unknown' && ui.reading.status !== 'failed') return;
    ui.reading = {status:'unknown'};
    try {
      const speech = await loadSpeech();
      if (!speech.supported()) { ui.reading = {status:'unsupported'}; showReadState(); return; }
      if (speech.isReady()) { ui.reading = {status:'ready'}; showReadState(); return; }
      ui.reading = {status:'idle'};
      showReadState();
      if (await speech.cached()) void prepareSpeech();
    } catch { ui.reading = {status:'failed'}; showReadState(); }
  }
  // Download (once) and start the recogniser. Resolves true when it can listen.
  async function prepareSpeech() {
    try {
      const speech = await loadSpeech();
      if (!speech.supported()) { ui.reading = {status:'unsupported'}; showReadState(); return false; }
      if (!speech.isReady()) { ui.reading = {status:'loading',loaded:0,total:0}; showReadState(); }
      const ok = await speech.prepare(({loaded,total}) => { ui.reading = {status:'loading',loaded,total}; showReadState(); });
      ui.reading = {status:ok ? 'ready' : 'failed'};
      showReadState();
      return ok;
    } catch {
      ui.reading = {status:'failed'};
      showReadState();
      return false;
    }
  }
  function closeMic() {
    try { ui.mic?.close(); } catch {}
    ui.mic = null;
    ui.micOn = false;
  }
  // Called every frame: the microphone listens exactly while my reading game is running (not before the start signal,
  // behind the leave dialog, in a hidden tab or after the end).
  function syncMic(game) {
    if (!ui.mic) {
      // No microphone yet (a room game started without my 准备 tap opening it): the chip asks for a tap.
      const chip = $('#pc-mic');
      if (chip && chip.dataset.pc !== 'mic-open') { Object.assign(chip.dataset,{pc:'mic-open'}); chip.setAttribute('role','button'); chip.tabIndex = 0; chip.classList.add('is-ask'); micLabel(tx('点这里打开麦克风')); }
      return;
    }
    const want = Boolean(game?.read && game.status === 'playing' && !game.paused && !game.over && !ui.confirming);
    if (want !== ui.micOn) {
      ui.micOn = want;
      if (want && !ui.micStarted) { ui.micStarted = true; ui.mic.start(onHeard,onLevel,expectedWords); }
      else if (want) ui.mic.resume();
      else ui.mic.pause();
      micLabel(want ? tx('在听，请念上面的句子') : tx('暂停'));
    }
    if (!want) return;
    // Nothing heard for a while: the faint line goes back to its hint.
    if (ui.heardAt && performance.now()-ui.heardAt > 6000) {
      ui.heardAt = 0;
      const heard = $('#pc-heard');
      if (heard) { heard.textContent = tx('不会念的词，点一下听读音'); heard.removeAttribute('lang'); }
    }
    // Reading without a word getting through for a while: offer to pass the word.
    const me = game.players.find(player => player.me), stuck = gameNow(game)-(me.read.movedAt || 0) > STUCK_MS && performance.now()-(ui.voiceAt || 0) < 2500;
    const skip = $('#pc-skip');
    if (skip && skip.hidden === stuck) skip.hidden = !stuck;
  }
  function micLabel(text) {
    const label = $('#pc-mic-text');
    if (label && label.textContent !== text) label.textContent = text;
  }
  function onLevel(level) {
    if (level > .02) ui.voiceAt = performance.now();
    const dot = $('#pc-mic');
    if (dot) dot.style.setProperty('--level',Math.min(1,level*12).toFixed(2));
    // The underline of the word to read answers my voice at once (the recogniser needs a moment longer).
    $('#pc-type')?.classList.toggle('is-voice',performance.now()-(ui.voiceAt || 0) < 320);
  }
  // What the recogniser may lean towards: the last words read (it hears the last second again) and the next dozen.
  function expectedWords() {
    const game = ui.game, me = game?.players.find(player => player.me);
    if (!game?.read || !me?.read) return [];
    return game.text.words.slice(Math.max(0,me.read.word-4),me.read.word+12).map(word => word.text);
  }
  // A transcript of the last few seconds: how many of the words still to read does it hold?
  function onHeard(text,info) {
    const game = ui.game, speech = speechOf();
    if (!game?.read || game.status !== 'playing' || game.paused || game.over || !speech) return;
    const me = game.players.find(player => player.me), from = me.read.word;
    const words = game.text.words.slice(from,from+12);
    // Proper nouns (the reader lexicon's 专名, or capitalised inside a sentence) may be spelt any way by the recogniser.
    const want = words.map(word => ({text:word.text,soft:Boolean(word.name) || (word.start > 0 && /^\p{Lu}/u.test(word.text))}));
    const heard = $('#pc-heard');
    if (heard) { heard.textContent = tx('听到：{text}',{text}); heard.lang = 'nb'; }
    // (the words just read come along: the recogniser hears the last second again, see matchWords)
    const {count,skipped} = speech.matchWords(want,text,game.text.words.slice(Math.max(0,from-6),from).map(word => word.text));
    ui.heardAt = performance.now();
    if (!count) return;
    const now = gameNow(game);
    for (const word of words.slice(0,count)) readWord(game,me,word,now);
    me.read.soft += skipped;
    me.read.movedAt = now;
    // The last word read gets a bubble (several words come at once: one bubble each would pile up).
    bubble(me,words[count-1].text,now);
    ui.mic?.mark(info.at);
    $('#pc-skip')?.setAttribute('hidden','');
    updateLine(game,me);
  }
  // The microphone for a room: asked for in the 准备 tap, kept until the game starts (then it is the game's).
  async function readyToRead() {
    if (ui.readying) return;
    ui.readying = true;
    try {
      const speech = ui.speech || await loadSpeech();
      const ask = ui.roomMic ? Promise.resolve(ui.roomMic) : speech.openMic();
      ask.catch(() => {});
      if (!await prepareSpeech()) { notify(readState(),6000); return; }
      try { ui.roomMic = await ask; }
      catch (error) { notify(error?.code === 'denied' ? tx('没有允许使用麦克风，不能准备。请在浏览器设置里允许这个网站使用麦克风。') : tx('没有找到麦克风，不能准备。'),6000); return; }
      await roomAction('ready',{ready:true});
    } catch { notify(readState(),6000); }
    finally { ui.readying = false; }
  }
  function closeRoomMic() {
    try { ui.roomMic?.close(); } catch {}
    ui.roomMic = null;
  }
  // The mic chip tapped in a game that has no microphone yet.
  async function openMicNow() {
    const game = ui.game;
    if (!game?.read || ui.mic) return;
    try {
      const speech = ui.speech || await loadSpeech();
      const mic = await speech.openMic();
      if (ui.game !== game) { mic.close(); return; }
      Object.assign(ui,{mic,micStarted:false,micOn:false});
      const chip = $('#pc-mic');
      if (chip) { delete chip.dataset.pc; chip.setAttribute('role','status'); chip.removeAttribute('tabindex'); chip.classList.remove('is-ask'); }
    } catch (error) {
      notify(error?.code === 'denied' ? tx('没有允许使用麦克风。请在浏览器设置里允许这个网站使用麦克风，再开始。') : tx('没有找到麦克风，请检查后再开始。'),6000);
    }
  }
  // A tap on a word of the line: its reading plays, for a reader who is not sure how the word is said. The microphone
  // would hear the reading as if I had said it, so listening holds until the reading has ended (and a moment more, for
  // the room and for wireless earphones). The speaker button does not silence it: the tap asks for exactly this sound.
  function hearWord(target) {
    const game = ui.game, mark = target.closest?.('.pc-word');
    if (!game?.read || game.watch || game.over || !mark) return;
    const s = mark.classList.contains('pc-entry') ? ui.lineFrom+(ui.lineEntries || []).indexOf(mark) : ui.lineFrom;
    const word = game.text.sentences[s]?.words[mark.classList.contains('pc-entry') ? 0 : Number(mark.dataset.word)];
    if (!word?.clip) return;
    const token = ui.hearToken = (ui.hearToken || 0)+1;
    const done = () => {
      if (token !== ui.hearToken || !ui.hearing) return;
      ui.hearing = false;
      $('#pc-line')?.querySelector('.pc-word.is-said')?.classList.remove('is-said');
      ui.mic?.release();
      if (ui.micOn) micLabel(tx('在听，请念上面的句子'));
    };
    $('#pc-line')?.querySelector('.pc-word.is-said')?.classList.remove('is-said');
    mark.classList.add('is-said');
    ui.hearing = true;
    ui.mic?.hold();
    if (ui.micOn) micLabel(tx('听读音…'));
    clearTimeout(ui.hearTimer);
    // (a reading that never reports its end — a failed download — gives the microphone back all the same)
    ui.hearTimer = later(done,3500);
    ui.opts.pronounce?.({word:word.text,audio:word.clip},{onEnded:() => later(done,HEAR_TAIL_MS)});
  }
  // 跳过这个词: the word the recogniser keeps missing is passed; the text moves on, the runner does not.
  function passWord() {
    const game = ui.game;
    if (!game?.read || game.status !== 'playing' || game.paused || game.over) return;
    const me = game.players.find(player => player.me), word = game.text.words[me.read.word];
    if (!word) return;
    readWord(game,me,word,gameNow(game),true);
    me.read.movedAt = gameNow(game);
    ui.mic?.cut();
    $('#pc-skip')?.setAttribute('hidden','');
    updateLine(game,me);
  }

  /* ---------- Typing ---------- */
  const lettersOnly = text => String(text || '').replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ]/g,'');
  function onInput(event) {
    const input = event.target, value = input.value, before = ui.typed || '';
    ui.typed = value;
    wakeSfx();
    $('#pc-type')?.classList.remove('is-tap');
    // Pasted or dropped text and the keyboard's own word replacements are not typing; what an input method commits
    // is counted when the composition ends (Safari repeats it in an input event afterwards).
    if (/insertFrom(Paste|Drop|Composition)|insertReplacementText/.test(event.inputType || '')) return;
    // Only text added at the end counts, so a keyboard that rewrites a word it is composing types nothing new. While an
    // input method composes, only letters count: a Chinese IME marks syllable breaks with ' or a space, and a dead key
    // shows its accent until the letter comes; those marks are not keys (and ' must not count as æ).
    const clean = text => event.isComposing ? lettersOnly(text) : text;
    const now = clean(value), then = clean(before);
    if (now.startsWith(then)) {
      const added = now.slice(then.length);
      for (const char of added) feed(char);
      if (event.isComposing) ui.composing = (ui.composing || '')+added;
    }
    if (!event.isComposing && value.length > 24) { input.value = ''; ui.typed = ''; }
  }
  function onCompositionStart() {
    $('#pc-type')?.classList.remove('is-tap');
    if (window.matchMedia?.('(pointer: fine)').matches) $('#pc-ime')?.removeAttribute('hidden');
    clearTimeout(ui.imeTimer);
    ui.composing = '';
  }
  function onCompositionEnd(event) {
    // The committed text counts where it differs from what was already fed while composing (fed letters are not fed twice).
    const committed = lettersOnly(event.data), fed = ui.composing || '';
    let same = 0;
    while (same < fed.length && same < committed.length && fold(fed[same]) === fold(committed[same])) same++;
    for (const char of committed.slice(same)) feed(char);
    ui.composing = '';
    const input = event.target;
    input.value = '';
    ui.typed = '';
    ui.imeTimer = later(() => $('#pc-ime')?.setAttribute('hidden',''),4000);
  }
  function feed(char) {
    const game = ui.game;
    if (!game || game.status !== 'playing' || game.paused || game.over || game.watch || game.read) return;
    const me = game.players.find(player => player.me), next = game.text.letters[me.letters];
    if (!next) return;
    if (!accepts(next.ch,char)) {
      // A wrong key is simply not typed; letters and digits count as misses for the accuracy shown at the end.
      if (TYPEABLE.test(char) || 'æøå'.includes(char)) { me.errors++; missFlash(); }
      return;
    }
    const now = gameNow(game);
    const words = addLetter(game,me,now);
    for (const word of words) {
      bubble(me,word.text,now);
      if (word.clip && ui.prefs.sound) ui.opts.pronounce?.({word:word.text,audio:word.clip});
    }
    updateLine(game,me);
  }
  function missFlash() {
    const caret = $('.pc-char.is-caret');
    if (!caret) return;
    caret.classList.remove('is-miss');
    void caret.offsetWidth;
    caret.classList.add('is-miss');
  }
  function prefetchAhead() {
    const game = ui.game, me = game?.players.find(player => player.me);
    if (!me) return;
    // (A reader hears a word only when it is tapped; the words of the line are fetched all the same, so it sounds at once.)
    const words = game.text.words.slice(wordAt(me),wordAt(me)+16).filter(word => word.clip).map(word => ({word:word.text,audio:word.clip}));
    if (words.length) ui.opts.prefetch?.(words);
  }
  // The current sentence as one span per character: typed letters dark, the rest grey, a gold caret under the next.
  // A word range is one row of entries, each with its meaning right under it: from the current word, as many as fit the
  // row; when the last is typed the next row takes its place (a page turn, never a scroll).
  function renderLine(reset) {
    const game = ui.game, line = $('#pc-line');
    if (!game || !line) return;
    const me = game.players.find(player => player.me);
    if (!me) return;
    const letter = game.text.letters[Math.min(textAt(me),game.text.letters.length-1)];
    if (!letter) return;
    if (!reset && letter.s >= ui.lineFrom && letter.s < ui.lineTo) return;
    const sentences = game.text.sentences, sentence = sentences[letter.s];
    const char = (char,index) => `<span class="pc-char${TYPEABLE.test(char) ? '' : ' is-pass'}" data-i="${index}">${char === ' ' ? ' ' : e(char)}</span>`;
    // A reader's words that have a reading are spans of their own: a tap plays the reading (hearWord).
    const chars = (text,item) => {
      const list = text.split('').map(char);
      if (!game.read || !item) return list.join('');
      for (const [index,word] of item.words.entries()) if (word.clip && list[word.start] != null) {
        list[word.start] = `<span class="pc-word" data-word="${index}">${list[word.start]}`;
        list[word.end-1] += '</span>';
      }
      return list.join('');
    };
    const words = sentence.section === 'words', turning = words && ui.lineWords && ui.lineFrom != null && letter.s !== ui.lineFrom;
    ui.lineFrom = letter.s;
    ui.lineTo = letter.s+1;
    ui.lineOffsets = [0];
    ui.lineSentence = -1;
    ui.lineWords = words;
    line.classList.toggle('is-words',words);
    $('#pc-line-wrap')?.classList.toggle('is-words',words);
    $('#pc-type')?.classList.toggle('is-words',words);
    if (!words) {
      line.innerHTML = `${sentence.speaker ? `<span class="pc-speaker">${e(sentence.speaker)}</span>` : ''}<span class="pc-entry">${chars(sentence.text,sentence)}</span>`;
    } else {
      const entry = item => `<span class="pc-entry${game.read && item.words[0]?.clip ? ' pc-word' : ''}"><span class="pc-no">${chars(item.text)}</span><span class="pc-gloss" lang="${EN && item.en ? 'en' : 'zh'}">${e(meaningOf(item))}</span></span>`;
      line.innerHTML = entry(sentence);
      const room = line.clientWidth;
      while (ui.lineTo-ui.lineFrom < 16 && sentences[ui.lineTo]?.section === 'words') {
        const next = sentences[ui.lineTo];
        line.insertAdjacentHTML('beforeend',entry(next));
        if (line.scrollWidth > room+1) { line.lastElementChild.remove(); break; }
        ui.lineOffsets.push(ui.lineOffsets.at(-1)+sentences[ui.lineTo-1].text.length);
        ui.lineTo++;
      }
      ui.lineEntries = [...line.children];
      line.scrollLeft = 0;
      if (turning && !reduceMotion()) {
        line.classList.remove('is-turn');
        void line.offsetWidth;
        line.classList.add('is-turn');
      }
    }
    ui.lineChars = [...line.querySelectorAll('.pc-char')];
    updateLine(game,me);
  }
  function updateLine(game,me) {
    const letter = game.text.letters[textAt(me)];
    if (!letter) return;
    followKeyboard(letter);
    if (letter.s < ui.lineFrom || letter.s >= ui.lineTo) { renderLine(true); return; }
    const chars = ui.lineChars || [], caret = ui.lineOffsets[letter.s-ui.lineFrom]+letter.c;
    // A reader's next word is underlined whole (words are heard whole, so there is no caret).
    const next = game.read ? game.text.words[wordAt(me)] : null;
    const from = next && next.s >= ui.lineFrom && next.s < ui.lineTo ? ui.lineOffsets[next.s-ui.lineFrom]+next.start : -1, to = from < 0 ? -1 : from+next.end-next.start;
    for (let i = 0; i < chars.length; i++) {
      const span = chars[i], done = i < caret;
      span.classList.toggle('is-done',done);
      span.classList.toggle('is-caret',i === caret);
      if (game.read) span.classList.toggle('is-next',i >= from && i < to);
      if (!done && i !== caret) span.classList.remove('is-miss');
    }
    chars[caret]?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    if (letter.s === ui.lineSentence) return;
    // The meaning and the count follow the sentence or word being typed.
    ui.lineSentence = letter.s;
    const sentence = game.text.sentences[letter.s];
    $('#pc-zh').textContent = meaningOf(sentence);
    if (ui.lineWords) (ui.lineEntries || []).forEach((entry,index) => {
      entry.classList.toggle('is-now',index === letter.s-ui.lineFrom);
      entry.classList.toggle('is-past',index < letter.s-ui.lineFrom);
    });
    $('#pc-progress').textContent = sentence.section === 'words' ? tx('第 {n} / {all} 词',{n:letter.s-sentence.block+1,all:sentence.blockSize}) : `${sectionLabel(sentence.section)} · ${tx('第 {n} / {all} 句',{n:letter.s-sentence.block+1,all:sentence.blockSize})}`;
    prefetchAhead();
  }

  /* ---------- Events on the track ---------- */
  function bubble(player,text,now) {
    const game = ui.game;
    if (!game) return;
    // The word before fades away as the next one appears (one already fading on its own just carries on).
    for (const item of game.bubbles) if (item.player === player && !item.leaving && now-item.at > 260 && now-item.at < 1100) item.leaving = now;
    game.bubbles.push({player,text,at:now});
  }
  function announce(game,event,now) {
    const mine = event.winner.me || event.loser.me;
    play(event.type === 'catch' ? 'cuffs' : 'taunt',mine ? 1 : .4);
    game.fresh.push({loser:event.loser.id});
    // Where the loser starts again it arrives in a puff (and my camera cuts there), however short the move.
    if (event.respawn || event.switched) event.loser.warp = 'respawn';
    const banner = $('#pc-event');
    if (!banner) return;
    const catchIt = event.type === 'catch';
    // (I am 你 in these lines, so each has its own wording for me.)
    const names = {winner:nameOf(event.winner.name),loser:nameOf(event.loser.name),name:nameOf(event.loser.name),team:SIDES[event.loser.side].team};
    const line = catchIt
      ? event.winner.me ? tx('你抓住了{loser}',names) : event.loser.me ? tx('{winner}抓住了你',names) : tx('{winner}抓住了{loser}',names)
      : event.winner.me ? tx('你套了{loser}一圈',names) : event.loser.me ? tx('{winner}套了你一圈',names) : tx('{winner}套了{loser}一圈',names);
    // The loser starts again at the start gap from the nearest opponent (on its new side, when it changed sides).
    const playsOn = game.players.some(player => player.side !== event.loser.side), mineLost = event.loser.me;
    const tail = event.switched ? `${mineLost ? tx('你换到{team}',names) : tx('{name}换到{team}',names)}${playsOn ? tx('，从起跑距离重新出发') : ''}`
      : event.respawn ? catchIt ? (mineLost ? tx('你挣脱手铐，重新领先一段') : tx('{name}挣脱手铐，重新领先一段',names)) : (mineLost ? tx('你回到起跑时的追击距离') : tx('{name}回到起跑时的追击距离',names)) : '';
    banner.innerHTML = `<img src="${sprite(catchIt ? 'police-catch' : 'thief-taunt')}" alt="" draggable="false"><span><b>${catchIt ? tx('抓到了！') : tx('嘲笑！')}</b>${e(line)}${tail ? `<small>${e(tail)}</small>` : ''}</span>`;
    banner.className = `pc-event is-on is-${event.type}${mine ? ' is-mine' : ''}`;
    clearTimeout(ui.bannerTimer);
    ui.bannerTimer = later(() => banner.classList.remove('is-on'),2200);
  }
  function finishGame(game,result,now) {
    game.over = result;
    game.endedAt = now;
    play('finish');
    const record = game.record = saveRecord(game,result,now);
    closeMic();
    void uploadRecord(record);
    later(() => {
      if (ui.game !== game) return;
      ui.game = null;
      ui.resultsFor = {game,record};
      if (ui.view === 'game') show('results');
    },END_HOLD_MS);
  }
  // When losers change sides everyone ends on the winning side, so only those who never had to change side win.
  function outcomeFor(game,result) {
    const me = game.players.find(player => player.me);
    return result === 'draw' ? 'draw' : result === me.side && !me.switched ? 'win' : 'loss';
  }
  // The sentences I typed, for replaying their recordings; a section typed twice (the text comes round again) is listed once.
  function typedSentences(game,me) {
    const seen = new Set();
    return game.text.sentences.filter(sentence => sentence.firstLetter < textAt(me))
      .filter(sentence => { const key = `${sentence.section}|${sentence.from}|${sentence.text}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .slice(-MAX_RECORD_SENTENCES)
      .map(sentence => ({text:sentence.text,zh:sentence.zh,...(sentence.en ? {en:sentence.en} : {}),audio:sentence.audio,from:sentence.from,to:sentence.to,section:sentence.section}));
  }
  function storeRecord(record) {
    ui.records = [record,...ui.records.filter(item => item.id !== record.id)].slice(0,MAX_RECORDS);
    // When the browser's storage is full, the oldest games give way so the new one is still kept.
    while (!writeJSON(RECORDS_KEY,ui.records) && ui.records.length > 1) ui.records = ui.records.slice(0,Math.floor(ui.records.length*.75));
  }
  function saveRecord(game,result,now) {
    const me = game.players.find(player => player.me);
    const minutes = Math.max(now,1)/60000;
    const typed = typedSentences(game,me);
    // `synced` turns true once the server has the game (my average speed and its XP).
    // A reading game keeps how many words were passed by hand and how long a recognition took (its letters are already
    // WORD_STEP a word, see readWord); it has no accuracy.
    const stats = ui.mic?.stats, read = game.read ? {input:'read'} : {};
    const heard = game.read ? {passed:me.read.passed,heardMs:stats?.passes ? Math.round(stats.ms/stats.passes) : 0} : {};
    const record = {id:`g${Date.now().toString(36)}`,at:Date.now(),kind:'bot',...read,synced:false,map:game.map,side:me.startSide,finalSide:me.side,end:game.mode,minutes:game.mode === 'timed' ? game.duration/60000 : 0,
      sections:[...game.text.sections],title:game.title,result:outcomeFor(game,result),winner:result,durationMs:Math.round(now),score:{...game.score},
      me:{rate:Math.round(me.letters/minutes),accuracy:game.read ? null : me.letters+me.errors ? Math.round(me.letters/(me.letters+me.errors)*100) : 100,words:me.words,letters:me.letters,errors:me.errors,
        catches:me.catches,taunts:me.taunts,caught:me.caught,taunted:me.taunted,maxTier:me.maxTier,...heard},
      players:game.players.map(player => ({name:player.name,me:player.me,side:player.side,startSide:player.startSide,level:player.bot?.level || '',
        rate:Math.round(player.letters/minutes),catches:player.catches,taunts:player.taunts,caught:player.caught,taunted:player.taunted,maxTier:player.maxTier})),
      sentences:typed};
    storeRecord(record);
    return record;
  }
  // A game against the computer goes to the server under my nickname: it joins my average speed and earns XP.
  async function uploadRecord(record) {
    // Which uploads are under way is kept apart from the records, so a flag is never saved with one.
    if (record?.kind !== 'bot' || record.synced !== false || ui.uploading.has(record.id)) return;
    ui.uploading.add(record.id);
    try {
      const community = await ui.opts.community?.();
      const reply = await community?.request?.('/chase/result',{method:'POST',timeout:10000,body:{sessionId:record.id,side:record.side,result:record.result,input:record.input === 'read' ? 'read' : 'type',
        letters:Number(record.me?.letters) || 0,words:Math.min(Number(record.me?.words) || 0,Number(record.me?.letters) || 0),durationMs:Math.max(1000,Math.min(Number(record.durationMs) || 0,660000))}});
      if (!reply?.accepted) return;
      record.synced = true;
      record.xp = reply.xp;
      if (Number.isFinite(reply.usual)) ui.serverUsual = reply.usual;
      if (record.result === 'left') {
        forgetLeft(record.id);
        if (reply.xp > 0 && !reply.duplicate && ui.open) notify(tx('中途离开，已打好的词照样记了 {n} XP',{n:reply.xp}));
      }
      if (ui.records.includes(record)) writeJSON(RECORDS_KEY,ui.records);
      if (ui.open && ui.view === 'results' && ui.resultsFor?.record === record) render();
    } catch (error) {
      // A game the server finds invalid is not offered again; anything else is retried the next time the game opens.
      if (error?.code === 'invalid_request') { record.synced = true; if (record.result === 'left') forgetLeft(record.id); else writeJSON(RECORDS_KEY,ui.records); }
    } finally { ui.uploading.delete(record.id); }
  }
  // A game against the computer left halfway (user 2026-11-11): the words already typed or read still earn XP, even
  // one. It is not kept among my games, so wins and speeds stay those of finished games; it waits in its own list
  // until the server has it.
  function creditLeft(game) {
    if (!game || game.room || game.watch || game.over || game.status !== 'playing') return;
    const me = game.players.find(player => player.me);
    if (!me || !(me.words > 0)) return;
    game.over = 'left';
    const now = Math.max(1000,Math.round(gameNow(game)));
    const record = {id:`g${Date.now().toString(36)}`,at:Date.now(),kind:'bot',result:'left',synced:false,side:me.startSide,...(game.read ? {input:'read'} : {}),
      durationMs:now,me:{letters:me.letters,words:me.words,rate:Math.round(me.letters/(now/60000))}};
    const kept = readJSON(LEFT_KEY,[]);
    writeJSON(LEFT_KEY,[record,...(Array.isArray(kept) ? kept : [])].slice(0,20));
    void uploadRecord(record);
  }
  function forgetLeft(id) {
    const kept = readJSON(LEFT_KEY,[]);
    if (Array.isArray(kept)) writeJSON(LEFT_KEY,kept.filter(item => item?.id !== id));
  }
  function resultsPage() {
    const {record} = ui.resultsFor || {};
    if (!record) return homePage();
    const won = record.result === 'win', draw = record.result === 'draw';
    const headline = draw ? tx('平局') : won ? tx('你赢了') : tx('这局输了');
    const sideWord = record.winner === 'draw' ? tx('两边打成平手') : `${SIDES[record.winner]?.team || ''}${EN ? tx('获胜（阵营）') : '获胜'}`;
    const art = record.winner === 'thief' ? 'thief-taunt' : record.winner === 'police' ? 'police-catch' : record.side === 'police' ? 'police-catch' : 'thief-taunt';
    const me = record.me, room = record.kind === 'room', reading = record.input === 'read';
    const stat = (label,value) => `<div class="pc-tile"><span>${label}</span><b>${value}</b></div>`;
    return `${topBar(tx('本局结果'),room && ui.room ? 'room' : 'home')}
      <section class="pc-result-hero is-${record.result}"><img src="${sprite(art)}" alt="" draggable="false"><div><span class="pc-kicker">${e(room ? `${tx('房间 {code}',{code:record.room})} · ${sideWord}` : sideWord)}</span><p class="pc-result-title">${headline}</p>
        <p class="pc-result-score">${icon('cuffs')}${tx('抓到')} <b>${record.score.catch}</b><i>:</i><b>${record.score.taunt}</b> ${tx('嘲笑')}${icon('taunt')}</p>${record.xp ? `<p class="pc-result-xp">+${record.xp} XP</p>` : ''}</div></section>
      <section class="pc-panel"><div class="pc-tiles is-four">${stat(tx('速度'),`${speedValue(me.rate,reading)}${speedUnit(reading)}`)}${reading ? stat(tx('念了'),tx('{n} 个词',{n:me.words})) : stat(tx('正确率'),`${me.accuracy}%`)}${reading ? stat(tx('跳过'),tx('{n} 个词',{n:Number(me.passed) || 0})) : stat(tx('打了'),tx('{n} 个词',{n:me.words}))}${stat(tx('最高'),VEHICLES[record.finalSide || record.side][(me.maxTier || 1)-1])}</div>${reading ? `<p class="pc-hint">${tx('朗读的速度是每分钟念出的词数。')}</p>` : ''}</section>
      <section class="pc-panel"><div class="pc-section-head"><h3>${tx('本局选手')}</h3></div><ul class="pc-players">${record.players.map(player => `<li class="${player.me ? 'is-me' : ''}">${avatar(player.name,player.side,'',Boolean(player.level))}<span class="pc-player-name">${e(nameOf(player.name))}${player.level ? `<small>${tx('电脑')} · ${LEVELS[player.level]?.name || ''}</small>` : player.result === 'left' ? `<small>${tx('中途离开')}</small>` : ''}</span><span class="pc-player-side">${SIDES[player.side].name}${player.side !== player.startSide ? `<small>${tx('换过阵营')}</small>` : ''}</span><span class="pc-player-rate">${speedHTML(player.rate,reading)}</span><span class="pc-player-score">${[player.catches ? tx('抓到 {n}',{n:player.catches}) : '',player.taunts ? tx('嘲笑 {n}',{n:player.taunts}) : ''].filter(Boolean).join(' · ')}</span></li>`).join('')}</ul></section>
      ${record.sentences.length ? `<section class="pc-panel"><div class="pc-section-head">${record.sentences[0].section === 'words' ? `<h3>${reading ? tx('念过的词语') : tx('打过的词语')}</h3><small class="pc-hint">${tx('点播放键听读音')}</small>` : `<h3>${reading ? tx('念过的句子') : tx('打过的句子')}</h3><small class="pc-hint">${tx('点播放键听原书录音')}</small>`}</div>${sentenceList(record.sentences,record.id)}</section>` : ''}
      ${room ? `<div class="pc-actions">${ui.room ? button('go',`<span>${tx('回到房间')}</span>`,'pc-primary pc-wide','data-view="room"') : ''}<div class="pc-actions-row">${button('go',ui.room ? tx('离开房间') : tx('返回'),'pc-quiet','data-view="home"')}</div></div>`
        : `<div class="pc-actions">${button('again',`<span>${tx('再来一局')}</span>`,'pc-primary pc-wide')}<div class="pc-actions-row">${button('go',tx('换个设置'),'pc-ghost','data-view="setup"')}${button('go',tx('返回'),'pc-quiet','data-view="home"')}</div></div>`}`;
  }

  /* ---------- Original recordings on the results and history pages ---------- */
  function playSlice(owner,index,buttonElement) {
    const record = ui.records.find(item => item.id === owner) || (ui.resultsFor?.record?.id === owner ? ui.resultsFor.record : null);
    const sentence = record?.sentences?.[index];
    if (!sentence?.audio) return;
    ui.opts.stopAudio?.();
    stopSlice();
    const audio = ui.slice?.audio || new Audio();
    const slice = ui.slice = {audio,button:buttonElement,begin:null,owner,index};
    buttonElement?.classList.add('is-playing');
    const end = sentence.to+.15;
    const begin = () => {
      if (ui.slice !== slice) return;
      try { audio.currentTime = Math.max(0,sentence.from-.05); } catch {}
      audio.play().catch(() => { if (ui.slice === slice) stopSlice(); });
    };
    audio.ontimeupdate = () => { if (ui.slice === slice && audio.currentTime >= end) stopSlice(); };
    audio.onended = () => { if (ui.slice === slice) stopSlice(); };
    const url = new URL(sentence.audio,location.href).href;
    if (audio.src !== url) { slice.begin = begin; audio.src = url; audio.addEventListener('loadedmetadata',begin,{once:true}); audio.load(); }
    else begin();
  }
  function stopSlice() {
    const slice = ui.slice;
    if (!slice) return;
    if (slice.begin) slice.audio.removeEventListener('loadedmetadata',slice.begin);
    try { slice.audio.pause(); } catch {}
    slice.button?.classList.remove('is-playing');
    ui.slice = {audio:slice.audio};
  }

  /* ---------- The world on screen ---------- */
  // The 3D world (chase-world.mjs, three.js) is loaded with the first game and kept while the overlay is open.
  // The graphics card gave up on the picture (its WebGL context was lost). Q版 and 3D ask the most of it, so the
  // player's look goes back to 像素, the lightest; they can pick another one again on the setup page. Only once:
  // a card that cannot draw 像素 either gets the plain message.
  function lighterLook() {
    const look = LOOKS[ui.prefs.look];
    if (!look || ui.prefs.look === 'pixel') return '';
    ui.prefs.look = 'pixel';
    ui.prefs.lookPicked = true;
    savePrefs();
    return tx('这台电脑的显卡画不动{look}画面，已换成像素画面',{look:look.name});
  }
  // Starts the picture over in the new look: a bot game begins again, a room game rejoins its round if it is still on.
  function pictureAgain(room,watch) {
    if (!room) creditLeft(ui.game);
    stopGame();
    ui.starting = null;
    if (!room) { void startGame(); return true; }
    const state = ui.room?.state;
    if (!state?.match || !['loading','countdown','playing'].includes(state.status) || !(watch || state.match.participants.includes(state.me))) return false;
    void startRoomGame(state,watch);
    return true;
  }
  const PICTURE_FAILED = tx('画面没能建好，请关掉其他占显卡的网页或程序，刷新后再试。');
  function loadWorld() {
    ui.worldLoad ||= import(versioned('./chase-world.mjs')).catch(error => { ui.worldLoad = null; throw error; });
    return ui.worldLoad;
  }
  async function setupStage(current = () => ui.open && ui.view === 'game',mapId = ui.prefs.map) {
    const canvas = $('#pc-canvas'), stageElement = $('#pc-stage'), input = $('#pc-input');
    if (!canvas || !ui.assets) throw new Error('stage unavailable');
    input?.addEventListener('input',onInput);
    input?.addEventListener('compositionstart',onCompositionStart);
    input?.addEventListener('compositionend',onCompositionEnd);
    input?.addEventListener('keydown',event => { wakeSfx(); if (event.key === 'Enter') event.preventDefault(); });
    for (const type of ['paste','drop']) input?.addEventListener(type,event => event.preventDefault());
    $('#pc-type')?.addEventListener('pointerdown',event => {
      const own = event.target.closest('.pc-kb-key');
      if (own) { event.preventDefault(); wakeSfx(); pressKey(own); return; }
      if (event.target.closest('.pc-kb-show')) { event.preventDefault(); setKeys(true); return; }
      const key = event.target.closest('.pc-key');
      if (key) { event.preventDefault(); wakeSfx(); feed(key.dataset.char); focusInput(); return; }
      if (event.target !== input) { event.preventDefault(); focusInput(); }
    });
    // A tap on the typing panel or the picture brings the on-screen keyboard back after it was put away (the input
    // keeps its focus then, so it is blurred and focused again; this happens on the click, which iOS accepts).
    const summon = event => {
      if (ui.ownKeys || event.target.closest?.('.pc-key')) return;
      const viewport = window.visualViewport, put = viewport && window.innerHeight-viewport.height < 80;
      if (document.activeElement === input && put && window.matchMedia?.('(pointer: coarse)').matches) input.blur();
      focusInput();
    };
    $('#pc-type')?.addEventListener('click',summon);
    stageElement?.addEventListener('click',summon);
    // A tap on the picture must not take the focus away from the input (which would put the keyboard away).
    stageElement?.addEventListener('pointerdown',event => { event.preventDefault(); focusInput(); });
    const module = await loadWorld();
    if (!current()) return;
    let small = false, touch = false;
    try {
      touch = window.matchMedia('(pointer: coarse)').matches;
      small = Math.min(window.innerWidth,window.innerHeight) < 600 || (touch && Math.max(window.innerWidth,window.innerHeight) < 1100);
    } catch {}
    const map = mapOf(mapId);
    let world = null;
    world = await module.createWorld({canvas,overlay:$('#pc-overlay'),images:ui.images,manifest:ui.assets,small,touch,style:ui.prefs.look,
      map:map.kind === 'brunstad' ? {...map,manifest:versioned(map.manifest),files:Object.fromEntries(Object.entries(map.files).map(([name,path]) => [name,versioned(path)]))} : map,
      onLost:() => {
        if (!world || ui.stage?.world !== world || !ui.game) return;
        const {room,watch} = ui.game;
        ui.game = null;
        // Q版 or 3D was too much for the card: the game goes on at once in 像素 (a room game rejoins the round in play).
        const fallback = lighterLook();
        if (fallback && pictureAgain(room,watch)) { notify(room ? tx('{fallback}，回到这一局。',{fallback}) : tx('{fallback}，重新开局。',{fallback}),5000); return; }
        show(room ? 'room' : 'setup');
        notify(room ? tx('画面中断了，请回到房间重新加入下一局。') : tx('画面中断了，这一局没有记入战绩，请重新开始。'));
      }});
    if (!current() || !stageElement.isConnected) { world.dispose(); return; }
    // Real map data comes with its sources named in the corner (the short form; the full notice is its title).
    if (world.attribution) stageElement.insertAdjacentHTML('beforeend',`<p class="pc-credit" title="${e(world.attribution)}">${e(ui.plan?.credit || world.attribution)}</p>`);
    const credit = Boolean(world.attribution);
    // Letters for one lap of this map, the rules' own number (a longer map simply takes more typing to go round), so the
    // thief laps the officer in the picture just when the rules say so.
    ui.stage = {lap:lapOf(mapId),credit,canvas,element:stageElement,world,overlay:$('#pc-overlay'),minimap:$('#pc-minimap'),fx:$('#pc-fx'),
      veil:$('#pc-veil'),bubbles:new Map(),lines:[],lastStamp:0,clock:0};
    if ('ResizeObserver' in window) { ui.stage.observer = new ResizeObserver(() => layoutStage()); ui.stage.observer.observe(stageElement); }
    layoutStage();
  }
  function layoutStage() {
    const stage = ui.stage;
    if (!stage) return;
    const rect = stage.element.getBoundingClientRect();
    const width = Math.max(1,Math.round(rect.width)), height = Math.max(1,Math.round(rect.height));
    // The on-screen keyboard only crops the picture: the world keeps the scale it has without it. Some in-app browsers
    // shrink the whole page for the keyboard (it then measures 0), so the tallest stage seen at this width counts too.
    const open = height+keyboardHeight();
    stage.tallest = stage.tallestAt === width ? Math.max(stage.tallest,open) : open;
    stage.tallestAt = width;
    const full = stage.tallest;
    if (stage.width === width && stage.height === height && stage.full === full) return;
    // A row of words was filled for the old width: it is laid out again from the word being typed.
    const wider = stage.width && stage.width !== width;
    Object.assign(stage,{width,height,full});
    if (wider && ui.lineWords) renderLine(true);
    stage.world.resize(width,height,full);
    // On a short stage the small map would cover the road, so it steps aside.
    stage.element.classList.toggle('is-short',height < 260);
    const ratio = Math.min(2,window.devicePixelRatio || 1);
    stage.fx.width = Math.round(width*ratio); stage.fx.height = Math.round(height*ratio);
    const map = stage.minimap, box = map.getBoundingClientRect();
    map.width = Math.round(box.width*ratio); map.height = Math.round(box.height*ratio);
    stage.corner = box.width ? {right:box.right-rect.left,top:box.top-rect.top} : null;
    stage.ratio = ratio;
    // A resized canvas is blank until it is drawn again: draw it now rather than show an empty frame.
    if (ui.game) renderWorld(ui.game,0);
  }
  // What the world needs to draw a runner: where it is, what it looks like, and how it moves.
  function lookOf(player) {
    let name = SPRITES[player.side][player.tier-1];
    if (ui.assets?.sprites?.[`${name}-cycle`]) name = `${name}-cycle`;
    return {name,kind:name.replace(/-cycle$/,'').split('-')[1]};
  }
  function viewOf(player,now) {
    const frozen = Boolean(player.pose && now < player.pose.until);
    // `warp` says how a runner gets to a new place: 'respawn' (a puff, and my camera cuts) or 'quiet' (it simply is
    // there); it is used up once the runner is no longer held in its pose.
    const warp = frozen ? '' : player.warp || '';
    if (warp) player.warp = '';
    // `immune` is the share of the grace period still to come (0 when there is none).
    return {id:player.id,me:player.me,name:player.name,side:player.side,tier:player.tier,lane:player.lane,vel:player.vel,frozen,away:Boolean(player.away),
      immune:immune(player,now) ? (player.immuneUntil-now)/IMMUNE_MS : 0,warp,
      u:frozen ? player.pose.at : position(player),look:frozen ? {name:player.pose.name,kind:'pose'} : lookOf(player)};
  }
  function renderWorld(game,dt) {
    if (!ui.prefs.scene) { drawPlain(game); return; }
    const stage = ui.stage, now = shownNow(game), still = ui.prefs.camera === 'still' || Boolean(game.watch);
    const views = game.players.filter(player => !player.gone).map(player => viewOf(player,now));
    const shown = stage.world.render({players:views,lap:stage.lap,dt,stamp:stage.clock,still,calm:ui.calm,events:game.fresh.splice(0)});
    // When I reappear elsewhere the camera cuts there under a soft veil of paper rather than sweeping across the map.
    if (shown?.cut && stage.veil && !ui.calm) { stage.veil.classList.remove('is-on'); void stage.veil.offsetWidth; stage.veil.classList.add('is-on'); }
    placeBubbles(game,now);
    placeMarkers(game);
    drawMinimap(stage,views);
    drawSpeedLines(stage,game.players.find(player => player.me && !player.gone),dt,still);
  }
  // With the picture off: the loop as one quiet line, me in the middle and half a lap each way, so both ends are the
  // same far side of the loop. Everyone else sits where they are on the loop, the short way round: a runner more than
  // half a lap ahead shows behind me, which is where it really is (a thief about to lap an officer comes up from
  // behind). Catches and laps both happen where two dots meet; nothing happens at the ends.
  function drawPlain(game) {
    const box = $('#pc-plain'), track = box?.firstElementChild;
    if (!track) return;
    const now = shownNow(game);
    // Nothing on the track is drawn by the world now: its pending events and finished-word bubbles are let go.
    game.fresh.length = 0;
    game.bubbles = game.bubbles.filter(bubble => now-bubble.at <= 1500);
    const players = game.players.filter(player => !player.gone);
    const me = players.find(player => player.me) || players[0];
    if (!me) return;
    const dots = ui.plainDots ||= new Map(), seen = new Set(), half = game.lap*METERS_PER_LETTER/2;
    const items = players.map(player => {
      const gap = player === me ? {metres:0,lapping:false} : loopGap(game,me,player);
      return {player,...gap,x:50+clamp(gap.metres/half,-1,1)*44};
    }).sort((p,q) => p.x-q.x);
    // Labels that would touch take turns above and below the line.
    let lastX = -Infinity, flip = false;
    for (const item of items) {
      const {player} = item;
      seen.add(player.id);
      let dot = dots.get(player.id);
      if (!dot || dot.element.parentElement !== track) {
        const element = document.createElement('span');
        element.innerHTML = '<i></i><b></b><small></small>';
        track.append(element);
        dot = {element,key:''};
        dots.set(player.id,dot);
      }
      flip = item.x-lastX < 9 ? !flip : false;
      lastX = item.x;
      const mine = player === me && player.me;
      const text = mine ? '' : gapText(item);
      const key = `${player.side}|${player.name}|${text}|${flip}|${Boolean(player.away)}`;
      if (dot.key !== key) {
        dot.key = key;
        dot.element.className = `pc-plain-dot is-${player.side}${mine ? ' is-me' : ''}${flip ? ' is-below' : ''}${player.away ? ' is-away' : ''}`;
        dot.element.children[1].textContent = mine ? ME : nameOf(player.name);
        dot.element.children[2].textContent = text;
      }
      // Round the far side a dot leaves one end and comes in at the other: it fades towards the ends and jumps across
      // without gliding over the whole line.
      dot.element.classList.toggle('is-jump',dot.x !== undefined && Math.abs(item.x-dot.x) > 44);
      dot.x = item.x;
      const fade = clamp((44-Math.abs(item.x-50))/6,0,1);
      dot.element.style.opacity = fade < 1 ? ((player.away ? .35 : 1)*(.25+.75*fade)).toFixed(2) : '';
      dot.element.style.left = `${item.x.toFixed(2)}%`;
    }
    for (const [id,dot] of dots) if (!seen.has(id) || dot.element.parentElement !== track) { dot.element.remove(); dots.delete(id); }
  }
  // Word bubbles are page elements over the canvas, so the words stay crisp at any size. The word before fades out
  // where it stands as the next one appears.
  function placeBubbles(game,now) {
    const stage = ui.stage, alive = new Set(), stacks = new Map();
    // My own word sits over my head the whole time (only on this screen), so finished words rise above it.
    const live = placeLive(game);
    if (live) stacks.set(live.id,1);
    for (let i = game.bubbles.length-1; i >= 0; i--) {
      const bubble = game.bubbles[i];
      if (now-bubble.at > 1500 || (bubble.leaving && now-bubble.leaving > 320)) continue;
      alive.add(bubble);
      let element = stage.bubbles.get(bubble);
      if (!element) {
        element = document.createElement('span');
        element.className = `pc-bubble${bubble.player.me ? ' is-me' : ''}`;
        element.lang = 'nb';
        element.textContent = bubble.text;
        stage.overlay.append(element);
        stage.bubbles.set(bubble,element);
      }
      let level = 0;
      if (bubble.leaving) { if (!bubble.level) bubble.level = element.dataset.level || '0'; level = Number(bubble.level); element.classList.add('is-leaving'); }
      else { level = stacks.get(bubble.player.id) || 0; stacks.set(bubble.player.id,level+1); element.dataset.level = level; }
      const head = stage.world.headOf(bubble.player.id);
      if (!head?.ok) { element.style.visibility = 'hidden'; continue; }
      element.style.visibility = '';
      element.style.transform = `translate(${head.x.toFixed(1)}px,${(head.y-level*34).toFixed(1)}px) translate(-50%,-100%)`;
      if (!bubble.leaving) element.classList.toggle('is-old',level > (bubble.player === live ? 1 : 0));
    }
    for (const [bubble,element] of stage.bubbles) if (!alive.has(bubble)) { element.remove(); stage.bubbles.delete(bubble); }
    game.bubbles = game.bubbles.filter(bubble => alive.has(bubble));
  }
  // The word I am typing, in grey letters that darken as they are typed; when it is done it rises off as a word bubble
  // and the next word takes its place. Returns me while it is shown.
  function placeLive(game) {
    const stage = ui.stage, me = game.players.find(player => player.me && !player.gone);
    const word = me && !game.watch && !game.over ? game.text?.words?.[wordAt(me)] : null;
    const head = word ? stage.world.headOf(me.id) : null;
    let element = stage.live;
    if (!head?.ok) { if (element) element.style.visibility = 'hidden'; return null; }
    if (!element) {
      element = stage.live = document.createElement('span');
      element.className = 'pc-bubble is-me is-live';
      element.lang = 'nb';
      stage.overlay.append(element);
    }
    if (element.word !== word) {
      element.word = word;
      const text = game.text.sentences[word.s].text.slice(word.start,word.end);
      element.innerHTML = text.split('').map(char => `<span${TYPEABLE.test(char) ? ' class="pc-live-ch"' : ''}>${e(char)}</span>`).join('');
      element.letters = [...element.querySelectorAll('.pc-live-ch')];
      element.typed = -1;
    }
    const typed = Math.max(0,Math.min(textAt(me)-word.letterStart,element.letters.length));
    if (element.typed !== typed) {
      element.typed = typed;
      element.letters.forEach((span,index) => span.classList.toggle('is-done',index < typed));
    }
    element.style.visibility = '';
    element.style.transform = `translate(${head.x.toFixed(1)}px,${head.y.toFixed(1)}px) translate(-50%,-100%)`;
    return me;
  }
  // Opponents out of the picture get a marker at its edge, in the direction they are (the camera never turns, so east is
  // right and north is up). Markers that would cover each other are moved apart along the edge.
  function placeMarkers(game) {
    const stage = ui.stage, me = game.players.find(player => player.me), inset = 14, world = stage.world;
    stage.markers ||= new Map();
    const shown = [], focus = world.focus?.();
    for (const player of game.players) {
      if (!me || player.me || player.gone || player.side === me.side) { stage.markers.get(player.id)?.element.remove(); stage.markers.delete(player.id); continue; }
      const head = world.headOf(player.id), ground = world.groundOf?.(player.id);
      let marker = stage.markers.get(player.id);
      // A marker comes when the runner leaves the picture and goes only once it is well inside, so a runner bobbing at
      // the edge does not make it flicker.
      const margin = marker && !marker.element.hidden ? inset+24 : inset;
      const inside = head?.ok && head.x > margin && head.x < stage.width-margin && head.y > margin && head.y < stage.height-margin;
      if (!head || !ground || !focus || inside) { if (marker) marker.element.hidden = true; continue; }
      if (!marker) {
        const element = document.createElement('span');
        element.innerHTML = '<i aria-hidden="true"></i><b></b><small></small>';
        stage.overlay.append(element);
        marker = {element,text:'',side:'',half:70};
        stage.markers.set(player.id,marker);
      }
      marker.element.hidden = false;
      if (marker.side !== player.side) { marker.side = player.side; marker.element.className = `pc-marker is-${player.side}`; }
      const gap = loopGap(game,me,player), metres = gap.metres, text = gapText(gap);
      if (marker.text !== text) {
        // Its width is measured when the wording grows or shrinks, so a long name stays inside the picture.
        const resize = marker.text.length !== text.length;
        marker.text = text;
        marker.element.children[1].textContent = nameOf(player.name);
        marker.element.children[2].textContent = text;
        if (resize) marker.half = Math.max(40,marker.element.offsetWidth/2);
      }
      // From the middle of the picture towards the runner, out to the edge.
      const angle = Math.atan2((ground.z-focus.z)*Math.sin(focus.pitch),ground.x-focus.x);
      const left = inset+marker.half, right = Math.max(left,stage.width-inset-marker.half), top = inset+18, bottom = Math.max(top,stage.height-inset-(stage.credit ? 30 : 18));
      const cx = stage.width/2, cy = stage.height/2, dx = Math.cos(angle), dy = Math.sin(angle);
      const reach = Math.min(Math.abs(dx) > 1e-6 ? (dx > 0 ? right-cx : cx-left)/Math.abs(dx) : Infinity,Math.abs(dy) > 1e-6 ? (dy > 0 ? bottom-cy : cy-top)/Math.abs(dy) : Infinity);
      shown.push({marker,angle,x:clamp(cx+dx*reach,left,right),y:cy+dy*reach,far:Math.abs(metres)});
    }
    // Only the six nearest get a marker, so a big room does not ring the picture with names.
    shown.sort((p,q) => p.far-q.far);
    for (const item of shown.splice(MAX_MARKERS)) item.marker.element.hidden = true;
    // The small map's corner (bottom left) is kept clear, and markers never sit on top of one another.
    const mapRight = stage.corner ? stage.corner.right : -Infinity, mapTop = stage.corner ? stage.corner.top-16 : Infinity;
    shown.sort((p,q) => p.y-q.y);
    const middle = stage.height/2;
    const overlaps = (item,other) => Math.abs(other.x-item.x) < item.marker.half+other.marker.half+8 && Math.abs(other.y-item.y) < 30;
    for (let i = 0; i < shown.length; i++) {
      const item = shown[i];
      if (item.x-item.marker.half < mapRight && item.y > mapTop) item.y = mapTop;
      // Stack away from the nearer edge, so a pile at the bottom grows upward and stays in the picture.
      const step = item.y > middle ? -30 : 30;
      for (let tries = 0; tries < shown.length && shown.slice(0,i).some(other => overlaps(item,other)); tries++) {
        const near = shown.slice(0,i).filter(other => overlaps(item,other));
        item.y = step < 0 ? Math.min(...near.map(other => other.y))+step : Math.max(...near.map(other => other.y))+step;
      }
      item.marker.element.style.transform = `translate(${item.x.toFixed(1)}px,${item.y.toFixed(1)}px) translate(-50%,-50%)`;
      item.marker.element.children[0].style.transform = `rotate(${item.angle}rad)`;
    }
  }
  // A small north-up map of the loop with everyone on it.
  function drawMinimap(stage,views) {
    const canvas = stage.minimap, context = canvas.getContext('2d'), outline = stage.world.outline;
    if (!canvas.width || !outline?.length) return;
    stage.bounds ||= (() => { const xs = outline.map(point => point[0]), zs = outline.map(point => point[1]); return [Math.min(...xs),Math.max(...xs),Math.min(...zs),Math.max(...zs)]; })();
    const [x0,x1,z0,z1] = stage.bounds;
    const pad = 9*stage.ratio, scale = Math.min((canvas.width-pad*2)/(x1-x0),(canvas.height-pad*2)/(z1-z0));
    const ox = (canvas.width-(x1-x0)*scale)/2, oz = (canvas.height-(z1-z0)*scale)/2;
    const at = (x,z) => [ox+(x-x0)*scale,oz+(z-z0)*scale];
    context.clearRect(0,0,canvas.width,canvas.height);
    context.lineJoin = 'round';
    context.beginPath();
    outline.forEach(([x,z],i) => { const [px,pz] = at(x,z); if (i) context.lineTo(px,pz); else context.moveTo(px,pz); });
    context.closePath();
    context.strokeStyle = '#a58c62'; context.lineWidth = 5.5*stage.ratio; context.stroke();
    context.strokeStyle = '#f6ecd4'; context.lineWidth = 2.6*stage.ratio; context.stroke();
    const n = outline.length;
    for (const view of [...views].sort((a,b) => a.me-b.me)) {
      const f = mod(view.u,stage.lap)/stage.lap*n, i = Math.floor(f) % n, k = f-Math.floor(f), a = outline[i], b = outline[(i+1) % n];
      const [px,pz] = at(a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k);
      context.beginPath();
      context.arc(px,pz,(view.me ? 5 : 4)*stage.ratio,0,Math.PI*2);
      context.fillStyle = view.side === 'police' ? '#2f4f78' : '#9a5a32';
      // Someone whose connection dropped is drawn faint, as on the track.
      context.globalAlpha = view.away ? .45 : 1;
      context.fill();
      context.lineWidth = (view.me ? 2.2 : 1.2)*stage.ratio;
      context.strokeStyle = view.me ? '#e2b55e' : '#fffaf0';
      context.stroke();
      context.globalAlpha = 1;
    }
  }
  // At speed, thin wind streaks rush past along my direction of travel, as in hand-drawn animation.
  // None in the wide view or with reduced motion: the picture there is meant to stay calm.
  function drawSpeedLines(stage,me,dt,still) {
    const canvas = stage.fx, context = canvas.getContext('2d');
    if (stage.drawnLines) context.clearRect(0,0,canvas.width,canvas.height);
    stage.drawnLines = false;
    if (!me || ui.calm || still) { stage.lines.length = 0; return; }
    const strength = clamp((me.tier-3.5)/1.5,0,1)*clamp(me.vel/2.2,0,1);
    const want = Math.round(strength*12);
    while (stage.lines.length < want) stage.lines.push({v:Math.random()*2-1,u:1+Math.random()*.6,length:.12+Math.random()*.2,speed:1.6+Math.random()*1.8,width:.6+Math.random()*1.2});
    stage.lines.length = Math.min(stage.lines.length,want);
    const head = stage.world.headOf(me.id);
    if (!stage.lines.length || !head?.ok) return;
    stage.drawnLines = true;
    const width = canvas.width, height = canvas.height, radius = Math.hypot(width,height)/2;
    const {x:dx,y:dy} = stage.world.heading(), px = -dy, py = dx;
    // The streaks flow round my runner, wherever it is in the picture.
    const ox = head.x*stage.ratio, oy = head.y*stage.ratio;
    context.lineCap = 'round';
    for (const line of stage.lines) {
      line.u -= line.speed*dt*(.6+strength);
      if (line.u+line.length < -1.1) { line.u = 1+Math.random()*.4; line.v = Math.random()*2-1; }
      // Keep the streaks clear of the runner.
      const v = (line.v < 0 ? -1 : 1)*(.28+Math.abs(line.v)*.72);
      const x0 = ox+(dx*line.u+px*v)*radius, y0 = oy+(dy*line.u+py*v)*radius;
      const x1 = x0+dx*line.length*radius, y1 = y0+dy*line.length*radius;
      const gradient = context.createLinearGradient(x0,y0,x1,y1);
      gradient.addColorStop(0,'rgba(255,250,236,0)');
      gradient.addColorStop(.5,`rgba(255,250,236,${(.14+.16*strength).toFixed(2)})`);
      gradient.addColorStop(1,'rgba(255,250,236,0)');
      context.strokeStyle = gradient;
      context.lineWidth = line.width*stage.ratio;
      context.beginPath();
      context.moveTo(x0,y0);
      context.lineTo(x1,y1);
      context.stroke();
    }
  }

  window.NorskChase = {open,close:requestClose,isOpen:() => ui.open};
})();
