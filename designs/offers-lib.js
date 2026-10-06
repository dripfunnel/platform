// Shared offer logic for DF Store (Offers list + Offer editor). Plain script: sets window.DFOffers.
(function () {
  const NOW = new Date(2026, 8, 27, 11, 0);
  const TZ = { US: 'New York time', DE: 'Berlin time', IN: 'India time' };
  const W = k => k === 'US'
    ? { ship: 'shipping', Ship: 'Shipping', code: 'coupon code', Code: 'Coupon code', tax: 'sales tax', taxIncl: false }
    : k === 'DE' ? { ship: 'delivery', Ship: 'Delivery', code: 'voucher code', Code: 'Voucher code', tax: 'VAT', taxIncl: true }
    : { ship: 'delivery', Ship: 'Delivery', code: 'coupon code', Code: 'Coupon code', tax: 'GST', taxIncl: true };
  const pd = s => s ? new Date(s) : null;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const fmtD = (s, R, time) => { const d = pd(s); if (!d) return ''; const o = { weekday: 'short', day: 'numeric', month: 'short' }; let t = d.toLocaleDateString(R.locale, o); if (time) t += ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); return t; };
  const short = (s, R) => { const d = pd(s); return d ? d.toLocaleDateString(R.locale, { day: 'numeric', month: 'short' }) : ''; };
  const hrs = (a, b) => (a - b) / 36e5;

  const ST = {
    live: { l: 'Live', icon: '●', fg: '#1D6B47', bg: '#EEF7F2', bd: '#C3E0D2' },
    ending: { l: 'Ending soon', icon: '◔', fg: '#6E4300', bg: '#FBF1DC', bd: '#E3C27E' },
    scheduled: { l: 'Scheduled', icon: '◷', fg: '#00325F', bg: '#EAF1F8', bd: '#C6D9EC' },
    off: { l: 'Off', icon: '‖', fg: '#434A55', bg: '#F4F2EF', bd: '#D7D3CD' },
    ended: { l: 'Ended', icon: '■', fg: '#14181F', bg: '#FFFFFF', bd: '#9AA1AB' },
    usedup: { l: 'Used up', icon: '◼', fg: '#8F4017', bg: '#FDF0E8', bd: '#F0D4BF' }
  };
  function status(o, R) {
    const st = pd(o.starts), en = pd(o.ends);
    let k;
    if (!o.enabled) k = 'off';
    else if (en && en < NOW) k = 'ended';
    else if (o.total && o.used >= o.total) k = 'usedup';
    else if (st && st > NOW) k = 'scheduled';
    else if (o.repeat && o.repeat.on && !inWindow(o.repeat, NOW)) k = 'scheduled';
    else if (en && hrs(en, NOW) <= 48) k = 'ending';
    else k = 'live';
    const x = ST[k];
    let time = '';
    if (k === 'live') time = en ? 'Ends ' + fmtD(o.ends, R, true) : (st ? 'Started ' + short(o.starts, R) + ' · no end date' : 'No end date');
    if (k === 'ending') time = 'Ends in ' + Math.max(1, Math.round(hrs(en, NOW))) + ' h · ' + fmtD(o.ends, R, true);
    if (k === 'scheduled') { if (st && st > NOW) { const d = Math.ceil(hrs(st, NOW) / 24); time = 'Starts in ' + d + (d === 1 ? ' day' : ' days') + ' · ' + fmtD(o.starts, R, true); } else time = 'Repeats · next ' + nextWindow(o.repeat, R); }
    if (k === 'live' && o.repeat && o.repeat.on) time = 'On now until ' + o.repeat.to + ' · repeats ' + repeatWords(o.repeat);
    if (k === 'off') time = o.pausedNote || (en && en < NOW ? 'Off · end date passed ' + short(o.ends, R) : 'Turned off');
    if (k === 'ended') time = 'Ended ' + short(o.ends, R);
    if (k === 'usedup') time = o.used + ' of ' + o.total + ' used';
    return { k, ...x, time, group: k === 'ending' ? 'live' : k === 'usedup' ? 'ended' : k };
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mins = t => { const [a, b] = (t || '00:00').split(':').map(Number); return a * 60 + (b || 0); };
  function inWindow(r, d) { if (!(r.days || []).includes(d.getDay())) return false; const m = d.getHours() * 60 + d.getMinutes(); return m >= mins(r.from) && m < mins(r.to); }
  function nextWindow(r, R) { for (let i = 0; i < 8; i++) { const d = new Date(NOW); d.setDate(d.getDate() + i); if ((r.days || []).includes(d.getDay()) && (i > 0 || NOW.getHours() * 60 + NOW.getMinutes() < mins(r.from))) return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + d.toLocaleDateString(R.locale, { month: 'short' }) + ', ' + r.from; } return '—'; }
  function repeatWords(r) { const d = (r.days || []).slice().sort(); return (d.length === 7 ? 'every day' : 'every ' + d.map(x => DAYS[x]).join(', ')) + ', ' + r.from + '–' + r.to; }
  function genCode(len) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < (len || 8); i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

  const isGift = p => p.type === 'giftcard' || /gift card/i.test(p.name);
  function matches(o, p) {
    if (o.exGift && isGift(p)) return false;
    if (o.exSale && p.compare) return false;
    if (o.type === 'order' || o.type === 'shipping') return true;
    if (o.type === 'bxgy') return (o.getIds || []).includes(p.id) || (o.buyIds || []).includes(p.id);
    if (o.target === 'filter') return !!o.filter && Object.entries(p.filters || {}).some(([f, v]) => f === o.filter.facet && String(v).toLowerCase() === String(o.filter.value).toLowerCase());
    if (o.target === 'collection') return (o.collProducts || []).includes(p.id);
    return (o.productIds || []).includes(p.id);
  }
  function targets(o, products) { return products.filter(p => p.status !== 'waiting' && p.status !== 'sentback' && matches(o, p)); }
  const pname = (ids, products) => { const n = ids.map(id => (products.find(p => p.id === id) || {}).name).filter(Boolean); return n.length <= 2 ? n.join(' and ') : n.slice(0, 2).join(', ') + ' and ' + (n.length - 2) + ' more'; };

  function sentence(o, ctx) {
    const { R, fmt, products, groups } = ctx; const w = W(R.key); const P = [];
    const val = o.kind === 'fixed' ? fmt(o.value || 0) : (o.value || 0) + '%';
    const tgt = o.target === 'filter' ? (o.filter ? 'everything tagged ' + o.filter.value : 'products you choose') : o.target === 'collection' ? 'everything in ' + (o.collName || 'a collection') : ((o.productIds || []).length ? pname(o.productIds, products) : 'products you choose');
    if (o.type === 'products') P.push(val + ' off ' + (o.kind === 'fixed' ? (o.fixedPer === 'line' ? 'each line of ' : 'each item of ') : '') + tgt);
    const ex = [o.exGift ? 'gift cards' : '', o.exSale ? 'items already reduced' : ''].filter(Boolean); if (ex.length && o.type !== 'shipping') P.push('except ' + ex.join(' and '));
    if (o.type === 'order') P.push(o.tiers && o.tiers.length ? o.tiers.map((t, i) => (o.kind === 'fixed' ? fmt(t.v) : t.v + '%') + ' off orders over ' + fmt(t.min)).join(', ') : val + ' off the whole order');
    if (o.type === 'bxgy') P.push('Buy ' + (o.buyN || 1) + ' ' + ((o.buyIds || []).length ? pname(o.buyIds, products) : 'chosen products') + ', get ' + (o.getM || 1) + ' ' + (o.sameItems ? 'more' : ((o.getIds || []).length ? pname(o.getIds, products) : 'chosen products')) + ' ' + (o.getAt === 'half' ? 'half price' : o.getAt === 'fixed' ? 'for ' + fmt(o.getPrice || 0) + ' each' : 'free') + (o.onceOrder ? ' (once per order)' : '') + (o.autoGift ? ' · added to the cart for them' : ''));
    if (o.type === 'shipping') P.push((o.shipMode === 'off' ? fmt(o.shipOff || 0) + ' off ' + w.ship : 'Free ' + w.ship) + ((o.shipCountries || []).length ? ' to ' + o.shipCountries.join(', ') : '') + ((o.shipMethods || []).length ? ' (' + o.shipMethods.join(', ') + ')' : ''));
    if (o.cap) P.push('up to ' + fmt(o.cap));
    P.push(o.how === 'code' ? (o.bulk && o.bulk.on ? o.bulk.count + ' single-use codes ' + (o.bulk.prefix || '') + '…' : 'code ' + (o.code || '—')) : 'automatic at checkout');
    if (o.min === 'amount' && o.minAmount) P.push('orders of ' + fmt(o.minAmount) + ' or more' + (R.incl ? ' (incl. ' + w.tax + ')' : ' (before tax)'));
    if (o.min === 'qtyThese' && o.minQty) P.push('when buying ' + o.minQty + ' or more of these');
    if (o.min === 'qty' && o.minQty) P.push('with ' + o.minQty + '+ items in the cart');
    if (o.who === 'groups' && (o.groupIds || []).length) P.push('for ' + o.groupIds.map(g => (groups.find(x => x.id === g) || {}).name).filter(Boolean).join(' or ') + ' customers');
    if (o.who === 'first') P.push('first order only');
    if (o.repeat && o.repeat.on) P.push('repeats ' + repeatWords(o.repeat));
    if (o.who === 'customers') P.push('for ' + (o.custIds || []).length + ' chosen customers');
    if (o.who === 'market' && o.market) P.push(o.market + ' shoppers only');
    const st = pd(o.starts); if (st && st > NOW) P.push('starts ' + short(o.starts, R));
    P.push(o.ends ? 'ends ' + short(o.ends, R) : 'no end date');
    if (o.perCust) P.push(o.perCust === 1 ? 'once per customer' : o.perCust + ' times per customer');
    if (o.total) P.push('first ' + o.total + ' uses');
    if (o.bestOnly) P.push('only if it’s the best discount');
    else if (o.combines && (!o.combines.product || !o.combines.order || !o.combines.shipping)) { const no = [['product', 'product'], ['order', 'order'], ['shipping', w.ship]].filter(([k]) => !o.combines[k]).map(x => x[1]); P.push('doesn’t combine with other ' + no.join(' or ') + ' offers'); }
    return P.join(' · ');
  }

  // cart simulation: applies offers (in priority order) to lines
  const cls = o => o.type === 'order' ? 'order' : o.type === 'shipping' ? 'shipping' : 'product';
  const combOk = (a, b) => (!a.combines || a.combines[cls(b)] !== false) && (!b.combines || b.combines[cls(a)] !== false);
  function simulate(lines, offers, ctx, codes, shopper) {
    const { R } = ctx; const w = W(R.key); const shipFee = R.mult(6); shopper = shopper || { kind: 'returning' };
    const oneCode = offers.some(o => o.oneCode && o.how === 'code' && (codes || []).includes(o.code));
    if (oneCode) codes = (codes || []).slice(0, 1);
    let L = lines.map(l => ({ ...l, unit: l.p.price, total: l.p.price * l.qty, disc: 0 }));
    const applied = [];
    const qualifies = (o, sub) => {
      if (o.how === 'code' && !(codes || []).includes(o.code)) return false;
      if (o.repeat && o.repeat.on && !inWindow(o.repeat, NOW)) return false;
      if (o.who === 'first' && shopper.kind !== 'new') return false;
      if ((o.who === 'groups' || o.who === 'customers') && shopper.kind !== 'member') return false;
      if (o.who === 'market' && shopper.kind !== 'abroad') return false;
      if (o.type === 'shipping' && (o.shipCountries || []).length && shopper.kind === 'abroad' && !o.shipCountries.includes(shopper.market)) return false;
      if (o.min === 'amount' && o.minAmount && sub < o.minAmount) return false;
      if (o.min === 'qty' && o.minQty && L.reduce((a, l) => a + l.qty, 0) < o.minQty) return false;
      if (o.min === 'qtyThese' && o.minQty && L.filter(l => matches(o, l.p)).reduce((a, l) => a + l.qty, 0) < o.minQty) return false;
      return true;
    };
    const order = { products: 1, bxgy: 1, order: 2, shipping: 3 };
    const list = [...offers].sort((a, b) => order[a.type] - order[b.type]);
    let ship = shipFee; const sub0 = L.reduce((a, l) => a + l.total, 0);
    const best = list.some(o => o.bestOnly) ? (() => { let top = null, amt = -1; list.filter(o => o.type !== 'shipping').forEach(o => { const r = simulate(lines, [{ ...o, bestOnly: false }], ctx, codes, shopper); if (r.saved > amt) { amt = r.saved; top = o.id; } }); return top; })() : null;
    const used = [];
    list.forEach(o => {
      const sub = L.reduce((a, l) => a + l.total - l.disc, 0);
      if (!qualifies(o, sub)) return;
      if (best && o.type !== 'shipping' && o.id !== best) return;
      if (used.some(u => !combOk(u, o))) { applied.push({ id: o.id, name: o.name, code: o.how === 'code' ? o.code : '', amt: 0, self: !!o.self, blocked: true }); return; }
      let d = 0;
      if (o.type === 'products') L.forEach(l => { if (!matches(o, l.p)) return; const fx = o.fixedPer === 'line' ? o.value : o.value * l.qty; const x = o.kind === 'fixed' ? Math.min(fx, l.total - l.disc) : (l.total - l.disc) * o.value / 100; l.disc += x; d += x; });
      if (o.type === 'bxgy') {
        const units = []; L.forEach(l => { if ((o.getIds || []).includes(l.p.id)) for (let i = 0; i < l.qty; i++) units.push(l); });
        const buyQty = L.filter(l => (o.buyIds || []).includes(l.p.id)).reduce((a, l) => a + l.qty, 0);
        const sets = o.onceOrder ? Math.min(1, Math.floor(buyQty / ((o.buyN || 1) + (o.sameItems ? (o.getM || 1) : 0)))) : Math.floor(buyQty / ((o.buyN || 1) + (o.sameItems ? (o.getM || 1) : 0)));
        const off = u => o.getAt === 'half' ? u / 2 : o.getAt === 'fixed' ? Math.max(0, u - (o.getPrice || 0)) : u;
        units.sort((a, b) => a.unit - b.unit).slice(0, sets * (o.getM || 1)).forEach(l => { const x = off(l.unit); l.disc += x; d += x; });
      }
      if (o.type === 'order') {
        let pct = o.value, fix = o.value;
        if (o.tiers && o.tiers.length) { const t = [...o.tiers].sort((a, b) => b.min - a.min).find(t => sub >= t.min); if (!t) return; pct = t.v; fix = t.v; }
        d = o.kind === 'fixed' ? Math.min(fix, sub) : sub * pct / 100; if (o.cap) d = Math.min(d, o.cap);
        const base = L.reduce((a, l) => a + l.total - l.disc, 0) || 1; L.forEach(l => { l.disc += d * (l.total - l.disc) / base; });
      }
      if (o.type === 'shipping') { if (ship > 0) { d = o.shipMode === 'off' ? Math.min(o.shipOff || 0, ship) : ship; ship -= d; } }
      if (d > 0) used.push(o);
      if (d > 0) applied.push({ id: o.id, name: o.name, code: o.how === 'code' ? o.code : '', amt: Math.round(d * 100) / 100, self: !!o.self });
    });
    const sub = L.reduce((a, l) => a + l.total - l.disc, 0);

    const total = sub + ship;
    const tax = R.incl ? total - total / (1 + R.rate) : Math.round(sub * 0.0725 * 100) / 100;
    return { lines: L.map(l => ({ ...l, after: l.total - l.disc })), applied, subBefore: sub0, sub, ship, shipFee, total: R.incl ? total : total + tax, tax, taxWord: R.incl ? 'Includes ' + w.tax + ' (' + Math.round(R.rate * 100) + '%)' : 'Estimated sales tax (Ohio 7.25%)', saved: applied.reduce((a, x) => a + x.amt, 0), blocked: applied.filter(a => a.blocked) };
  }

  function seed(R, products) {
    const M = v => R.mult(v);
    const has = id => products.some(p => p.id === id);
    const d = (y, mo, da, h, mi) => iso(new Date(y, mo - 1, da, h || 0, mi || 0));
    const daily = (n, b) => Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round(b + Math.sin(i * 1.7 + n) * b * 0.6)));
    const base = { fixedPer: 'item', getAt: 'free', getPrice: null, autoGift: false, shipMode: 'free', shipOff: null, shipCountries: [], shipMethods: [], repeat: null, bestOnly: false, oneCode: false, exGift: false, exSale: false, curAmts: {}, note: '', total: null, perCust: null, who: 'all', groupIds: [], min: 'none', minAmount: null, minQty: null, kind: 'pct', value: 10, target: 'products', productIds: [], filter: null, buyN: 2, getM: 1, buyIds: [], getIds: [], sameItems: true, onceOrder: false, starts: null, ends: null, enabled: true, used: 0, given: 0, sales: 0, orders: 0, tiers: [], cap: null, combines: { product: true, order: true, shipping: true }, bulk: null, history: [], deleted: false, trans: {} };
    const K = R.key;
    const X = [
      { id: 'o1', type: 'products', how: 'auto', name: K === 'DE' ? 'Herbst-Leinen −20 %' : K === 'IN' ? 'Festive linen 20% off' : 'Autumn linen 20% off', kind: 'pct', value: 20, target: 'filter', filter: { facet: 'Fabric', value: 'Linen' }, starts: d(2026, 9, 14, 9), ends: d(2026, 9, 28, 23, 59), used: 38, given: M(412), sales: M(2210), orders: 38, daily: daily(1, 3), history: [['Priya Shah', '14 Sep', 'Created and turned on']] },
      { id: 'o2', type: 'order', how: 'code', code: 'WELCOME10', name: 'Welcome 10% off', kind: 'pct', value: 10, perCust: 1, starts: d(2026, 3, 2, 9), used: 112, given: M(598), sales: M(5960), orders: 112, daily: daily(2, 8), history: [['Farhan Ali', '2 Mar', 'Created']] },
      { id: 'o3', type: 'shipping', how: 'auto', name: K === 'US' ? 'Free shipping over ' + '$' + M(75) : 'Free delivery over ' + (K === 'DE' ? M(75) + ' €' : '₹' + M(75).toLocaleString('en-IN')), min: 'amount', minAmount: M(75), starts: d(2026, 1, 10, 0), used: 264, given: M(1584), sales: M(26400), orders: 264, daily: daily(3, 18), history: [['Farhan Ali', '10 Jan', 'Created']] },
      { id: 'o4', type: 'bxgy', how: 'auto', name: 'Socks: buy 2, get 1 free', buyN: 2, getM: 1, buyIds: has('p11') ? ['p11'] : [], getIds: has('p11') ? ['p11'] : [], sameItems: true, enabled: false, starts: d(2026, 6, 1, 9), used: 21, given: M(294), sales: M(882), orders: 21, daily: daily(4, 1), history: [['Priya Shah', '12 Sep', 'Turned off']] },
      { id: 'o5', type: 'order', how: 'code', code: K === 'IN' ? 'DIWALI15' : K === 'DE' ? 'BLACKWEEK25' : 'BLACKFRIDAY25', name: K === 'IN' ? 'Diwali 15% off' : K === 'DE' ? 'Black Week −25 %' : 'Black Friday 25% off', kind: 'pct', value: K === 'IN' ? 15 : 25, starts: K === 'IN' ? d(2026, 11, 1, 0) : d(2026, 11, 27, 0), ends: K === 'IN' ? d(2026, 11, 10, 23, 59) : d(2026, 11, 30, 23, 59), perCust: 1, daily: daily(5, 0), history: [['Farhan Ali', '20 Sep', 'Created, scheduled']] },
      { id: 'o6', type: 'products', how: 'code', code: K === 'DE' ? 'SOMMER20' : K === 'IN' ? 'MONSOON20' : 'SUMMER20', name: K === 'DE' ? 'Sommer −20 %' : K === 'IN' ? 'Monsoon 20% off' : 'Summer 20% off', kind: 'pct', value: 20, target: 'filter', filter: { facet: 'Fabric', value: 'Cotton' }, starts: d(2026, 6, 1, 0), ends: d(2026, 8, 31, 23, 59), used: 204, given: M(1318), sales: M(9870), orders: 204, daily: daily(6, 0), history: [['System', '31 Aug', 'Ended']] },
      { id: 'o7', type: 'order', how: 'code', code: 'VIP15', name: 'VIP 15% off', kind: 'pct', value: 15, who: 'groups', groupIds: ['g1'], starts: d(2026, 5, 1, 0), used: 46, given: M(689), sales: M(4590), orders: 46, daily: daily(7, 2), history: [['Farhan Ali', '1 May', 'Created']] },
      { id: 'o8', type: 'products', how: 'code', code: 'FLASH50', name: 'Flash sale 50% off silk', kind: 'pct', value: 50, target: 'products', productIds: has('p8') ? ['p8'] : [], total: 50, used: 50, starts: d(2026, 9, 20, 9), ends: d(2026, 9, 30, 23, 59), given: M(1050), sales: M(1050), orders: 50, daily: daily(8, 5), history: [['Priya Shah', '20 Sep', 'Created'], ['System', '22 Sep', 'Reached 50 uses']] }
    ];
    return X.map(o => ({ ...base, daily: daily(0, 0), ...o }));
  }

  function events(R) {
    const T = { US: [['Black Friday', d2(2026, 11, 27), d2(2026, 11, 30, 23, 59)], ['Holiday gifts', d2(2026, 12, 1), d2(2026, 12, 24, 23, 59)], ['Back to school', d2(2027, 8, 1), d2(2027, 8, 31, 23, 59)]], DE: [['Black Week', d2(2026, 11, 23), d2(2026, 11, 30, 23, 59)], ['Advent', d2(2026, 11, 29), d2(2026, 12, 24, 23, 59)], ['Weihnachten', d2(2026, 12, 14), d2(2026, 12, 24, 23, 59)]], IN: [['Diwali', d2(2026, 11, 1), d2(2026, 11, 10, 23, 59)], ['Wedding season', d2(2026, 11, 15), d2(2026, 12, 15, 23, 59)], ['Eid', d2(2027, 3, 18), d2(2027, 3, 22, 23, 59)]] };
    return T[R.key] || T.US;
  }
  function d2(y, mo, da, h, mi) { return iso(new Date(y, mo - 1, da, h || 0, mi || 0)); }

  window.DFOffers = { repeatWords, inWindow, isGift, NOW, TZ, W, ST, status, genCode, matches, targets, sentence, simulate, seed, events, iso, fmtD, short, pd };
})();
