import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Supabase URL ফরম্যাট ক্লিনার
function cleanUrl(): string {
  let u = (process.env.SUPABASE_URL || '').trim();
  u = u.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '');
  const m = u.match(/project\/([a-z0-9]+)/i);
  if (m && m[1]) u = `https://${m[1]}.supabase.co`;
  return u;
}

const supabaseUrl = cleanUrl();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const telegramChatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

let supabase: any = null;
if (supabaseUrl && supabaseServiceKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
  } catch (e) {}
}

// অর্ডার স্টোরেজ
let ORDERS_LIST: any[] = [];

// ডিফল্ট ওয়েবসাইট কনটেন্ট (হেডার নাম ও সাইজ চার্ট সহ)
let CMS_CONTENT: Record<string, any> = {
  store_name: 'স্বপ্ন লাইফস্টাইল',
  store_tagline: 'Premium Menswear Brand',
  header_btn_text: 'অর্ডার করুন 👉',

  hero_headline: 'প্রিমিয়াম কোয়ালিটির স্টাইলিশ কাতুয়া',
  hero_discount_badge: '🔥 ৩০% ডিসকাউন্ট সীমিত সময়ের জন্য 🔥',
  hero_subtitle: 'আমাদের এই স্টাইলিশ ফিট ও আকর্ষণীয় কাতুয়াটিতে পাবেন স্টাইল, কমফোর্ট এবং কোয়ালিটি — সব একসাথে!',
  hero_btn_text: 'অর্ডার করতে চাই 🛍️',
  timer_hours: 20,
  timer_minutes: 12,
  timer_seconds: 30,

  size_section_title: 'সাইজ মেজারমেন্ট (Size Chart)',
  size_section_subtitle: 'আপনার সঠিক বডি মেজারমেন্ট দেখে সাইজ বেছে নিন',
  size_m_len: '28"', size_m_chest: '40"',
  size_l_len: '29"', size_l_chest: '42"',
  size_xl_len: '30"', size_xl_chest: '44"',
  size_xxl_len: '31"', size_xxl_chest: '46"',

  combo2_badge: '২ পিস প্যাকেজ',
  combo2_title: 'ডাবল কম্বো সেভার (২ পিস প্যাকেজ রেট)',
  combo2_reg_price: '৳ ১৫০০',
  combo2_offer_price: '৳ ১৪০০',
  combo2_discount_tag: '✓ আপনি সরাসরি সেভ করছেন ১০০ টাকা!',

  combo3_badge: '৩ পিস মেগা সেভার',
  combo3_title: 'মেগা ফ্যামিলি কম্বো (তিন পিস মেগা প্যাকেজ রেট)',
  combo3_reg_price: '৳ ২২৫০',
  combo3_offer_price: '৳ ২০০০',
  combo3_discount_tag: '✓ ২৫০ টাকা ক্যাশ ডিসকাউন্ট',
  combo3_delivery_tag: '🚚 ডেলিভারি সম্পূর্ণ ফ্রি!',

  spec_section_title: 'প্রোডাক্ট স্পেসিফিকেশন',
  spec_item_1: '১০০% পিওর কটন ফেব্রিক দিয়ে তৈরি।',
  spec_item_2: 'অত্যন্ত নরম, আরামদায়ক ও ব্রিদেবল।',
  spec_item_3: 'আভিজাত্যপূর্ণ ও স্টাইলিশ সেমি-লং ফিটিং।',
  spec_item_4: 'প্রিমিয়াম সুতার নিখুঁত এমব্রয়ডারি ও আফসান প্রিন্ট।',
  spec_item_5: 'দৈনন্দিন ব্যবহার এবং যেকোনো অনুষ্ঠানের জন্য সেরা চয়েস।',

  del_inside_charge: 60,
  del_outside_charge: 120,

  office_address: 'শপ-২৩০, এমডি প্লাজা, মোহাম্মদপুর, ঢাকা-১২০৭, বাংলাদেশ।',
  contact_phone: '01700000000',
  contact_whatsapp: '01700000000',

  policy_about: 'স্বপ্ন লাইফস্টাইল বাংলাদেশের অন্যতম বিশ্বস্ত অনলাইন ফ্যাশন ব্র্যান্ড।',
  policy_terms: 'সারা বাংলাদেশে সম্পূর্ণ ক্যাশ অন ডেলিভারিতে কোনো অগ্রিম টাকা ছাড়াই অর্ডার করতে পারবেন।',
  policy_return: 'ডেলিভারি রাইডারের সামনে চেক করে রিসিভ করবেন। পছন্দ না হলে রিটার্ন করতে পারবেন।'
};

let PRODUCTS_LIST: any[] = [
  { id: 'p_1', name: 'কাতুয়া - অলিভ গ্রিন', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80' },
  { id: 'p_2', name: 'কাতুয়া - রয়েল ব্লু', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80' },
  { id: 'p_3', name: 'কাতুয়া - লাইট পিংক', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80' },
  { id: 'p_4', name: 'কাতুয়া - মেরুন রেড', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80' }
];

// টেলিগ্রাম নোটিফিকেশন
async function sendTelegramAlert(order: any, items: any[]) {
  if (!telegramBotToken || !telegramChatId) return;

  let itemList = '';
  items.forEach((it: any, i: number) => {
    itemList += `<b>${i + 1}.</b> ${it.product_name} x <b>${it.quantity}</b> = ${it.total_price} ৳\n`;
  });

  const text = `🛍️ <b>নতুন অর্ডার এসেছে!</b> (<code>${order.order_number}</code>)\n\n` +
    `👤 <b>গ্রাহক:</b> ${order.customer_name}\n` +
    `📞 <b>ফোন:</b> <code>${order.customer_phone}</code>\n` +
    `📍 <b>ঠিকানা:</b> ${order.shipping_address}, ${order.shipping_district}\n\n` +
    `📦 <b>অর্ডারকৃত পণ্যসমূহ:</b>\n${itemList}\n` +
    `💵 <b>সাবটোটাল:</b> ${order.subtotal} ৳\n` +
    `🚚 <b>ডেলিভারি চার্জ:</b> ${order.delivery_charge} ৳\n` +
    `💰 <b>সর্বমোট বিল:</b> <b>${order.grand_total} ৳</b>\n` +
    `💳 <b>পেমেন্ট:</b> ক্যাশ অন ডেলিভারি (COD)`;

  const photos = Array.from(new Set(items.map((it: any) => it.image_url || PRODUCTS_LIST[0].image)));

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
            caption: idx === 0 ? text : undefined,
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
      body: JSON.stringify({ chat_id: telegramChatId, photo: photos[0], caption: text, parse_mode: 'HTML' })
    });
  } catch (e) {
    fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text, parse_mode: 'HTML' })
    }).catch(() => {});
  }
}

// ================= API ENDPOINTS =================

app.get('/api/health', (req, res) => res.json({ status: 'ok', server_time: new Date() }));

// ১. স্টোর ডেটা ফেচ
app.get('/api/store-data', (req: Request, res: Response) => {
  res.json({
    success: true,
    content: CMS_CONTENT,
    products: PRODUCTS_LIST
  });
});

// ২. অর্ডার গ্রহণ
app.post('/api/checkout', (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ success: false, error: 'সব প্রয়োজনীয় তথ্য দিন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন (L)', quantity: 1, total_price: 750 }];
    
    let subtotal = 0;
    let totalQty = 0;
    orderItems.forEach((it: any) => {
      subtotal += Number(it.total_price || 750);
      totalQty += Number(it.quantity || 1);
    });

    let discount = 0;
    const isDhaka = String(shipping_district).toLowerCase().includes('dhaka') || String(shipping_district).includes('ঢাকা');
    let delivery = isDhaka ? Number(CMS_CONTENT.del_inside_charge || 60) : Number(CMS_CONTENT.del_outside_charge || 120);

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

    ORDERS_LIST.unshift(newOrder);

    // টেলিগ্রামে অ্যালার্ট
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

// ৩. অ্যাডমিন অর্ডার তালিকা
app.get('/api/admin/orders', (req: Request, res: Response) => {
  const { status, search } = req.query;
  let list = [...ORDERS_LIST];

  if (status && status !== 'all') {
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

  res.json({ success: true, orders: list });
});

// ৪. অ্যাডমিন মেট্রিকস
app.get('/api/admin/metrics', (req: Request, res: Response) => {
  const list = ORDERS_LIST;
  res.json({
    total: list.length,
    pending: list.filter(o => o.order_status === 'pending').length,
    processing: list.filter(o => o.order_status === 'processing').length,
    shipped: list.filter(o => o.order_status === 'shipped').length,
    delivered: list.filter(o => o.order_status === 'delivered').length,
    cancelled: list.filter(o => o.order_status === 'cancelled').length
  });
});

// ৫. কাস্টমার ও অর্ডার তথ্য এডিট
app.post('/api/admin/orders/update-full', (req: Request, res: Response) => {
  try {
    const { order_id, customer_name, customer_phone, shipping_district, shipping_address, grand_total, order_status } = req.body;
    const order = ORDERS_LIST.find(o => o.id === order_id || o.order_number === order_id);

    if (order) {
      if (customer_name) order.customer_name = customer_name;
      if (customer_phone) order.customer_phone = customer_phone;
      if (shipping_district) order.shipping_district = shipping_district;
      if (shipping_address) order.shipping_address = shipping_address;
      if (order_status) order.order_status = order_status;
      if (grand_total) order.grand_total = Number(grand_total);
      return res.json({ success: true });
    }
    res.status(404).json({ success: false, message: 'Not found' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ৬. অর্ডার স্ট্যাটাস আপডেট (ড্যাশবোর্ড চেঞ্জ)
app.post('/api/admin/orders/update-status', (req: Request, res: Response) => {
  const { order_id, status } = req.body;
  const o = ORDERS_LIST.find(x => x.id === order_id || x.order_number === order_id);
  if (o) o.order_status = status;
  res.json({ success: true });
});

// ৭. অর্ডার ডিলিট
app.post('/api/admin/orders/delete', (req: Request, res: Response) => {
  const { order_id } = req.body;
  ORDERS_LIST = ORDERS_LIST.filter(x => x.id !== order_id && x.order_number !== order_id);
  res.json({ success: true });
});

// ৮. CMS টেক্সট এডিটর সেভ
app.post('/api/admin/cms/update-single', (req: Request, res: Response) => {
  const { field, value } = req.body;
  if (field) {
    CMS_CONTENT[field] = value;
  }
  res.json({ success: true, message: 'Saved successfully' });
});

// ৯. প্রোডাক্ট আপডেট
app.post('/api/admin/products/update', (req: Request, res: Response) => {
  const { id, name, regular_price, price, image } = req.body;
  const p = PRODUCTS_LIST.find(x => x.id === id);
  if (p) {
    if (name) p.name = name;
    if (regular_price) p.regular_price = Number(regular_price);
    if (price) p.price = Number(price);
    if (image) p.image = image;
    return res.json({ success: true, product: p });
  }
  res.status(404).json({ success: false });
});

// ১০. নতুন প্রোডাক্ট যোগ
app.post('/api/admin/products/add', (req: Request, res: Response) => {
  const { name, regular_price, price, image } = req.body;
  const newProd = {
    id: 'p_' + Date.now(),
    name: name || 'নতুন প্রিমিয়াম কাতুয়া',
    regular_price: Number(regular_price) || 1050,
    price: Number(price) || 750,
    image: image || 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80'
  };
  PRODUCTS_LIST.push(newProd);
  res.json({ success: true, product: newProd });
});

// ১১. প্রোডাক্ট ডিলিট
app.post('/api/admin/products/delete', (req: Request, res: Response) => {
  const { id } = req.body;
  PRODUCTS_LIST = PRODUCTS_LIST.filter(p => p.id !== id);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Master API is live on port ${PORT}`));
