import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

function getSanitizedSupabaseUrl(): string {
  let url = (process.env.SUPABASE_URL || '').trim();
  url = url.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '');
  const match = url.match(/project\/([a-z0-9]+)/i);
  if (match && match[1]) {
    url = `https://${match[1]}.supabase.co`;
  }
  return url;
}

const supabaseUrl = getSanitizedSupabaseUrl();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const telegramChatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

let supabase: any = null;
if (supabaseUrl && supabaseServiceKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
  } catch (e) {}
}

let IN_MEMORY_ORDERS: any[] = [];
let IN_MEMORY_INCOMPLETE: any[] = [];

const DEFAULT_CMS: Record<string, any> = {
  show_hero: true,
  show_gallery: true,
  show_desc: true,
  show_specs: true,
  show_size_chart: true,
  show_combo: true,
  show_delivery: true,

  store_name: 'স্বপ্ন লাইফস্টাইল',
  store_tagline: 'Premium Menswear Brand',
  header_btn_text: 'অর্ডার করুন 👉',
  header_bg_color: '#ffffff',
  store_name_color: '#ea580c',
  store_tagline_color: '#78716c',
  header_btn_bg: '#ea580c',
  header_btn_color: '#ffffff',

  hero_headline: 'প্রিমিয়াম কোয়ালিটির স্টাইলিশ কাতুয়া',
  hero_headline_color: '#ffffff',
  hero_discount_badge: '🔥 ৩০% ডিসকাউন্ট সীমিত সময়ের জন্য 🔥',
  hero_discount_color: '#c2410c',
  hero_subtitle: 'আমাদের এই স্টাইলিশ ফিট ও আকর্ষণীয় কাতুয়াটিতে পাবেন স্টাইল, কমফোর্ট এবং কোয়ালিটি — সব একসাথে!',
  hero_subtitle_color: '#ffedd5',
  hero_btn_text: 'অর্ডার করতে চাই 🛍️',
  timer_hours: 20,
  timer_minutes: 12,
  timer_seconds: 30,

  size_section_title: 'সাইজ মেজারমেন্ট (Size Chart)',
  size_section_subtitle: 'আপনার সঠিক বডি মেজারমেন্ট দেখে সাইজ বেছে নিন',
  size_title_color: '#451a03',
  size_m_len: '28"', size_m_chest: '40"',
  size_l_len: '29"', size_l_chest: '42"',
  size_xl_len: '30"', size_xl_chest: '44"',
  size_xxl_len: '31"', size_xxl_chest: '46"',
  size_note_1: '১. আপনার শরীরের সঠিক মাপ অনুযায়ী সাইজ নির্বাচন করুন।',
  size_note_2: '২. ১০০% পিওর সুতি ফেব্রিক বিধায় ধোয়ার পর সামান্য ১-২% ফিটিং হতে পারে।',

  combo_section_title: 'বেশি নিলে বেশি সাশ্রয়!',
  combo_section_badge: 'স্পেশাল কম্বো অফার',
  combo_section_sub: 'একের অধিক অর্ডারে পান সরাসরি ক্যাশ ডিসকাউন্ট ও ফ্রি হোম ডেলিভারি',
  combo2_badge: '২ পিস প্যাকেজ',
  combo2_title: 'দুই পিস প্যাকেজ রেট শিরোনাম',
  combo2_reg_price: '৳ ১৫০০',
  combo2_offer_price: '৳ ১৪০০',
  combo2_discount_tag: '✓ আপনি সরাসরি সেভ করছেন ১০০ টাকা!',
  combo3_badge: '৩ পিস মেগা সেভার',
  combo3_title: 'তিন পিস মেগা প্যাকেজ রেট শিরোনাম',
  combo3_reg_price: '৳ ২২৫০',
  combo3_offer_price: '৳ ২০০০',
  combo3_discount_tag: '✓ ২৫০ টাকা ক্যাশ ডিসকাউন্ট',
  combo3_delivery_tag: '🚚 ডেলিভারি সম্পূর্ণ ফ্রি!',

  spec_section_title: 'প্রোডাক্ট স্পেসিফিকেশন',
  dynamic_specs: [
    '১০০% পিওর কটন ফেব্রিক দিয়ে তৈরি।',
    'অত্যন্ত নরম, আরামদায়ক ও ব্রিদেবল।',
    'আভিজাত্যপূর্ণ ও স্টাইলিশ সেমি-লং ফিটিং।',
    'প্রিমিয়াম সুতার নিখুঁত এমব্রয়ডারি ও আফসান প্রিন্ট।',
    'দৈনন্দিন ব্যবহার এবং যেকোনো অনুষ্ঠানের জন্য সেরা চয়েস।'
  ],

  del_inside_charge: 60,
  del_outside_charge: 120,
  office_address: 'শপ-২৩০, এমডি প্লাজা, মোহাম্মদপুর, ঢাকা-১২০৭, বাংলাদেশ।',
  contact_phone: '01700000000',
  contact_whatsapp: '01700000000',

  policy_about: 'স্বপ্ন লাইফস্টাইল বাংলাদেশের অন্যতম বিশ্বস্ত অনলাইন ফ্যাশন ব্র্যান্ড।',
  policy_terms: '১. সারা বাংলাদেশে সম্পূর্ণ ক্যাশ অন ডেলিভারিতে কোনো অগ্রিম টাকা ছাড়াই অর্ডার করতে পারবেন।',
  policy_return: '১. রাইডারের সামনে চেক করে রিসিভ করবেন।',
  fb_pixel_id: '',
  tiktok_pixel_id: ''
};

let IN_MEMORY_CMS = { ...DEFAULT_CMS };

const DEFAULT_PRODUCTS = [
  { id: 'prod_1', name: 'কাতুয়া - অলিভ গ্রিন', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80' },
  { id: 'prod_2', name: 'কাতুয়া - রয়েল ব্লু', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80' },
  { id: 'prod_3', name: 'কাতুয়া - লাইট পিংক', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80' },
  { id: 'prod_4', name: 'কাতুয়া - মেরুন রেড', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80' }
];

let IN_MEMORY_PRODUCTS = [...DEFAULT_PRODUCTS];

// টেলিগ্রাম নোটিফিকেশন
async function sendTelegramAlert(orderData: any, items: any[]) {
  if (!telegramBotToken || !telegramChatId) return;

  let itemList = '';
  items.forEach((it: any, i: number) => {
    itemList += `<b>${i + 1}.</b> ${it.product_name} x <b>${it.quantity}</b> = ${it.total_price} ৳\n`;
  });

  const caption = `🛍️ <b>নতুন অর্ডার এসেছে!</b> (<code>${orderData.order_number}</code>)\n\n` +
    `👤 <b>গ্রাহক:</b> ${orderData.customer_name}\n` +
    `📞 <b>ফোন:</b> <code>${orderData.customer_phone}</code>\n` +
    `📍 <b>ঠিকানা:</b> ${orderData.shipping_address}, ${orderData.shipping_district}\n\n` +
    `📦 <b>অর্ডারকৃত পণ্যসমূহ:</b>\n${itemList}\n` +
    `💵 <b>সাবটোটাল:</b> ${orderData.subtotal} ৳\n` +
    `🚚 <b>ডেলিভারি চার্জ:</b> ${orderData.delivery_charge} ৳\n` +
    `💰 <b>সর্বমোট বিল:</b> <b>${orderData.grand_total} ৳</b>\n` +
    `💳 <b>পেমেন্ট:</b> ক্যাশ অন ডেলিভারি (COD)`;

  const photos = Array.from(new Set(items.map((it: any) => it.image_url || DEFAULT_PRODUCTS[0].image)));

  if (photos.length > 1) {
    try {
      await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          media: photos.slice(0, 5).map((p, idx) => ({
            type: 'photo',
            media: p,
            caption: idx === 0 ? caption : undefined,
            parse_mode: 'HTML'
          }))
        })
      });
      return;
    } catch (e) {}
  }

  try {
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, photo: photos[0], caption, parse_mode: 'HTML' })
    });
  } catch (e) {
    fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: caption, parse_mode: 'HTML' })
    }).catch(() => {});
  }
}

// ================= API ENDPOINTS =================

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ১. স্টোর ডেটা ফেচ
app.get('/api/store-data', async (req: Request, res: Response) => {
  if (supabase) {
    try {
      const { data: dbData } = await supabase.from('site_content').select('*').eq('id', 'master_content').maybeSingle();
      if (dbData) {
        IN_MEMORY_CMS = { ...IN_MEMORY_CMS, ...dbData };
        if (dbData.products_json && Array.isArray(dbData.products_json) && dbData.products_json.length > 0) {
          IN_MEMORY_PRODUCTS = dbData.products_json;
        }
      }
    } catch (e) {}
  }
  res.json({
    content: IN_MEMORY_CMS,
    products: IN_MEMORY_PRODUCTS
  });
});

// ২. ইনকমপ্লিট অর্ডার ট্র্যাকিং এন্ডপয়েন্ট (New)
app.post('/api/incomplete-order', (req: Request, res: Response) => {
  const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;
  if (!customer_phone || customer_phone.length < 11) {
    return res.json({ success: false });
  }

  const existingIdx = IN_MEMORY_INCOMPLETE.findIndex(o => o.customer_phone === customer_phone);
  const incRecord = {
    id: 'inc_' + Date.now(),
    customer_name: customer_name || 'নাম লিখেননি',
    customer_phone,
    shipping_district: shipping_district || 'ঢাকা',
    shipping_address: shipping_address || 'ঠিকানা লিখেননি',
    items: items || [],
    created_at: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    IN_MEMORY_INCOMPLETE[existingIdx] = incRecord;
  } else {
    IN_MEMORY_INCOMPLETE.unshift(incRecord);
  }

  res.json({ success: true });
});

// ৩. সম্পূর্ণ অর্ডার প্লেসমেন্ট
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ success: false, error: 'সব প্রয়োজনীয় তথ্য দিন।' });
    }

    // ইনকমপ্লিট লিস্ট থেকে রিমুভ (যেহেতু এখন সফলভাবে অর্ডার সম্পন্ন করেছে)
    IN_MEMORY_INCOMPLETE = IN_MEMORY_INCOMPLETE.filter(x => x.customer_phone !== customer_phone);

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন', quantity: 1, total_price: 750 }];
    
    let subtotal = 0;
    let totalQty = 0;
    orderItems.forEach((it: any) => {
      subtotal += Number(it.total_price || 750);
      totalQty += Number(it.quantity || 1);
    });

    let discount = 0;
    const isDhaka = String(shipping_district).toLowerCase().includes('dhaka') || String(shipping_district).includes('ঢাকা');
    let delivery = isDhaka ? Number(IN_MEMORY_CMS.del_inside_charge || 60) : Number(IN_MEMORY_CMS.del_outside_charge || 120);

    if (totalQty === 2) discount = 100;
    else if (totalQty >= 3) {
      discount = 250;
      delivery = 0;
    }

    const grandTotal = Math.max(0, subtotal - discount + delivery);
    const orderNumber = 'SO-' + Math.floor(1000 + Math.random() * 9000);

    const newOrder = {
      id: 'ord_' + Date.now(),
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে',
      shipping_address,
      subtotal,
      discount_amount: discount,
      delivery_charge: delivery,
      grand_total: grandTotal,
      order_status: 'pending',
      created_at: new Date().toISOString(),
      order_items: orderItems
    };

    IN_MEMORY_ORDERS.unshift(newOrder);

    if (supabase) {
      supabase.from('orders').insert({
        order_number: orderNumber,
        customer_name,
        customer_phone,
        shipping_district: newOrder.shipping_district,
        shipping_address,
        subtotal,
        discount_amount: discount,
        delivery_charge: delivery,
        grand_total: grandTotal,
        order_status: 'pending'
      }).select().single().then(({ data: o }: any) => {
        if (o) {
          const itemsPayload = orderItems.map((it: any) => ({
            order_id: o.id,
            product_name: it.product_name,
            quantity: it.quantity || 1,
            unit_price: it.unit_price || 750,
            total_price: it.total_price || 750,
            image_url: it.image_url || ''
          }));
          supabase.from('order_items').insert(itemsPayload).catch(() => {});
        }
      }).catch(() => {});
    }

    sendTelegramAlert(newOrder, orderItems);

    res.json({
      success: true,
      order_number: orderNumber,
      grand_total: grandTotal
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ৪. অ্যাডমিন অর্ডার তালিকা (স্মার্ট ডুপ্লিকেট ও ইনকমপ্লিট হ্যান্ডলার সহ)
app.get('/api/admin/orders', (req: Request, res: Response) => {
  const { status, search } = req.query;

  // ইনকমপ্লিট অর্ডার চাওয়া হলে
  if (status === 'incomplete') {
    return res.json({ orders: IN_MEMORY_INCOMPLETE });
  }

  // ডুপ্লিকেট কাস্টমার চাওয়া হলে
  if (status === 'duplicates') {
    const phoneCounts: Record<string, number> = {};
    IN_MEMORY_ORDERS.forEach(o => {
      phoneCounts[o.customer_phone] = (phoneCounts[o.customer_phone] || 0) + 1;
    });
    const duplicateOrders = IN_MEMORY_ORDERS.filter(o => phoneCounts[o.customer_phone] > 1);
    return res.json({ orders: duplicateOrders });
  }

  let list = [...IN_MEMORY_ORDERS];

  // সাধারণ পেন্ডিং থেকে ডুপ্লিকেট আলাদা রাখা (আপনার ৪ নম্বর রিকোয়ারমেন্ট অনুযায়ী)
  if (status === 'pending') {
    const phoneCounts: Record<string, number> = {};
    IN_MEMORY_ORDERS.forEach(o => {
      phoneCounts[o.customer_phone] = (phoneCounts[o.customer_phone] || 0) + 1;
    });
    list = list.filter(o => o.order_status === 'pending' && phoneCounts[o.customer_phone] === 1);
  } else if (status && status !== 'all') {
    list = list.filter(o => o.order_status === status);
  }

  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter(o =>
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_phone?.includes(q) ||
      o.order_number?.toLowerCase().includes(q)
    );
  }

  res.json({ orders: list });
});

// ৫. পূর্ণাঙ্গ অর্ডার অ্যানালাইসিস API (New)
app.get('/api/admin/analytics', (req: Request, res: Response) => {
  const all = IN_MEMORY_ORDERS;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let totalRevenue = 0;
  let todayRevenue = 0;
  let todayOrders = 0;

  all.forEach(o => {
    totalRevenue += Number(o.grand_total || 0);
    if (o.created_at && o.created_at.startsWith(todayStr)) {
      todayRevenue += Number(o.grand_total || 0);
      todayOrders += 1;
    }
  });

  const phoneMap: Record<string, { count: number; totalSpent: number; name: string }> = {};
  all.forEach(o => {
    if (!phoneMap[o.customer_phone]) {
      phoneMap[o.customer_phone] = { count: 0, totalSpent: 0, name: o.customer_name };
    }
    phoneMap[o.customer_phone].count += 1;
    phoneMap[o.customer_phone].totalSpent += Number(o.grand_total || 0);
  });

  const duplicateCustomersCount = Object.values(phoneMap).filter(c => c.count > 1).length;

  res.json({
    totalOrders: all.length,
    totalRevenue,
    todayOrders,
    todayRevenue,
    pending: all.filter(o => o.order_status === 'pending').length,
    processing: all.filter(o => o.order_status === 'processing').length,
    shipped: all.filter(o => o.order_status === 'shipped').length,
    delivered: all.filter(o => o.order_status === 'delivered').length,
    cancelled: all.filter(o => o.order_status === 'cancelled').length,
    incompleteCount: IN_MEMORY_INCOMPLETE.length,
    duplicateCustomersCount,
    topCustomers: Object.entries(phoneMap).map(([phone, data]) => ({ phone, ...data })).sort((a,b) => b.totalSpent - a.totalSpent).slice(0, 5)
  });
});

app.get('/api/admin/metrics', (req: Request, res: Response) => {
  const list = IN_MEMORY_ORDERS;
  res.json({
    total: list.length,
    pending: list.filter(o => o.order_status === 'pending').length,
    processing: list.filter(o => o.order_status === 'processing').length,
    shipped: list.filter(o => o.order_status === 'shipped').length,
    delivered: list.filter(o => o.order_status === 'delivered').length,
    cancelled: list.filter(o => o.order_status === 'cancelled').length,
    incomplete: IN_MEMORY_INCOMPLETE.length
  });
});

app.post('/api/admin/orders/update-full', (req: Request, res: Response) => {
  const { order_id, customer_name, customer_phone, shipping_district, shipping_address, grand_total, order_status } = req.body;
  const order = IN_MEMORY_ORDERS.find(o => o.id === order_id || o.order_number === order_id);

  if (order) {
    if (customer_name) order.customer_name = customer_name;
    if (customer_phone) order.customer_phone = customer_phone;
    if (shipping_district) order.shipping_district = shipping_district;
    if (shipping_address) order.shipping_address = shipping_address;
    if (order_status) order.order_status = order_status;
    if (grand_total) order.grand_total = Number(grand_total);
    return res.json({ success: true });
  }
  res.status(404).json({ success: false });
});

app.post('/api/admin/orders/update-status', (req: Request, res: Response) => {
  const { order_id, status } = req.body;
  const o = IN_MEMORY_ORDERS.find(x => x.id === order_id || x.order_number === order_id);
  if (o) o.order_status = status;
  res.json({ success: true });
});

app.post('/api/admin/orders/delete', (req: Request, res: Response) => {
  const { order_id } = req.body;
  IN_MEMORY_ORDERS = IN_MEMORY_ORDERS.filter(x => x.id !== order_id && x.order_number !== order_id);
  IN_MEMORY_INCOMPLETE = IN_MEMORY_INCOMPLETE.filter(x => x.id !== order_id);
  res.json({ success: true });
});

app.post('/api/admin/cms/update-single', async (req: Request, res: Response) => {
  const { field, value } = req.body;
  if (field) {
    IN_MEMORY_CMS[field] = value;
    if (supabase) {
      supabase.from('site_content').upsert({ id: 'master_content', [field]: value }).catch(() => {});
    }
  }
  res.json({ success: true });
});

// স্পেসিফিকেশন অ্যাড ও ডিলিট API (New)
app.post('/api/admin/specs/add', async (req: Request, res: Response) => {
  const { text } = req.body;
  if (text) {
    if (!Array.isArray(IN_MEMORY_CMS.dynamic_specs)) {
      IN_MEMORY_CMS.dynamic_specs = [];
    }
    IN_MEMORY_CMS.dynamic_specs.push(text);
    if (supabase) {
      supabase.from('site_content').upsert({ id: 'master_content', dynamic_specs: IN_MEMORY_CMS.dynamic_specs }).catch(() => {});
    }
  }
  res.json({ success: true, specs: IN_MEMORY_CMS.dynamic_specs });
});

app.post('/api/admin/specs/delete', async (req: Request, res: Response) => {
  const { index } = req.body;
  if (Array.isArray(IN_MEMORY_CMS.dynamic_specs)) {
    IN_MEMORY_CMS.dynamic_specs.splice(index, 1);
    if (supabase) {
      supabase.from('site_content').upsert({ id: 'master_content', dynamic_specs: IN_MEMORY_CMS.dynamic_specs }).catch(() => {});
    }
  }
  res.json({ success: true, specs: IN_MEMORY_CMS.dynamic_specs });
});

app.post('/api/admin/products/update', (req: Request, res: Response) => {
  const { id, name, regular_price, price, image } = req.body;
  const p = IN_MEMORY_PRODUCTS.find(x => x.id === id);
  if (p) {
    if (name) p.name = name;
    if (regular_price) p.regular_price = Number(regular_price);
    if (price) p.price = Number(price);
    if (image) p.image = image;
    return res.json({ success: true, product: p });
  }
  res.status(404).json({ success: false });
});

app.post('/api/admin/products/add', (req: Request, res: Response) => {
  const { name, regular_price, price, image } = req.body;
  const newProd = {
    id: 'prod_' + Date.now(),
    name: name || 'নতুন প্রিমিয়াম কাতুয়া',
    regular_price: Number(regular_price) || 1050,
    price: Number(price) || 750,
    image: image || 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80'
  };
  IN_MEMORY_PRODUCTS.push(newProd);
  res.json({ success: true, product: newProd });
});

app.post('/api/admin/products/delete', (req: Request, res: Response) => {
  const { id } = req.body;
  IN_MEMORY_PRODUCTS = IN_MEMORY_PRODUCTS.filter(p => p.id !== id);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Master API live on port ${PORT}`));
