// Sample data for DF Storefront Prototype: the two launch stores of DF Store Prototype
// (Kesari Threads, India; Juniper & Co., US) as a shopper sees them. Dummy data only.
(function () {
  const REG = {
    IN: {
      key: 'IN', store: 'Kesari Threads', init: 'K', locale: 'en-IN', cur: 'INR', incl: true, accent: '#B4532A', accentInk: '#FFFFFF', tint: '#F6E7DD',
      liveHost: 'kesarithreads.in', shopHost: 'kesari-threads.shops.northstar.shop', previewHost: 'kesari-threads.preview.northstar.shop',
      tagline: 'Hand block-printed cotton and linen from Jaipur.', city: 'Jaipur', email: 'hello@kesarithreads.in', phone: '+91 98450 11234',
      address: ['Kesari Threads', 'MI Road', 'Jaipur, Rajasthan 302001', 'India'], taxId: 'GSTIN 08ABCDE1234F1Z5',
      taxLine: 'Inclusive of all taxes', taxShort: 'incl. GST', taxName: 'GST', compareName: 'MRP', postal: 'PIN code', region: 'State', regionName: 'Rajasthan',
      sizes: ['S', 'M', 'L', 'XL'], mult: v => Math.round(v * 55 / 50) * 50 - 1,
      languages: [['en-IN', 'English'], ['hi-IN', 'हिन्दी']], currencies: ['INR'],
      delivery: [
        { id: 'std', name: 'Standard delivery', note: '3–5 working days · Shiprocket', price: 79, freeOver: 1999 },
        { id: 'exp', name: 'Express delivery', note: '1–2 working days · Shiprocket', price: 149 },
        { id: 'pick', name: 'Collect from our Delhi store', note: 'Ready in 2 hours · Khan Market', price: 0 }
      ],
      pay: {
        razorpay: { id: 'razorpay', name: 'UPI, cards and netbanking', by: 'Razorpay', note: 'Pay with any UPI app, a card, or netbanking.' },
        cashfree: { id: 'cashfree', name: 'UPI, cards and netbanking', by: 'Cashfree', note: 'Pay with any UPI app, a card, or netbanking.' },
        phonepe: { id: 'phonepe', name: 'PhonePe', by: 'PhonePe', note: 'Opens the PhonePe app to approve the payment.' },
        cod: { id: 'cod', name: 'Cash on delivery', by: '', note: 'Pay the courier in cash when your order arrives.' },
        bank: { id: 'bank', name: 'Bank transfer', by: '', note: 'We show our account details after you place the order. Pay within 3 days or the order is cancelled.' }
      },
      payOrder: ['razorpay', 'phonepe', 'cod', 'bank'], bank: [['Account name', 'Kesari Threads'], ['Account number', '50200012345678'], ['IFSC', 'HDFC0001234'], ['Bank', 'HDFC Bank, MI Road, Jaipur']],
      giftAmounts: [500, 1000, 2000, 5000], giftExpiry: 'Valid for 1 year from the day it’s sent.',
      offer: { name: 'Festive 10% off', line: '10% off orders over ₹2,999', min: 2999, pct: 10, ends: 'Ends in 5 h' }, code: 'DIWALI15', codePct: 15,
      people: { name: 'Ananya Rao', email: 'ananya.rao@example.com', phone: '+91 98450 22113', addr: ['Ananya Rao', '14, 5th Cross, Indiranagar', 'Bengaluru, Karnataka 560038', 'India'] },
      service: { name: 'Block-printing workshop', base: 35, duration: '2 hours', where: 'Our Jaipur studio, MI Road', desc: 'Print your own cotton stole with our printers, using our wooden blocks and natural dyes. Materials and chai included.' },
      digital: { name: 'Block-print pattern pack', base: 9, file: 'PDF, 24 pages · 18 MB', desc: 'Twelve of our classic Sanganeri motifs as printable pattern sheets, with notes on colour and repeat.' },
      sms: true, whatsapp: true
    },
    US: {
      key: 'US', store: 'Juniper & Co.', init: 'J', locale: 'en-US', cur: 'USD', incl: false, accent: '#2F5D50', accentInk: '#FFFFFF', tint: '#E3ECE8',
      liveHost: 'juniperandco.com', shopHost: 'juniper-co.shops.northstar.shop', previewHost: 'juniper-co.preview.northstar.shop',
      tagline: 'Everyday clothes and home goods, made to last.', city: 'Columbus', email: 'hello@juniperandco.com', phone: '+1 614 555 0142',
      address: ['Juniper & Co.', '410 Oak St', 'Columbus, OH 43215', 'United States'], taxId: '',
      taxLine: 'Tax calculated at checkout', taxShort: '+ tax', taxName: 'Sales tax', compareName: 'List price', postal: 'ZIP code', region: 'State', regionName: 'Ohio',
      sizes: ['S', 'M', 'L', 'XL'], mult: v => v,
      languages: [['en-US', 'English']], currencies: ['USD'],
      delivery: [
        { id: 'std', name: 'Standard shipping', note: '3–5 business days · USPS', price: 5.95, freeOver: 75 },
        { id: 'exp', name: 'Express shipping', note: '1–2 business days · UPS', price: 14 },
        { id: 'pick', name: 'Local pickup', note: 'Ready tomorrow · 410 Oak St, Columbus', price: 0 }
      ],
      pay: {
        stripe: { id: 'stripe', name: 'Card, Apple Pay or Google Pay', by: 'Stripe', note: 'Visa, Mastercard, American Express, Discover.' },
        paypal: { id: 'paypal', name: 'PayPal', by: 'PayPal', note: 'Opens PayPal to sign in and approve. Pay Later where offered.' },
        bank: { id: 'bank', name: 'Bank transfer', by: '', note: 'We show our account details after you place the order. Pay within 3 days or the order is cancelled.' }
      },
      payOrder: ['stripe', 'paypal', 'bank'], bank: [['Account name', 'Juniper & Co. LLC'], ['Routing number', '044000037'], ['Account number', '7712004418'], ['Bank', 'Chase, Columbus OH']],
      giftAmounts: [25, 50, 100, 200], giftExpiry: 'Valid for 5 years from the day it’s sent.',
      offer: { name: 'Fall 10% off', line: '10% off orders over $100', min: 100, pct: 10, ends: 'Ends in 5 h' }, code: 'WELCOME15', codePct: 15,
      people: { name: 'Maya Chen', email: 'maya.chen@example.com', phone: '+1 614 555 0199', addr: ['Maya Chen', '88 Neil Ave, Apt 4', 'Columbus, OH 43215', 'United States'] },
      service: { name: 'Alterations appointment', base: 25, duration: '30 minutes', where: 'Our Columbus studio, 410 Oak St', desc: 'Hemming, taking in or letting out anything you bought from us. Bring the piece; we pin, you approve.' },
      digital: { name: 'Mending guide', base: 9, file: 'PDF, 32 pages · 21 MB', desc: 'Visible mending for cotton, linen and wool: darning, patching and sashiko stitches, step by step.' },
      sms: true, whatsapp: false
    }
  };

  const HI = { Shop: 'खरीदें', Search: 'खोजें', Cart: 'कार्ट', Account: 'खाता', 'Add to cart': 'कार्ट में डालें', Checkout: 'चेकआउट', 'Sign in': 'साइन इन', 'New in': 'नया', About: 'हमारे बारे में', Journal: 'जर्नल', Help: 'सहायता', 'Your cart': 'आपका कार्ट', 'Shown in English': 'अंग्रेज़ी में दिखाया गया' };

  function catalogue(k) {
    const R = REG[k]; const P = v => R.mult(v);
    let n = 0;
    const mk = (name, o) => {
      n++;
      const opts = o.options || [];
      const combos = opts.reduce((acc, op) => acc.flatMap(a => op.choices.map(c => [...a, c])), [[]]);
      const stocks = o.stocks || [8, 12, 6, 3];
      const variants = opts.length ? combos.map((vals, i) => ({ key: vals.join('|'), vals, stock: (o.off || []).includes(vals.join('|')) ? 0 : stocks[i % stocks.length], price: P(o.varPrice ? o.varPrice(vals) : o.price) })) : [];
      return {
        id: 'p' + n, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), name, type: o.type || 'physical',
        price: P(o.price), compare: o.compare ? P(o.compare) : null, desc: o.desc || '', hue: o.hue === undefined ? (n * 47) % 360 : o.hue, photos: o.photos || 2,
        options: opts, variants, stock: o.stock === undefined ? 12 : o.stock, filters: o.filters || {}, badge: o.badge || '', highlights: o.highlights || [],
        specs: o.specs || [], legal: o.legal || [['Material', '100% cotton'], ['Country of origin', k === 'IN' ? 'India' : 'Made in USA'], ['Care', 'Machine wash cold']],
        sizeChart: !!o.sizeChart, aplus: !!o.aplus, video: !!o.video, collections: o.collections || [], offer: !!o.offer, extra: o.extra || null, vendor: o.vendor || ''
      };
    };
    const products = [
      mk('Organic Cotton Tee', { price: 28, compare: 34, desc: 'Soft, heavyweight organic cotton. Cut a little roomy, washes without shrinking.', photos: 4, hue: 32, filters: { Fabric: 'Cotton', Occasion: 'Everyday', Colour: ['Sand', 'Ink', 'Sage'] }, options: [{ name: 'Colour', kind: 'swatch', choices: ['Sand', 'Ink', 'Sage'], sw: { Sand: '#D8C3A5', Ink: '#2B3340', Sage: '#9CAF94' } }, { name: 'Size', kind: 'button', choices: R.sizes }], off: ['Sage|' + R.sizes[3]], varPrice: v => v[1] === R.sizes[3] ? 30 : 28, highlights: ['Pre-washed, no shrinking', 'Certified organic cotton', 'Relaxed fit — take your usual size'], specs: [['Weight', '220 gsm'], ['Fit', 'Relaxed'], ['Neck', 'Crew']], legal: [['Material', '100% organic cotton'], ['Country of origin', k === 'IN' ? 'India' : 'Made in USA'], ['Care', 'Machine wash cold, dry flat'], k === 'IN' ? ['HSN code', '6109'] : ['Made by', 'Juniper & Co., Columbus OH']], sizeChart: true, aplus: true, video: true, badge: 'Bestseller', collections: ['c1', 'c3'], offer: true }),
      mk('Mara Linen Shirt', { price: 49, compare: 59, vendor: 'Northwind Textiles', photos: 3, hue: 205, filters: { Fabric: 'Linen', Occasion: 'Wedding' }, options: [{ name: 'Size', kind: 'button', choices: R.sizes }], stocks: [1, 0, 2, 0], legal: [['Material', '100% linen'], ['Country of origin', k === 'IN' ? 'India' : 'Portugal'], ['Care', 'Machine wash 30°, line dry']], desc: 'Washed linen with a soft collar and mother-of-pearl buttons. Gets better every wash.', sizeChart: true, collections: ['c2', 'c3'] }),
      mk('Block-print Kurta', { price: 30, photos: 3, hue: 12, filters: { Fabric: 'Cotton', Occasion: 'Wedding' }, options: [{ name: 'Size', kind: 'button', choices: R.sizes }], desc: 'Hand block-printed in Sanganer with natural dyes. Side pockets, a straight hem and a relaxed cut.', badge: 'Handmade', sizeChart: true, collections: ['c1', 'c2'] }),
      mk('Silk Scarf', { price: 42, photos: 3, hue: 340, filters: { Fabric: 'Silk', Occasion: 'Wedding', Colour: ['Ivory', 'Rust', 'Teal'] }, options: [{ name: 'Colour', kind: 'swatch', choices: ['Ivory', 'Rust', 'Teal'], sw: { Ivory: '#EFE6D2', Rust: '#A9532E', Teal: '#2F6E6A' } }], stocks: [4, 5, 0], legal: [['Material', '100% silk'], ['Country of origin', 'India'], ['Care', 'Hand wash cold']], desc: 'Lightweight mulberry silk, hand-rolled edges, 90 × 90 cm.', collections: ['c2'] }),
      mk('Linen Midi Dress', { price: 89, vendor: 'Northwind Textiles', photos: 2, hue: 150, filters: { Fabric: 'Linen', Occasion: 'Wedding' }, options: [{ name: 'Size', kind: 'button', choices: R.sizes }], stocks: [3, 5, 2, 1], desc: 'A-line midi in mid-weight linen with deep pockets and an adjustable tie.', sizeChart: true, badge: 'New', collections: ['c2', 'c3'] }),
      mk('Wool Throw', { price: 120, stock: 6, photos: 2, hue: 25, filters: { Fabric: 'Wool' }, legal: [['Material', '100% wool'], ['Country of origin', k === 'IN' ? 'India' : 'Ireland'], ['Care', 'Dry clean']], desc: 'Herringbone lambswool throw, 130 × 180 cm, fringed ends.', collections: ['c4'] }),
      mk('Stoneware Mug', { price: 16, stock: 0, photos: 2, hue: 200, filters: { Fabric: 'Stoneware' }, legal: [['Material', 'Glazed stoneware'], ['Country of origin', k === 'IN' ? 'India' : 'Made in USA'], ['Care', 'Dishwasher safe']], desc: 'Hand-thrown 350 ml mug with a speckled glaze. Every one is slightly different.', collections: ['c4'] }),
      mk('Cotton Socks 3-pack', { price: 14, stock: 40, photos: 2, hue: 48, filters: { Fabric: 'Cotton', Occasion: 'Everyday' }, desc: 'Ribbed combed-cotton socks in three earthy colours.', collections: ['c1'] }),
      mk('Linen Tote', { price: 32, vendor: 'Northwind Textiles', stock: 15, photos: 2, hue: 90, filters: { Fabric: 'Linen' }, legal: [['Material', '100% linen'], ['Country of origin', 'India'], ['Care', 'Machine wash cold']], desc: 'Heavy linen tote with an inside pocket and long handles.', collections: ['c4'] }),
      mk('Gift card', { price: 50, type: 'giftcard', photos: 1, hue: 20, stock: 999, legal: [], desc: 'Let them choose. Sent by email on the day you pick, with your message.', collections: [] }),
      mk(R.digital.name, { price: R.digital.base, type: 'digital', photos: 1, hue: 260, stock: 999, legal: [['Format', R.digital.file], ['Delivery', 'Download link by email, and in your account']], desc: R.digital.desc, collections: [] }),
      mk(R.service.name, { price: R.service.base, type: 'service', photos: 1, hue: 170, stock: 999, legal: [], desc: R.service.desc, extra: { duration: R.service.duration, where: R.service.where }, collections: [] })
    ];
    const collections = [
      { id: 'c1', name: 'Cotton Edit', desc: 'Breathable everyday cotton, printed and plain.', hue: 32 },
      { id: 'c2', name: 'Wedding Guest', desc: 'Linen and silk for long celebrations.', hue: 340 },
      { id: 'c3', name: 'New in', desc: 'Just landed this month.', hue: 205 },
      { id: 'c4', name: 'Home', desc: 'Throws, mugs and totes for slow mornings.', hue: 25 }
    ];
    const menu = [
      { label: 'New in', to: ['collection', 'c3'] }, { label: 'Clothing', to: ['collection', 'all'], kids: [{ label: 'Cotton Edit', to: ['collection', 'c1'] }, { label: 'Wedding Guest', to: ['collection', 'c2'] }] },
      { label: 'Home', to: ['collection', 'c4'] }, { label: 'Gift cards', to: ['product', 'p10'] }, { label: 'Journal', to: ['blog'] }, { label: 'About', to: ['about'] }
    ];
    const posts = [
      { id: 'b1', title: k === 'IN' ? 'How a block becomes a print' : 'Why we pre-wash every tee', date: '2026-09-28', mins: 5, hue: 12, excerpt: k === 'IN' ? 'From teak block to finished stole: a morning with our printers in Sanganer.' : 'Shrinkage, softness and the 40 minutes that make a T-shirt last ten years.' },
      { id: 'b2', title: 'Caring for linen', date: '2026-09-14', mins: 4, hue: 150, excerpt: 'Wash cool, dry flat, and stop ironing. Linen is meant to look lived in.' },
      { id: 'b3', title: k === 'IN' ? 'Dressing for a Jaipur wedding' : 'A capsule for fall', date: '2026-08-30', mins: 6, hue: 340, excerpt: k === 'IN' ? 'Five looks for three days of sangeet, mehendi and pheras — without the suitcase.' : 'Twelve pieces, thirty outfits: our team’s rules for a smaller wardrobe.' }
    ];
    const faqs = [
      ['How long does delivery take?', k === 'IN' ? 'Standard delivery takes 3–5 working days anywhere in India; express takes 1–2. You get a tracking link by SMS and email when your order ships.' : 'Standard shipping takes 3–5 business days; express takes 1–2. You get a tracking link by email when your order ships.'],
      ['Can I return something?', 'Yes, within 14 days of delivery if it’s unworn with tags on. Start a return from your order in your account and we’ll email a label.'],
      ['Do you ship outside ' + (k === 'IN' ? 'India' : 'the US') + '?', 'Not yet. We’ll say so here when we do.'],
      ['How do I look after hand-printed fabric?', 'Wash it cold and separately the first two times, in mild detergent, and dry it in the shade.']
    ];
    const orders = [
      { id: k === 'IN' ? 'KT-1055' : 'JC-1055', date: '2026-10-05', status: 'preparing', lines: [['p2', 'M', 1]], courier: '', awb: '', pay: k === 'IN' ? 'UPI · Razorpay' : 'Visa •••• 4242', steps: [['Placed', '5 Oct, 09:12'], ['Paid', '5 Oct, 09:12'], ['Shipped', 'Usually within 2 days'], ['Delivered', '']] },
      { id: k === 'IN' ? 'KT-1042' : 'JC-1042', date: '2026-10-02', status: 'shipped', lines: [['p1', 'Sand / M', 1], ['p8', '', 2]], courier: k === 'IN' ? 'Shiprocket · Delhivery' : 'USPS', awb: k === 'IN' ? '14326219874' : '9400 1000 0000 0000 0000 00', pay: k === 'IN' ? 'UPI · Razorpay' : 'Visa •••• 4242', steps: [['Placed', '2 Oct, 10:14'], ['Paid', '2 Oct, 10:14'], ['Shipped', '3 Oct, 16:40'], ['Delivered', 'Expected 7–8 Oct']] },
      { id: k === 'IN' ? 'KT-1031' : 'JC-1031', date: '2026-09-21', status: 'delivered', delivered: '2026-09-25', lines: [['p3', 'M', 1]], courier: k === 'IN' ? 'Shiprocket · Blue Dart' : 'UPS', awb: '1Z999AA10123456784', pay: k === 'IN' ? 'Cash on delivery' : 'PayPal', steps: [['Placed', '21 Sep, 18:02'], ['Paid', k === 'IN' ? '25 Sep, on delivery' : '21 Sep, 18:02'], ['Shipped', '22 Sep, 11:30'], ['Delivered', '25 Sep, 14:05']] },
      { id: k === 'IN' ? 'KT-1050' : 'JC-1050', date: '2026-10-04', status: 'awaiting', lines: [['p4', 'Rust', 1]], courier: '', awb: '', pay: 'Bank transfer', steps: [['Placed', '4 Oct, 20:41'], ['Paid', 'Waiting for your transfer'], ['Shipped', ''], ['Delivered', '']] },
      { id: k === 'IN' ? 'KT-1018' : 'JC-1018', date: '2026-08-28', status: 'delivered', delivered: '2026-09-01', lines: [['p6', '', 1]], courier: k === 'IN' ? 'Shiprocket · Delhivery' : 'USPS', awb: '14326201122', pay: k === 'IN' ? 'UPI · Razorpay' : 'Visa •••• 4242', steps: [['Placed', '28 Aug, 12:40'], ['Paid', '28 Aug, 12:40'], ['Shipped', '29 Aug, 10:15'], ['Delivered', '1 Sep, 13:20']] },
      { id: k === 'IN' ? 'KT-1022' : 'JC-1022', date: '2026-09-02', status: 'digital', lines: [['p11', '', 1]], courier: '', awb: '', pay: k === 'IN' ? 'UPI · Razorpay' : 'Visa •••• 4242', steps: [] }
    ];
    return { R, products, collections, menu, posts, faqs, orders };
  }

  window.SHOP = { REG, HI, catalogue };
})();
