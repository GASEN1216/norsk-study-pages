/* 开饭啦 · Vær så god: a co-op learning kitchen. Loaded on demand; nothing touches the page until open().
   Customers order dishes; the kitchen answers in Norwegian: tap the dish's name to take the order, the ingredients'
   words to fill the plate, the right verb to cook, and hand it over with "Vær så god!". Played alone in the browser
   (the server replays the action log to score it) or with up to four classmates in one kitchen, where every
   ingredient sits on one player's shelf and the server referees (scripts/community_api.py runs the same rules). */
(() => {
  'use strict';
  if (window.NorskKitchen) return;

  /* ---------- Rules and tuning (community_api.py's KC_* constants hold the same values) ---------- */
  const PREFS_KEY = 'norsk-kitchen-v1', PENDING_KEY = 'norsk-kitchen-pending-v1';
  // Hint tiers: what the customer's bubble and the order slips show. Answers are always the written Norwegian word.
  const TIERS = {novice:{name:'新手',hint:'图 + 中文',xp:2},standard:{name:'标准',hint:'只有图',xp:3},expert:{name:'高手',hint:'只听声音',xp:4}};
  const TIER_IDS = ['novice','standard','expert'];
  // Three stars are three levels: each tier passed at its target (a share of the scene's target) is a star; a tier
  // passed counts the easier ones too. The next scene opens at two stars. In a room the team's score must reach the
  // target and the player must have answered at least five times, at least 80 % right.
  const TIER_TARGET = {novice:100,standard:90,expert:80};
  const TIER_PASS = {novice:1,standard:3,expert:7};
  const UNLOCK_STARS = 2, ROOM_ACCURACY = 80, ROOM_MIN_ANSWERS = 5;
  const MINUTES = [3,4,5], DEFAULT_MINUTES = 4;
  const MAX_PLAYERS = 4;
  // Stations, in the order they stand on the counter; each cooks for COOK_MS, then the dish waits BURN_MS before it
  // burns (0: a cut never burns).
  const KINDS = ['skjaere','koke','steke','bake','grille'];
  const COOK_MS = {skjaere:2500,koke:6000,steke:5000,bake:7000,grille:5500};
  const BURN_MS = {skjaere:0,koke:9000,steke:7000,bake:8000,grille:6000};
  const MAX_WAITING = 4;                       // customers at the counter at once
  const ARRIVE_GAP = [0,15000,12000,10000,8500]; // ms between arrivals, by number of cooks (±25 %)
  const FIRST_ARRIVAL = 1500, QUIET_END = 25000; // nobody new arrives in the last 25 s
  const MAX_ORDERS = 60;
  const PATIENCE_BASE = 40000, PATIENCE_SLOT = 9000, PATIENCE_COOK = 6000;
  const POINTS_BASE = 20, POINTS_SLOT = 8, POINTS_COOK = 6, TIP_MAX = 15;
  const WITHOUT_PERCENT = 25;                  // orders of a dish with optional ingredients that leave one out
  const COUNT_WINDOW = 1000, COUNT_PER_WINDOW = 2; // at most two correct answers a second earn anything
  const DISH_XP = 5, GAME_XP_CAP = 400;
  const PLATES_SOLO = 3, PLATES_ROOM = 4;
  const CHATS = ['takk','kom-igjen','unnskyld','vaer-saa-god'];
  const ACTIONS = ['take','place','cook','transfer','trash','serve','miss','call','chat','away','back'];

  /* ---------- Pure logic (exercised by scripts/check_kitchen.cjs; ported in community_api.py, compared by
     scripts/test_kitchen_rules.py). Every time is a whole number of milliseconds of game time (0 = the start
     signal); every state is plain JSON with ASCII ids, so a state from here and one from the server compare. ---------- */

  // mulberry32: whole 32-bit numbers, the same in Python.
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
  // 0 … n−1 from one draw (x·n < 2^53, so this is exact).
  const pick = (random,n) => Math.floor(random()*n/4294967296);

  // A scene as the rules see it: kitchen.json's scene plus the verbs of its stations and the customers.
  function sceneRules(data,scene) {
    const verbs = {};
    for (const kind of KINDS) if (data?.stations?.[kind]?.word) verbs[kind] = data.stations[kind].word;
    const dishes = {};
    for (const dish of scene.dishes) dishes[dish.id] = dish;
    const cabinetOf = {};
    for (const cabinet of scene.cabinets) for (const item of cabinet.items) cabinetOf[item] = cabinet.id;
    return {id:scene.id,take:scene.take === 'first' ? 'first' : 'dish',target:scene.target|0,stations:KINDS.filter(kind => scene.stations.includes(kind)),
      cabinets:scene.cabinets.map(cabinet => ({id:cabinet.id,items:[...cabinet.items]})),dishList:scene.dishes.map(dish => dish.id),dishes,
      words:[...scene.words],verbs,cabinetOf,customers:(data?.customers || []).map(customer => ({id:customer.id,voice:customer.voice === 'm' ? 'm' : 'f'}))};
  }
  // The word that takes an order: the dish's name, or in a shop the first thing on the list.
  const takeWord = (scene,dish) => scene.take === 'first' ? dish.slots[0][0] : dish.word;
  // A restaurant dinner is one order of three courses (forrett, hovedrett, dessert) served one after another on the
  // same plate; each course after the first is named on the menu board before it is made. Other dishes are one course.
  const coursesOf = dish => Array.isArray(dish.courses) && dish.courses.length ? dish.courses : [dish];
  // Every word a dish asks for: the names that take it (and its later courses), the ingredients, verbs and tools.
  function dishWords(scene,dish) {
    const words = [takeWord(scene,dish)];
    coursesOf(dish).forEach((course,index) => {
      if (index > 0) words.push(course.word);
      for (const [item,kind] of course.slots) { words.push(item); if (kind) words.push(scene.verbs[kind]); }
      for (const tool of course.tools || []) words.push(tool);
    });
    return words;
  }
  const cookCount = slots => slots.filter(slot => slot.k).length;

  // The customers of one game, drawn from the seed: who comes when, what they order, how long they wait. Dishes with
  // words the cooks have not mastered yet (`weak`) come more often, so playing on reaches every word of the scene.
  function plan(scene,{seed,minutes = DEFAULT_MINUTES,players = 1,weak = []}) {
    const random = rng(seed), duration = minutes*60000, weakSet = new Set(weak);
    const weights = scene.dishList.map(id => {
      const words = dishWords(scene,scene.dishes[id]);
      return 4+Math.floor(12*words.filter(word => weakSet.has(word)).length/words.length);
    });
    const gap = ARRIVE_GAP[Math.max(1,Math.min(MAX_PLAYERS,players))];
    const orders = [], recent = [];
    let at = FIRST_ARRIVAL, last = -1;
    while (at <= duration-QUIET_END && orders.length < MAX_ORDERS) {
      // The same dish twice in a row only when the scene has no other.
      let total = 0;
      for (let index = 0; index < weights.length; index++) if (index !== last || weights.length === 1) total += weights[index];
      let draw = pick(random,total), chosen = 0;
      for (let index = 0; index < weights.length; index++) {
        if (index === last && weights.length > 1) continue;
        if (draw < weights[index]) { chosen = index; break; }
        draw -= weights[index];
      }
      const dish = scene.dishes[scene.dishList[chosen]], courses = coursesOf(dish);
      const optional = courses.flatMap(course => course.opt || []);
      const leaveOut = optional.length > 0 && pick(random,100) < WITHOUT_PERCENT ? [optional[pick(random,optional.length)]] : [];
      // A customer not among the last three, so the counter never shows the same face twice.
      const people = scene.customers.length ? scene.customers : [{id:'c00',voice:'f'}];
      const free = people.filter(person => !recent.includes(person.id));
      const person = (free.length ? free : people)[pick(random,(free.length ? free : people).length)];
      recent.push(person.id);
      if (recent.length > 3) recent.shift();
      let patience = PATIENCE_BASE;
      for (const course of courses) {
        const slots = course.slots.filter(([item]) => !leaveOut.includes(item));
        patience += PATIENCE_SLOT*(slots.length+(course.tools || []).length)+PATIENCE_COOK*slots.filter(([,kind]) => kind).length;
      }
      orders.push({n:orders.length,dish:dish.id,at,patience,customer:person.id,voice:person.voice,without:leaveOut});
      at += gap-Math.floor(gap/4)+pick(random,Math.floor(gap/2));
      last = chosen;
    }
    return orders;
  }

  // Which player keeps which cabinet: the busiest cabinets are dealt first, each to whoever has the least to do so
  // far; ties go round from a different player each round, so the shelves change from game to game.
  function cabinets(scene,players,round = 0) {
    const demand = {};
    for (const cabinet of scene.cabinets) demand[cabinet.id] = 0;
    for (const id of scene.dishList) {
      for (const course of coursesOf(scene.dishes[id])) {
        for (const [item] of course.slots) if (scene.cabinetOf[item] in demand) demand[scene.cabinetOf[item]]++;
        for (const tool of course.tools || []) if (scene.cabinetOf[tool] in demand) demand[scene.cabinetOf[tool]]++;
      }
    }
    const order = scene.cabinets.map((cabinet,index) => ({id:cabinet.id,index,demand:demand[cabinet.id]}))
      .sort((a,b) => b.demand-a.demand || a.index-b.index);
    const load = players.map(() => 0), owner = {}, count = players.length;
    for (const cabinet of order) {
      let best = -1;
      for (let step = 0; step < count; step++) {
        const player = (step+round)%count;
        if (best < 0 || load[player] < load[best]) best = player;
      }
      owner[cabinet.id] = players[best];
      load[best] += cabinet.demand+1;
    }
    return owner;
  }

  function newMatch(scene,{seed,minutes = DEFAULT_MINUTES,tier = 'standard',players = ['me'],round = 0,weak = []}) {
    const count = players.length, per = count >= 3 ? 2 : 1;
    const owner = cabinets(scene,players,round);
    const stations = [];
    for (const kind of scene.stations) for (let index = 0; index < per; index++) {
      stations.push({id:`${kind}-${index}`,kind,item:'',order:-1,slot:-1,by:'',startedAt:-1,doneAt:-1,burnAt:-1});
    }
    return {v:1,scene:scene.id,seed:seed >>> 0,tier:TIERS[tier] ? tier : 'standard',minutes,duration:minutes*60000,players:players.map(id => ({
      id,home:scene.cabinets.filter(cabinet => owner[cabinet.id] === id).map(cabinet => cabinet.id),away:false,back:false,
      correct:0,wrong:0,dishes:0,served:0,counted:[],learn:[],done:[]})),
      owner,plates:Array(count === 1 ? PLATES_SOLO : PLATES_ROOM).fill(-1),stations,
      orders:plan(scene,{seed,minutes,players:count,weak}).map(order => {
        const dish = scene.dishes[order.dish];
        const courses = coursesOf(dish).map((course,index) => ({w:index ? course.word : takeWord(scene,dish),
          slots:course.slots.filter(([item]) => !order.without.includes(item)).map(([item,kind]) => ({i:item,k:kind || '',s:'open'})),
          tools:(course.tools || []).map(item => ({i:item,s:'open'}))}));
        // `slots` and `tools` are the course on the plate; `next` the courses still to come.
        return {...order,status:'plan',arrivedAt:-1,leavesAt:-1,takenAt:-1,plate:-1,takenBy:'',word:courses[0].w,course:0,naming:false,
          slots:courses[0].slots,tools:courses[0].tools,next:courses.slice(1)};
      }),
      next:0,t:0,over:false,score:0,served:0,gone:0};
  }

  const waitingCount = state => state.orders.filter(order => order.status === 'wait' || order.status === 'taken').length;
  // The next thing that happens by itself: a customer leaving (before an arrival at the same moment, so the place
  // they leave is free) or the next customer arriving, who waits while all four places at the counter are taken.
  function nextEvent(state) {
    let leaving = null;
    for (const order of state.orders) {
      if ((order.status === 'wait' || order.status === 'taken') && (leaving === null || order.leavesAt < leaving.leavesAt)) leaving = order;
    }
    const arriving = state.next < state.orders.length && waitingCount(state) < MAX_WAITING ? state.orders[state.next] : null;
    const arriveAt = arriving ? Math.max(arriving.at,state.t) : Infinity;
    if (leaving && leaving.leavesAt <= arriveAt) return {kind:'leave',at:leaving.leavesAt,order:leaving};
    if (arriving) return {kind:'arrive',at:arriveAt,order:arriving};
    return null;
  }
  function freePlate(state,order) {
    if (order.plate >= 0 && state.plates[order.plate] === order.n) state.plates[order.plate] = -1;
    order.plate = -1;
  }
  // Everything that happens by itself up to time t, in order. Calling it in steps or at once gives the same state.
  function advance(state,scene,t) {
    const events = [], from = state.t, limit = Math.min(t,state.duration);
    for (let guard = 0; guard < 1000 && !state.over; guard++) {
      const next = nextEvent(state);
      if (!next || next.at > limit) break;
      state.t = Math.max(state.t,next.at);
      const order = next.order;
      if (next.kind === 'leave') {
        order.status = 'gone';
        freePlate(state,order);
        state.gone++;
        events.push({e:'leave',n:order.n,at:next.at});
      } else {
        order.status = 'wait';
        order.arrivedAt = next.at;
        order.leavesAt = next.at+order.patience;
        state.next++;
        events.push({e:'arrive',n:order.n,at:next.at});
      }
    }
    for (const station of state.stations) {
      if (!station.item) continue;
      if (from < station.doneAt && station.doneAt <= limit) events.push({e:'done',x:state.stations.indexOf(station),at:station.doneAt});
      if (station.burnAt > 0 && from < station.burnAt && station.burnAt <= limit) events.push({e:'burn',x:state.stations.indexOf(station),at:station.burnAt});
    }
    state.t = Math.max(state.t,limit);
    if (t >= state.duration && !state.over) {
      state.over = true;
      events.push({e:'end',at:state.duration});
    }
    return events;
  }

  const stationState = (station,t) => !station.item ? 'empty' : t < station.doneAt ? 'cooking' : station.burnAt > 0 && t >= station.burnAt ? 'burnt' : 'ready';
  const complete = order => order.slots.every(slot => slot.s === 'done') && order.tools.every(tool => tool.s === 'done');
  const mine = (state,player,item,scene) => state.owner[scene.cabinetOf[item]] === player.id;
  const holder = (state,item,scene) => state.owner[scene.cabinetOf[item]] || '';
  // Points for a dish handed over at time t: its size, its cooking, and a tip for every second the customer had left.
  function tip(order,t) { return Math.floor(TIP_MAX*Math.max(0,order.leavesAt-t)/order.patience); }
  function points(order) { return POINTS_BASE+POINTS_SLOT*(order.slots.length+order.tools.length)+POINTS_COOK*cookCount(order.slots); }

  // An answer: right or wrong, for one word. A right answer counts once per step of an order (a second tap on the
  // same step earns nothing), and only from two actions a second at most. One action may answer two words (a tap on a
  // station: the ingredient and the verb) and takes one place; different actions take a place each, even in the same
  // millisecond (a room sends several actions in one request).
  function answer(player,word,right,key,now,learn) {
    if (right) {
      if (key && player.done.includes(key)) return;
      if (key) player.done.push(key);
      const recent = player.counted.filter(at => at > now-COUNT_WINDOW);
      if (!learn.some(([,ok]) => ok)) {
        if (recent.length >= COUNT_PER_WINDOW) return;
        recent.push(now);
      }
      player.counted = recent.slice(-COUNT_PER_WINDOW);
      player.correct++;
    } else player.wrong++;
    player.learn.push([word,right ? 1 : 0]);
    learn.push([word,right ? 1 : 0]);
  }
  // The earliest order still being made that has an open slot for this item (cooked with `kind`, or raw for '').
  function openSlot(state,item,kind,prefer = -1) {
    const orders = state.orders.filter(order => order.status === 'taken' && !order.naming).sort((a,b) => (b.n === prefer)-(a.n === prefer) || a.takenAt-b.takenAt || a.n-b.n);
    for (const order of orders) {
      const slot = order.slots.findIndex(entry => entry.i === item && entry.k === kind && entry.s === 'open');
      if (slot >= 0) return {order,slot};
    }
    return null;
  }
  // Someone back from a dropped connection gets their own cabinets again when the next dish is handed over.
  function giveBack(state) {
    for (const player of state.players) {
      if (!player.back) continue;
      for (const cabinet of player.home) state.owner[cabinet] = player.id;
      player.back = false;
    }
  }
  // A player whose connection dropped: their cabinets go, one by one, to whoever online keeps the fewest.
  function lend(state,scene,player) {
    for (const cabinet of scene.cabinets) {
      if (state.owner[cabinet.id] !== player.id) continue;
      let best = null;
      for (const other of state.players) {
        if (other.away || other === player) continue;
        const held = scene.cabinets.filter(entry => state.owner[entry.id] === other.id).length;
        if (!best || held < best.held) best = {player:other,held};
      }
      if (best) state.owner[cabinet.id] = best.player.id;
    }
  }

  // One action at time `now` (after everything that happened by itself until then). Returns whether it took effect,
  // why not, what happened, and the answers it gave (right or wrong) for the learning record. A right answer counts
  // even when a classmate was quicker or the station is busy: the word was known.
  function apply(state,scene,action,now) {
    const events = advance(state,scene,now), learn = [];
    const out = (ok,why = '',more = []) => ({ok,why,events:events.concat(more),learn});
    if (state.over) return out(false,'over');
    const player = state.players.find(entry => entry.id === action.by);
    if (!player) return out(false,'player');
    const order = Number.isInteger(action.c) ? state.orders[action.c] || null : null;
    switch (action.t) {
      case 'take': {
        if (!order || order.status === 'plan') return out(false,'noorder');
        if (order.status === 'gone' || order.status === 'served') return out(false,'gone');
        const word = order.word, key = `t${order.n}.${order.course}`;
        // Once this player has named the dish (or this course), later taps on it are not answers any more.
        if (!player.done.includes(key)) answer(player,word,action.d === word,key,now,learn);
        if (action.d !== word) return out(false,'wrong',[{e:'wrong',n:order.n,word,chosen:action.d,by:player.id}]);
        if (order.status === 'taken' && order.naming) {
          order.naming = false;
          return out(true,'',[{e:'named',n:order.n,course:order.course,by:player.id}]);
        }
        if (order.status === 'taken') return out(false,'taken');
        const plate = state.plates.indexOf(-1);
        if (plate < 0) return out(false,'noplate');
        state.plates[plate] = order.n;
        Object.assign(order,{status:'taken',plate,takenBy:player.id,takenAt:now});
        return out(true,'',[{e:'take',n:order.n,plate,by:player.id}]);
      }
      case 'place': {
        if (!order || order.status !== 'taken') return out(false,'noorder');
        if (order.naming) return out(false,'naming');
        const item = action.i;
        if (!scene.cabinetOf[item] || !mine(state,player,item,scene)) return out(false,'notmine');
        let slot = order.slots.findIndex(entry => entry.i === item && !entry.k && entry.s === 'open'), tool = -1;
        if (slot < 0) tool = order.tools.findIndex(entry => entry.i === item && entry.s === 'open');
        if (slot < 0 && tool < 0) {
          const cooked = order.slots.find(entry => entry.i === item && entry.k && entry.s === 'open');
          if (cooked) return out(false,'cook',[{e:'needcook',n:order.n,i:item,k:cooked.k,by:player.id}]);
          if (order.slots.some(entry => entry.i === item) || order.tools.some(entry => entry.i === item)) return out(false,'full');
          answer(player,item,false,'',now,learn);
          return out(false,order.without.includes(item) ? 'without' : 'wrong',[{e:'wrong',n:order.n,word:item,chosen:item,by:player.id}]);
        }
        const index = slot >= 0 ? slot : order.slots.length+tool;
        answer(player,item,true,`p${order.n}.${order.course}.${index}`,now,learn);
        if (slot >= 0) order.slots[slot].s = 'done'; else order.tools[tool].s = 'done';
        const more = [{e:'place',n:order.n,slot:index,i:item,by:player.id}];
        if (complete(order)) more.push({e:'complete',n:order.n});
        return out(true,'',more);
      }
      case 'cook': {
        const item = action.i, kind = action.k;
        if (!scene.stations.includes(kind)) return out(false,'nostation');
        if (!scene.cabinetOf[item] || !mine(state,player,item,scene)) return out(false,'notmine');
        const target = openSlot(state,item,kind,order ? order.n : -1);
        if (!target) {
          const other = state.orders.some(entry => entry.status === 'taken' && !entry.naming && entry.slots.some(slot => slot.i === item && slot.s === 'open' && slot.k && slot.k !== kind));
          if (other) {
            answer(player,scene.verbs[kind],false,'',now,learn);
            return out(false,'wrongverb',[{e:'wrong',word:scene.verbs[kind],chosen:scene.verbs[kind],by:player.id}]);
          }
          if (state.orders.some(entry => entry.status === 'taken' && !entry.naming && entry.slots.some(slot => slot.i === item && slot.s === 'open'))) return out(false,'raw');
          if (state.orders.some(entry => entry.status === 'taken' && !entry.naming && entry.slots.some(slot => slot.i === item))) return out(false,'full');
          answer(player,item,false,'',now,learn);
          return out(false,'wrong',[{e:'wrong',word:item,chosen:item,by:player.id}]);
        }
        const key = `${target.order.n}.${target.order.course}.${target.slot}`;
        answer(player,item,true,`p${key}`,now,learn);
        answer(player,scene.verbs[kind],true,`k${key}`,now,learn);
        const station = state.stations.find(entry => entry.kind === kind && !entry.item);
        if (!station) return out(false,'busy');
        Object.assign(station,{item,order:target.order.n,slot:target.slot,by:player.id,startedAt:now,doneAt:now+COOK_MS[kind],burnAt:BURN_MS[kind] ? now+COOK_MS[kind]+BURN_MS[kind] : 0});
        target.order.slots[target.slot].s = 'cooking';
        return out(true,'',[{e:'cook',x:state.stations.indexOf(station),n:target.order.n,slot:target.slot,i:item,k:kind,by:player.id}]);
      }
      case 'transfer': {
        const station = state.stations[action.x];
        if (!station || !station.item) return out(false,'empty');
        const status = stationState(station,now);
        if (status !== 'ready') return out(false,status);
        let owner = station.order >= 0 ? state.orders[station.order] : null;
        let slot = owner && owner.status === 'taken' && owner.slots[station.slot]?.s === 'cooking' ? station.slot : -1;
        if (slot < 0) {
          // Its customer left: the dish goes to the next order that needs it.
          const target = openSlot(state,station.item,station.kind);
          if (!target) return out(false,'nowhere');
          owner = target.order; slot = target.slot;
        }
        owner.slots[slot].s = 'done';
        const more = [{e:'transfer',x:action.x,n:owner.n,slot,i:station.item,by:player.id}];
        Object.assign(station,{item:'',order:-1,slot:-1,by:'',startedAt:-1,doneAt:-1,burnAt:-1});
        if (complete(owner)) more.push({e:'complete',n:owner.n});
        return out(true,'',more);
      }
      case 'trash': {
        const station = state.stations[action.x];
        if (!station || !station.item) return out(false,'empty');
        const burnt = stationState(station,now) === 'burnt';
        const owner = station.order >= 0 ? state.orders[station.order] : null;
        if (owner && owner.slots[station.slot]?.s === 'cooking') owner.slots[station.slot].s = 'open';
        const more = [{e:'trash',x:action.x,i:station.item,burnt,by:player.id}];
        Object.assign(station,{item:'',order:-1,slot:-1,by:'',startedAt:-1,doneAt:-1,burnAt:-1});
        return out(true,'',more);
      }
      case 'serve': {
        if (!order || order.status !== 'taken') return out(false,'gone');
        if (order.naming || !complete(order)) return out(false,'incomplete');
        if (order.next.length) {
          // A course of a dinner: its points now, then the next course comes on the same plate, to be named first.
          const earned = points(order), coming = order.next.shift();
          state.score += earned;
          Object.assign(order,{course:order.course+1,word:coming.w,slots:coming.slots,tools:coming.tools,naming:true});
          player.served++;
          return out(true,'',[{e:'course',n:order.n,plate:order.plate,course:order.course,points:earned,tip:0,by:player.id}]);
        }
        const earned = points(order), extra = tip(order,now), plate = order.plate;
        state.score += earned+extra;
        state.served++;
        order.status = 'served';
        order.servedAt = now;
        freePlate(state,order);
        player.served++;
        for (const entry of state.players) if (!entry.away) entry.dishes++;
        giveBack(state);
        return out(true,'',[{e:'serve',n:order.n,plate,points:earned,tip:extra,by:player.id}]);
      }
      case 'miss': case 'call': {
        // A shout for an ingredient on someone else's shelf, picked out of four words: right sends it, wrong is a miss.
        if (!order || order.status !== 'taken') return out(false,'noorder');
        if (order.naming) return out(false,'naming');
        const slot = order.slots[action.n] || order.tools[action.n-order.slots.length];
        if (!slot || slot.s !== 'open') return out(false,'full');
        const right = action.t === 'call' && action.i === slot.i;
        if (right && mine(state,player,slot.i,scene)) return out(false,'mine');
        answer(player,slot.i,right,right ? `c${order.n}.${order.course}.${action.n}` : '',now,learn);
        if (!right) return out(false,'wrong',[{e:'wrong',n:order.n,word:slot.i,chosen:action.i || '',by:player.id}]);
        return out(true,'',[{e:'call',n:order.n,slot:action.n,i:slot.i,by:player.id,to:holder(state,slot.i,scene)}]);
      }
      case 'chat':
        if (!CHATS.includes(action.w)) return out(false,'invalid');
        return out(true,'',[{e:'chat',w:action.w,by:player.id}]);
      case 'away':
        if (player.away) return out(false,'same');
        player.away = true;
        player.back = false;
        lend(state,scene,player);
        return out(true,'',[{e:'away',by:player.id}]);
      case 'back':
        if (!player.away) return out(false,'same');
        player.away = false;
        player.back = true;
        for (const absent of state.players) if (absent.away) lend(state,scene,absent);
        return out(true,'',[{e:'back',by:player.id}]);
      default:
        return out(false,'invalid');
    }
  }

  // A tier's target: the scene's target scaled to the game's length, then its tier's share. Stars count the tiers
  // passed from 新手 up; a tier opens once the one below it is passed.
  const targetFor = (scene,minutes,tier = 'novice') => Math.floor(Math.round(scene.target*minutes/DEFAULT_MINUTES)*(TIER_TARGET[tier] ?? 100)/100);
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
  // A word is mastered after three right answers on at least two Beijing days with the latest answer right. A miss
  // after that sends it back to learning until it is answered right twice in a row.
  function masteryStep(record,right,day) {
    const next = {correct:0,wrong:0,days:0,lastDay:'',lastOk:false,sinceMiss:0,relapsed:false,mastered:false,...record};
    if (right) {
      next.correct++;
      next.sinceMiss++;
      if (day > next.lastDay) { next.days++; next.lastDay = day; }
      next.lastOk = true;
    } else {
      next.wrong++;
      next.sinceMiss = 0;
      next.lastOk = false;
      if (next.mastered) next.relapsed = true;
    }
    next.mastered = next.relapsed ? next.sinceMiss >= 2 : next.correct >= 3 && next.days >= 2 && next.lastOk;
    if (next.mastered) next.relapsed = false;
    return next;
  }
  // XP the server will give one player for a game: per right answer by tier, per dish handed over while there.
  const xpFor = (state,player) => Math.min(GAME_XP_CAP,player.correct*(TIERS[state.tier]?.xp || 0)+DISH_XP*player.dishes);

  // Four words for a shout: the one needed and three from the other shelves, of the same kind where possible.
  function distractors(scene,item,mineList,seed,categoryOf = {}) {
    const random = rng(seed ^ hashText(item));
    const others = scene.words.filter(word => word !== item && scene.cabinetOf[word] && !mineList.includes(word));
    const same = others.filter(word => categoryOf[word] && categoryOf[word] === categoryOf[item]);
    const pool = [...same], rest = others.filter(word => !same.includes(word));
    const chosen = [];
    while (chosen.length < 3 && (pool.length || rest.length)) {
      const from = pool.length ? pool : rest;
      chosen.push(from.splice(pick(random,from.length),1)[0]);
    }
    const options = [...chosen];
    options.splice(pick(random,options.length+1),0,item);
    return options;
  }
  function hashText(text) {
    let hash = 2166136261;
    for (const char of String(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash,16777619) >>> 0; }
    return hash >>> 0;
  }

  // The daily menu: six dishes from as many scenes, drawn from the day's seed (the server gives the seed). Every scene
  // can give one, the shop too: its list is then taken by its first item, which stands as the order's name.
  function dailyScene(data,seed) {
    const random = rng(seed), scenes = data.scenes.filter(scene => scene.dishes.length);
    const pool = [...scenes], picked = [];
    while (picked.length < 6 && pool.length) {
      const scene = pool.splice(pick(random,pool.length),1)[0];
      picked.push({scene,dish:scene.dishes[pick(random,scene.dishes.length)]});
    }
    const items = new Set(), stations = new Set(), tools = new Set();
    for (const {dish} of picked) for (const course of coursesOf(dish)) {
      for (const [item,kind] of course.slots) { items.add(item); if (kind) stations.add(kind); }
      for (const tool of course.tools || []) tools.add(tool);
    }
    // Cabinets keep their usual names; the same cabinet of different scenes is one cabinet here.
    const cabinets = [], byId = {};
    for (const {scene} of picked) for (const cabinet of scene.cabinets) {
      const measureChoices = cabinet.id === 'maal' && cabinet.items.some(item => tools.has(item));
      for (const item of cabinet.items) {
        if (!(measureChoices || items.has(item) || tools.has(item)) || cabinets.some(entry => entry.items.includes(item))) continue;
        if (!byId[cabinet.id]) { byId[cabinet.id] = {id:cabinet.id,no:cabinet.no,zh:cabinet.zh,items:[]}; cabinets.push(byId[cabinet.id]); }
        byId[cabinet.id].items.push(item);
      }
    }
    const dishes = picked.map(({scene,dish}) => scene.take === 'first' ? {...dish,word:dish.slots[0][0]} : dish);
    const words = [];
    const add = word => { if (word && !words.includes(word)) words.push(word); };
    for (const dish of dishes) coursesOf(dish).forEach((course,index) => add(index ? course.word : dish.word));
    for (const dish of dishes) for (const course of coursesOf(dish)) for (const [item,kind] of course.slots) { add(item); if (kind) add(data.stations?.[kind]?.word); }
    for (const dish of dishes) for (const course of coursesOf(dish)) for (const tool of course.tools || []) add(tool);
    return {id:'daily',no:'Dagens meny',zh:'今日菜单',order:0,note:'',bg:picked[0]?.scene.bg || '',
      target:Math.round(picked.reduce((sum,{scene}) => sum+scene.target,0)/Math.max(1,picked.length)),
      stations:KINDS.filter(kind => stations.has(kind)),cabinets,dishes,words,fresh:0,difficulty:0};
  }

  // A game played alone goes to the server as its seed and the list of actions; the server plays it again with the
  // same rules to score it. Orders are numbers, words and stations their place in the scene's lists.
  const CODES = {take:'t',place:'p',cook:'k',transfer:'x',trash:'d',serve:'s',miss:'m',chat:'h'};
  const NAMES = Object.fromEntries(Object.entries(CODES).map(([name,code]) => [code,name]));
  // Optional cabinet choices must survive offline replay, without becoming targets or moving any existing index.
  const logWords = scene => [...new Set([...scene.words,...scene.cabinets.flatMap(cabinet => cabinet.items)])];
  function packLog(scene,actions) {
    let last = 0;
    const words = logWords(scene), word = id => words.indexOf(id);
    return actions.map(action => {
      const dt = action.at-last; last = action.at;
      const code = CODES[action.t];
      switch (action.t) {
        case 'take': return [dt,code,action.c,word(action.d)];
        case 'place': return [dt,code,action.c,word(action.i)];
        case 'cook': return [dt,code,word(action.i),KINDS.indexOf(action.k),Number.isInteger(action.c) ? action.c : -1];
        case 'transfer': case 'trash': return [dt,code,action.x];
        case 'serve': return [dt,code,action.c];
        case 'miss': return [dt,code,action.c,action.n,word(action.i)];
        case 'chat': return [dt,code,CHATS.indexOf(action.w)];
        default: return null;
      }
    }).filter(Boolean);
  }
  function unpackLog(scene,log) {
    let at = 0;
    const actions = [];
    const words = logWords(scene), word = index => Number.isInteger(index) && index >= 0 ? words[index] || '' : '';
    for (const entry of Array.isArray(log) ? log : []) {
      if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || entry[0] < 0 || !NAMES[entry[1]]) return null;
      at += entry[0];
      const t = NAMES[entry[1]], args = entry.slice(2);
      if (!args.every(Number.isInteger)) return null;
      const action = t === 'take' ? {t,c:args[0],d:word(args[1])} : t === 'place' ? {t,c:args[0],i:word(args[1])}
        : t === 'cook' ? {t,i:word(args[0]),k:KINDS[args[1]] || '',...(args[2] >= 0 ? {c:args[2]} : {})}
        : t === 'transfer' || t === 'trash' ? {t,x:args[0]} : t === 'serve' ? {t,c:args[0]}
        : t === 'miss' ? {t,c:args[0],n:args[1],i:word(args[2])} : {t,w:CHATS[args[0]] || ''};
      actions.push({...action,at});
    }
    return actions;
  }
  // The weak words of a game as a hex bitmask over the scene's words (a few dozen characters at most).
  function packWeak(scene,weak) {
    const bits = scene.words.map(word => weak.includes(word) ? 1 : 0);
    let hex = '';
    for (let index = 0; index < bits.length; index += 4) hex += ((bits[index] << 3) | ((bits[index+1] || 0) << 2) | ((bits[index+2] || 0) << 1) | (bits[index+3] || 0)).toString(16);
    return hex;
  }
  function unpackWeak(scene,hex) {
    const weak = [];
    if (typeof hex !== 'string' || !/^[0-9a-f]*$/.test(hex)) return weak;
    scene.words.forEach((word,index) => { const digit = parseInt(hex[index >> 2] || '0',16); if (digit & (8 >> (index & 3))) weak.push(word); });
    return weak;
  }
  // The same game again from its header and actions; the server does exactly this with its own rules.
  function replay(scene,header,actions) {
    const state = newMatch(scene,{seed:header.seed,minutes:header.minutes,tier:header.tier,players:['me'],round:0,weak:header.weak || []});
    for (const action of actions) apply(state,scene,{...action,by:'me'},action.at);
    advance(state,scene,state.duration);
    return state;
  }
  // What a room's players see of the game: everything but other players' answer records.
  function publicView(state,me = '') {
    return {...state,players:state.players.map(player => player.id === me ? player : {...player,learn:[],done:[],counted:[]})};
  }

  // A computer cook for testing and for setting each scene's ★ target: `think` ms per step; a careless one taps at
  // random. Plays alone and returns the finished state.
  function simulate(scene,{seed = 1,minutes = DEFAULT_MINUTES,think = 2000,careless = false,tier = 'standard'} = {}) {
    const state = newMatch(scene,{seed,minutes,tier,players:['bot']}), random = rng(seed ^ 0x5bd1e995);
    for (let now = 0; now < state.duration; now += think) {
      advance(state,scene,now);
      if (state.over) break;
      const action = careless ? randomAction(state,scene,random) : botAction(state,scene,now);
      if (action) apply(state,scene,{...action,by:'bot'},now);
    }
    advance(state,scene,state.duration);
    return state;
  }
  function botAction(state,scene,now) {
    for (let x = 0; x < state.stations.length; x++) {
      const status = stationState(state.stations[x],now);
      const station = state.stations[x], owner = station.order >= 0 ? state.orders[station.order] : null;
      if (status === 'burnt') return {t:'trash',x};
      if (status === 'ready') return owner?.status === 'taken' && owner.slots[station.slot]?.s === 'cooking' || openSlot(state,station.item,station.kind) ? {t:'transfer',x} : {t:'trash',x};
    }
    const taken = state.orders.filter(order => order.status === 'taken').sort((a,b) => a.takenAt-b.takenAt);
    const done = taken.find(complete);
    if (done) return {t:'serve',c:done.n};
    const waiting = state.orders.find(order => order.status === 'wait');
    if (waiting && state.plates.includes(-1)) return {t:'take',c:waiting.n,d:waiting.word};
    const naming = taken.find(order => order.naming);
    if (naming) return {t:'take',c:naming.n,d:naming.word};
    for (const order of taken) {
      for (const slot of order.slots) {
        if (slot.s !== 'open') continue;
        if (!slot.k) return {t:'place',c:order.n,i:slot.i};
        if (state.stations.some(station => station.kind === slot.k && !station.item)) return {t:'cook',i:slot.i,k:slot.k,c:order.n};
      }
      const tool = order.tools.find(entry => entry.s === 'open');
      if (tool) return {t:'place',c:order.n,i:tool.i};
    }
    return null;
  }
  function randomAction(state,scene,random) {
    const visible = state.orders.filter(order => order.status === 'wait' || order.status === 'taken');
    if (!visible.length) return null;
    const order = visible[pick(random,visible.length)], word = scene.words[pick(random,scene.words.length)];
    const kind = scene.stations[pick(random,Math.max(1,scene.stations.length))];
    switch (pick(random,5)) {
      case 0: return {t:'take',c:order.n,d:word};
      case 1: return {t:'place',c:order.n,i:word};
      case 2: return kind ? {t:'cook',i:word,k:kind} : null;
      case 3: return {t:'serve',c:order.n};
      default: return state.stations.length ? {t:'transfer',x:pick(random,state.stations.length)} : null;
    }
  }

  /* ---------- Overlay state ---------- */
  const ui = {open:false,opts:{},root:null,view:'home',prefs:null,timers:new Set(),sfx:{context:null},clock:null,game:null,room:null,
    data:null,lexicon:null,manifest:{images:{}},progress:null,daily:null,dailyTab:'solo',wordsTab:'all',wordsQuery:'',resultsFor:null};
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
    lock:'<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    star:'<path d="m12 4.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>',
    check:'<path d="m5.5 12.5 4 4 9-9"/>',
    plus:'<path d="M12 5.5v13M5.5 12h13"/>',
    link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    people:'<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="9.5" r="2.5"/><path d="M3.5 19a5 5 0 0 1 10 0M13.5 15.2a4.5 4.5 0 0 1 7 3.8"/>',
    book:'<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H18v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H18v-3"/>',
    help:'<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.5a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2 1-1.2 1.9M12 16.4h.01"/>',
    chat:'<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-8l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z"/>',
    calendar:'<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    bell:'<path d="M6.5 16.5h11l-1.3-2V10a4.2 4.2 0 0 0-8.4 0v4.5zM10.3 19a1.8 1.8 0 0 0 3.4 0"/>',
    bin:'<path d="M5 7h14M9.5 7V5h5v2M7 7l1 13h8l1-13"/>',
    plate:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/>',
    // The stations' marks on an order slip; the stations themselves show only their verb, so the verb is what is asked.
    skjaere:'<path d="M4.5 19.5 15 9l3.2-3.2a2.4 2.4 0 0 1 0 3.4L11 16.5"/><path d="M4.5 19.5l3.3-1"/>',
    koke:'<path d="M5 10h14v6.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M3 10h18M9.5 7.2c0-1 1-1.2 1-2.2M13.5 7.2c0-1 1-1.2 1-2.2"/>',
    steke:'<ellipse cx="10" cy="13" rx="6.5" ry="4.3"/><path d="M16.4 12.2 21 10"/>',
    bake:'<rect x="4" y="4.5" width="16" height="15" rx="2"/><path d="M4 8.5h16M7.5 6.5h.01M10.5 6.5h.01"/><rect x="7.5" y="11" width="9" height="5.5" rx="1"/>',
    grille:'<path d="M5 9.5h14a7 7 0 0 1-14 0zM8.5 16.5 7 20.5M15.5 16.5l1.5 4M9.5 6.5c0-1 1-1.4 1-2.4M13.5 6.5c0-1 1-1.4 1-2.4"/>',
    // Placeholder marks by kind of food, until the illustrations arrive (never the Norwegian word).
    fruit:'<path d="M12 7.5c-3-2-7.5 0-7.5 5s3 7.5 5 7.5c1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c2 0 5-2.5 5-7.5s-4.5-7-7.5-5z"/><path d="M12 7.5c0-2 1-3.5 3-4"/>',
    berry:'<circle cx="9" cy="14" r="3.2"/><circle cx="15" cy="14" r="3.2"/><circle cx="12" cy="9" r="3.2"/><path d="M12 5.8V3.5"/>',
    vegetable:'<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19 13 11"/>',
    meat:'<path d="M14.5 4.5a5 5 0 0 1 5 5c0 3-3 5-6 6l-3.5-3.5c1-3 3-7.5 4.5-7.5z"/><path d="m10 12-4.5 4.5M5.5 16.5a1.6 1.6 0 1 0 2 2"/>',
    fish:'<path d="M3.5 12c3-4.5 9-5.5 13 0-4 5.5-10 4.5-13 0z"/><path d="M16.5 12 20.5 8.5v7z"/><path d="M8 11.2h.01"/>',
    dairy:'<path d="M9 3.5h6M9.5 3.5v3L7.5 9.5v11h9v-11l-2-3v-3"/><path d="M7.5 13h9"/>',
    grain:'<path d="M4.5 11a4 4 0 0 1 3-6h9a4 4 0 0 1 3 6v8.5h-15z"/><path d="M9 8.5v3M12 8.5v3M15 8.5v3"/>',
    snack:'<path d="M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0M8 12 4 9v6zM16 12l4-3v6z"/>',
    drink:'<path d="M6 8.5h10v6a5 5 0 0 1-10 0z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M9 5.5c0-1 1-1 1-2M12.5 5.5c0-1 1-1 1-2"/>',
    seasoning:'<path d="M8 7.5h8v12.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 20z"/><path d="M9 3.5h6v4H9zM10.5 5.5h.01M13.5 5.5h.01"/>',
    pantry:'<path d="M7.5 6.5h9v13a1.5 1.5 0 0 1-1.5 1.5h-6a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8.5 3.5h7v3h-7zM7.5 11h9"/>',
    dish:'<path d="M3.5 17.5h17M5.5 17.5a6.5 6.5 0 0 1 13 0M12 8.5V11"/><path d="M5 20.5h14"/>',
    utensil:'<path d="M7 3.5v17M5 3.5v5a2 2 0 0 0 4 0v-5M16.5 20.5V3.5c-2 1.5-3 4-3 7h3"/>',
    face:'<circle cx="12" cy="9" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  };
  const icon = name => `<svg class="kc-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.dish}</svg>`;
  const button = (action,text,kind = '',extra = '') => `<button type="button" class="kc-button ${kind}" data-kc="${action}" ${extra}>${text}</button>`;
  const CATEGORY_MARK = {fruit:'fruit',berry:'berry',vegetable:'vegetable',meat:'meat',fish:'fish',dairy:'dairy',grain:'grain',bread:'grain',snack:'snack',sweet:'snack',
    drink:'drink',seasoning:'seasoning',spice:'seasoning',pantry:'pantry',dish:'dish',utensil:'utensil',tool:'utensil'};
  const KIND_NAMES = {skjaere:'切',koke:'煮',steke:'煎',bake:'烤',grille:'烧烤'};
  // What each tier shows, in the words of the two-room game (the rules' own TIERS keep their names and XP).
  const TIER_HINTS = {novice:'挪中对照',standard:'看图认词',expert:'只听声音'};
  const WHY = {
    taken:name => `${name || '同学'} 已经接了这单`,noplate:() => '托盘都在用，先把做好的菜端出去',busy:() => '这样灶具都在用，稍等一下',
    cook:() => '这样要先在灶台上做',raw:() => '这样不用做，直接放上托盘',full:() => '这样已经放够了',nowhere:() => '没有订单要它了，已经倒掉',
    burnt:() => '糊了！点一下倒掉重做',cooking:() => '还没好',notmine:() => '这样在同学的柜子里，在订单上点这一样向同学要',naming:() => '先在菜单上点这一道的菜名',
    incomplete:() => '还没配齐',gone:() => '这位客人已经走了',mine:() => '这样就在你的柜子里',noorder:() => '先接单',empty:() => '这个工位是空的',
  };

  function readJSON(key,fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; }
  }
  function writeJSON(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { return false; } }
  function readPrefs() {
    const saved = readJSON(PREFS_KEY,{}) || {};
    return {tier:TIERS[saved.tier] ? saved.tier : 'novice',minutes:MINUTES.includes(saved.minutes) ? saved.minutes : DEFAULT_MINUTES,
      sound:saved.sound !== false,scene:typeof saved.scene === 'string' ? saved.scene.slice(0,40) : '',
      // How many games this device has started: the first few show short hints.
      coach:Number.isInteger(saved.coach) ? Math.max(0,saved.coach) : 0,
      // The last progress the server sent, so stars and locks show at once (and offline).
      progress:saved.progress && typeof saved.progress === 'object' ? saved.progress : null};
  }
  const savePrefs = () => writeJSON(PREFS_KEY,ui.prefs);

  /* ---------- Data and pictures ---------- */
  async function fetchJSON(path) {
    const response = await fetch(versioned(path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  // The scenes, the words and the list of finished illustrations are fetched once per page.
  function loadData() {
    ui.dataLoad ||= Promise.all([fetchJSON('data/kitchen.json'),fetchJSON('data/kitchen-lexicon.json'),fetchJSON('assets/kitchen/manifest.json').catch(() => ({images:{}}))])
      .then(([data,lexicon,manifest]) => {
        ui.data = data;
        ui.lexicon = new Map((lexicon.entries || []).map(item => [item.id,item]));
        ui.categories = lexicon.categories || [];
        ui.categoryOf = Object.fromEntries((lexicon.entries || []).map(item => [item.id,item.cat]));
        ui.manifest = manifest && typeof manifest.images === 'object' ? manifest : {images:{}};
        return data;
      }).catch(error => { ui.dataLoad = null; throw error; });
    return ui.dataLoad;
  }
  const entry = id => ui.lexicon?.get(id) || null;
  // The first sense of a meaning ("煮鸡蛋；水煮蛋" → "煮鸡蛋"), never cutting a bracket in two.
  function firstSense(text) {
    const value = String(text || '').trim();
    let depth = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if ('（(［['.includes(char)) depth++;
      else if ('）)］]'.includes(char)) depth = Math.max(0,depth-1);
      else if ((char === '；' || char === ';') && depth === 0) return value.slice(0,i).trim();
    }
    return value;
  }
  // The short meaning the game's hints show: the first sense without its bracket, which may spell out the Norwegian
  // ("分升（100 毫升；desiliter 的缩写）" → "分升").
  const gameSense = id => entry(id)?.gameZh || firstSense(entry(id)?.zh);
  const zh1 = id => { const sense = gameSense(id); return sense.replace(/[（(][^）)]*[）)]/g,'').trim() || sense; };
  const scenes = () => [...(ui.data?.scenes || [])].sort((a,b) => a.order-b.order);
  const sceneById = id => id === 'daily' ? ui.daily?.scene || null : (ui.data?.scenes || []).find(scene => scene.id === id) || null;
  // A word as the shelves show it: Norwegian only, a noun's article and a verb's å small and grey.
  function wordHTML(id,{article = true} = {}) {
    const item = entry(id), word = item?.word || id;
    const verb = /^å\s/.test(word);
    const head = verb ? 'å' : article && /^(en|ei|et|ei\/en)$/.test(item?.article || '') && item?.pos === 'noun' ? item.article : '';
    const rest = verb ? word.slice(2) : word;
    return `<span class="kc-no" lang="nb">${head ? `<i class="kc-art">${e(head)}</i> ` : ''}${e(rest)}</span>`;
  }
  const plainWord = id => entry(id)?.word || id;
  const imageURL = (img,small) => `assets/kitchen/${img}${small ? '-128' : ''}.webp?h=${encodeURIComponent(ui.manifest.images[img])}`;
  // A finished illustration, or a quiet colour block with the mark of its kind of food. Neither ever shows the word.
  function pic(id,cls = '',small = true) {
    const item = entry(id), img = item?.img || '';
    if (img && ui.manifest.images?.[img]) return `<img class="kc-pic ${cls}" src="${e(imageURL(img,small))}" alt="" decoding="async" draggable="false">`;
    const mark = CATEGORY_MARK[item?.cat] || (item?.kind === 'dish' ? 'dish' : item?.kind === 'tool' ? 'utensil' : 'dish');
    return `<span class="kc-pic is-blank is-${mark} ${cls}" aria-hidden="true">${icon(mark)}</span>`;
  }
  function faceHTML(customer,mood = 'neutral',cls = '') {
    const img = `customer/${customer}-${mood}`;
    // Faces are published at 256 px (sharp at 56 px on a 3× screen) and 128 px (the small faces on order slips).
    if (ui.manifest.images?.[img]) return `<img class="kc-face ${cls}" src="${e(imageURL(img,cls.includes('is-mini')))}" alt="" decoding="async" draggable="false">`;
    const index = Math.max(0,(ui.data?.customers || []).findIndex(person => person.id === customer));
    return `<span class="kc-face is-blank is-tone-${index%6} is-${mood} ${cls}" aria-hidden="true">${icon('face')}</span>`;
  }
  const customerOf = id => (ui.data?.customers || []).find(person => person.id === id) || null;
  // Whether a word's hint shows its Chinese: always on 新手; on 标准 only while its illustration has not arrived (the
  // placeholder blocks of one kind of food look alike, so the picture alone could not be told apart).
  const hasPicture = id => { const img = entry(id)?.img; return Boolean(img && ui.manifest.images?.[img]); };
  const showZh = (id,tier) => tier === 'novice' || (tier === 'standard' && !hasPicture(id));
  const sceneArt = scene => scene?.bg && ui.manifest.images?.[scene.bg] ? `style="--kc-art:url('${e(imageURL(scene.bg,false))}')"` : '';
  // The scene's painting heads its page as a banner (the counter is laid over its quiet middle in the game's art brief).
  const hasBanner = scene => Boolean(scene?.bg && ui.manifest.images?.[scene.bg]);
  const banner = scene => hasBanner(scene) ? `<img class="kc-scene-banner" src="${e(imageURL(scene.bg,false))}" alt="" decoding="async" draggable="false">` : '';

  /* ---------- Progress (kept on the server by nickname) ---------- */
  function progressOf(id) { return ui.progress?.scenes?.[id] || null; }
  function isMastered(word) { const row = ui.progress?.words?.[word]; return Array.isArray(row) && row[2] === 1; }
  // The first scene is always open; the next opens once a scene has all three stars, and stays open.
  function unlocked(id) {
    const list = scenes();
    if (id === 'daily' || list[0]?.id === id) return true;
    return Boolean(progressOf(id)?.unlocked);
  }
  function sceneStars(scene) {
    const saved = progressOf(scene.id);
    return stars(Number.isInteger(saved?.passed) ? saved.passed : saved?.star1 ? 1 : 0);
  }
  const starRow = (count,cls = '') => `<span class="kc-stars ${cls}" aria-label="${count} 星">${[0,1,2].map(index => `<i class="${index < count ? 'is-on' : ''}">${icon('star')}</i>`).join('')}</span>`;
  async function community() {
    const api = await ui.opts.community?.();
    if (!api?.request) throw Object.assign(new Error('offline'),{code:'service_unavailable'});
    return api;
  }
  async function loadProgress() {
    try {
      const api = await community();
      const data = await api.request('/kitchen/progress',{timeout:8000});
      if (data && typeof data.scenes === 'object') {
        ui.progress = {scenes:data.scenes || {},words:data.words || {}};
        ui.prefs.progress = ui.progress;
        savePrefs();
        if (ui.open && ['home','scene','words'].includes(ui.view)) render();
      }
    } catch {}
  }
  async function loadDaily() {
    try {
      const api = await community();
      const data = await api.request('/kitchen/daily',{timeout:8000});
      if (!Number.isInteger(data?.seed) || !ui.data) return;
      ui.daily = {...data,scene:dailyScene(ui.data,data.seed)};
      if (ui.open && ['home','daily'].includes(ui.view)) render();
    } catch {}
  }

  /* ---------- Sound ---------- */
  // A few quiet synthesised cues; words and customers' lines go through the site's own player.
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
    go:() => { tone(587,.22,{type:'triangle',gain:.28}); tone(880,.42,{gain:.24,delay:.07}); },
    take:() => tone(1046,.12,{type:'triangle',gain:.18}),
    chop:() => { noise(.05,{gain:.35,from:2600,to:3200,q:2}); noise(.05,{gain:.3,from:2600,to:3200,q:2,delay:.12}); },
    sizzle:() => noise(.7,{gain:.14,from:3800,to:5200,q:.6}),
    ding:() => { tone(1318,.6,{gain:.16}); tone(1760,.8,{gain:.1,delay:.02}); },
    burn:() => { tone(330,.22,{type:'triangle',gain:.22}); tone(247,.4,{type:'triangle',gain:.2,delay:.18}); },
    bin:() => { tone(140,.18,{type:'sine',gain:.4,glide:80}); noise(.12,{gain:.12,from:400,to:300}); },
    serve:() => { tone(784,.3,{gain:.18}); tone(988,.3,{gain:.16,delay:.08}); tone(1318,.6,{gain:.14,delay:.16}); },
    call:() => { tone(880,.12,{type:'triangle',gain:.2}); tone(1175,.18,{type:'triangle',gain:.18,delay:.1}); },
    finish:() => { tone(523,.5,{gain:.2}); tone(659,.5,{gain:.18,delay:.09}); tone(784,.9,{gain:.18,delay:.18}); },
    ready:() => { tone(1175,.2,{gain:.1}); tone(1568,.36,{gain:.08,delay:.07}); },
    goal:() => { tone(784,.45,{gain:.13}); tone(1175,.55,{gain:.11,delay:.12}); tone(1568,.9,{gain:.09,delay:.24}); },
  };
  const play = name => { try { if (sfxContext()) SOUNDS[name]?.(); } catch {} };
  // Safari only lets sound start inside a tap or a key press, so the cues are woken up there (and again after the tab
  // was hidden, which closes them).
  function wakeSfx() { const context = ui.sfx.context; if (ui.prefs?.sound && (!context || context.state !== 'running')) sfxContext(); }
  // A word or a customer's line, read by the site's player (Pernille for words; customers in their own voice).
  function say(word,audio,onEnded) {
    if (!ui.prefs?.sound || !word) return;
    ui.saidAt = Date.now();
    try { void Promise.resolve(ui.opts.pronounce?.({word,audio:audio || ''},{onEnded})).catch(() => {}); } catch {}
  }
  const sayWord = id => { const item = entry(id); if (item) say(item.word,item.clip); };
  // Customers' lines wait for a word that is still being read, so a reading is never cut off.
  function sayLine(line) {
    if (!line?.text) return;
    const wait = Math.max(0,900-(Date.now()-(ui.saidAt || 0)));
    if (wait) later(() => say(line.text,line.audio),wait); else say(line.text,line.audio);
  }
  const lineFor = (group,key,voice) => { const set = ui.data?.lines?.[group]?.[key]; return set?.[voice] || set?.f || (set?.text ? set : null); };
  // A long restaurant order can exceed five seconds. An exclusion belongs to this reading only.
  function sayOrder(game,order) {
    const line = lineFor('order',order.dish,order.voice);
    if (!line?.text) return;
    const ticket = ui.orderReading = {}, active = () => ui.orderReading === ticket && ui.game === game && ui.view === 'game' && ui.prefs?.sound && !document.hidden;
    const without = order.without.length ? lineFor('without',order.without[0],order.voice) : null;
    const start = () => { if (active()) say(line.text,line.audio,without ? () => { if (active()) say(without.text,without.audio); } : undefined); };
    const wait = Math.max(0,900-(Date.now()-(ui.saidAt || 0)));
    if (wait) later(start,wait); else start();
  }
  function stopKitchenVoice() { ui.orderReading = null; ui.opts.stopAudio?.(); }
  // This game's words and lines are fetched before the start, so every tap sounds at once (the site keeps 60 decoded).
  function prefetchGame(game) {
    const words = game.scene.words.map(entry).filter(Boolean).map(item => ({word:item.word,audio:item.clip}));
    // The first customers' lines too, in the voice each will speak with.
    const lines = game.state.orders.slice(0,12).map(order => lineFor('order',order.dish,order.voice)).filter(line => line?.audio).map(line => ({word:line.text,audio:line.audio}));
    try { ui.opts.prefetch?.([...lines.slice(0,10),...words].slice(0,56)); } catch {}
  }

  /* ---------- Open, close, navigation ---------- */
  function open(options = {}) {
    if (ui.open) return Promise.resolve(true);
    if (!document?.body) return Promise.resolve(false);
    const prefs = readPrefs();
    Object.assign(ui,{open:true,opts:options,view:'home',prefs,progress:prefs.progress,nickname:window.NorskCommunity?.localPlayer?.()?.nickname || '',game:null,room:null,joining:false,joinCode:'',busy:false,
      confirming:false,picking:null,resultsFor:null,roomEdit:false,lastFocus:document.activeElement,historyToken:'kc-'+Date.now().toString(36)});
    const root = document.createElement('div');
    root.className = 'kc-root';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label','开饭啦');
    ui.root = root;
    // Page redraws replace only this container. The leave dialog stays mounted above it.
    ui.content = document.createElement('div');
    root.append(ui.content);
    ui.handlers = {click:onClick,submit:onSubmit,input:onInput,pointerdown:onPress,pointerup:onRelease,pointercancel:onRelease};
    for (const [type,handler] of Object.entries(ui.handlers)) root.addEventListener(type,handler);
    // A scrolled strip fades at whichever edge still hides something.
    root.addEventListener('scroll',event => { const node = event.target; if (node?.classList?.contains('kc-board-list') || node?.classList?.contains('kc-rail') || node?.classList?.contains('kc-cabs')) fadeEdges(node); },{capture:true,passive:true});
    document.addEventListener('keydown',onKey);
    document.addEventListener('focusin',onFocusIn);
    ui.onVisibility = onVisibility;
    ui.onPopState = () => { if (ui.open) requestClose(true); };
    document.addEventListener('visibilitychange',ui.onVisibility);
    window.addEventListener('online',flushPending);
    window.addEventListener('norskprofilechange',ui.onPlayerChange = event => {
      ui.nickname = event.detail?.nickname || '';
      if (ui.game && !ui.game.room && !ui.game.owner && ui.nickname) {
        ui.game.owner = ui.nickname;
        ui.game.ownerDevice ||= window.NorskCommunity?.localPlayer?.()?.deviceId || '';
      }
      void flushPending();
    });
    window.addEventListener('popstate',ui.onPopState);
    window.addEventListener('pagehide',ui.onPageHide = () => releaseSfx());
    // A turned tablet or a phone's browser bars change the room for the counter: it is laid out again.
    window.addEventListener('resize',ui.onResize = () => {
      clearTimeout(ui.resizeTimer);
      ui.resizeTimer = setTimeout(() => { if (ui.open && ui.view === 'game' && ui.game) { ui.game.shelfRoom = 0; ui.game.shelfColumns = 0; drawGame(); } },160);
    });
    try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskKitchen:ui.historyToken},'',location.href); } catch {}
    document.body.append(root);
    document.body.classList.add('kc-open');
    render();
    $('h2')?.focus?.({preventScroll:true});
    void loadData().then(() => {
      if (!ui.open) return;
      if (!ui.joining && ['home','scene','words','daily'].includes(ui.view)) render();
      void loadDaily();
    }).catch(() => { if (ui.open) { ui.loadFailed = true; render(); } });
    void loadProgress();
    void flushPending();
    void (async () => { try { const api = await community(); const profile = await api.profile?.(); if (profile?.nickname) ui.nickname = profile.nickname; } catch {} })();
    // The online card's picture, once it is drawn, also heads this game's home page.
    const art = new Image();
    art.onload = () => { ui.cardArt = true; if (ui.open && ui.view === 'home' && !ui.joining) render(); };
    art.src = versioned('assets/online/kitchen.webp');
    if (/^\d{4}$/.test(String(options.join || ''))) void joinRoom(String(options.join));
    return Promise.resolve(true);
  }
  function exit() {
    if (!ui.open) return;
    stopKitchenVoice();
    leaveRoom();
    stopGame();
    releaseSfx();
    for (const id of ui.timers) clearTimeout(id);
    ui.timers.clear();
    for (const [type,handler] of Object.entries(ui.handlers || {})) ui.root?.removeEventListener(type,handler);
    document.removeEventListener('visibilitychange',ui.onVisibility);
    window.removeEventListener('online',flushPending);
    window.removeEventListener('norskprofilechange',ui.onPlayerChange);
    document.removeEventListener('keydown',onKey);
    document.removeEventListener('focusin',onFocusIn);
    window.removeEventListener('popstate',ui.onPopState);
    window.removeEventListener('pagehide',ui.onPageHide);
    window.removeEventListener('resize',ui.onResize);
    clearTimeout(ui.resizeTimer);
    clearTimeout(ui.toastTimer);
    ui.toast?.remove();
    ui.toast = null;
    ui.fx?.remove();
    ui.fx = null;
    ui.root?.remove();
    document.body.classList.remove('kc-open');
    ui.open = false;
    ui.root = null;
    ui.content = null;
    if (history.state?.norskKitchen === ui.historyToken) {
      try { window.addEventListener('popstate',() => setRoomInURL(null),{once:true}); history.back(); } catch {}
    }
    try { ui.lastFocus?.focus?.({preventScroll:true}); } catch {}
    try { ui.opts.onExit?.(); } catch {}
  }
  // Back and Esc step out one level: a sheet, then a page, then a game (after asking), then the overlay.
  function requestClose(fromHistory = false) {
    if (fromHistory) {
      try { history.pushState({...(history.state && typeof history.state === 'object' ? history.state : {}),norskKitchen:ui.historyToken},'',location.href); } catch {}
    }
    if (ui.confirming) { hideConfirm(); return; }
    if (ui.picking) { closePicker(); return; }
    if (ui.game?.chatOpen) { ui.game.chatOpen = false; drawGame(); return; }
    if (ui.game?.watch) { ui.game = null; show('room'); return; }
    // The last moment of a game alone ("Stengt!") goes on to the results by itself.
    if (ui.game?.closing) return;
    if (ui.game && ['preview','game'].includes(ui.view)) { showConfirm(); return; }
    if (ui.joining) { ui.joining = false; render(); return; }
    if (ui.view === 'room' && ui.roomEdit) { ui.roomEdit = false; render(); return; }
    if (ui.view === 'room' && ui.room) { showConfirm('room'); return; }
    if (ui.view === 'results' && ui.room) { show('room'); return; }
    if (ui.view === 'results' && ui.resultsFor?.sceneId && ui.resultsFor.sceneId !== 'daily') { show('scene',{scene:ui.resultsFor.sceneId}); return; }
    if (ui.view !== 'home') { show('home'); return; }
    exit();
  }
  // The page behind the overlay is out of reach: Tab and Shift+Tab come back into the game.
  function onFocusIn(event) {
    if (!ui.open || !ui.root || ui.root.contains(event.target) || ui.toast?.contains(event.target)) return;
    (ui.root.querySelector('.kc-confirm [data-kc]') || ui.root.querySelector('.kc-sheet [data-kc]') || $('h2') || ui.root.querySelector('[data-kc]'))?.focus?.({preventScroll:true});
  }
  // The site's own toast sits under this overlay, so the game shows its messages itself, near the top of the page.
  function notify(message,duration = 3200) {
    if (!ui.open || !message) return;
    if (!ui.toast) {
      ui.toast = document.createElement('p');
      ui.toast.className = 'kc-toast';
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
  function show(view,{scene} = {}) {
    if (ui.room && !['room','preview','game','results'].includes(view)) leaveRoom();
    if (!['preview','game'].includes(view)) stopGame();
    if (scene) { ui.sceneId = scene; ui.prefs.scene = scene; savePrefs(); }
    ui.view = view;
    ui.picking = null;
    render();
    // The boards change with every game played today: they are fetched again each time the page opens.
    if (view === 'daily') void loadDaily();
    ui.root?.scrollTo?.(0,0);
    $('h2')?.focus?.({preventScroll:true});
  }
  function onVisibility() {
    if (document.hidden) { stopKitchenVoice(); releaseSfx(); pauseGame(); }
    else {
      if (ui.room) schedulePoll(0);
      if (ui.game?.paused && !ui.confirming) resumeGame();
    }
  }
  function showConfirm(kind = 'game') {
    if (ui.confirming || !ui.root) return;
    ui.confirming = true;
    ui.content.inert = true;
    pauseGame();
    const host = ui.room && ui.room.hostId === ui.room.me;
    const text = kind === 'room' ? `离开这个房间吗？${host ? '房主会交给下一位同学。' : '之后可以用房间号再回来。'}`
      : ui.room ? '离开这一局吗？你会退出这个房间。' : '离开这一局吗？这一局不会记入成绩。';
    const layer = document.createElement('div');
    layer.className = 'kc-confirm-layer';
    layer.innerHTML = `<div class="kc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="kc-confirm-text"><p id="kc-confirm-text">${text}</p><div class="kc-confirm-actions">${button('confirm-stay',kind === 'room' ? '留下' : '继续','kc-primary')}${button('confirm-leave',kind === 'room' ? '离开房间' : '离开','kc-quiet')}</div></div>`;
    ui.root.append(layer);
    layer.querySelector('[data-kc="confirm-stay"]')?.focus();
  }
  function hideConfirm() {
    ui.confirming = false;
    if (ui.content) ui.content.inert = false;
    ui.root?.querySelector('.kc-confirm-layer')?.remove();
    if (ui.game?.paused && !document.hidden) resumeGame();
  }

  /* ---------- Pages ---------- */
  function render() {
    if (!ui.root) return;
    ui.root.classList.toggle('is-game',ui.view === 'game');
    const entering = ui.shownView !== ui.view;
    ui.shownView = ui.view;
    if (ui.view === 'game') { drawGame(); return; }
    const page = {scene:scenePage,words:wordsPage,help:helpPage,daily:dailyPage,room:roomPage,preview:previewPage,results:resultsPage}[ui.view] || homePage;
    const keep = focusKey();
    // A new page comes up gently; the same page drawn again (a poll, a choice) stays still.
    ui.content.innerHTML = `<div class="kc-shell is-${ui.view}${entering && !reduceMotion() ? ' is-enter' : ''}">${page()}</div>`;
    restoreFocus(keep);
    // Big paintings fade in once they have loaded, instead of popping in over an empty block.
    for (const img of ui.root.querySelectorAll('img.kc-hero-art,img.kc-scene-banner')) {
      if (img.complete && img.naturalWidth) img.classList.add('is-loaded');
      else img.addEventListener('load',() => img.classList.add('is-loaded'),{once:true});
    }
    if (ui.view === 'results') countResults();
  }
  // The results page counts its score up once, when it first opens.
  function countResults() {
    const r = ui.resultsFor, node = $('.kc-result-score b');
    if (!r || !node || r.counted) return;
    r.counted = true;
    if (reduceMotion() || !r.score) return;
    const at = performance.now();
    r.shownScore = 0;
    node.textContent = '0';
    // (A redraw meanwhile — the XP arriving — prints the count where it is.)
    const step = time => {
      const k = Math.min(1,(time-at)/1100), shown = $('.kc-result-score b');
      if (ui.resultsFor !== r) return;
      r.shownScore = Math.round(r.score*(1-(1-k)**3));
      if (shown) shown.textContent = String(r.shownScore);
      if (k < 1) requestAnimationFrame(step); else r.shownScore = null;
    };
    requestAnimationFrame(step);
  }
  // A page drawn again keeps the focus on the same control (a poll redraws the lobby while someone is choosing).
  function focusKey() {
    const active = document.activeElement;
    if (!active || !ui.root?.contains(active) || !active.dataset?.kc) return null;
    return {kc:active.dataset.kc,value:active.dataset.value || active.dataset.id || active.dataset.word || active.dataset.n || active.dataset.x || ''};
  }
  function restoreFocus(keep) {
    if (!keep) return;
    const match = [...ui.root.querySelectorAll(`[data-kc="${CSS.escape(keep.kc)}"]`)].find(node => (node.dataset.value || node.dataset.id || node.dataset.word || node.dataset.n || node.dataset.x || '') === keep.value);
    match?.focus?.({preventScroll:true});
  }
  const topBar = (title,back = 'home',extra = '') => `<header class="kc-top">${back ? `<button type="button" class="kc-icon-button" data-kc="go" data-value="${back}" aria-label="返回">${icon('back')}</button>` : ''}<h2 tabindex="-1">${title}</h2>${extra}<button type="button" class="kc-icon-button" data-kc="close" aria-label="离开开饭啦" title="离开">${icon('close')}</button></header>`;
  const option = (group,value,label,current,hint = '') => `<button type="button" class="kc-option" role="radio" aria-checked="${current === value}" data-kc="set" data-key="${group}" data-value="${value}"><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</button>`;
  const loadingNote = () => ui.loadFailed ? `<p class="kc-empty">菜单没有载入，请检查网络后重试。${button('reload','重试','kc-ghost')}</p>` : '<p class="kc-empty">正在摆桌子…</p>';
  function homePage() {
    const list = scenes(), open = list.filter(scene => unlocked(scene.id)).length;
    // The newest scene I have opened, one tap away from the top of the page.
    const current = [...list].reverse().find(scene => unlocked(scene.id)) || null;
    const started = current && (progressOf(current.id)?.best || sceneStars(current));
    const resume = ui.data && current ? `<button type="button" class="kc-continue" data-kc="scene" data-id="${e(current.id)}">
        <span class="kc-continue-text"><small>${started ? '继续' : '从这里开始'} · 第 ${list.indexOf(current)+1} 个场景</small><span><strong lang="nb">${e(current.no)}</strong> ${e(current.zh)}</span></span>
        ${starRow(sceneStars(current))}<span class="kc-continue-go">${icon('next')}</span></button>` : '';
    const hero = `<section class="kc-hero">${ui.cardArt ? `<img class="kc-hero-art" src="${e(versioned('assets/online/kitchen.webp'))}" alt="" decoding="async" draggable="false">` : '<div class="kc-hero-art is-blank" aria-hidden="true"><span lang="nb">Vær så god</span></div>'}
      <div class="kc-hero-text"><p class="kc-hero-title">听懂点单，端上挪威饭菜</p>
      <p class="kc-hero-note">听挪威语点单，挑对食材端上桌；词练熟了，下一个场景就开门。</p>${resume}</div></section>`;
    if (!ui.data) return `${topBar('开饭啦','')}${hero}${loadingNote()}`;
    const daily = ui.daily;
    const dailyCard = `<section class="kc-daily"><div class="kc-daily-head"><div class="kc-daily-text"><span class="kc-kicker">Dagens meny</span><p class="kc-daily-title">今日菜单</p></div>
          ${daily ? `<button type="button" class="kc-link" data-kc="daily-open">今日榜${icon('next')}</button>` : '<span class="kc-hint">载入中…</span>'}</div>
        <p class="kc-hint">${daily ? `${e(daily.day)} · ` : ''}全服同一桌菜，北京时间 0 点换；不用解锁。</p>
        ${daily ? `<button type="button" class="kc-daily-dishes" data-kc="daily-open" aria-label="打开今日菜单">${daily.scene.dishes.slice(0,6).map(dish => pic(dish.word,'is-round')).join('')}</button>` : ''}</section>`;
    // Playing together and the reference pages sit right under the menus, not after sixteen scenes.
    const actions = `<div class="kc-actions">${ui.joining ? `<form class="kc-join" novalidate><label for="kc-join-code">房间号</label><input id="kc-join-code" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4 位数字" value="${e(ui.joinCode)}">
          <button type="submit" class="kc-button kc-primary" data-kc="join-submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '正在加入…' : '加入'}</button>${button('join-cancel','取消','kc-quiet')}</form>`
        : `<div class="kc-actions-row">${button('room-create-latest',`${icon('people')}<span>${ui.busy ? '正在开房间…' : '开房间'}</span>`,'kc-ghost',ui.busy ? 'disabled' : '')}${button('join-open',`${icon('link')}<span>加入房间</span>`,'kc-ghost')}</div>
          <div class="kc-actions-row is-quiet">${button('go',`${icon('book')}<span>食物图鉴</span>`,'kc-quiet','data-value="words"')}${button('go',`${icon('help')}<span>玩法</span>`,'kc-quiet','data-value="help"')}</div>`}</div>`;
    return `${topBar('开饭啦','')}${hero}${dailyCard}${actions}
      <section class="kc-panel"><div class="kc-section-head"><h3>场景</h3><span class="kc-hint">已开放 ${open} / ${list.length}</span></div>
        <ol class="kc-scenes">${list.map((scene,index) => sceneCard(scene,index)).join('')}</ol></section>`;
  }
  function sceneCard(scene,index) {
    const open = unlocked(scene.id), count = sceneStars(scene);
    // The next scene to open says so; the ones after it stay quiet.
    const next = !open && scenes().slice(0,index).every(item => unlocked(item.id));
    return `<li><button type="button" class="kc-scene${open ? '' : ' is-locked'}${next ? ' is-next' : ''}" data-kc="scene" data-id="${e(scene.id)}" aria-label="${e(`${scene.no} ${scene.zh}${open ? `，${count} 星` : '，未开放'}`)}">
      <span class="kc-scene-n">${String(index+1).padStart(2,'0')}</span><span class="kc-scene-text"><strong lang="nb">${e(scene.no)}</strong><small>${e(scene.zh)}${next ? '<em>上一个场景 ★★ 后开放</em>' : ''}</small></span>
      ${open ? starRow(count) : `<span class="kc-scene-lock">${icon('lock')}</span>`}</button></li>`;
  }
  function wordChip(id) {
    const state = isMastered(id) ? 'is-known' : ui.progress?.words?.[id] ? 'is-learning' : '';
    return `<li><button type="button" class="kc-chip ${state}" data-kc="hear" data-word="${e(id)}">${pic(id,'is-tiny')}<span class="kc-label">${wordHTML(id)}<small>${e(zh1(id))}</small></span></button></li>`;
  }
  // A level is open on the daily menu always, in a scene once the level below it is passed.
  const levelOpen = (scene,tier) => !scene || scene.id === 'daily' || tierOpen(sceneStars(scene),tier);
  const playableTier = scene => levelOpen(scene,ui.prefs.tier) ? ui.prefs.tier : [...TIER_IDS].reverse().find(id => levelOpen(scene,id)) || 'novice';
  function tierField(scene = null) {
    const count = scene && scene.id !== 'daily' ? sceneStars(scene) : -1, current = scene ? playableTier(scene) : ui.prefs.tier;
    const level = (id,index) => {
      const open = count < 0 || tierOpen(count,id), passed = count > index;
      const target = scene && scene.id !== 'daily' ? targetFor(scene,ui.prefs.minutes,id) : 0;
      const state = count < 0 ? '' : passed ? `<em class="kc-level-state is-passed">${icon('check')}已过</em>` : open ? '' : `<em class="kc-level-state is-locked">${icon('lock')}拿到 ${'★'.repeat(index)} 后开放</em>`;
      return `<button type="button" class="kc-option kc-level${passed ? ' is-passed' : ''}${open ? '' : ' is-locked'}" role="radio" aria-checked="${current === id}" data-kc="set" data-key="tier" data-value="${id}"${open ? '' : ' aria-disabled="true"'}>
        <span class="kc-level-head"><i class="kc-level-stars" aria-hidden="true">${'★'.repeat(index+1)}</i><span>${TIERS[id].name}${count < 0 ? '' : '关'}</span></span><small>${TIER_HINTS[id]}${target ? ` · 目标 ${target}` : ''}</small>${state}</button>`;
    };
    return `<div class="kc-field kc-levels-field"><span class="kc-field-label">${count < 0 ? '难度' : '三关'}</span><div class="kc-options kc-levels" role="radiogroup" aria-label="难度">${TIER_IDS.map(level).join('')}</div></div>`;
  }
  function minutesField() {
    return `<div class="kc-field"><span class="kc-field-label">时长</span><div class="kc-options is-compact" role="radiogroup" aria-label="时长">${MINUTES.map(value => option('minutes',String(value),`${value} 分钟`,String(ui.prefs.minutes))).join('')}</div></div>`;
  }
  function scenePage() {
    const scene = sceneById(ui.sceneId);
    if (!scene) return `${topBar('场景')}${loadingNote()}`;
    const saved = progressOf(scene.id), count = sceneStars(scene);
    const known = scene.words.filter(isMastered).length, index = scenes().indexOf(scene);
    return `${topBar(e(scene.zh))}
      <section class="kc-scene-hero${hasBanner(scene) ? ' has-banner' : ''}">${banner(scene)}<span class="kc-kicker">第 ${index+1} 个场景</span><p class="kc-scene-title" lang="nb">${e(scene.no)}</p>
        ${starRow(count,'is-large')}<p class="kc-scene-note">${e(scene.note || '')}</p>
        <dl class="kc-facts"><div><dt>熟练的词</dt><dd>${known} / ${scene.words.length}</dd></div><div><dt>最高</dt><dd>${saved?.best ? `${saved.best} 分` : '—'}</dd></div></dl>
        <p class="kc-hint">每过一关得一颗星，星不会掉；拿到 ★★ 开下一个场景</p></section>
      <section class="kc-panel kc-choices">${tierField(scene)}${minutesField()}</section>
      <section class="kc-panel"><div class="kc-section-head"><h3>这一关的词</h3><span class="kc-hint">点一下听读音</span></div><ul class="kc-chips">${scene.words.map(wordChip).join('')}</ul></section>
      ${situationsPanel(scene)}
      <div class="kc-start-bar"><div class="kc-actions-row">${button('solo',`${icon('plate')}<span>一个人开张</span>`,'kc-primary')}${button('room-create',`${icon('people')}<span>${ui.busy ? '正在开房间…' : '开房间'}</span>`,'kc-ghost',ui.busy ? 'disabled' : '')}</div></div>`;
  }
  // Things people say at this table, in both customers' voices (tapping again switches voice).
  function situationsPanel(scene) {
    const list = (scene.situations || []).map(entry).filter(Boolean);
    if (!list.length) return '';
    return `<section class="kc-panel"><div class="kc-section-head"><h3>情景句</h3><span class="kc-hint">学习例句 · 点一下听</span></div><ul class="kc-entries">${list.map(item => `<li class="kc-entry"><div class="kc-entry-text"><p><span class="kc-no" lang="nb">${e(item.word)}</span></p><p class="kc-entry-zh">${e(item.zh || '')}</p></div>
      <button type="button" class="kc-icon-button is-small" data-kc="say-line" data-word="${e(item.id)}" aria-label="听这一句">${icon('speaker')}</button></li>`).join('')}</ul></section>`;
  }
  function sayLineOf(id) {
    const item = entry(id), set = ui.data?.lines?.situation?.[id] || (item?.voices ? {f:{text:item.word,audio:item.voices.f},m:{text:item.word,audio:item.voices.m}} : null);
    ui.lineVoice = ui.lineVoice === 'f' ? 'm' : 'f';
    const line = set?.[ui.lineVoice] || set?.f;
    if (line?.audio) say(line.text || item?.word,line.audio); else if (item) say(item.word,item.clip);
  }
  function wordsPage() {
    if (!ui.data) return `${topBar('食物图鉴')}${loadingNote()}`;
    const all = [...ui.lexicon.values()];
    const known = all.filter(item => isMastered(item.id)).length;
    const tabs = [['all','全部'],['ingredient','食材'],['dish','菜'],['tool','餐具'],['verb','动作'],['taste','口味'],['situation','情景句']];
    const query = ui.wordsQuery.trim().toLocaleLowerCase('nb');
    const shown = all.filter(item => (ui.wordsTab === 'all' || item.kind === ui.wordsTab || (ui.wordsTab === 'taste' && item.kind === 'word'))
      && (!query || `${item.word} ${item.zh} ${item.en}`.toLocaleLowerCase('nb').includes(query)));
    const groups = (ui.categories || []).map(category => ({category,items:shown.filter(item => item.cat === category.id)})).filter(group => group.items.length);
    const leftover = shown.filter(item => !(ui.categories || []).some(category => category.id === item.cat));
    if (leftover.length) groups.push({category:{id:'other',zh:'其他',no:''},items:leftover});
    return `${topBar('食物图鉴')}
      <section class="kc-glossary-head"><p class="kc-big-count"><b>${known}</b> / ${all.length}</p><p class="kc-hint">已熟练的词（在游戏里答对 3 次、分在 2 天、最近一次答对）</p></section>
      <div class="kc-tabs" role="tablist">${tabs.map(([id,name]) => `<button type="button" role="tab" class="kc-tab" aria-selected="${ui.wordsTab === id}" data-kc="words-tab" data-value="${id}">${name}</button>`).join('')}</div>
      <input type="search" class="kc-search" id="kc-words-search" placeholder="搜索挪威语或中文" aria-label="搜索图鉴" value="${e(ui.wordsQuery)}">
      ${groups.length ? groups.map(({category,items}) => `<section class="kc-panel kc-glossary"><div class="kc-section-head"><h3>${e(category.zh)} <small lang="nb">${e(category.no || '')}</small></h3><span class="kc-hint">${items.length}</span></div>
        <ul class="kc-entries">${items.map(glossaryRow).join('')}</ul></section>`).join('') : '<p class="kc-empty">没有找到这个词。</p>'}`;
  }
  function glossaryRow(item) {
    const state = isMastered(item.id) ? 'is-known' : ui.progress?.words?.[item.id] ? 'is-learning' : '';
    const forms = (item.forms || []).filter(Boolean).join(' · ');
    return `<li class="kc-entry ${state}">${item.kind === 'situation' ? '' : pic(item.id,'is-small')}<div class="kc-entry-text"><p>${wordHTML(item.id)}${forms ? `<span class="kc-forms" lang="nb">${e(forms)}</span>` : ''}</p>
      <p class="kc-entry-zh">${e(item.zh || '')}</p>${item.note ? `<p class="kc-entry-note">${e(item.note)}</p>` : ''}${item.ex ? `<p class="kc-entry-ex"><span lang="nb">${e(item.ex)}</span>${item.exZh ? ` <span>${e(item.exZh)}</span>` : ''}<small>学习例句</small></p>` : ''}</div>
      <button type="button" class="kc-icon-button is-small" data-kc="${item.kind === 'situation' && (item.voices || ui.data?.lines?.situation?.[item.id]) ? 'say-line' : 'hear'}" data-word="${e(item.id)}" aria-label="听 ${e(item.word)}">${icon('speaker')}</button><i class="kc-dot" aria-hidden="true"></i></li>`;
  }
  function helpPage() {
    const steps = [
      ['前台接单','前台（Disken）左边是点单处：轮到的客人说要什么，点菜单板上对应的挪威语菜名，订单就送进后厨，客人走到右边取餐处等。'],
      ['后厨拿东西','后厨（Kjøkkenet）的订单是挪威语写的。去冰箱、架子上点那样东西，它会自己放到要它的托盘上。'],
      ['做菜','订单上写着 koke、steke、bake、skjære 的东西，点了会拿在手上，再点灶台上对应的锅、平底锅、烤箱或砧板。好了点一下回托盘；放太久会糊（brent!），点一下倒掉重做。'],
      ['上菜','托盘齐了会自己送到前台，出现在客人面前，点 Vær så god! 端给他。越快小费越多。底部两个标签切换前台和后厨。'],
      ['合作','联机时每样东西只在一位同学的柜子里。点订单上缺的那一样，选对挪威语就会向那位同学喊话。'],
      ['提示','新手：都有中文，东西上贴着价签；标准：前台只看图、后厨只看挪威语；高手：只听声音。'],
      ['三颗星','每个场景三关：★ 新手关、★★ 标准关、★★★ 高手关。打到这一关的目标分就过关，星拿到不会掉；拿到 ★★ 开下一个场景。联机时还要自己答对 80% 以上（至少答 5 题）。'],
      ['熟练','同一个词答对 3 次、分在 2 天、最近一次答对就算熟练；答错要再连对 2 次。熟练的词在图鉴里打勾，没熟练的词出得更多。'],
    ];
    return `${topBar('玩法')}<ol class="kc-help">${steps.map(([title,text],index) => `<li><span class="kc-help-n">${index+1}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join('')}</ol>`;
  }
  function dailyPage() {
    const daily = ui.daily;
    if (!daily) return `${topBar('今日菜单')}<p class="kc-empty">今日菜单需要联网，请稍后再试。</p>`;
    const rows = ui.dailyTab === 'team' ? daily.team || [] : daily.solo || [];
    return `${topBar('今日菜单')}
      <section class="kc-scene-hero"><span class="kc-kicker">Dagens meny · ${e(daily.day)}</span><p class="kc-scene-title">今日菜单</p>
        <div class="kc-daily-dishes is-wide">${daily.scene.dishes.map(dish => `<span class="kc-daily-dish">${pic(dish.word,'is-round')}${ui.prefs.tier === 'novice' ? `<small>${e(zh1(dish.word))}</small>` : ''}</span>`).join('')}</div>
        <p class="kc-hint">每个人当天看到的是同一桌菜，不用解锁。单人和合作各有一张榜。</p></section>
      <section class="kc-panel kc-choices">${tierField()}${minutesField()}</section>
      <div class="kc-start-bar"><div class="kc-actions-row">${button('solo-daily',`${icon('plate')}<span>一个人开张</span>`,'kc-primary')}${button('room-create-daily',`${icon('people')}<span>开房间</span>`,'kc-ghost',ui.busy ? 'disabled' : '')}</div></div>
      <section class="kc-panel"><div class="kc-tabs" role="tablist">${[['solo','单人榜'],['team','合作榜']].map(([id,name]) => `<button type="button" role="tab" class="kc-tab" aria-selected="${ui.dailyTab === id}" data-kc="daily-tab" data-value="${id}">${name}</button>`).join('')}</div>
        ${rows.length ? `<ol class="kc-board">${rows.map((row,index) => `<li class="${row.me ? 'is-me' : ''}"><span class="kc-rank">${index+1}</span><span class="kc-board-name">${e(ui.dailyTab === 'team' ? (row.names || []).join(' · ') : row.name)}</span><b>${row.score}</b></li>`).join('')}</ol>` : '<p class="kc-empty">今天还没有人上榜，来做第一桌吧。</p>'}</section>`;
  }

  /* ---------- Clicks and keys ---------- */
  function onClick(event) {
    const target = event.target.closest('[data-kc]');
    if (!target || !ui.root?.contains(target) || target.disabled) return;
    wakeSfx();
    const kc = target.dataset.kc, value = target.dataset.value;
    switch (kc) {
      case 'close': requestClose(); break;
      case 'go': if (value === 'home' && ui.room) { showConfirm('room'); break; } show(value || 'home'); break;
      case 'reload': ui.loadFailed = false; render(); void loadData().then(() => { if (ui.open) render(); }).catch(() => { if (ui.open) { ui.loadFailed = true; render(); } }); break;
      case 'scene': {
        const id = target.dataset.id;
        if (!unlocked(id)) { notify('上一个场景拿到 ★★ 后开放'); break; }
        show('scene',{scene:id});
        break;
      }
      case 'set': {
        const key = target.dataset.key;
        if (key === 'tier' && TIERS[value]) {
          if (target.getAttribute('aria-disabled') === 'true') { notify(value === 'expert' ? '拿到 ★★（过了标准关）后开放高手关' : '拿到 ★（过了新手关）后开放标准关',2200); break; }
          ui.prefs.tier = value;
        }
        if (key === 'minutes' && MINUTES.includes(Number(value))) ui.prefs.minutes = Number(value);
        savePrefs();
        if (ui.view === 'room' && ui.room?.hostId === ui.room?.me) { void pushRoomSettings(); }
        render();
        break;
      }
      case 'hear': sayWord(target.dataset.word); break;
      case 'say-line': sayLineOf(target.dataset.word); break;
      case 'words-tab': ui.wordsTab = value; render(); break;
      case 'daily-tab': ui.dailyTab = value === 'team' ? 'team' : 'solo'; render(); break;
      case 'daily-open': show('daily'); break;
      case 'solo': beginSolo(ui.sceneId); break;
      case 'solo-daily': beginSolo('daily'); break;
      case 'join-open': ui.joining = true; ui.joinCode = ''; render(); $('#kc-join-code')?.focus(); break;
      case 'join-cancel': ui.joining = false; render(); break;
      case 'room-create': void createRoom(ui.sceneId); break;
      case 'room-create-daily': void createRoom('daily'); break;
      // From the home page a room opens on the newest scene I have opened (the host can change it in the room).
      case 'room-create-latest': { const open = scenes().filter(scene => unlocked(scene.id)); if (open.length) void createRoom(open[open.length-1].id); break; }
      case 'confirm-stay': hideConfirm(); break;
      case 'confirm-leave': {
        const room = Boolean(ui.room);
        hideConfirm();
        stopGame();
        ui.game = null;
        if (room) { leaveRoom(); show('home'); }
        else show(ui.sceneId && ui.sceneId !== 'daily' ? 'scene' : 'home');
        break;
      }
      case 'ready-play': readyToPlay(); break;
      case 'again': if (ui.resultsFor?.sceneId) beginSolo(ui.resultsFor.sceneId); break;
      case 'to-scene': show(ui.resultsFor?.sceneId && ui.resultsFor.sceneId !== 'daily' ? 'scene' : ui.resultsFor?.sceneId === 'daily' ? 'daily' : 'home'); break;
      case 'to-room': show('room'); break;
      case 'wordbook': addSummaryToWordbook(); break;
      default: onGameClick(target,kc) || onRoomClick(target,kc);
    }
  }
  function onPress() { ui.pressing = true; ui.pressAt = Date.now(); }
  function onRelease() {
    // The click comes right after the release; the counter is drawn again once it has been handled.
    setTimeout(() => { ui.pressing = false; if (ui.redraw) { ui.redraw = false; drawGame(); } },0);
  }
  function onSubmit(event) {
    if (!event.target.closest('.kc-join')) return;
    event.preventDefault();
    const code = String($('#kc-join-code')?.value || '').trim();
    if (!/^\d{4}$/.test(code)) { notify('房间号是 4 位数字'); return; }
    void joinRoom(code);
  }
  function onInput(event) {
    if (event.target.id === 'kc-join-code') ui.joinCode = event.target.value.replace(/\D/g,'').slice(0,4);
    if (event.target.id === 'kc-words-search') {
      ui.wordsQuery = event.target.value;
      const at = event.target.selectionStart;
      render();
      const field = $('#kc-words-search');
      field?.focus();
      try { field?.setSelectionRange(at,at); } catch {}
    }
  }
  function onKey(event) {
    if (!ui.open) return;
    if (event.key === 'Escape' && ui.view === 'game' && ui.game?.hand && !ui.picking && !ui.confirming) { event.preventDefault(); ui.game.hand = null; drawGame(); return; }
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
    // Number keys pick a word in the shout sheet, and otherwise switch between the front (1) and the kitchen (2);
    // Tab stays inside the overlay (onFocusIn).
    if (ui.picking && /^[1-4]$/.test(event.key)) { ui.root?.querySelectorAll('.kc-sheet [data-kc="pick"]')[Number(event.key)-1]?.click(); return; }
    if (ui.view === 'game' && ui.game && !ui.confirming && /^[12]$/.test(event.key) && !event.target?.closest?.('input,textarea')) setScreen(ui.game,event.key === '1' ? 'front' : 'kitchen');
  }

  /* ---------- A game: the same screen alone or in a room ---------- */
  function rulesFor(sceneId) {
    const scene = sceneById(sceneId);
    return scene && ui.data ? {scene,rules:sceneRules(ui.data,scene)} : null;
  }
  const sessionId = () => `kc-${Date.now().toString(36)}-${Math.floor(Math.random()*2**32).toString(36)}`;
  // A game on the page: `sceneData` is kitchen.json's scene (names, pictures), `scene` the rules' view of it.
  function newGame({sceneId,scene,rules,state,me,room = false,extra = {}}) {
    stopKitchenVoice();
    return {sceneId,sceneData:scene,scene:rules,state,me,room,log:[],guest:-1,screen:'front',focus:-1,hand:null,cabOpen:'',phase:'preview',started:0,pausedTotal:0,paused:false,pausedAt:0,
      timer:null,note:null,calls:new Map(),heard:new Set(),pending:new Set(),floats:[],chatOpen:false,outbox:[],seq:0,seen:0,
      // What the screen remembers between redraws: customers just leaving, slots just filled, a tap just turned down,
      // pictures on their way, the score as shown.
      exits:[],fresh:new Map(),flash:null,flights:[],shown:state.score,goal:state.score >= targetFor(scene,state.minutes,state.tier),...extra};
  }
  async function beginSolo(sceneId) {
    if (!ui.data) return;
    // Pick the daily menu and its scoring date at entry to preview. A countdown
    // crossing Beijing midnight still belongs to the menu that was previewed.
    let menuAt = Date.now();
    if (sceneId === 'daily' && ui.daily?.day !== beijingDay(menuAt)) {
      if (ui.loadingSoloDaily) return;
      const overlay = ui.historyToken, view = ui.view;
      ui.loadingSoloDaily = true;
      try { await loadDaily(); } finally { ui.loadingSoloDaily = false; }
      if (!ui.open || overlay !== ui.historyToken || view !== ui.view) return;
      menuAt = Date.now();
      if (ui.daily?.day !== beijingDay(menuAt)) { notify('今天的菜单还未载入，请联网后再试。'); return; }
    }
    if (sceneId !== 'daily' && !unlocked(sceneId)) { notify('这个场景还没有开放'); return; }
    const found = rulesFor(sceneId);
    if (!found) { notify(sceneId === 'daily' ? '今日菜单需要联网，请稍后再试' : '找不到这个场景'); return; }
    const {scene,rules} = found, daily = sceneId === 'daily';
    // The daily menu is the same game for everyone; a scene leans towards the words I have not mastered yet.
    const weak = daily ? [] : rules.words.filter(word => !isMastered(word));
    const seed = daily ? ui.daily.seed >>> 0 : Math.floor(Math.random()*4294967296) >>> 0;
    const minutes = ui.prefs.minutes, tier = daily ? ui.prefs.tier : playableTier(scene);
    const state = newMatch(rules,{seed,minutes,tier,players:['me'],weak});
    const game = newGame({sceneId,scene,rules,state,me:'me',extra:{header:{scene:sceneId,day:daily ? ui.daily.day : undefined,seed,tier,minutes,weak:packWeak(rules,weak)}}});
    const local = window.NorskCommunity?.localPlayer?.();
    game.owner = local?.nickname || ui.nickname || '';
    game.ownerDevice = local?.deviceId || '';
    if (daily) game.playedAt = menuAt;
    ui.game = game;
    prefetchGame(game);
    show('preview');
  }
  // The dishes of this game, in the order the customers will order them (each once).
  function gameDishes(game) {
    const seen = [];
    for (const order of game.state.orders) if (!seen.includes(order.dish)) seen.push(order.dish);
    return seen.map(id => game.scene.dishes[id]).filter(Boolean);
  }
  function previewPage() {
    const game = ui.game;
    if (!game) return `${topBar('菜单预习')}<p class="kc-empty">这一局已经结束。</p>`;
    const novice = game.state.tier === 'novice', shop = game.scene.take === 'first';
    const room = game.room ? ui.room : null, match = room?.match;
    const tier = game.state.tier;
    const chip = id => `<li><button type="button" class="kc-chip" data-kc="hear" data-word="${e(id)}">${pic(id,'is-tiny')}<span class="kc-label">${wordHTML(id)}${showZh(id,tier) ? `<small>${e(zh1(id))}</small>` : ''}</span></button></li>`;
    const cards = gameDishes(game).map(dish => {
      const courses = Array.isArray(dish.courses) && dish.courses.length ? dish.courses : [dish];
      return courses.map((course,index) => {
        const name = index ? course.word : shop ? '' : dish.word;
        const items = [...course.slots.map(([item]) => item),...(course.tools || [])];
        return `<li class="kc-preview-dish">${name ? `<button type="button" class="kc-preview-name" data-kc="hear" data-word="${e(name)}">${pic(name,'is-medium')}<span class="kc-label">${wordHTML(name)}${showZh(name,tier) ? `<small>${e(zh1(name))}</small>` : ''}</span>${icon('speaker')}</button>` : ''}
          <ul class="kc-chips is-small">${items.map(chip).join('')}</ul></li>`;
      }).join('');
    }).join('');
    const prepared = match ? (match.prepared || []).length : 0, people = match ? (match.participants || []).length : 1;
    const mine = match && (match.prepared || []).includes(room.me);
    // While everyone's pictures load the menu can already be read; 准备好了 comes with the preview.
    const loading = room?.status === 'loading';
    const left = match?.previewEndsAt ? Math.max(0,Math.ceil((match.previewEndsAt-serverNow())/1000)) : 0;
    return `${topBar('菜单预习',game.room ? '' : game.sceneId === 'daily' ? 'daily' : 'scene')}
      <section class="kc-preview-head" ${sceneArt(game.sceneData)}><span class="kc-kicker" lang="nb">${e(game.sceneData.no)}</span><p class="kc-scene-title">这一局的菜</p>
        <p class="kc-hint">先点一点、听一听。${novice ? '开始后菜单、订单和东西上都有中文。' : tier === 'standard' ? '开始后前台客人只给你看图，后厨订单只写挪威语，东西上没有价签。' : '开始后客人只说话，后厨订单要点开听。'}</p></section>
      <ul class="kc-preview">${cards}</ul>
      <div class="kc-start-bar">${game.watch ? '<p class="kc-hint kc-center">这一局你在观战，下一局一起做。</p>' : `<div class="kc-actions-row">${button('ready-play',loading ? '正在摆桌子…' : mine ? '等同学…' : '准备好了','kc-primary kc-wide',mine || loading ? 'disabled' : '')}</div>`}
        ${match ? `<p class="kc-hint kc-center" id="kc-preview-wait">${prepared} / ${people} 人准备好了${left ? ` · ${left} 秒后开始` : ''}</p>` : ''}</div>`;
  }
  function readyToPlay() {
    const game = ui.game;
    if (!game || game.watch) return;
    wakeSfx();
    if (game.room) { void roomAction('ready',{prepared:true},true); render(); return; }
    startCountdown(game,Date.now()+3000);
  }
  // 3, 2, 1 on the page; alone it starts when the count ends, in a room on the server's start time.
  function startCountdown(game,endsAt) {
    game.phase = 'countdown';
    game.countEnds = endsAt;
    ui.view = 'game';
    drawGame();
    clearInterval(game.timer);
    let shown = -1;
    game.timer = setInterval(() => {
      const left = game.countEnds-(game.room ? serverNow() : Date.now());
      if (left <= 0) { clearInterval(game.timer); game.timer = null; startPlay(game); return; }
      const number = Math.ceil(left/1000);
      // Each number comes in on its own (a new element, so its fade starts again).
      if (number !== shown) { shown = number; const node = $('#kc-count-n'); if (node) node.innerHTML = `<b class="kc-digit">${number}</b>`; if (number <= 3) play('tick'); }
    },100);
  }
  function startPlay(game) {
    if (ui.game !== game) return;
    game.phase = 'play';
    if (!game.room) { game.started = performance.now(); game.playedAt ??= Date.now(); }
    game.playAt = Date.now();
    game.coached = new Set();
    game.coach = !game.watch && (ui.prefs.coach || 0) < 3;
    if (!game.watch) { ui.prefs.coach = (ui.prefs.coach || 0)+1; savePrefs(); }
    play('go');
    // The first customer's line and the first sounds come with the first tick.
    clearInterval(game.timer);
    game.timer = setInterval(() => tick(game),250);
    tick(game);
    drawGame();
    // The count may end while the page is hidden: alone, the kitchen then waits for the player to come back.
    if (document.hidden || ui.confirming) pauseGame();
  }
  function stopGame() {
    if (ui.game) stopKitchenVoice();
    const game = ui.game;
    if (game?.timer) { clearInterval(game.timer); game.timer = null; }
  }
  // Game time in milliseconds since the start signal, not counting pauses (a room keeps the server's time).
  function gameNow(game) {
    if (!game) return 0;
    if (game.room) return Math.max(0,Math.min(game.state.duration,Math.round(serverNow()-game.startsAt)));
    if (game.phase !== 'play') return 0;
    return Math.min(game.state.duration,Math.max(0,Math.round((game.paused ? game.pausedAt : performance.now())-game.started-game.pausedTotal)));
  }
  // Alone, the kitchen waits while the page is hidden or the leave question is open; a room goes on.
  function pauseGame() {
    const game = ui.game;
    if (!game || game.room || game.phase !== 'play' || game.paused) return;
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
    const expired = game.expireAt && Date.now() >= game.expireAt;
    if (expired) game.expireAt = 0;
    // Alone, the kitchen closes for a moment ("Stengt!") before the results.
    if (game.state.over && !game.room && !game.closing) { game.closing = true; later(() => finishSolo(game),1500); drawGame(); return; }
    if (events.length || expired) drawGame(); else updateHud(game,now);
    coach(game);
  }
  // Time-driven events are worked out again when a room's state is replaced; each is heard once.
  function remember(game,event) {
    if (!['arrive','leave','done','burn','end'].includes(event.e)) return true;
    const key = `${event.e}:${event.n ?? event.x ?? ''}:${event.at}`;
    if (game.heard.has(key)) return false;
    game.heard.add(key);
    return true;
  }
  function clockText(ms) { const s = Math.max(0,Math.ceil(ms/1000)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
  function updateHud(game,now = gameNow(game)) {
    const clock = $('#kc-clock'), left = game.state.duration-now;
    if (clock) { clock.textContent = clockText(left); clock.classList.toggle('is-late',game.phase === 'play' && left <= 30000); }
    // The last five seconds tick, quietly.
    const second = Math.ceil(left/1000);
    if (game.phase === 'play' && !game.paused && second >= 1 && second <= 5 && second !== game.lastTick) { game.lastTick = second; play('tick'); }
    if (game.note && Date.now() > game.note.until) { game.note = null; $('#kc-note')?.classList.remove('is-on'); }
  }

  // One tap that the rules judge: alone it takes effect at once; in a room it is shown at once and sent to the server.
  // `from` is where the tap's picture starts its short flight (the word on the shelf, the dish on the menu…).
  function act(action,from = null) {
    const game = ui.game;
    if (!game || game.phase !== 'play' || game.watch || game.state.over) return null;
    const now = gameNow(game);
    if (!game.room && now >= game.state.duration) { tick(game); return null; }
    const result = apply(game.state,game.scene,{...action,by:game.me},now);
    if (game.room) queueAction(game,action,now,result);
    else game.log.push({...action,at:now});
    game.actedAt = Date.now();
    const fresh = result.events.filter(event => remember(game,event));
    react(fresh,game);
    feedback(game,action,result);
    effects(game,action,result,from);
    drawGame();
    return result;
  }
  function feedback(game,action,result) {
    const right = result.learn.filter(([,ok]) => ok), wrong = result.learn.filter(([,ok]) => !ok);
    if (right.length) sayWord(right[right.length-1][0]);
    if (wrong.length) {
      const event = result.events.find(item => item.e === 'wrong');
      // A wrong dish shows the dish asked for; a wrong word on a plate or a station shows what the word means.
      const asked = action.t === 'take' ? event?.word : action.t === 'miss' || action.t === 'call' ? action.i || event?.word : event?.chosen || wrong[0][0];
      const label = action.t === 'take' ? '这位要的是' : action.t === 'miss' || action.t === 'call' ? '你选的是' : action.t === 'place' ? '你拿的是' : action.t === 'cook' ? '你点的是' : '这个词是';
      if (asked) {
        game.note = {kind:'fix',html:`<span class="kc-note-label">${label}</span><span class="kc-note-main">${wordHTML(asked)}<span class="kc-note-zh">${e(zh1(asked))}</span></span>${icon('speaker')}`,word:asked,until:Date.now()+3000};
        sayWord(asked);
      }
      return;
    }
    if (!result.ok && WHY[result.why] && !right.length) notify(WHY[result.why](takerName(game,action)),2200);
    else if (!result.ok && ['taken','noplate','busy'].includes(result.why)) notify(WHY[result.why](takerName(game,action)),2200);
  }
  function takerName(game,action) {
    const order = Number.isInteger(action.c) ? game.state.orders[action.c] : null;
    const id = order?.takenBy;
    return id === game.me ? '你' : (ui.room?.players || []).find(player => player.id === id)?.name || '同学';
  }
  // What my own tap looks like: the picture flies from where I tapped to where it went; a wrong answer warms the
  // thing tapped for a moment (the correction itself is the note at the top).
  function effects(game,action,result,from) {
    if (!result) return;
    const now = Date.now();
    if (result.learn.some(([,ok]) => !ok)) {
      if (action.t === 'take') { game.fresh.set(`bad:dish:${action.d}`,now); game.fresh.set(`bad:guest:${action.c}`,now); }
      else if (action.t === 'place') { game.fresh.set(`bad:item:${action.i}`,now); game.fresh.set(`bad:plate:${action.c}`,now); }
      else if (action.t === 'cook') game.fresh.set(`bad:kind:${action.k}`,now);
      else if (action.t === 'miss' || action.t === 'call') game.fresh.set(`bad:line:${action.c}:${action.n}`,now);
      buzz(14);
      return;
    }
    if (!result.ok || !from) return;
    for (const event of result.events) {
      const order = Number.isInteger(event.n) ? game.state.orders[event.n] : null;
      // An order taken goes into the kitchen as a slip (towards the kitchen's tab).
      if (event.e === 'take') fly(game,from,'.kc-room[data-value="kitchen"]',pic(order?.word || ''),{size:40});
      else if (event.e === 'place' || event.e === 'transfer') fly(game,from,result.events.some(other => other.e === 'complete' && other.n === event.n) ? '.kc-pass' : `.kc-tray[data-n="${event.n}"]`,pic(event.i));
      else if (event.e === 'cook') fly(game,from,`.kc-tool[data-x="${event.x}"]`,pic(event.i));
      else if (event.e === 'serve' || event.e === 'course') {
        // The dish goes over to its customer (who gets up once it is the last course).
        fly(game,from,`.kc-person[data-n="${event.n}"]`,pic(event.e === 'course' ? game.scene.dishes[order.dish]?.courses?.[event.course-1]?.word || order.word : finishedWord(game,order)),{size:48});
        buzz([8,40,8]);
      }
    }
  }
  // A short vibration on phones that have one (Android); quiet when the game's sound is off.
  function buzz(pattern) {
    try { if (ui.prefs?.sound && navigator.vibrate && window.matchMedia('(pointer: coarse)').matches) navigator.vibrate(pattern); } catch {}
  }
  // A picture on its way, from a box on the screen to the element the selector finds once the counter is drawn again.
  function fly(game,from,selector,html,{size = 34} = {}) {
    if (!from || reduceMotion() || !html) return;
    game.flights.push({from,selector,html,size,at:Date.now()});
  }
  function fxLayer() {
    if (!ui.fx || !ui.fx.isConnected) {
      ui.fx = document.createElement('div');
      ui.fx.className = 'kc-fx';
      ui.fx.setAttribute('aria-hidden','true');
      document.body.append(ui.fx);
    }
    return ui.fx;
  }
  function runFlights(game) {
    const list = game.flights.splice(0).filter(item => Date.now()-item.at < 1200);
    for (const item of list) {
      const target = ui.root?.querySelector(item.selector);
      if (!target || typeof Element.prototype.animate !== 'function') continue;
      const to = target.getBoundingClientRect(), from = item.from;
      const dx = from.left+from.width/2-(to.left+to.width/2), dy = from.top+from.height/2-(to.top+to.height/2);
      const node = document.createElement('div');
      node.className = 'kc-fly';
      node.style.cssText = `left:${to.left+to.width/2-item.size/2}px;top:${to.top+to.height/2-item.size/2}px;width:${item.size}px;height:${item.size}px`;
      node.innerHTML = item.html;
      fxLayer().append(node);
      // A gentle arc, eased out: it starts quickly and settles where it lands; nothing overshoots.
      const lift = Math.min(36,Math.hypot(dx,dy)*.18);
      const flight = node.animate([
        {transform:`translate(${dx}px,${dy}px) scale(.82)`,opacity:0},
        {transform:`translate(${dx*.55}px,${dy*.55-lift}px) scale(1)`,opacity:1,offset:.4},
        {transform:'translate(0,0) scale(1)',opacity:1,offset:.82},
        {transform:'translate(0,0) scale(.92)',opacity:0},
      ],{duration:Math.min(640,360+Math.hypot(dx,dy)*.45),easing:'cubic-bezier(.22,1,.36,1)'});
      const done = () => node.remove();
      flight.onfinish = done;
      flight.oncancel = done;
      // (A page put in the background stops its animations: the picture is taken off all the same.)
      setTimeout(done,1500);
    }
  }
  // The score counts up to its new value (and the line under it towards the ★ target).
  function tweenScore(game) {
    const goal = game.state.score;
    if (reduceMotion()) { game.shown = goal; paintScore(game); return; }
    if (game.shown === goal || game.tween?.to === goal) return;
    game.tween = {from:game.shown,to:goal,at:performance.now()};
    if (game.tweenFrame) return;
    const step = time => {
      const tween = game.tween;
      if (ui.game !== game || !tween) { game.tweenFrame = 0; return; }
      const k = Math.min(1,(time-tween.at)/750), eased = 1-(1-k)**3;
      game.shown = tween.from+(tween.to-tween.from)*eased;
      paintScore(game);
      if (k < 1) { game.tweenFrame = requestAnimationFrame(step); return; }
      game.shown = tween.to;
      game.tween = null;
      game.tweenFrame = 0;
    };
    game.tweenFrame = requestAnimationFrame(step);
  }
  function paintScore(game) {
    const score = $('#kc-score'), line = $('#kc-goal'), target = Math.max(1,targetFor(game.sceneData,game.state.minutes,game.state.tier));
    if (score) score.textContent = String(Math.round(game.shown));
    if (line) line.style.transform = `scaleX(${Math.min(1,game.shown/target).toFixed(3)})`;
  }
  // The first few games show one short hint at a time, when the player seems to wait for something to happen.
  function coach(game) {
    if (!game.coach || game.watch || game.phase !== 'play' || game.state.over) return;
    if (game.note && game.note.until > Date.now()-600) return;
    if (Date.now()-Math.max(game.actedAt || 0,game.playAt || 0) < 3200) return;
    const state = game.state, shop = game.scene.take === 'first';
    const tip = (key,text) => {
      if (game.coached.has(key)) return false;
      game.coached.add(key);
      game.note = {kind:'coach',html:`<span class="kc-note-label">小提示</span><span class="kc-note-main"><span class="kc-note-text">${text}</span></span>`,until:Date.now()+4800};
      drawGame();
      return true;
    };
    const front = game.screen !== 'kitchen', {ordering,cooking,ready} = groups(game), now = gameNow(game);
    const kitchen = shop ? '<b lang="nb">Lageret</b>' : '<b lang="nb">Kjøkkenet</b>';
    if (ready.length && front && tip('serve','菜做好了，就在客人面前：点 <b lang="nb">Vær så god!</b> 端给他')) return;
    if (ready.length && !front && tip('go-serve','做好的菜已经送去前台了，点下面的 <b lang="nb">Disken</b> 去上菜')) return;
    if (ordering.some(order => order.naming) && front && tip('naming','客人要点下一道菜了，在 <i lang="nb">Meny</i> 上点它的名字')) return;
    if (!front && state.stations.some(station => stationState(station,now) === 'burnt') && tip('burnt','糊了！点一下那口锅就倒掉，重新做')) return;
    if (!front && state.stations.some(station => stationState(station,now) === 'ready') && tip('transfer','锅里的好了，点一下，它就回到托盘上')) return;
    if (!front && game.hand && tip('hand','订单上写着 <i lang="nb">koke</i>、<i lang="nb">steke</i>… 的要先做：点灶台上对应的锅、平底锅或烤箱')) return;
    if (!front && cooking.length && tip('place','看订单上的挪威语，去冰箱和架子上点那样东西，它会自己放上托盘')) return;
    if (front && cooking.length && !ordering.length && tip('go-kitchen',`单接好了，点下面的 ${kitchen} 去做`)) return;
    if (front && ordering.length) tip('take',shop ? '听客人的清单，在 <i lang="nb">Hylla</i> 上点清单上的第一样' : '轮到的客人在说要什么，点菜单上这道菜的挪威语名字');
  }
  // Sounds, voices and notices for what happened. My own taps were judged already; others' come from the server.
  function react(events,game) {
    for (const event of events) {
      const order = Number.isInteger(event.n) ? game.state.orders[event.n] : null;
      switch (event.e) {
        case 'arrive':
          if (!order) break;
          sayOrder(game,order);
          break;
        case 'leave': {
          if (game.guest === event.n) game.guest = -1;
          if (game.focus === event.n) game.focus = -1;
          if (game.hand?.order === event.n) {
            const item = game.hand.item;
            const next = game.state.orders.find(other => other.n !== event.n && other.status === 'taken' && !other.naming && other.slots.some(slot => slot.i === item && slot.k && slot.s === 'open'));
            game.hand = next ? {...game.hand,order:next.n} : null;
          }
          // Tired of waiting: the customer fades out from the till or the pickup counter.
          if (order) game.exits.push({n:event.n,zone:order.takenAt >= 0 ? 'pickup' : 'order',customer:order.customer,mood:'impatient',text:'',at:Date.now(),until:Date.now()+1000});
          break;
        }
        case 'done': play('ding'); game.fresh.set(`station:${event.x}`,Date.now()); break;
        case 'burn':
          play('burn');
          game.fresh.set(`station:${event.x}`,Date.now());
          if (!game.note || game.note.until < Date.now() || game.note.kind === 'coach') game.note = {kind:'burn',html:`<span class="kc-note-label">${game.screen === 'kitchen' ? '灶台上' : '后厨'}</span><span class="kc-note-main"><b lang="nb">brent!</b><span class="kc-note-zh">糊了，${game.screen === 'kitchen' ? '点那口锅倒掉重做' : '快去后厨倒掉重做'}</span></span>`,until:Date.now()+2800};
          break;
        case 'cook': play(event.k === 'skjaere' ? 'chop' : 'sizzle'); game.fresh.set(`station:${event.x}`,Date.now()); break;
        case 'take': play('take'); game.fresh.set(`plate:${event.n}`,Date.now()); break;
        case 'named': play('take'); break;
        case 'place': case 'transfer': game.fresh.set(`slot:${event.n}:${event.slot}`,Date.now()); if (event.e === 'transfer') game.fresh.set(`station:${event.x}`,Date.now()); break;
        // Everything is on the plate: the ingredients come together into the dish.
        // (A room's server repeats the event a moment later; it is shown once.)
        case 'complete': {
          const key = `${event.n}:${order?.course ?? 0}`;
          if (game.readied?.has(key)) break;
          (game.readied ||= new Set()).add(key);
          game.fresh.set(`done:${event.n}`,Date.now());
          play('ready');
          break;
        }
        case 'trash': play('bin'); game.fresh.set(`station:${event.x}`,Date.now()); break;
        case 'course': case 'serve': {
          play('serve');
          // A hint about handing a dish over is done with once one is handed over.
          if (game.note?.kind === 'coach') game.note = null;
          game.floats = game.floats.filter(item => item.until > Date.now());
          if (!order) break;
          const reply = lineFor('reply',event.e === 'serve' && event.tip >= 10 ? 'nydelig' : 'takk',order.voice);
          if (reply) sayLine(reply);
          game.floats.push({n:event.n,plate:event.plate,text:`+${event.points+(event.tip || 0)}`,reply:reply?.text || 'Takk!',at:Date.now(),until:Date.now()+1800});
          // The last course: the customer thanks the kitchen and leaves the pickup counter.
          if (event.e === 'serve') game.exits.push({n:event.n,zone:'pickup',customer:order.customer,mood:'happy',text:reply?.text || 'Takk!',at:Date.now(),until:Date.now()+1500});
          break;
        }
        case 'call':
          if (event.to === game.me && event.by !== game.me) {
            play('call');
            game.calls.set(event.i,Date.now()+7000);
            // The cabinet with the word asked for opens (on a phone, where one is open at a time).
            if (!game.hand) { const cabinet = game.scene.cabinetOf[event.i]; if (cabinet) game.cabOpen = cabinet; }
            const line = ui.data?.lines?.need?.[event.i];
            notify(`${nameOf(event.by)}：${line?.text || `Jeg trenger ${plainWord(event.i)}!`}`,3200);
            if (line) sayLine(line);
          }
          break;
        case 'chat': {
          const line = ui.data?.lines?.chat?.[event.w];
          game.chats = {...(game.chats || {}),[event.by]:{text:line?.text || event.w,until:Date.now()+2600}};
          if (event.by !== game.me && line) sayLine(line);
          break;
        }
        case 'away': if (event.by !== game.me) notify(`${nameOf(event.by)} 掉线了，柜子先交给同学`,2600); break;
        case 'end': play('finish'); break;
        default: break;
      }
    }
  }
  const nameOf = id => (ui.room?.players || []).find(player => player.id === id)?.name || '同学';
  // The mark on an avatar: a name's first character, or the last two digits of a default name (学习者1938 → 38), as a
  // class of 学习者 would otherwise all show 学.
  const initial = name => { const text = String(name || '').trim(); return /^学习者\d{2,}$/.test(text) ? text.slice(-2) : [...text][0] || '?'; };

  /* The game screen: two rooms, switched at the bottom. Disken (the front): customers order at the till under the
     menu board and wait at the pickup counter, where their finished dish lands in front of them. Kjøkkenet (the
     kitchen): the orders written in Norwegian over their trays, the real fridge and shelves to take things from, the
     stove, and the pass that sends a full tray out by itself. */
  // The screen is drawn again on every change. Not while a finger or the mouse is down, though: a tap whose button
  // were replaced between press and release would be lost; it is drawn right after the tap instead.
  function drawGame() {
    const game = ui.game;
    if (!ui.root || !game || ui.view !== 'game') return;
    if (ui.pressing && Date.now()-ui.pressAt < 1500) { ui.redraw = true; return; }
    ui.root.classList.add('is-game');
    const keep = focusKey();
    // A redraw keeps every strip where the player had scrolled it.
    const scrolled = [...ui.root.querySelectorAll('[data-scroll]')].map(node => [node.dataset.scroll,node.scrollLeft,node.scrollTop]);
    paint(game);
    for (const [key,left,top] of scrolled) {
      const node = ui.root.querySelector(`[data-scroll="${CSS.escape(key)}"]`);
      if (node) { node.scrollLeft = left; node.scrollTop = top; }
    }
    restoreFocus(keep);
    // A strip that runs on past the screen fades at its edge (only then: a fade on a short strip looks disabled).
    for (const strip of ui.root.querySelectorAll('.kc-rail,.kc-cabs,.kc-board-list')) fadeEdges(strip);
    // The next bubble, score or leaving customer to fade is taken off then (tick draws again at that moment).
    const fading = [...game.floats.map(item => item.until),...game.exits.map(item => item.until),...Object.values(game.chats || {}).map(item => item.until)].filter(at => at > Date.now());
    game.expireAt = fading.length ? Math.min(...fading)+60 : 0;
    const target = targetFor(game.sceneData,game.state.minutes,game.state.tier);
    // Reaching the ★ target in the middle of a game is worth a quiet moment.
    if (!game.goal && game.state.score >= target && game.phase === 'play') {
      game.goal = true;
      game.goalAt = Date.now();
      play('goal');
      notify(game.room ? `全队达到目标 ${target} 分` : `达到${TIERS[game.state.tier]?.name || ''}关目标 ${target} 分`,2400);
    }
    tweenScore(game);
    runFlights(game);
  }
  function paint(game) { ui.content.innerHTML = gameMarkup(game); }
  // Which edge of a scrolling strip has more to show.
  function fadeEdges(strip) {
    const wide = strip.scrollWidth > strip.clientWidth+2, tall = strip.scrollHeight > strip.clientHeight+2;
    strip.classList.toggle('is-overflow',(wide && strip.scrollLeft+strip.clientWidth < strip.scrollWidth-4) || (tall && strip.scrollTop+strip.clientHeight < strip.scrollHeight-4));
    strip.classList.toggle('is-scrolled',(wide && strip.scrollLeft > 4) || (tall && strip.scrollTop > 4));
  }
  // A moment's effect that must carry on smoothly when the screen is drawn again: the time since it began, as a
  // negative animation delay ('' once it is over).
  function since(game,key,ms = 900) {
    const at = game.fresh.get(key);
    const age = at ? Date.now()-at : Infinity;
    return age < ms ? `-${age}ms` : '';
  }
  const shopScene = game => game.scene.take === 'first';
  // Who is where. Still to order: new customers, and a diner whose next course is to be named. Waiting for food:
  // every order taken. The customer at the till is the one tapped, or else whoever came first.
  function groups(game) {
    const orders = game.state.orders;
    const ordering = orders.filter(order => order.status === 'wait' || (order.status === 'taken' && order.naming)).sort((a,b) => a.arrivedAt-b.arrivedAt || a.n-b.n);
    const making = orders.filter(order => order.status === 'taken' && !order.naming).sort((a,b) => a.takenAt-b.takenAt || a.n-b.n);
    const asker = ordering.find(order => order.n === game.guest) || ordering[0] || null;
    game.guest = asker ? asker.n : -1;
    const ready = making.filter(order => complete(order));
    return {ordering,making,asker,ready,cooking:making.filter(order => !complete(order))};
  }
  // The menu board: every dish name of the scene (and later courses); in the shop, everything on the shelves.
  function menuWords(scene) {
    const words = [];
    const add = word => { if (word && !words.includes(word)) words.push(word); };
    for (const id of scene.dishList) {
      const dish = scene.dishes[id];
      if (scene.take === 'first') { for (const course of (dish.courses?.length ? dish.courses : [dish])) for (const [item] of course.slots) add(item); continue; }
      (dish.courses?.length ? dish.courses : [dish]).forEach((course,index) => add(index ? course.word : dish.word));
    }
    return words.sort((a,b) => scene.words.indexOf(a)-scene.words.indexOf(b));
  }
  function mood(order,now) {
    if (order.status === 'served') return 'happy';
    return order.leavesAt-now < order.patience*.3 ? 'impatient' : 'neutral';
  }
  function gameMarkup(game) {
    const state = game.state, now = gameNow(game), tier = state.tier;
    for (const [key,at] of game.fresh) if (Date.now()-at > 1600) game.fresh.delete(key);
    game.exits = game.exits.filter(exit => exit.until > Date.now());
    const screen = game.screen === 'kitchen' ? 'kitchen' : 'front';
    const view = screen === 'front' ? frontMarkup(game,now) : kitchenMarkup(game,now);
    const noteOn = game.note && game.note.until > Date.now();
    if (game.note && !game.note.at) game.note.at = Date.now();
    const note = `<button type="button" class="kc-note is-${game.note?.kind || 'fix'}${noteOn ? ' is-on' : ''}" id="kc-note" data-kc="hear" data-word="${e(game.note?.word || '')}" ${noteOn && game.note.word ? '' : 'tabindex="-1"'} ${noteOn ? `style="--kc-fx:-${Date.now()-game.note.at}ms"` : ''}>${game.note?.html || ''}</button>`;
    const count = game.phase === 'countdown' ? `<div class="kc-count" aria-live="assertive"><span id="kc-count-n"><b class="kc-digit">${Math.max(1,Math.ceil((game.countEnds-(game.room ? serverNow() : Date.now()))/1000))}</b></span><small>准备开张</small></div>` : '';
    const over = state.over && (game.room || game.closing) ? `<div class="kc-count is-end"><span lang="nb">Stengt!</span><small>${game.room ? '本局结束，正在算分…' : '打烊了，正在算分…'}</small></div>` : '';
    const watch = game.watch ? '<p class="kc-watch">观战中 · 下一局一起做</p>' : '';
    const chat = game.chatOpen ? `<div class="kc-chat-menu" style="--kc-fx:${since(game,'chat',400) || '-400ms'}">${CHATS.map(id => `<button type="button" class="kc-button kc-ghost" data-kc="chat" data-value="${id}" lang="nb">${e(ui.data?.lines?.chat?.[id]?.text || id)}</button>`).join('')}</div>` : '';
    // Looping motion (steam, a glowing button) runs on the clock, so a redraw picks it up where it was.
    const layout = `--kc-phase:-${Date.now()%3600000}ms`;
    return `<div class="kc-game is-${tier} is-${screen}${game.hand ? ' is-holding' : ''}${state.plates.length === PLATES_ROOM ? ' is-room' : ''}${shopScene(game) ? ' is-shop' : ''}" style="${layout}">${barMarkup(game,now)}${chat}${watch}${view}${handMarkup(game)}${tabsMarkup(game,now)}${note}${count}${over}${pickerMarkup(game)}</div>`;
  }
  // The bar: leave, the scene and its clock, the cooks, the score with its line towards the ★ target, sound.
  function barMarkup(game,now) {
    const state = game.state, room = game.room ? ui.room : null;
    const crew = room ? `<div class="kc-crew" aria-label="厨师">${state.players.map(player => {
      const name = nameOf(player.id), chat = game.chats?.[player.id];
      return `<span class="kc-cook${player.id === game.me ? ' is-me' : ''}${player.away ? ' is-away' : ''}" title="${e(name)}"><span class="kc-avatar">${e(initial(name))}</span>${chat && chat.until > Date.now() ? `<span class="kc-chat-bubble" lang="nb">${e(chat.text)}</span>` : ''}</span>`;
    }).join('')}</div>` : '';
    const target = targetFor(game.sceneData,state.minutes,state.tier), left = state.duration-now;
    const goalAge = game.goalAt ? Date.now()-game.goalAt : Infinity;
    return `<header class="kc-bar"><button type="button" class="kc-icon-button" data-kc="close" aria-label="离开这一局">${icon('close')}</button>
      <div class="kc-bar-title"><span lang="nb">${e(game.sceneData.no)}${state.tier === 'novice' && game.sceneData.zh ? `<small>${e(game.sceneData.zh)}</small>` : ''}</span><span class="kc-clock${game.phase === 'play' && left <= 30000 ? ' is-late' : ''}" id="kc-clock">${clockText(left)}</span></div>${crew}
      <div class="kc-scoreboard${game.goal ? ' is-reached' : ''}${goalAge < 1800 ? ' is-new' : ''}" ${goalAge < 1800 ? `style="--kc-fx:-${goalAge}ms"` : ''}><b id="kc-score">${Math.round(game.shown)}</b>
        <small>★ ${target}</small><span class="kc-goal" aria-hidden="true"><i id="kc-goal" style="transform:scaleX(${Math.min(1,game.shown/Math.max(1,target)).toFixed(3)})"></i></span></div>
      ${room && !game.watch ? `<button type="button" class="kc-icon-button" data-kc="chat-open" aria-label="快捷短语" aria-expanded="${game.chatOpen}">${icon('chat')}</button>` : ''}
      <button type="button" class="kc-icon-button" data-kc="sound" aria-label="${ui.prefs.sound ? '关闭声音' : '打开声音'}">${icon(ui.prefs.sound ? 'sound' : 'mute')}</button></header>`;
  }
  // The two rooms at the bottom, each saying in words what waits there.
  function tabsMarkup(game,now) {
    const {ordering,cooking,ready} = groups(game), novice = game.state.tier === 'novice', shop = shopScene(game);
    const front = game.screen !== 'kitchen';
    const pot = game.state.stations.some(station => stationState(station,now) === 'burnt') ? '糊了！' : game.state.stations.some(station => stationState(station,now) === 'ready') ? '锅里好了' : '';
    const frontNote = [ordering.length ? `${ordering.length} 人点单` : '',ready.length ? `${ready.length} 份待上菜` : ''].filter(Boolean).join(' · ');
    const kitchenNote = [cooking.length ? `${cooking.length} 单在做` : '',pot].filter(Boolean).join(' · ');
    const tab = (value,on,calling,mark,no,zh,note) => `<button type="button" role="tab" class="kc-room${on ? ' is-on' : ''}${calling ? ' is-calling' : ''}" data-kc="screen" data-value="${value}" aria-selected="${on}">${icon(mark)}<span class="kc-room-text"><span class="kc-room-name"><b lang="nb">${no}</b>${novice ? `<small>${zh}</small>` : ''}</span>${note ? `<small class="kc-room-note">${e(note)}</small>` : ''}</span></button>`;
    return `<nav class="kc-switch" role="tablist" aria-label="前台和后厨">${tab('front',front,!front && (ordering.length > 0 || ready.length > 0),'bell','Disken','前台',frontNote)}${tab('kitchen',!front,front && Boolean(pot),shop ? 'pantry' : 'koke',shop ? 'Lageret' : 'Kjøkkenet',shop ? '仓库' : '后厨',kitchenNote)}</nav>`;
  }

  /* Disken: the till and the pickup counter */
  function frontMarkup(game,now) {
    const {ordering,making,asker} = groups(game), tier = game.state.tier, novice = tier === 'novice', shop = shopScene(game);
    const menu = menuWords(game.scene);
    const board = `<section class="kc-board${menu.length > 8 ? ' is-long' : ''}" aria-label="${shop ? '货架' : '菜单'}">
      <header class="kc-board-head"><span class="kc-board-title" lang="nb">${shop ? 'Hylla' : 'Meny'}</span><span class="kc-board-sign"><b lang="nb">Bestill her</b>${novice ? '<small>在这里点单</small>' : ''}</span></header>
      <div class="kc-board-list" data-scroll="menu">${menu.map(word => {
        const wrong = since(game,`bad:dish:${word}`);
        return `<button type="button" class="kc-dish${wrong ? ' is-wrong' : ''}" data-kc="dish" data-word="${e(word)}" ${wrong ? `style="--kc-fx:${wrong}"` : ''}>${wordHTML(word,{article:false})}${novice ? `<small>${e(zh1(word))}</small>` : ''}</button>`;
      }).join('')}</div></section>`;
    const queue = ordering.filter(order => order !== asker);
    const later = game.state.next < game.state.orders.length;
    const till = asker ? `${askBubble(game,asker,now)}${personHTML(game,asker,now,'is-asker')}
        <div class="kc-queue" aria-label="排队">${queue.slice(0,3).map(order => personHTML(game,order,now,'is-queued')).join('')}${queue.length > 3 ? `<span class="kc-queue-more">+${queue.length-3}</span>` : ''}</div>`
      : `<p class="kc-quiet-note">${later ? '下一位客人马上就到' : '今天的客人都来过了'}</p>`;
    const leaving = exitsIn(game,'order');
    const pickup = making.map(order => pickupSpot(game,order,now)).join('')+exitsIn(game,'pickup');
    const looks = [hasBanner(game.sceneData) ? `--kc-art:url('${e(imageURL(game.sceneData.bg,false))}')` : '',artURL('kitchen/skilt') ? `--kc-sign-art:url('${e(artURL('kitchen/skilt'))}')` : ''].filter(Boolean).join(';');
    return `<div class="kc-front${artURL('kitchen/skilt') ? ' is-painted' : ''}" ${looks ? `style="${looks}"` : ''}>
      <section class="kc-zone is-order" aria-label="点单"><div class="kc-zone-art" aria-hidden="true"></div>${board}<div class="kc-till">${till}${leaving ? `<div class="kc-leaving">${leaving}</div>` : ''}</div></section>
      <section class="kc-zone is-pickup" aria-label="取餐" style="--kc-spots:${Math.max(3,making.length+game.exits.filter(exit => exit.zone === 'pickup').length)}"><div class="kc-zone-art" aria-hidden="true"></div>
        <header class="kc-sign"><b lang="nb">Hent her</b>${novice ? '<small>在这里取餐</small>' : ''}</header>
        <div class="kc-spots">${pickup || `<p class="kc-quiet-note">${novice ? '接了单的客人在这里等菜' : ''}</p>`}</div></section></div>`;
  }
  // A customer standing at the counter: the figure (its mood follows their patience) and a slim bar of patience.
  function personHTML(game,order,now,cls = '') {
    const elapsed = Math.max(0,now-order.arrivedAt), hurry = order.leavesAt-now < order.patience*.3;
    const wrong = since(game,`bad:guest:${order.n}`);
    const float = game.floats.find(item => item.n === order.n && item.until > Date.now());
    const label = cls.includes('is-queued') ? '排队的客人，点一下让他先点' : '客人，点一下再听一遍';
    return `<button type="button" class="kc-person ${cls}${hurry ? ' is-hurry' : ''}${elapsed < 700 ? ' is-arriving' : ''}${wrong ? ' is-wrong' : ''}" data-kc="guest" data-n="${order.n}" aria-label="${label}"
      style="--kc-patience:${order.patience}ms;--kc-elapsed:-${elapsed}ms${wrong ? `;--kc-fx:${wrong}` : ''}">${faceHTML(order.customer,mood(order,now),'is-figure')}<i class="kc-patience" aria-hidden="true"><i></i></i>${float ? floatHTML(float) : ''}</button>`;
  }
  const floatHTML = float => `<span class="kc-float" aria-hidden="true" style="animation-delay:-${Date.now()-float.at}ms"><b>${e(float.text)}</b><small lang="nb">${e(float.reply)}</small></span>`;
  // What the customer at the till wants, by tier: 新手 the picture, the Chinese and their Norwegian words; 标准 the
  // picture; 高手 nothing but their voice.
  function askBubble(game,order,now) {
    const tier = game.state.tier, novice = tier === 'novice', scene = game.scene, dish = scene.dishes[order.dish], shop = shopScene(game);
    const line = order.naming ? null : lineFor('order',order.dish,order.voice);
    let pics, zh;
    if (shop && !order.naming) {
      const items = dish.slots.slice(0,4).map(([item]) => item);
      pics = `<span class="kc-ask-list">${items.map(item => pic(item,'is-list')).join('')}</span>`;
      zh = items.map(zh1).join('、');
    } else { pics = pic(order.word,'is-bubble'); zh = zh1(order.word); }
    const without = order.without.length && !order.naming ? order.without[0] : '';
    const showText = novice || (tier === 'standard' && !hasPicture(order.word));
    const body = tier === 'expert' ? `<span class="kc-ask-ear">${icon('speaker')}</span><span class="kc-ask-text"><span class="kc-ask-hint">${order.naming ? '要点下一道了，' : ''}点客人再听一遍</span></span>`
      : `${pics}<span class="kc-ask-text">${novice && line?.text ? `<span class="kc-ask-line" lang="nb">${e(line.text)}</span>` : ''}${showText ? `<span class="kc-ask-zh">${e(order.naming ? `下一道：${zh}` : shop ? `清单：${zh}` : zh)}</span>` : ''}${without && novice ? `<span class="kc-ask-without">不要${e(zh1(without))}</span>` : ''}</span>${without ? `<span class="kc-without">${pic(without,'is-tiny')}</span>` : ''}`;
    return `<div class="kc-ask${order.naming ? ' is-naming' : ''}" aria-live="polite">${body}<span class="kc-ask-q" aria-hidden="true">?</span><i class="kc-patience" aria-hidden="true" style="--kc-patience:${order.patience}ms;--kc-elapsed:-${Math.max(0,now-order.arrivedAt)}ms"><i></i></i></div>`;
  }
  // What a finished order looks like: the dish (in the shop, the shopping list's picture).
  const finishedWord = (game,order) => shopScene(game) ? game.scene.dishes[order.dish]?.word || order.word : order.word;
  // A place at the pickup counter: the customer, and in front of them their slip with how far the kitchen has got, or
  // their finished dish, which is handed over with one tap.
  function pickupSpot(game,order,now) {
    const done = complete(order), all = [...order.slots,...order.tools], filled = all.filter(slot => slot.s === 'done').length;
    const ready = since(game,`done:${order.n}`,1200), novice = game.state.tier === 'novice';
    const courses = order.next.length || order.course ? `<span class="kc-courses">${Array.from({length:order.course+1+order.next.length},(_,i) => `<i class="${i < order.course ? 'is-done' : i === order.course ? 'is-now' : ''}"></i>`).join('')}</span>` : '';
    const counter = done ? `<button type="button" class="kc-ready${ready ? ' is-fresh' : ''}${game.pending.has(`plate:${order.n}`) ? ' is-pending' : ''}" data-kc="serve" data-n="${order.n}" ${ready ? `style="--kc-fx:${ready}"` : ''}>${pic(finishedWord(game,order),'is-dish',false)}<span class="kc-ready-label" lang="nb">Vær så god!</span></button>`
      : `<span class="kc-stub">${pic(finishedWord(game,order),'is-tiny')}<span class="kc-stub-text"><span class="kc-stub-dots" aria-label="${filled} / ${all.length}">${all.map((slot,i) => `<i class="${i < filled ? 'is-on' : ''}"></i>`).join('')}</span>${novice ? '<small>后厨在做</small>' : ''}</span>${courses}</span>`;
    return `<div class="kc-spot${done ? ' is-ready' : ''}" data-n="${order.n}">${personHTML(game,order,now,'is-waiting')}<div class="kc-spot-counter">${counter}</div></div>`;
  }
  // Customers on their way out: thanked and happy, or tired of waiting.
  function exitsIn(game,zone) {
    const now = Date.now();
    return game.exits.filter(exit => exit.zone === zone && exit.until > now).map(exit => {
      const float = game.floats.find(item => item.n === exit.n && item.until > now);
      return `<div class="kc-spot is-leaving is-${exit.mood}" style="--kc-fx:-${now-exit.at}ms" aria-hidden="true"><span class="kc-person is-gone" data-n="${exit.n}">${faceHTML(exit.customer,exit.mood,'is-figure')}${exit.text ? `<span class="kc-reply" lang="nb">${e(exit.text)}</span>` : ''}${float ? floatHTML(float) : ''}</span><div class="kc-spot-counter"></div></div>`;
    }).join('');
  }

  /* Kjøkkenet: the wall of storage, the stove, the orders over their trays, the pass */
  // Each cabinet is drawn as the piece of furniture it is (the illustrated pieces replace these drawn ones later).
  const FURNITURE = {kjoleskap:'fridge',ferskvare:'cooler',gront:'crate',servise:'rack'};
  const FURNITURE_COLS = {fridge:3,cooler:3,crate:5,shelf:6,rack:6};
  // The illustrated furniture: its picture and proportions (w:h), room left above it for tall things (in widths), and
  // where things stand on it, in percent of the picture: the floor of each row (from its top) and the stretch of
  // width they are spread over. Measured on the delivered pictures (kitchen/*.webp).
  const PAINTED = {
    fridge:{img:'kitchen/kjoleskap',ar:2/3,extra:0,cols:2,rows:[30.5,56.5,79],left:42,right:91,size:.76},
    shelf:{img:'kitchen/vegghylle',ar:3,extra:.08,cols:4,rows:[29],left:8,right:92,size:.8},
    rack:{img:'kitchen/servisehylle',ar:4/3,extra:0,cols:4,rows:[35],left:9,right:91,size:.84},
    crate:{img:'kitchen/kasse',ar:4/3,extra:0,cols:4,rows:[60],left:13,right:87,size:.92},
    cooler:{img:'kitchen/kjoledisk',ar:4/3,extra:0,cols:4,rows:[47],left:10,right:90,size:.95},
  };
  const OUTDOOR = new Set(['grillfest','hyttetur','17-mai','torget']);
  const artURL = id => ui.manifest.images?.[id] ? imageURL(id,false) : '';
  const painted = () => Boolean(artURL('kitchen/kjoleskap'));
  function kitchenMarkup(game,now) {
    const state = game.state, data = game.sceneData, tier = state.tier, novice = tier === 'novice';
    const {cooking,ready} = groups(game);
    const cabinets = data.cabinets || [];
    // On a phone one cabinet is open at a time: at first the fullest of mine (usually the fridge).
    if (!cabinets.some(cabinet => cabinet.id === game.cabOpen)) game.cabOpen = ([...cabinets].filter(cabinet => state.owner[cabinet.id] === game.me).sort((a,b) => b.items.length-a.items.length)[0] || cabinets[0])?.id || '';
    // A kitchen with many cabinets draws its painted furniture smaller, so a computer's wall holds it all.
    const pieces = cabinets.reduce((sum,cabinet) => { const look = PAINTED[FURNITURE[cabinet.id] || 'shelf']; return sum+(look ? Math.ceil(cabinet.items.length/(look.cols*look.rows.length)) : 1); },0);
    const scale = Math.min(1,5.2/Math.max(5.2,cabinets.length+(pieces-cabinets.length)*.5)).toFixed(3);
    const wall = `<section class="kc-wall" aria-label="柜子" data-scroll="wall" style="--kc-scale:${scale}">${cabinets.map(cabinet => furniture(game,cabinet,now)).join('')}</section>`;
    const cabs = `<nav class="kc-cabs" aria-label="打开哪个柜子" data-scroll="cabs">${cabinets.map(cabinet => {
      const theirs = game.room && state.owner[cabinet.id] !== game.me;
      return `<button type="button" class="kc-cab${game.cabOpen === cabinet.id ? ' is-on' : ''}${theirs ? ' is-theirs' : ''}" data-kc="cab" data-value="${e(cabinet.id)}" aria-pressed="${game.cabOpen === cabinet.id}">${pic(cabinet.items[0],'is-tiny')}<b lang="nb">${e(cabinet.no)}</b>${novice ? `<small>${e(cabinet.zh)}</small>` : ''}</button>`;
    }).join('')}</nav>`;
    const hob = painted() && artURL('kitchen/komfyr') ? state.stations.map((station,x) => ['koke','steke'].includes(station.kind) ? x : -1).filter(x => x >= 0).slice(0,2) : [];
    const rings = hob.length ? `<div class="kc-hob">${hob.map((x,ring) => toolHTML(game,state.stations[x],x,now,`is-on-ring is-ring-${hob.length === 1 ? 'mid' : ring ? 'right' : 'left'}`)).join('')}</div>` : '';
    const stove = game.scene.stations.length ? `<section class="kc-stove" aria-label="灶台"><span class="kc-hood" aria-hidden="true"></span><div class="kc-tools">${rings}${state.stations.map((station,x) => hob.includes(x) ? '' : toolHTML(game,station,x,now)).join('')}</div></section>` : '';
    const free = state.plates.filter(plate => plate < 0).length;
    const spare = Array.from({length:free},() => '<div class="kc-col is-spare" aria-hidden="true"><div class="kc-tray is-spare"><small>空托盘</small></div></div>').join('');
    const rail = `<section class="kc-rail" aria-label="订单" data-scroll="rail">${cooking.length ? cooking.map(order => orderColumn(game,order,now)).join('')+spare : `<p class="kc-quiet-note">${ready.length ? '做好的都送到前台了，去前台上菜' : '去前台接单，订单会出现在这里'}</p>`}</section>`;
    const ring = ready.some(order => since(game,`done:${order.n}`,1600));
    const pass = `<section class="kc-pass${ring ? ' is-ringing' : ''}" aria-label="出餐口"><header class="kc-pass-head"><b lang="nb">${shopScene(game) ? 'til kassen' : 'til disken'}</b>${novice ? '<small>做齐了自动送去前台</small>' : ''}</header>
      <div class="kc-pass-row">${ready.map(order => `<button type="button" class="kc-pass-dish" data-kc="screen" data-value="front" aria-label="去前台上菜">${pic(finishedWord(game,order),'is-dish',false)}${faceHTML(order.customer,'neutral','is-mini')}</button>`).join('')}</div><span class="kc-bell" aria-hidden="true"><i></i></span></section>`;
    const art = painted() ? [['--kc-kitchen-art',OUTDOOR.has(data.id) || OUTDOOR.has(game.sceneId) ? 'scene/utekjokken' : 'scene/kjokken'],['--kc-tray-art','kitchen/brett'],
      ['--kc-hood-art','kitchen/avtrekk'],['--kc-hatch-art','kitchen/passluke'],['--kc-bell-art','kitchen/ringeklokke'],['--kc-hob-art','kitchen/komfyr']]
      .filter(([,id]) => artURL(id)).map(([name,id]) => `${name}:url('${e(artURL(id))}')`).join(';') : '';
    const scene = data.bg && artURL(data.bg) ? `;--kc-art:url('${e(artURL(data.bg))}')` : '';
    return `<div class="kc-kitchen${stove ? '' : ' is-nostove'}${art ? ' is-painted' : ''}" style="${art}${scene}">${rail}${stove}${pass}${wall}${cabs}</div>`;
  }
  function furniture(game,cabinet,now) {
    const state = game.state, type = FURNITURE[cabinet.id] || 'shelf', owner = state.owner[cabinet.id];
    const theirs = game.room && owner !== game.me, novice = state.tier === 'novice';
    const whose = theirs ? `<span class="kc-whose"><span class="kc-avatar">${e(initial(nameOf(owner)))}</span>${e(nameOf(owner))}</span>` : '';
    const cols = Math.min(cabinet.items.length,FURNITURE_COLS[type]);
    const name = `<p class="kc-furn-name"><span lang="nb">${e(cabinet.no)}</span>${novice ? `<small>${e(cabinet.zh)}</small>` : ''}${whose}</p>`;
    const look = PAINTED[type];
    if (painted() && look && artURL(look.img)) {
      const room = look.cols*look.rows.length, count = Math.ceil(cabinet.items.length/room);
      const per = Math.ceil(cabinet.items.length/count), height = 1/look.ar+look.extra;
      const sets = Array.from({length:count},(_,set) => cabinet.items.slice(set*per,(set+1)*per)).map(items => {
        const span = (look.right-look.left)/look.cols, rows = Math.ceil(items.length/look.cols);
        const spots = items.map((item,index) => {
          const row = Math.floor(index/look.cols), inRow = Math.min(look.cols,items.length-row*look.cols), col = index%look.cols;
          const x = look.left+span*((look.cols-inRow)/2+col+.5), floor = look.rows[Math.min(row,look.rows.length-1)]/100;
          const bottom = (1-floor)/look.ar/height*100;
          return itemHTML(game,item,`left:${x.toFixed(2)}%;bottom:${bottom.toFixed(2)}%;width:${(span*look.size).toFixed(2)}%`);
        }).join('');
        return `<div class="kc-furn-set" style="aspect-ratio:${(1/height).toFixed(4)};background-image:url('${e(artURL(look.img))}');--kc-rows:${rows}">${spots}</div>`;
      }).join('');
      return `<div class="kc-furn is-${type} is-painted${game.cabOpen === cabinet.id ? ' is-open' : ''}${theirs ? ' is-theirs' : ''}" data-cab="${e(cabinet.id)}" style="--kc-sets:${count}">${name}<div class="kc-furn-sets">${sets}</div></div>`;
    }
    return `<div class="kc-furn is-${type}${game.cabOpen === cabinet.id ? ' is-open' : ''}${theirs ? ' is-theirs' : ''}" data-cab="${e(cabinet.id)}" style="--kc-cols:${cols}">
      ${name}<div class="kc-furn-body">${cabinet.items.map(item => itemHTML(game,item)).join('')}</div></div>`;
  }
  // A real thing to take: its picture, and on 新手 a price tag with its Norwegian name and Chinese.
  function itemHTML(game,item,place = '') {
    const novice = game.state.tier === 'novice', until = game.calls.get(item) || 0, now = Date.now();
    const called = until > now, wrong = since(game,`bad:item:${item}`), held = game.hand?.item === item;
    const style = [place,called ? `--kc-fx:-${now-(until-7000)}ms` : wrong ? `--kc-fx:${wrong}` : ''].filter(Boolean).join(';');
    return `<button type="button" class="kc-item${held ? ' is-held' : ''}${wrong ? ' is-wrong' : ''}${called ? ' is-called' : ''}" data-kc="item" data-word="${e(item)}" aria-label="${e(zh1(item))}" aria-pressed="${held}" ${style ? `style="${style}"` : ''}>${pic(item,'is-item')}${novice ? `<span class="kc-tag">${wordHTML(item)}<small>${e(zh1(item))}</small></span>` : ''}</button>`;
  }
  const toolPicture = kind => ui.manifest.images?.[`tool/${kind}`] ? `<img class="kc-tool-pic" src="${e(imageURL(`tool/${kind}`,true))}" alt="" decoding="async" draggable="false">` : `<span class="kc-tool-pic is-blank">${icon(kind)}</span>`;
  // A pot, a pan, the oven, the board or the grill. While something is in hand, the free ones light up to be chosen.
  const HOT = new Set(['koke','steke','bake','grille']);
  function toolHTML(game,station,x,now,where = '') {
    const status = stationState(station,now), verb = game.scene.verbs[station.kind], novice = game.state.tier === 'novice';
    const fx = since(game,`station:${x}`), wrong = since(game,`bad:kind:${station.kind}`);
    const vars = [station.item ? `--kc-cook:${COOK_MS[station.kind]}ms;--kc-cook-at:-${Math.max(0,now-station.startedAt)}ms;--kc-burn:${BURN_MS[station.kind] || 1}ms;--kc-burn-at:-${Math.max(0,now-station.doneAt)}ms` : '',
      fx ? `--kc-in:${fx}` : '',wrong ? `--kc-fx:${wrong}` : ''].filter(Boolean).join(';');
    const choice = Boolean(game.hand) && status === 'empty';
    const flag = status === 'burnt' ? '<b class="kc-flag is-burnt" lang="nb">brent!</b>' : status === 'ready' ? `<b class="kc-flag is-ready">${icon('check')}</b>` : '';
    const steam = station.item && HOT.has(station.kind) ? '<span class="kc-steam" aria-hidden="true"><i></i><i></i><i></i></span>' : '';
    const owner = station.item && station.order >= 0 ? game.state.orders[station.order] : null;
    const label = status === 'burnt' ? '糊了，点一下倒掉' : status === 'ready' ? '好了，点一下放回托盘' : status === 'cooking' ? '正在做' : KIND_NAMES[station.kind];
    return `<button type="button" class="kc-tool ${where} is-${station.kind} is-${status}${choice ? ' is-choice' : ''}${game.pending.has(`station:${x}`) ? ' is-pending' : ''}${undoing(game,`station:${x}`) ? ' is-undo' : ''}${fx ? ' is-new' : ''}${wrong ? ' is-wrong' : ''}" data-kc="station" data-x="${x}" aria-label="${e(label)}" ${vars ? `style="${vars}"` : ''}>
      ${steam}${toolPicture(station.kind)}${station.item ? `<span class="kc-tool-food">${pic(station.item,'is-tiny')}</span>` : ''}${owner ? `<span class="kc-tool-whose">${faceHTML(owner.customer,'neutral','is-mini')}</span>` : ''}${flag}<i class="kc-meter"><i></i></i>${novice && verb ? `<span class="kc-tool-label">${wordHTML(verb)}<small>${e(KIND_NAMES[station.kind] || '')}</small></span>` : ''}</button>`;
  }
  // What is in my hand, waiting for its pot, pan or oven.
  function handMarkup(game) {
    if (!game.hand || game.screen !== 'kitchen') return '';
    const tier = game.state.tier, item = game.hand.item;
    return `<div class="kc-hand" role="status"><span class="kc-hand-pic">${pic(item,'is-tiny')}</span><span class="kc-hand-text"><span>拿着 ${wordHTML(item)}${tier === 'novice' ? `<small>${e(zh1(item))}</small>` : ''}</span><small>点灶台上要用的那一样</small></span><button type="button" class="kc-hand-x" data-kc="drop" aria-label="放回去">${icon('close')}</button></div>`;
  }
  // An order: its slip written in Norwegian (新手 adds the picture and Chinese; 高手 has a speaker for each line) and,
  // under it, its tray with what is on it so far.
  function orderColumn(game,order,now) {
    const slots = [...order.slots.map((slot,i) => ({...slot,index:i})),...order.tools.map((tool,i) => ({...tool,k:'',index:order.slots.length+i}))];
    const taken = since(game,`plate:${order.n}`), wrong = since(game,`bad:plate:${order.n}`);
    const courses = order.next.length || order.course ? `<span class="kc-courses">${Array.from({length:order.course+1+order.next.length},(_,i) => `<i class="${i < order.course ? 'is-done' : i === order.course ? 'is-now' : ''}"></i>`).join('')}</span>` : '';
    const elapsed = Math.max(0,now-order.arrivedAt);
    const lying = slots.filter(slot => slot.s === 'done' && slot.index < order.slots.length);
    const tray = `<div class="kc-tray${undoing(game,`plate#${order.plate}`) ? ' is-undo' : ''}" data-kc="focus" data-n="${order.n}" data-plate="${order.plate}">${lying.map((slot,i) => {
      const fresh = since(game,`slot:${order.n}:${slot.index}`);
      return `<span class="kc-tray-item${fresh ? ' is-fresh' : ''}" style="${discSpot(i,lying.length)}${fresh ? `;--kc-fx:${fresh}` : ''}">${pic(slot.i,'is-on-plate')}</span>`;
    }).join('')}</div>`;
    return `<div class="kc-col${game.focus === order.n ? ' is-focus' : ''}${taken ? ' is-new' : ''}${wrong ? ' is-wrong' : ''}${game.pending.has(`plate:${order.n}`) ? ' is-pending' : ''}" data-n="${order.n}" ${taken || wrong ? `style="${taken ? `--kc-in:${taken}` : ''}${wrong ? `;--kc-fx:${wrong}` : ''}"` : ''}>
      <div class="kc-ticket" data-kc="focus" data-n="${order.n}"><span class="kc-ticket-clip" aria-hidden="true"></span><div class="kc-ticket-head">${faceHTML(order.customer,mood(order,now),'is-mini')}<i class="kc-patience" aria-hidden="true" style="--kc-patience:${order.patience}ms;--kc-elapsed:-${elapsed}ms"><i></i></i>${courses}</div>
        <div class="kc-lines">${slots.map(slot => ticketLine(game,order,slot)).join('')}</div></div>${tray}</div>`;
  }
  // A baking order asks for a measure ("2 dl sukker"): the unit is what is fetched.
  const measureOf = (game,order,slot) => { const measure = game.scene.dishes[order.dish]?.measure; return measure && slot.index >= order.slots.length && slot.i === measure.unit ? measure : null; };
  const undoing = (game,key) => Boolean(game.undo && game.undo.until > Date.now() && game.undo.keys.has(key));
  function ticketLine(game,order,slot) {
    const tier = game.state.tier, item = slot.i, state = slot.s, key = `slot:${order.n}:${slot.index}`;
    const away = game.room && state === 'open' && game.state.owner[game.scene.cabinetOf[item]] !== game.me;
    const measure = measureOf(game,order,slot);
    const word = measure ? `<span class="kc-no" lang="nb">${e(String(measure.amount))} ${e(plainWord(item))}<i class="kc-art"> ${e(plainWord(measure.item))}</i></span>` : wordHTML(item);
    const zh = measure ? `${measure.amount} ${zh1(item)}${zh1(measure.item)}` : zh1(item);
    const verb = slot.k ? `<span class="kc-line-verb">${tier === 'expert' && state === 'open' ? icon('speaker') : `<span lang="nb">${e(plainWord(game.scene.verbs[slot.k]).replace(/^å\s+/,''))}</span>`}${tier === 'novice' ? `<small>${e(KIND_NAMES[slot.k] || '')}</small>` : ''}</span>` : '';
    let body;
    if (state !== 'open') body = `${pic(item,'is-line')}<span class="kc-line-word">${word}</span>${state === 'cooking' ? `<span class="kc-line-state">${icon(slot.k || 'koke')}</span>` : `<i class="kc-tick">${icon('check')}</i>`}`;
    else if (tier === 'expert') body = `<span class="kc-line-ear">${icon('speaker')}</span><span class="kc-line-word is-hidden">听一听</span>${verb}`;
    else body = `${tier === 'novice' || !hasPicture(item) ? pic(item,'is-line') : ''}<span class="kc-line-word">${word}${tier === 'novice' || !hasPicture(item) ? `<small>${e(zh)}</small>` : ''}</span>${verb}`;
    const fresh = since(game,key), wrong = since(game,`bad:line:${order.n}:${slot.index}`);
    const label = state === 'done' ? '已放好' : state === 'cooking' ? '正在做' : away ? '在同学的柜子里，点一下向同学要' : tier === 'novice' ? zh : '听这一样';
    return `<button type="button" class="kc-line is-${state}${away ? ' is-away' : ''}${game.pending.has(key) ? ' is-pending' : ''}${undoing(game,key) ? ' is-undo' : ''}${fresh ? ' is-fresh' : ''}${wrong ? ' is-wrong' : ''}" data-kc="line" data-n="${order.n}" data-x="${slot.index}" aria-label="${e(label)}" ${fresh || wrong ? `style="--kc-fx:${fresh || wrong}"` : ''}>${body}${away ? `<span class="kc-line-away">${icon('people')}</span>` : ''}</button>`;
  }
  // Where the things already on a tray lie (one in the middle, more in a ring).
  const discSpot = (index,count) => {
    if (count === 1) return 'left:50%;top:50%';
    const angle = index/count*2*Math.PI-Math.PI/2, radius = count > 4 ? 29 : 24;
    return `left:${(50+radius*Math.cos(angle)).toFixed(1)}%;top:${(50+radius*Math.sin(angle)).toFixed(1)}%`;
  };
  function pickerMarkup(game) {
    const picking = ui.picking;
    if (!picking || picking.game !== game) return '';
    const age = `--kc-fx:-${Math.min(1000,Date.now()-(picking.at || 0))}ms`;
    return `<div class="kc-sheet-layer" style="${age}"><div class="kc-sheet" style="${age}" role="dialog" aria-modal="true" aria-labelledby="kc-sheet-title"><p id="kc-sheet-title">${e(picking.title || '向同学要哪一样？')}</p>
      <div class="kc-picks${picking.options.length > 4 ? ' is-many' : ''}">${picking.options.map(word => `<button type="button" class="kc-pick" data-kc="pick" data-word="${e(word)}">${wordHTML(word)}</button>`).join('')}</div>${button('pick-cancel','取消','kc-quiet')}</div></div>`;
  }
  function closePicker() { ui.picking = null; drawGame(); }
  function setScreen(game,screen) {
    if (!['front','kitchen'].includes(screen) || game.screen === screen) return;
    game.screen = screen;
    game.hand = null;
    game.fresh.set('screen',Date.now());
    drawGame();
  }

  /* Taps on the game screen */
  function onGameClick(target,kc) {
    const game = ui.game;
    if (!game || ui.view !== 'game') return false;
    const n = Number(target.dataset.n), x = Number(target.dataset.x), word = target.dataset.word;
    const state = game.state, now = gameNow(game);
    switch (kc) {
      case 'sound': ui.prefs.sound = !ui.prefs.sound; savePrefs(); if (!ui.prefs.sound) { stopKitchenVoice(); releaseSfx(); } drawGame(); return true;
      case 'chat-open': game.chatOpen = !game.chatOpen; game.fresh.set('chat',Date.now()); drawGame(); return true;
      case 'chat': game.chatOpen = false; act({t:'chat',w:target.dataset.value}); return true;
      case 'screen': setScreen(game,target.dataset.value); return true;
      case 'cab': game.cabOpen = target.dataset.value || ''; game.fresh.set('cab',Date.now()); drawGame(); return true;
      case 'pick-cancel': closePicker(); return true;
      case 'pick': {
        const picking = ui.picking;
        ui.picking = null;
        if (!picking) return true;
        const order = state.orders[picking.n], slot = order?.slots[picking.slot] || order?.tools[picking.slot-(order?.slots.length || 0)];
        act({t:slot && slot.i === word ? 'call' : 'miss',c:picking.n,n:picking.slot,i:word});
        return true;
      }
      case 'guest': {
        const order = state.orders[n];
        if (!order) return true;
        // Tapping a customer says the order once more; one waiting in line comes up to the till.
        if (order.status === 'wait' || order.naming) game.guest = n;
        sayOrder(game,order);
        drawGame();
        return true;
      }
      case 'dish': {
        if (game.watch) return true;
        const {asker,making} = groups(game);
        if (!asker) { notify(making.length ? '现在没有人在等点单' : '还没有客人在等',1800); return true; }
        act({t:'take',c:asker.n,d:word},target.getBoundingClientRect());
        return true;
      }
      case 'item': pickItem(game,word,target.getBoundingClientRect()); return true;
      case 'drop': game.hand = null; drawGame(); return true;
      case 'focus': if (Number.isInteger(n) && state.orders[n]) { game.focus = n; drawGame(); } return true;
      case 'line': lineTap(game,n,x); return true;
      case 'station': toolTap(game,x,target.getBoundingClientRect(),now); return true;
      case 'serve': if (!game.watch) act({t:'serve',c:n},(target.closest('.kc-ready') || target).getBoundingClientRect()); return true;
      default: return false;
    }
  }
  // A thing taken from a cabinet goes by itself to the order that needs it (the order last worked on first). One that
  // must be cooked stays in hand until its pot, pan or oven is chosen. One that no order needs is a wrong answer,
  // and the rules record it on the order being worked on.
  function pickItem(game,item,from) {
    if (game.watch || !item) return;
    const state = game.state, scene = game.scene, holder = state.owner[scene.cabinetOf[item]];
    if (game.room && holder !== game.me) { notify(`这样在${nameOf(holder)}的柜子里：在订单上点这一样，用挪威语喊人要`,2600); return; }
    if (game.hand?.item === item) { game.hand = null; drawGame(); return; }
    const making = state.orders.filter(order => order.status === 'taken' && !order.naming && !complete(order))
      .sort((a,b) => (b.n === game.focus)-(a.n === game.focus) || a.takenAt-b.takenAt || a.n-b.n);
    if (!making.length) { notify(state.orders.some(order => order.status === 'taken') ? '这几单都配齐了，去前台上菜' : '还没有订单：先去前台接单',2000); return; }
    for (const order of making) {
      const raw = order.slots.some(slot => slot.i === item && !slot.k && slot.s === 'open') || order.tools.some(tool => tool.i === item && tool.s === 'open');
      if (raw) { game.hand = null; game.focus = order.n; act({t:'place',c:order.n,i:item},from); return; }
      if (order.slots.some(slot => slot.i === item && slot.k && slot.s === 'open')) {
        game.hand = {item,order:order.n,from};
        game.focus = order.n;
        game.fresh.set('hand',Date.now());
        play('take');
        drawGame();
        return;
      }
    }
    if (making.some(order => [...order.slots,...order.tools].some(slot => slot.i === item))) { notify(WHY.full(),1600); return; }
    game.hand = null;
    act({t:'place',c:making[0].n,i:item},from);
  }
  // A pot, pan or oven: with something in hand it starts cooking (the verb is what is asked); a finished one goes back
  // to its tray (or, wanted by nobody now, is thrown out); a burnt one is thrown out.
  function toolTap(game,x,from,now) {
    if (game.watch) return;
    const state = game.state, station = state.stations[x];
    if (!station) return;
    const status = stationState(station,now);
    if (status === 'ready') {
      const owner = station.order >= 0 ? state.orders[station.order] : null;
      const home = owner && owner.status === 'taken' && owner.slots[station.slot]?.s === 'cooking';
      if (!home && !openSlot(state,station.item,station.kind)) { act({t:'trash',x},from); notify(WHY.nowhere(),1800); return; }
      act({t:'transfer',x},from);
      return;
    }
    if (status === 'burnt') { act({t:'trash',x},from); return; }
    if (status === 'cooking') { notify(game.hand ? WHY.busy() : WHY.cooking(),1200); return; }
    if (!game.hand) { notify('先从柜子里拿要做的那样东西',1800); return; }
    const held = game.hand, origin = $('.kc-hand-pic')?.getBoundingClientRect() || held.from;
    game.hand = null;
    const result = act({t:'cook',i:held.item,k:station.kind,c:held.order},origin);
    // A wrong pot keeps the thing in hand, to try again.
    if (result && !result.ok && ['wrongverb','busy'].includes(result.why)) { game.hand = held; drawGame(); }
  }
  // A line of an order: a classmate's thing is asked for in Norwegian; anything else is heard (on 高手 with its verb).
  function lineTap(game,n,x) {
    const state = game.state, order = state.orders[n];
    if (!order) return;
    game.focus = n;
    const slot = order.slots[x] || order.tools[x-order.slots.length];
    if (!slot) { drawGame(); return; }
    if (slot.s === 'open' && !game.watch && game.room && state.owner[game.scene.cabinetOf[slot.i]] !== game.me && !order.naming) {
      const shelf = Object.keys(game.scene.cabinetOf).filter(item => state.owner[game.scene.cabinetOf[item]] === game.me);
      ui.picking = {at:Date.now(),game,n,slot:x,mode:'call',title:'向同学要哪一样？',options:distractors(game.scene,slot.i,shelf,state.seed ^ (n*131+x),ui.categoryOf || {})};
      drawGame();
      $('.kc-sheet [data-kc="pick"]')?.focus();
      return;
    }
    const item = entry(slot.i), verb = slot.k && slot.s === 'open' ? entry(game.scene.verbs[slot.k]) : null;
    if (item) say(item.word,item.clip,verb ? () => say(verb.word,verb.clip) : undefined);
    drawGame();
  }

  /* ---------- Alone: the result goes to the server as a replayable log ---------- */
  function finishSolo(game) {
    if (game.finished) return;
    game.finished = true;
    stopGame();
    const state = game.state, me = state.players[0], scene = game.sceneData, daily = game.sceneId === 'daily';
    const record = {sessionId:sessionId(),...game.header,rules:ui.data?.rulesHash || '',playedAt:game.playedAt || Date.now(),durationMs:state.duration,log:packLog(game.scene,game.log)};
    if (!daily) delete record.day;
    if (game.owner) record.owner = game.owner;
    rememberResult(record,game.ownerDevice);
    ui.resultsFor = {sessionId:record.sessionId,sceneId:game.sceneId,room:false,tier:state.tier,score:state.score,target:targetFor(scene,state.minutes,state.tier),served:state.served,gone:state.gone,
      minutes:state.minutes,players:[{id:'me',name:ui.nickname || '我',correct:me.correct,wrong:me.wrong,served:me.served,dishes:me.dishes,me:true}],
      learn:me.learn,starsBefore:daily ? null : sceneStars(scene),openBefore:daily || tierOpen(sceneStars(scene),state.tier),starsAfter:null,xp:null,upload:'sending'};
    ui.game = null;
    show('results');
    void flushPending();
  }
  // One key per match: acknowledging a result never overwrites another tab's new game.
  const RESULT_PREFIX = 'norsk-kitchen-result-v2:';
  const localResults = new Map(); // also carries a result to the server when browser storage is full
  let uploadFlight = null, uploadAgain = false;
  function rememberResult(record,deviceId = '') {
    const item = {deviceId,record};
    localResults.set(record.sessionId,item);
    writeJSON(RESULT_PREFIX+record.sessionId,item);
  }
  function forgetResult(id) {
    localResults.delete(id);
    try { localStorage.removeItem(RESULT_PREFIX+id); } catch { /* Retrying the same ID is safe. */ }
  }
  function pendingResults() {
    // Keep the old array until all entries have a durable per-game copy.
    const legacy = readJSON(PENDING_KEY,[]);
    if (Array.isArray(legacy) && legacy.length) {
      let copied = true;
      for (const record of legacy) if (record?.sessionId) {
        const item = {deviceId:'',record};
        localResults.set(record.sessionId,item);
        if (!writeJSON(RESULT_PREFIX+record.sessionId,item)) copied = false;
      }
      if (copied) try { localStorage.removeItem(PENDING_KEY); } catch {}
    }
    const items = new Map(localResults);
    try {
      for (let i=0; i<localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(RESULT_PREFIX)) continue;
        const item = readJSON(key,null);
        if (item?.record?.sessionId && key === RESULT_PREFIX+item.record.sessionId) items.set(item.record.sessionId,item);
      }
    } catch { /* Games completed in this tab can still be sent from memory. */ }
    return [...items.values()].sort((a,b) => a.record.playedAt-b.record.playedAt);
  }
  function resultStatus(id,status) {
    if (ui.resultsFor?.sessionId === id) ui.resultsFor.upload = status;
  }
  async function drainResults() {
    const items = pendingResults();
    if (!items.length) return;
    const api = await community(), deviceId = api.localPlayer?.()?.deviceId;
    for (const {record,deviceId:ownerDevice} of items) {
      const id = record.sessionId;
      if (Date.now()-record.playedAt > 3*86400000) { forgetResult(id); resultStatus(id,'expired'); continue; }
      if (ownerDevice && deviceId && ownerDevice !== deviceId) { resultStatus(id,'identity'); continue; }
      const send = () => api.request('/kitchen/result',{method:'POST',body:record,timeout:12000});
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
        if (code === 'identity_changed' || code === 'scene_locked') { resultStatus(id,'identity'); continue; }
        if (code === 'update_required') { resultStatus(id,'version'); continue; }
        if (code === 'invalid_request' || code === 'too_old') {
          forgetResult(id); resultStatus(id,code === 'too_old' ? 'expired' : 'invalid'); continue;
        }
        break; // network failure or service-wide limit; retry on reconnect
      }
      forgetResult(id);
      if (ui.resultsFor?.sessionId === id) Object.assign(ui.resultsFor,{
        xp:Number.isFinite(reply.xp) ? reply.xp : null, starsAfter:Number.isInteger(reply.stars) ? reply.stars : null,upload:'done',
        unlocked:(reply.unlocked || []).filter(scene => !unlocked(scene))});
    }
  }
  function flushPending() {
    if (uploadFlight) { uploadAgain = true; return uploadFlight; }
    uploadFlight = (async () => {
      do {
        uploadAgain = false;
        try { await drainResults(); } catch { /* Offline: keep all unconfirmed games. */ }
      } while (uploadAgain);
    })().finally(() => {
      uploadFlight = null;
      const r = ui.resultsFor;
      if (r && !r.room && ['sending','offline','unsaved'].includes(r.upload)) {
        r.upload = readJSON(RESULT_PREFIX+r.sessionId,null) ? 'offline' : 'unsaved';
      }
      void loadProgress();
      if (ui.open && ui.view === 'results') render();
    });
    return uploadFlight;
  }
  function summary(learn) {
    const rows = new Map();
    for (const [word,ok] of learn || []) {
      const row = rows.get(word) || {word,right:0,wrong:0};
      if (ok) row.right++; else row.wrong++;
      rows.set(word,row);
    }
    // Words missed come first, then the rest in the order they came up.
    return [...rows.values()].sort((a,b) => (b.wrong > 0)-(a.wrong > 0));
  }
  function resultsPage() {
    const r = ui.resultsFor;
    if (!r) return `${topBar('本局结束')}<p class="kc-empty">没有这一局的记录。</p>`;
    const scene = sceneById(r.sceneId) || (r.sceneId === 'daily' ? null : null);
    const reached = r.score >= r.target;
    const mine = r.players.find(player => player.me) || r.players[0] || {correct:0,wrong:0,served:0};
    const level = `${TIERS[r.tier]?.name || ''}关`;
    const verdict = r.sceneId === 'daily' ? `目标 ${r.target} 分`
      : !reached ? `${level}目标 ${r.target} 分`
      : r.openBefore === false ? `${level}还没开放，这局不算过关`
      : passes(r.score,r.target,mine.correct,mine.wrong,r.room) ? `${level}过了（目标 ${r.target} 分）`
      : `全队到了${level}目标，自己答对 80% 才算过`;
    const rows = summary(r.learn);
    const upload = r.room ? (r.xpPending ? '经验结算中…' : '') : ({
      sending:'正在上传成绩…', offline:'成绩已存在这台设备上，联网后自动补传。',
      unsaved:'设备未能保存成绩。请保持此页打开，恢复联网后会再次上传。',
      identity:'这局需要原来的学习身份及场景资格；符合条件时会补传。',
      version:'成绩还在，游戏规则版本不匹配，请刷新后重试。',
      expired:'这局已超过三天补传期限，未计入成绩。',invalid:'服务器未接受这局记录，未计入成绩。'
    }[r.upload] || '');
    // A star won in this game lights up on its own, a moment after the page opens.
    const after = r.starsAfter ?? r.starsBefore, gained = r.starsAfter != null && r.starsAfter > r.starsBefore;
    const starLine = r.starsBefore == null ? '' : `<div class="kc-result-stars"><span class="kc-stars is-large" aria-label="${after} 星">${[0,1,2].map(index => `<i class="${index < after ? 'is-on' : ''}${gained && index >= r.starsBefore && index < after ? ' is-new' : ''}">${icon('star')}</i>`).join('')}</span>${gained ? `<span class="kc-hint kc-new-star">新的${after-r.starsBefore > 1 ? ` ${after-r.starsBefore} ` : '一'}颗星</span>` : ''}</div>`;
    const unlocks = (r.unlocked || []).map(id => sceneById(id)).filter(Boolean);
    const people = r.players.length > 1 ? `<section class="kc-panel"><div class="kc-section-head"><h3>厨师们</h3></div><ul class="kc-crew-list">${r.players.map(player => `<li class="${player.me ? 'is-me' : ''}"><span class="kc-avatar">${e(initial(player.name))}</span><span class="kc-crew-name">${e(player.name)}</span><span class="kc-hint">答对 ${player.correct} · 答错 ${player.wrong} · 上菜 ${player.served}${Number.isFinite(player.xp) ? ` · +${player.xp} XP` : ''}</span></li>`).join('')}</ul></section>` : '';
    return `${topBar('本局结束',r.room ? 'room' : r.sceneId === 'daily' ? 'daily' : 'scene')}
      <section class="kc-result-hero${reached ? ' is-reached' : ''}" ${scene ? sceneArt(scene) : ''}><span class="kc-kicker" lang="nb">${e(scene?.no || 'Dagens meny')}</span>
        <p class="kc-result-score"><b>${r.shownScore ?? r.score}</b><small>分</small></p><p class="kc-hint">${verdict} · 上菜 ${r.served} 道${r.gone ? ` · 走掉 ${r.gone} 位客人` : ''}</p>
        ${starLine}${unlocks.length ? `<p class="kc-unlock">新场景开放：<strong lang="nb">${e(unlocks[0].no)}</strong> ${e(unlocks[0].zh)}</p>` : ''}
        <dl class="kc-facts"><div><dt>答对</dt><dd>${mine.correct}</dd></div><div><dt>答错</dt><dd>${mine.wrong}</dd></div><div><dt>我上的菜</dt><dd>${mine.served}</dd></div>${Number.isFinite(r.xp) ? `<div><dt>经验</dt><dd>+${r.xp}</dd></div>` : ''}</dl>
        ${upload ? `<p class="kc-hint">${upload}</p>` : ''}</section>
      ${people}
      <section class="kc-panel"><div class="kc-section-head"><h3>这一局遇到的词</h3>${rows.length ? button('wordbook',`${icon('plus')}<span>全部加入词本</span>`,'kc-link') : ''}</div>
        ${rows.length ? `<ul class="kc-entries is-summary">${rows.map(row => `<li class="kc-entry${row.wrong ? ' is-missed' : ''}">${pic(row.word,'is-small')}<div class="kc-entry-text"><p>${wordHTML(row.word)}</p><p class="kc-entry-zh">${e(gameSense(row.word))}</p></div>
          <span class="kc-tally">${row.right ? `<b class="is-right">✓ ${row.right}</b>` : ''}${row.wrong ? `<b class="is-wrong">✗ ${row.wrong}</b>` : ''}</span><button type="button" class="kc-icon-button is-small" data-kc="hear" data-word="${e(row.word)}" aria-label="听 ${e(plainWord(row.word))}">${icon('speaker')}</button></li>`).join('')}</ul>` : '<p class="kc-empty">这一局还没有作答。</p>'}</section>
      <div class="kc-start-bar"><div class="kc-actions-row">${r.room ? button('to-room','回到房间','kc-primary') : `${button('again','再来一局','kc-primary')}${button('to-scene',r.sceneId === 'daily' ? '回到今日菜单' : '回到场景','kc-ghost')}`}</div></div>`;
  }
  // 局后小结 → 我的词本: every word of the game goes into the 开饭啦 folder, with its meaning.
  function addSummaryToWordbook() {
    const rows = summary(ui.resultsFor?.learn);
    const list = rows.map(row => entry(row.word)).filter(Boolean).map(item => ({word:item.word,meaning:item.zh || '',example:item.ex || '',exampleZh:item.exZh || '',pos:item.pos === 'phrase' ? '短语' : '',audio:item.clip}));
    if (!list.length) return;
    try {
      const added = ui.opts.addWords?.(list,'开饭啦',{quiet:true});
      notify(added ? `已把 ${added} 个词加入词本「开饭啦」` : '这些词都已经在词本里了');
    } catch (error) { notify(error?.message || '没有加进词本，请重试。'); }
  }

  /* ---------- Rooms ---------- */
  // The server keeps the kitchen and referees it (the rules above, in Python); polls are held until the room changes.
  const POLL_GAP_MS = 100, POLL_TIMEOUT_MS = 12000, POLL_HIDDEN_MS = 4000, ACT_STALE_MS = 8000;
  const serverNow = () => Date.now()+(ui.clock?.offset || 0);
  function syncClock(serverTime,sentAt,receivedAt) {
    if (!Number.isFinite(serverTime)) return;
    const clock = ui.clock, rtt = Math.max(0,receivedAt-sentAt), offset = serverTime-(sentAt+receivedAt)/2;
    // Samples with quick round trips are trusted most.
    ui.clock = !clock || rtt <= clock.rtt*1.25+30 || clock.age >= 20 ? {offset,rtt,age:0} : {...clock,rtt:clock.rtt*1.05,age:clock.age+1};
  }
  const roomError = error => ({room_not_found:'房间不存在或已过期，请核对房间号。',room_full:'这个房间已经满了（最多 4 人）。',not_in_room:'你已不在这个房间。',
    rate_limited:'操作有点频繁，请稍等片刻。',not_host:'只有房主可以这样做。',room_busy:'这一局正在进行，等它结束再改。',scene_locked:'当前房主尚未解锁这个场景，请换一个场景。',
    update_required:'开饭啦有新版本，请刷新页面后再进房间。',timeout:'网络有点慢，请再试一次。',too_many_rooms:'现在开着的房间太多了，请稍后再试。',
    unauthorized:'联机身份失效了，请刷新页面后再试。',not_found:'联机服务还没有准备好，请稍后再试。'}[error?.code] || '联机暂时连不上，请检查网络后重试。');
  async function call(path,body,options = {}) {
    const api = await community();
    const sentAt = Date.now();
    const data = await api.request(`/kitchen${path}`,body === undefined ? {timeout:options.timeout || 8000,...(options.poll ? {duelPoll:options.poll} : {})} : {method:'POST',body,timeout:10000});
    // The time a poll was held on the server is not network time.
    const held = Math.max(0,Number(data?.heldMs) || 0);
    syncClock(data?.serverTime,sentAt+held,Date.now());
    return data;
  }
  function setRoomInURL(code) {
    try {
      const url = new URL(location.href);
      if (code) url.searchParams.set('kitchen',code); else if (url.searchParams.has('kitchen')) url.searchParams.delete('kitchen'); else return;
      history.replaceState(history.state,'',url.href);
    } catch {}
  }
  async function createRoom(sceneId) {
    if (ui.busy || !ui.data) return;
    if (sceneId !== 'daily' && !unlocked(sceneId)) { notify('这个场景还没有开放'); return; }
    ui.busy = true;
    render();
    try {
      const state = await call('/rooms',{scene:sceneId,tier:playableTier(sceneById(sceneId)),minutes:ui.prefs.minutes,rules:ui.data.rulesHash || ''});
      if (ui.open) enterRoom(state);
    } catch (error) { notify(roomError(error)); }
    finally { ui.busy = false; if (ui.open && ui.view !== 'room') render(); }
  }
  async function joinRoom(code) {
    if (ui.busy) return;
    ui.busy = true;
    if (ui.joining) render();
    try {
      await loadData().catch(() => null);
      const state = await call(`/rooms/${code}/join`,{rules:ui.data?.rulesHash || ''});
      ui.joining = false;
      if (ui.open) enterRoom(state);
    } catch (error) { notify(roomError(error)); setRoomInURL(null); }
    finally { ui.busy = false; if (ui.open && ui.view !== 'room') render(); }
  }
  function enterRoom(state) {
    ui.room = null;
    ui.roomSession = {polling:false};
    ui.failures = 0;
    ui.roomEdit = false;
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
    notify(message);
    show('home');
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
      // Back after a dropped connection: the notice that stayed up is replaced.
      if (ui.failures >= 2) notify('又连上了',1400);
      ui.failures = 0;
      if (!data.unchanged) applyRoom(data);
      schedulePoll(document.hidden ? POLL_HIDDEN_MS : Number.isFinite(data.heldMs) ? POLL_GAP_MS : 900);
    } catch (error) {
      if (ui.roomSession !== session) return;
      if (['room_not_found','not_in_room'].includes(error?.code)) { lostRoom(roomError(error)); return; }
      ui.failures = (ui.failures || 0)+1;
      if (ui.failures === 2) notify('网络断了，正在重新连接…',0);
      schedulePoll(error?.code === 'rate_limited' ? 4000 : Math.min(8000,800*2**Math.min(ui.failures-1,3)));
    } finally { session.polling = false; }
  }
  // Everything the room says: the lobby, a game loading, the menu preview, the countdown, play, the results.
  function applyRoom(state) {
    if (!state || !state.code) return;
    const current = ui.room;
    if (current && (current.code !== state.code || state.version < current.version ||
        (state.version === current.version && state.serverTime < current.serverTime))) return;
    if (ui.failures >= 2) { ui.failures = 0; notify('又连上了',1400); }
    ui.room = state;
    const match = state.match, me = state.me;
    const taking = match && (match.participants || []).includes(me);
    if (match && ['loading','preview','countdown','playing'].includes(state.status)) {
      let game = ui.game?.room && ui.game.number === match.number ? ui.game : null;
      if (!game) {
        const found = rulesForMatch(match);
        if (!found) return;
        game = newGame({sceneId:match.scene,scene:found.scene,rules:found.rules,state:match.state,me,room:true,
          extra:{number:match.number,watch:!taking,startsAt:match.startsAt || 0,seq:match.ack?.[me] || 0}});
        game.base = match.state;
        stopGame();
        ui.game = game;
        prefetchGame(game);
      }
      game.startsAt = match.startsAt || game.startsAt;
      syncGame(game,match);
      if (state.status === 'loading' && taking && !game.loadedSent) {
        game.loadedSent = true;
        void preloadPictures(game).then(() => { if (ui.game === game) return roomAction('ready',{loaded:true},true); });
      }
      if (state.status === 'loading' || state.status === 'preview') {
        if (ui.view !== 'preview') show('preview'); else render();
        schedulePreviewTimer();
      } else if (state.status === 'countdown') {
        if (game.phase !== 'countdown') startCountdown(game,match.startsAt);
      } else if (state.status === 'playing' && game.phase !== 'play') {
        // Arriving late (a reload, or someone watching) joins the game where it is.
        if (ui.view !== 'game') ui.view = 'game';
        startPlay(game);
      } else if (ui.view === 'game') drawGame();
      return;
    }
    if (state.status === 'finished' && state.results && ui.game?.room && ui.game.number === state.results.number) { finishRoomGame(state.results); return; }
    // The XP of a room game is written a moment after it ends and reaches the results page then.
    if (state.results && ui.view === 'results' && ui.resultsFor?.room && ui.resultsFor.number === state.results.number) {
      const mine = (state.results.players || []).find(player => player.id === state.me);
      Object.assign(ui.resultsFor,{xp:mine?.xp ?? ui.resultsFor.xp,xpPending:state.results.xpPending,players:(state.results.players || []).map(player => ({...player,me:player.id === state.me}))});
      render();
      return;
    }
    if (ui.game?.room) { stopGame(); ui.game = null; if (['preview','game'].includes(ui.view)) { show('room'); return; } }
    if (ui.view === 'room') render();
  }
  function rulesForMatch(match) {
    if (!ui.data) return null;
    if (match.scene === 'daily') {
      const scene = dailyScene(ui.data,match.seed >>> 0);
      return {scene,rules:sceneRules(ui.data,scene)};
    }
    return rulesFor(match.scene);
  }
  function preloadPictures(game) {
    const names = new Set();
    for (const word of game.scene.words) { const img = entry(word)?.img; if (img && ui.manifest.images[img]) names.add(img); }
    for (const order of game.state.orders) for (const mood of ['neutral','happy','impatient']) { const img = `customer/${order.customer}-${mood}`; if (ui.manifest.images[img]) names.add(img); }
    const wait = [...names].slice(0,80).map(img => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = resolve; image.src = imageURL(img,!img.startsWith('customer/')); }));
    return Promise.race([Promise.all(wait),new Promise(resolve => setTimeout(resolve,8000))]);
  }
  function schedulePreviewTimer() {
    clearTimeout(ui.previewTimer);
    if (ui.view !== 'preview' || !ui.room?.match?.previewEndsAt) return;
    ui.previewTimer = setTimeout(() => {
      const node = $('#kc-preview-wait'), match = ui.room?.match;
      if (node && match) {
        const left = Math.max(0,Math.ceil((match.previewEndsAt-serverNow())/1000));
        node.textContent = `${(match.prepared || []).length} / ${(match.participants || []).length} 人准备好了${left ? ` · ${left} 秒后开始` : ''}`;
      }
      schedulePreviewTimer();
    },500);
  }
  // The server's state, then my own taps it has not confirmed yet, played on top (and shown a little faded).
  function syncGame(game,match) {
    if (!match.state) return;
    game.base = match.state;
    const ack = match.ack?.[game.me] || 0;
    game.outbox = game.outbox.filter(item => item.s > ack);
    for (const event of match.events || []) {
      if (event.seq <= game.seen) continue;
      game.seen = event.seq;
      if (event.by !== game.me) react([event],game);
    }
    rebuild(game);
  }
  function rebuild(game) {
    const state = JSON.parse(JSON.stringify(game.base));
    game.pending = new Set();
    for (const item of game.outbox) {
      const result = apply(state,game.scene,{...item.action,by:game.me},item.at);
      for (const event of result.events) {
        if (event.e === 'take' || event.e === 'serve') game.pending.add(`plate:${event.n}`);
        if (event.e === 'place' || event.e === 'transfer') game.pending.add(`slot:${event.n}:${event.slot}`);
        if (event.e === 'cook' || event.e === 'transfer' || event.e === 'trash') game.pending.add(`station:${event.x}`);
      }
    }
    const events = advance(state,game.scene,gameNow(game)).filter(event => remember(game,event));
    game.state = state;
    if (events.length) react(events,game);
  }
  // What a tap changed on screen, so a tap the server turns down can be seen going back.
  function touchedKeys(events) {
    const keys = [];
    for (const event of events) {
      if (event.e === 'take') keys.push(`plate#${event.plate}`);
      if (event.e === 'place' || event.e === 'transfer') keys.push(`slot:${event.n}:${event.slot}`);
      if (event.e === 'cook' || event.e === 'transfer' || event.e === 'trash') keys.push(`station:${event.x}`);
    }
    return keys;
  }
  function queueAction(game,action,at,result) {
    game.outbox.push({s:++game.seq,action,at,sentAt:Date.now(),predicted:result.ok,keys:touchedKeys(result.events)});
    for (const event of result.events) {
      if (event.e === 'take' || event.e === 'serve') game.pending.add(`plate:${event.n}`);
      if (event.e === 'place' || event.e === 'transfer') game.pending.add(`slot:${event.n}:${event.slot}`);
      if (event.e === 'cook' || event.e === 'transfer' || event.e === 'trash') game.pending.add(`station:${event.x}`);
    }
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
    const code = ui.room.code;
    try {
      const data = await call(`/rooms/${code}/act`,{m:game.number,a:batch.map(item => ({s:item.s,...item.action}))});
      if (ui.game !== game) return;
      // The server's state first: who really took an order is known only from it.
      applyRoom(data);
      for (const res of data.res || []) {
        const sent = batch.find(item => item.s === res.s);
        if (sent && sent.predicted && !res.ok) {
          notify(WHY[res.why]?.(takerName(game,sent.action)) || '这一下没有成功',2200);
          game.undo = {keys:new Set(sent.keys),until:Date.now()+700};
        }
      }
      drawGame();
    } catch (error) {
      if (ui.game === game && ['room_not_found','not_in_room'].includes(error?.code)) { lostRoom(roomError(error)); return; }
    } finally {
      game.inflight = false;
      if (ui.game === game && game.outbox.length) later(() => flushOutbox(game),game.outbox.some(item => Date.now()-item.sentAt > 1500) ? 600 : 0);
    }
  }
  function finishRoomGame(results) {
    const game = ui.game;
    stopGame();
    ui.game = null;
    if (game?.watch) { show('room'); return; }
    play('finish');
    const scene = sceneById(results.scene) || (results.scene === 'daily' ? ui.daily?.scene : null);
    ui.resultsFor = {number:results.number,sceneId:results.scene,room:true,tier:results.tier,score:results.score,target:results.target ?? (scene ? targetFor(scene,results.minutes,results.tier) : 0),served:results.served,gone:results.gone,
      minutes:results.minutes,players:(results.players || []).map(player => ({...player,me:player.id === ui.room?.me})),learn:results.me?.learn || [],
      openBefore:!scene || results.scene === 'daily' || tierOpen(sceneStars(scene),results.tier),starsBefore:null,starsAfter:null,xp:(results.players || []).find(player => player.id === ui.room?.me)?.xp ?? null,xpPending:results.xpPending};
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
      else if (!quiet || error?.code !== 'service_unavailable') notify(roomError(error));
      return null;
    }
  }
  async function pushRoomSettings(scene = ui.room?.settings?.scene) {
    if (!ui.room) return;
    await roomAction('settings',{scene,tier:playableTier(sceneById(scene)),minutes:ui.prefs.minutes});
  }
  async function copyInvite() {
    const code = ui.room?.code;
    if (!code) return;
    const url = `${location.origin}${location.pathname}?kitchen=${code}#practice`;
    const text = `来「开饭啦」一起做饭，房间号 ${code}：${url}`;
    try {
      if (navigator.share && navigator.maxTouchPoints > 0) { await navigator.share({title:'开饭啦',text,url}); return; }
      await navigator.clipboard.writeText(text);
      notify('邀请链接已复制');
    } catch { notify(`房间号 ${code}`); }
  }
  function roomPage() {
    const room = ui.room;
    if (!room) return `${topBar('房间')}<p class="kc-empty">正在进房间…</p>`;
    const host = room.hostId === room.me, me = (room.players || []).find(player => player.id === room.me);
    const settings = room.settings || {}, scene = settings.scene === 'daily' ? ui.daily?.scene : sceneById(settings.scene);
    const sceneName = settings.scene === 'daily' ? '今日菜单 Dagens meny' : scene ? `${scene.no} · ${scene.zh}` : settings.scene || '';
    const between = ['lobby','finished'].includes(room.status);
    const editor = host && ui.roomEdit ? `<div class="kc-room-editor"><div class="kc-field"><span class="kc-field-label">场景</span><div class="kc-options is-scenes" role="radiogroup">
        ${[...scenes().filter(item => unlocked(item.id)).map(item => ({id:item.id,label:`<span lang="nb">${e(item.no)}</span>`,hint:e(item.zh)})),{id:'daily',label:'今日菜单',hint:'Dagens meny'}]
          .map(item => `<button type="button" class="kc-option" role="radio" aria-checked="${settings.scene === item.id}" data-kc="room-scene" data-value="${e(item.id)}"><span>${item.label}</span><small>${item.hint}</small></button>`).join('')}</div></div>
        ${tierField(sceneById(settings.scene))}${minutesField()}</div>` : '';
    const players = (room.players || []).map(player => `<li class="${player.id === room.me ? 'is-me' : ''}${player.online === false ? ' is-offline' : ''}"><span class="kc-avatar">${e(initial(player.name))}</span>
      <span class="kc-crew-name">${e(player.name)}${player.host ? '<small>房主</small>' : ''}</span><span class="kc-crew-state">${player.online === false ? '离线' : player.playing ? '在做菜' : player.ready ? `${icon('check')}准备好了` : '还没准备'}</span></li>`).join('');
    const status = !between ? '这一局正在进行，你在观战' : room.readyCount && room.readyCount === room.here ? '都准备好了，马上开始' : host ? '大家都准备好会自动开始；也可以先开始' : '准备好后等房主开始';
    return `${topBar('房间','home')}
      <section class="kc-panel kc-room-head"><div><span class="kc-kicker">房间号</span><p class="kc-code">${e(room.code)}</p></div>${button('invite',`${icon('link')}<span>邀请同学</span>`,'kc-ghost')}</section>
      <section class="kc-panel"><div class="kc-section-head"><h3>下一局</h3>${host && between ? `<button type="button" class="kc-link" data-kc="room-edit">${ui.roomEdit ? '收起' : '修改'}</button>` : ''}</div>
        <p class="kc-room-setting"><strong>${e(sceneName)}</strong><span>${e(TIERS[settings.tier]?.name || '')} · ${settings.minutes || DEFAULT_MINUTES} 分钟</span></p>${editor}</section>
      <section class="kc-panel"><div class="kc-section-head"><h3>厨师</h3><span class="kc-hint">${(room.players || []).length} / ${room.maxPlayers || MAX_PLAYERS}</span></div><ul class="kc-crew-list">${players}</ul></section>
      ${between ? `<div class="kc-start-bar"><div class="kc-actions-row">${button('room-ready',me?.ready ? '取消准备' : '准备好了',me?.ready ? 'kc-ghost' : 'kc-primary')}${host ? button('room-start','开始','kc-ghost') : ''}</div><p class="kc-hint kc-center">${status}</p></div>`
        : `<div class="kc-start-bar"><p class="kc-hint kc-center">${status}</p></div>`}`;
  }
  function onRoomClick(target,kc) {
    const value = target.dataset.value;
    switch (kc) {
      case 'invite': void copyInvite(); return true;
      case 'room-edit':
        ui.roomEdit = !ui.roomEdit;
        // The editor starts from the room's settings, not from this device's own last choice.
        if (ui.roomEdit && ui.room?.settings) {
          if (TIERS[ui.room.settings.tier]) ui.prefs.tier = ui.room.settings.tier;
          if (MINUTES.includes(ui.room.settings.minutes)) ui.prefs.minutes = ui.room.settings.minutes;
        }
        render();
        return true;
      case 'room-scene': void pushRoomSettings(value); return true;
      case 'room-ready': { const me = (ui.room?.players || []).find(player => player.id === ui.room?.me); void roomAction('ready',{ready:!me?.ready}); return true; }
      case 'room-start': void roomAction('start',{}); return true;
      default: return false;
    }
  }

  window.NorskKitchen = {open,close:requestClose,isOpen:() => ui.open};
})();
