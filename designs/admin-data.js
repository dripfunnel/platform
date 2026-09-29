(function () {
const E = 'edge.dripfunnel.net';
const dm = (k, host, rec, exp, st, found) => ({ k, host, rec, exp, st, found: found || (st === 'waiting' ? 'Nothing found yet' : exp) });
const doms = (base, portal, o) => { o = o || {}; return [dm('Portal host', portal, 'CNAME', 'portal.' + E, o.portal || 'live'), dm('Preview wildcard', '*.preview.' + base, 'CNAME', 'preview.' + E, o.preview || 'live'), dm('Shop wildcard', '*.shops.' + base, 'CNAME', 'shops.' + E, o.shops || 'live'), dm('Email sender domain', 'mail.' + base, 'TXT', 'v=spf1 include:mail.dripfunnel.net ~all', o.mail || 'live'), ...(o.extra || [])]; };
const PL = (n, price, cur, lim, stores) => ({ n, price, cur, lim, stores });
const TM = (n, e, role, last) => ({ n, e, role, last });
const PARTNERS = [
 { id:'df', name:'DripFunnel', house:true, kind:'House partner', region:'Global', country:'India', state:'live', host:'store.dripfunnel.com', owner:['Ravi Kapoor','ravi@dripfunnel.com'], created:'2024-02-03', stores:1240, newWeek:38, color:'#EC844F', ink:'#4A1B0C', accent:'#0A2A4A', product:'DripFunnel', powered:null, setup:[1,1,1,1,1,1,1,1], inv:'active', legal:true, test:true, sign:[41,38,1], median:'5 min 50 s',
  domains: doms('dripfunnel.com','store.dripfunnel.com'), contacts:[['Ravi Kapoor','Owner','ravi@dripfunnel.com'],['Arjun Menon','Platform lead','arjun@dripfunnel.com']],
  plans:[PL('Starter (Free)',0,'USD','10 products · owner only',402),PL('Growth',29,'USD','100 products · 2 staff',511),PL('Growth Pro',79,'USD','5,000 products · 5 staff',244),PL('Business',149,'USD','Unlimited products · 15 staff',83)],

  hist:[['2024-02-03','Created as the house partner'],['2024-02-03','Live']] },
 { id:'ns', name:'Northstar Commerce', kind:'Agency', region:'US, Canada', country:'United States', state:'live', host:'store.northstar.com', owner:['Maya Chen','maya@northstar.com'], created:'2025-03-14', stores:86, newWeek:6, color:'#1B3A5B', ink:'#FFFFFF', accent:'#2BB673', product:'Northstar Stores', powered:true, setup:[1,1,1,1,1,1,1,1], inv:'active', legal:true, test:true, sign:[9,7,0], median:'6 min 20 s',
  domains: doms('northstar.com','store.northstar.com'), contacts:[['Maya Chen','Owner','maya@northstar.com'],['Diego Alvarez','Technical contact','diego@northstar.com']],
  plans:[PL('Launch',29,'USD','250 products · 1 staff',31),PL('Scale',79,'USD','2,000 products · 3 staff',42),PL('Pro',149,'USD','5,000 products · 10 staff',13)],

  hist:[['2025-03-14','Created as draft by Maya Ortiz'],['2025-03-19','Submitted for approval'],['2025-03-20','Approved by Arjun Menon: contract signed, KYC passed'],['2025-03-20','Live']] },
 { id:'bz', name:'Bazaar Cloud', short:'Bazaar Cloud', kind:'Reseller', region:'India, UAE', country:'India', state:'live', host:'portal.bazaarcloud.in', owner:['Vikram Rao','vikram@bazaarcloud.in'], created:'2025-01-22', stores:312, newWeek:21, color:'#0F6E5C', ink:'#FFFFFF', accent:'#F2B134', product:'Bazaar Cloud Commerce', powered:false, setup:[1,1,1,1,1,1,1,1], inv:'active', legal:true, test:true, sign:[23,22,1], median:'7 min 05 s',
  domains: doms('bazaarcloud.in','portal.bazaarcloud.in',{extra:[dm('Shop wildcard (UAE)','*.shops.bazaarcloud.ae','CNAME','shops.'+E,'fail','shops-old.bzhost.ae')]}), contacts:[['Vikram Rao','Owner','vikram@bazaarcloud.in'],['Sana Qureshi','UAE lead','sana@bazaarcloud.ae']],
  plans:[PL('Starter',1499,'INR','250 products · 1 staff',120),PL('Growth',4999,'INR','2,000 products · 3 staff',96),PL('Pro',9999,'INR','Unlimited products · 10 staff',31),PL('Starter UAE',69,'AED','250 products · 1 staff',29),PL('Growth UAE',219,'AED','2,000 products · 3 staff',26),PL('Pro UAE',549,'AED','Unlimited products · 10 staff',10)],

  hist:[['2025-01-22','Created as draft by Maya Ortiz'],['2025-01-30','Submitted for approval'],['2025-02-03','Approved by Arjun Menon: contract signed, KYC passed'],['2025-02-03','Live']] },
 { id:'kl', name:'Kaufladen Digital', kind:'Payments company', region:'Germany, Austria', country:'Germany', state:'awaiting', submitted:'2026-09-26T09:40:00Z', reviewer:'Maya Ortiz', host:'shop.kaufladen.de', owner:['Jonas Weber','jonas@kaufladen.de'], created:'2026-09-08', stores:40, newWeek:0, color:'#2A2F8F', ink:'#FFFFFF', accent:'#FFCC00', product:'Kaufladen Shop', powered:true, setup:[1,1,1,1,'w',1,1,0], inv:'active', short:'Kaufladen', by:{2:['Priya','DripFunnel'],5:['Priya','DripFunnel']}, legal:true, test:true, sign:[0,0,0], median:'—',
  domains: doms('kaufladen.de','shop.kaufladen.de',{mail:'waiting'}), contacts:[['Jonas Weber','Owner','jonas@kaufladen.de'],['Petra Lang','Legal','petra@kaufladen.de']],
  plans:[PL('Basis',25,'EUR','500 products · 2 staff',24),PL('Plus',69,'EUR','5,000 products · 5 staff',16),PL('Enterprise (draft)',null,'EUR','Limits not set',0)],

  hist:[['2026-09-08','Created as draft by Maya Ortiz'],['2026-09-15','Setup session by Priya Shah (DripFunnel): branding, plans'],['2026-09-19','Submitted for approval'],['2026-09-22','Sent back by Maya Ortiz: legal pages missing an Impressum'],['2026-09-26','Submitted again']] },
 { id:'lt', name:'Loom & Thread', short:'Loom & Thread', kind:'Marketplace operator', region:'UK', country:'United Kingdom', state:'live', host:'sellers.loomandthread.co.uk', owner:['Olivia Grant','olivia@loomandthread.co.uk'], created:'2025-09-12', stores:1, newWeek:0, color:'#5B3A29', ink:'#FFFFFF', accent:'#D9A441', product:'Loom & Thread Sellers', powered:true, setup:[1,1,1,1,1,1,1,1], inv:'active', legal:true, test:true, sign:[0,0,0], median:'—',
  domains: doms('loomandthread.co.uk','sellers.loomandthread.co.uk'), contacts:[['Olivia Grant','Owner','olivia@loomandthread.co.uk']],
  plans:[PL('Marketplace',1200,'GBP','Unlimited products · up to 100 suppliers',1)],

  hist:[['2025-09-12','Created as draft by Maya Ortiz'],['2025-09-29','Approved by Arjun Menon: contract signed, KYC passed'],['2025-09-29','Live']] },
 { id:'ts', name:'Tallis Studio', kind:'Agency', region:'Australia', country:'Australia', state:'draft', host:'shops.tallis.studio', owner:['Ben Tallis','ben@tallis.studio'], created:'2026-09-25', stores:0, newWeek:0, color:'#3D5A40', ink:'#FFFFFF', accent:'#E3B23C', product:'Tallis Shops', powered:true, setup:[1,'w',0,0,0,0,0,0], inv:'sent', invSent:'2026-09-25T11:03:00Z', legal:false, test:false, sign:[0,0,0], median:'—',
  domains: doms('tallis.studio','shops.tallis.studio',{portal:'waiting',preview:'waiting',shops:'waiting',mail:'waiting'}), contacts:[['Ben Tallis','Owner (invited)','ben@tallis.studio']], plans:[],
  hist:[['2026-09-25','Created as draft by Maya Ortiz. Owner invited']] },
 { id:'nl', name:'Nordlicht Media', short:'Nordlicht', kind:'Agency', region:'Sweden, Norway', country:'Sweden', state:'draft', inv:'held', host:'shops.nordlicht.media', owner:['Freya Lind','freya@nordlicht.media'], created:'2026-09-23', stores:0, newWeek:0, color:'#3B2F63', ink:'#FFFFFF', accent:'#7FD1C7', product:'Nordlicht Shops', powered:true, setup:[1,0,1,1,'w',0,0,0], by:{0:['Priya','DripFunnel'],2:['Priya','DripFunnel'],3:['Priya','DripFunnel'],4:['Priya','DripFunnel']}, legal:false, test:false, sign:[0,0,0], median:'—',
  domains: doms('nordlicht.media','shops.nordlicht.media',{preview:'waiting',shops:'waiting',mail:'waiting'}), contacts:[['Freya Lind','Owner (invitation held)','freya@nordlicht.media']], plans:[],
  hist:[['2026-09-23','Created as draft by Priya Shah. Owner invitation held'],['2026-09-24','Setup session by Priya Shah (DripFunnel): company details, branding, portal host, email domain']] },
];
const ST = o => ({ support:true, suppliers:0, setup:'done', sf:'ai-live', people:[1,1,2], ver:'v12', build:'2026-09-26T11:20:00Z', pub:'2026-09-26T11:32:00Z', hist:[], ...o });
const STORES = [
 ST({ id:'s1', name:'Mehta Textiles', code:'mehta-textiles', p:'bz', owner:['Priya Mehta','priya@mehtatextiles.in'], country:'India', plan:'Growth', price:4999, cur:'INR', status:'active', dom:{host:'mehtatextiles.in', custom:true, st:'live'}, created:'2025-06-11', people:[1,2,6], suppliers:3, products:1284, orders:9412, ver:'v48', build:'2026-09-28T09:12:00Z', pub:'2026-09-28T09:20:00Z', hist:[['2025-06-11','Trial started on Growth'],['2025-06-21','Active on Growth']] }),
 ST({ id:'s2', name:'Harbor Coffee Co.', code:'harbor-coffee', p:'ns', owner:['Jenna Park','jenna@harborcoffee.co'], country:'United States', plan:'Scale', price:79, cur:'USD', status:'trial', days:1, trialEnd:'2026-09-29', dom:{host:'harbor-coffee.shops.northstar.com', custom:false, st:'live'}, created:'2026-09-15', people:[1,0,1], products:54, orders:17, ver:'v6', hist:[['2026-09-15','Trial started on Scale']] }),
 ST({ id:'s3', name:'Kiko Kids', code:'kiko-kids', p:'bz', owner:['Fatima Al Nuaimi','fatima@kikokids.ae'], country:'UAE', plan:'Growth UAE', price:219, cur:'AED', status:'pastdue', days:9, dom:{host:'kikokids.ae', custom:true, st:'live'}, created:'2025-11-02', people:[1,1,3], products:612, orders:3318, ver:'v21', hist:[['2025-11-02','Trial started'],['2025-11-12','Active on Growth UAE'],['2026-09-19','Past due after 3 failed payments']] }),
 ST({ id:'s4', name:'Redline Moto Parts', code:'redline-moto', p:'ns', owner:['Dale Kowalski','dale@redlinemoto.com'], country:'United States', plan:'Pro', price:149, cur:'USD', status:'suspended', reason:'Chargeback', susBy:'Arjun Menon', dom:{host:'redline-moto.shops.northstar.com', custom:false, st:'live'}, created:'2025-08-19', products:2210, orders:5871, ver:'v33', hist:[['2025-08-19','Trial started'],['2025-08-29','Active on Pro'],['2026-09-24','Suspended by Arjun Menon: chargeback']] }),
 ST({ id:'s5', name:'Fjord Outdoor', code:'fjord-outdoor', p:'df', owner:['Ingrid Solberg','ingrid@fjordoutdoor.no'], country:'Norway', plan:'Growth', price:29, cur:'USD', status:'trial', days:10, trialEnd:'2026-10-08', sf:'ai-building', dom:{host:'fjord-outdoor.shops.dripfunnel.com', custom:false, st:'live'}, created:'2026-09-28', people:[1,0,0], products:0, orders:0, ver:'—', build:null, pub:null, setup:{at:5, st:'stuck', started:'2026-09-28T10:04:00Z', attempts:2, err:'The first storefront build has been running for 48 minutes. It usually takes under 5.', raw:'build bld_7Qx2 state=running runner=eu-2 last_heartbeat=10:39:12Z last_log="Installing theme dependencies"'}, hist:[['2026-09-28','Trial started on Growth']] }),
 ST({ id:'s6', name:'Maple & Pine Home', code:'maple-pine', p:'ns', owner:['Chloé Tremblay','chloe@mapleandpine.ca'], country:'Canada', plan:'Scale', price:79, cur:'USD', status:'active', dom:{host:'shop.mapleandpine.ca', custom:true, st:'waiting'}, created:'2026-04-03', people:[1,1,1], products:388, orders:1204, ver:'v17', hist:[['2026-04-03','Trial started'],['2026-04-13','Active on Scale']] }),
 ST({ id:'s7', name:'Atelier Nove', code:'atelier-nove', p:'df', owner:['Giulia Conti','giulia@ateliernove.it'], country:'Italy', plan:'Growth Pro', price:79, cur:'USD', status:'active', sf:'own', support:false, dom:{host:'ateliernove.it', custom:true, st:'live'}, created:'2025-12-09', people:[1,0,2], products:146, orders:902, ver:'—', build:null, pub:null, hist:[['2025-12-09','Trial started'],['2025-12-19','Active on Growth Pro']] }),
 ST({ id:'s8', name:'Loom & Thread', code:'loom-thread', p:'lt', owner:['Olivia Grant','olivia@loomandthread.co.uk'], country:'United Kingdom', plan:'Marketplace', price:1200, cur:'GBP', status:'active', suppliers:64, dom:{host:'loomandthread.co.uk', custom:true, st:'live'}, created:'2025-10-01', people:[1,4,22], products:18450, orders:61208, ver:'v112', hist:[['2025-10-01','Active on Marketplace']] }),
 ST({ id:'s9', name:'Saffron Street', code:'saffron-street', p:'bz', owner:['Kavya Iyer','kavya@saffronstreet.in'], country:'India', plan:'Starter', price:1499, cur:'INR', status:'active', dom:{host:'saffron-street.shops.bazaarcloud.in', custom:false, st:'live'}, created:'2026-09-23', people:[1,0,1], products:88, orders:41, ver:'v3', hist:[['2026-09-23','Active on Starter']] }),
 ST({ id:'s10', name:'Brightside Pets', code:'brightside-pets', p:'df', owner:['Tanya Brooks','tanya@brightsidepets.com'], country:'United States', plan:'Growth', price:29, cur:'USD', status:'cancelled', cancelled:'2026-09-02', dom:{host:'brightside-pets.shops.dripfunnel.com', custom:false, st:'live'}, created:'2025-05-20', people:[1,0,0], products:73, orders:655, ver:'v9', hist:[['2025-05-20','Trial started'],['2025-05-30','Active on Growth'],['2026-09-02','Cancelled by the owner']] }),
 ST({ id:'s11', name:'Oud House', code:'oud-house', p:'bz', owner:['Khalid Rahman','khalid@oudhouse.ae'], country:'UAE', plan:'Pro UAE', price:549, cur:'AED', status:'active', dom:{host:'oudhouse.ae', custom:true, st:'live'}, created:'2026-02-14', people:[1,1,4], products:204, orders:2890, ver:'v27', hist:[['2026-02-14','Trial started'],['2026-02-24','Active on Pro UAE']] }),
 ST({ id:'s12', name:'Grünwerk', code:'gruenwerk', p:'kl', owner:['Lea Braun','lea@gruenwerk.de'], country:'Germany', plan:'Plus', price:69, cur:'EUR', status:'trial', days:8, trialEnd:'2026-10-06', dom:{host:'gruenwerk.shops.kaufladen.de', custom:false, st:'live'}, created:'2026-09-26', people:[1,0,0], products:12, orders:0, ver:'v2', hist:[['2026-09-26','Trial started on Plus']] }),
 ST({ id:'s13', name:'Peak Supply Co.', code:'peak-supply', p:'df', owner:['Owen Hart','owen@peaksupply.com'], country:'United States', plan:'Growth', price:29, cur:'USD', status:'trial', days:10, trialEnd:'2026-10-08', sf:'ai-failed', dom:{host:'peak-supply.shops.dripfunnel.com', custom:false, st:'live'}, created:'2026-09-28', people:[1,0,0], products:0, orders:0, ver:'—', build:null, pub:null, setup:{at:4, st:'failed', started:'2026-09-28T09:12:00Z', attempts:2, err:'GitHub didn’t respond while creating the storefront.', raw:'POST https://api.github.com/orgs/df-shops/repos → 502 Bad Gateway after 30s (request 9C1E:4A2B:1F0E)'}, hist:[['2026-09-28','Trial started on Growth']] }),
 ST({ id:'s14', name:'Tidewater Surf', code:'tidewater-surf', p:'ns', owner:['Marco Silva','marco@tidewatersurf.com'], country:'United States', plan:'Launch', price:29, cur:'USD', status:'trial', days:10, trialEnd:'2026-10-08', sf:'ai-building', dom:{host:'tidewater-surf.shops.northstar.com', custom:false, st:'waiting'}, created:'2026-09-28', people:[1,0,0], products:0, orders:0, ver:'—', build:null, pub:null, setup:{at:3, st:'running', started:'2026-09-28T10:50:00Z', attempts:1, err:'', raw:''}, hist:[['2026-09-28','Trial started on Launch']] }),
 ST({ id:'s15', name:'Juniper & Co.', code:'juniper-co', p:'ns', owner:['Anjali Nair','anjali@juniperco.com'], country:'United States', plan:'Pro', price:149, cur:'USD', status:'active', suppliers:4, dom:{host:'juniperco.com', custom:true, st:'live'}, created:'2025-12-01', people:[1,1,3], products:2140, orders:7730, ver:'v31', hist:[['2025-12-01','Trial started'],['2025-12-11','Active on Pro']] }),
];
const STAFF = [
 { id:'arjun', n:'Arjun Menon', e:'arjun@dripfunnel.com', role:'super', last:'2026-09-28T09:02:00Z', tfa:true },
 { id:'maya', n:'Maya Ortiz', e:'maya@dripfunnel.com', role:'pm', last:'2026-09-28T08:40:00Z', tfa:true },
 { id:'neha', n:'Neha Rao', e:'neha@dripfunnel.com', role:'support', last:'2026-09-28T08:05:00Z', tfa:true },
 { id:'lena', n:'Lena Fischer', e:'lena@dripfunnel.com', role:'oncall', last:'2026-09-28T07:55:00Z', tfa:true },
 { id:'tom', n:'Tom Becker', e:'tom@dripfunnel.com', role:'finance', last:'2026-09-28T09:30:00Z', tfa:true },
 { id:'sam', n:'Sam Lee', e:'sam@dripfunnel.com', role:'readonly', last:'2026-09-21T11:00:00Z', tfa:false },
 { id:'priyas', n:'Priya Shah', e:'priya.shah@dripfunnel.com', role:'pm', last:'2026-09-28T08:12:00Z', tfa:true },
 { id:'kiran', n:'Kiran Das', e:'kiran@dripfunnel.com', role:'support', last:null, tfa:false, invited:true },
];
const MU = (id, n, e, kind, memb, status, last) => ({ id, n, e, kind, memb: memb.map(m => ({ p:m[0], s:m[1], role:m[2], supplier:m[3] || null })), status, last });
const USERS = [
 MU('mayachen','Maya Chen','maya@northstar.com','Partner user',[['ns',null,'Owner']],'active','2026-09-28T08:30:00Z'),
 MU('diego','Diego Alvarez','diego@northstar.com','Partner user',[['ns',null,'Admin']],'active','2026-09-27T21:02:00Z'),
 MU('jess','Jess Moreno','jess@northstar.com','Partner user',[['ns',null,'Support']],'active','2026-09-28T07:15:00Z'),
 MU('vikram','Vikram Rao','vikram@bazaarcloud.in','Partner user',[['bz',null,'Owner']],'active','2026-09-28T05:40:00Z'),
 MU('sana','Sana Qureshi','sana@bazaarcloud.ae','Partner user',[['bz',null,'Admin']],'active','2026-09-27T12:10:00Z'),
 MU('imran','Imran Sheikh','imran@bazaarcloud.in','Partner user',[['bz',null,'Support']],'active','2026-09-28T06:22:00Z'),
 MU('jonas','Jonas Weber','jonas@kaufladen.de','Partner user',[['kl',null,'Owner']],'active','2026-09-26T09:38:00Z'),
 MU('petra','Petra Lang','petra@kaufladen.de','Partner user',[['kl',null,'Admin']],'active','2026-09-25T14:00:00Z'),
 MU('olivia','Olivia Grant','olivia@loomandthread.co.uk','Partner user',[['lt',null,'Owner'],['lt','s8','Owner']],'active','2026-09-27T19:30:00Z'),
 MU('tomh','Tom Hayes','tom@loomandthread.co.uk','Partner user',[['lt',null,'Admin']],'active','2026-09-28T08:01:00Z'),
 MU('bent','Ben Tallis','ben@tallis.studio','Partner user',[['ts',null,'Owner']],'invited',null),
 MU('priya','Priya Mehta','priya@mehtatextiles.in','Store user',[['bz','s1','Owner'],['ns','s15','Supplier admin','Loomcraft']],'active','2026-09-28T08:52:00Z'),
 MU('rohan','Rohan Verma','rohan@mehtatextiles.in','Store user',[['bz','s1','Manager']],'active','2026-09-28T10:30:00Z'),
 MU('dev','Dev Patel','dev@mehtatextiles.in','Store user',[['bz','s1','Staff']],'active','2026-09-27T16:44:00Z'),
 MU('aisha','Aisha Khan','aisha@mehtatextiles.in','Store user',[['bz','s1','Staff']],'invited',null),
 MU('lakshmi','Lakshmi Iyer','lakshmi@kaveriweaves.in','Supplier user',[['bz','s1','Supplier admin','Kaveri Weaves']],'active','2026-09-26T10:05:00Z'),
 MU('anjali','Anjali Nair','anjali@juniperco.com','Store user',[['ns','s15','Owner']],'active','2026-09-28T07:02:00Z'),
 MU('farhan','Farhan Ali','farhan@loomcraft.in','Supplier user',[['ns','s15','Supplier member','Loomcraft']],'active','2026-09-25T13:20:00Z'),
 MU('jenna','Jenna Park','jenna@harborcoffee.co','Store user',[['ns','s2','Owner']],'active','2026-09-28T09:10:00Z'),
 MU('fatima','Fatima Al Nuaimi','fatima@kikokids.ae','Store user',[['bz','s3','Owner']],'active','2026-09-28T10:21:00Z'),
 MU('dale','Dale Kowalski','dale@redlinemoto.com','Store user',[['ns','s4','Owner']],'active','2026-09-24T18:00:00Z'),
 MU('beno','Ben Ortiz','ben@redlinemoto.com','Store user',[['ns','s4','Staff']],'suspended','2026-09-20T12:00:00Z'),
 MU('ingrid','Ingrid Solberg','ingrid@fjordoutdoor.no','Store user',[['df','s5','Owner']],'active','2026-09-28T10:00:00Z'),
 MU('chloe','Chloé Tremblay','chloe@mapleandpine.ca','Store user',[['ns','s6','Owner']],'active','2026-09-27T22:10:00Z'),
 MU('giulia','Giulia Conti','giulia@ateliernove.it','Store user',[['df','s7','Owner']],'active','2026-09-28T06:40:00Z'),
 MU('hannah','Hannah Cole','hannah@northwindwool.co.uk','Supplier user',[['lt','s8','Supplier admin','Northwind Wool']],'active','2026-09-28T09:31:00Z'),
 MU('kavya','Kavya Iyer','kavya@saffronstreet.in','Store user',[['bz','s9','Owner']],'active','2026-09-27T18:30:00Z'),
 MU('tanya','Tanya Brooks','tanya@brightsidepets.com','Store user',[['df','s10','Owner']],'active','2026-09-02T12:44:00Z'),
 MU('khalid','Khalid Rahman','khalid@oudhouse.ae','Store user',[['bz','s11','Owner']],'active','2026-09-28T04:15:00Z'),
 MU('lea','Lea Braun','lea@gruenwerk.de','Store user',[['kl','s12','Owner']],'active','2026-09-27T20:05:00Z'),
 MU('owen','Owen Hart','owen@peaksupply.com','Store user',[['df','s13','Owner']],'active','2026-09-28T09:12:00Z'),
 MU('marco','Marco Silva','marco@tidewatersurf.com','Store user',[['ns','s14','Owner']],'active','2026-09-28T10:50:00Z'),
];
const IMPS = [
 { id:'im1', staffId:'neha', staff:'Neha Rao', user:'rohan', p:'bz', s:'s1', role:'Manager', supplier:null, reason:'Can’t publish the Diwali collection', ticket:'https://support.dripfunnel.com/t/48240', start:'2026-09-28T10:34:00Z', open:true },
 { id:'im2', staffId:'arjun', staff:'Arjun Menon', user:'mayachen', p:'ns', s:null, role:'Owner', supplier:null, reason:'Scale plan price not showing on the signup page', ticket:'', start:'2026-09-27T15:00:00Z', open:false, ended:'2026-09-27T15:30:00Z', how:'Expired' },
 { id:'im3', staffId:'neha', staff:'Neha Rao', user:'priya', p:'bz', s:'s1', role:'Owner', supplier:null, reason:'Size chart not showing', ticket:'https://support.dripfunnel.com/t/48102', start:'2026-09-21T11:10:00Z', open:false, ended:'2026-09-21T11:24:00Z', how:'Ended by staff' },
];
const PEOPLE = {
 arjun:['Arjun Menon','arjun@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Super admin']]],
 maya:['Maya Ortiz','maya@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Partner manager']]],
 priyas:['Priya Shah','priya.shah@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Partner manager']]],
 neha:['Neha Rao','neha@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Support']]],
 lena:['Lena Fischer','lena@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Engineer on call']]],
 tom:['Tom Becker','tom@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Finance']]],
 sam:['Sam Lee','sam@dripfunnel.com','DripFunnel staff',[['DripFunnel staff','Read-only']]],
 aditi:['Aditi R.','Shopper account','Shopper',[['Mehta Textiles · Bazaar Cloud','Shopper']]],
 nskey:['Northstar production key','API key · created by Diego Alvarez','API key',[['Northstar Commerce','API key']]],
};
const A = (id, t, who, type, level, action, text, p, s, res, o) => ({ id, t, who, type, level, action, text, p, s, res, ...(o || {}) });
const IM1 = { imp:'im1', as:'rohan', reason:'Can’t publish the Diwali collection', ticket:'https://support.dripfunnel.com/t/48240' };
const IM2 = { imp:'im2', as:'mayachen', reason:'Scale plan price not showing on the signup page' };
const IM3 = { imp:'im3', as:'priya', reason:'Size chart not showing', ticket:'https://support.dripfunnel.com/t/48102' };
const SETUPS = [
 { id:'su1', staffId:'arjun', staff:'Arjun Menon', p:'ns', reason:'Ticket #48311: add the Pro Canada plan with Diego', start:'2026-09-28T10:04:00Z', open:true },
 { id:'su0', staffId:'priyas', staff:'Priya Shah', p:'nl', reason:'Onboarding call with Freya: company, branding and hosts', start:'2026-09-24T13:00:00Z', open:false, ended:'2026-09-24T14:05:00Z', how:'Ended by staff' },
 { id:'su2', staffId:'priyas', staff:'Priya Shah', p:'kl', reason:'Ticket #47920: Jonas asked for help with branding and plans', start:'2026-09-15T09:00:00Z', open:false, ended:'2026-09-15T10:10:00Z', how:'Ended by staff' },
];
const SU0 = { setup:'su0', reason:'Onboarding call with Freya: company, branding and hosts' }, SU1 = { setup:'su1', reason:'Ticket #48311: add the Pro Canada plan with Diego' }, SU2 = { setup:'su2', reason:'Ticket #47920: Jonas asked for help with branding and plans' };
const ACTIVITY = [
 A('u10','2026-09-28T10:04:00Z','arjun','Staff','Partner','Setup session','Setup session started: Arjun for Northstar Commerce','ns',null,'success',{ ...SU1, ip:'49.36.12.7' }),
 A('u11','2026-09-28T10:31:00Z','arjun','Staff','Partner','Plan change','Arjun added the Pro Canada plan (draft) for Northstar Commerce','ns',null,'success',{ ...SU1, after:'Pro Canada · CAD 199 / month · draft', ip:'49.36.12.7' }),
 A('u00','2026-09-23T15:20:00Z','priyas','Staff','Admin','Partner','Priya created Nordlicht Media as a draft and held the owner’s invitation','nl',null,'success',{ ip:'62.30.11.9' }),
 A('u01','2026-09-24T13:00:00Z','priyas','Staff','Partner','Setup session','Setup session started: Priya for Nordlicht Media','nl',null,'success',{ ...SU0, ip:'62.30.11.9' }),
 A('u02','2026-09-24T13:12:00Z','priyas','Staff','Partner','Setup','Priya filled in company details for Nordlicht Media','nl',null,'success',{ ...SU0, ip:'62.30.11.9' }),
 A('u03','2026-09-24T13:31:00Z','priyas','Staff','Partner','Setup','Priya set up branding: logo, colours and the product name “Nordlicht Shops”','nl',null,'success',{ ...SU0, ip:'62.30.11.9' }),
 A('u04','2026-09-24T13:48:00Z','priyas','Staff','Partner','Domain','Priya added the portal host shops.nordlicht.media','nl',null,'success',{ ...SU0, ip:'62.30.11.9' }),
 A('u05','2026-09-24T13:57:00Z','priyas','Staff','Partner','Domain','Priya added the email sender domain mail.nordlicht.media (waiting for DNS)','nl',null,'success',{ ...SU0, ip:'62.30.11.9' }),
 A('u06','2026-09-24T14:05:00Z','priyas','Staff','Partner','Setup session','Setup session ended (by staff): Priya for Nordlicht Media','nl',null,'success',{ ...SU0, ip:'62.30.11.9' }),
 A('u20','2026-09-15T09:00:00Z','priyas','Staff','Partner','Setup session','Setup session started: Priya for Kaufladen Digital','kl',null,'success',{ ...SU2, ip:'62.30.11.9' }),
 A('u21','2026-09-15T09:26:00Z','priyas','Staff','Partner','Setup','Priya set up branding for Kaufladen Digital','kl',null,'success',{ ...SU2, ip:'62.30.11.9' }),
 A('u22','2026-09-15T09:58:00Z','priyas','Staff','Partner','Plan change','Priya added the Basis and Plus plans for Kaufladen Digital','kl',null,'success',{ ...SU2, ip:'62.30.11.9' }),
 A('u23','2026-09-15T10:10:00Z','priyas','Staff','Partner','Setup session','Setup session ended (by staff): Priya for Kaufladen Digital','kl',null,'success',{ ...SU2, ip:'62.30.11.9' }),
 A('a0','2026-09-28T10:41:00Z','neha','Impersonation','Store','Products','Neha as Rohan Verma republished the Diwali collection','bz','s1','success',{ ...IM1, before:'Draft', after:'Published', ip:'103.21.44.9' }),
 A('a1','2026-09-28T10:34:00Z','neha','Impersonation','Store','Impersonation','Impersonation started: Neha as Rohan Verma (Manager, Mehta Textiles)','bz','s1','success',{ ...IM1, ip:'103.21.44.9' }),
 A('a2','2026-09-28T10:47:00Z',null,'System','System','Setup','Setup for Fjord Outdoor has been on “First build” for 43 minutes','df','s5','failed',{whoN:'System'}),
 A('a3','2026-09-28T10:41:30Z',null,'Unknown','Security','Sign-in','Sign-in blocked for olivia@loomandthread.co.uk after 5 wrong passwords','lt','s8','denied',{whoN:'Unknown',ip:'185.220.101.4'}),
 A('a4','2026-09-28T10:38:00Z','tom','Staff','Admin','Trial','Tom tried to extend the trial of Harbor Coffee Co.','ns','s2','denied',{ip:'82.132.8.40',reason:'Only a Super admin can extend a trial.'}),
 A('a6','2026-09-28T10:21:00Z','fatima','Merchant','Store','Payment','Fatima’s card payment of AED 219 for Kiko Kids failed: card declined','bz','s3','failed',{ip:'94.200.51.3'}),
 A('a7','2026-09-28T10:12:00Z','nskey','API key','Store','Products','Northstar production key created 12 products in Harbor Coffee Co.','ns','s2','success',{ip:'34.201.12.88'}),
 A('a8','2026-09-28T10:04:00Z','lena','Staff','Admin','Setup','Lena retried “First build” for Fjord Outdoor','df','s5','success',{ip:'88.130.4.19',before:'Failed',after:'Running'}),
 A('a9','2026-09-28T09:44:00Z','aditi','Shopper','Storefront','Account','A shopper (Aditi R.) created an account on Mehta Textiles','bz','s1','success'),
 A('a10','2026-09-28T09:31:00Z','hannah','Supplier','Store','Stock','Hannah (Northwind Wool) updated stock for 38 products in Loom & Thread','lt','s8','success',{ip:'81.2.69.160'}),
 A('a11','2026-09-28T09:20:00Z','priya','Merchant','Storefront','Publish','Priya published storefront version 48 of Mehta Textiles','bz','s1','success',{before:'Version 47',after:'Version 48',ip:'49.207.1.14'}),
 A('a12','2026-09-28T09:12:00Z',null,'System','System','Setup','Setup for Peak Supply Co. failed at “Repo”: GitHub didn’t respond','df','s13','failed',{whoN:'System'}),
 A('a13','2026-09-28T09:02:00Z','arjun','Staff','Security','Sign-in','Arjun signed in with Google Workspace and 2-factor',null,null,'success',{ip:'49.36.12.7'}),
 A('a14','2026-09-28T08:47:00Z',null,'System','System','Domain','DNS check: shop.mapleandpine.ca is still waiting for DNS','ns','s6','failed',{whoN:'System'}),
 A('a15','2026-09-28T08:30:00Z','mayachen','Partner user','Partner','Plan change','Maya Chen changed the Scale plan price for new stores','ns',null,'success',{before:'$69 / month',after:'$79 / month',ip:'73.92.14.201'}),
 A('a16','2026-09-28T07:55:00Z','lena','Staff','Security','Sign-in','Lena signed in with Google Workspace and 2-factor',null,null,'success',{ip:'88.130.4.19'}),
 A('a17','2026-09-28T06:12:00Z',null,'Unknown','Security','Sign-in','Admin console sign-in refused: account isn’t in the DripFunnel workspace',null,null,'denied',{whoN:'Unknown',ip:'102.89.3.7'}),
 A('a18','2026-09-27T18:12:00Z','neha','Staff','Admin','Invitation','Neha resent the owner invitation for Saffron Street','bz','s9','success',{ip:'103.21.44.9'}),
 A('a19','2026-09-27T15:30:00Z',null,'System','Partner','Impersonation','Impersonation ended (expired): Arjun as Maya Chen','ns',null,'success',{ ...IM2, whoN:'System' }),
 A('a19b','2026-09-27T15:12:00Z','arjun','Impersonation','Partner','Plan change','Arjun as Maya Chen republished the Scale plan so its price shows on the signup page','ns',null,'success',{ ...IM2, before:'Scale · hidden on signup', after:'Scale · shown on signup', ip:'49.36.12.7' }),
 A('a19c','2026-09-27T15:00:00Z','arjun','Impersonation','Partner','Impersonation','Impersonation started: Arjun as Maya Chen (Owner, Northstar Commerce)','ns',null,'success',{ ...IM2, ip:'49.36.12.7' }),
 A('a19d','2026-09-27T14:10:00Z',null,'API key','Security','Access','Blocked: API key “bz-legacy” used from a country it has never been used from','bz',null,'denied',{whoN:'bz-legacy key',ip:'91.108.4.22'}),
 A('a21','2026-09-26T09:40:00Z','jonas','Partner user','Partner','Approval','Jonas submitted Kaufladen Digital for approval','kl',null,'success',{ip:'84.160.2.77'}),
 A('a22','2026-09-25T11:03:00Z','maya','Staff','Admin','Partner','Maya created Tallis Studio as a draft and invited Ben Tallis','ts',null,'success',{ip:'62.30.11.5'}),
 A('a23','2026-09-24T14:05:00Z','arjun','Staff','Admin','Suspend','Arjun suspended Redline Moto Parts: chargeback','ns','s4','success',{before:'Active',after:'Suspended',reason:'Chargebacks on 3 orders ($2,840). Card network notice CB-2291.',ip:'49.36.12.7'}),
 A('a24','2026-09-22T16:20:00Z','maya','Staff','Admin','Approval','Maya sent Kaufladen Digital back to Draft: legal pages missing an Impressum','kl',null,'success',{before:'Awaiting approval',after:'Draft',reason:'Legal pages are missing an Impressum.',ip:'62.30.11.5'}),
 A('a24b','2026-09-21T11:24:00Z','neha','Impersonation','Store','Impersonation','Impersonation ended (by staff): Neha as Priya Mehta','bz','s1','success',{ ...IM3, ip:'103.21.44.9' }),
 A('a24c','2026-09-21T11:18:00Z','neha','Impersonation','Store','Products','Neha as Priya Mehta turned on the size chart for 24 kurtas','bz','s1','success',{ ...IM3, before:'Size chart off', after:'Size chart on', ip:'103.21.44.9' }),
 A('a24d','2026-09-21T11:10:00Z','neha','Impersonation','Store','Impersonation','Impersonation started: Neha as Priya Mehta (Owner, Mehta Textiles)','bz','s1','success',{ ...IM3, ip:'103.21.44.9' }),
 A('a25','2026-09-19T04:00:00Z',null,'System','System','Payment','Kiko Kids moved to Past due after 3 failed payments','bz','s3','success',{whoN:'System',before:'Active',after:'Past due'}),
 A('a26','2026-09-02T12:44:00Z','tanya','Merchant','Store','Cancel','Tanya cancelled Brightside Pets','df','s10','success',{before:'Active',after:'Cancelled',ip:'67.180.22.9'}),
];
const CU = (id, n, e, ph, s, via, status, orders, created, last, ev, pv, o) => ({ id, n, e, ph, s, via, status, orders, created, last, ev, pv, ...(o || {}) });
const CUSTOMERS = [
 CU('c1','Priya Sharma','priya.sharma@gmail.com','+91 98765 43210','s1','Mobile','active',12,'2026-03-03','2026-09-26T18:40:00Z',true,true),
 CU('c2','Priya Sharma','priya.sharma@gmail.com','+91 98765 43210','s9','Both','active',4,'2026-09-24','2026-09-27T09:15:00Z',true,true),
 CU('c3','Priya Sharma','priya.sharma@gmail.com',null,'s11','Email','active',1,'2026-05-19','2026-08-30T11:02:00Z',true,false),
 CU('c4','Daniel Brooks','daniel.brooks@outlook.com','+1 415 555 0182','s15','Email','unverified',3,'2026-07-08','2026-09-22T20:31:00Z',false,false),
 CU('c5',null,null,null,'s1','Email','deleted',7,'2025-09-14',null,false,false,{ deletedOn:'2026-08-12' }),
 CU('c6','Marcus Reid','marcus.reid@gmail.com','+1 312 555 0147','s4','Both','active',9,'2025-11-02','2026-09-23T16:05:00Z',true,true),
 CU('c7','Aditi Rao','aditi.rao@gmail.com','+91 99887 76655','s1','Email','active',0,'2026-09-28','2026-09-28T09:44:00Z',true,false),
 CU('c8','Sofia Lindqvist','sofia.l@icloud.com','+44 7700 900123','s8','Email','active',21,'2025-12-11','2026-09-27T21:48:00Z',true,false),
 CU('c9','Hamad Al Mansoori',null,'+971 50 123 4567','s3','Mobile','active',5,'2026-01-20','2026-09-25T13:10:00Z',false,true),
 CU('c10','Emily Chen','emily.chen@gmail.com','+1 206 555 0199','s2','Email','active',2,'2026-09-16','2026-09-27T15:20:00Z',true,false),
 CU('c11','Karan Singh',null,'+91 91234 56780','s1','Mobile','unverified',0,'2026-09-27','2026-09-27T07:30:00Z',false,false),
];
const SH = (id, t, c, whoN, action, text, p, s, res, o) => ({ id, t, who: null, whoN, type: 'Shopper', level: 'Storefront', action, text, p, s, res, cust: c, ...(o || {}) });
const CACT = [
 SH('ca1','2026-09-26T18:40:00Z','c1','Priya S.','Sign-in','Priya S. signed in with a one-time code','bz','s1','success',{ ip:'49.37.20.11' }),
 SH('ca2','2026-09-26T18:44:00Z','c1','Priya S.','Order','Priya S. placed order #1042','bz','s1','success'),
 SH('ca3','2026-09-20T10:02:00Z','c1','Priya S.','Address','Priya S. added a delivery address','bz','s1','success'),
 SH('ca4','2026-09-18T08:15:00Z','c1','Priya S.','Sign-in','Sign-in failed for Priya S.: wrong one-time code','bz','s1','failed',{ ip:'49.37.20.11' }),
 SH('ca5','2026-09-12T12:30:00Z','c1','Priya S.','Order','Priya S. cancelled order #1038','bz','s1','success'),
 SH('ca6','2026-09-24T19:00:00Z','c2','Priya S.','Account','Priya S. created an account on Saffron Street','bz','s9','success'),
 SH('ca7','2026-09-22T20:31:00Z','c4','Daniel B.','Sign-in','Daniel B. signed in with email and password','ns','s15','success',{ ip:'73.15.8.201' }),
 SH('ca8','2026-09-22T20:33:00Z','c4','Daniel B.','Contact change','Daniel B. changed his email address; the new one isn’t verified yet','ns','s15','success'),
 SH('ca9','2026-09-15T09:00:00Z','c4','Daniel B.','Password reset','Daniel B. reset his password','ns','s15','success'),
 SH('ca10','2026-08-12T06:00:00Z','c5','Deleted customer','Account','Personal data deleted at the customer’s request','bz','s1','success'),
 SH('ca11','2026-09-23T16:05:00Z','c6','Marcus R.','Sign-in','Marcus R. signed in with a one-time code','ns','s4','success'),
 SH('ca12','2026-09-25T09:00:00Z','c6','Marcus R.','Sign-in','Sign-in refused for Marcus R.: Redline Moto Parts is suspended','ns','s4','denied'),
 { id:'av1', t:'2026-09-28T10:20:00Z', who:'neha', type:'Staff', level:'Admin', action:'Customer view', text:'Neha viewed customer Priya S. at Mehta Textiles', p:'bz', s:'s1', res:'success', cust:'c1', ip:'103.21.44.9' },
];
window.DFA = { SETUPS, CUSTOMERS, PARTNERS, STORES, SESSIONS: [], STAFF, USERS, IMPS, PEOPLE, ACTIVITY: ACTIVITY.concat(CACT) };
})();
