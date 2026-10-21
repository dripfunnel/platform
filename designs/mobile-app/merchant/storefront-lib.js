// Storefront templates + site-model helpers → window.DFSite
(function () {
  const FONTS = { 'DM Sans': 'sans-serif', 'Archivo Black': 'sans-serif', 'Work Sans': 'sans-serif', 'Lora': 'serif', 'Nunito': 'sans-serif', 'Space Grotesk': 'sans-serif', 'Inter': 'sans-serif', 'Playfair Display': 'serif', 'Cormorant Garamond': 'serif', 'Manrope': 'sans-serif', 'Libre Baskerville': 'serif', 'Bebas Neue': 'sans-serif' };
  const TYPES = ['hero', 'products', 'categories', 'banner', 'features', 'testimonial', 'newsletter', 'text'];
  const TONES = ['soft', 'vivid', 'dark', 'mono'];
  const DEF_THEME = { bg: '#FFFFFF', surface: '#F5F5F4', text: '#222222', muted: '#5F5F5F', accent: '#2B2B2B', accentText: '#FFFFFF', headFont: 'Manrope', bodyFont: 'Work Sans', headWeight: 700, headCase: 'none', radius: 6, imgTone: 'soft' };

  const pages = (c, about) => ({
    about: { headline: 'About ' + c.store, body: about },
    contact: { headline: 'Get in touch', body: 'Questions about an order, sizing or anything else — we reply within one working day.', email: c.email || 'hello@example.com', phone: c.phone || '', address: c.city || '' }
  });
  const ids = list => list.map((x, i) => ({ id: 's' + (i + 1), ...x }));

  const T = {
    minimal: {
      name: 'Linen', tag: 'Minimal fashion', desc: 'Light, roomy and quiet. Big photos, small type, nothing in the way.',
      build: c => ({
        theme: { bg: '#FAF8F5', surface: '#FFFFFF', text: '#1C1B19', muted: '#68645C', accent: '#1C1B19', accentText: '#FFFFFF', headFont: 'DM Sans', bodyFont: 'DM Sans', headWeight: 500, headCase: 'none', radius: 2, imgTone: 'soft' },
        announce: { on: true, text: 'Free returns within 30 days', bg: '#1C1B19', fg: '#FAF8F5' },
        header: { style: 'left', menu: ['Shop', 'New in', 'About', 'Contact'], bg: '#FAF8F5', fg: '#1C1B19' },
        sections: ids([
          { type: 'hero', layout: 'split', headline: 'New in: ' + c.store + ' autumn edit', sub: 'Made to last, sent from ' + c.city + '.', cta: 'Shop now' },
          { type: 'products', title: 'New arrivals', cols: 4, count: 8, card: 'plain', aspect: 'portrait' },
          { type: 'text', headline: 'Made slowly, worn for years', body: 'Natural fabrics, simple cuts and seams that hold. We make fewer things and make them well.', align: 'center' },
          { type: 'newsletter', headline: 'Hear about new pieces first', sub: 'One email a month. No noise.', cta: 'Sign up' }
        ]),
        footer: { text: 'Everyday clothes, made to last.', links: ['Shipping', 'Returns', 'Size guide', 'Contact'], tone: 'light' },
        pages: pages(c, c.store + ' started with one idea: clothes you reach for every day should be the best-made ones you own.\n\nEverything is cut in small runs from natural fabrics and finished by people we know by name.')
      })
    },
    street: {
      name: 'Concrete', tag: 'Bold streetwear', desc: 'Loud type, hard edges and a bright accent. Built around drops.',
      build: c => ({
        theme: { bg: '#EFEFEC', surface: '#FFFFFF', text: '#0D0D0D', muted: '#46463F', accent: '#D7F205', accentText: '#0D0D0D', headFont: 'Archivo Black', bodyFont: 'Work Sans', headWeight: 400, headCase: 'uppercase', radius: 0, imgTone: 'vivid' },
        announce: { on: true, text: 'Drop 07 lands Friday, 6 pm', bg: '#0D0D0D', fg: '#D7F205' },
        header: { style: 'center', menu: ['Drop 07', 'Shop all', 'Lookbook', 'About'], bg: '#0D0D0D', fg: '#FFFFFF' },
        sections: ids([
          { type: 'hero', layout: 'full', headline: 'Built for the street', sub: 'Heavyweight basics in small runs.', cta: 'Shop the drop' },
          { type: 'categories', title: 'Shop by type', items: ['Tees', 'Hoodies', 'Pants', 'Caps'] },
          { type: 'products', title: 'Latest drop', cols: 3, count: 6, card: 'boxed', aspect: 'square' },
          { type: 'banner', headline: 'Members shop first', sub: 'Sign up and we’ll tell you before every drop.', cta: 'Join', tone: 'accent' }
        ]),
        footer: { text: c.store + ' — made in small runs.', links: ['Shipping', 'Returns', 'Instagram', 'Contact'], tone: 'dark' },
        pages: pages(c, 'We make the clothes we wanted and couldn’t find: heavy cotton, clean graphics, fits that last.\n\nEvery drop is small, so nothing ends up in landfill.')
      })
    },
    beauty: {
      name: 'Bloom', tag: 'Beauty & wellness', desc: 'Soft colour, rounded shapes and calm serif headings.',
      build: c => ({
        theme: { bg: '#FBF3EE', surface: '#FFFFFF', text: '#3A2724', muted: '#76605A', accent: '#A9523F', accentText: '#FFFFFF', headFont: 'Lora', bodyFont: 'Nunito', headWeight: 500, headCase: 'none', radius: 18, imgTone: 'soft' },
        announce: { on: true, text: 'Free samples with every order', bg: '#F1DCD1', fg: '#3A2724' },
        header: { style: 'center', menu: ['Shop', 'Skin', 'Body', 'Our story', 'Contact'], bg: '#FBF3EE', fg: '#3A2724' },
        sections: ids([
          { type: 'hero', layout: 'centered', headline: 'Gentle care, every day', sub: 'Simple formulas, made in small batches.', cta: 'Find your routine' },
          { type: 'features', title: '', items: [{ title: 'Kind ingredients', body: 'Short lists you can read.' }, { title: 'Never tested on animals', body: 'Certified, every product.' }, { title: 'Refillable', body: 'Send empties back for free.' }] },
          { type: 'products', title: 'Bestsellers', cols: 4, count: 4, card: 'boxed', aspect: 'portrait' },
          { type: 'testimonial', quote: 'The only cleanser that hasn’t upset my skin. I’m on my fourth bottle.', author: 'Amira, verified buyer' },
          { type: 'newsletter', headline: '10% off your first order', sub: 'Plus routines and early access.', cta: 'Get my code' }
        ]),
        footer: { text: 'Made in small batches.', links: ['Ingredients', 'Shipping', 'Returns', 'Contact'], tone: 'light' },
        pages: pages(c, 'We started mixing in a kitchen because nothing on the shelf suited sensitive skin.\n\nToday every batch is still small, tested and labelled in plain words.')
      })
    },
    tech: {
      name: 'Circuit', tag: 'Electronics & tech', desc: 'Dark, sharp and spec-led. Clear prices and trust signals up front.',
      build: c => ({
        theme: { bg: '#0E1116', surface: '#171C24', text: '#E7ECF2', muted: '#9DA9B8', accent: '#3D8BFF', accentText: '#FFFFFF', headFont: 'Space Grotesk', bodyFont: 'Inter', headWeight: 700, headCase: 'none', radius: 10, imgTone: 'dark' },
        announce: { on: true, text: 'Two-year warranty on everything', bg: '#3D8BFF', fg: '#FFFFFF' },
        header: { style: 'left', menu: ['Shop', 'Compare', 'Support', 'About'], bg: '#0E1116', fg: '#E7ECF2' },
        sections: ids([
          { type: 'hero', layout: 'split', headline: 'Gear that just works', sub: 'Tested, explained and sent the next day.', cta: 'Shop all' },
          { type: 'categories', title: 'Browse', items: ['Audio', 'Charging', 'Cables', 'Accessories'] },
          { type: 'products', title: 'Popular right now', cols: 4, count: 8, card: 'boxed', aspect: 'square' },
          { type: 'features', title: 'Why buy here', items: [{ title: 'Next-day dispatch', body: 'Order by 4 pm.' }, { title: '2-year warranty', body: 'On every item.' }, { title: '30-day returns', body: 'No questions.' }, { title: 'Real support', body: 'People, not bots.' }] },
          { type: 'newsletter', headline: 'Deals and new releases', sub: 'Twice a month.', cta: 'Subscribe' }
        ]),
        footer: { text: 'Gear, explained.', links: ['Support', 'Warranty', 'Shipping', 'Returns'], tone: 'dark' },
        pages: pages(c, 'We test everything we sell and write down what we find, so you can buy once.\n\nIf something stops working, we fix it or replace it.')
      })
    },
    food: {
      name: 'Market', tag: 'Food & grocery', desc: 'Warm, friendly and easy to browse. Categories first, delivery promise on top.',
      build: c => ({
        theme: { bg: '#FFFCF3', surface: '#FFFFFF', text: '#1F2D1C', muted: '#56644F', accent: '#2F7A35', accentText: '#FFFFFF', headFont: 'Nunito', bodyFont: 'Nunito', headWeight: 800, headCase: 'none', radius: 14, imgTone: 'vivid' },
        announce: { on: true, text: 'Order by 2 pm for same-day delivery in ' + c.city, bg: '#2F7A35', fg: '#FFFFFF' },
        header: { style: 'left', menu: ['Shop', 'Fresh', 'Pantry', 'Offers', 'About'], bg: '#FFFCF3', fg: '#1F2D1C' },
        sections: ids([
          { type: 'hero', layout: 'split', headline: 'Fresh from the market, at your door', sub: 'Picked this morning from growers near ' + c.city + '.', cta: 'Start shopping' },
          { type: 'categories', title: 'Shop by aisle', items: ['Fruit & veg', 'Bakery', 'Dairy', 'Pantry', 'Drinks', 'Snacks'] },
          { type: 'products', title: 'This week’s picks', cols: 5, count: 10, card: 'boxed', aspect: 'square' },
          { type: 'banner', headline: 'Build a weekly box', sub: 'Choose once, skip any week.', cta: 'Make my box', tone: 'accent' }
        ]),
        footer: { text: 'Local food, delivered.', links: ['Delivery areas', 'FAQs', 'Our growers', 'Contact'], tone: 'light' },
        pages: pages(c, 'We buy from growers and bakers near ' + c.city + ' and bring it to you the same day.\n\nShorter trips mean fresher food and fairer prices for the people who make it.')
      })
    },
    luxury: {
      name: 'Atelier', tag: 'Luxury editorial', desc: 'Magazine-like pacing. Large serif type, muted tones, lots of space.',
      build: c => ({
        theme: { bg: '#F4EFE7', surface: '#FBF8F3', text: '#1A1714', muted: '#6A6157', accent: '#1A1714', accentText: '#F4EFE7', headFont: 'Playfair Display', bodyFont: 'Work Sans', headWeight: 400, headCase: 'none', radius: 0, imgTone: 'mono' },
        announce: { on: false, text: 'Private appointments available', bg: '#1A1714', fg: '#F4EFE7' },
        header: { style: 'center', menu: ['Collection', 'Atelier', 'Journal', 'Contact'], bg: '#F4EFE7', fg: '#1A1714' },
        sections: ids([
          { type: 'hero', layout: 'full', headline: 'The Autumn Collection', sub: 'Cut and finished by hand.', cta: 'Discover' },
          { type: 'text', headline: 'A quieter kind of luxury', body: 'Each piece is made to order in our ' + c.city + ' atelier, from cloth chosen for how it ages.', align: 'center' },
          { type: 'products', title: 'The collection', cols: 3, count: 6, card: 'plain', aspect: 'portrait' },
          { type: 'testimonial', quote: 'Clothes that feel inherited the day you buy them.', author: 'The Weekend Review' },
          { type: 'newsletter', headline: 'Private appointments', sub: 'Leave your email and we’ll be in touch.', cta: 'Request' }
        ]),
        footer: { text: 'Made to order.', links: ['Appointments', 'Care', 'Delivery', 'Contact'], tone: 'dark' },
        pages: pages(c, 'Founded in ' + c.city + ', ' + c.store + ' makes a small number of pieces each season, by hand and to order.\n\nWe would rather make one thing perfectly than ten things quickly.')
      })
    },
    blank: {
      name: 'Start from scratch', tag: 'Blank', desc: 'A plain header, banner, product grid and footer. Describe your shop and the AI styles it.',
      build: c => ({
        theme: { ...DEF_THEME },
        announce: { on: false, text: 'Add a short message for shoppers', bg: '#222222', fg: '#FFFFFF' },
        header: { style: 'left', menu: ['Shop', 'About', 'Contact'], bg: '#FFFFFF', fg: '#222222' },
        sections: ids([
          { type: 'hero', layout: 'centered', headline: 'Welcome to ' + c.store, sub: 'Tell the AI what you sell and how it should feel.', cta: 'Shop now' },
          { type: 'products', title: 'Products', cols: 4, count: 8, card: 'plain', aspect: 'square' }
        ]),
        footer: { text: '', links: ['Shipping', 'Returns', 'Contact'], tone: 'light' },
        pages: pages(c, 'Write a few lines about who you are and why you started.')
      })
    }
  };
  const ORDER = ['minimal', 'street', 'beauty', 'tech', 'food', 'luxury'];

  const hex = (v, d) => (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) ? v.trim() : d;
  const str = (v, n, d) => (typeof v === 'string' ? v : d == null ? '' : d).slice(0, n);
  const num = (v, a, b, d) => { const x = Math.round(+v); return isNaN(x) ? d : Math.max(a, Math.min(b, x)); };
  const arr = (v, n, m) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x.trim()).slice(0, n).map(x => x.slice(0, m || 24));

  function normalize(s, prev) {
    s = s || {}; prev = prev || {};
    const pt = { ...DEF_THEME, ...(prev.theme || {}) };
    const t = { ...pt, ...(s.theme || {}) };
    ['bg', 'surface', 'text', 'muted', 'accent', 'accentText'].forEach(k => { t[k] = hex(t[k], pt[k]); });
    if (!FONTS[t.headFont]) t.headFont = pt.headFont; if (!FONTS[t.bodyFont]) t.bodyFont = pt.bodyFont;
    t.headWeight = num(t.headWeight, 300, 900, 700); t.headCase = t.headCase === 'uppercase' ? 'uppercase' : 'none';
    t.radius = num(t.radius, 0, 28, 6); if (!TONES.includes(t.imgTone)) t.imgTone = 'soft';
    const pa = prev.announce || {}, a = { ...pa, ...(s.announce || {}) };
    const ph = prev.header || {}, h = { ...ph, ...(s.header || {}) };
    const pf = prev.footer || {}, f = { ...pf, ...(s.footer || {}) };
    const pp = prev.pages || {}, pg = s.pages || {};
    const used = new Set(); let n = 0;
    const sections = (Array.isArray(s.sections) ? s.sections : prev.sections || []).filter(x => x && TYPES.includes(x.type)).slice(0, 12).map(x => {
      let id = typeof x.id === 'string' && x.id ? x.id : ''; while (!id || used.has(id)) id = 's' + (++n + 20); used.add(id);
      const o = { id, type: x.type };
      if (x.type === 'hero') Object.assign(o, { layout: ['split', 'full', 'centered'].includes(x.layout) ? x.layout : 'split', headline: str(x.headline, 80, 'Welcome'), sub: str(x.sub, 160), cta: str(x.cta, 28, 'Shop now') });
      if (x.type === 'products') Object.assign(o, { title: str(x.title, 50, 'Products'), cols: num(x.cols, 2, 5, 4), count: num(x.count, 3, 12, 8), card: x.card === 'boxed' ? 'boxed' : 'plain', aspect: x.aspect === 'portrait' ? 'portrait' : 'square' });
      if (x.type === 'categories') Object.assign(o, { title: str(x.title, 50, 'Shop by category'), items: arr(x.items, 6).length ? arr(x.items, 6) : ['New', 'Bestsellers', 'Gifts'] });
      if (x.type === 'banner') Object.assign(o, { headline: str(x.headline, 80, ''), sub: str(x.sub, 160), cta: str(x.cta, 28), tone: ['accent', 'dark', 'light'].includes(x.tone) ? x.tone : 'accent' });
      if (x.type === 'features') Object.assign(o, { title: str(x.title, 50), items: (Array.isArray(x.items) ? x.items : []).slice(0, 4).map(i => ({ title: str(i && i.title, 40), body: str(i && i.body, 100) })).filter(i => i.title) });
      if (x.type === 'testimonial') Object.assign(o, { quote: str(x.quote, 220), author: str(x.author, 60) });
      if (x.type === 'newsletter') Object.assign(o, { headline: str(x.headline, 80, 'Stay in touch'), sub: str(x.sub, 140), cta: str(x.cta, 24, 'Sign up') });
      if (x.type === 'text') Object.assign(o, { headline: str(x.headline, 80), body: str(x.body, 600), align: x.align === 'center' ? 'center' : 'left' });
      return o;
    });
    return {
      tpl: s.tpl || prev.tpl || 'blank', name: s.name || prev.name || 'Custom',
      theme: t,
      announce: { on: !!a.on, text: str(a.text, 100), bg: hex(a.bg, t.text), fg: hex(a.fg, t.bg) },
      header: { style: h.style === 'center' ? 'center' : 'left', menu: arr(h.menu, 6, 20).length ? arr(h.menu, 6, 20) : ['Shop', 'About', 'Contact'], bg: hex(h.bg, t.bg), fg: hex(h.fg, t.text) },
      sections,
      footer: { text: str(f.text, 160), links: arr(f.links, 6), tone: ['light', 'dark', 'accent'].includes(f.tone) ? f.tone : 'light' },
      pages: {
        about: { headline: str((pg.about || {}).headline, 80, (pp.about || {}).headline || 'About us'), body: str((pg.about || {}).body, 1200, (pp.about || {}).body || '') },
        contact: { ...(pp.contact || {}), ...(pg.contact || {}) }
      }
    };
  }

  function build(key, ctx) { const d = T[key] || T.blank; return normalize({ tpl: key, name: d.name, ...d.build(ctx) }); }

  // Template look + current words: theme/layout from tpl, copy from cur.
  function keepContent(tpl, cur) {
    if (!cur) return tpl;
    const out = JSON.parse(JSON.stringify(tpl));
    out.header.menu = cur.header.menu.slice(); out.announce.text = cur.announce.text; out.announce.on = cur.announce.on;
    out.footer.text = cur.footer.text; out.footer.links = cur.footer.links.slice(); out.pages = JSON.parse(JSON.stringify(cur.pages));
    const ch = cur.sections.find(x => x.type === 'hero'), th = out.sections.find(x => x.type === 'hero');
    if (ch && th) Object.assign(th, { headline: ch.headline, sub: ch.sub, cta: ch.cta });
    return out;
  }

  function changedKeys(a, b) {
    if (!a || !b) return [];
    const out = []; const J = JSON.stringify;
    ['announce', 'header', 'footer'].forEach(k => { if (J(a[k]) !== J(b[k])) out.push(k); });
    const old = {}; a.sections.forEach(x => { old[x.id] = J(x); });
    b.sections.forEach(x => { if (old[x.id] !== J(x)) out.push(x.id); });
    if (J(a.pages) !== J(b.pages)) out.push('pages');
    return out;
  }

  const SCHEMA = 'theme{bg,surface,text,muted,accent,accentText: hex colours — keep body text 4.5:1 against bg and accentText 4.5:1 against accent; headFont and bodyFont each one of ' + Object.keys(FONTS).join(', ') + '; headWeight 300-900; headCase "none"|"uppercase"; radius 0-28; imgTone "soft"|"vivid"|"dark"|"mono"}; announce{on,text,bg,fg}; header{style "left"|"center", menu: up to 6 short labels (labels containing About/Story/Atelier open the About page, Contact/Support open Contact), bg, fg}; sections: ordered list for the home page, max 12, each {id, type, …}. Keep existing ids; give new sections new ids like "n1". Types: hero{layout "split"|"full"|"centered", headline ≤70 chars, sub ≤140, cta ≤24}; products{title, cols 2-5, count 3-12, card "plain"|"boxed", aspect "square"|"portrait"}; categories{title, items: up to 6 labels}; banner{headline, sub, cta, tone "accent"|"dark"|"light"}; features{title, items: up to 4 {title, body}}; testimonial{quote, author}; newsletter{headline, sub, cta}; text{headline, body, align "left"|"center"}; footer{text, links: up to 6 labels, tone "light"|"dark"|"accent"}; pages{about{headline, body (paragraphs split by blank lines)}, contact{headline, body, email, phone, address}}. Product photos, names and prices come from the shop catalogue and cannot be set here.';

  const SAMPLE = [['Everyday Tee', 28, 24], ['Weekend Shirt', 49, 200], ['Canvas Tote', 18, 40], ['Wool Beanie', 24, 330], ['Linen Throw', 89, 150], ['Stoneware Mug', 16, 20], ['Silk Scarf', 42, 280], ['Midi Dress', 79, 350]];

  window.DFSite = { TEMPLATES: T, ORDER, FONTS, build, normalize, keepContent, changedKeys, SCHEMA, SAMPLE };
})();
