(function () {
let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const PARTNERS = {
  ns: { id:'ns', name:'Northstar Commerce', product:'Northstar Shops', host:'store.northstar.com', preview:'*.preview.northstar.com', shop:'*.shops.northstar.com', mail:'mail.northstar.com', region:'United States and Canada', countries:['United States','Canada'], currencies:['USD','CAD'], languages:['English','French'], primary:'#0F5E63', accent:'#E8C9A0', font:'Nunito', corner:'Rounded', legal:'Northstar Commerce LLC', address:'410 Pine Street, Suite 300, Seattle, WA 98101, United States', tax:'EIN 84-2219034', contract:[['Contract','Partner agreement NS-2025-014, signed 12 Mar 2025'],['Term','3 years, renews 12 Mar 2028'],['Wholesale fees','Starter $12 · Growth $18 · Pro $35 per store per month'],['“Powered by DripFunnel”','May be removed on any plan'],['Payouts','Monthly, on the 1st, in USD']], bank:'Chase ending 1180', bankSt:'verified', card:'Amex ending 3009', support:'help@northstar.com', supportUrl:'https://help.northstar.com', help:'https://help.northstar.com/shops', terms:'https://northstar.com/shops/terms', privacy:'https://northstar.com/shops/privacy', dpa:'https://northstar.com/shops/dpa', powered:false },
  kl: { id:'kl', name:'Kaufladen Digital', product:'Kaufladen Shops', host:'shop.kaufladen.de', preview:'*.vorschau.kaufladen.de', shop:'*.shops.kaufladen.de', mail:'mail.kaufladen.de', region:'Germany and Austria', countries:['Germany','Austria'], currencies:['EUR'], languages:['German','English'], primary:'#1F3A5F', accent:'#F2B134', font:'Source Sans 3', corner:'Soft', legal:'Kaufladen Digital GmbH', address:'Torstraße 140, 10119 Berlin, Germany', tax:'USt-IdNr. DE318877312', contract:[['Contract','Partner agreement KL-2026-031, signed 2 Sep 2026'],['Term','2 years'],['Wholesale fees','Basis €11 · Plus €17 · Profi €32 per store per month'],['“Powered by DripFunnel”','Must stay on for the first year'],['Payouts','Monthly, on the 1st, in EUR']], bank:null, bankSt:'missing', support:'hilfe@kaufladen.de', supportUrl:'', help:'', terms:'https://kaufladen.de/agb', privacy:'https://kaufladen.de/datenschutz', dpa:'', powered:true, sentBack:'Your legal pages are missing an Impressum, which German law requires. Add it under Branding › Words, then submit again.' },
};
const ENT = [
  ['toggle','domain','Custom domain'],['toggle','offers','Offers'],['toggle','suppliersOn','Suppliers'],['toggle','powered','Remove “Powered by”'],['toggle','aplus','A+ content'],['toggle','size','Size charts'],
  ['limit','products','Products'],['limit','staff','Staff seats'],['limit','suppliers','Suppliers'],['limit','languages','Languages'],['limit','currencies','Currencies'],
  ['allow','publish','“Publish now” presses'],['allow','ai','AI design prompts'],
];
const DFMAX = { products:20000, staff:25, suppliers:50, languages:5, currencies:5, publish:300, ai:1000 };
const PLANS = {
  ns: [
    { id:'starter', name:'Starter', desc:'Everything to open your first shop.', status:'live', trial:14, price:{ USD:[29,290], CAD:[39,390] }, fee:12, stores:31, e:{ domain:false, offers:false, suppliersOn:false, powered:false, aplus:false, size:true, products:500, staff:2, suppliers:0, languages:1, currencies:1, publish:20, ai:50 } },
    { id:'growth', name:'Growth', desc:'For shops that sell every day.', status:'live', trial:14, price:{ USD:[49,490], CAD:[65,650] }, fee:18, stores:44, e:{ domain:true, offers:true, suppliersOn:true, powered:false, aplus:true, size:true, products:5000, staff:5, suppliers:5, languages:2, currencies:2, publish:60, ai:200 } },
    { id:'pro', name:'Pro', desc:'For established brands with a team.', status:'live', trial:14, price:{ USD:[99,990], CAD:[129,1290] }, fee:35, stores:11, e:{ domain:true, offers:true, suppliersOn:true, powered:true, aplus:true, size:true, products:10000, staff:15, suppliers:20, languages:4, currencies:3, publish:150, ai:500 } },
    { id:'basic24', name:'Basic (2024)', desc:'Our first plan. Replaced by Starter.', status:'retired', trial:0, price:{ USD:[19,190], CAD:[25,250] }, fee:10, stores:0, e:{ domain:false, offers:false, suppliersOn:false, powered:false, aplus:false, size:false, products:200, staff:1, suppliers:0, languages:1, currencies:1, publish:10, ai:0 } },
  ],
  kl: [
    { id:'basis', name:'Basis', desc:'Alles für den ersten Shop.', status:'draft', trial:14, price:{ EUR:[null,null] }, fee:11, stores:0, e:{ domain:false, offers:false, suppliersOn:false, powered:false, aplus:false, size:true, products:500, staff:2, suppliers:0, languages:2, currencies:1, publish:20, ai:50 } },
    { id:'plus', name:'Plus', desc:'Für Shops, die täglich verkaufen.', status:'draft', trial:14, price:{ EUR:[null,null] }, fee:17, stores:0, e:{ domain:true, offers:true, suppliersOn:true, powered:false, aplus:true, size:true, products:5000, staff:5, suppliers:5, languages:2, currencies:1, publish:60, ai:200 } },
    { id:'profi', name:'Profi', desc:'Für etablierte Marken mit Team.', status:'draft', trial:14, price:{ EUR:[null,null] }, fee:32, stores:0, e:{ domain:true, offers:true, suppliersOn:true, powered:false, aplus:true, size:true, products:10000, staff:15, suppliers:20, languages:2, currencies:1, publish:150, ai:500 } },
  ],
};
const U = (products, staff, suppliers, ai, publish) => ({ products, staff, suppliers, ai, publish });
const S = (o) => ({ cycle:'monthly', allowSupport:true, card:'4242', sf:'live', overrides:[], orders:0, sales:0, ...o });
const NAMED = [
  S({ id:'s1', name:'Juniper & Co.', code:'juniper-co', owner:['Anjali Nair','anjali@juniperco.com'], country:'United States', cur:'USD', plan:'pro', status:'active', created:'2025-12-01', sales:18420, prevSales:16880, orders:612, dom:{ host:'juniperco.com', custom:true, st:'live' }, usage:U(2140,6,3,212,48), people:9, card:'4417', overrides:[['+10 publishes this month','Diwali and holiday launches','2026-09-02','Diego Alvarez']] }),
  S({ id:'s2', name:'Harbor Coffee Co.', code:'harbor-coffee', owner:['Jenna Park','jenna@harborcoffee.co'], country:'United States', cur:'USD', plan:'growth', status:'trial', trialEnd:'2026-09-29', created:'2026-09-15', sales:1240, prevSales:0, orders:38, dom:{ host:'harbor-coffee.shops.northstar.com', custom:false, st:'live' }, usage:U(84,2,0,41,9), people:2, card:null }),
  S({ id:'s3', name:'Redline Moto Parts', code:'redline-moto', owner:['Dale Kowalski','dale@redlinemoto.com'], country:'United States', cur:'USD', plan:'growth', status:'suspended', reason:'Chargebacks on 3 orders ($2,840). Card network notice CB-2291.', suspendedOn:'2026-09-24', created:'2025-11-02', sales:0, prevSales:6210, orders:0, dom:{ host:'redlinemoto.com', custom:true, st:'live' }, usage:U(1320,3,1,20,4), people:3, card:'0019' }),
  S({ id:'s4', name:'Maple & Pine', code:'maple-pine', owner:['Chloé Tremblay','chloe@mapleandpine.ca'], country:'Canada', cur:'CAD', plan:'growth', status:'active', created:'2026-04-18', sales:8760, prevSales:8120, orders:301, dom:{ host:'shop.mapleandpine.ca', custom:true, st:'waiting', since:'2026-09-26' }, usage:U(640,3,1,88,22), people:4, allowSupport:false, card:'7730' }),
  S({ id:'s5', name:'Tidewater Surf', code:'tidewater-surf', owner:['Marco Silva','marco@tidewatersurf.com'], country:'United States', cur:'USD', plan:'starter', status:'pastdue', pastDueSince:'2026-09-19', created:'2026-02-10', sales:2310, prevSales:2980, orders:74, dom:{ host:'tidewater-surf.shops.northstar.com', custom:false, st:'live' }, usage:U(212,2,0,12,6), people:2, card:'1881' }),
  S({ id:'s6', name:'Fieldnote Paper', code:'fieldnote-paper', owner:['Hana Sato','hana@fieldnotepaper.com'], country:'United States', cur:'USD', plan:'starter', status:'trial', trialEnd:'2026-10-11', created:'2026-09-27', sales:0, prevSales:0, orders:0, sf:'building', stuck:43, dom:{ host:'fieldnote-paper.shops.northstar.com', custom:false, st:'live' }, usage:U(0,1,0,3,0), people:1, card:null }),
  S({ id:'s7', name:'Copperline Audio', code:'copperline-audio', owner:['Owen Price','owen@copperline.audio'], country:'United States', cur:'USD', plan:'pro', status:'active', created:'2025-10-05', sales:9800, prevSales:10240, orders:188, sf:'own', dom:{ host:'copperline.audio', custom:true, st:'live' }, usage:U(310,4,0,0,0), people:4, allowSupport:false, card:'5520' }),
  S({ id:'s8', name:'Birch & Bramble', code:'birch-bramble', owner:['Leah Morgan','leah@birchandbramble.ca'], country:'Canada', cur:'CAD', plan:'starter', status:'active', created:'2026-01-22', sales:3120, prevSales:2870, orders:142, dom:{ host:'birch-bramble.shops.northstar.com', custom:false, st:'live' }, usage:U(481,2,0,44,17), people:2, card:'3004' }),
  S({ id:'s9', name:'Prairie Goods Co.', code:'prairie-goods', owner:['Tom Lindgren','tom@prairiegoods.ca'], country:'Canada', cur:'CAD', plan:'growth', status:'active', created:'2026-03-09', sales:4480, prevSales:4010, orders:160, dom:{ host:'prairiegoods.ca', custom:true, st:'live' }, usage:U(920,3,2,60,19), people:5, card:'8812' }),
  S({ id:'s10', name:'Summit Supply', code:'summit-supply', owner:['Grace Liu','grace@summitsupply.com'], country:'United States', cur:'USD', plan:'starter', status:'cancelled', cancelledOn:'2026-09-02', created:'2025-12-19', sales:0, prevSales:1420, orders:0, sf:'live', dom:{ host:'summit-supply.shops.northstar.com', custom:false, st:'live' }, usage:U(120,1,0,0,0), people:1, card:'6621' }),
  S({ id:'s11', name:'Oakline Home', code:'oakline-home', owner:['Priya Raman','priya@oaklinehome.com'], country:'United States', cur:'USD', plan:'growth', status:'active', created:'2025-09-30', sales:7650, prevSales:7980, orders:244, dom:{ host:'oaklinehome.com', custom:true, st:'live' }, usage:U(4210,5,4,190,58), people:6, card:'9902' }),
  S({ id:'s12', name:'Lumen Candle Co.', code:'lumen-candle', owner:['Nora Fitz','nora@lumencandle.com'], country:'United States', cur:'USD', plan:'growth', status:'trial', trialEnd:'2026-10-04', created:'2026-09-20', sales:420, prevSales:0, orders:17, dom:{ host:'lumen-candle.shops.northstar.com', custom:false, st:'live' }, usage:U(36,1,0,22,5), people:1, card:null }),
  S({ id:'s13', name:'Bayside Pets', code:'bayside-pets', owner:['Ethan Wells','ethan@baysidepets.com'], country:'United States', cur:'USD', plan:'growth', status:'pastdue', pastDueSince:'2026-09-25', created:'2026-05-14', sales:3890, prevSales:3710, orders:131, dom:{ host:'baysidepets.com', custom:true, st:'live' }, usage:U(760,2,0,31,12), people:3, card:'2210' }),
  S({ id:'s14', name:'Northfork Outfitters', code:'northfork', owner:['Sam Becker','sam@northforkoutfitters.com'], country:'United States', cur:'USD', plan:'pro', status:'active', created:'2025-08-11', sales:12900, prevSales:11800, orders:402, dom:{ host:'northforkoutfitters.com', custom:true, st:'live' }, usage:U(3380,9,6,301,71), people:11, card:'4150' }),
];
const A1 = ['Alder','Amber','Aspen','Beacon','Blue Fern','Bramble','Cedar','Cinder','Clover','Coastal','Copper','Crescent','Driftwood','Ember','Fernwood','Flint','Foxglove','Golden','Granite','Hollow','Indigo','Ivy','Juniper Hill','Kestrel','Lark','Linden','Meadow','Mesa','Moss','Nimbus','Oak & Ash','Orchard','Pebble','Pine','Quarry','Raven','Redwood','Ridge','Rowan','Saltwater','Sierra','Slate','Sparrow','Spruce','Stone','Sunday','Tamarack','Thistle','Timber','Tundra','Valley','Verde','Willow','Wren','Yarrow','Zephyr','Harvest','Lantern','Marigold','Oasis','Pioneer','Sage','Canyon','Highland','Riverbend','Seabright','Evergreen','Birchwood','Larkspur','Fjord','Dune','Harbor Light'];
const A2 = ['Goods','Studio','Supply','Co.','Market','Kitchen','Apparel','Home','Botanics','Books','Ceramics','Outfitters','Tea','Leather','Prints','Bakery'];
const FN = ['Ava','Liam','Mia','Noah','Zoe','Eli','Ruby','Leo','Ivy','Owen','Nina','Jack','Isla','Theo','Lena','Max','Aria','Finn','Cora','Jude'];
const LN = ['Hart','Brooks','Nguyen','Patel','Reyes','Kim','Walsh','Ford','Lam','Ross','Diaz','Shaw','Cole','Grant','Bishop','Hale','Moreau','Singh'];
const planPool = []; const need = { starter:31, growth:44, pro:11 }; NAMED.forEach(s => need[s.plan]--);
Object.entries(need).forEach(([k, n]) => { for (let i = 0; i < n; i++) planPool.push(k); });
const stPool = ['trial','trial','trial','trial','trial','pastdue','cancelled']; while (stPool.length < planPool.length) stPool.push('active');
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
shuffle(planPool); shuffle(stPool);
const LIM = { starter:500, growth:5000, pro:10000 };
const GEN = planPool.map((plan, i) => {
  const name = A1[i % A1.length] + ' ' + A2[(i * 7) % A2.length], code = name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
  const ca = rnd() < 0.3, fn = FN[i % FN.length], ln = LN[(i * 5) % LN.length], st = stPool[i];
  const m = 1 + Math.floor(rnd() * 12), created = (m > 9 ? '2025-' + String(m).padStart(2, '0') : '2026-0' + m) + '-' + String(1 + Math.floor(rnd() * 27)).padStart(2, '0');
  const base = plan === 'pro' ? 6000 : plan === 'growth' ? 2600 : 900, sales = st === 'cancelled' ? 0 : Math.round(base * (0.3 + rnd() * 1.2));
  const pl = LIM[plan], prod = Math.round(pl * (0.05 + rnd() * 0.7));
  const custom = plan !== 'starter' && rnd() < 0.5;
  return S({ id:'g' + i, name, code, owner:[fn + ' ' + ln, fn.toLowerCase() + '@' + code.replace(/-/g, '') + (ca ? '.ca' : '.com')], country: ca ? 'Canada' : 'United States', cur: ca ? 'CAD' : 'USD', plan, status: st, trialEnd: st === 'trial' ? '2026-10-' + String(3 + Math.floor(rnd() * 10)).padStart(2, '0') : null, pastDueSince: st === 'pastdue' ? '2026-09-23' : null, cancelledOn: st === 'cancelled' ? '2026-08-30' : null, created: st === 'trial' ? '2026-09-' + String(16 + Math.floor(rnd() * 10)) : created, sales, prevSales: Math.round(sales * (0.8 + rnd() * 0.35)), orders: Math.round(sales / (30 + rnd() * 30)), dom:{ host: custom ? code.replace(/-/g, '') + (ca ? '.ca' : '.com') : code + '.shops.northstar.com', custom, st:'live' }, usage:U(prod, 1 + Math.floor(rnd() * 3), 0, Math.round(rnd() * 80), Math.round(rnd() * 15)), people: 1 + Math.floor(rnd() * 4), card: st === 'trial' ? null : String(1000 + Math.floor(rnd() * 8999)) });
});
const STORES = { ns: NAMED.concat(GEN), kl: [] };
const MU = (id, n, e, s, role, supplier, status, last) => ({ id, n, e, s, role, supplier: supplier || null, status: status || 'active', last });
const USERS = { ns: [
  MU('anjali','Anjali Nair','anjali@juniperco.com','s1','Owner',null,'active','2026-09-28T14:02:00Z'), MU('danielc','Daniel Cho','daniel@juniperco.com','s1','Manager',null,'active','2026-09-28T16:40:00Z'), MU('farhan','Farhan Ali','farhan@loomcraft.com','s1','Supplier admin','Loomcraft','active','2026-09-25T13:20:00Z'),
  MU('jenna','Jenna Park','jenna@harborcoffee.co','s2','Owner',null,'active','2026-09-28T16:10:00Z'), MU('luis','Luis Ortega','luis@harborcoffee.co','s2','Staff',null,'active','2026-09-27T16:02:00Z'),
  MU('dale','Dale Kowalski','dale@redlinemoto.com','s3','Owner',null,'active','2026-09-24T18:00:00Z'), MU('beno','Ben Ortiz','ben@redlinemoto.com','s3','Staff',null,'suspended','2026-09-20T12:00:00Z'),
  MU('chloe','Chloé Tremblay','chloe@mapleandpine.ca','s4','Owner',null,'active','2026-09-27T22:10:00Z'), MU('hannah','Hannah Cole','hannah@northwindwool.ca','s4','Supplier admin','Northwind Wool','active','2026-09-28T16:31:00Z'),
  MU('marco','Marco Silva','marco@tidewatersurf.com','s5','Owner',null,'active','2026-09-28T17:50:00Z'),
  MU('hana','Hana Sato','hana@fieldnotepaper.com','s6','Owner',null,'active','2026-09-27T21:15:00Z'),
  MU('owen','Owen Price','owen@copperline.audio','s7','Owner',null,'active','2026-09-26T11:00:00Z'),
  MU('leah','Leah Morgan','leah@birchandbramble.ca','s8','Owner',null,'active','2026-09-28T15:20:00Z'),
  MU('priyar','Priya Raman','priya@oaklinehome.com','s11','Owner',null,'active','2026-09-28T13:45:00Z'), MU('mateo','Mateo Cruz','mateo@oaklinehome.com','s11','Manager',null,'invited',null),
  MU('samb','Sam Becker','sam@northforkoutfitters.com','s14','Owner',null,'active','2026-09-28T12:30:00Z'), MU('kofi','Kofi Mensah','kofi@trailmakers.com','s14','Supplier member','Trailmakers','active','2026-09-27T14:12:00Z'),
], kl: [] };
const TEAM = { ns: [
  { id:'maya', n:'Maya Chen', e:'maya@northstar.com', role:'owner', last:'2026-09-28T15:30:00Z', tfa:true },
  { id:'diego', n:'Diego Alvarez', e:'diego@northstar.com', role:'admin', last:'2026-09-27T21:02:00Z', tfa:true },
  { id:'priya', n:'Priya Nair', e:'priya@northstar.com', role:'support', last:'2026-09-28T14:15:00Z', tfa:true },
  { id:'sam', n:'Sam Ortega', e:'sam@northstar.com', role:'finance', last:'2026-09-26T16:40:00Z', tfa:true },
  { id:'alex', n:'Alex Kim', e:'alex@northstar.com', role:'readonly', last:'2026-09-22T10:05:00Z', tfa:false },
], kl: [
  { id:'jonas', n:'Jonas Weber', e:'jonas@kaufladen.de', role:'owner', last:'2026-09-28T15:00:00Z', tfa:true },
  { id:'petra', n:'Petra Lang', e:'petra@kaufladen.de', role:'admin', last:'2026-09-25T14:00:00Z', tfa:true },
] };
const PAYOUTS = [
  { id:'po-2026-09', month:'August 2026', gross:4261.40, fee:1549.00, adj:0, amount:2712.40, status:'paid', date:'2026-09-01', stores:78 },
  { id:'po-2026-08', month:'July 2026', gross:4108.20, fee:1492.00, adj:-38.00, amount:2578.20, status:'paid', date:'2026-08-01', stores:75, adjNote:'Refund to Summit Supply for a double charge' },
  { id:'po-2026-07', month:'June 2026', gross:3894.60, fee:1421.00, adj:0, amount:2473.60, status:'paid', date:'2026-07-01', stores:72 },
  { id:'po-2026-06', month:'May 2026', gross:3610.00, fee:1318.00, adj:0, amount:2292.00, status:'paid', date:'2026-06-01', stores:68 },
];
const NEXT_PAYOUT = { month:'September 2026', gross:3988.40, fee:1466.00, adj:0, amount:2522.40, status:'scheduled', date:'2026-10-01' };
const PAYMENTS = [
  { id:'pm1', s:'s1', t:'2026-09-01T06:00:00Z', amount:99, cur:'USD', status:'paid', card:'4417' },
  { id:'pm2', s:'s14', t:'2026-09-01T06:00:00Z', amount:99, cur:'USD', status:'paid', card:'4150' },
  { id:'pm3', s:'s4', t:'2026-09-02T06:00:00Z', amount:65, cur:'CAD', status:'paid', card:'7730' },
  { id:'pm4', s:'s5', t:'2026-09-19T06:00:00Z', amount:29, cur:'USD', status:'failed', card:'1881', why:'Card declined', retry:'2026-09-30T06:00:00Z', tries:3 },
  { id:'pm5', s:'s13', t:'2026-09-25T06:00:00Z', amount:49, cur:'USD', status:'failed', card:'2210', why:'Card expired', retry:'2026-09-29T06:00:00Z', tries:1 },
  { id:'pm6', s:'s9', t:'2026-09-09T06:00:00Z', amount:65, cur:'CAD', status:'paid', card:'8812' },
  { id:'pm7', s:'s11', t:'2026-09-30T06:00:00Z', amount:49, cur:'USD', status:'recovered', card:'9902', why:'Retried after insufficient funds' },
  { id:'pm8', s:'s8', t:'2026-09-22T06:00:00Z', amount:39, cur:'CAD', status:'paid', card:'3004' },
  { id:'pm9', s:'s10', t:'2026-08-12T06:00:00Z', amount:29, cur:'USD', status:'refunded', card:'6621', why:'Charged twice in August' },
  { id:'pm10', s:'s7', t:'2026-09-05T06:00:00Z', amount:99, cur:'USD', status:'paid', card:'5520' },
];
const DFINV = [
  { id:'DF-INV-2026-0918', date:'2026-09-01', what:'Priority partner support, September 2026', amount:150.00, tax:0, status:'paid' },
  { id:'DF-INV-2026-0817', date:'2026-08-01', what:'Priority partner support, August 2026', amount:150.00, tax:0, status:'paid' },
  { id:'DF-INV-2026-0716', date:'2026-07-01', what:'Priority partner support, July 2026 · 2 extra custom-domain certificates', amount:190.00, tax:0, status:'paid' },
];
const DOMAINS = {
  ns: [
    { k:'portal', label:'Merchant portal', host:'store.northstar.com', what:'Where your merchants sign in and build their shops.', st:'live', recs:[['CNAME','store','portal.edge.dripfunnel.net','portal.edge.dripfunnel.net','Points your portal address at DripFunnel.']] },
    { k:'preview', label:'Preview address, all stores', host:'*.preview.northstar.com', what:'Each store’s private preview before it publishes.', st:'live', recs:[['CNAME','*.preview','preview.edge.dripfunnel.net','preview.edge.dripfunnel.net','Sends every preview address to DripFunnel.']] },
    { k:'shop', label:'Shop address, all stores', host:'*.shops.northstar.com', what:'Every store’s shop address until it connects its own domain.', st:'live', recs:[['CNAME','*.shops','shops.edge.dripfunnel.net','shops.edge.dripfunnel.net','Sends every shop address to DripFunnel.']] },
    { k:'mail', label:'Email sender', host:'mail.northstar.com', what:'Emails to your merchants and their suppliers come from here.', st:'live', recs:[['TXT','mail','v=spf1 include:spf.dripfunnel.net ~all','v=spf1 include:spf.dripfunnel.net ~all','SPF: lets DripFunnel send email for this address.'],['CNAME','df1._domainkey.mail','df1.dkim.dripfunnel.net','df1.dkim.dripfunnel.net','DKIM: signs every email so inboxes trust it.'],['TXT','_dmarc.mail','v=DMARC1; p=quarantine; rua=mailto:dmarc@northstar.com','v=DMARC1; p=quarantine; rua=mailto:dmarc@northstar.com','DMARC: tells inboxes what to do with fakes.']] },
  ],
  kl: [
    { k:'portal', label:'Merchant portal', host:'shop.kaufladen.de', what:'Where your merchants sign in and build their shops.', st:'live', recs:[['CNAME','shop','portal.edge.dripfunnel.net','portal.edge.dripfunnel.net','Points your portal address at DripFunnel.']] },
    { k:'preview', label:'Preview address, all stores', host:'*.vorschau.kaufladen.de', what:'Each store’s private preview before it publishes.', st:'issuing', recs:[['CNAME','*.vorschau','preview.edge.dripfunnel.net','preview.edge.dripfunnel.net','Sends every preview address to DripFunnel.']] },
    { k:'shop', label:'Shop address, all stores', host:'*.shops.kaufladen.de', what:'Every store’s shop address until it connects its own domain.', st:'live', recs:[['CNAME','*.shops','shops.edge.dripfunnel.net','shops.edge.dripfunnel.net','Sends every shop address to DripFunnel.']] },
    { k:'mail', label:'Email sender', host:'mail.kaufladen.de', what:'Emails to your merchants and their suppliers come from here.', st:'waiting', since:'2026-09-24', fallback:'no-reply@kaufladen.dripfunnel-mail.com', recs:[['TXT','mail','v=spf1 include:spf.dripfunnel.net ~all',null,'SPF: lets DripFunnel send email for this address.'],['CNAME','df1._domainkey.mail','df1.dkim.dripfunnel.net',null,'DKIM: signs every email so inboxes trust it.'],['TXT','_dmarc.mail','v=DMARC1; p=quarantine','v=DMARC1; p=none','DMARC: tells inboxes what to do with fakes.']] },
  ],
};
const EMAILS = [
  ['verify','Verification code','Your {product name} code: {code}','Here’s your code','Enter this code to confirm your email address. It works for 10 minutes.'],
  ['invite','Invitation','{inviter name} invited you to {store name}','You’re invited','{inviter name} added you to {store name} on {product name}. Set your password to get started.'],
  ['reset','Password reset','Reset your {product name} password','Reset your password','Someone asked to reset the password for {email}. If it was you, choose a new one below.'],
  ['trial','Trial ending','Your {store name} trial ends in {days left} days','Your trial is ending','Pick a plan to keep {store name} open. Your products and settings stay as they are.'],
  ['failed','Payment failed','We couldn’t take payment for {store name}','Payment didn’t go through','We tried to charge your card ending {card last 4}. Update it to avoid interruptions.'],
  ['suspended','Store suspended','{store name} is suspended','Your store is suspended','{store name} can’t take orders right now. Contact {support email} to fix this.'],
  ['receipt','Receipt','Your {product name} receipt for {month}','Thanks for your payment','We charged {amount} for {plan name}. Keep this email for your records.'],
];
const BRAND_HIST = { ns: [
  { id:'bh0', t:'2026-11-01T00:00:00-08:00', who:'Maya Chen', what:'Switch to the new logo (winter refresh)', scheduled:true },
  { id:'bh1', t:'2026-09-12T15:04:00Z', who:'Diego Alvarez', what:'Changed the accent colour', before:'#D9B98A', after:'#E8C9A0' },
  { id:'bh2', t:'2026-08-20T10:12:00Z', who:'Maya Chen', what:'Turned off “Powered by DripFunnel”', before:'On', after:'Off' },
  { id:'bh3', t:'2026-07-02T09:30:00Z', who:'Maya Chen', what:'Changed the “Trial ending” email subject', before:'Your trial ends soon', after:'Your {store name} trial ends in {days left} days' },
  { id:'bh4', t:'2025-03-20T18:00:00Z', who:'Maya Chen', what:'First branding published' },
], kl: [ { id:'bk1', t:'2026-09-10T11:00:00Z', who:'Jonas Weber', what:'First branding saved' } ] };
const ACT = (id, t, who, action, text, o) => ({ id, t, who, action, text, res:'success', ...(o || {}) });
const ACTIVITY = { ns: [
  ACT('a1','2026-09-28T17:41:00Z','priya','Support','Priya (Northstar support) as Jenna Park opened Harbor Coffee Co.’s settings',{ s:'s2', kind:'Support session' }),
  ACT('a2','2026-09-28T17:34:00Z','priya','Support','Support session started: Priya as Jenna Park (Owner, Harbor Coffee Co.)',{ s:'s2', kind:'Support session', reason:'Checkout button missing on mobile' }),
  ACT('a3','2026-09-28T17:12:00Z',null,'Setup','Setup for Fieldnote Paper has been on “Storefront building” for 43 minutes',{ s:'s6', res:'failed', whoN:'System', kind:'Account event' }),
  ACT('a4','2026-09-28T16:20:00Z','diego','Trial','Diego extended Lumen Candle Co.’s trial to 4 Oct: customer request',{ s:'s12', before:'Ends 30 Sep', after:'Ends 4 Oct', reason:'Customer request: waiting on product photos', kind:'Team' }),
  ACT('a5','2026-09-28T15:30:00Z','maya','Plan change','Maya changed Growth’s monthly price for new signups',{ before:'$45.00 / month', after:'$49.00 / month', reason:'Price review for Q4', kind:'Team' }),
  ACT('a6','2026-09-28T13:12:00Z','sam','Sign-in','Sam tried to change a plan’s entitlements',{ res:'denied', reason:'Finance can change prices only.', kind:'Team' }),
  ACT('a7','2026-09-27T18:12:00Z','priya','Invitation','Priya resent the owner invitation for Oakline Home’s manager',{ s:'s11', kind:'Team' }),
  ACT('a8','2026-09-27T15:02:00Z',null,'DripFunnel','DripFunnel Support (Neha) updated your payout bank verification',{ whoN:'DripFunnel staff', kind:'DripFunnel staff', before:'Pending', after:'Verified' }),
  ACT('a9','2026-09-26T09:00:00Z',null,'Domain','DNS check: shop.mapleandpine.ca is still waiting for DNS',{ s:'s4', res:'failed', whoN:'System', kind:'Account event' }),
  ACT('a10','2026-09-25T06:00:00Z',null,'Payment','Bayside Pets’ payment of $49.00 failed: card expired',{ s:'s13', res:'failed', whoN:'System', kind:'Account event' }),
  ACT('a11','2026-09-24T14:05:00Z','maya','Suspend','Maya suspended Redline Moto Parts: chargebacks',{ s:'s3', before:'Active', after:'Suspended', reason:'Chargebacks on 3 orders ($2,840). Card network notice CB-2291.', kind:'Team' }),
  ACT('a12','2026-09-19T06:00:00Z',null,'Payment','Tidewater Surf moved to Past due after a failed payment',{ s:'s5', whoN:'System', before:'Active', after:'Past due', kind:'Account event' }),
  ACT('a13','2026-09-15T12:30:00Z',null,'Setup','Harbor Coffee Co. signed up at store.northstar.com and started a 14-day trial',{ s:'s2', whoN:'System', kind:'Account event' }),
  ACT('a14','2026-09-12T15:04:00Z','diego','Branding','Diego changed the accent colour of Northstar Shops',{ before:'#D9B98A', after:'#E8C9A0', kind:'Team' }),
  ACT('a15','2026-09-02T11:00:00Z','diego','Limit override','Diego gave Juniper & Co. +10 publishes this month',{ s:'s1', reason:'Holiday launches', kind:'Team' }),
  ACT('a16','2026-09-02T09:00:00Z',null,'Cancel','Summit Supply cancelled its subscription',{ s:'s10', whoN:'Grace Liu (owner)', before:'Active', after:'Cancelled', kind:'Account event' }),
  ACT('a17','2026-09-01T06:10:00Z',null,'Payout','DripFunnel paid you $2,712.40 for August 2026',{ whoN:'DripFunnel', kind:'Account event' }),
], kl: [
  ACT('k9','2026-09-27T10:30:00Z',null,'Setup session','Setup session ended (by staff): Priya (DripFunnel)',{ whoN:'Priya Shah (DripFunnel)', kind:'DripFunnel setup', setup:true }),
  ACT('k8','2026-09-27T09:52:00Z',null,'Domain','Priya added the preview and shop addresses',{ whoN:'Priya Shah (DripFunnel)', kind:'DripFunnel setup', setup:true }),
  ACT('k7','2026-09-27T09:40:00Z',null,'Domain','Priya added the portal address shop.kaufladen.de',{ whoN:'Priya Shah (DripFunnel)', kind:'DripFunnel setup', setup:true }),
  ACT('k6','2026-09-27T09:18:00Z',null,'Company','Priya filled in the company details',{ whoN:'Priya Shah (DripFunnel)', kind:'DripFunnel setup', setup:true }),
  ACT('k5','2026-09-27T09:10:00Z',null,'Setup session','Setup session started: Priya (DripFunnel)',{ whoN:'Priya Shah (DripFunnel)', kind:'DripFunnel setup', setup:true }),
  ACT('k1','2026-09-24T10:00:00Z','jonas','Domain','Jonas added the email sender mail.kaufladen.de',{ kind:'Team' }),
  ACT('k2','2026-09-22T16:20:00Z',null,'Approval','DripFunnel sent Kaufladen Digital back to Draft: legal pages missing an Impressum',{ whoN:'DripFunnel staff (Maya O.)', kind:'DripFunnel staff' }),
  ACT('k3','2026-09-10T11:00:00Z',null,'Branding','Priya saved the first branding for Kaufladen Shops',{ whoN:'Priya Shah (DripFunnel)', kind:'DripFunnel setup', setup:true }),
] };
const SESSIONS = { ns: [
  { id:'ss1', staffId:'priya', staff:'Priya Nair', user:'jenna', s:'s2', reason:'Checkout button missing on mobile', ticket:'https://help.northstar.com/t/2291', start:'2026-09-28T17:36:00Z', open:true },
  { id:'ss2', staffId:'diego', staff:'Diego Alvarez', user:'anjali', s:'s1', reason:'Size chart not showing on kurtas', ticket:'', start:'2026-09-21T11:10:00Z', open:false, ended:'2026-09-21T11:24:00Z', how:'Ended by staff' },
  { id:'ss3', staffId:'priya', staff:'Priya Nair', user:'marco', s:'s5', reason:'Help updating card after failed payment', ticket:'https://help.northstar.com/t/2240', start:'2026-09-20T09:00:00Z', open:false, ended:'2026-09-20T09:30:00Z', how:'Expired' },
], kl: [] };
const TREND = { signups:[18,21,19,24,27,31], newStores:[12,14,13,17,19,22], conv:[27,29,28,31,29,34], churn:[2,1,3,2,2,3], net:[62,68,72,75,78,86], collected:[3180,3610,3894,4108,4261,3988], fee:[1180,1318,1421,1492,1549,1466], payout:[2000,2292,2473,2578,2712,2522], months:['Apr','May','Jun','Jul','Aug','Sep'] };
window.PC = { PARTNERS, ENT, DFMAX, PLANS, STORES, USERS, TEAM, PAYOUTS, NEXT_PAYOUT, PAYMENTS, DFINV, DOMAINS, EMAILS, BRAND_HIST, ACTIVITY, SESSIONS, TREND };
})();
