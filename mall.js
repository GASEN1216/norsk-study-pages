/* 百货超市 · Varehuset: a co-op learning department store. Loaded on demand; nothing touches the page until open().
   The player is the shop clerk. A cutaway building holds six floors of shops; in a shop the counter (Disken) has the
   customers, their baskets and the services (fitting room, till), and the shelves (Hylla) hold the real things in
   sections. A customer says what they want; the clerk taps the thing on the shelf (a garment, then its size tag),
   answers at the moments that need words (three Norwegian replies), does the service and hands the bag over with
   "Vær så god!". Played alone in the browser (the server replays the action log to score it) or with classmates in
   one shop, where every section is one player's (scripts/community_api.py runs the same rules). */
(() => {
  'use strict';
  if (window.NorskMall) return;
  const L10N = window.NorskI18n || {lang:'zh',english:false,t:(text,vars) => vars ? text.replace(/\{(\w+)\}/g,(match,key) => key in vars ? String(vars[key]) : match) : text,gloss:item => String(item?.meaning ?? item?.zh ?? ''),data:() => Promise.resolve(null),name:nickname => String(nickname ?? ''),set() {}};
  const tx = L10N.t;
  const PREFS_KEY = 'norsk-mall-v1', PENDING_KEY = 'norsk-mall-pending-v1';

  /* ---------- Rules and tuning (community_api.py's ML_* constants hold the same values). Everything from here to
     randomAction is hashed into rulesHash by scripts/build_mall.py. ---------- */
  const TIERS = {novice:{xp:2},standard:{xp:3},expert:{xp:4}};
  const TIER_IDS = ['novice','standard','expert'];
  // Three stars are three levels (as in 开饭啦): ★ 新手, ★★ 标准, ★★★ 高手, each passed at its share of the theme's
  // target. A theme at two stars opens the next theme of its shop; a floor's core themes all at two stars open the
  // next floor. In a room the team's score must reach the target and the player must have answered five times, 80 % right.
  const TIER_TARGET = {novice:100,standard:90,expert:80};
  const UNLOCK_STARS = 2, ROOM_ACCURACY = 80, ROOM_MIN_ANSWERS = 5;
  const MINUTES = [3,4,5], DEFAULT_MINUTES = 4;
  const MAX_PLAYERS = 30;
  // Customers come every ARRIVE_GAP ms (±25 %), by number of clerks; quicker with more than four, never closer than ARRIVE_MIN.
  const ARRIVE_GAP = [0,16000,13000,11000,9500], ARRIVE_MIN = 6000;
  const FIRST_ARRIVAL = 1500, QUIET_END = 25000, MAX_ORDERS = 60;
  // How long a customer waits: a base, more for each piece, each reply and a service. A reply that comes up gives
  // them back at least TALK_FLOOR % of their patience. In a fitting room (or waiting for one) patience stops.
  const PATIENCE_BASE = 42000, PATIENCE_PIECE = 9000, PATIENCE_TALK = 7000, PATIENCE_SERVICE = 9000, TALK_FLOOR = 30;
  const FIT_MS = 3500, FIT_AGAIN_MS = 2500;
  const POINTS_BASE = 20, POINTS_PIECE = 8, POINTS_TALK = 6, POINTS_SERVICE = 6, TIP_MAX = 15;
  const COUNT_WINDOW = 1000, COUNT_PER_WINDOW = 2; // at most two right answers a second earn anything
  const BAG_XP = 5, GAME_XP_CAP = 400;
  // A reply opened by one player in a room is theirs for TALK_HOLD ms; then anyone may answer.
  const TALK_HOLD = 15000;
  // The theme's core orders all come among the first MUST_WITHIN customers of every game.
  const MUST_WITHIN = 8;
  // Letter sizes, then shoe and children's sizes as numbers (a size's place in this list goes into the log).
  const SIZES = ['XS','S','M','L','XL',...Array.from({length:29},(_,i) => String(20+i))];
  const CHATS = ['takk','kom-igjen','unnskyld','vaer-saa-god'];
  const ACTIONS = ['pick','say','open','fit','till','give','back','miss','call','chat','away','home'];

  /* ---------- Pure logic (scripts/check_mall.cjs; ported in community_api.py, compared by scripts/test_mall_rules.py).
     Times are whole milliseconds of game time (0 = the start signal); states are plain JSON with ASCII ids. ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15),t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7),t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
  }
  const pick = (random,n) => Math.floor(random()*n/4294967296);

  // A theme as the rules see it: every thing on the shop's shelves (the sections never change during a game), what
  // each thing is (its product, colour, sizes), and the theme's order templates.
  function themeRules(data,theme) {
    const shop = (data.shops || []).find(entry => entry.id === theme.shop);
    const items = [], sectionOf = {}, productOf = {}, kindOf = {}, colorOf = {}, sizesOf = {};
    for (const section of shop.sections) for (const id of section.items) {
      if (sectionOf[id]) continue;
      const item = data.items[id];
      items.push(id); sectionOf[id] = section.id;
      productOf[id] = item.p; kindOf[id] = item.v || ''; colorOf[id] = item.color || ''; sizesOf[id] = [...(item.sizes || [])];
    }
    const products = [];
    for (const id of items) if (!products.includes(productOf[id])) products.push(productOf[id]);
    const tpls = {};
    for (const tpl of theme.orders) tpls[tpl.id] = tpl;
    return {id:theme.id,shop:shop.id,target:theme.target | 0,items,products,sectionOf,productOf,kindOf,colorOf,sizesOf,
      sections:shop.sections.map(section => ({id:section.id,items:[...section.items]})),tpls,tplList:theme.orders.map(tpl => tpl.id),
      must:theme.orders.filter(tpl => tpl.must).map(tpl => tpl.id),
      customers:(data.customers || []).map(customer => ({id:customer.id,voice:customer.voice === 'm' ? 'm' : 'f'}))};
  }
  // The words a learning record is kept for: a product, a colour, a reply.
  const productWord = (scene,item) => `m-${scene.productOf[item] || item}`;
  const colorWord = color => color ? `m-farge-${color}` : '';
  const talkWord = (order,k) => `t-${order.tpl}-${order.talks[k].k}`;
  function tplWords(scene,tpl) {
    const words = [];
    const add = word => { if (word && !words.includes(word)) words.push(word); };
    for (const want of tpl.want) { add(productWord(scene,want.i)); if (!want.any) add(colorWord(scene.colorOf[want.i])); }
    if (tpl.soldout?.accept) add(productWord(scene,tpl.soldout.sub));
    if (tpl.change?.to) { add(productWord(scene,tpl.change.to)); add(colorWord(scene.colorOf[tpl.change.to])); }
    for (const talk of tpl.talk || []) add(`t-${tpl.id}-${talk.k}`);
    return words;
  }
  const arriveGap = players => players <= 4 ? ARRIVE_GAP[Math.max(1,players)] : Math.max(ARRIVE_MIN,Math.floor(ARRIVE_GAP[4]*4/players));
  const seatCount = players => players === 1 ? 2 : players <= 4 ? 3 : 4;
  const fitRooms = players => players === 1 ? 1 : 2;
  function patienceOf(tpl) {
    let pieces = 0;
    for (const want of tpl.want) pieces += want.q || 1;
    let extra = 0;
    if (tpl.svc === 'fit' && tpl.fit && tpl.fit !== 'ok') extra++;
    if (tpl.change) extra++;
    if (tpl.soldout) extra++;
    return PATIENCE_BASE+PATIENCE_PIECE*(pieces+extra)+PATIENCE_TALK*(tpl.talk || []).length+(tpl.svc ? PATIENCE_SERVICE : 0);
  }

  // The customers of one game, drawn from the seed: who comes when, with which order. Orders with words the clerks
  // have not mastered (`weak`) come more often; the theme's core orders come in every game, among the first few.
  function plan(scene,{seed,minutes = DEFAULT_MINUTES,players = 1,weak = []}) {
    const random = rng(seed), duration = minutes*60000, weakSet = new Set(weak);
    const weights = scene.tplList.map(id => {
      const words = tplWords(scene,scene.tpls[id]);
      return 4+Math.floor(12*words.filter(word => weakSet.has(word)).length/Math.max(1,words.length));
    });
    const gap = arriveGap(players), picks = [], times = [];
    let at = FIRST_ARRIVAL, last = -1;
    while (at <= duration-QUIET_END && picks.length < MAX_ORDERS) {
      let total = 0;
      for (let index = 0; index < weights.length; index++) if (index !== last || weights.length === 1) total += weights[index];
      let draw = pick(random,total), chosen = 0;
      for (let index = 0; index < weights.length; index++) {
        if (index === last && weights.length > 1) continue;
        if (draw < weights[index]) { chosen = index; break; }
        draw -= weights[index];
      }
      picks.push(chosen); times.push(at);
      at += gap-Math.floor(gap/4)+pick(random,Math.floor(gap/2));
      last = chosen;
    }
    const window = Math.min(MUST_WITHIN,picks.length), locked = [];
    const mustIndex = scene.must.map(id => scene.tplList.indexOf(id));
    for (const index of mustIndex) {
      for (let place = 0; place < window; place++) if (picks[place] === index && !locked.includes(place)) { locked.push(place); break; }
    }
    for (const index of mustIndex) {
      if (locked.some(place => picks[place] === index)) continue;
      const open = [];
      for (let place = 0; place < window; place++) if (!locked.includes(place)) open.push(place);
      if (!open.length) break;
      const place = open[pick(random,open.length)];
      picks[place] = index;
      locked.push(place);
    }
    const people = scene.customers.length ? scene.customers : [{id:'c00',voice:'f'}], recent = [];
    return picks.map((index,n) => {
      const free = people.filter(person => !recent.includes(person.id)), from = free.length ? free : people;
      const person = from[pick(random,from.length)];
      recent.push(person.id);
      if (recent.length > 3) recent.shift();
      const tpl = scene.tpls[scene.tplList[index]];
      return {n,tpl:tpl.id,at:times[n],patience:patienceOf(tpl),customer:person.id,voice:person.voice};
    });
  }
  function demandOf(scene) {
    const demand = {};
    for (const section of scene.sections) demand[section.id] = 0;
    for (const id of scene.tplList) for (const want of scene.tpls[id].want) if (scene.sectionOf[want.i] in demand) demand[scene.sectionOf[want.i]] += want.q || 1;
    return demand;
  }
  // Which clerk keeps which section: the busiest first, each to whoever has least so far; ties go round from `round`.
  function sections(scene,players,round = 0) {
    const demand = demandOf(scene);
    const order = scene.sections.map((section,index) => ({id:section.id,index,demand:demand[section.id]})).sort((a,b) => b.demand-a.demand || a.index-b.index);
    const load = players.map(() => 0), owner = {}, count = players.length;
    for (const section of order) {
      let best = -1;
      for (let step = 0; step < count; step++) {
        const player = (step+round)%count;
        if (best < 0 || load[player] < load[best]) best = player;
      }
      owner[section.id] = players[best];
      load[best] += section.demand+1;
    }
    return owner;
  }
  // Clerks left without a section help at the one with most work per pair of hands.
  function crew(scene,players,owner,round = 0) {
    const demand = demandOf(scene), share = {}, count = players.length;
    const kept = new Set(Object.values(owner)), hands = {};
    for (const section of scene.sections) hands[section.id] = 1;
    for (let step = 0; step < count; step++) {
      const player = players[(step+round)%count];
      if (kept.has(player) || !scene.sections.length) continue;
      let best = null;
      for (const section of scene.sections) {
        if (!best) { best = section.id; continue; }
        const mineWork = (demand[section.id]+1)*hands[best], bestWork = (demand[best]+1)*hands[section.id];
        if (mineWork > bestWork || mineWork === bestWork && demand[section.id] > demand[best]) best = section.id;
      }
      (share[best] ||= []).push(player);
      hands[best]++;
    }
    return share;
  }

  function newMatch(scene,{seed,minutes = DEFAULT_MINUTES,tier = 'standard',players = ['me'],round = 0,weak = []}) {
    const count = players.length, owner = sections(scene,players,round), share = crew(scene,players,owner,round);
    return {v:1,theme:scene.id,seed:seed >>> 0,tier:TIERS[tier] ? tier : 'standard',minutes,duration:minutes*60000,
      players:players.map(id => ({id,home:scene.sections.filter(section => owner[section.id] === id).map(section => section.id),away:false,back:false,
        correct:0,wrong:0,bags:0,served:0,counted:[],learn:[],done:[]})),
      owner,share,seats:Array(seatCount(count)).fill(-1),rooms:Array(fitRooms(count)).fill(-1),
      orders:plan(scene,{seed,minutes,players:count,weak}).map(order => {
        const tpl = scene.tpls[order.tpl];
        return {...order,status:'plan',seat:-1,arrivedAt:-1,leavesAt:-1,hold:-1,
          lines:tpl.want.map((want,index) => ({i:want.i,q:want.q || 1,z:want.z || '',any:Boolean(want.any),hide:Boolean(want.hidden),
            s:tpl.soldout && tpl.soldout.line === index ? 'out' : 'open',got:[],swap:0,was:''})),
          talks:(tpl.talk || []).map(talk => ({k:talk.k,s:'off',ok:-1,by:'',until:0})),
          svc:tpl.svc || '',sv:'none',room:-1,fitAt:-1,queuedAt:-1,tried:false,fit:tpl.fit || 'ok',
          change:tpl.change ? {line:tpl.change.line,to:tpl.change.to || '',q:tpl.change.q || 0,s:'wait'} : null,
          sub:tpl.soldout ? {line:tpl.soldout.line,i:tpl.soldout.sub,accept:Boolean(tpl.soldout.accept)} : null};
      }),
      next:0,t:0,over:false,score:0,served:0,gone:0};
  }

  const seated = state => state.orders.filter(order => order.status === 'wait');
  // A line has what it needs: struck (the customer said no to a substitute) or every piece in the basket, nothing old left.
  const lineDone = line => line.s === 'struck' || (line.s === 'open' && !line.hide && line.got.length >= line.q && line.swap === 0);
  const linesDone = order => order.lines.every(lineDone);
  // The replies before a service are answered (the ones a service brings up come later).
  const talksDone = order => order.talks.every(talk => talk.s === 'done' || (talk.s === 'off' && (talk.k === 'fit' || talk.k === 'till')));
  const complete = order => linesDone(order) && order.talks.every(talk => talk.s === 'done') && (!order.svc || order.sv === 'done');
  // Things out of stock: what a seated customer's order says is sold out (its shelf place stands empty meanwhile).
  function outOfStock(state) {
    const out = [];
    for (const order of seated(state)) {
      if (!order.sub) continue;
      const line = order.lines[order.sub.line], item = line.was || line.i;
      if (!out.includes(item)) out.push(item);
    }
    return out;
  }
  const holds = (state,section,id) => state.owner[section] === id || (state.share?.[section] || []).includes(id);
  const mine = (state,player,item,scene) => holds(state,scene.sectionOf[item],player.id);
  const holder = (state,item,scene) => state.owner[scene.sectionOf[item]] || '';
  function topUp(order,t) {
    if (order.hold < 0) order.leavesAt = Math.max(order.leavesAt,t+Math.floor(order.patience*TALK_FLOOR/100));
  }
  function pause(order,t) { if (order.hold < 0) order.hold = t; }
  function resume(order,t) { if (order.hold >= 0) { order.leavesAt += t-order.hold; order.hold = -1; } }
  function freeSeat(state,order) {
    if (order.seat >= 0 && state.seats[order.seat] === order.n) state.seats[order.seat] = -1;
  }
  // A fitting room just came free: the customer who has waited longest goes in.
  function fillRooms(state,t,events) {
    for (let room = 0; room < state.rooms.length; room++) {
      if (state.rooms[room] >= 0) continue;
      const queued = state.orders.filter(order => order.status === 'wait' && order.sv === 'queue').sort((a,b) => a.queuedAt-b.queuedAt || a.n-b.n)[0];
      if (!queued) return;
      state.rooms[room] = queued.n;
      Object.assign(queued,{sv:'in',room,fitAt:t+FIT_MS});
      events.push({e:'fitin',n:queued.n,room,at:t});
    }
  }
  // The next thing that happens by itself: a fitting ending, a customer leaving, or the next one arriving (who waits
  // while every place at the counter is taken). At the same moment: fittings, then leaving, then arriving.
  function nextEvent(state) {
    let best = null;
    const consider = (kind,rank,at,order) => {
      if (!best || at < best.at || at === best.at && (rank < best.rank || rank === best.rank && order.n < best.order.n)) best = {kind,rank,at,order};
    };
    for (const order of state.orders) {
      if (order.status !== 'wait') continue;
      if (order.sv === 'in' && order.fitAt >= 0) consider('fit',0,order.fitAt,order);
      if (order.hold < 0) consider('leave',1,order.leavesAt,order);
    }
    if (state.next < state.orders.length && state.seats.includes(-1)) {
      const order = state.orders[state.next];
      consider('arrive',2,Math.max(order.at,state.t),order);
    }
    return best;
  }
  // Everything that happens by itself up to time t, in order. In steps or at once, the state comes out the same.
  function advance(state,scene,t) {
    const events = [], limit = Math.min(t,state.duration);
    for (let guard = 0; guard < 1000 && !state.over; guard++) {
      const next = nextEvent(state);
      if (!next || next.at > limit) break;
      state.t = Math.max(state.t,next.at);
      const order = next.order, at = next.at;
      if (next.kind === 'leave') {
        order.status = 'gone';
        freeSeat(state,order);
        for (const talk of order.talks) { talk.by = ''; talk.until = 0; }
        state.gone++;
        events.push({e:'leave',n:order.n,at});
      } else if (next.kind === 'arrive') {
        const seat = state.seats.indexOf(-1);
        state.seats[seat] = order.n;
        Object.assign(order,{status:'wait',seat,arrivedAt:at,leavesAt:at+order.patience});
        for (const talk of order.talks) if (talk.k === 'start' || talk.k === 'soldout') talk.s = 'open';
        state.next++;
        events.push({e:'arrive',n:order.n,seat,at});
      } else if (!order.tried && order.fit !== 'ok') {
        // The first try: too small or too big. The customer stays in the room and says so; the clerk answers.
        order.tried = true;
        order.fitAt = -1;
        const talk = order.talks.find(entry => entry.k === 'fit');
        if (talk) talk.s = 'open';
        events.push({e:'fitres',n:order.n,fit:order.fit,at});
      } else {
        order.tried = true;
        state.rooms[order.room] = -1;
        Object.assign(order,{sv:'done',room:-1,fitAt:-1});
        resume(order,at);
        events.push({e:'fitted',n:order.n,at});
        if (complete(order)) events.push({e:'complete',n:order.n,at});
        fillRooms(state,at,events);
      }
    }
    state.t = Math.max(state.t,limit);
    if (t >= state.duration && !state.over) {
      state.over = true;
      events.push({e:'end',at:state.duration});
    }
    return events;
  }
  // Points for a bag handed over at time t: its pieces, replies and service, and a tip for the patience left.
  function tip(order,t) { return Math.floor(TIP_MAX*Math.max(0,order.leavesAt-t)/order.patience); }
  function points(order) {
    let pieces = 0;
    for (const line of order.lines) if (line.s !== 'struck') pieces += line.q;
    return POINTS_BASE+POINTS_PIECE*pieces+POINTS_TALK*order.talks.length+(order.svc ? POINTS_SERVICE : 0);
  }
  // An answer, right or wrong, with the words it says something about (`words`: [word, 1|0] pairs). A right answer
  // counts once per step (`key`) and only two a second; one that does not count leaves no record either.
  function answer(player,right,key,now,learn,words) {
    if (right) {
      if (key && player.done.includes(key)) return;
      if (key) player.done.push(key);
      const recent = player.counted.filter(at => at > now-COUNT_WINDOW);
      if (recent.length >= COUNT_PER_WINDOW) return;
      recent.push(now);
      player.counted = recent.slice(-COUNT_PER_WINDOW);
      player.correct++;
    } else player.wrong++;
    for (const [word,ok] of words) if (word) { player.learn.push([word,ok]); learn.push([word,ok]); }
  }
  // Does this thing on the shelf fill this line? The very thing, or (when the customer named no colour) the same
  // product in another colour.
  const fills = (scene,line,item) => line.i === item || (line.any && scene.productOf[item] === scene.productOf[line.i] && ['','color'].includes(scene.kindOf[item]) && ['','color'].includes(scene.kindOf[line.i]));
  const sizeFits = (scene,line,item,size) => !scene.sizesOf[item].length || (line.z ? size === line.z : scene.sizesOf[item].includes(size));
  // The lines still waiting for pieces, the order being served first, then whoever came first. (Not a customer
  // trying something on: their basket is in the fitting room.)
  function needing(state,prefer) {
    const list = [];
    for (const order of seated(state).sort((a,b) => (b.n === prefer)-(a.n === prefer) || a.arrivedAt-b.arrivedAt || a.n-b.n)) {
      if (order.sv === 'in' && order.fitAt >= 0) continue;
      order.lines.forEach((line,l) => { if (line.s === 'open' && !line.hide && line.got.length < line.q) list.push({order,line,l}); });
    }
    return list;
  }
  function nextSize(scene,line,dir) {
    const sizes = scene.sizesOf[line.i], at = sizes.indexOf(line.z);
    if (at < 0) return line.z;
    return sizes[Math.max(0,Math.min(sizes.length-1,at+(dir === 'small' ? 1 : -1)))];
  }

  // One action at time `now` (after everything that happened by itself until then). Returns whether it took effect,
  // why not, what happened, and the answers it gave (right or wrong) for the learning record.
  function apply(state,scene,action,now) {
    const events = advance(state,scene,now), learn = [];
    const out = (ok,why = '',more = []) => ({ok,why,events:events.concat(more),learn});
    if (state.over) return out(false,'over');
    const player = state.players.find(entry => entry.id === action.by);
    if (!player) return out(false,'player');
    const order = Number.isInteger(action.c) ? state.orders[action.c] || null : null;
    const here = order && order.status === 'wait' ? order : null;
    const room = state.players.length > 1;
    switch (action.t) {
      case 'pick': {
        const item = action.i, size = typeof action.z === 'string' ? action.z : '';
        if (!scene.sectionOf[item]) return out(false,'invalid');
        // A size only for things that come in sizes, and only one of theirs.
        if (size && !scene.sizesOf[item].includes(size)) return out(false,'invalid');
        if (!seated(state).length) return out(false,'idle');
        if (room && !mine(state,player,item,scene)) return out(false,'notmine');
        if (outOfStock(state).includes(item)) return out(false,'out');
        const wanting = needing(state,here ? here.n : -1);
        const asked = seated(state).some(entry => entry.lines.some(line => line.s === 'open' && !line.hide && fills(scene,line,item)));
        // Nobody is missing anything: a tap is no answer (开饭啦 does the same).
        if (!wanting.length) return out(false,asked ? 'full' : 'ready');
        const exact = wanting.find(entry => fills(scene,entry.line,item) && sizeFits(scene,entry.line,item,size));
        if (exact) {
          const {order:target,line,l} = exact;
          // One answer per piece of the line (a new size after a fitting is a new piece): another colour or another size
          // string on the same piece earns nothing more.
          answer(player,true,`p${target.n}.${l}.${line.got.length}.${size}`,now,learn,
            [[productWord(scene,item),1],[line.any ? '' : colorWord(scene.colorOf[item]),1]]);
          line.got.push(size);
          // A new piece in place of an old one (another colour, another size): the old one goes back by itself.
          const more = [{e:'pick',n:target.n,l,i:item,z:size,swapped:line.swap,by:player.id}];
          line.swap = 0;
          if (target.sv === 'in' && target.fitAt < 0 && target.tried) target.fitAt = now+FIT_AGAIN_MS;
          // A customer who will change their mind does so once, when that thing is in the basket.
          const change = target.change;
          if (change && change.s === 'wait' && change.line === l && line.got.length >= line.q && target.sv === 'none') {
            change.s = 'done';
            if (change.to) { line.was = line.i; line.i = change.to; line.swap = line.got.length; line.got = []; }
            if (change.q) {
              const back = Math.max(0,line.got.length-change.q);
              line.got = line.got.slice(0,change.q);
              line.q = change.q;
              if (back) more.push({e:'return',n:target.n,l,count:back});
            }
            more.push({e:'change',n:target.n,l});
            topUp(target,now);
          }
          if (linesDone(target)) more.push({e:'filled',n:target.n});
          if (complete(target)) more.push({e:'complete',n:target.n});
          return out(true,'',more);
        }
        // The right product in the wrong colour, size or pack: the product was known, the detail was not.
        const near = wanting.find(entry => scene.productOf[entry.line.i] === scene.productOf[item]);
        if (near) {
          const {order:target,line,l} = near, colour = !line.any && scene.colorOf[item] !== scene.colorOf[line.i];
          const what = colour ? 'color' : fills(scene,line,item) ? 'size' : 'kind';
          if (what === 'size' && !size) return out(false,'size');
          answer(player,false,'',now,learn,[[productWord(scene,item),1],[colour ? colorWord(scene.colorOf[line.i]) : '',0]]);
          return out(false,'attr',[{e:'attr',n:target.n,l,i:item,z:size,want:line.i,wz:line.z,what,by:player.id}]);
        }
        // Enough of it already in the basket: no answer.
        if (asked) return out(false,'full');
        answer(player,false,'',now,learn,[[productWord(scene,item),0]]);
        const first = wanting[0];
        return out(false,'wrong',[{e:'wrong',n:first.order.n,l:first.l,i:item,want:first.line.i,by:player.id}]);
      }
      case 'open': {
        if (!here) return out(false,'gone');
        const talk = here.talks[action.k];
        if (!talk || talk.s !== 'open') return out(false,'closed');
        if (talk.by && talk.by !== player.id && talk.until > now) return out(false,'claimed');
        talk.by = player.id;
        talk.until = now+TALK_HOLD;
        return out(true,'',[{e:'open',n:here.n,k:action.k,by:player.id}]);
      }
      case 'say': {
        if (!here) return out(false,'gone');
        const talk = here.talks[action.k];
        if (!talk || talk.s !== 'open') return out(false,'closed');
        if (talk.by && talk.by !== player.id && talk.until > now) return out(false,'claimed');
        if (!Number.isInteger(action.o) || action.o < 0 || action.o > 2) return out(false,'invalid');
        const right = action.o === 0;
        answer(player,right,`s${here.n}.${action.k}`,now,learn,[[talkWord(here,action.k),right ? 1 : 0]]);
        Object.assign(talk,{s:'done',ok:right ? 1 : 0,by:player.id,until:0});
        const more = [{e:'say',n:here.n,k:action.k,ok:right ? 1 : 0,by:player.id}];
        // Whatever was chosen, the conversation goes on the right way (a wrong reply is a miss, not a new story).
        if (talk.k === 'start') for (const line of here.lines) line.hide = false;
        if (talk.k === 'soldout' && here.sub) {
          const line = here.lines[here.sub.line];
          line.was = line.i;
          if (here.sub.accept) { line.i = here.sub.i; line.s = 'open'; } else line.s = 'struck';
        }
        if (talk.k === 'fit') {
          const line = here.lines.find(entry => scene.sizesOf[entry.i].length) || here.lines[0];
          line.z = nextSize(scene,line,here.fit);
          line.swap = line.got.length;
          line.got = [];
        }
        if (talk.k === 'till') here.sv = 'done';
        if (complete(here)) more.push({e:'complete',n:here.n});
        return out(true,'',more);
      }
      case 'fit': case 'till': {
        if (!here) return out(false,'gone');
        if (here.svc !== action.t) return out(false,'noservice');
        if (here.sv !== 'none') return out(false,'busy');
        if (!linesDone(here) || !talksDone(here)) return out(false,'notready');
        if (action.t === 'till') {
          here.sv = 'in';
          const talk = here.talks.find(entry => entry.k === 'till');
          if (talk) talk.s = 'open';
          topUp(here,now);
          return out(true,'',[{e:'till',n:here.n,by:player.id}]);
        }
        pause(here,now);
        const room = state.rooms.indexOf(-1);
        if (room < 0) {
          Object.assign(here,{sv:'queue',queuedAt:now});
          return out(true,'',[{e:'fitq',n:here.n,by:player.id}]);
        }
        state.rooms[room] = here.n;
        Object.assign(here,{sv:'in',room,fitAt:now+FIT_MS});
        return out(true,'',[{e:'fitin',n:here.n,room,by:player.id}]);
      }
      case 'give': {
        if (!here) return out(false,'gone');
        if (!complete(here)) return out(false,'incomplete');
        const earned = points(here), extra = tip(here,now);
        state.score += earned+extra;
        state.served++;
        here.status = 'served';
        here.servedAt = now;
        freeSeat(state,here);
        player.served++;
        for (const entry of state.players) if (!entry.away) entry.bags++;
        for (const entry of state.players) {
          if (!entry.back) continue;
          for (const section of entry.home) state.owner[section] = entry.id;
          entry.back = false;
        }
        return out(true,'',[{e:'serve',n:here.n,points:earned,tip:extra,by:player.id}]);
      }
      case 'back': {
        if (!here) return out(false,'gone');
        const line = here.lines[action.l];
        if (!line || here.sv === 'in' || here.sv === 'queue') return out(false,'busy');
        let item = line.i;
        if (line.swap > 0) { line.swap--; item = line.was || line.i; }
        else if (line.got.length) line.got.pop();
        else return out(false,'empty');
        return out(true,'',[{e:'back',n:here.n,l:action.l,i:item,by:player.id}]);
      }
      case 'miss': case 'call': {
        // A shout for a thing on a classmate's section, picked out of four product words.
        if (!here) return out(false,'gone');
        const line = here.lines[action.l];
        if (!line || line.s !== 'open' || line.hide || line.got.length >= line.q) return out(false,'full');
        const wanted = scene.productOf[line.i], right = action.t === 'call' && action.i === wanted;
        if (right && mine(state,player,line.i,scene)) return out(false,'mine');
        answer(player,right,right ? `c${here.n}.${action.l}` : '',now,learn,[[`m-${wanted}`,right ? 1 : 0]]);
        if (!right) return out(false,'wrong',[{e:'wrong',n:here.n,l:action.l,i:'',want:line.i,by:player.id}]);
        return out(true,'',[{e:'call',n:here.n,l:action.l,i:line.i,by:player.id,to:holder(state,line.i,scene)}]);
      }
      case 'chat':
        if (!CHATS.includes(action.w)) return out(false,'invalid');
        return out(true,'',[{e:'chat',w:action.w,by:player.id}]);
      case 'away': {
        if (player.away) return out(false,'same');
        player.away = true; player.back = false;
        lend(state,scene,player);
        for (const entry of state.orders) for (const talk of entry.talks) if (talk.by === player.id && talk.s === 'open') { talk.by = ''; talk.until = 0; }
        return out(true,'',[{e:'away',by:player.id}]);
      }
      case 'home': {
        if (!player.away) return out(false,'same');
        player.away = false; player.back = true;
        for (const absent of state.players) if (absent.away) lend(state,scene,absent);
        return out(true,'',[{e:'home',by:player.id}]);
      }
      default:
        return out(false,'invalid');
    }
  }
  // A clerk whose connection dropped: their sections go, one by one, to a helper there or whoever online keeps fewest.
  function lend(state,scene,player) {
    for (const section of scene.sections) {
      if (state.owner[section.id] !== player.id) continue;
      const helping = (state.share?.[section.id] || []).filter(id => id !== player.id && state.players.some(other => other.id === id && !other.away));
      let best = null;
      for (const other of state.players) {
        if (other.away || other === player || helping.length && !helping.includes(other.id)) continue;
        const held = scene.sections.filter(entry => state.owner[entry.id] === other.id).length;
        if (!best || held < best.held) best = {player:other,held};
      }
      if (best) state.owner[section.id] = best.player.id;
    }
  }

  // A tier's target: the theme's target scaled to the game's length, then its tier's share.
  const targetFor = (theme,minutes,tier = 'novice') => Math.floor(Math.round(theme.target*minutes/DEFAULT_MINUTES)*(TIER_TARGET[tier] ?? 100)/100);
  function stars(passed) {
    let count = 0;
    for (const bit of [1,2,4]) { if (!(Number.isInteger(passed) && passed & bit)) break; count++; }
    return count;
  }
  const tierOpen = (count,tier) => tier === 'novice' || (tier === 'standard' && count >= 1) || (tier === 'expert' && count >= 2);
  function passes(score,target,correct,wrong,room) {
    if (score < target) return false;
    if (!room) return true;
    const answers = correct+wrong;
    return answers >= ROOM_MIN_ANSWERS && correct*100 >= ROOM_ACCURACY*answers;
  }
  // Which themes are open for business, from the stars of each theme (`starsOf`, theme id → 0…3) and the themes the
  // server already counts as open (`kept`; nothing once opened closes again). On the first floor each shop's first
  // theme is open; a theme at two stars opens the next of its shop; a floor whose shops' core themes are all at two
  // stars opens the first theme of every shop one floor up.
  function openThemes(data,starsOf = {},kept = []) {
    const open = new Set(kept), floors = [...data.floors].sort((a,b) => a.n-b.n);
    const shop = id => data.shops.find(entry => entry.id === id);
    const done = id => (starsOf[id] || 0) >= UNLOCK_STARS;
    for (let index = 0; index < floors.length; index++) {
      const floor = floors[index];
      const reached = index === 0 || floor.shops.some(id => open.has(shop(id)?.themes?.[0])) || floors[index-1].shops.every(id => (shop(id)?.core || []).every(done));
      if (!reached) continue;
      for (const id of floor.shops) {
        const themes = shop(id)?.themes || [];
        if (themes.length) open.add(themes[0]);
        for (let at = 1; at < themes.length; at++) if (done(themes[at-1]) || open.has(themes[at])) open.add(themes[at]);
      }
    }
    return open;
  }
  function masteryStep(record,right,day) {
    const next = {correct:0,wrong:0,days:0,lastDay:'',lastOk:false,sinceMiss:0,relapsed:false,mastered:false,...record};
    if (right) {
      next.correct++; next.sinceMiss++;
      if (day > next.lastDay) { next.days++; next.lastDay = day; }
      next.lastOk = true;
    } else {
      next.wrong++; next.sinceMiss = 0; next.lastOk = false;
      if (next.mastered) next.relapsed = true;
    }
    next.mastered = next.relapsed ? next.sinceMiss >= 2 : next.correct >= 3 && next.days >= 2 && next.lastOk;
    if (next.mastered) next.relapsed = false;
    return next;
  }
  const xpFor = (state,player) => Math.min(GAME_XP_CAP,player.correct*(TIERS[state.tier]?.xp || 0)+BAG_XP*player.bags);
  // Four product words for a shout: the one needed and three from the classmates' sections.
  function distractors(scene,product,mineList,seed) {
    const random = rng(seed ^ hashText(product));
    const others = scene.products.filter(entry => entry !== product && !mineList.includes(entry));
    const chosen = [];
    while (chosen.length < 3 && others.length) chosen.push(others.splice(pick(random,others.length),1)[0]);
    chosen.splice(pick(random,chosen.length+1),0,product);
    return chosen;
  }
  function hashText(text) {
    let hash = 2166136261;
    for (const char of String(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash,16777619) >>> 0; }
    return hash >>> 0;
  }
  // 今日营业: one shop for everyone, drawn from the day's seed, with the orders of all its themes (none sold out:
  // the shelves of a day's shop are full).
  function dailyTheme(data,seed) {
    const random = rng(seed), shops = data.shops.filter(shop => shop.themes.length);
    const shop = shops[pick(random,shops.length)];
    const themes = shop.themes.map(id => data.themes.find(theme => theme.id === id)).filter(Boolean);
    const orders = [];
    for (const theme of themes) for (const tpl of theme.orders) if (!tpl.soldout) orders.push({...tpl,must:false});
    return {id:'daily',shop:shop.id,no:'Dagens vakt',zh:'今日营业',order:0,core:false,note:'',fresh:[],
      target:Math.round(themes.reduce((sum,theme) => sum+theme.target,0)/Math.max(1,themes.length)),orders};
  }

  // A game played alone goes to the server as its seed and its actions; the server plays it again to score it.
  const CODES = {pick:'p',say:'s',fit:'f',till:'k',give:'g',back:'b',miss:'m',chat:'h'};
  const NAMES = Object.fromEntries(Object.entries(CODES).map(([name,code]) => [code,name]));
  function packLog(scene,actions) {
    let last = 0;
    return actions.map(action => {
      const dt = action.at-last; last = action.at;
      const code = CODES[action.t], c = Number.isInteger(action.c) ? action.c : -1;
      switch (action.t) {
        case 'pick': return [dt,code,scene.items.indexOf(action.i),SIZES.indexOf(action.z || ''),c];
        case 'say': return [dt,code,c,action.k,action.o];
        case 'fit': case 'till': case 'give': return [dt,code,c];
        case 'back': return [dt,code,c,action.l];
        case 'miss': return [dt,code,c,action.l,scene.products.indexOf(action.i)];
        case 'chat': return [dt,code,CHATS.indexOf(action.w)];
        default: return null;
      }
    }).filter(Boolean);
  }
  function unpackLog(scene,log) {
    let at = 0;
    const actions = [];
    for (const entry of Array.isArray(log) ? log : []) {
      if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || entry[0] < 0 || !NAMES[entry[1]]) return null;
      const args = entry.slice(2);
      if (!args.every(Number.isInteger)) return null;
      at += entry[0];
      const t = NAMES[entry[1]];
      const action = t === 'pick' ? {t,i:scene.items[args[0]] || '',z:SIZES[args[1]] || '',...(args[2] >= 0 ? {c:args[2]} : {})}
        : t === 'say' ? {t,c:args[0],k:args[1],o:args[2]} : t === 'back' ? {t,c:args[0],l:args[1]}
        : t === 'miss' ? {t,c:args[0],l:args[1],i:scene.products[args[2]] || ''} : t === 'chat' ? {t,w:CHATS[args[0]] || ''} : {t,c:args[0]};
      actions.push({...action,at});
    }
    return actions;
  }
  // The weak words of a game as a hex bitmask over the theme's words.
  function themeWords(scene) {
    const words = [];
    for (const id of scene.tplList) for (const word of tplWords(scene,scene.tpls[id])) if (!words.includes(word)) words.push(word);
    return words;
  }
  function packWeak(scene,weak) {
    const bits = themeWords(scene).map(word => weak.includes(word) ? 1 : 0);
    let hex = '';
    for (let index = 0; index < bits.length; index += 4) hex += ((bits[index] << 3) | ((bits[index+1] || 0) << 2) | ((bits[index+2] || 0) << 1) | (bits[index+3] || 0)).toString(16);
    return hex;
  }
  function unpackWeak(scene,hex) {
    const weak = [];
    if (typeof hex !== 'string' || !/^[0-9a-f]*$/.test(hex)) return weak;
    themeWords(scene).forEach((word,index) => { const digit = parseInt(hex[index >> 2] || '0',16); if (digit & (8 >> (index & 3))) weak.push(word); });
    return weak;
  }
  function replay(scene,header,actions) {
    const state = newMatch(scene,{seed:header.seed,minutes:header.minutes,tier:header.tier,players:['me'],round:0,weak:header.weak || []});
    for (const action of actions) apply(state,scene,{...action,by:'me'},action.at);
    advance(state,scene,state.duration);
    return state;
  }
  function publicView(state,me = '') {
    return {...state,players:state.players.map(player => player.id === me ? player : {...player,learn:[],done:[],counted:[]})};
  }

  // A computer clerk for tests and for setting each theme's ★ target: one step every `think` ms; a careless one taps
  // at random. Plays alone and returns the finished state.
  function simulate(scene,{seed = 1,minutes = DEFAULT_MINUTES,think = 2000,careless = false,tier = 'standard'} = {}) {
    const state = newMatch(scene,{seed,minutes,tier,players:['bot']}), random = rng(seed ^ 0x5bd1e995);
    for (let now = 0; now < state.duration; now += think) {
      advance(state,scene,now);
      if (state.over) break;
      const action = careless ? randomAction(state,scene,random) : botAction(state,scene);
      if (action) apply(state,scene,{...action,by:'bot'},now);
    }
    advance(state,scene,state.duration);
    return state;
  }
  function botAction(state,scene) {
    const here = seated(state).sort((a,b) => a.arrivedAt-b.arrivedAt || a.n-b.n);
    const done = here.find(complete);
    if (done) return {t:'give',c:done.n};
    for (const order of here) {
      const k = order.talks.findIndex(talk => talk.s === 'open');
      if (k >= 0) return {t:'say',c:order.n,k,o:0};
    }
    for (const order of here) if (order.svc && order.sv === 'none' && linesDone(order) && talksDone(order)) return {t:order.svc,c:order.n};
    const out = outOfStock(state);
    for (const {order,line} of needing(state,-1)) {
      if (line.got.length >= line.q && line.swap === 0) continue;
      if (out.includes(line.i)) continue;
      return {t:'pick',i:line.i,z:scene.sizesOf[line.i].length ? line.z || scene.sizesOf[line.i][0] : '',c:order.n};
    }
    return null;
  }
  function randomAction(state,scene,random) {
    const here = seated(state);
    if (!here.length) return null;
    const order = here[pick(random,here.length)], item = scene.items[pick(random,scene.items.length)];
    switch (pick(random,4)) {
      case 0: case 1: return {t:'pick',i:item,z:scene.sizesOf[item].length ? scene.sizesOf[item][pick(random,scene.sizesOf[item].length)] : '',c:order.n};
      case 2: return order.talks.length ? {t:'say',c:order.n,k:pick(random,order.talks.length),o:pick(random,3)} : {t:'give',c:order.n};
      default: return order.svc ? {t:order.svc,c:order.n} : {t:'give',c:order.n};
    }
  }
  /* ---------- End of the rules ---------- */
  const RULES = {TIERS,TIER_IDS,TIER_TARGET,UNLOCK_STARS,MINUTES,DEFAULT_MINUTES,SIZES,CHATS,ACTIONS,rng,pick,themeRules,productWord,colorWord,talkWord,tplWords,
    plan,sections,crew,newMatch,advance,apply,complete,linesDone,lineDone,talksDone,needing,fills,sizeFits,outOfStock,holds,mine,tip,points,targetFor,stars,tierOpen,passes,
    openThemes,masteryStep,xpFor,distractors,hashText,dailyTheme,packLog,unpackLog,themeWords,packWeak,unpackWeak,replay,publicView,simulate,botAction,randomAction,seatCount,fitRooms};

  /* ---------- Overlay state ---------- */
  const ui = {open:false,opts:{},root:null,content:null,view:'building',prefs:null,timers:new Set(),sfx:{context:null},game:null,data:null,lexicon:null,
    manifest:{images:{}},kitchenArt:{images:{}},place:{floor:1,shop:'',page:'disken',section:{}},sheet:null,daily:null,dailyTab:'solo'};
  const $ = selector => ui.root?.querySelector(selector) || null;
  const e = value => (ui.opts.escapeHTML || (text => String(text ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))))(value);
  const versioned = path => `${path}${ui.opts.version ? `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(ui.opts.version)}` : ''}`;
  const later = (fn,ms) => { const id = setTimeout(() => { ui.timers.delete(id); fn(); },ms); ui.timers.add(id); return id; };
  const reduceMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const beijingDay = (ms = Date.now()) => new Date(ms+8*3600000).toISOString().slice(0,10);
  const ICONS = {
    close:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back:'<path d="M14.5 6 8.5 12l6 6"/>',
    next:'<path d="m9.5 6 6 6-6 6"/>',
    sound:'<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4M18.3 6a8.6 8.6 0 0 1 0 12"/>',
    mute:'<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    speaker:'<path d="M10.5 6 6.5 9.5h-3v5h3l4 3.5z"/><path d="M14.6 9.4a3.8 3.8 0 0 1 0 5.2M17.2 7a7.2 7.2 0 0 1 0 10"/>',
    wave:'<path d="M4 12h1.5M7.5 9v6M11 6.5v11M14.5 9v6M18 10.5v3M20.5 12H20"/>',
    lock:'<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    star:'<path d="m12 4.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>',
    check:'<path d="m5.5 12.5 4 4 9-9"/>',
    plus:'<path d="M12 5.5v13M5.5 12h13"/>',
    search:'<circle cx="10.8" cy="10.8" r="5.8"/><path d="m15.2 15.2 4.6 4.6"/>',
    chat:'<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-8l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z"/>',
    people:'<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="9.5" r="2.5"/><path d="M3.5 19a5 5 0 0 1 10 0M13.5 15.2a4.5 4.5 0 0 1 7 3.8"/>',
    counter:'<path d="M3.5 13.5h17v6h-17zM6 13.5V9.5h12v4M9 9.5V6.5h6v3"/>',
    shelf:'<path d="M4.5 4.5v15M19.5 4.5v15M4.5 9.5h15M4.5 14.5h15M4.5 19.5h15"/><path d="M7 9.5V7h3v2.5M13 14.5v-3h2.5v3"/>',
    door:'<path d="M6.5 20.5V4.5h11v16M4 20.5h16"/><path d="M14.5 12.5h.01"/>',
    hanger:'<path d="M12 7.5a2 2 0 1 1 2-2M12 7.5v1.5L3.5 15h17L12 9"/>',
    till:'<rect x="4" y="11" width="16" height="8.5" rx="1.6"/><path d="M7 11V6.5h10V11M9.5 15h5"/>',
    bag:'<path d="M5.5 8.5h13l-1 11.5h-11zM9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    calendar:'<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    book:'<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H18v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H18v-3"/>',
    elevator:'<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="m9 9 3-3 3 3M9 15l3 3 3-3"/>',
  };
  const icon = name => `<svg class="ml-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.shelf}</svg>`;
  const button = (action,text,kind = '',extra = '') => `<button type="button" class="ml-button ${kind}" data-ml="${action}" ${extra}>${text}</button>`;

  /* ---------- Placeholder pictures: a drawn shape in the thing's colour, never its name. Used until the
     illustrators' pictures arrive (dist/assets/mall/manifest.json). ---------- */
  const SHAPE_PATHS = {
    bottle:'<path d="M26 5h12v6H26z" class="k"/><path d="M27 11h10v6c5 2 7 5 7 9v28a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V26c0-4 2-7 7-9z"/><path d="M24 30h16v14H24z" class="l"/>',
    pump:'<path d="M30 9h12v4h-8v6h-4z" class="k"/><path d="M27 19h10v5H27z" class="k"/><path d="M21 24h22v31a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4z"/><path d="M25 34h14v12H25z" class="l"/>',
    tube:'<path d="M20 6h24l-3 6H23z" class="l"/><path d="M23 12h18l-3 36H26z"/><path d="M27 48h10v8H27z" class="k"/>',
    brush:'<path d="M14 54 44 12l5 3.5L20 57.5z"/><path d="M42 6l10 7-4 6-10-7z" class="l"/><path d="M41 8l-2 3M45 10l-2 3M49 13l-2 3" class="s"/>',
    hairbrush:'<ellipse cx="38" cy="20" rx="13" ry="16" transform="rotate(30 38 20)"/><path d="M30 31 14 56l5 3 15-25z" class="k"/><path d="M34 13h.1M40 16h.1M37 22h.1M43 25h.1M31 19h.1" class="s"/>',
    comb:'<path d="M8 22h48v9H8z"/><path d="M11 31v14M15 31v14M19 31v14M23 31v14M27 31v14M31 31v14M35 31v14M39 31v14M43 31v14M47 31v14M51 31v14" class="s"/>',
    tie:'<circle cx="25" cy="32" r="11" class="ring"/><circle cx="39" cy="32" r="11" class="ring"/>',
    bar:'<rect x="12" y="22" width="40" height="22" rx="10"/><path d="M20 28c4-2 9-2 13-1" class="s"/>',
    jar:'<path d="M17 16h30v8H17z" class="k"/><rect x="15" y="24" width="34" height="28" rx="6"/><path d="M19 32h26v10H19z" class="l"/>',
    stick:'<path d="M24 8h16v10H24z" class="k"/><rect x="22" y="18" width="20" height="38" rx="5"/><path d="M26 28h12v14H26z" class="l"/>',
    cloth:'<path d="M16 20h32v24H16z"/><path d="M16 40h32" class="s"/><path d="M16 24h32" class="s"/>',
    towel:'<path d="M12 22h40v20H12z"/><path d="M12 32h40" class="s"/><path d="M12 37h40v5H12z" class="l"/>',
    towelbig:'<path d="M8 16h48v14H8z"/><path d="M8 30h48v14H8z"/><path d="M8 44h48v6H8z" class="l"/><path d="M8 30h48M8 44h48" class="s"/>',
    roll:'<ellipse cx="32" cy="18" rx="16" ry="6" class="l"/><path d="M16 18v28c0 3.3 7.2 6 16 6s16-2.7 16-6V18c0 3.3-7.2 6-16 6s-16-2.7-16-6z"/><ellipse cx="32" cy="18" rx="5" ry="2" class="k"/>',
    pack:'<rect x="12" y="14" width="40" height="38" rx="6"/><rect x="20" y="22" width="24" height="16" rx="3" class="l"/><path d="M12 44h40" class="s"/>',
    box:'<path d="M14 20h36v34H14z"/><path d="M12 14h40v8H12z" class="k"/><path d="M22 32h20v10H22z" class="l"/>',
    razor:'<path d="M30 24h4l2 34h-8z" class="k"/><path d="M18 10h28v14H18z"/><path d="M20 14h24" class="s"/>',
    clipper:'<path d="M12 30c8-6 30-6 40 0-10 4-32 4-40 0z"/><path d="M14 32c8 5 30 5 38 1" class="s"/><circle cx="18" cy="30" r="3" class="k"/>',
    file:'<path d="M14 50 46 14l4 4-32 36z"/><path d="M20 42l18-20" class="s"/>',
    card:'<rect x="16" y="8" width="32" height="48" rx="4" class="l"/><circle cx="32" cy="14" r="2.5" class="k"/><rect x="22" y="24" width="20" height="24" rx="3"/>',
    shoe:'<path d="M8 40c6 0 12-4 16-12 6 4 14 6 22 6 6 0 10 4 10 10v4H8z"/><path d="M8 48h48" class="s"/>',
    tee:'<path d="M22 10h20l12 8-6 9-6-4v31H22V23l-6 4-6-9z"/><path d="M27 10c2 4 8 4 10 0" class="s"/>',
    sweater:'<path d="M22 10h20l10 6 4 32h-7l-4-24v30H19V24l-4 24H8l4-32z"/><path d="M27 10c2 4 8 4 10 0M19 50h26" class="s"/>',
    hoodie:'<path d="M24 6c2-2 14-2 16 0l4 6 8 4 4 32h-7l-4-24v30H19V24l-4 24H8l4-32 8-4z"/><path d="M26 8c0 8 12 8 12 0M28 30h8v8h-8z" class="s"/>',
    cardigan:'<path d="M22 10h20l10 6 4 32h-7l-4-24v30H19V24l-4 24H8l4-32z"/><path d="M27 10l5 14 5-14M32 24v30" class="s"/><path d="M32 30h.1M32 38h.1M32 46h.1" class="s"/>',
    trousers:'<path d="M20 8h24l2 48h-9l-5-34-5 34h-9z"/><path d="M20 13h24" class="s"/>',
    shorts:'<path d="M18 14h28l4 26H35l-3-14-3 14H14z"/><path d="M18 19h28" class="s"/>',
    skirt:'<path d="M22 12h20l10 40H12z"/><path d="M22 17h20" class="s"/>',
    dress:'<path d="M25 6h14l2 6-3 12 14 32H12l14-32-3-12z"/><path d="M24 24h16" class="s"/>',
    jacket:'<path d="M22 8h20l10 6 4 34h-7l-3-22v30H18V26l-3 22H8l4-34z"/><path d="M32 12v44M26 8l6 8 6-8" class="s"/>',
    coat:'<path d="M22 6h20l10 6 4 40h-7l-3-26v34H18V26l-3 26H8l4-40z"/><path d="M32 10v50M24 34h4M36 34h4" class="s"/>',
    raincoat:'<path d="M24 4c2-2 14-2 16 0l3 6 9 4 4 38h-7l-3-26v34H18V26l-3 26H8l4-38 9-4z"/><path d="M32 12v48M26 6c0 8 12 8 12 0" class="s"/><path d="M32 20h.1M32 30h.1M32 40h.1" class="s"/>',
    suit:'<path d="M22 6h20l8 5 3 24h-6l-2-14v15H19V21l-2 14h-6l3-24z"/><path d="M21 36h22l2 22h-8l-5-15-5 15h-8z" class="k"/><path d="M27 6l5 10 5-10" class="s"/>',
    shirt:'<path d="M22 10h20l10 6 4 32h-7l-4-24v30H19V24l-4 24H8l4-32z"/><path d="M26 10l6 6 6-6M32 16v38" class="s"/><path d="M34 22h.1M34 30h.1M34 38h.1M34 46h.1" class="s"/>',
    blazer:'<path d="M22 8h20l10 6 4 34h-7l-3-22v30H18V26l-3 22H8l4-34z"/><path d="M25 8l7 18 7-18M32 26v30" class="s"/><path d="M35 34h.1M35 42h.1" class="s"/>',
    swim:'<path d="M24 6h4l4 10 4-10h4l2 24-4 24H26l-4-24z"/><path d="M24 30h16" class="s"/>',
  };
  const TINTS = ['#c9b38a','#9fb5a9','#b8a4c2','#d4a68f','#a8b9cb','#c8bf98','#b4c6ae','#d3b7a6','#a9b0c9','#cdb2b9'];
  const hashOf = text => { let hash = 0; for (const char of String(text)) hash = (hash*31+char.codePointAt(0)) >>> 0; return hash; };
  const itemOf = id => ui.data?.items?.[id] || null;
  const entryOf = id => ui.lexById?.get(id) || null;
  const productEntry = id => entryOf(`m-${itemOf(id)?.p || id}`);
  const artURL = (id,small = true) => {
    const version = ui.manifest.images?.[id];
    return version ? versioned(`assets/mall/${id}${small ? '.sm' : ''}.webp`).replace(/v=[^&]*/,`v=${encodeURIComponent(version)}`) : '';
  };
  // 开饭啦's pictures (customers, and the tableware the catalogue reuses: data `art`, e.g. "tool/kopp").
  const kitchenURL = key => { const version = ui.kitchenArt.images?.[key]; return version ? versioned(`assets/kitchen/${key}.webp`).replace(/v=[^&]*/,`v=${encodeURIComponent(version)}`) : ''; };
  // Large pictures where the screen needs them (scenes, the building): wider than a phone's small version.
  const wide = () => { try { return window.innerWidth*(window.devicePixelRatio || 1) > 1100; } catch { return false; } };
  // A thing's picture: the illustration once it is imported (512 px on the word card, 256 px elsewhere), else its
  // drawn shape in its own colour.
  function pic(id,cls = '') {
    const item = itemOf(id);
    if (!item) return `<span class="ml-pic ${cls}" aria-hidden="true"></span>`;
    const small = !/\bis-large\b/.test(cls);
    const art = item.art ? kitchenURL(item.art) : artURL(`product/${id}`,small) || artURL(`product/${item.p}`,small);
    if (art) return `<span class="ml-pic is-art ${cls}" aria-hidden="true"><img src="${e(art)}" alt="" loading="lazy" decoding="async"></span>`;
    const color = item.color ? ui.data.colors[item.color]?.hex : TINTS[hashOf(item.p) % TINTS.length];
    const scale = item.v === 'size' ? (/small|travel|liten/.test(id) ? .76 : 1.08) : 1;
    const many = item.v === 'pack' ? `<g class="n">${Array.from({length:Math.min(4,Number.parseInt(item.label,10) || 2)},(_,i) => `<circle cx="${22+i*7}" cy="58" r="2.2"/>`).join('')}</g>` : '';
    return `<span class="ml-pic is-drawn ${cls}" aria-hidden="true" style="--ml-tint:${color}"><svg viewBox="0 0 64 64"><g style="transform:scale(${scale});transform-origin:32px 40px">${SHAPE_PATHS[item.shape] || SHAPE_PATHS.box}</g>${many}</svg></span>`;
  }
  // A customer, from 开饭啦's cast (same people, same pictures).
  const customerOf = id => (ui.data?.customers || []).find(person => person.id === id) || {id,name:'',voice:'f'};
  function faceHTML(id,mood = 'neutral',cls = '') {
    const key = `customer/${id}-${mood}`, version = ui.kitchenArt.images?.[key] || ui.kitchenArt.images?.[`customer/${id}-neutral`];
    const src = version ? versioned(`assets/kitchen/${ui.kitchenArt.images?.[key] ? key : `customer/${id}-neutral`}.webp`).replace(/v=[^&]*/,`v=${encodeURIComponent(version)}`) : '';
    return src ? `<span class="ml-face ${cls}" aria-hidden="true"><img src="${e(src)}" alt="" decoding="async"></span>`
      : `<span class="ml-face is-drawn ${cls}" aria-hidden="true" style="--ml-tint:${TINTS[hashOf(id) % TINTS.length]}"><svg viewBox="0 0 64 64"><circle cx="32" cy="22" r="11"/><path d="M12 62c2-14 10-22 20-22s18 8 20 22z"/></svg></span>`;
  }
  const nameOfCustomer = id => customerOf(id).name || '';
  const initial = name => String(name || '?').trim().slice(0,1).toUpperCase();

  /* ---------- Words ---------- */
  // The Norwegian of a thing as it hangs on its price tag: the word, its article in grey.
  function wordHTML(id,{article = true} = {}) {
    const item = productEntry(id);
    if (!item) return '';
    const art = article && ['en','ei','et'].includes(item.article) ? `<small class="ml-art">${item.article}</small>` : '';
    return `<span class="ml-word" lang="nb">${art}${e(item.word)}</span>`;
  }
  const zhOf = id => { const item = productEntry(id); return item ? L10N.gloss({...item,meaning:item.zh}).split(/；|; /)[0] : ''; };
  const colorZh = id => { const item = itemOf(id); return item?.color && ui.data.colors[item.color] ? ui.data.colors[item.color].zh : ''; };
  // A colour in front of a thing: 黄色毛巾, a yellow towel.
  const colorBefore = id => { const color = colorZh(id); return color && L10N.english ? `${color} ` : color; };
  // What a variant adds to its product: its colour, or what its label says (容量、件数).
  function variantNote(id) {
    const item = itemOf(id);
    if (!item) return '';
    if (item.v === 'color' || (item.color && (ui.data.items[item.p] && Object.values(ui.data.items).some(other => other.p === item.p && other.v === 'color')))) return ui.data.colors[item.color]?.no || '';
    return item.label || '';
  }
  // The shopping list's words for one line (scripts/build_mall.py composes the same text for its recording).
  function phrase(id,q,any,size) {
    const item = itemOf(id);
    if (!item) return '';
    const forms = any || !item.npc ? item.np : item.npc;
    const text = q === 1 ? forms[0] : forms[1].replace('{n}',ui.data.numbers[String(q)] || String(q));
    return text+(size ? ` i ${sizeWord(size)}` : '');
  }
  // How a size is said: S is small; a shoe size 39 is størrelse 39 (scripts/build_mall.py size_word).
  function sizeWord(size) {
    return /^\d+$/.test(size) ? `størrelse ${size}` : ui.data.sizeWords[size] || size;
  }
  // A sentence's recording is audio/mall/<sha256(voice|rate|text)[:20]>.mp3 (scripts/build_mall.py, generate_mall_audio.py):
  // worked out here, once per sentence, and kept. The clerk speaks in one voice; customers in their own.
  const lineHashes = new Map();
  function lineAudio(text,voice) {
    const key = `${voice}|${text}`;
    const known = lineHashes.get(key);
    return typeof known === 'string' ? known : '';
  }
  async function lineURL(text,voice) {
    const key = `${voice}|${text}`;
    if (lineHashes.has(key)) return lineHashes.get(key);
    const speech = ui.data?.speech, name = speech?.voices?.[voice];
    if (!name || !globalThis.crypto?.subtle || !globalThis.TextEncoder) return '';
    const pending = crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${name}|${speech.rate}|${text}`)).then(buffer => {
      const hex = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2,'0')).join('').slice(0,20);
      const url = `audio/mall/${hex}.mp3`;
      lineHashes.set(key,url);
      return url;
    }).catch(() => { lineHashes.delete(key); return ''; });
    lineHashes.set(key,pending);
    return pending;
  }
  // Customer lines are recorded in both voices; the clerk's replies and the shopping list in the clerk's voice only.
  const clerkVoice = () => ui.data?.speech?.clerk || 'f';
  // The Chinese of one line of the list: 两条 黄色 毛巾.
  function phraseZh(id,q,any,size) {
    const count = q === 1 ? '' : `${q} × `;
    return `${count}${any ? '' : colorBefore(id)}${zhOf(id)}${size ? ` · ${size}` : ''}`;
  }

  function readJSON(key,fallback) { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; } }
  function writeJSON(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { return false; } }
  function readPrefs() {
    const saved = readJSON(PREFS_KEY,{}) || {};
    return {tier:TIERS[saved.tier] ? saved.tier : 'novice',minutes:MINUTES.includes(saved.minutes) ? saved.minutes : DEFAULT_MINUTES,sound:saved.sound !== false,
      zh:saved.zh === true,coach:Number.isInteger(saved.coach) ? saved.coach : 0,
      // Where I last worked and last browsed (首页的 继续营业 / 继续逛店).
      lastTheme:typeof saved.lastTheme === 'string' ? saved.lastTheme.slice(0,12) : '',lastBrowse:saved.lastBrowse && typeof saved.lastBrowse === 'object' ? saved.lastBrowse : null,
      seen:saved.seen && typeof saved.seen === 'object' ? saved.seen : {},
      // Floors open for business that this device has already shown (a floor newly open glows once, with "Nytt").
      floorsSeen:Array.isArray(saved.floorsSeen) ? saved.floorsSeen.filter(Number.isInteger) : null,
      // Stars per theme as the server last sent them, and what this device has played since (until the server answers).
      progress:saved.progress && typeof saved.progress === 'object' ? saved.progress : {themes:{},words:{},unlocked:[]}};
  }
  const savePrefs = () => writeJSON(PREFS_KEY,ui.prefs);

  async function loadData() {
    if (ui.data) return;
    const fetchJSON = async path => { const response = await fetch(versioned(path)); if (!response.ok) throw new Error(path); return response.json(); };
    const optional = path => fetchJSON(path).catch(() => ({images:{}}));
    const [data,lexicon,manifest,kitchenArt,english] = await Promise.all([fetchJSON('data/mall.json'),fetchJSON('data/mall-lexicon.json'),optional('assets/mall/manifest.json'),optional('assets/kitchen/manifest.json'),
      Promise.resolve(L10N.english ? L10N.data('mall') : null).catch(() => null)]);
    if (english && typeof english === 'object') localize(data,english);
    ui.data = data;
    ui.lexicon = lexicon;
    ui.lexById = new Map((lexicon.entries || []).map(item => [item.id,item]));
    ui.manifest = manifest || {images:{}};
    ui.kitchenArt = kitchenArt || {images:{}};
  }
  // English devices (docs/i18n.md) also load data/en/mall.json: the English of every gloss and name that mall.json has
  // only in Chinese ({lines:{Norwegian sentence:English}, names:{中文:English}}; scripts/build_mall.py checks it is
  // complete). It is laid over the data once, so every page shows the English where it would show the Chinese.
  function localize(data,en) {
    const line = text => typeof text === 'string' ? en.lines?.[text] : null;
    const name = text => en.names?.[text] || text;
    const walk = node => {
      if (Array.isArray(node)) {
        // A sentence with its gloss: [Norwegian, 中文].
        if (node.length === 2 && typeof node[1] === 'string' && line(node[0])) { node[1] = line(node[0]); return; }
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        if (typeof node.zh === 'string' && line(node.text)) node.zh = line(node.text);
        Object.values(node).forEach(walk);
      }
    };
    walk(data.themes || []);
    for (const floor of data.floors || []) floor.zh = name(floor.zh);
    for (const shop of data.shops || []) { shop.zh = name(shop.zh); for (const section of shop.sections || []) section.zh = name(section.zh); }
    for (const theme of data.themes || []) { theme.zh = name(theme.zh); theme.note = name(theme.note); }
    for (const color of Object.values(data.colors || {})) color.zh = name(color.zh).toLowerCase();
  }
  // The painted furniture and props (scripts/import_mall_art.py): each one that has arrived is a custom property on the
  // root (--ml-art-shelf …) and a class (art-shelf …); the stylesheet draws the old look where a class is missing.
  const FIXTURE_ART = ['shelf','table','rail','slope','pegboard','counter','curtain-open','curtain-closed','storefront'];
  const PROP_ART = ['basket','paper-bag','till','gift-box'];
  function applyArt() {
    if (!ui.root) return;
    const set = (id,name,small) => {
      const url = artURL(id,small);
      ui.root.classList.toggle(`art-${name}`,Boolean(url));
      if (url) ui.root.style.setProperty(`--ml-art-${name}`,`url("${url}")`); else ui.root.style.removeProperty(`--ml-art-${name}`);
    };
    for (const name of FIXTURE_ART) set(`fixture/${name}`,name,false);
    for (const name of PROP_ART) set(`prop/${name}`,name,true);
    set('scene/atrium','atrium',!wide());
    set('building/mall','building',!wide());
  }
  const shopById = id => ui.data?.shops?.find(shop => shop.id === id) || null;
  const themeById = id => id === 'daily' ? ui.daily?.theme || null : ui.data?.themes?.find(theme => theme.id === id) || null;
  const floorById = n => ui.data?.floors?.find(floor => floor.n === Number(n)) || null;
  const progressOf = id => ui.progress?.themes?.[id] || null;
  const starsOf = id => stars(progressOf(id)?.passed || 0);
  function openSet() {
    const counts = {};
    for (const theme of ui.data?.themes || []) counts[theme.id] = starsOf(theme.id);
    return openThemes(ui.data,counts,ui.progress?.unlocked || []);
  }
  const themeOpen = id => openSet().has(id);
  // A floor is open for business once its shops' first themes are; it says how far its core themes are.
  function floorState(floor) {
    const open = openSet(), core = floor.shops.flatMap(id => shopById(id)?.core || []);
    const done = core.filter(id => starsOf(id) >= UNLOCK_STARS).length;
    return {open:floor.shops.some(id => open.has(shopById(id)?.themes?.[0])),core:core.length,done};
  }
  // What still keeps a floor closed: the core themes below it that are not at ★★ yet.
  function missingBelow(floor) {
    const below = floorById(floor.n-1);
    if (!below) return [];
    return below.shops.flatMap(id => (shopById(id)?.core || []).filter(theme => starsOf(theme) < UNLOCK_STARS));
  }

  /* ---------- Sound ---------- */
  function sfxContext() {
    if (!ui.prefs?.sound) return null;
    let context = ui.sfx.context;
    if (context && (context.state === 'closed' || context.state === 'interrupted')) { try { context.close(); } catch {} context = null; }
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      try { context = new Context(); } catch { return null; }
      const master = context.createGain();
      master.gain.value = .2;
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
  function tone(frequency,length,{type = 'sine',gain = .5,delay = 0,glide = 0} = {}) {
    const context = sfxContext();
    if (!context) return;
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
  function noise(length,{gain = .3,from = 800,to = 2400,q = 1,delay = 0} = {}) {
    const context = sfxContext();
    if (!context) return;
    const at = context.currentTime+delay, size = Math.max(1,Math.floor(context.sampleRate*length)), buffer = context.createBuffer(1,size,context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random()*2-1)*(1-i/size);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from,at);
    filter.frequency.exponentialRampToValueAtTime(to,at+length*.9);
    envelope.gain.setValueAtTime(0,at);
    envelope.gain.linearRampToValueAtTime(gain,at+.01);
    envelope.gain.linearRampToValueAtTime(0,at+length);
    source.connect(filter).connect(envelope).connect(ui.sfx.master);
    source.start(at);
  }
  const SOUNDS = {
    tick:() => tone(784,.09,{type:'triangle',gain:.3}),
    lift:() => { tone(1318,.5,{gain:.12}); tone(1760,.7,{gain:.08,delay:.03}); },
    doorbell:() => { tone(1568,.45,{gain:.1}); tone(1175,.7,{gain:.09,delay:.16}); },
    go:() => { tone(587,.22,{type:'triangle',gain:.24}); tone(880,.42,{gain:.2,delay:.07}); },
    take:() => tone(1046,.12,{type:'triangle',gain:.16}),
    paper:() => { noise(.16,{gain:.16,from:1800,to:900,q:.8}); noise(.12,{gain:.12,from:1400,to:700,q:.8,delay:.14}); },
    curtain:() => noise(.42,{gain:.1,from:900,to:2200,q:.5}),
    print:() => { for (let i = 0; i < 5; i++) noise(.05,{gain:.07,from:3200,to:3600,q:3,delay:i*.09}); },
    stamp:() => { tone(150,.16,{gain:.32,glide:90}); noise(.08,{gain:.1,from:500,to:300}); },
    serve:() => { tone(784,.28,{gain:.15}); tone(988,.28,{gain:.13,delay:.08}); tone(1318,.55,{gain:.12,delay:.16}); },
    call:() => { tone(880,.12,{type:'triangle',gain:.18}); tone(1175,.18,{type:'triangle',gain:.16,delay:.1}); },
    finish:() => { tone(523,.5,{gain:.18}); tone(659,.5,{gain:.16,delay:.09}); tone(784,.9,{gain:.16,delay:.18}); },
    goal:() => { tone(784,.45,{gain:.12}); tone(1175,.55,{gain:.1,delay:.12}); tone(1568,.9,{gain:.08,delay:.24}); },
  };
  const play = name => { try { if (sfxContext()) SOUNDS[name]?.(); } catch {} };
  function wakeSfx() { const context = ui.sfx.context; if (ui.prefs?.sound && (!context || context.state !== 'running')) sfxContext(); }
  // A word or a line, read by the site's own player.
  function say(text,audio,onEnded) {
    if (!ui.prefs?.sound || !text) return;
    ui.saidAt = Date.now();
    try { void Promise.resolve(ui.opts.pronounce?.({word:text,audio:audio || ''},{onEnded})).catch(() => {}); } catch {}
  }
  const sayWord = id => { const item = productEntry(id) || entryOf(id); if (item) say(item.word,item.clip); };
  // A customer's line waits for a word still being read, so nothing is cut off.
  function sayLine(text,voice = 'f',onEnded) {
    if (!text) return;
    const wait = Math.max(0,700-(Date.now()-(ui.saidAt || 0)));
    const go = () => {
      const known = lineAudio(text,voice);
      if (known) { say(text,known,onEnded); return; }
      void lineURL(text,voice).then(url => say(text,url,onEnded));
    };
    if (wait) later(go,wait); else go();
  }
  function stopVoice() { ui.opts.stopAudio?.(); }

  /* ---------- Open, close, navigation ---------- */
  function open(options = {}) {
    if (ui.open) return Promise.resolve(true);
    if (!document?.body) return Promise.resolve(false);
    const prefs = readPrefs();
    Object.assign(ui,{open:true,opts:options,view:'building',prefs,progress:prefs.progress,game:null,sheet:null,busy:false,confirming:false,builtOnce:false,
      lastFocus:document.activeElement,historyToken:'ml-'+Date.now().toString(36),place:{floor:1,shop:'',page:'disken',section:{}},browse:{scrolls:new Map(),flash:null}});
    const root = document.createElement('div');
    root.className = 'ml-root';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label',tx('百货超市'));
    ui.root = root;
    ui.content = document.createElement('div');
    ui.content.className = 'ml-content';
    root.append(ui.content);
    ui.handlers = {click:onClick,keydown:onRootKey,input:onInput};
    for (const [type,handler] of Object.entries(ui.handlers)) root.addEventListener(type,handler);
    root.addEventListener('scroll',event => { const node = event.target; if (node?.classList?.contains('ml-sections') || node?.classList?.contains('ml-corridor') || node?.classList?.contains('ml-list-lines')) fadeEdges(node); },{capture:true,passive:true});
    root.addEventListener('wheel',event => {
      const strip = event.target?.closest?.('.ml-sections,.ml-corridor,.ml-list-lines');
      if (!strip || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth+1) return;
      strip.scrollLeft += event.deltaMode === 1 ? event.deltaY*32 : event.deltaY;
      event.preventDefault();
    },{passive:false});
    document.addEventListener('keydown',onKey);
    document.addEventListener('visibilitychange',ui.onVisibility = onVisibility);
    window.addEventListener('popstate',ui.onPopState = () => { if (ui.open) requestClose(true); });
    window.addEventListener('pagehide',ui.onPageHide = () => releaseSfx());
    window.addEventListener('online',ui.onOnline = () => { if (ui.open) void flushPending(); });
    window.addEventListener('resize',ui.onResize = () => {
      clearTimeout(ui.resizeTimer);
      ui.resizeTimer = setTimeout(() => { if (!ui.open) return; ui.fit = null; if (ui.game) ui.game.fit = null; if (ui.view === 'game') drawGame(); else if (ui.view === 'shop') render(); },160);
    });
    try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskMall:ui.historyToken},'',location.href); } catch {}
    document.body.append(root);
    document.body.classList.add('ml-open');
    // The place in the address (#practice/mall/1/pleie) brings back the same floor or shop after a reload.
    const place = String(options.place || ''), join = /^\d{4}$/.test(String(options.join || '')) ? String(options.join) : '';
    render();
    void loadData().then(() => {
      if (!ui.open) return;
      ui.progress = mergeLocal(ui.prefs.progress);
      applyArt();
      void flushPending();
      if (join) void joinRoom(join); else if (place) goPlace(place); else render();
      void loadProgress();
      void loadDaily();
    }).catch(() => { if (ui.open) { ui.loadFailed = true; render(); } });
    $('h2')?.focus?.({preventScroll:true});
    return Promise.resolve(true);
  }
  function goPlace(place) {
    const [floor,shopSign,page] = place.split('/');
    const shop = ui.data.shops.find(entry => entry.id === shopSign || slug(entry.sign) === shopSign);
    if (shop) { ui.place = {...ui.place,floor:shop.floor,shop:shop.id,page:page === 'hylla' ? 'hylla' : 'disken'}; show('shop',{quiet:true}); return; }
    if (floorById(floor)) { ui.place.floor = Number(floor); show('floor',{quiet:true}); return; }
    render();
  }
  const slug = text => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/æ/g,'ae').replace(/ø/g,'o').replace(/å/g,'a').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  // The address follows the place, so a reload comes back to it (a game comes back to its theme board).
  function writePlace() {
    let hash = '#practice/mall';
    if (['floor','shop','board','preview','game','results'].includes(ui.view) && ui.place.floor) hash += `/${ui.place.floor}`;
    if (['shop','board','preview','game','results'].includes(ui.view) && ui.place.shop) hash += `/${slug(shopById(ui.place.shop)?.sign || ui.place.shop)}${ui.view === 'shop' && ui.place.page === 'hylla' ? '/hylla' : ''}`;
    try { if (location.hash !== hash) history.replaceState(history.state,'',`${location.pathname}${location.search}${hash}`); } catch {}
  }
  function exit() {
    if (!ui.open) return;
    leaveRoom();
    clearTimeout(ui.previewTimer);
    stopVoice();
    stopGame();
    releaseSfx();
    for (const id of ui.timers) clearTimeout(id);
    ui.timers.clear();
    for (const [type,handler] of Object.entries(ui.handlers || {})) ui.root?.removeEventListener(type,handler);
    document.removeEventListener('keydown',onKey);
    document.removeEventListener('visibilitychange',ui.onVisibility);
    window.removeEventListener('popstate',ui.onPopState);
    window.removeEventListener('pagehide',ui.onPageHide);
    window.removeEventListener('online',ui.onOnline);
    window.removeEventListener('resize',ui.onResize);
    clearTimeout(ui.resizeTimer);
    clearTimeout(ui.toastTimer);
    ui.toast?.remove(); ui.toast = null;
    ui.fx?.remove(); ui.fx = null;
    ui.root?.remove();
    document.body.classList.remove('ml-open');
    ui.open = false; ui.root = null; ui.content = null; ui.imgStash = null;
    try { history.replaceState(history.state,'',`${location.pathname}${location.search}#practice`); } catch {}
    if (history.state?.norskMall === ui.historyToken) { try { history.back(); } catch {} }
    try { ui.lastFocus?.focus?.({preventScroll:true}); } catch {}
    try { ui.opts.onExit?.(); } catch {}
  }
  // Back and Esc step out one level: a sheet, then a game (after asking), then shop → floor → building → out.
  function requestClose(fromHistory = false) {
    if (fromHistory) { try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskMall:ui.historyToken},'',location.href); } catch {} }
    if (ui.confirming) { hideConfirm(); return; }
    if (ui.game?.reply || ui.game?.calling) { ui.game.reply = null; ui.game.calling = null; drawGame(); return; }
    if (ui.game?.tags || ui.game?.basket >= 0) { ui.game.tags = null; ui.game.basket = -1; drawGame(); return; }
    if (ui.sheet) { closeSheet(); return; }
    if (ui.game?.closing) return;
    if (ui.game && ['preview','game'].includes(ui.view)) { showConfirm(); return; }
    if (ui.view === 'results' && ui.resultsFor?.room && ui.room) { show('room'); return; }
    if (ui.view === 'room') { leaveRoom(); show('building'); return; }
    if (ui.view === 'results' || ui.view === 'daily' || ui.view === 'help') { show(ui.view === 'results' && ui.place.shop && ui.resultsFor?.theme !== 'daily' ? 'shop' : 'building'); return; }
    if (ui.view === 'shop') { show('floor'); return; }
    if (ui.view === 'floor') { show('building'); return; }
    exit();
  }
  function onKey(event) {
    if (!ui.open) return;
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
    // Up and down move between the floors of the building; Enter goes in (buttons do that themselves).
    if (ui.view === 'building' && ['ArrowUp','ArrowDown'].includes(event.key) && event.target?.closest?.('.ml-floor')) {
      const floors = [...ui.root.querySelectorAll('.ml-floor')], at = floors.indexOf(event.target.closest('.ml-floor'));
      floors[Math.max(0,Math.min(floors.length-1,at+(event.key === 'ArrowUp' ? -1 : 1)))]?.focus();
      event.preventDefault();
    }
  }
  // On the shelves, arrow keys move between the things.
  function onRootKey(event) {
    const item = event.target?.closest?.('.ml-item');
    if (!item || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    const items = [...ui.root.querySelectorAll('.ml-shelf .ml-item')], at = items.indexOf(item);
    const cols = Number(item.closest('.ml-shelf')?.dataset.cols) || 1;
    const step = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols}[event.key];
    items[Math.max(0,Math.min(items.length-1,at+step))]?.focus();
    event.preventDefault();
  }
  function notify(message,duration = 3000) {
    if (!ui.open || !message) return;
    if (!ui.toast) {
      ui.toast = document.createElement('p');
      ui.toast.className = 'ml-toast';
      ui.toast.setAttribute('role','status');
      ui.toast.setAttribute('aria-live','polite');
      document.body.append(ui.toast);
    }
    ui.toast.textContent = message;
    ui.toast.classList.remove('is-on');
    void ui.toast.offsetWidth;
    ui.toast.classList.add('is-on');
    clearTimeout(ui.toastTimer);
    if (duration > 0) ui.toastTimer = setTimeout(() => ui.toast?.classList.remove('is-on'),duration);
  }
  // `move`: how the new page comes in (the building zooms into a floor, a shop door opens).
  function show(view,{move = '',quiet = false} = {}) {
    if (!['preview','game'].includes(view)) stopGame();
    const from = ui.view;
    ui.view = view;
    ui.sheet = null;
    ui.enter = quiet || reduceMotion() ? '' : move || (from !== view ? 'fade' : '');
    if (view === 'shop' && ui.place.shop) { ui.prefs.lastBrowse = {shop:ui.place.shop,page:ui.place.page,section:ui.place.section[ui.place.shop] || ''}; savePrefs(); }
    render();
    writePlace();
    if (view !== 'game') ui.root?.scrollTo?.(0,0);
    $('h2')?.focus?.({preventScroll:true});
  }
  function onVisibility() {
    if (document.hidden) { stopVoice(); releaseSfx(); pauseGame(); }
    else if (ui.game?.paused && !ui.confirming) resumeGame();
  }
  function showConfirm() {
    if (ui.confirming || !ui.root) return;
    ui.confirming = true;
    ui.content.inert = true;
    pauseGame();
    const layer = document.createElement('div');
    layer.className = 'ml-confirm-layer';
    layer.innerHTML = `<div class="ml-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ml-confirm-text"><p id="ml-confirm-text">${tx('离开这一班吗？这一班不会记入成绩。')}</p><div class="ml-confirm-actions">${button('confirm-stay',tx('继续营业'),'ml-primary')}${button('confirm-leave',tx('离开'),'ml-quiet')}</div></div>`;
    ui.root.append(layer);
    layer.querySelector('[data-ml="confirm-stay"]')?.focus();
  }
  function hideConfirm() {
    ui.confirming = false;
    if (ui.content) ui.content.inert = false;
    ui.root?.querySelector('.ml-confirm-layer')?.remove();
    if (ui.game?.paused && !document.hidden) resumeGame();
  }

  /* ---------- Pages ---------- */
  function render() {
    if (!ui.root) return;
    ui.root.classList.toggle('is-game',ui.view === 'game');
    if (ui.view === 'game') { drawGame(); return; }
    const page = {floor:floorPage,shop:shopPage,preview:previewPage,results:resultsPage,daily:dailyPage,help:helpPage,room:roomPage}[ui.view] || buildingPage;
    const keep = focusKey();
    const scrolls = [...ui.root.querySelectorAll('[data-scroll]')].map(node => [node.dataset.scroll,node.scrollLeft,node.scrollTop]);
    const top = ui.root.scrollTop;
    const markup = `<div class="ml-shell is-${ui.view}${ui.enter ? ` is-enter-${ui.enter}` : ''}">${ui.data || ui.view === 'building' ? page() : loadingNote()}</div>${sheetMarkup()}`;
    if (!ui.enter && ui.content.firstElementChild?.classList.contains('ml-shell')) morph(ui.content,markup);
    else ui.content.innerHTML = markup;
    ui.enter = '';
    if (ui.view === 'shop') { if (fitShelf()) { morph(ui.content,`<div class="ml-shell is-shop">${shopPage()}</div>${sheetMarkup()}`); } }
    for (const [key,left,topAt] of scrolls) { const node = ui.root.querySelector(`[data-scroll="${CSS.escape(key)}"]`); if (node) { node.scrollLeft = left; node.scrollTop = topAt; } }
    if (ui.root.scrollTop !== top && ui.view !== 'building') ui.root.scrollTop = top;
    restoreFocus(keep);
    for (const strip of ui.root.querySelectorAll('.ml-sections,.ml-corridor')) fadeEdges(strip);
    if (ui.view === 'building' && !ui.builtOnce && ui.data) {
      // On a phone the building opens at the highest floor open for business.
      ui.builtOnce = true;
      const open = [...ui.root.querySelectorAll('.ml-floor.is-open')][0];
      if (open && ui.root.scrollHeight > ui.root.clientHeight+40) later(() => open.scrollIntoView({block:'center'}),40);
    }
    if (ui.view === 'results') countResults();
  }
  function focusKey() {
    const active = document.activeElement;
    if (!active || !ui.root?.contains(active) || !active.dataset?.ml) return null;
    return {ml:active.dataset.ml,value:active.dataset.value || active.dataset.id || active.dataset.n || ''};
  }
  function restoreFocus(keep) {
    if (!keep) return;
    const match = [...ui.root.querySelectorAll(`[data-ml="${CSS.escape(keep.ml)}"]`)].find(node => (node.dataset.value || node.dataset.id || node.dataset.n || '') === keep.value);
    match?.focus?.({preventScroll:true});
  }
  const loadingNote = () => ui.loadFailed ? `<p class="ml-empty">${tx('商场没有载入，请检查网络后重试。')}${button('reload',tx('重试'),'ml-ghost')}</p>` : `<p class="ml-empty">${tx('正在开门…')}</p>`;
  const topBar = (title,back = '',extra = '') => `<header class="ml-top">${back ? `<button type="button" class="ml-icon-button" data-ml="go" data-value="${back}" aria-label="${tx('返回')}">${icon('back')}</button>` : `<span class="ml-top-gap"></span>`}<h2 tabindex="-1">${title}</h2>${extra}<button type="button" class="ml-icon-button" data-ml="close" aria-label="${tx('离开百货超市')}" title="${tx('离开')}">${icon('close')}</button></header>`;
  const starRow = (count,cls = '') => `<span class="ml-stars ${cls}" aria-label="${tx('{n} 颗星',{n:count})}">${[0,1,2].map(i => `<i class="${i < count ? 'is-on' : ''}">${icon('star')}</i>`).join('')}</span>`;

  /* The building: six floors stacked under a roof, each a button; the ground floor has the door and the day's sign. */
  // Where each floor lies in the painted building (building/mall, 1536 × 2048): top and height in % of the picture.
  const PAINTED_FLOORS = {6:[16.0,12.5],5:[28.5,12.5],4:[41.0,12.5],3:[53.5,12.5],2:[66.0,12.1],1:[78.1,14.8]};
  function buildingPage() {
    const data = ui.data;
    if (!data) return `${topBar(tx('百货超市'),'')}${loadingNote()}`;
    const last = ui.prefs.lastTheme && themeById(ui.prefs.lastTheme) && themeOpen(ui.prefs.lastTheme) ? themeById(ui.prefs.lastTheme) : null;
    const browse = ui.prefs.lastBrowse && shopById(ui.prefs.lastBrowse.shop) ? ui.prefs.lastBrowse : null;
    const resume = last || browse ? `<nav class="ml-resume" aria-label="${tx('继续')}">${last ? `<button type="button" class="ml-pill" data-ml="resume-work">${icon('counter')}<span>${tx('继续营业')}</span><b lang="nb">${e(shopById(last.shop)?.sign)} · ${e(last.no)}</b></button>` : ''}${browse ? `<button type="button" class="ml-pill" data-ml="resume-browse">${icon('shelf')}<span>${tx('继续逛店')}</span><b lang="nb">${e(shopById(browse.shop)?.sign)}</b></button>` : ''}</nav>` : '';
    // Floors open for business that this device has not been shown yet (the first floor is open from the start).
    if (!Array.isArray(ui.prefs.floorsSeen)) { ui.prefs.floorsSeen = data.floors.filter(floor => floorState(floor).open).map(floor => floor.n); savePrefs(); }
    ui.newFloorAt ||= {};
    const painted = Boolean(artURL('building/mall'));
    const floors = [...data.floors].sort((a,b) => b.n-a.n).map(floor => {
      const state = floorState(floor), shops = floor.shops.map(shopById).filter(Boolean);
      const fresh = state.open && !ui.prefs.floorsSeen.includes(floor.n);
      if (fresh && !ui.newFloorAt[floor.n]) { ui.newFloorAt[floor.n] = Date.now(); later(() => play('goal'),300); }
      const age = fresh ? Date.now()-ui.newFloorAt[floor.n] : Infinity;
      const status = state.open ? `<span class="ml-floor-state is-open"><span>${tx('营业')} ★★ ${state.done}/${state.core}</span></span>`
        : `<span class="ml-floor-state">${icon('lock')}<span>${tx('营业未开')}</span></span>`;
      const label = tx('{n} 楼，{name}，{count} 家店',{n:floor.n,name:tx(floor.zh),count:shops.length})+(state.open ? tx('，营业已开放，核心主题 {done}/{all}',{done:state.done,all:state.core}) : tx('，营业未开放，可以逛店'));
      if (painted) return `<button type="button" class="ml-floor is-painted${state.open ? ' is-open' : ''}${fresh ? ' is-new' : ''}" data-ml="floor" data-value="${floor.n}" aria-label="${e(label)}${fresh ? e(tx('，新开放')) : ''}" style="--ml-top:${PAINTED_FLOORS[floor.n]?.[0] ?? 0}%;--ml-height:${PAINTED_FLOORS[floor.n]?.[1] ?? 0}%${age < 1600 ? `;--ml-fx:-${age}ms` : ''}">
        <span class="ml-floor-plate"><span class="ml-floor-n" aria-hidden="true">${floor.n}<small>F</small>${fresh ? '<em class="ml-new" lang="nb">Nytt</em>' : ''}</span>
          <span class="ml-floor-text"><b lang="nb">${e(floor.no)}</b><small>${e(tx(floor.zh))}${status}</small></span></span></button>`;
      return `<button type="button" class="ml-floor${state.open ? ' is-open' : ''}${fresh ? ' is-new' : ''}" data-ml="floor" data-value="${floor.n}" aria-label="${e(label)}${fresh ? e(tx('，新开放')) : ''}"${age < 1600 ? ` style="--ml-fx:-${age}ms"` : ''}>
        <span class="ml-floor-n" aria-hidden="true">${floor.n}<small>F</small>${fresh ? '<em class="ml-new" lang="nb">Nytt</em>' : ''}</span>
        <span class="ml-floor-name"><b lang="nb">${e(floor.no)}</b><small>${e(tx(floor.zh))}</small></span>
        <span class="ml-floor-shops" aria-hidden="true">${shops.map((shop,i) => `<span class="ml-mini-front" style="--ml-tint:${TINTS[(floor.n*3+i) % TINTS.length]}"><i></i><b lang="nb">${e(shop.sign)}</b></span>`).join('')}</span>
        ${status}</button>`;
    }).join('');
    const today = ui.daily?.theme ? shopById(ui.daily.theme.shop) : null;
    return `${topBar(L10N.english ? '<span lang="nb">Varehuset</span>' : `${tx('百货超市')} <span class="ml-title-no" lang="nb">Varehuset</span>`,'',`<button type="button" class="ml-text-button" data-ml="join">${tx('输入房号')}</button>`)}
      ${resume}
      ${painted ? `<section class="ml-building is-painted" aria-label="${tx('商场大楼')}"><div class="ml-tower">${floors}
          <button type="button" class="ml-daily-sign is-painted" data-ml="daily"><b lang="nb">Dagens vakt</b><small>${today ? `<span lang="nb">${e(today.sign)}</span> · ${e(tx(today.zh))}` : tx('今日营业')}</small></button></div></section>`
      : `<section class="ml-building" aria-label="${tx('商场大楼')}">
        <div class="ml-roof" aria-hidden="true"><span lang="nb">Varehuset</span></div>
        <div class="ml-floors">${floors}</div>
        <div class="ml-ground"><span class="ml-gate" aria-hidden="true"><i></i><i></i><b lang="nb">Velkommen</b></span>
          <button type="button" class="ml-daily-sign" data-ml="daily"><b lang="nb">Dagens vakt</b><small>${today ? `<span lang="nb">${e(today.sign)}</span> · ${e(tx(today.zh))}` : tx('今日营业')}</small></button></div>
      </section>`}
      <p class="ml-foot-note">${tx('逛店不受限制，6 层都能进去看；营业一层一层开放。')}</p>`;
  }

  /* A floor: its shops side by side along the corridor. */
  function floorPage() {
    const floor = floorById(ui.place.floor) || ui.data.floors[0];
    const fronts = floor.shops.map(shopById).filter(Boolean).map(shop => {
      const open = openSet(), core = shop.core.length, done = shop.core.filter(id => starsOf(id) >= UNLOCK_STARS).length;
      const state = open.has(shop.themes[0]) ? tx('★★ {done}/{all} · 可营业',{done,all:core}) : shop.themes.length ? tx('营业未开 · 先完成 {n}F 核心主题',{n:floor.n-1}) : tx('主题制作中 · 可以逛店');
      const shown = shop.sections.flatMap(section => section.items.filter(id => !itemOf(id)?.v)).slice(0,4);
      const cover = artURL(`cover/${shop.id}`);
      if (artURL('fixture/storefront') && cover) return `<button type="button" class="ml-store" data-ml="shop" data-value="${shop.id}">
        <span class="ml-store-front is-painted" aria-hidden="true"><span class="ml-store-window" style="--ml-cover:url('${e(cover)}')"></span><span class="ml-store-sign" lang="nb">${e(shop.sign)}</span></span>
        <span class="ml-store-name"><b lang="nb">${e(shop.sign)}</b> ${e(tx(shop.zh))}</span><span class="ml-store-state">${state}</span></button>`;
      return `<button type="button" class="ml-store" data-ml="shop" data-value="${shop.id}" style="--ml-tint:${TINTS[hashOf(shop.id) % TINTS.length]}">
        <span class="ml-store-front" aria-hidden="true"><span class="ml-awning"></span><span class="ml-store-sign" lang="nb">${e(shop.sign)}</span>
          <span class="ml-window">${shown.map(id => pic(id,'is-window')).join('')}</span><span class="ml-store-door"></span></span>
        <span class="ml-store-name"><b lang="nb">${e(shop.sign)}</b> ${e(tx(shop.zh))}</span><span class="ml-store-state">${state}</span></button>`;
    }).join('');
    return `${topBar(`<span>${floor.n}F</span> · <span lang="nb">${e(floor.no)}</span>`,'building')}
      <div class="ml-atrium"><div class="ml-corridor" data-scroll="corridor">${fronts}</div></div>
      <p class="ml-foot-note">${tx('点店门进店。营业没开的店也能进去逛。')}</p>`;
  }

  /* A shop when nobody is being served: the empty counter with the board for business, and the shelves to browse. */
  // A shop's shelf pictures start loading as soon as it is entered, so a section opens with its things in place.
  function warmShop(shop) {
    ui.warmed ||= new Set();
    if (!shop || ui.warmed.has(shop.id) || typeof Image === 'undefined') return;
    ui.warmed.add(shop.id);
    for (const id of shop.sections.flatMap(section => section.items)) {
      const item = itemOf(id), url = item?.art ? kitchenURL(item.art) : artURL(`product/${id}`) || artURL(`product/${item?.p}`);
      if (url) { const image = new Image(); image.decoding = 'async'; image.src = url; }
    }
  }
  function shopPage() {
    const shop = shopById(ui.place.shop);
    if (!shop) return floorPage();
    warmShop(shop);
    const page = ui.place.page === 'hylla' ? 'hylla' : 'disken';
    const zhSwitch = page === 'hylla' ? `<button type="button" class="ml-text-button${ui.prefs.zh ? ' is-on' : ''}" data-ml="zh" aria-pressed="${ui.prefs.zh}">${L10N.english ? 'English' : '中文'}</button>` : '';
    const view = page === 'hylla' ? hyllaMarkup(null,shop) : browseCounter(shop);
    return `<div class="ml-shop is-${page}">${topBar(`<span lang="nb">${e(shop.sign)}</span><small>${e(tx(shop.zh))}</small>`,'floor',zhSwitch)}
      <main class="ml-stage">${view}</main>${tabsMarkup(null,page)}</div>`;
  }
  // The board on the counter: the next theme to work, or what keeps the shop closed.
  function boardTheme(shop) {
    const open = openSet();
    const playable = shop.themes.filter(id => open.has(id));
    return playable.find(id => starsOf(id) < 3) || playable[playable.length-1] || '';
  }
  function browseCounter(shop) {
    const next = boardTheme(shop), theme = themeById(next);
    const sign = theme ? `<span class="ml-sign-kicker">${tx('下一班')}</span><b lang="nb">${e(theme.no)}</b>${starRow(starsOf(theme.id),'is-small')}`
      : shop.themes.length ? `<span class="ml-sign-kicker">${tx('营业未开')}</span><b>${tx('{n}F 核心主题都到 ★★ 后开放',{n:shop.floor-1})}</b>` : `<span class="ml-sign-kicker">${tx('营业')}</span><b>${tx('这家店的主题还在制作')}</b>`;
    const kind = fittingKind(shop);
    return `<section class="ml-scene is-browse${kind ? ' has-fitting' : ''}" style="--ml-seats:2">
      ${sceneBack(shop)}
      <div class="ml-door-zone" aria-hidden="true"><span class="ml-door"></span></div>
      <div class="ml-people"><p class="ml-quiet-note">${tx('门口还没有顾客。')}<br>${tx('先去 Hylla 看看货架，或者点营业牌开门。')}</p></div>
      ${kind ? `<div class="ml-fitting is-${kind}" aria-hidden="true"><span class="ml-room">${kind === 'bench' ? '<span class="ml-bench"><i></i></span>' : '<span class="ml-curtain is-open"><i></i></span>'}</span></div>` : ''}
      <div class="ml-counter"><span class="ml-counter-art" aria-hidden="true"><i></i></span><button type="button" class="ml-board-sign" data-ml="board">${sign}</button></div>
    </section>`;
  }
  // The painted counter scene once it arrives; until then a quiet drawn shop wall.
  // Until then the wall behind the counter shows the shop's own things, faded, on two shelves (no words).
  function sceneBack(shop) {
    const art = artURL(`scene/disken-${shop.id}`,!wide());
    // An <img> decoded with the paint (not a CSS background): coming back from Hylla, the wall is there in the same
    // frame instead of a blank one while a large picture decodes.
    if (art) return `<div class="ml-scene-back is-art" aria-hidden="true"><img class="ml-scene-img" src="${e(art)}" alt="" decoding="sync" draggable="false"></div>`;
    const things = shop.sections.flatMap(section => section.items.filter(id => !itemOf(id)?.v));
    const shelf = from => `<span class="ml-back-shelf">${things.slice(from,from+7).map(id => pic(id,'is-back')).join('')}</span>`;
    return `<div class="ml-scene-back" aria-hidden="true">${shelf(0)}${shelf(7)}<span class="ml-lamp"></span><span class="ml-lamp"></span></div>`;
  }

  /* Hylla: section tabs over one open section; in a game the shopping list stands under it. */
  function hyllaMarkup(game,shop) {
    const sections = shop.sections, key = shop.id;
    const store = game ? game : ui.place;
    let open = game ? game.section : ui.place.section[key];
    if (!sections.some(section => section.id === open)) open = sections[0].id;
    if (game) game.section = open; else ui.place.section[key] = open;
    const section = sections.find(entry => entry.id === open);
    const tier = game?.state.tier || '', novice = tier === 'novice';
    const dots = game ? neededSections(game) : new Set();
    const mineSet = game?.room ? new Set(game.state.players.find(p => p.id === game.me)?.home || []) : null;
    const tabs = `<nav class="ml-sections" data-scroll="sections-${key}" aria-label="${tx('货架分区')}">${sections.map(entry => {
      const on = entry.id === open, theirs = game?.room && !holds(game.state,entry.id,game.me);
      const called = game?.room && entry.items.some(id => game.calls.get(id) > Date.now());
      return `<button type="button" class="ml-section${on ? ' is-on' : ''}${called && !on ? ' is-called' : ''}${dots.has(entry.id) && !on ? ' is-needed' : ''}${theirs ? ' is-theirs' : ''}" data-ml="section" data-value="${e(entry.id)}" aria-pressed="${on}"><b lang="nb">${e(entry.no)}</b>${(!game && ui.prefs.zh) || novice ? `<small>${e(tx(entry.zh))}</small>` : ''}</button>`;
    }).join('')}${game ? '' : `<button type="button" class="ml-section is-search" data-ml="search" aria-label="${tx('店内搜索')}">${icon('search')}</button>`}</nav>`;
    void mineSet; void store;
    return `<section class="ml-hylla">${tabs}<div class="ml-shelf-wrap" data-scroll="shelf-${key}-${open}">${shelfMarkup(game,shop,section)}</div></section>`;
  }
  // The sections where the customer being served still needs something (新手、标准 only: 高手 would give it away).
  function neededSections(game) {
    const set = new Set();
    if (game.state.tier === 'expert') return set;
    const order = game.state.orders[game.guest];
    if (!order || order.status !== 'wait') return set;
    for (const line of order.lines) if (line.s === 'open' && !line.hide && line.got.length < line.q) set.add(game.scene.sectionOf[line.i]);
    return set;
  }
  const FIXTURE_ROW = {shelf:'is-board',table:'is-table',rail:'is-rail',pegboard:'is-peg',slope:'is-slope'};
  function shelfMarkup(game,shop,section) {
    const fit = (game ? game.fit : ui.fit)?.[section.id] || {cols:Math.min(4,section.items.length),item:72};
    const rows = [];
    for (let i = 0; i < section.items.length; i += fit.cols) rows.push(section.items.slice(i,i+fit.cols));
    const out = game ? outOfStock(game.state) : [];
    return `<div class="ml-shelf ${FIXTURE_ROW[section.fixture] || 'is-board'}" data-sec="${e(section.id)}" data-cols="${fit.cols}" style="--ml-cols:${fit.cols};--ml-item:${fit.item}px">${rows.map(row =>
      `<div class="ml-row">${row.map(id => itemCell(game,id,out.includes(id))).join('')}</div>`).join('')}</div>`;
  }
  // One thing on the shelf with its tag. Browsing: its name (中文 if switched on). In a game the tag shows what a
  // real shop's tag shows (price, size of pack) — the name only for 新手.
  function itemCell(game,id,soldOut) {
    const item = itemOf(id), tier = game?.state.tier || '';
    const price = `<span class="ml-price">${item.price},-</span>`;
    const note = variantNote(id), label = item.label ? `<span class="ml-label">${e(item.label)}</span>` : '';
    let tag;
    if (!game) tag = `${wordHTML(id)}${note ? `<span class="ml-variant" lang="nb">${e(note)}</span>` : ''}${ui.prefs.zh ? `<small class="ml-zh">${e(colorZh(id) && item.color && Object.values(ui.data.items).some(o => o.p === item.p && o.v === 'color') ? colorBefore(id) : '')}${e(zhOf(id))}</small>` : ''}`;
    else if (tier === 'novice') tag = `${wordHTML(id)}<small class="ml-zh">${e(zhOf(id))}</small><span class="ml-tag-foot">${label}${price}</span>`;
    else tag = `<span class="ml-tag-foot">${label}${price}</span>`;
    if (soldOut) return `<button type="button" class="ml-item is-out" data-ml="out" data-id="${e(id)}" aria-label="Utsolgt"><span class="ml-pic is-empty" aria-hidden="true"></span><span class="ml-tag"><b lang="nb">Utsolgt</b>${tier === 'novice' ? `<small class="ml-zh">${tx('售罄')}</small>` : ''}</span></button>`;
    const theirs = game?.room && !holds(game.state,game.scene.sectionOf[id],game.me);
    const wrong = game ? since(game,`bad:${id}`,700) : '', called = game?.calls?.get(id) > Date.now();
    const glow = !game && ui.browse.flash?.id === id && Date.now()-ui.browse.flash.at < 1300 ? ` style="--ml-fx:-${Date.now()-ui.browse.flash.at}ms"` : wrong ? ` style="--ml-fx:${wrong}"` : '';
    const name = productEntry(id)?.word || '';
    const sized = item.sizes.length ? ` · ${tx('有尺码')}` : '';
    const aria = game && tier !== 'novice' ? `${item.price} kroner${item.label ? `, ${item.label}` : ''}${sized}` : `${name}${note && item.v ? ` ${note}` : ''}, ${item.price} kroner`;
    return `<button type="button" class="ml-item${wrong ? ' is-wrong' : ''}${called ? ' is-called' : ''}${theirs ? ' is-theirs' : ''}${glow && !game ? ' is-found' : ''}${game?.tags?.id === id ? ' is-lifted' : ''}" data-ml="item" data-id="${e(id)}" aria-label="${e(aria)}"${glow}>${pic(id)}<span class="ml-tag">${tag}</span></button>`;
  }
  // How many things stand in a row and how large: as large as the shelf allows with every thing in view (开饭啦's
  // fitStore); only when even the smallest size does not fit does the shelf scroll down.
  function fitShelf(game = null) {
    const wrap = ui.root?.querySelector('.ml-shelf-wrap'), shelf = wrap?.querySelector('.ml-shelf');
    if (!shelf || !wrap.clientWidth || !wrap.clientHeight) return false;
    const cells = shelf.querySelectorAll('.ml-item'), n = cells.length, sec = shelf.dataset.sec;
    const holder = game || ui;
    const key = `${wrap.clientWidth}x${wrap.clientHeight}|${n}|${game?.state.tier || (ui.prefs.zh ? 'zh' : '')}`;
    holder.fit ||= {};
    if (!n || holder.fit[sec]?.key === key) return false;
    const look = getComputedStyle(shelf), px = value => parseFloat(value) || 0, value = name => px(look.getPropertyValue(name));
    const row = shelf.querySelector('.ml-row'), rowLook = row ? getComputedStyle(row) : null;
    const padX = px(look.paddingLeft)+px(look.paddingRight)+px(look.borderLeftWidth)+px(look.borderRightWidth);
    const padY = px(look.paddingTop)+px(look.paddingBottom)+px(look.borderTopWidth)+px(look.borderBottomWidth);
    const gapX = px(rowLook?.columnGap), rowPad = row ? px(rowLook.paddingTop)+px(rowLook.paddingBottom)+px(rowLook.marginBottom) : 0, gapY = px(look.rowGap);
    const width = wrap.clientWidth-2, height = wrap.clientHeight-2;
    const now = px(getComputedStyle(cells[0]).getPropertyValue('--ml-item')) || value('--ml-item') || 72;
    const tag = Math.max(...[...cells].map(cell => cell.querySelector('.ml-tag')?.offsetHeight || 0));
    const low = value('--ml-item-min') || 60, high = value('--ml-item-max') || 88, least = value('--ml-cell-min') || 78;
    // A cell is as wide as its widest tag needs (words never break inside).
    const tagWidth = Math.max(...[...cells].map(cell => cell.querySelector('.ml-tag')?.scrollWidth || 0));
    const cellW = size => Math.max(size+16,least,tagWidth+6);
    const fits = (size,cols) => { const rows = Math.ceil(n/cols); return cols*cellW(size)+(cols-1)*gapX+padX <= width && rows*(size+tag+12+rowPad)+(rows-1)*gapY+padY <= height; };
    let best = null;
    for (let size = high; size >= low && !best; size -= 2) for (let cols = n; cols >= 1; cols--) if (fits(size,cols)) { best = {size,cols}; break; }
    // Too many to show at once: the shelf scrolls down, so each thing may be as large as the row's width allows.
    if (!best) {
      const cols = Math.max(1,Math.min(n,Math.floor((width-padX+gapX)/(cellW(low)+gapX))));
      let size = low;
      while (size+2 <= high && cols*cellW(size+2)+(cols-1)*gapX+padX <= width) size += 2;
      best = {size,cols};
    }
    const rows = Math.ceil(n/best.cols);
    best.cols = Math.ceil(n/rows);
    void now;
    const fit = {key,cols:best.cols,item:best.size};
    const changed = !holder.fit[sec] || holder.fit[sec].cols !== fit.cols || holder.fit[sec].item !== fit.item;
    holder.fit[sec] = fit;
    return changed;
  }
  // The two pages of a shop at the bottom, each saying in words what waits there.
  function tabsMarkup(game,page) {
    const novice = !game || game.state.tier === 'novice';
    let disken = '', hylla = '', callD = false, callH = false;
    if (game) {
      const here = seated(game.state), now = gameNow(game);
      const talking = here.filter(order => order.talks.some(talk => talk.s === 'open'));
      const bags = here.filter(complete);
      disken = talking.length ? tx('{n} 位要回应',{n:talking.length}) : bags.length ? tx('{n} 袋可交付',{n:bags.length}) : here.length ? tx('{n} 位等你',{n:here.length}) : '';
      const guest = game.state.orders[game.guest];
      const missing = guest?.status === 'wait' ? guest.lines.filter(line => line.s === 'open' && !line.hide && line.got.length < line.q).reduce((sum,line) => sum+line.q-line.got.length,0) : 0;
      hylla = missing ? tx('{name} 还缺 {n} 样',{name:nameOfCustomer(guest.customer),n:missing}) : '';
      callD = page !== 'disken' && (since(game,'tab:disken',1200) !== '');
      callH = page !== 'hylla' && (since(game,'tab:hylla',1200) !== '');
      void now;
    }
    const tab = (value,on,mark,no,zh,note,calling) => `<button type="button" role="tab" class="ml-tab${on ? ' is-on' : ''}${calling ? ' is-calling' : ''}" data-ml="page" data-value="${value}" aria-selected="${on}">${icon(mark)}<span class="ml-tab-text"><span class="ml-tab-name"><b lang="nb">${no}</b>${novice ? `<small>${zh}</small>` : ''}</span>${note ? `<small class="ml-tab-note">${e(note)}</small>` : ''}</span>${game && on === false && (value === 'disken' ? game.state.orders.some(order => order.status === 'wait' && order.talks.some(talk => talk.s === 'open')) : false) ? '<i class="ml-dot"></i>' : ''}</button>`;
    return `<nav class="ml-tabs" role="tablist" aria-label="${tx('柜台和货架')}">${tab('disken',page === 'disken','counter','Disken',tx('柜台'),disken,callD)}${tab('hylla',page === 'hylla','shelf','Hylla',tx('货架'),hylla,callH)}</nav>`;
  }

  /* Sheets: the theme board, a thing's card, the shop search, joining a room. */
  function sheetMarkup() {
    const sheet = ui.sheet;
    if (!sheet) return '';
    const body = sheet.kind === 'board' ? boardSheet() : sheet.kind === 'card' ? cardSheet(sheet.id) : sheet.kind === 'search' ? searchSheet() : sheet.kind === 'join' ? joinSheet() : '';
    return `<div class="ml-sheet-layer${sheet.fresh ? ' is-enter' : ''}" data-ml="sheet-close-out"><section class="ml-sheet is-${sheet.kind}" role="dialog" aria-modal="true" aria-label="${e(sheet.label || '')}">${body}</section></div>`;
  }
  function openSheet(kind,extra = {}) {
    ui.sheet = {kind,fresh:true,...extra,from:document.activeElement?.dataset?.id || ''};
    render();
    ui.sheet.fresh = false;
    ui.root.querySelector('.ml-sheet [data-ml]')?.focus?.({preventScroll:true});
  }
  function closeSheet() {
    const from = ui.sheet?.from;
    ui.sheet = null;
    render();
    if (from) ui.root.querySelector(`.ml-item[data-id="${CSS.escape(from)}"]`)?.focus?.({preventScroll:true});
  }
  function boardSheet() {
    const shop = shopById(ui.place.shop), open = openSet();
    if (!shop) return '';
    ui.sheet.label = tx('营业牌');
    const chosen = ui.sheet.theme && shop.themes.includes(ui.sheet.theme) ? ui.sheet.theme : boardTheme(shop) || shop.themes[0];
    ui.sheet.theme = chosen;
    const theme = themeById(chosen), count = chosen ? starsOf(chosen) : 0;
    if (!shop.themes.length) return `<header class="ml-sheet-head"><b lang="nb">${e(shop.sign)}</b> · ${tx('营业')}${closeButton()}</header><p class="ml-empty">${tx('这家店的主题还在制作，先逛逛货架吧。')}</p>`;
    if (!open.has(shop.themes[0])) {
      const missing = missingBelow(floorById(shop.floor));
      return `<header class="ml-sheet-head"><span><b lang="nb">${e(shop.sign)}</b> · ${tx('营业未开')}</span>${closeButton()}</header>
        <p class="ml-hint">${tx('{n}F 的核心主题都拿到 ★★，这一层就开放营业。还差这些：',{n:shop.floor-1})}</p>
        <ol class="ml-themes">${missing.map(id => { const entry = themeById(id), other = shopById(entry.shop);
          return `<li><button type="button" class="ml-theme" data-ml="goto-theme" data-value="${id}"><span class="ml-theme-id">${e(id)}</span><span class="ml-theme-name"><b lang="nb">${e(entry.no)}</b><small><span lang="nb">${e(other.sign)}</span> · ${e(tx(entry.zh))}</small></span>${starRow(starsOf(id),'is-small')}</button></li>`; }).join('')}</ol>
        <p class="ml-hint">${tx('逛店不受限制，现在就可以看货架。')}</p>`;
    }
    const rows = shop.themes.map(id => {
      const entry = themeById(id), stars = starsOf(id), isOpen = open.has(id);
      const prev = shop.themes[shop.themes.indexOf(id)-1];
      const why = isOpen ? '' : prev && open.has(prev) ? tx('{id} 拿到 ★★ 后开放',{id:prev}) : tx('{n}F 核心主题都到 ★★ 后开放',{n:shop.floor-1});
      return `<li><button type="button" class="ml-theme${id === chosen ? ' is-on' : ''}${isOpen ? '' : ' is-locked'}" data-ml="theme" data-value="${id}" aria-pressed="${id === chosen}">
        <span class="ml-theme-id">${e(id)}</span><span class="ml-theme-name"><b lang="nb">${e(entry.no)}</b><small>${e(tx(entry.zh))}${entry.core ? '' : ` · ${tx('扩展')}`}</small></span>
        ${isOpen ? starRow(stars,'is-small') : `<span class="ml-theme-lock">${icon('lock')}</span>`}</button>${id === chosen ? `<p class="ml-theme-note">${isOpen ? e(tx(entry.note)) : e(why)}</p>` : ''}</li>`;
    }).join('');
    const tierButtons = TIER_IDS.map((tier,index) => {
      const opened = tierOpen(count,tier), on = (ui.sheet.tier || playableTier(chosen)) === tier;
      return `<button type="button" class="ml-option${on ? ' is-on' : ''}${opened ? '' : ' is-locked'}" role="radio" aria-checked="${on}" data-ml="tier" data-value="${tier}"><span>${tierName(tier)} ${'★'.repeat(index+1)}</span><small>${opened ? tierHint(tier) : tx('拿到 {n} 后开放',{n:'★'.repeat(index)})}</small></button>`;
    }).join('');
    const minutes = MINUTES.map(n => `<button type="button" class="ml-option is-small${ui.prefs.minutes === n ? ' is-on' : ''}" role="radio" aria-checked="${ui.prefs.minutes === n}" data-ml="minutes" data-value="${n}">${tx('{n} 分钟',{n})}</button>`).join('');
    const playable = open.has(chosen);
    return `<header class="ml-sheet-head"><span><b lang="nb">${e(shop.sign)}</b> · ${tx('营业')}</span>${closeButton()}</header>
      <ol class="ml-themes" data-scroll="themes">${rows}</ol>
      <div class="ml-sheet-foot"><div class="ml-options" role="radiogroup" aria-label="${tx('档位')}">${tierButtons}</div>
        <div class="ml-options is-minutes" role="radiogroup" aria-label="${tx('时长')}">${minutes}</div>
        <div class="ml-actions">${button('start-solo',tx('单人开店'),'ml-primary',playable ? '' : 'disabled')}${button('start-room',tx('和同学一起'),'ml-ghost',playable ? '' : 'disabled')}</div></div>`;
  }
  const closeButton = () => `<button type="button" class="ml-icon-button" data-ml="sheet-close" aria-label="${tx('关闭')}">${icon('close')}</button>`;
  // Looked up when shown, not when the file loads: lang/en.json may still be on its way then.
  const tierName = id => ({novice:tx('新手'),standard:tx('标准'),expert:tx('高手')})[id] || '';
  const tierHint = id => ({novice:tx('挪威语 + 中文'),standard:tx('只有挪威语'),expert:tx('只听声音')})[id] || '';
  // The tier a theme is played at by default: the next one not yet passed (once it is open).
  function playableTier(id) {
    const count = starsOf(id);
    const wanted = ui.sheet?.tier || ui.prefs.tier;
    if (tierOpen(count,wanted)) return wanted;
    return count >= 2 ? 'expert' : count >= 1 ? 'standard' : 'novice';
  }
  // A thing's card: picture, word with article, reading, Chinese, English, forms, the shop's sentences about it.
  function cardSheet(id) {
    const item = itemOf(id), entry = productEntry(id);
    if (!item || !entry) return '';
    ui.sheet.label = entry.word;
    const variants = Object.entries(ui.data.items).filter(([,other]) => other.p === item.p).map(([key]) => key);
    const choice = variants.length > 1 ? `<div class="ml-card-variants" role="group" aria-label="${tx('款式')}">${variants.map(key => `<button type="button" class="ml-chip${key === id ? ' is-on' : ''}" data-ml="card-variant" data-id="${e(key)}" aria-pressed="${key === id}">${pic(key,'is-tiny')}<span lang="nb">${e(variantNote(key) || entry.word)}</span></button>`).join('')}</div>` : '';
    const forms = (entry.forms || []).filter(Boolean);
    const sentences = shopSentences(id).slice(0,3);
    ui.prefs.seen[item.p] = 1;
    return `<header class="ml-sheet-head"><span>${tx('词卡')}</span>${closeButton()}</header>
      <div class="ml-card"><div class="ml-card-pic">${pic(id,'is-large')}</div>
        <div class="ml-card-text"><button type="button" class="ml-card-word" data-ml="hear-word" data-id="${e(id)}">${wordHTML(id)}${icon('speaker')}</button>
          <p class="ml-card-zh">${e(zhOf(id))}${entry.en && !L10N.english ? `<small lang="en">${e(entry.en)}</small>` : ''}</p>
          ${forms.length ? `<p class="ml-card-forms" lang="nb">${forms.map(e).join(' · ')}</p>` : ''}
          <p class="ml-card-price">${item.price},-${item.label ? ` · ${e(item.label)}` : ''}${item.sizes.length ? ` · ${item.sizes.join(' ')}` : ''}</p></div></div>
      ${choice}
      ${sentences.length ? `<section class="ml-card-says"><h3>${tx('店里会怎么说')}</h3><ul>${sentences.map(line => `<li><button type="button" class="ml-say" data-ml="hear-line" data-value="${e(line.text)}" data-voice="${line.voice}"><span lang="nb">${e(line.text)}</span><small>${e(line.zh)}</small>${icon('speaker')}</button></li>`).join('')}</ul></section>` : ''}
      <div class="ml-actions">${ui.opts.addWords ? button('card-add',tx('加入词本'),'ml-ghost',`data-id="${e(id)}"`) : ''}</div>`;
  }
  // The sentences of the shop's themes that are about this thing: what customers ask, and the clerk's answers.
  function shopSentences(id) {
    const item = itemOf(id), out = [];
    for (const theme of ui.data.themes) for (const tpl of theme.orders) {
      if (!tpl.want.some(want => itemOf(want.i)?.p === item.p) && itemOf(tpl.soldout?.sub)?.p !== item.p) continue;
      out.push({text:tpl.say.text,zh:tpl.say.zh,voice:'f'});
      const talk = tpl.talk.find(entry => entry.k === 'start' || entry.k === 'soldout');
      if (talk) out.push({text:talk.opts[0][0],zh:talk.opts[0][1],voice:'f'});
    }
    const seen = new Set();
    return out.filter(line => !seen.has(line.text) && seen.add(line.text));
  }
  function searchSheet() {
    const shop = shopById(ui.place.shop), query = (ui.sheet.query || '').trim().toLocaleLowerCase('nb');
    ui.sheet.label = tx('店内搜索');
    const hits = query ? shop.sections.flatMap(section => section.items.filter(id => !itemOf(id).v).map(id => ({id,section}))).filter(({id}) => {
      const entry = productEntry(id);
      return entry && (entry.word.toLocaleLowerCase('nb').includes(query) || entry.zh.includes(query) || (entry.en || '').toLowerCase().includes(query) || (entry.forms || []).some(form => String(form).toLocaleLowerCase('nb').includes(query)));
    }).slice(0,12) : [];
    return `<header class="ml-sheet-head"><span>${tx('店内搜索')}</span>${closeButton()}</header>
      <input type="search" class="ml-search" data-ml-input="search" placeholder="${tx('输入挪威语或中文')}" aria-label="${tx('搜索商品')}" value="${e(ui.sheet.query || '')}" autocomplete="off">
      <ul class="ml-hits">${hits.map(({id,section}) => `<li><button type="button" class="ml-hit" data-ml="hit" data-id="${e(id)}" data-value="${e(section.id)}">${pic(id,'is-tiny')}<span>${wordHTML(id)}<small>${e(zhOf(id))}</small></span><small lang="nb">${e(section.no)}</small></button></li>`).join('') || (query ? `<li class="ml-empty">${tx('这家店没有这样东西')}</li>` : '')}</ul>`;
  }
  function joinSheet() {
    ui.sheet.label = tx('输入房号');
    return `<header class="ml-sheet-head"><span>${tx('输入房号')}</span>${closeButton()}</header>
      <p class="ml-hint">${tx('输入同学给你的 4 位房号，一起营业。')}</p>
      <input type="text" inputmode="numeric" maxlength="4" class="ml-search" data-ml-input="join" placeholder="1234" aria-label="${tx('房号')}" value="${e(ui.sheet.code || '')}">
      <div class="ml-actions">${button('join-go',tx('进入房间'),'ml-primary')}</div>`;
  }

  /* ---------- Progress: the server's record (once /mall/progress answers) with this device's games on top ---------- */
  function mergeLocal(progress) {
    const out = {themes:{...(progress?.themes || {})},words:{...(progress?.words || {})},unlocked:[...(progress?.unlocked || [])]};
    return out;
  }
  async function community() {
    const api = await ui.opts.community?.();
    if (!api?.request) throw Object.assign(new Error('offline'),{code:'service_unavailable'});
    return api;
  }
  async function loadProgress() {
    try {
      const api = await community();
      const data = await api.request('/mall/progress',{timeout:8000});
      if (data && typeof data.themes === 'object') {
        const themes = {...data.themes};
        // A game played here that the server has not counted yet keeps its stars until it has (only this nickname's).
        const me = window.NorskCommunity?.localPlayer?.()?.nickname || '';
        for (const {record,local} of pendingResults()) {
          if (!local?.theme || (record.owner || '') !== me) continue;
          const row = themes[local.theme] || {passed:0,best:0};
          themes[local.theme] = {...row,passed:(row.passed || 0) | local.bit,best:Math.max(row.best || 0,local.best || 0)};
        }
        ui.progress = {themes,words:data.words || {},unlocked:data.unlocked || []};
        ui.prefs.progress = ui.progress;
        savePrefs();
        if (ui.open && ['building','floor','shop'].includes(ui.view)) render();
      }
    } catch {}
  }
  async function loadDaily() {
    const day = beijingDay();
    let seed = null, boards = null;
    try {
      const api = await community();
      const data = await api.request('/mall/daily',{timeout:8000});
      if (Number.isInteger(data?.seed)) { seed = data.seed >>> 0; boards = data; }
    } catch {}
    // Until the server's day arrives, the shop of the day is drawn here from the date (the same for everyone).
    if (seed === null) seed = hashText(`norsk-mall-daily:${day}`);
    if (!ui.data) return;
    ui.daily = {...(boards || {}),day:boards?.day || day,seed,local:!boards,theme:dailyTheme(ui.data,seed)};
    if (ui.open && ['building','daily'].includes(ui.view)) render();
  }

  /* ---------- Redraws that change only what changed (开饭啦's morph: nodes matched by kind and key; a negative
     animation delay names the moment an effect began, so a redraw neither restarts nor cuts it short). ---------- */
  const KEY_ATTRS = ['id','data-n','data-id','data-seat','data-l','data-value','data-ml','data-sec'];
  const MOMENT = /^-(\d+(?:\.\d+)?)ms$/;
  // An effect that is over: far enough in the past for any of them, and not written as a moment (so a redraw keeps it).
  const OVER = '-60s';
  function nodeKey(node) {
    if (node.nodeType !== 1) return `#${node.nodeType}`;
    let key = `${node.localName}.${node.classList[0] || ''}`;
    for (const name of KEY_ATTRS) { const value = node.getAttribute(name); if (value !== null) key += `|${name}=${value}`; }
    return key;
  }
  function styleParts(text) {
    const parts = new Map();
    for (const piece of String(text || '').split(';')) { const at = piece.indexOf(':'); if (at > 0) parts.set(piece.slice(0,at).trim(),piece.slice(at+1).trim()); }
    return parts;
  }
  // Each kept moment remembers when it began (node.__moments), so it is compared with when it really began, not with
  // the last redraw: comparing with the last redraw made every element whose effect had begun earlier than that —
  // the whole game (--ml-phase), a patience bar, a bubble — look moved, and drew it afresh (a flash, most of all in a
  // room, where the classmates' taps redraw often). A moment that begins later than the kept one is a new effect and
  // draws the element afresh so it plays again; one that claims to have begun earlier (an effect already over, written
  // as its whole length) changes nothing on screen and keeps the old one.
  function mergedStyle(node,oldText,newText,drawnAt,now) {
    const before = styleParts(oldText), after = styleParts(newText), out = [], began = node.__moments || {}, kept = {};
    for (const [name,value] of after) {
      const was = before.get(name), moment = MOMENT.exec(value), prior = was && MOMENT.exec(was);
      if (moment && prior && Number(moment[1]) > 0 && Number(prior[1]) > 0) {
        const start = began[name] ?? drawnAt-Number(prior[1]);
        if (now-Number(moment[1])-start > 250) return null;
        out.push(`${name}:${was}`);
        kept[name] = start;
      } else if (moment && Number(moment[1]) > 0 && was !== undefined && was !== value) return null;
      else { out.push(`${name}:${value}`); if (moment) kept[name] = now-Number(moment[1]); }
    }
    node.__moments = kept;
    return out.join(';');
  }
  function morphAttributes(from,to,drawnAt,now) {
    for (const {name} of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
    for (const {name,value} of [...to.attributes]) {
      if (name === 'style') {
        const style = from.hasAttribute('style') ? mergedStyle(from,from.getAttribute('style'),value,drawnAt,now) : value;
        if (style === null) return false;
        if (style !== from.getAttribute('style')) from.setAttribute('style',style);
      } else if (from.getAttribute(name) !== value) from.setAttribute(name,value);
    }
    return true;
  }
  function morphChildren(parent,next,state) {
    const pool = new Map();
    for (const child of [...parent.childNodes]) { const key = nodeKey(child); if (!pool.has(key)) pool.set(key,[]); pool.get(key).push(child); }
    const order = [];
    for (const child of [...next.childNodes]) {
      const old = pool.get(nodeKey(child))?.shift();
      if (old && morphNode(old,child,state)) order.push(old);
      else { if (old) state.removed.push(old); order.push(child); state.added.push(child); }
    }
    for (const left of pool.values()) for (const node of left) state.removed.push(node);
    for (const node of state.removed) if (node.parentNode === parent) node.remove();
    let cursor = parent.firstChild;
    for (const node of order) { if (node === cursor) cursor = cursor.nextSibling; else parent.insertBefore(node,cursor); }
  }
  function morphNode(from,to,state) {
    if (from.nodeType !== 1) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return true; }
    if (from.localName !== to.localName) return false;
    if (from.localName === 'img' && from.getAttribute('src') !== to.getAttribute('src')) return false;
    if (from.localName === 'input') { if (from.value !== to.getAttribute('value') && document.activeElement !== from) from.value = to.getAttribute('value') || ''; }
    if (!morphAttributes(from,to,state.drawnAt,state.now)) return false;
    morphChildren(from,to,state);
    return true;
  }
  function morph(container,html) {
    const now = Date.now(), drawnAt = container.__drawnAt || now;
    const template = document.createElement('template');
    template.innerHTML = html;
    const state = {now,drawnAt,removed:[],added:[]};
    morphChildren(container,template.content,state);
    const spare = new Map();
    for (const node of state.removed) for (const img of node.nodeType === 1 ? (node.localName === 'img' ? [node] : node.querySelectorAll('img')) : []) {
      const src = img.getAttribute('src'); if (!spare.has(src)) spare.set(src,[]); spare.get(src).push(img);
    }
    // Pictures that left the screen are kept a while (imgStash), so going back to Disken or to a section shows the
    // same, already decoded picture rather than a new one that paints a moment later.
    const stash = ui.imgStash ||= new Map();
    for (const node of state.added) for (const img of node.nodeType === 1 ? (node.localName === 'img' ? [node] : [...node.querySelectorAll('img')]) : []) {
      const src = img.getAttribute('src');
      const old = spare.get(src)?.pop() || stash.get(src)?.pop();
      if (!old || !img.parentNode) continue;
      for (const {name} of [...old.attributes]) if (!img.hasAttribute(name)) old.removeAttribute(name);
      for (const {name,value} of [...img.attributes]) if (old.getAttribute(name) !== value) old.setAttribute(name,value);
      img.replaceWith(old);
    }
    for (const [src,left] of spare) for (const img of left) { if (!stash.has(src)) stash.set(src,[]); const list = stash.get(src); if (list.length < 4 && !list.includes(img)) list.push(img); }
    for (const src of [...stash.keys()].slice(0,Math.max(0,stash.size-160))) stash.delete(src);
    container.__drawnAt = now;
  }
  function fadeEdges(strip) {
    const wide = strip.scrollWidth > strip.clientWidth+2;
    strip.classList.toggle('is-overflow',wide && strip.scrollLeft+strip.clientWidth < strip.scrollWidth-4);
    strip.classList.toggle('is-scrolled',wide && strip.scrollLeft > 4);
  }
  // The time since a moment's effect began, as a negative delay ('' once it is over).
  function since(game,key,ms = 900) {
    const at = game?.fresh?.get(key);
    const age = at ? Date.now()-at : Infinity;
    return age < ms ? `-${age}ms` : '';
  }

  /* ---------- A game ---------- */
  const sessionId = () => `ml-${Date.now().toString(36)}-${Math.floor(Math.random()*2**32).toString(36)}`;
  function newGame({themeId,theme,scene,state,extra = {}}) {
    stopVoice();
    return {themeId,theme,scene,state,me:'me',room:false,log:[],page:'disken',section:'',guest:-1,phase:'preview',started:0,pausedTotal:0,paused:false,pausedAt:0,
      timer:null,note:null,fresh:new Map(),flights:[],shown:0,goal:false,exits:[],floats:[],reply:null,tags:null,basket:-1,fit:null,heard:new Set(),calls:new Map(),
      bellAt:0,id:sessionId(),...extra};
  }
  function beginSolo(themeId,tier) {
    const theme = themeById(themeId);
    if (!theme) { notify(tx('找不到这个主题')); return; }
    const daily = themeId === 'daily';
    if (daily && ui.daily?.day !== beijingDay()) {
      // Past midnight: the new day's shop (the boards follow when the server answers).
      const seed = hashText(`norsk-mall-daily:${beijingDay()}`);
      ui.daily = {day:beijingDay(),seed,local:true,solo:[],team:[],theme:dailyTheme(ui.data,seed)};
      void loadDaily();
    }
    if (!daily && !themeOpen(themeId)) { notify(tx('这个主题还没有开放')); return; }
    if (!daily && !tierOpen(starsOf(themeId),tier)) tier = playableTier(themeId);
    const scene = themeRules(ui.data,theme);
    const weak = daily ? [] : themeWords(scene).filter(word => !(ui.progress?.words?.[word]?.[2] === 1));
    const seed = daily ? ui.daily.seed >>> 0 : Math.floor(Math.random()*4294967296) >>> 0;
    const minutes = ui.prefs.minutes;
    const state = newMatch(scene,{seed,minutes,tier,players:['me'],weak});
    ui.prefs.tier = tier;
    if (!daily) ui.prefs.lastTheme = themeId;
    savePrefs();
    ui.place.shop = theme.shop;
    ui.place.floor = shopById(theme.shop)?.floor || ui.place.floor;
    const game = newGame({themeId,theme,scene,state,extra:{header:{theme:themeId,day:daily ? ui.daily.day : undefined,seed,tier,minutes,weak:packWeak(scene,weak)}}});
    game.owner = window.NorskCommunity?.localPlayer?.()?.nickname || '';
    game.ownerDevice = window.NorskCommunity?.localPlayer?.()?.deviceId || '';
    ui.game = game;
    prefetchGame(game);
    show('preview',{move:'fade'});
  }
  function prefetchGame(game) {
    const words = game.scene.products.map(id => entryOf(`m-${id}`)).filter(item => item?.clip).map(item => ({word:item.word,audio:item.clip}));
    // The game's sentences get their file names now, so every one plays at once when it comes; the first customers'
    // lines are fetched too.
    const texts = [];
    for (const order of game.state.orders) {
      const tpl = game.scene.tpls[order.tpl];
      texts.push([tpl.say.text,order.voice]);
      if (tpl.changeSay) texts.push([tpl.changeSay.text,order.voice]);
      if (tpl.fitDone) texts.push([tpl.fitDone[0],order.voice]);
      for (const talk of tpl.talk) { if (talk.ask) texts.push([talk.ask[0],order.voice]); texts.push([talk.reply[0],order.voice]); for (const opt of talk.opts) texts.push([opt[0],clerkVoice()]); }
    }
    for (const text of ['Tusen takk!','Ha det …']) for (const voice of ['f','m']) texts.push([text,voice]);
    void Promise.all(texts.map(([text,voice]) => lineURL(text,voice))).then(() => {
      const first = game.state.orders.slice(0,8).map(order => {
        const text = game.scene.tpls[order.tpl].say.text;
        return {word:text,audio:lineAudio(text,order.voice)};
      }).filter(line => line.audio);
      try { ui.opts.prefetch?.([...first,...words].slice(0,56)); } catch {}
    });
  }
  function previewPage() {
    const game = ui.game;
    if (!game) return `${topBar(tx('今天的货'),'shop')}<p class="ml-empty">${tx('这一班已经结束。')}</p>`;
    const tier = game.state.tier, novice = tier === 'novice', theme = game.theme;
    const fresh = (theme.fresh?.length ? theme.fresh : [...new Set(theme.orders.flatMap(tpl => tpl.want.map(want => want.i)))]).slice(0,6);
    const phraseText = theme.phrase?.text || '';
    const hint = novice ? tx('开门后顾客的话和价签上都有中文。') : tier === 'standard' ? tx('开门后顾客只说挪威语，价签上不写商品名。') : tx('开门后顾客只说话，购物单要点开听。');
    return `${topBar(tx('今天的货'),game.room ? '' : game.themeId === 'daily' ? 'daily' : 'shop')}
      <section class="ml-preview">
        ${artURL(`cover/${theme.shop}`) ? `<div class="ml-preview-cover" aria-hidden="true" style="--ml-cover:url('${e(artURL(`cover/${theme.shop}`,!wide()))}')"></div>` : ''}
        <header class="ml-preview-head"><span class="ml-kicker" lang="nb">${e(shopById(theme.shop)?.sign)} · ${e(theme.no)}</span><p class="ml-preview-title">${e(tx(theme.zh))} · ${tierName(tier)}</p><p class="ml-hint">${tx('先点一点、听一听。')}${hint}</p></header>
        <div class="ml-cloth"><ul class="ml-fresh">${fresh.map(id => `<li><button type="button" class="ml-fresh-item" data-ml="hear-word" data-id="${e(id)}">${pic(id,'is-medium')}<span class="ml-fresh-word">${wordHTML(id)}${variantNote(id) && itemOf(id).v ? `<span class="ml-variant" lang="nb">${e(variantNote(id))}</span>` : ''}${novice ? `<small>${e(colorZh(id) && itemOf(id).v === 'color' ? colorBefore(id) : '')}${e(zhOf(id))}</small>` : ''}</span>${icon('speaker')}</button></li>`).join('')}</ul>
          ${phraseText ? `<button type="button" class="ml-phrase-card" data-ml="hear-line" data-value="${e(phraseText)}" data-voice="f"><span class="ml-kicker">${tx('本班新说法')}</span><b lang="nb">${e(phraseText)}</b>${novice ? `<small>${e(theme.phrase.zh)}</small>` : ''}${icon('speaker')}</button>` : ''}</div>
      </section>
      <div class="ml-start-bar">${button('ready-play',game.prepared ? tx('等同学准备') : game.room && ui.room?.status === 'loading' ? tx('正在载入…') : tx('准备好了'),'ml-primary ml-wide',game.prepared || (game.room && ui.room?.status === 'loading') ? 'disabled' : '')}${game.room ? `<p class="ml-hint ml-center" id="ml-preview-wait">${readyLine()}</p>` : ''}</div>`;
  }
  function readyToPlay() {
    const game = ui.game;
    if (!game) return;
    wakeSfx();
    countdown(game,3000);
  }
  // The door sign turns for `ms`, then the shop opens (a room's countdown ends at the server's start).
  function countdown(game,ms) {
    game.phase = 'countdown';
    game.countEnds = Date.now()+ms;
    ui.view = 'game';
    writePlace();
    drawGame();
    clearInterval(game.timer);
    let shown = -1;
    game.timer = setInterval(() => {
      const left = game.countEnds-Date.now();
      if (left <= 0) { clearInterval(game.timer); game.timer = null; startPlay(game); return; }
      const number = Math.ceil(left/1000);
      if (number !== shown) { shown = number; const node = $('#ml-count-n'); if (node) node.innerHTML = `<b class="ml-digit">${number}</b>`; play('tick'); }
    },100);
  }
  function startPlay(game) {
    if (ui.game !== game) return;
    game.phase = 'play';
    game.started = performance.now();
    game.playedAt = Date.now();
    game.openAt = Date.now();
    play('doorbell');
    clearInterval(game.timer);
    game.timer = setInterval(() => tick(game),250);
    tick(game);
    drawGame();
    if (document.hidden || ui.confirming) pauseGame();
  }
  function stopGame() {
    const game = ui.game;
    if (game?.timer) { clearInterval(game.timer); game.timer = null; }
  }
  function gameNow(game) {
    if (!game || game.phase !== 'play') return 0;
    if (game.room) return Math.min(game.state.duration,Math.max(0,Math.round(serverNow()-game.startsAt)));
    return Math.min(game.state.duration,Math.max(0,Math.round((game.paused ? game.pausedAt : performance.now())-game.started-game.pausedTotal)));
  }
  function pauseGame() {
    const game = ui.game;
    if (!game || game.phase !== 'play' || game.paused || game.room) return;
    game.paused = true;
    game.pausedAt = performance.now();
    ui.root?.classList.add('is-paused');
  }
  function resumeGame() {
    const game = ui.game;
    if (!game || !game.paused) return;
    game.pausedTotal += performance.now()-game.pausedAt;
    game.paused = false;
    ui.root?.classList.remove('is-paused');
    drawGame();
  }
  function tick(game) {
    if (ui.game !== game || game.phase !== 'play' || game.paused) return;
    const now = gameNow(game);
    const events = advance(game.state,game.scene,now);
    const fresh = events.filter(event => remember(game,event));
    if (fresh.length) react(fresh,game);
    // A room's game is closed by the server (applyRoom → finishRoomGame).
    if (game.state.over && !game.closing) { game.closing = true; game.closedAt = Date.now(); if (!game.room) later(() => finishSolo(game),1500); drawGame(); return; }
    const expired = game.expireAt && Date.now() >= game.expireAt;
    if (expired) game.expireAt = 0;
    if (events.length || expired) drawGame(); else updateHud(game,now);
  }
  function remember(game,event) {
    const key = `${event.e}:${event.n ?? ''}:${event.at ?? ''}`;
    if (game.heard.has(key)) return false;
    game.heard.add(key);
    return true;
  }
  const clockText = ms => { const s = Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
  function updateHud(game,now = gameNow(game)) {
    const clock = $('#ml-clock'), left = game.state.duration-now;
    if (clock) { clock.textContent = clockText(left); clock.classList.toggle('is-late',game.phase === 'play' && left <= 30000); }
    const second = Math.ceil(left/1000);
    if (game.phase === 'play' && !game.paused && second >= 1 && second <= 5 && second !== game.lastTick) { game.lastTick = second; play('tick'); }
    if (game.note && Date.now() > game.note.until) { game.note = null; drawGame(); }
  }
  // The customer being served: the one tapped; when they go, whoever has waited longest.
  function settleGuest(game) {
    const here = seated(game.state).sort((a,b) => a.arrivedAt-b.arrivedAt || a.n-b.n);
    if (!here.some(order => order.n === game.guest)) game.guest = here[0]?.n ?? -1;
    return here;
  }
  const tplOf = (game,order) => game.scene.tpls[order.tpl];
  // What the customer is saying now (their request, or the change of mind once it came).
  const sayingOf = (game,order) => order.change?.s === 'done' && tplOf(game,order).changeSay ? tplOf(game,order).changeSay : tplOf(game,order).say;
  function react(events,game) {
    for (const event of events) {
      const order = Number.isInteger(event.n) ? game.state.orders[event.n] : null;
      switch (event.e) {
        case 'arrive': {
          game.fresh.set(`arrive:${event.n}`,Date.now());
          if (Date.now()-game.bellAt > 3000) { play('doorbell'); game.bellAt = Date.now(); }
          const before = game.guest;
          settleGuest(game);
          if (before < 0 || game.guest === event.n) sayLine(sayingOf(game,order).text,order.voice);
          if (game.page === 'hylla') game.fresh.set('tab:disken',Date.now());
          break;
        }
        case 'leave':
          game.exits.push({n:event.n,seat:order.seat,customer:order.customer,mood:'impatient',text:'Ha det …',at:Date.now(),until:Date.now()+900});
          sayLine('Ha det …',order.voice);
          if (game.reply?.n === event.n) game.reply = null;
          settleGuest(game);
          break;
        case 'fitres': {
          const talk = tplOf(game,order).talk.find(entry => entry.k === 'fit');
          game.fresh.set(`fitres:${event.n}`,Date.now());
          if (talk) sayLine(talk.ask[0],order.voice);
          if (game.page === 'hylla') game.fresh.set('tab:disken',Date.now());
          break;
        }
        case 'fitted': {
          const done = tplOf(game,order).fitDone;
          game.fresh.set(`fitted:${event.n}`,Date.now());
          play('curtain');
          if (done) sayLine(done[0],order.voice);
          break;
        }
        case 'fitin': game.fresh.set(`fitin:${event.n}`,Date.now()); play('curtain'); break;
        case 'till': game.fresh.set(`till:${event.n}`,Date.now()); break;
        case 'change': game.fresh.set(`change:${event.n}`,Date.now()); sayLine(sayingOf(game,order).text,order.voice); break;
        case 'complete':
          game.fresh.set(`bag:${event.n}`,Date.now());
          play('paper');
          if (game.page === 'hylla') game.fresh.set('tab:disken',Date.now());
          break;
        case 'serve':
          game.exits.push({n:event.n,seat:order.seat >= 0 ? order.seat : game.seatOf?.[event.n] ?? 0,customer:order.customer,mood:'happy',text:'Tusen takk!',at:Date.now(),until:Date.now()+900});
          game.floats.push({n:event.n,text:`+${event.points+event.tip}`,at:Date.now(),until:Date.now()+900});
          sayLine('Tusen takk!',order.voice);
          play('serve');
          settleGuest(game);
          break;
        case 'end': play('finish'); break;
        default: break;
      }
    }
  }
  // One tap the rules judge: it takes effect at once (the log goes to the server at the end).
  function act(action,from = null) {
    const game = ui.game;
    if (!game || game.phase !== 'play' || game.state.over) return null;
    const now = gameNow(game);
    if (now >= game.state.duration) { tick(game); return null; }
    // The seat of every order is remembered for its leaving (a served order gives its seat up).
    game.seatOf ||= {};
    for (const order of seated(game.state)) game.seatOf[order.n] = order.seat;
    const result = apply(game.state,game.scene,{...action,by:game.me},now);
    if (result.ok || result.learn.length) { if (game.room) queueAction(game,action,now,result); else game.log.push({...action,at:now}); }
    const fresh = result.events.filter(event => remember(game,event));
    react(fresh,game);
    feedback(game,action,result,from);
    drawGame();
    return result;
  }
  const WHY = {
    idle:() => tx('还没有顾客'),ready:() => tx('都齐了，去柜台交付'),notmine:() => tx('这样在同学的分区：在购物单上点这一样，用挪威语喊人要'),
    notready:() => tx('先把东西拿齐、话说完'),busy:() => tx('正在进行中'),incomplete:() => tx('篮子还没齐'),gone:() => tx('这位顾客已经走了'),closed:() => tx('这句话已经回应过了'),
    claimed:() => tx('同学在回应'),noservice:() => tx('这位顾客不需要这个'),empty:() => tx('篮子里没有这样'),
  };
  function feedback(game,action,result,from) {
    const now = Date.now();
    if (action.t === 'pick') {
      const event = result.events.find(entry => ['pick','attr','wrong'].includes(entry.e));
      if (result.ok && event) {
        sayWord(action.i);
        game.fresh.set(`got:${event.n}.${event.l}`,now);
        if (from) fly(game,from,game.page === 'hylla' ? `.ml-line[data-n="${event.n}"][data-l="${event.l}"]` : `.ml-basket[data-n="${event.n}"]`,pic(action.i),event.n);
        return;
      }
      if (result.why === 'attr' && event) {
        game.fresh.set(`bad:${action.i}`,now);
        const want = itemOf(event.want);
        const text = event.what === 'color' ? tx('要的是这个颜色') : event.what === 'size' ? tx('要的是这个尺码') : tx('要的是这一种');
        const main = event.what === 'color' ? `<span lang="nb">${e(ui.data.colors[want.color]?.no || '')}</span> · ${e(colorZh(event.want))}` : event.what === 'size' ? `<span lang="nb">${e(event.wz)}</span> · ${e(sizeWord(event.wz))}` : `${wordHTML(event.want,{article:false})} <span lang="nb">${e(want.label || variantNote(event.want))}</span>`;
        game.note = {kind:'attr',id:action.i,html:`<span class="ml-note-main">${main}</span><span class="ml-note-sub">← ${text}</span>`,word:event.what === 'color' ? `m-farge-${want.color}` : '',until:now+2400,at:now};
        if (event.what === 'color') sayWord(`m-farge-${want.color}`);
        else if (event.what === 'size') sayLine(sizeWord(event.wz),'f');
        return;
      }
      if (result.why === 'wrong' && event) {
        game.fresh.set(`bad:${action.i}`,now);
        const guest = game.state.orders[game.guest];
        const wanted = guest?.status === 'wait' ? guest.lines.find(line => line.s === 'open' && !line.hide && line.got.length < line.q) : null;
        game.note = {kind:'fix',id:action.i,html:`<span class="ml-note-main">${wordHTML(action.i,{article:false})} · ${e(zhOf(action.i))} ${icon('speaker')}</span><span class="ml-note-sub">${wanted && game.state.tier !== 'expert' ? `${tx('要的是')} ${wordHTML(wanted.i,{article:false})}` : wanted ? tx('再听一遍顾客要什么') : tx('现在没人要它')}</span>`,word:action.i,until:now+2400,at:now};
        sayWord(action.i);
        return;
      }
      if (result.why === 'full') { const line = needing(game.state,game.guest)[0]; if (line) game.fresh.set(`flash:${line.order.n}.${line.l}`,now); return; }
      if (result.why === 'out') { say('utsolgt',''); return; }
      if (WHY[result.why]) notify(WHY[result.why](),2200);
      return;
    }
    if (!result.ok && WHY[result.why]) notify(WHY[result.why](),2200);
  }
  // A picture flies along a soft arc from where it was tapped to where it went (a body-level layer; nothing moves).
  function fly(game,from,selector,html) {
    if (!from || reduceMotion() || !html) return;
    game.flights.push({from,selector,html,at:Date.now()});
  }
  function fxLayer() {
    if (!ui.fx || !ui.fx.isConnected) {
      ui.fx = document.createElement('div');
      ui.fx.className = 'ml-fx';
      ui.fx.setAttribute('aria-hidden','true');
      document.body.append(ui.fx);
    }
    return ui.fx;
  }
  function runFlights(game) {
    for (const item of game.flights.splice(0).filter(entry => Date.now()-entry.at < 1200)) {
      const target = ui.root?.querySelector(item.selector) || ui.root?.querySelector('.ml-tab[data-value="disken"]');
      if (!target || typeof Element.prototype.animate !== 'function') continue;
      const to = target.getBoundingClientRect(), from = item.from, size = 40;
      const dx = from.left+from.width/2-(to.left+to.width/2), dy = from.top+from.height/2-(to.top+to.height/2);
      const node = document.createElement('div');
      node.className = 'ml-fly';
      node.style.cssText = `left:${to.left+to.width/2-size/2}px;top:${to.top+to.height/2-size/2}px;width:${size}px;height:${size}px`;
      node.innerHTML = item.html;
      fxLayer().append(node);
      const lift = Math.min(40,Math.hypot(dx,dy)*.2);
      const flight = node.animate([
        {transform:`translate(${dx}px,${dy}px) scale(.9)`,opacity:0},
        {transform:`translate(${dx*.5}px,${dy*.5-lift}px) scale(1)`,opacity:1,offset:.4},
        {transform:'translate(0,0) scale(1)',opacity:1,offset:.84},
        {transform:'translate(0,2px) scale(.9)',opacity:0},
      ],{duration:420+Math.min(220,Math.hypot(dx,dy)*.3),easing:'cubic-bezier(.2,.7,.2,1)'});
      const done = () => node.remove();
      flight.onfinish = done; flight.oncancel = done;
      setTimeout(done,1500);
    }
  }
  function tweenScore(game) {
    const goal = game.state.score;
    if (reduceMotion()) { game.shown = goal; paintScore(game); return; }
    if (game.shown === goal || game.tween?.to === goal) return;
    game.tween = {from:game.shown,to:goal,at:performance.now()};
    if (game.tweenFrame) return;
    const step = () => {
      const tween = game.tween;
      if (ui.game !== game || !tween) { game.tweenFrame = 0; return; }
      const k = Math.max(0,Math.min(1,(performance.now()-tween.at)/750));
      game.shown = tween.from+(tween.to-tween.from)*(1-(1-k)**3);
      paintScore(game);
      if (k < 1) { game.tweenFrame = requestAnimationFrame(step); return; }
      game.shown = tween.to; game.tween = null; game.tweenFrame = 0;
    };
    game.tweenFrame = requestAnimationFrame(step);
  }
  function paintScore(game) {
    const node = $('#ml-score'), bar = $('#ml-goal'), target = targetFor(game.theme,game.state.minutes,game.state.tier);
    if (node) node.textContent = String(Math.round(game.shown));
    if (bar) bar.style.transform = `scaleX(${Math.min(1,game.shown/Math.max(1,target)).toFixed(3)})`;
  }

  function drawGame() {
    const game = ui.game;
    if (!ui.root || !game || ui.view !== 'game') return;
    ui.root.classList.add('is-game');
    const keep = focusKey();
    const scrolls = game.scrolls ||= new Map();
    const shown = () => [...ui.root.querySelectorAll('[data-scroll]')].filter(node => node.getClientRects().length);
    for (const node of shown()) scrolls.set(node.dataset.scroll,[node.scrollLeft,node.scrollTop]);
    paint(game);
    if (game.page === 'hylla' && fitShelf(game)) paint(game);
    for (const node of shown()) {
      const [left,top] = scrolls.get(node.dataset.scroll) || [0,0];
      if (node.scrollLeft !== left) node.scrollLeft = left;
      if (node.scrollTop !== top) node.scrollTop = top;
    }
    // The open section's tab comes into view along its row.
    if (game.page === 'hylla' && game.section !== game.shownSection) {
      const tabs = ui.root.querySelector('.ml-sections'), tab = tabs?.querySelector('.ml-section.is-on');
      if (tab) { const box = tabs.getBoundingClientRect(), at = tab.getBoundingClientRect(); if (at.left < box.left) tabs.scrollLeft += at.left-box.left-12; else if (at.right > box.right) tabs.scrollLeft += at.right-box.right+12; }
      game.shownSection = game.section;
    }
    restoreFocus(keep);
    for (const strip of ui.root.querySelectorAll('.ml-sections,.ml-list-lines')) fadeEdges(strip);
    placeNote(game);
    if (game.tags) positionTags(game);
    const fading = [...game.floats.map(item => item.until),...game.exits.map(item => item.until),game.note?.until || 0].filter(at => at > Date.now());
    game.expireAt = fading.length ? Math.min(...fading)+60 : 0;
    const target = targetFor(game.theme,game.state.minutes,game.state.tier);
    if (!game.goal && game.state.score >= target && game.phase === 'play') {
      game.goal = true; game.goalAt = Date.now();
      play('goal');
      notify(tx('达到{tier}关目标 {n} 分',{tier:tierName(game.state.tier),n:target}),2400);
    }
    tweenScore(game);
    runFlights(game);
  }
  function paint(game) {
    const markup = gameMarkup(game);
    if (ui.content.firstElementChild?.classList.contains('ml-game')) morph(ui.content,markup);
    else { ui.content.innerHTML = markup; ui.content.__drawnAt = Date.now(); }
  }
  // The correction card sits on the thing that was tapped (or above the shelf if that is out of sight).
  function placeNote(game) {
    const note = $('#ml-note'), stage = $('.ml-stage');
    if (!note || !stage || !game.note || game.note.until < Date.now()) return;
    const item = game.note.id ? stage.querySelector(`.ml-item[data-id="${CSS.escape(game.note.id)}"]`) : null;
    const box = stage.getBoundingClientRect(), at = item?.getBoundingClientRect();
    const width = note.offsetWidth, height = note.offsetHeight;
    let left = at ? at.left-box.left+at.width/2-width/2 : box.width/2-width/2, top = at ? at.top-box.top-height-6 : 8;
    if (at && top < 46) top = at.bottom-box.top+6;
    left = Math.max(8,Math.min(box.width-width-8,left));
    note.style.left = `${Math.round(left)}px`;
    note.style.top = `${Math.round(Math.max(4,top))}px`;
  }
  function gameMarkup(game) {
    const state = game.state, now = gameNow(game), tier = state.tier;
    for (const [key,at] of game.fresh) if (Date.now()-at > 2600) game.fresh.delete(key);
    game.exits = game.exits.filter(exit => exit.until > Date.now());
    game.floats = game.floats.filter(item => item.until > Date.now());
    settleGuest(game);
    const shop = shopById(game.theme.shop);
    const page = game.page === 'hylla' ? 'hylla' : 'disken';
    const view = page === 'hylla' ? hyllaMarkup(game,shop)+listMarkup(game,now)+tagsMarkup(game)+callMarkup(game) : diskenMarkup(game,shop,now);
    const noteOn = game.note && game.note.until > Date.now();
    const note = noteOn ? `<button type="button" class="ml-note is-${game.note.kind}" id="ml-note" data-ml="note" data-id="${e(game.note.word || '')}" style="--ml-fx:-${Date.now()-game.note.at}ms">${game.note.html}</button>` : '';
    const count = game.phase === 'countdown' ? `<div class="ml-count" aria-live="assertive"><span id="ml-count-n"><b class="ml-digit">${Math.max(1,Math.ceil((game.countEnds-Date.now())/1000))}</b></span><span class="ml-door-sign"><b lang="nb">Stengt</b><b lang="nb">Åpent</b></span></div>` : '';
    const openSign = game.openAt && Date.now()-game.openAt < 1400 ? `<div class="ml-count is-open" style="--ml-fx:-${Date.now()-game.openAt}ms" aria-hidden="true"><span class="ml-door-sign is-flipped"><b lang="nb">Stengt</b><b lang="nb">Åpent</b></span></div>` : '';
    const over = state.over && game.closing ? `<div class="ml-count is-end"><span class="ml-door-sign is-closed"><b lang="nb">Stengt!</b></span><small>${tx('打烊了，正在算账…')}</small></div>` : '';
    const layout = `--ml-phase:-${Date.now()%3600000}ms`;
    return `<div class="ml-game is-${tier} is-${page}${game.tags ? ' is-tagging' : ''}" style="${layout}">${barMarkup(game,now)}<main class="ml-stage">${view}${note}</main>${tabsMarkup(game,page)}${count}${openSign}${over}</div>`;
  }
  function barMarkup(game,now) {
    const state = game.state, target = targetFor(game.theme,state.minutes,state.tier), left = state.duration-now;
    const goalAge = game.goalAt ? Date.now()-game.goalAt : Infinity;
    const shop = shopById(game.theme.shop);
    return `<header class="ml-bar"><button type="button" class="ml-icon-button" data-ml="close" aria-label="${tx('离开这一班')}">${icon('close')}</button>
      <div class="ml-bar-title"><span lang="nb">${e(shop?.sign || '')}${state.tier === 'novice' ? `<small>${e(tx(shop?.zh || ''))}</small>` : ''}</span><span class="ml-clock${game.phase === 'play' && left <= 30000 ? ' is-late' : ''}" id="ml-clock">${clockText(left)}</span></div>
      <div class="ml-scoreboard${game.goal ? ' is-reached' : ''}${goalAge < 1800 ? ' is-new' : ''}" ${goalAge < 1800 ? `style="--ml-fx:-${goalAge}ms"` : ''}><b id="ml-score">${Math.round(game.shown)}</b>
        <small>★ ${target}</small><span class="ml-goal" aria-hidden="true"><i id="ml-goal" style="transform:scaleX(${Math.min(1,game.shown/Math.max(1,target)).toFixed(3)})"></i></span></div>
      <button type="button" class="ml-icon-button" data-ml="sound" aria-label="${ui.prefs.sound ? tx('关闭声音') : tx('打开声音')}">${icon(ui.prefs.sound ? 'sound' : 'mute')}</button></header>`;
  }

  /* Disken in a game: the door with the queue, the customers at their places, the baskets on the counter in front of
     them, the fitting room (服装店) and the till; "Vær så god!" under a bag that is ready. */
  function diskenMarkup(game,shop,now) {
    const state = game.state, tier = state.tier, seats = state.seats.length;
    const fitting = fittingKind(shop), till = game.theme.orders.some(tpl => tpl.svc === 'till');
    const waiting = state.orders.slice(state.next).filter(order => order.at <= now);
    const queue = `<div class="ml-door-zone" aria-label="${tx('门口排队')}"><span class="ml-door${since(game,`arrive:${state.orders[state.next-1]?.n}`,700) ? ' is-opening' : ''}" aria-hidden="true"></span>${waiting.slice(0,3).map(order => faceHTML(order.customer,'neutral','is-queued')).join('')}${waiting.length > 3 ? `<span class="ml-queue-more">+${waiting.length-3}</span>` : ''}</div>`;
    const compact = seats >= 3;
    const people = state.seats.map((n,seat) => {
      const order = n >= 0 ? state.orders[n] : null;
      const exit = game.exits.find(entry => entry.seat === seat && entry.until > Date.now());
      if (!order) return `<div class="ml-seat" data-seat="${seat}">${exit ? leavingHTML(game,exit) : ''}</div>`;
      const inRoom = order.sv === 'in' || order.sv === 'queue';
      return `<div class="ml-seat${order.n === game.guest ? ' is-guest' : ''}${inRoom ? ' is-away' : ''}" data-seat="${seat}">${exit ? leavingHTML(game,exit) : ''}${inRoom ? `<p class="ml-away-note">${order.sv === 'queue' ? tx('等试衣间 · 第 {n} 位',{n:queuePlace(state,order)}) : tx('在试衣间')}</p>` : `${bubbleHTML(game,order,now,compact && order.n !== game.guest)}${personHTML(game,order,now)}`}</div>`;
    }).join('');
    const rooms = fitting ? `<div class="ml-fitting is-${fitting}" aria-label="${fitting === 'bench' ? tx('试鞋凳') : tx('试衣间')}">${state.rooms.map((n,room) => fittingRoom(game,n,room,now)).join('')}</div>` : '';
    const baskets = state.seats.map((n,seat) => `<div class="ml-spot" data-seat="${seat}">${n >= 0 ? basketHTML(game,state.orders[n]) : ''}</div>`).join('');
    const gives = state.seats.map((n,seat) => {
      const order = n >= 0 ? state.orders[n] : null, ready = order && complete(order);
      return `<div class="ml-give-spot" data-seat="${seat}">${ready ? `<button type="button" class="ml-give" data-ml="give" data-n="${order.n}" style="--ml-fx:${since(game,`bag:${order.n}`,900) || OVER}"><span lang="nb">Vær så god!</span></button>` : ''}</div>`;
    }).join('');
    // The till stands on the counter at the door's end, where customers pay on their way out.
    const paying = state.orders.find(order => order.status === 'wait' && order.svc === 'till' && order.sv === 'in');
    const tillButton = till ? `<div class="ml-till-spot"><button type="button" class="ml-till${paying ? ' is-printing' : ''}" data-ml="till" aria-label="${tx('收银机')}" ${paying ? `style="--ml-fx:${since(game,`till:${paying.n}`,700) || OVER}"` : ''}><span class="ml-till-body">${icon('till')}${paying ? '<i class="ml-till-paper"></i>' : ''}</span>${tier === 'novice' ? `<small class="ml-spot-label">${tx('收银')}</small>` : ''}</button></div>` : '';
    return `<section class="ml-scene${fitting ? ' has-fitting' : ''}${till ? ' has-till' : ''}${compact ? ' is-compact' : ''}" style="--ml-seats:${seats}">
      ${sceneBack(shop)}${queue}
      <div class="ml-people">${people}</div>${rooms}
      <div class="ml-counter"><span class="ml-counter-art" aria-hidden="true"><i></i></span>${tillButton}<div class="ml-spots">${baskets}</div></div>
      <div class="ml-gives">${gives}</div>
      ${replyMarkup(game,now)}${basketList(game)}</section>`;
  }
  const queuePlace = (state,order) => 1+state.orders.filter(other => other.status === 'wait' && other.sv === 'queue' && (other.queuedAt < order.queuedAt || other.queuedAt === order.queuedAt && other.n < order.n)).length;
  function moodOf(order,now) {
    if (order.hold >= 0) return 'neutral';
    return order.leavesAt-now < order.patience*.25 ? 'impatient' : 'neutral';
  }
  function patienceStyle(order,now) {
    const at = order.hold >= 0 ? order.hold : now, left = Math.max(0,order.leavesAt-at);
    const used = Math.max(0,order.patience-left);
    return `--ml-patience:${order.patience}ms;--ml-elapsed:-${used}ms${order.hold >= 0 ? ';--ml-run:paused' : ''}`;
  }
  function personHTML(game,order,now) {
    const arriving = since(game,`arrive:${order.n}`,650);
    const talk = order.talks.some(entry => entry.s === 'open');
    const label = talk ? tx('{name} 等你回应，点一下回应',{name:nameOfCustomer(order.customer)}) : tx('{name}，点一下再听一遍',{name:nameOfCustomer(order.customer)});
    return `<button type="button" class="ml-person${arriving ? ' is-arriving' : ''}${moodOf(order,now) === 'impatient' ? ' is-hurry' : ''}" data-ml="guest" data-n="${order.n}" aria-label="${e(label)}" ${arriving ? `style="--ml-fx:${arriving}"` : ''}>${faceHTML(order.customer,moodOf(order,now),'is-figure')}</button>`;
  }
  function leavingHTML(game,exit) {
    const float = game.floats.find(item => item.n === exit.n && item.until > Date.now());
    return `<div class="ml-leaving is-${exit.mood}" style="--ml-fx:-${Date.now()-exit.at}ms" aria-hidden="true">${faceHTML(exit.customer,exit.mood,'is-figure')}<span class="ml-reply-bubble" lang="nb">${e(exit.text)}</span>${float ? `<b class="ml-float" style="--ml-fx:-${Date.now()-float.at}ms">${e(float.text)}</b>` : ''}</div>`;
  }
  // The text of a customer's line with its key words underlined in gold.
  function markedText(line) {
    let out = '', at = 0;
    for (const [start,end] of line.marks || []) { out += e(line.text.slice(at,start))+`<u>${e(line.text.slice(start,end))}</u>`; at = end; }
    return out+e(line.text.slice(at));
  }
  // What a customer says over their head, by tier: 新手 the Norwegian with its key words and the Chinese under it;
  // 标准 the Norwegian only; 高手 no words — a play mark; their voice is the message.
  function bubbleHTML(game,order,now,small) {
    const tier = game.state.tier, line = sayingOf(game,order), talk = order.talks.some(entry => entry.s === 'open');
    const changed = since(game,`change:${order.n}`,900);
    const tillTalk = order.talks.find(entry => entry.k === 'till' && entry.s === 'open');
    const words = tillTalk ? tplOf(game,order).talk.find(entry => entry.k === 'till').ask : null;
    const body = tier === 'expert' ? `<span class="ml-ear">${icon('speaker')}${icon('wave')}</span>`
      : words ? `<span class="ml-bubble-text" lang="nb">${e(words[0])}</span>${tier === 'novice' ? `<small>${e(words[1])}</small>` : ''}`
      : `<span class="ml-bubble-text" lang="nb">${markedText(line)}</span>${tier === 'novice' ? `<small>${e(line.zh)}</small>` : ''}`;
    const fresh = since(game,`arrive:${order.n}`,500);
    const claim = game.room ? order.talks.find(entry => entry.s === 'open' && entry.by && entry.by !== game.me && entry.until > now) : null;
    if (claim && !small) return `<div class="ml-bubble is-claimed" aria-hidden="true"><span class="ml-claim">${icon('chat')}<span class="ml-claim-name">${e(tx('{name} 在回应',{name:playerName(claim.by)}))}</span></span><i class="ml-patience" style="${patienceStyle(order,now)}"><i></i></i></div>`;
    return `<button type="button" class="ml-bubble${small ? ' is-dot' : ''}${talk ? ' is-talk' : ''}${changed ? ' is-changed' : ''}${fresh ? ' is-fresh' : ''}" data-ml="guest" data-n="${order.n}" tabindex="-1" aria-hidden="true" style="${[changed ? `--ml-fx:${changed}` : fresh ? `--ml-fx:${fresh}` : ''].filter(Boolean).join(';')}">${small ? (talk ? icon('chat') : '<i></i>') : body}${talk && !small ? `<span class="ml-talk-mark">${icon('chat')}</span>` : ''}<i class="ml-patience" style="${patienceStyle(order,now)}"><i></i></i></button>`;
  }
  // Where a customer tries things on: a fitting room with a curtain (clothes), or a bench to sit on (shoes).
  const fittingKind = shop => shop?.service?.includes('fitting-room') ? 'room' : shop?.service?.includes('bench') ? 'bench' : '';
  function fittingRoom(game,n,room,now) {
    const bench = fittingKind(shopById(game.theme.shop)) === 'bench';
    const order = n >= 0 ? game.state.orders[n] : null, tier = game.state.tier;
    const talk = order?.talks.find(entry => entry.k === 'fit' && entry.s === 'open');
    const ask = talk ? tplOf(game,order).talk.find(entry => entry.k === 'fit').ask : null;
    const ready = !order && seated(game.state).some(entry => entry.svc === 'fit' && entry.sv === 'none' && linesDone(entry) && talksDone(entry));
    const queued = game.state.orders.filter(entry => entry.status === 'wait' && entry.sv === 'queue').length;
    void now;
    const place = bench ? tx('试鞋凳') : tx('试衣间');
    return `<button type="button" class="ml-room${bench ? ' is-bench' : ''}${order ? ' is-busy' : ''}${ready ? ' is-ready' : ''}${talk ? ' is-talk' : ''}" data-ml="room" data-value="${room}" aria-label="${order ? tx('{place} {n}：{name} 在试', {place,n:room+1,name:nameOfCustomer(order.customer)}) : tx('{place} {n}：空着',{place,n:room+1})}">
      ${bench ? '<span class="ml-bench"><i></i></span>' : `<span class="ml-curtain${order ? '' : ' is-open'}" style="--ml-fx:${since(game,`fitin:${n}`,500) || since(game,`fitted:${n}`,500) || OVER}"><i></i></span>`}
      ${game.state.rooms.length > 1 ? `<small class="ml-room-n">${room+1}</small>` : ''}
      ${order ? `<span class="ml-room-who">${faceHTML(order.customer,'neutral','is-peek')}</span>` : ''}
      ${ask ? `<span class="ml-room-say">${tier === 'expert' ? icon('speaker') : `<span lang="nb">${e(ask[0])}</span>${tier === 'novice' ? `<small>${e(ask[1])}</small>` : ''}`}${icon('chat')}</span>` : ''}
      ${!order && queued && room === 0 ? `<small class="ml-room-queue">${tx('{n} 位在等',{n:queued})}</small>` : ''}</button>`;
  }
  // A basket in front of its customer: small pictures of what is in it (up to four, then +N) and how far it is; a
  // paper bag once everything is there.
  function basketHTML(game,order) {
    if (order.status !== 'wait') return '';
    const pieces = [], total = order.lines.reduce((sum,line) => sum+(line.s === 'struck' ? 0 : line.q),0);
    for (const line of order.lines) { for (const z of line.got) pieces.push({i:line.i,z}); for (let k = 0; k < line.swap; k++) pieces.push({i:line.was || line.i,z:'',swap:true}); }
    const have = order.lines.reduce((sum,line) => sum+(line.s === 'struck' ? 0 : Math.min(line.q,line.got.length)),0);
    const bag = complete(order), inRoom = order.sv === 'in' || order.sv === 'queue';
    const gift = bag && /\bgave\b/i.test(tplOf(game,order).say.text);
    const fresh = since(game,`bag:${order.n}`,520);
    const service = !bag && linesDone(order) && order.svc && order.sv === 'none' && talksDone(order) ? (order.svc === 'fit' ? tx('→ 试衣间') : tx('→ 收银')) : '';
    return `<button type="button" class="ml-basket${bag ? ' is-bag' : ''}${gift ? ' is-gift' : ''}${order.n === game.guest ? ' is-guest' : ''}${inRoom ? ' is-away' : ''}${fresh ? ' is-fresh' : ''}${since(game,`got:${order.n}.0`,300) || since(game,`got:${order.n}.1`,300) || since(game,`got:${order.n}.2`,300) ? ' is-landed' : ''}" data-ml="basket" data-n="${order.n}" aria-label="${tx('篮子 {have}/{all}',{have,all:total})}" ${fresh ? `style="--ml-fx:${fresh}"` : ''}>
      <span class="ml-basket-body">${bag ? icon('bag') : pieces.slice(0,4).map(piece => `<span class="ml-in${piece.swap ? ' is-swap' : ''}">${pic(piece.i,'is-mini')}${piece.z ? `<b class="ml-size-tag">${e(piece.z)}</b>` : ''}${piece.swap ? `<b class="ml-swap">${tx('换')}</b>` : ''}</span>`).join('')}${pieces.length > 4 ? `<span class="ml-in is-more">+${pieces.length-4}</span>` : ''}</span>
      <small class="ml-spot-label"><span class="ml-spot-name">${e(nameOfCustomer(order.customer))}</span><span class="ml-basket-count">${bag ? icon('check') : total ? `${have}/${total}` : tx('只需回应')}</span></small>${service ? `<small class="ml-basket-next">${service}</small>` : ''}</button>`;
  }
  // The basket opened: what is in it, line by line; a tap on one puts it back on the shelf.
  function basketList(game) {
    const order = game.basket >= 0 ? game.state.orders[game.basket] : null;
    if (!order || order.status !== 'wait') return '';
    const novice = game.state.tier === 'novice';
    const rows = order.lines.map((line,l) => {
      if (line.hide) return '';
      const struck = line.s === 'struck', have = line.got.length;
      return `<li class="${struck ? 'is-struck' : ''}">${pic(line.i,'is-tiny')}<span class="ml-basket-line"><b lang="nb">${e(game.state.tier === 'expert' && have < line.q ? '…' : phrase(line.i,line.q,line.any,line.z))}</b>${novice ? `<small>${e(phraseZh(line.i,line.q,line.any,line.z))}</small>` : ''}</span>
        <span class="ml-basket-have">${struck ? '—' : `${have}/${line.q}`}</span>${(have || line.swap) && !struck ? `<button type="button" class="ml-mini-button" data-ml="put-back" data-n="${order.n}" data-l="${l}">${line.swap ? tx('放回旧的') : tx('放回')}</button>` : ''}</li>`;
    }).join('');
    return `<div class="ml-basket-pop" role="dialog" aria-label="${tx('篮中清单')}"><header><b>${e(nameOfCustomer(order.customer))}</b>${closeMini('basket-close')}</header><ul>${rows}</ul></div>`;
  }
  const closeMini = action => `<button type="button" class="ml-icon-button is-small" data-ml="${action}" aria-label="${tx('收起')}">${icon('close')}</button>`;
  // The reply strip: the customer's words (to hear again) and three Norwegian replies, one to a row.
  function replyMarkup(game) {
    const reply = game.reply, order = reply ? game.state.orders[reply.n] : null;
    if (!order || order.status !== 'wait') { game.reply = null; return ''; }
    const talk = order.talks[reply.k], content = tplOf(game,order).talk[reply.k];
    if (!talk || !content) return '';
    const tier = game.state.tier, novice = tier === 'novice';
    const asked = content.ask || [sayingOf(game,order).text,sayingOf(game,order).zh];
    const order3 = reply.shuffle || [0,1,2];
    const done = talk.s === 'done';
    const rows = order3.map(o => {
      const opt = content.opts[o], chosen = reply.chosen === o, right = o === 0;
      const cls = done ? (right ? ' is-right' : chosen ? ' is-wrong' : ' is-dim') : '';
      return `<li><button type="button" class="ml-answer${cls}" data-ml="answer" data-value="${o}" ${done ? 'disabled' : ''}><span lang="nb">${e(opt[0])}</span>${novice || (done && right) ? `<small>${e(opt[1])}</small>` : ''}</button></li>`;
    }).join('');
    return `<div class="ml-reply${content.k === 'till' ? ' is-till' : ''}" role="dialog" aria-label="${tx('回应')}" style="--ml-fx:${since(game,'reply',260) || OVER}">
      <header class="ml-reply-head">${faceHTML(order.customer,'neutral','is-tiny')}<button type="button" class="ml-reply-said" data-ml="replay" data-n="${order.n}">${tier === 'expert' ? `<span>${tx('再听一遍')}</span>` : `<span lang="nb">${e(asked[0])}</span>${novice ? `<small>${e(asked[1])}</small>` : ''}`}${icon('speaker')}</button>${closeMini('reply-close')}</header>
      ${content.k === 'till' ? tillSlip(order,content) : ''}<ol class="ml-answers">${rows}</ol></div>`;
  }
  // What the till prints when a customer pays (as on a real till, the machine does the sums): each thing with its
  // price, a bag if one was asked for, the total; with cash, what was handed over and the change.
  function tillSlip(order,content) {
    const rows = [];
    let sum = 0;
    for (const line of order.lines) {
      if (line.s === 'struck' || !line.q) continue;
      const item = itemOf(line.i), cost = item.price*line.q;
      sum += cost;
      rows.push([`${line.q > 1 ? `${line.q} × ` : ''}${productEntry(line.i)?.word || ''}${line.z ? ` · ${line.z}` : ''}`,cost]);
    }
    const total = Number(content.total) || sum;
    if (total > sum) rows.push(['Pose',total-sum]);
    const cash = /(\d+)\s*kroner/i.exec(content.ask?.[0] || '');
    const paid = cash && /tilbake/i.test(content.opts?.[0]?.[0] || '') ? Number(cash[1]) : 0;
    const row = ([name,kr],k) => `<li style="--ml-i:${k}"><span lang="nb">${e(name)}</span><b>${kr},-</b></li>`;
    const foot = [['Totalt',total],...(paid ? [['Kontant',paid],['Tilbake',paid-total]] : [])];
    return `<div class="ml-slip" aria-label="${e(tx('小票'))}"><ul>${rows.map(row).join('')}</ul><ul class="ml-slip-foot">${foot.map((entry,k) => row(entry,rows.length+k)).join('')}</ul></div>`;
  }

  /* Hylla in a game: under the shelf, the shopping list of the customer being served. */
  function listMarkup(game) {
    const order = game.state.orders[game.guest], tier = game.state.tier, novice = tier === 'novice';
    const here = seated(game.state);
    if (!order || order.status !== 'wait') return `<section class="ml-list"><p class="ml-quiet-note">${here.length ? '' : tx('还没有顾客，回柜台看看门口。')}</p></section>`;
    const who = `<button type="button" class="ml-list-who" data-ml="next-guest" aria-label="${tx('换一位顾客')}">${faceHTML(order.customer,'neutral','is-tiny')}<span>${e(nameOfCustomer(order.customer))}</span>${here.length > 1 ? `<small>${here.findIndex(entry => entry.n === order.n)+1}/${here.length}</small>` : ''}</button>`;
    let status = '';
    if (complete(order)) status = `<button type="button" class="ml-list-go is-ready" data-ml="go-counter" data-n="${order.n}">${icon('check')}${tx('去柜台交付')}</button>`;
    else if (order.talks.some(talk => talk.s === 'open')) status = `<button type="button" class="ml-list-go" data-ml="go-counter" data-n="${order.n}">${icon('chat')}${tx('去柜台回应')}</button>`;
    else if (order.sv === 'queue') status = `<span class="ml-list-go">${tx('等试衣间 · 第 {n} 位',{n:queuePlace(game.state,order)})}</span>`;
    else if (order.sv === 'in' && order.fitAt >= 0) status = `<span class="ml-list-go">${tx('在试衣间')}</span>`;
    else if (linesDone(order) && order.svc && order.sv === 'none') status = `<button type="button" class="ml-list-go" data-ml="go-counter" data-n="${order.n}">${order.svc === 'fit' ? `${icon('hanger')}${tx('→ 试衣间')}` : `${icon('till')}${tx('→ 收银')}`}</button>`;
    const lines = order.lines.map((line,l) => {
      if (line.hide) return `<span class="ml-line is-hidden">${tx('？先在柜台问清楚')}</span>`;
      const have = Math.min(line.q,line.got.length), done = line.s === 'struck' || have >= line.q && !line.swap;
      const text = phrase(line.i,line.q,line.any,line.z);
      const shown = tier !== 'expert' || done;
      const flash = since(game,`flash:${order.n}.${l}`,600) || since(game,`got:${order.n}.${l}`,600);
      const theirs = game.room && !done && line.s === 'open' && !mine(game.state,{id:game.me},line.i,game.scene);
      return `<button type="button" class="ml-line${theirs ? ' is-theirs' : ''}${done ? ' is-done' : ''}${line.s === 'struck' ? ' is-struck' : ''}${line.s === 'out' ? ' is-out' : ''}${flash ? ' is-flash' : ''}" data-ml="line" data-n="${order.n}" data-l="${l}" ${flash ? `style="--ml-fx:${flash}"` : ''} aria-label="${shown ? e(text) : tx('点一下听这一样')}">
        ${novice ? pic(line.i,'is-tiny') : ''}${shown ? `<span class="ml-line-text"><b lang="nb">${e(text)}</b>${novice ? `<small>${e(phraseZh(line.i,line.q,line.any,line.z))}</small>` : ''}</span>` : `<span class="ml-line-ear">${icon('speaker')}</span>`}
        ${theirs ? `<span class="ml-line-call" aria-hidden="true">${icon('chat')}</span>` : ''}${line.s === 'out' ? `<small class="ml-line-count" lang="nb">Utsolgt</small>` : `<small class="ml-line-count">${line.s === 'struck' ? '—' : done ? icon('check') : `${have}/${line.q}`}</small>`}</button>`;
    }).join('');
    // A customer who needs nothing from the shelves (a question, a wrong price) is served at the counter only.
    const nothing = order.lines.length ? '' : `<span class="ml-line is-hidden">${tx('不用拿货，在柜台回应')}</span>`;
    return `<section class="ml-list" aria-label="${tx('购物单')}">${who}<div class="ml-list-lines" data-scroll="list-${order.n}">${lines}${nothing}${status}</div></section>`;
  }
  // The size tags of a garment just lifted: one row over it; a tap on one puts that size in the basket.
  function tagsMarkup(game) {
    const tags = game.tags;
    if (!tags) return '';
    const item = itemOf(tags.id);
    return `<div class="ml-tags" role="group" aria-label="${tx('选尺码')}">${item.sizes.map((size,i) => `<button type="button" class="ml-size" data-ml="size" data-value="${e(size)}" style="--ml-i:${i}">${e(size)}</button>`).join('')}</div>`;
  }

  /* ---------- Taps ---------- */
  function onClick(event) {
    const target = event.target.closest('[data-ml]');
    const game = ui.game;
    // A tap outside the size tags, the basket list or the reply strip folds it away (it is not an answer).
    if (game && ui.view === 'game') {
      if (game.tags && !event.target.closest('.ml-tags')) { game.tags = null; if (!target || target.dataset.ml !== 'item') { drawGame(); if (!target) return; } }
      if (game.basket >= 0 && !event.target.closest('.ml-basket-pop,.ml-basket')) { game.basket = -1; if (!target) { drawGame(); return; } }
      if (game.reply && !event.target.closest('.ml-reply') && !(target && target.dataset.ml === 'guest')) { if (game.reply.closing) return; game.reply = null; drawGame(); if (!target) return; }
    }
    if (!target || !ui.root?.contains(target)) return;
    if (target.disabled) return;
    wakeSfx();
    const kind = target.dataset.ml, value = target.dataset.value;
    switch (kind) {
      case 'close': requestClose(); break;
      case 'go': if (value === 'floor') show('floor',{move:'back'}); else if (value === 'building') show('building',{move:'out'}); else if (value === 'shop') { ui.game = null; show('shop'); } else if (value === 'daily') { ui.game = null; show('daily'); } else show(value || 'building'); break;
      case 'reload': ui.loadFailed = false; void loadData().then(render).catch(() => { ui.loadFailed = true; render(); }); break;
      case 'floor':
        ui.place.floor = Number(value);
        if (Array.isArray(ui.prefs.floorsSeen) && floorState(floorById(value)).open && !ui.prefs.floorsSeen.includes(Number(value))) { ui.prefs.floorsSeen.push(Number(value)); savePrefs(); }
        play('lift'); show('floor',{move:'in'}); break;
      case 'goto-theme': {
        const theme = themeById(value), shop = shopById(theme?.shop);
        if (!shop) break;
        ui.place = {...ui.place,floor:shop.floor,shop:shop.id,page:'disken'};
        show('shop',{quiet:true});
        openSheet('board',{theme:value});
        break;
      }
      case 'shop': ui.place.shop = value; ui.place.page = 'disken'; play('doorbell'); show('shop',{move:'door'}); break;
      case 'resume-work': { const theme = themeById(ui.prefs.lastTheme); if (theme) { ui.place.shop = theme.shop; ui.place.floor = shopById(theme.shop).floor; ui.place.page = 'disken'; show('shop',{quiet:true}); openSheet('board',{theme:theme.id}); } break; }
      case 'resume-browse': { const last = ui.prefs.lastBrowse; const shop = shopById(last?.shop); if (shop) { ui.place.shop = shop.id; ui.place.floor = shop.floor; ui.place.page = 'hylla'; if (last.section) ui.place.section[shop.id] = last.section; show('shop',{quiet:true}); } break; }
      case 'daily': show('daily'); break;
      case 'join': openSheet('join'); break;
      case 'page':
        if (game && ui.view === 'game') { game.page = value === 'hylla' ? 'hylla' : 'disken'; if (!game.room) game.reply = null; game.basket = -1; game.tags = null; game.pageAt = Date.now(); drawGame(); }
        else { ui.place.page = value === 'hylla' ? 'hylla' : 'disken'; ui.prefs.lastBrowse = {shop:ui.place.shop,page:ui.place.page,section:ui.place.section[ui.place.shop] || ''}; savePrefs(); render(); writePlace(); }
        break;
      case 'section': {
        const shop = shopById(game && ui.view === 'game' ? game.theme.shop : ui.place.shop), section = shop?.sections.find(entry => entry.id === value);
        if (!section) break;
        if (game && ui.view === 'game') { game.section = value; game.tags = null; game.sectionAt = Date.now(); drawGame(); }
        else { ui.place.section[shop.id] = value; ui.prefs.lastBrowse = {shop:shop.id,page:'hylla',section:value}; savePrefs(); render(); }
        say(section.no,'');
        break;
      }
      case 'zh': ui.prefs.zh = !ui.prefs.zh; savePrefs(); ui.fit = null; render(); break;
      case 'search': openSheet('search'); break;
      case 'hit': {
        const shop = shopById(ui.place.shop);
        ui.place.section[shop.id] = value;
        ui.browse.flash = {id:target.dataset.id,at:Date.now()};
        ui.sheet = null;
        render();
        ui.root.querySelector(`.ml-item[data-id="${CSS.escape(target.dataset.id)}"]`)?.focus?.({preventScroll:false});
        later(() => { if (ui.view === 'shop') render(); },1400);
        break;
      }
      case 'item':
        if (game && ui.view === 'game') { tapItem(game,target); break; }
        sayWord(target.dataset.id);
        openSheet('card',{id:target.dataset.id});
        break;
      case 'out': say('utsolgt',''); break;
      case 'card-variant': ui.sheet.id = target.dataset.id; render(); sayWord(target.dataset.id); break;
      case 'hear-word': sayWord(target.dataset.id); break;
      case 'hear-line': sayLine(value,target.dataset.voice || 'f'); break;
      case 'card-add': addToWordbook([target.dataset.id]); break;
      case 'board': openSheet('board'); break;
      case 'theme': ui.sheet.theme = value; ui.sheet.tier = ''; render(); break;
      case 'tier': if (target.classList.contains('is-locked')) { notify(tx('上一关过了才开放'),1800); break; } ui.sheet.tier = value; ui.prefs.tier = value; savePrefs(); render(); break;
      case 'minutes': ui.prefs.minutes = Number(value); savePrefs(); render(); break;
      case 'start-solo': beginSolo(ui.sheet.theme,ui.sheet.tier || playableTier(ui.sheet.theme)); break;
      case 'start-room': if (ui.view === 'daily') void createRoom('daily',ui.prefs.tier); else if (ui.sheet?.theme) void createRoom(ui.sheet.theme,ui.sheet.tier || playableTier(ui.sheet.theme)); break;
      case 'join-go': { const code = String(ui.sheet?.code || ''); if (/^\d{4}$/.test(code)) void joinRoom(code); else notify(tx('房号是 4 位数字'),1800); break; }
      case 'invite': void copyInvite(); break;
      case 'room-edit': ui.roomEdit = !ui.roomEdit; render(); break;
      case 'room-theme': { const settings = ui.room?.settings || {}; const tier = value === 'daily' || tierOpen(starsOf(value),settings.tier) ? settings.tier : playableTier(value); void roomAction('settings',{theme:value,tier}); break; }
      case 'room-tier': void roomAction('settings',{tier:value}); break;
      case 'room-minutes': ui.prefs.minutes = Number(value); savePrefs(); void roomAction('settings',{minutes:Number(value)}); break;
      case 'room-ready': { const me = (ui.room?.players || []).find(player => player.id === ui.room?.me); void roomAction('ready',{ready:!me?.ready}); break; }
      case 'room-start': void startRoomNow(); break;
      case 'to-room': ui.resultsFor = null; show('room'); break;
      case 'call-pick': chooseCall(game,value); break;
      case 'call-close': game.calling = null; drawGame(); break;
      case 'sheet-close': closeSheet(); break;
      case 'sheet-close-out': if (event.target === target) closeSheet(); break;
      case 'ready-play': if (game?.room) { if (ui.room?.status !== 'preview') break; game.prepared = true; render(); void roomAction('ready',{prepared:true},true).then(data => { if (!data && ui.game === game) { game.prepared = false; render(); } }); } else readyToPlay(); break;
      case 'confirm-stay': hideConfirm(); break;
      case 'confirm-leave': hideConfirm(); stopGame(); if (ui.game?.room) { ui.game = null; leaveRoom(); show('building'); break; } ui.game = null; show('shop'); break;
      case 'sound': ui.prefs.sound = !ui.prefs.sound; savePrefs(); if (!ui.prefs.sound) { stopVoice(); releaseSfx(); } drawGame(); break;
      // In a game
      case 'guest': tapGuest(game,Number(target.dataset.n)); break;
      case 'answer': chooseReply(game,Number(value)); break;
      case 'replay': { const order = game.state.orders[Number(target.dataset.n)]; const content = game.reply ? tplOf(game,order).talk[game.reply.k] : null; sayLine((content?.ask || [sayingOf(game,order).text])[0],order.voice); break; }
      case 'reply-close': game.reply = null; drawGame(); break;
      case 'size': if (game.tags) { const id = game.tags.id, from = game.tags.from; game.tags = null; act({t:'pick',i:id,z:value,c:game.guest},from); } break;
      case 'basket': { const n = Number(target.dataset.n); game.guest = n; game.basket = game.basket === n ? -1 : n; drawGame(); break; }
      case 'basket-close': game.basket = -1; drawGame(); break;
      case 'put-back': act({t:'back',c:Number(target.dataset.n),l:Number(target.dataset.l)}); break;
      case 'give': act({t:'give',c:Number(target.dataset.n)},target.getBoundingClientRect()); break;
      case 'room': tapRoom(game,Number(value)); break;
      case 'till': tapTill(game); break;
      case 'line': { const n = Number(target.dataset.n), l = Number(target.dataset.l), order = game.state.orders[n], line = order?.lines[l]; if (!line) break;
        if (game.room && line.s === 'open' && !line.hide && line.got.length < line.q && !mine(game.state,{id:game.me},line.i,game.scene)) { game.fresh.set('call',Date.now()); openCall(game,n,l); break; }
        sayLine(phrase(line.i,line.q,line.any,line.z),'f'); break; }
      case 'next-guest': { const here = settleGuest(game); const at = here.findIndex(order => order.n === game.guest); game.guest = here[(at+1) % Math.max(1,here.length)]?.n ?? -1; drawGame(); break; }
      case 'go-counter': game.guest = Number(target.dataset.n); game.page = 'disken'; drawGame(); break;
      case 'note': if (target.dataset.id) sayWord(target.dataset.id); game.note = null; drawGame(); break;
      // Results
      case 'again': { const id = ui.resultsFor?.theme; if (id) beginSolo(id,ui.resultsFor.tier); break; }
      case 'to-shop': ui.game = null; ui.place.page = 'hylla'; show('shop'); break;
      case 'practice-wrong': { const ids = (ui.resultsFor?.review || []).map(row => row.item).filter(Boolean); ui.game = null; ui.place.page = 'hylla'; show('shop'); if (ids[0]) { const section = shopById(ui.place.shop).sections.find(entry => entry.items.includes(ids[0])); if (section) ui.place.section[ui.place.shop] = section.id; ui.browse.flash = {id:ids[0],at:Date.now()}; render(); openSheet('card',{id:ids[0]}); } break; }
      case 'review-add': addToWordbook((ui.resultsFor?.review || []).map(row => row.item).filter(Boolean)); break;
      case 'daily-tier': ui.prefs.tier = value; savePrefs(); render(); break;
      case 'daily-tab': ui.dailyTab = value === 'team' ? 'team' : 'solo'; render(); break;
      case 'daily-solo': beginSolo('daily',ui.prefs.tier); break;
      case 'help': show('help'); break;
      default: break;
    }
  }
  function onInput(event) {
    const node = event.target;
    if (!ui.sheet || !node?.dataset?.mlInput) return;
    if (node.dataset.mlInput === 'search') { ui.sheet.query = node.value; render(); const input = ui.root.querySelector('.ml-search'); input?.focus(); input?.setSelectionRange?.(node.value.length,node.value.length); }
    if (node.dataset.mlInput === 'join') ui.sheet.code = node.value.replace(/\D/g,'').slice(0,4);
  }
  function addToWordbook(ids) {
    const words = ids.map(id => productEntry(id)).filter(Boolean).map(item => ({word:item.word,meaning:item.zh,english:item.en || '',article:item.article || '',forms:item.forms || []}));
    if (!words.length || !ui.opts.addWords) return;
    try { ui.opts.addWords(words,tx('百货超市')); } catch { notify(tx('没能加入词本'),2000); }
  }
  // A thing tapped on the shelf. A garment the customer wants (right product, right colour) lifts and shows its size
  // tags; anything else is judged at once (服装：先判衣服和颜色，对了才弹吊牌).
  function tapItem(game,target) {
    const id = target.dataset.id, item = itemOf(id);
    if (game.phase !== 'play' || game.state.over) return;
    const from = target.querySelector('.ml-pic')?.getBoundingClientRect() || target.getBoundingClientRect();
    if (item.sizes.length) {
      const wanted = needing(game.state,game.guest).some(entry => fills(game.scene,entry.line,id) && entry.line.got.length < entry.line.q);
      if (wanted) { game.tags = {id,from,at:Date.now()}; drawGame(); return; }
    }
    act({t:'pick',i:id,z:'',c:game.guest},from);
  }
  function positionTags(game) {
    const stage = $('.ml-stage'), item = stage?.querySelector(`.ml-item[data-id="${CSS.escape(game.tags.id)}"]`), tags = stage?.querySelector('.ml-tags');
    if (!stage || !item || !tags) return;
    const box = stage.getBoundingClientRect(), at = item.getBoundingClientRect();
    const width = tags.offsetWidth, height = tags.offsetHeight;
    // Over the garment, unless that would cover the section tabs: then under it.
    const tabs = stage.querySelector('.ml-sections')?.getBoundingClientRect();
    let top = at.top-box.top-height+4;
    if (top < (tabs ? tabs.bottom-box.top : 4)) top = at.bottom-box.top-8;
    tags.style.left = `${Math.round(Math.max(6,Math.min(box.width-width-6,at.left-box.left+at.width/2-width/2)))}px`;
    tags.style.top = `${Math.round(top)}px`;
    if (!game.tags.focused) { game.tags.focused = true; tags.querySelector('.ml-size')?.focus({preventScroll:true}); }
  }
  // A customer tapped: they are the one served now; with a reply waiting the strip comes up, else their words again.
  function tapGuest(game,n) {
    const order = game.state.orders[n];
    if (!order || order.status !== 'wait') return;
    game.guest = n;
    game.basket = -1;
    const k = order.talks.findIndex(talk => talk.s === 'open' && talk.k !== 'fit');
    if (k >= 0) { openReply(game,n,k); return; }
    sayLine(sayingOf(game,order).text,order.voice);
    drawGame();
  }
  function openReply(game,n,k) {
    const order = game.state.orders[n], content = tplOf(game,order).talk[k];
    if (game.room) {
      const talk = order.talks[k];
      if (talk.by && talk.by !== game.me && talk.until > gameNow(game)) { notify(tx('{name} 在回应',{name:playerName(talk.by)}),1800); return; }
      if (talk.by !== game.me && !act({t:'open',c:n,k})?.ok) return;
    }
    game.calling = null;
    // The three replies stand in an order of their own for every reply (the same if it is opened again).
    const random = rng(hashText(`${game.id}:${n}:${k}`));
    const shuffle = [0,1,2];
    for (let i = 2; i > 0; i--) { const j = pick(random,i+1); [shuffle[i],shuffle[j]] = [shuffle[j],shuffle[i]]; }
    game.reply = {n,k,shuffle,chosen:-1};
    game.fresh.set('reply',Date.now());
    if (content?.ask) sayLine(content.ask[0],order.voice);
    drawGame();
    ui.root?.querySelector('.ml-reply .ml-answer')?.focus?.({preventScroll:true});
  }
  function chooseReply(game,o) {
    const reply = game.reply;
    if (!reply || reply.closing) return;
    const order = game.state.orders[reply.n], content = tplOf(game,order).talk[reply.k];
    const result = act({t:'say',c:reply.n,k:reply.k,o});
    if (!result?.ok) { game.reply = null; drawGame(); return; }
    const right = o === 0;
    reply.chosen = o;
    reply.closing = true;
    // The clerk's line, then the customer's answer; a wrong choice shows (and reads) the right one first.
    sayLine(content.opts[0][0],clerkVoice(),() => later(() => sayLine(content.reply[0],order.voice),150));
    drawGame();
    later(() => { if (game.reply === reply) { game.reply = null; drawGame(); } },right ? 700 : 2000);
  }
  // The fitting room: the customer being served goes in if their basket is ready (else whoever is ready); a room
  // with a customer waiting for an answer opens the reply.
  function tapRoom(game,room) {
    const n = game.state.rooms[room];
    if (n >= 0) {
      const order = game.state.orders[n], k = order.talks.findIndex(talk => talk.k === 'fit' && talk.s === 'open');
      if (k >= 0) { game.guest = n; openReply(game,n,k); return; }
      notify(tx('{name} 在试衣服',{name:nameOfCustomer(order.customer)}),1600);
      return;
    }
    const ready = seated(game.state).filter(order => order.svc === 'fit' && order.sv === 'none' && linesDone(order) && talksDone(order));
    const order = ready.find(entry => entry.n === game.guest) || ready[0];
    if (!order) { notify(tx('现在没有人要试衣'),1600); return; }
    act({t:'fit',c:order.n});
  }
  function tapTill(game) {
    const busy = seated(game.state).find(order => order.svc === 'till' && order.sv === 'in');
    if (busy) { const k = busy.talks.findIndex(talk => talk.k === 'till' && talk.s === 'open'); if (k >= 0) { game.guest = busy.n; openReply(game,busy.n,k); } return; }
    const ready = seated(game.state).filter(order => order.svc === 'till' && order.sv === 'none' && linesDone(order) && talksDone(order));
    const order = ready.find(entry => entry.n === game.guest) || ready[0];
    if (!order) { notify(tx('现在没有人要结账'),1600); return; }
    const result = act({t:'till',c:order.n});
    if (result?.ok) {
      play('print');
      game.guest = order.n;
      const k = order.talks.findIndex(talk => talk.k === 'till');
      later(() => { const now = game.state.orders[order.n]; if (ui.game === game && now?.status === 'wait' && now.talks[k]?.s === 'open') openReply(game,order.n,k); },reduceMotion() ? 0 : 700);
    }
  }

  /* ---------- The end of a game: the receipt ---------- */
  // From a game's learning record: the three things missed most (to come back to), and every word with how often it
  // was right and wrong (folded under the receipt).
  function learnedRows(learn) {
    const misses = new Map(), tally = new Map();
    for (const [word,ok] of learn) {
      if (!ok) misses.set(word,(misses.get(word) || 0)+1);
      const row = tally.get(word) || [0,0]; row[ok ? 0 : 1]++; tally.set(word,row);
    }
    const review = [...misses].sort((a,b) => b[1]-a[1]).slice(0,3).map(([word]) => ({word,item:word.startsWith('m-') && !word.startsWith('m-farge-') ? word.slice(2) : '',talk:word.startsWith('t-') ? word : ''}));
    return {review,words:[...tally].map(([word,[right,wrong]]) => ({word,right,wrong}))};
  }
  function finishSolo(game) {
    if (ui.game !== game) return;
    stopGame();
    const state = game.state, player = state.players[0], theme = game.theme, daily = game.themeId === 'daily';
    const target = targetFor(theme,state.minutes,state.tier), passed = passes(state.score,target,player.correct,player.wrong,false);
    const bit = {novice:1,standard:2,expert:4}[state.tier];
    const openBefore = [...openSet()], starsBefore = daily ? 0 : starsOf(theme.id);
    if (!daily) {
      // Played here: shown at once (and while offline) until the server's progress replaces it.
      const row = ui.progress.themes[theme.id] ||= {passed:0,best:0};
      const before = stars(row.passed);
      // A tier passed counts only when it was open (the one below passed).
      if (passed && tierOpen(before,state.tier)) row.passed |= bit;
      row.best = Math.max(row.best || 0,state.score);
      const day = beijingDay();
      for (const [word,ok] of player.learn) {
        const prev = ui.progress.words[word], record = prev ? {correct:prev[0],wrong:prev[1],mastered:prev[2] === 1,days:prev[3] || 0,lastDay:prev[4] || '',lastOk:prev[5] === 1,sinceMiss:prev[6] || 0,relapsed:prev[7] === 1} : {};
        const next = masteryStep(record,ok === 1,day);
        ui.progress.words[word] = [next.correct,next.wrong,next.mastered ? 1 : 0,next.days,next.lastDay,next.lastOk ? 1 : 0,next.sinceMiss,next.relapsed ? 1 : 0];
      }
      ui.prefs.progress = ui.progress;
      savePrefs();
    }
    const {review,words} = learnedRows(player.learn);
    // Score is the game's own; XP and stars are what the server's replay says (shown when it answers).
    const local = daily ? null : {theme:theme.id,bit:passed && tierOpen(starsBefore,state.tier) ? bit : 0,best:state.score};
    ui.resultsFor = {theme:game.themeId,tier:state.tier,score:state.score,served:state.served,gone:state.gone,target,passed,newStar:false,stars:daily ? 0 : starsBefore,
      starsBefore:daily ? null : starsBefore,starsAfter:null,openBefore,correct:player.correct,wrong:player.wrong,xp:null,upload:'sending',review,words,opened:[],counted:false,at:Date.now()};
    ui.resultsFor.sessionId = queueResult(game,local);
    ui.game = null;
    show('results');
    void flushPending();
  }
  // The game's log goes to the server, which replays it (POST /mall/result) and alone decides score, XP and stars
  // (as 开饭啦: one storage key per game, so two tabs never overwrite each other's results; one upload at a time).
  const RESULT_PREFIX = 'norsk-mall-result-v1:';
  const localResults = new Map(); // also carries a result to the server when browser storage is full
  let uploadFlight = null, uploadAgain = false;
  function queueResult(game,local) {
    const record = {sessionId:game.id,theme:game.themeId,...(game.header.day ? {day:game.header.day} : {}),seed:game.header.seed,tier:game.header.tier,minutes:game.header.minutes,
      weak:game.header.weak,rules:ui.data.rulesHash,playedAt:game.playedAt,durationMs:game.state.duration,log:packLog(game.scene,game.log),...(game.owner ? {owner:game.owner} : {})};
    const item = {deviceId:game.ownerDevice || '',record,local};
    localResults.set(record.sessionId,item);
    if (!writeJSON(RESULT_PREFIX+record.sessionId,item)) ui.resultsFor && (ui.resultsFor.storage = false);
    return record.sessionId;
  }
  function forgetResult(id) {
    localResults.delete(id);
    try { localStorage.removeItem(RESULT_PREFIX+id); } catch {}
  }
  function pendingResults() {
    // The first version kept one array; its games move to a key each.
    const legacy = readJSON(PENDING_KEY,[]);
    if (Array.isArray(legacy) && legacy.length) {
      let copied = true;
      for (const entry of legacy) if (entry?.record?.sessionId) {
        const item = {deviceId:'',record:{...entry.record,...(entry.nickname ? {owner:entry.nickname} : {})},local:null};
        localResults.set(item.record.sessionId,item);
        if (!writeJSON(RESULT_PREFIX+item.record.sessionId,item)) copied = false;
      }
      if (copied) try { localStorage.removeItem(PENDING_KEY); } catch {}
    }
    const items = new Map(localResults);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(RESULT_PREFIX)) continue;
        const item = readJSON(key,null);
        if (item?.record?.sessionId && key === RESULT_PREFIX+item.record.sessionId) items.set(item.record.sessionId,item);
      }
    } catch {}
    return [...items.values()].sort((a,b) => a.record.playedAt-b.record.playedAt);
  }
  function resultStatus(id,status) {
    if (ui.resultsFor?.sessionId === id) ui.resultsFor.upload = status;
  }
  async function drainResults() {
    const items = pendingResults();
    if (!items.length) return;
    const api = await community(), deviceId = api.localPlayer?.()?.deviceId || window.NorskCommunity?.localPlayer?.()?.deviceId || '';
    for (const {record,deviceId:ownerDevice} of items) {
      const id = record.sessionId;
      if (Date.now()-record.playedAt > 3*86400000) { forgetResult(id); resultStatus(id,'expired'); continue; }
      if (ownerDevice && deviceId && ownerDevice !== deviceId) { resultStatus(id,'identity'); continue; }
      const send = () => api.request('/mall/result',{method:'POST',body:record,timeout:12000});
      let reply;
      try {
        try { reply = await send(); } catch (error) {
          if (error?.code !== 'rate_limited') throw error;
          await new Promise(resolve => setTimeout(resolve,1200));
          reply = await send();
        }
        if (reply?.accepted !== true) break;
      } catch (error) {
        const code = error?.code;
        // Another nickname, or a theme this nickname has not opened: kept until it can be sent by its owner.
        if (code === 'identity_changed' || code === 'theme_locked' || code === 'tier_locked') { resultStatus(id,'identity'); continue; }
        // A newer page plays by other rules: kept (a later server may accept the same game again).
        if (code === 'update_required') { resultStatus(id,'version'); continue; }
        if (code === 'invalid_request') { forgetResult(id); resultStatus(id,'invalid'); continue; }
        break; // offline or the service is busy: retried later
      }
      forgetResult(id);
      const r = ui.resultsFor;
      if (r?.sessionId === id) {
        const after = Number.isInteger(reply.stars) ? reply.stars : null;
        Object.assign(r,{xp:Number.isFinite(reply.xp) ? reply.xp : null,upload:'done',starsAfter:after,newStar:after !== null && r.starsBefore !== null && after > r.starsBefore,
          opened:(reply.progress?.unlocked || []).filter(theme => !r.openBefore.includes(theme))});
      }
    }
  }
  function flushPending() {
    if (uploadFlight) { uploadAgain = true; return uploadFlight; }
    uploadFlight = (async () => {
      do {
        uploadAgain = false;
        try { await drainResults(); } catch {}
      } while (uploadAgain);
    })().finally(() => {
      uploadFlight = null;
      const r = ui.resultsFor;
      if (r && !r.room && r.upload === 'sending') r.upload = readJSON(RESULT_PREFIX+r.sessionId,null) || localResults.has(r.sessionId) ? 'offline' : 'unsaved';
      void loadProgress();
      if (ui.open && ui.view === 'results') render();
    });
    return uploadFlight;
  }
  function countResults() {
    const r = ui.resultsFor, node = $('.ml-receipt-score b');
    if (!r || !node || r.counted) return;
    r.counted = true;
    if (reduceMotion() || !r.score) return;
    const at = performance.now();
    const step = time => {
      const k = Math.min(1,(time-at)/1100), shown = $('.ml-receipt-score b');
      if (ui.resultsFor !== r) return;
      if (shown) shown.textContent = String(Math.round(r.score*(1-(1-k)**3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    later(() => play('print'),200);
    if (r.newStar) later(() => play('stamp'),1700);
  }
  function resultsPage() {
    const r = ui.resultsFor;
    if (!r) return `${topBar(tx('小票'),'shop')}<p class="ml-empty">${tx('没有这一班的记录。')}</p>`;
    const theme = themeById(r.theme), shop = shopById(theme?.shop);
    const reviewRows = r.review.map(row => {
      if (row.item) return `<li><button type="button" class="ml-receipt-row" data-ml="hear-word" data-id="${e(row.item)}">${pic(row.item,'is-tiny')}<span>${wordHTML(row.item)}<small>${e(zhOf(row.item))}</small></span>${icon('speaker')}</button></li>`;
      if (row.word.startsWith('m-farge-')) { const color = ui.data.colors[row.word.slice(8)]; return `<li><span class="ml-receipt-row"><span class="ml-swatch" style="--ml-tint:${color?.hex}"></span><span><span lang="nb">${e(color?.no || '')}</span><small>${e(color?.zh || '')}</small></span></span></li>`; }
      const [,themeId,order,k] = /^t-(M\d\d)\.(.+)-(\w+)$/.exec(row.word) || [];
      const tpl = themeById(themeId)?.orders.find(entry => entry.id === `${themeId}.${order}`), talk = tpl?.talk.find(entry => entry.k === k);
      return talk ? `<li><button type="button" class="ml-receipt-row" data-ml="hear-line" data-value="${e(talk.opts[0][0])}" data-voice="f"><span><span lang="nb">${e(talk.opts[0][0])}</span><small>${e(talk.opts[0][1])}</small></span>${icon('speaker')}</button></li>` : '';
    }).join('');
    const date = new Date(r.at), day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    return `${topBar(tx('营业小票'),r.room ? '' : r.theme === 'daily' ? 'daily' : 'shop')}
      <section class="ml-receipt-wrap"><div class="ml-receipt">
        <header class="ml-receipt-head"><b lang="nb">${e(shop?.sign || 'Varehuset')}</b><small lang="nb">Kvittering · ${day}</small><small>${e(theme?.no || '')} · ${tierName(r.tier)}</small></header>
        <ul class="ml-receipt-lines"><li><span>${tx('交付')}</span><b>${tx('{n} 袋',{n:r.served})}</b></li><li><span>${tx('走掉的顾客')}</span><b>${r.gone}</b></li><li><span>${tx('答对 / 答错')}</span><b>${r.correct} / ${r.wrong}</b></li><li><span>${tx('经验')}</span><b>${['invalid','expired'].includes(r.upload) ? '—' : r.xpPending || r.xp == null ? '…' : `+${r.xp}`}</b></li></ul>
        ${uploadNote(r) ? `<p class="ml-receipt-upload">${uploadNote(r)}</p>` : ''}
        <p class="ml-receipt-score"><span>${tx('营业分')}</span><b>${r.score}</b><small>★ ${r.target}</small></p>
        <p class="ml-receipt-result${r.passed ? ' is-pass' : ''}">${r.passed ? tx('过了{tier}关',{tier:tierName(r.tier)}) : r.room && r.score >= r.target ? tx('全队到了目标；自己答 5 次以上、答对 80% 才算过关') : tx('差 {n} 分过关',{n:Math.max(0,r.target-r.score)})}${r.theme !== 'daily' ? starRow(r.room ? starsOf(r.theme) : r.starsAfter ?? r.starsBefore ?? r.stars,'is-small') : ''}</p>
        ${r.room && r.players?.length ? `<section class="ml-receipt-crew"><h3>${tx('一起营业的同学')}</h3><ul>${r.players.map(player => `<li class="${player.me ? 'is-me' : ''}"><span>${e(L10N.name(player.name))}</span><small>${tx('答对 {right} · 答错 {wrong}',{right:player.correct,wrong:player.wrong})}${Number.isFinite(player.xp) ? ` · +${player.xp} XP` : ''}</small></li>`).join('')}</ul></section>` : ''}
        ${r.newStar ? `<span class="ml-stamp" aria-hidden="true">${icon('star')}<b>${'★'.repeat(r.stars)}</b></span>` : ''}
        ${r.opened?.length ? `<p class="ml-receipt-opened">${icon('star')}<span>${tx('新开放')}${L10N.english ? ': ' : '：'}${r.opened.map(id => `<button type="button" class="ml-link" data-ml="goto-theme" data-value="${e(id)}"><span lang="nb">${e(shopById(themeById(id)?.shop)?.sign)}</span> · ${e(themeById(id)?.no || id)}</button>`).join(L10N.english ? ', ' : '，')}</span></p>` : ''}
        ${reviewRows ? `<section class="ml-receipt-review"><h3>${tx('下次再练这几样')}</h3><ul>${reviewRows}</ul>${r.review.some(row => row.item) && ui.opts.addWords ? `<button type="button" class="ml-link" data-ml="review-add">${icon('book')}${tx('加入词本')}</button>` : ''}</section>` : ''}
        ${r.words.length ? `<details class="ml-receipt-all"><summary>${tx('本班全部词语（{n}）',{n:r.words.length})}</summary><ul>${r.words.map(row => `<li>${wordLabel(row.word)}<small>${row.wrong ? tx('错 {n}',{n:row.wrong}) : '✓'}</small></li>`).join('')}</ul></details>` : ''}
      </div></section>
      <div class="ml-start-bar"><div class="ml-actions">${r.room ? button('to-room',tx('回到房间'),'ml-primary') : `${button('again',tx('再营业一班'),'ml-primary')}${button('to-shop',tx('回店里看看'),'ml-ghost')}`}${!r.room && r.review.some(row => row.item) ? button('practice-wrong',tx('练出错的'),'ml-ghost') : ''}</div></div>`;
  }
  // What became of a solo game's upload (the receipt's XP and stars are the server's).
  function uploadNote(r) {
    if (r.room) return r.closedTier ? tx('这一关你还没开放，这一班不记星') : '';
    return ({sending:tx('正在上传成绩…'),offline:tx('成绩已存在这台设备上，联网后自动补传。'),unsaved:tx('设备没能保存成绩，请保持此页打开，联网后会再上传。'),
      identity:tx('这一班属于原来的昵称；切回原昵称后会补传。'),version:tx('成绩还在，规则版本不同，刷新页面后再补传。'),
      expired:tx('这一班超过三天补传期限，没有计入。'),invalid:tx('服务器没有接受这一班的记录，没有计入。')})[r.upload] || '';
  }
  // A learning record's word as the receipt shows it: a thing, a colour, or a reply the clerk gave.
  function wordLabel(word) {
    if (word.startsWith('m-farge-')) { const color = ui.data.colors[word.slice(8)]; return `<span lang="nb">${e(color?.no || '')}</span> <span class="ml-muted">${e(color ? tx(color.zh) : '')}</span>`; }
    if (word.startsWith('m-')) return `${wordHTML(word.slice(2))} <span class="ml-muted">${e(zhOf(word.slice(2)))}</span>`;
    const [,themeId,order,k] = /^t-(M\d\d)\.(.+)-(\w+)$/.exec(word) || [];
    const talk = themeById(themeId)?.orders.find(entry => entry.id === `${themeId}.${order}`)?.talk.find(entry => entry.k === k);
    return talk ? `<span lang="nb">${e(talk.opts[0][0])}</span>` : e(word);
  }
  function dailyPage() {
    const daily = ui.daily, shop = daily ? shopById(daily.theme.shop) : null;
    const board = list => list?.length ? `<ol class="ml-board">${list.slice(0,10).map((row,i) => `<li><span>${i+1}</span><b>${e((Array.isArray(row.names) ? row.names : [row.names || row.name || '']).map(name => L10N.name(name)).join(' · '))}</b><small>${row.score}</small></li>`).join('')}</ol>` : `<p class="ml-empty">${daily?.local ? tx('排行榜联网后显示。') : tx('今天还没有人营业，来做第一位吧。')}</p>`;
    return `${topBar(`<span lang="nb">Dagens vakt</span> · ${tx('今日营业')}`,'building')}
      <section class="ml-daily">${shop ? `<p class="ml-kicker" lang="nb">${e(shop.sign)}</p><p class="ml-daily-title">${e(tx(shop.zh))}</p>` : ''}
        <p class="ml-hint">${tx('每天全服同一家店、同一组顾客，不受楼层和主题的限制。档位自己选。')}</p>
        <div class="ml-options" role="radiogroup" aria-label="${tx('档位')}">${TIER_IDS.map(tier => `<button type="button" class="ml-option${ui.prefs.tier === tier ? ' is-on' : ''}" role="radio" aria-checked="${ui.prefs.tier === tier}" data-ml="daily-tier" data-value="${tier}"><span>${tierName(tier)}</span><small>${tierHint(tier)}</small></button>`).join('')}</div>
        <div class="ml-actions">${button('daily-solo',tx('单人开店'),'ml-primary',shop ? '' : 'disabled')}${button('start-room',tx('和同学一起'),'ml-ghost')}</div>
        <nav class="ml-daily-tabs" role="tablist">${['solo','team'].map(tab => `<button type="button" role="tab" class="ml-text-button${ui.dailyTab === tab ? ' is-on' : ''}" data-ml="daily-tab" data-value="${tab}" aria-selected="${ui.dailyTab === tab}">${tab === 'solo' ? tx('单人榜') : tx('合作榜')}</button>`).join('')}</nav>
        ${board(ui.dailyTab === 'team' ? daily?.team : daily?.solo)}</section>`;
  }
  function helpPage() { return `${topBar(L10N.english ? tx('百货超市玩法') : tx('玩法'),'building')}<p class="ml-empty">${tx('顾客说要什么，就去货架上点那样东西；衣服点了再点尺码吊牌。')}</p>`; }


  /* ---------- Rooms: 和同学一起 (the server referees: scripts/community_api.py, MALL ROOMS) ---------- */
  // As 开饭啦: polls are held on the server until the room changes; my own taps take effect here at once and go to the
  // server in order (the outbox); every state the server sends replaces mine, with my unconfirmed taps played on top.
  const POLL_GAP_MS = 100, POLL_TIMEOUT_MS = 12000, POLL_HIDDEN_MS = 4000, ACT_STALE_MS = 8000;
  const serverNow = () => Date.now()+(ui.clock?.offset || 0);
  function syncClock(serverTime,sentAt,receivedAt) {
    if (!Number.isFinite(serverTime)) return;
    const clock = ui.clock, rtt = Math.max(0,receivedAt-sentAt), offset = serverTime-(sentAt+receivedAt)/2;
    // Samples with quick round trips are trusted most.
    ui.clock = !clock || rtt <= clock.rtt*1.25+30 || clock.age >= 20 ? {offset,rtt,age:0} : {...clock,rtt:clock.rtt*1.05,age:clock.age+1};
  }
  // By the error's code: the server's own message is Chinese.
  const roomError = error => ({room_not_found:tx('房间不存在或已过期，请核对房号。'),room_full:tx('这个房间已经满了。'),not_in_room:tx('你已不在这个房间。'),
    rate_limited:tx('操作有点频繁，请稍等片刻。'),not_host:tx('只有房主可以这样做。'),room_busy:tx('这一班正在营业，等它结束再改。'),
    theme_locked:tx('房主还没有开放这个主题，请换一个。'),tier_locked:tx('这个档位还没有开放。'),same_person:tx('这个昵称已在房间里，请换一个昵称。'),not_ready:tx('还在载入，请稍等。'),
    update_required:tx('百货超市有新版本，请刷新页面后再进房间。'),timeout:tx('网络有点慢，请再试一次。'),too_many_rooms:tx('现在开着的房间太多了，请稍后再试。'),
    unauthorized:tx('联机身份失效了，请刷新页面后再试。')}[error?.code] || tx('联机暂时连不上，请检查网络后重试。'));
  async function call(path,body,options = {}) {
    const api = await community();
    const sentAt = Date.now();
    const data = await api.request(`/mall${path}`,body === undefined ? {timeout:options.timeout || 8000,...(options.poll ? {duelPoll:options.poll} : {})} : {method:'POST',body,timeout:10000});
    // The time a poll was held on the server is not network time.
    syncClock(data?.serverTime,sentAt+Math.max(0,Number(data?.heldMs) || 0),Date.now());
    return data;
  }
  function setRoomInURL(code) {
    try {
      const url = new URL(location.href);
      if (code) url.searchParams.set('mall',code); else if (url.searchParams.has('mall')) url.searchParams.delete('mall'); else return;
      history.replaceState(history.state,'',url.href);
    } catch {}
  }
  const playerName = id => L10N.name((ui.room?.players || []).find(player => player.id === id)?.name || tx('同学'));
  async function createRoom(themeId,tier) {
    if (ui.busy || !ui.data) return;
    if (themeId !== 'daily' && !themeOpen(themeId)) { notify(tx('这个主题还没有开放')); return; }
    ui.busy = true;
    try {
      const state = await call('/rooms',{theme:themeId,tier,minutes:ui.prefs.minutes,rules:ui.data.rulesHash || ''});
      if (ui.open) enterRoom(state);
    } catch (error) { notify(roomError(error),2600); }
    finally { ui.busy = false; }
  }
  async function joinRoom(code) {
    if (ui.busy) return;
    ui.busy = true;
    try {
      await loadData().catch(() => null);
      const state = await call(`/rooms/${code}/join`,{rules:ui.data?.rulesHash || ''});
      if (ui.open) enterRoom(state);
    } catch (error) { notify(roomError(error),2600); setRoomInURL(null); }
    finally { ui.busy = false; }
  }
  function enterRoom(state) {
    ui.room = null;
    ui.roomSession = {polling:false};
    ui.failures = 0;
    ui.roomEdit = false;
    ui.sheet = null;
    setRoomInURL(state.code);
    applyRoom(state);
    if (!['preview','game','results'].includes(ui.view)) show('room');
    schedulePoll(POLL_GAP_MS);
  }
  function leaveRoom() {
    const room = ui.room;
    if (!room) return;
    ui.room = null;
    ui.roomSession = null;
    clearTimeout(ui.pollTimer);
    setRoomInURL(null);
    if (ui.game?.room) { stopGame(); ui.game = null; }
    void call(`/rooms/${room.code}/leave`,{}).catch(() => {});
  }
  function lostRoom(message) {
    ui.room = null;
    ui.roomSession = null;
    clearTimeout(ui.pollTimer);
    setRoomInURL(null);
    if (ui.game?.room) { stopGame(); ui.game = null; }
    if (ui.confirming) hideConfirm();
    notify(message,2600);
    show('building');
  }
  function schedulePoll(delay) {
    clearTimeout(ui.pollTimer);
    if (!ui.open || !ui.room) return;
    ui.pollTimer = setTimeout(poll,Math.max(0,delay));
  }
  async function poll() {
    const room = ui.room, session = ui.roomSession;
    if (!room || !session || !ui.open || session.polling) return;
    session.polling = true;
    try {
      const data = await call(`/rooms/${room.code}`,undefined,{poll:`${room.version}/${room.match ? room.match.number : '-'}`,timeout:POLL_TIMEOUT_MS});
      if (ui.roomSession !== session) return;
      if (ui.failures >= 2) notify(tx('又连上了'),1400);
      ui.failures = 0;
      if (!data.unchanged) applyRoom(data);
      schedulePoll(document.hidden ? POLL_HIDDEN_MS : Number.isFinite(data.heldMs) ? POLL_GAP_MS : 900);
    } catch (error) {
      if (ui.roomSession !== session) return;
      if (['room_not_found','not_in_room'].includes(error?.code)) { lostRoom(roomError(error)); return; }
      ui.failures = (ui.failures || 0)+1;
      if (ui.failures === 2) notify(tx('网络断了，正在重新连接…'),0);
      schedulePoll(error?.code === 'rate_limited' ? 4000 : Math.min(8000,800*2**Math.min(ui.failures-1,3)));
    } finally { session.polling = false; }
  }
  // Everything the room says: the lobby, a game loading, the preview, the countdown, play, the receipt.
  function applyRoom(state) {
    if (!state || !state.code) return;
    const current = ui.room;
    if (current && (current.code !== state.code || state.version < current.version ||
        (state.version === current.version && state.serverTime < current.serverTime))) return;
    ui.room = state;
    const match = state.match, me = state.me;
    const taking = match && (match.participants || []).includes(me);
    if (match && taking && ['loading','preview','countdown','playing'].includes(state.status)) {
      let game = ui.game?.room && ui.game.number === match.number ? ui.game : null;
      if (!game) {
        game = roomGame(match,me);
        if (!game) return;
        stopGame();
        ui.game = game;
        prefetchGame(game);
      }
      game.startsAt = match.startsAt || game.startsAt;
      syncGame(game,match);
      if (state.status === 'loading' && !game.loadedSent) { game.loadedSent = true; later(() => { if (ui.game === game) void roomAction('ready',{loaded:true},true); },300); }
      if (state.status === 'loading' || state.status === 'preview') {
        if (ui.view !== 'preview') show('preview'); else render();
        schedulePreviewTimer();
      } else if (state.status === 'countdown') {
        if (game.phase !== 'countdown') countdown(game,Math.max(0,match.startsAt-serverNow()));
      } else if (state.status === 'playing' && game.phase !== 'play') {
        // Arriving late (a reload) joins the game where it is.
        ui.view = 'game';
        startPlay(game);
      } else if (ui.view === 'game') drawGame();
      return;
    }
    if (state.status === 'finished' && state.results && ui.game?.room && ui.game.number === state.results.number) { finishRoomGame(state.results); return; }
    // The XP of a room game is written a moment after it ends and reaches the receipt then.
    if (state.results && ui.view === 'results' && ui.resultsFor?.room && ui.resultsFor.number === state.results.number) {
      const mine = (state.results.players || []).find(player => player.id === me);
      Object.assign(ui.resultsFor,{xp:mine?.xp ?? ui.resultsFor.xp,xpPending:state.results.xpPending,players:(state.results.players || []).map(player => ({...player,me:player.id === me}))});
      render();
      return;
    }
    if (ui.game?.room) { stopGame(); ui.game = null; if (['preview','game'].includes(ui.view)) { show('room'); return; } }
    if (ui.view === 'room') render();
  }
  function roomGame(match,me) {
    if (!ui.data) return null;
    const theme = match.theme === 'daily' ? dailyTheme(ui.data,match.seed >>> 0) : themeById(match.theme);
    if (!theme) return null;
    const scene = themeRules(ui.data,theme);
    return newGame({themeId:match.theme,theme,scene,state:JSON.parse(JSON.stringify(match.state)),extra:{room:true,me,number:match.number,startsAt:match.startsAt || 0,
      seq:match.ack?.[me] || 0,outbox:[],seen:0,base:match.state,header:{theme:match.theme,tier:match.tier,minutes:match.minutes}}});
  }
  function schedulePreviewTimer() {
    clearTimeout(ui.previewTimer);
    if (ui.view !== 'preview' || !ui.room?.match?.previewEndsAt) return;
    ui.previewTimer = setTimeout(() => {
      const node = $('#ml-preview-wait');
      if (node) node.textContent = readyLine();
      schedulePreviewTimer();
    },500);
  }
  function readyLine() {
    const match = ui.room?.match;
    if (!match) return '';
    if (!match.previewEndsAt) return tx('正在载入这一班…');
    const left = Math.max(0,Math.ceil((match.previewEndsAt-serverNow())/1000));
    return tx('{ready}/{all} 位准备好了 · {n} 秒后开门',{ready:(match.prepared || []).length,all:(match.participants || []).length,n:left});
  }
  // The server's state, then my own taps it has not confirmed yet, played on top.
  function syncGame(game,match) {
    if (!match.state) return;
    game.base = match.state;
    game.seatOf ||= {};
    for (const order of seated(game.state)) game.seatOf[order.n] = order.seat;
    const ack = match.ack?.[game.me] || 0;
    game.outbox = game.outbox.filter(item => item.s > ack);
    for (const event of match.events || []) {
      if (event.seq <= game.seen) continue;
      game.seen = event.seq;
      if (event.by !== game.me) roomReact(event,game);
    }
    rebuild(game);
  }
  function rebuild(game) {
    const state = JSON.parse(JSON.stringify(game.base));
    for (const item of game.outbox) apply(state,game.scene,{...item.action,by:game.me},item.at);
    const events = game.phase === 'play' ? advance(state,game.scene,gameNow(game)).filter(event => remember(game,event)) : [];
    game.state = state;
    if (events.length) react(events,game);
  }
  // What a classmate did, as it reaches me.
  function roomReact(event,game) {
    switch (event.e) {
      case 'call':
        if (event.to === game.me) {
          game.calls.set(event.i,Date.now()+6000);
          play('call');
          notify(tx('{name} 喊你拿：{word}',{name:playerName(event.by),word:productEntry(event.i)?.word || ''}),2600);
          sayWord(event.i);
        }
        break;
      case 'pick': if (Number.isInteger(event.n)) game.fresh.set(`got:${event.n}.${event.l}`,Date.now()); break;
      case 'away': notify(tx('{name} 暂时离开，分区交给了同学',{name:playerName(event.by)}),2400); break;
      case 'home': notify(tx('{name} 回来了',{name:playerName(event.by)}),1600); break;
      case 'serve': case 'complete': case 'change': case 'fitin': case 'fitres': case 'fitted':
        if (remember(game,event)) react([event],game);
        break;
      default: break;
    }
  }
  function queueAction(game,action,at,result) {
    game.outbox.push({s:++game.seq,action,at,sentAt:Date.now(),predicted:result.ok});
    void flushOutbox(game);
  }
  // One request at a time carries every tap not confirmed yet; a tap unconfirmed for 8 s is given up and the room
  // fetched again.
  async function flushOutbox(game) {
    if (game.inflight || !ui.room || ui.game !== game) return;
    if (game.outbox.some(item => Date.now()-item.sentAt > ACT_STALE_MS)) {
      game.outbox = [];
      rebuild(game);
      drawGame();
      schedulePoll(0);
      return;
    }
    const batch = game.outbox.slice(0,16);
    if (!batch.length) return;
    game.inflight = true;
    try {
      const data = await call(`/rooms/${ui.room.code}/act`,{m:game.number,a:batch.map(item => ({s:item.s,...item.action}))});
      if (ui.game !== game) return;
      applyRoom(data);
      for (const res of data.res || []) {
        const sent = batch.find(item => item.s === res.s);
        if (sent && sent.predicted && !res.ok) notify(WHY[res.why]?.() || tx('这一下没有成功'),2200);
      }
      drawGame();
    } catch (error) {
      if (ui.game === game && ['room_not_found','not_in_room'].includes(error?.code)) { lostRoom(roomError(error)); return; }
      game.failedAt = Date.now();
    } finally {
      game.inflight = false;
      const wait = Date.now()-(game.failedAt || 0) < 2000 ? 900 : game.outbox.some(item => Date.now()-item.sentAt > 1500) ? 600 : 0;
      if (ui.game === game && game.outbox.length) later(() => flushOutbox(game),wait);
    }
  }
  function finishRoomGame(results) {
    stopGame();
    ui.game = null;
    play('finish');
    const me = (results.players || []).find(player => player.id === ui.room?.me) || {correct:0,wrong:0,xp:null};
    const {review,words} = learnedRows(results.me?.learn || []);
    const closedTier = results.theme !== 'daily' && !(themeOpen(results.theme) && tierOpen(starsOf(results.theme),results.tier));
    ui.resultsFor = {room:true,closedTier,number:results.number,theme:results.theme,tier:results.tier,score:results.score,served:results.served,gone:results.gone,target:results.target,
      passed:!closedTier && passes(results.score,results.target,me.correct,me.wrong,true),newStar:false,stars:0,correct:me.correct,wrong:me.wrong,xp:me.xp ?? null,xpPending:results.xpPending,
      players:(results.players || []).map(player => ({...player,me:player.id === ui.room?.me})),review,words,opened:[],counted:false,at:Date.now()};
    show('results');
    void loadProgress();
  }
  async function roomAction(name,body,quiet = false) {
    const room = ui.room, session = ui.roomSession;
    if (!room) return null;
    try {
      const data = await call(`/rooms/${room.code}/${name}`,body);
      if (ui.roomSession !== session) return null;
      applyRoom(data);
      return data;
    } catch (error) {
      if (ui.roomSession !== session) return null;
      if (['room_not_found','not_in_room'].includes(error?.code)) lostRoom(roomError(error));
      else if (!quiet || error?.code !== 'service_unavailable') notify(roomError(error),2600);
      return null;
    }
  }
  // 开门 by a host who has not said 准备好了 opens the shop with the host in it (the server starts a shift with the
  // ready players only, so without this the host would be left watching their own room).
  async function startRoomNow() {
    const room = ui.room, me = (room?.players || []).find(player => player.id === room.me);
    if (me && !me.ready) {
      const data = await roomAction('ready',{ready:true});
      if (!data || !['lobby','finished'].includes(ui.room?.status)) return;
    }
    void roomAction('start',{});
  }
  async function copyInvite() {
    const code = ui.room?.code;
    if (!code) return;
    const url = `${location.origin}${location.pathname}?mall=${code}#practice`;
    const text = tx('来「百货超市」一起营业，房号 {code}：{url}',{code,url});
    try {
      if (navigator.share && navigator.maxTouchPoints > 0) { await navigator.share({title:tx('百货超市'),text,url}); return; }
      await navigator.clipboard.writeText(text);
      notify(tx('邀请链接已复制'));
    } catch { notify(tx('房号 {code}',{code})); }
  }
  // A theme as a room shows it: the shop's sign and the theme's own name.
  function themeLabel(id) {
    if (id === 'daily') return `<span lang="nb">Dagens vakt</span> · ${tx('今日营业')}`;
    const theme = themeById(id);
    return theme ? `<span lang="nb">${e(shopById(theme.shop)?.sign)} · ${e(theme.no)}</span> <small>${e(tx(theme.zh))}</small>` : '';
  }
  function roomPage() {
    const room = ui.room;
    if (!room) return `${topBar(tx('房间'),'building')}<p class="ml-empty">${tx('正在进房间…')}</p>`;
    const host = room.hostId === room.me, me = (room.players || []).find(player => player.id === room.me);
    const settings = room.settings || {}, between = ['lobby','finished'].includes(room.status);
    const stars = settings.theme === 'daily' ? 2 : starsOf(settings.theme);
    let editor = '';
    if (host && between && ui.roomEdit) {
      const open = openSet(), themes = (ui.data?.themes || []).filter(theme => open.has(theme.id));
      editor = `<div class="ml-lobby-editor">
        <div class="ml-lobby-themes" role="radiogroup" aria-label="${tx('主题')}">${['daily',...themes.map(theme => theme.id)].map(id => `<button type="button" class="ml-lobby-theme${settings.theme === id ? ' is-on' : ''}" role="radio" aria-checked="${settings.theme === id}" data-ml="room-theme" data-value="${e(id)}">${themeLabel(id)}</button>`).join('')}</div>
        <div class="ml-options" role="radiogroup" aria-label="${tx('档位')}">${TIER_IDS.map(tier => { const ok = settings.theme === 'daily' || tierOpen(stars,tier); return `<button type="button" class="ml-option${settings.tier === tier ? ' is-on' : ''}${ok ? '' : ' is-locked'}" role="radio" aria-checked="${settings.tier === tier}" data-ml="room-tier" data-value="${tier}" ${ok ? '' : 'disabled'}><span>${tierName(tier)}</span><small>${tierHint(tier)}</small></button>`; }).join('')}</div>
        <div class="ml-options is-minutes" role="radiogroup" aria-label="${tx('时长')}">${MINUTES.map(n => `<button type="button" class="ml-option is-small${settings.minutes === n ? ' is-on' : ''}" role="radio" aria-checked="${settings.minutes === n}" data-ml="room-minutes" data-value="${n}">${tx('{n} 分钟',{n})}</button>`).join('')}</div></div>`;
    }
    const players = (room.players || []).map(player => `<li class="${player.id === room.me ? 'is-me' : ''}${player.online === false ? ' is-offline' : ''}"><span class="ml-avatar">${e(initial(L10N.name(player.name)))}</span>
      <span class="ml-crew-name">${e(L10N.name(player.name))}${player.host ? `<small>${tx('房主')}</small>` : ''}</span><span class="ml-crew-state">${player.online === false ? tx('离线') : player.playing ? tx('在营业') : player.ready ? `${icon('check')}${tx('准备好了')}` : tx('还没准备')}</span></li>`).join('');
    const watching = !between && !(room.match?.participants || []).includes(room.me);
    const status = watching ? tx('这一班正在营业，下一班再一起') : room.readyCount && room.readyCount === room.here ? tx('都准备好了，马上开门') : host ? tx('大家都准备好会自动开门；也可以先开门') : tx('准备好后等房主开门');
    return `${topBar(tx('房间'),'')}
      <section class="ml-lobby">
        <div class="ml-lobby-head"><div><span class="ml-kicker">${tx('房号')}</span><p class="ml-lobby-code">${e(room.code)}</p></div>${button('invite',`${icon('people')}<span>${tx('邀请同学')}</span>`,'ml-ghost')}</div>
        <div class="ml-lobby-card"><div class="ml-lobby-card-head"><h3>${tx('下一班')}</h3>${host && between ? `<button type="button" class="ml-link" data-ml="room-edit">${ui.roomEdit ? tx('收起') : tx('修改')}</button>` : ''}</div>
          <p class="ml-lobby-setting"><b>${themeLabel(settings.theme)}</b><span>${e(tierName(settings.tier))} · ${tx('{n} 分钟',{n:settings.minutes || DEFAULT_MINUTES})}</span></p>${editor}</div>
        <div class="ml-lobby-card"><div class="ml-lobby-card-head"><h3>${tx('店员')}</h3><span class="ml-muted">${tx('{n} 人',{n:(room.players || []).length})}</span></div><ul class="ml-crew">${players}</ul></div>
      </section>
      <div class="ml-start-bar">${between ? `<div class="ml-actions">${button('room-ready',me?.ready ? tx('取消准备') : tx('准备好了'),me?.ready ? 'ml-ghost' : 'ml-primary')}${host ? button('room-start',tx('开门'),'ml-ghost') : ''}</div>` : ''}<p class="ml-hint ml-center">${status}</p></div>`;
  }
  // 喊话: a thing on the shopping list that stands in a classmate's section is asked for by its Norwegian word, picked
  // out of four (the rules' distractors); the right word lights the thing up on the holder's shelf.
  function openCall(game,n,l) {
    const order = game.state.orders[n], line = order?.lines[l];
    if (!line || line.s !== 'open' || line.hide || line.got.length >= line.q) return;
    const product = game.scene.productOf[line.i];
    const mineProducts = game.scene.items.filter(id => mine(game.state,{id:game.me},id,game.scene)).map(id => game.scene.productOf[id]);
    game.calling = {n,l,product,options:distractors(game.scene,product,[...new Set(mineProducts)],hashText(`${game.id}:${n}:${l}`)),at:Date.now()};
    game.reply = null;
    sayLine(phrase(line.i,line.q,line.any,line.z),'f');
    drawGame();
    ui.root?.querySelector('.ml-reply.is-call .ml-answer')?.focus?.({preventScroll:true});
  }
  function callMarkup(game) {
    const calling = game.calling, order = calling ? game.state.orders[calling.n] : null;
    if (!order || order.status !== 'wait') { game.calling = null; return ''; }
    const novice = game.state.tier === 'novice', who = playerName(holder(game.state,order.lines[calling.l].i,game.scene));
    return `<div class="ml-reply is-call" role="dialog" aria-label="${tx('喊同学拿')}" style="--ml-fx:${since(game,'call',260) || OVER}">
      <header class="ml-reply-head"><span class="ml-avatar is-small">${e(initial(who))}</span><p class="ml-call-ask">${tx('请 {name} 拿哪一样？选出挪威语',{name:e(who)})}</p>${closeMini('call-close')}</header>
      <ol class="ml-answers is-words">${calling.options.map(product => `<li><button type="button" class="ml-answer" data-ml="call-pick" data-value="${e(product)}">${wordHTML(product)}${novice ? `<small>${e(zhOf(product))}</small>` : ''}</button></li>`).join('')}</ol></div>`;
  }
  function chooseCall(game,product) {
    const calling = game.calling;
    if (!calling) return;
    game.calling = null;
    const order = game.state.orders[calling.n], line = order?.lines[calling.l];
    const result = act({t:'call',c:calling.n,l:calling.l,i:product});
    if (!result) return;
    if (result.ok) { play('call'); sayWord(product); notify(tx('已经喊 {name} 拿',{name:playerName(holder(game.state,line.i,game.scene))}),1800); return; }
    if (result.why === 'wrong' && line) { notify(tx('要的是 {word}',{word:productEntry(line.i)?.word || ''}),2400); sayWord(line.i); }
  }

  window.NorskMall = {open,close:() => requestClose(),isOpen:() => ui.open,rules:RULES};
})();
