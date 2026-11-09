import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';

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
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminTokenSecret = process.env.ADMIN_TOKEN_SECRET || '';

function makeAdminToken(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', adminTokenSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isValidAdminToken(token: string): boolean {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !adminTokenSecret) return false;
    const expected = createHmac('sha256', adminTokenSecret).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(decoded.exp) > Date.now();
  } catch { return false; }
}

function adminAuthMiddleware(req: Request, res: Response, next: any) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!isValidAdminToken(token)) return res.status(401).json({ success: false, error: 'Unauthorized: আবার লগইন করুন।' });
  next();
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('CRITICAL: Supabase credentials missing in Render environment variables!');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

const DEFAULT_PRODUCTS = [
  { id: 'prod_1', name: 'কাতুয়া - অলিভ গ্রিন', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80' },
  { id: 'prod_2', name: 'কাতুয়া - রয়েল ব্লু', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80' },
  { id: 'prod_3', name: 'কাতুয়া - লাইট পিংক', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80' },
  { id: 'prod_4', name: 'কাতুয়া - মেরুন রেড', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80' }
];

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

// Admin login: password এবং token secret Render Environment-এ রাখতে হবে
app.post('/api/admin/login', (req: Request, res: Response) => {
  if (!adminPassword || !adminTokenSecret) {
    return res.status(503).json({ success: false, error: 'Render-এ ADMIN_PASSWORD এবং ADMIN_TOKEN_SECRET সেট করা হয়নি।' });
  }
  const supplied = Buffer.from(String(req.body?.password || ''));
  const expected = Buffer.from(adminPassword);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ success: false, error: 'ভুল অ্যাডমিন পাসওয়ার্ড।' });
  }
  return res.json({ success: true, token: makeAdminToken(), expires_in: 43200 });
});

// Login ছাড়া সব Admin API-তে signed bearer token বাধ্যতামূলক
app.use('/api/admin', adminAuthMiddleware);

app.get('/', (_req: Request, res: Response) => res.json({ service:'Shekder Online API', status:'ok' }));

// ================= API ENDPOINTS =================

// সিস্টেম ও ডাটাবেজ হেলথ চেক
app.get('/api/admin/system-health', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const { count: orderCount, error } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    if (error) throw error;
    const latency = Date.now() - startTime;
    res.json({
      database: 'connected',
      latency_ms: latency,
      total_orders_in_db: orderCount || 0,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ database: 'disconnected', error: err.message });
  }
});

// Admin-এর জন্য পূর্ণ JSON backup export (সব row pagination সহ)
async function readAllRows(tableName: string): Promise<any[]> {
  const output: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await (supabase as any).from(tableName).select('*').range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    output.push(...rows);
    if (rows.length < pageSize) break;
  }
  return output;
}

app.get('/api/admin/backup/export', async (_req: Request, res: Response) => {
  try {
    const [customers, orders, order_items, site_content] = await Promise.all([
      readAllRows('customers'), readAllRows('orders'), readAllRows('order_items'), readAllRows('site_content')
    ]);
    const backup = { product: 'Shekder Online', format_version: 1, generated_at: new Date().toISOString(),
      counts: { customers: customers.length, orders: orders.length, order_items: order_items.length, site_content: site_content.length },
      data: { customers, orders, order_items, site_content } };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shekder-online-backup-${new Date().toISOString().slice(0,10)}.json"`);
    return res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (error: any) { return res.status(500).json({ success:false, error:error.message || 'Backup export failed' }); }
});

// ১. স্টোর ও CMS কনটেন্ট সরাসরি Supabase থেকে ফেচ
app.get('/api/store-data', async (req: Request, res: Response) => {
  try {
    const { data: dbData, error } = await supabase.from('site_content').select('*').eq('id', 'master_content').maybeSingle();
    if (error) throw error;

    let products = DEFAULT_PRODUCTS;
    if (dbData && dbData.products_json && Array.isArray(dbData.products_json) && dbData.products_json.length > 0) {
      products = dbData.products_json;
    }

    res.json({
      content: dbData || {},
      products
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ২. কাস্টমার অর্ডার চেকআউট (Verifiable Write-First Protocol)
app.post('/api/checkout', async (req: Request, res: Response) => {
  let savedOrderId: string | null = null;
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items, checkout_key } = req.body || {};
    const cleanPhone = String(customer_phone || '').replace(/\D/g, '');
    if (!String(customer_name || '').trim() || !/^01[3-9]\d{8}$/.test(cleanPhone) || !String(shipping_address || '').trim()) {
      return res.status(400).json({ success: false, error: 'নাম, সঠিক ১১ ডিজিটের ফোন নম্বর এবং সম্পূর্ণ ঠিকানা দিন।' });
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      return res.status(400).json({ success: false, error: 'কমপক্ষে একটি এবং সর্বোচ্চ ২০টি পণ্য নির্বাচন করুন।' });
    }

    // একই checkout key দিয়ে retry হলে আগের অর্ডার ফেরত দিন; নতুন অর্ডার তৈরি করবেন না
    if (checkout_key) {
      const { data: previous, error: previousError } = await supabase.from('orders').select('*').eq('checkout_key', String(checkout_key)).maybeSingle();
      if (!previousError && previous) {
        return res.json({ success: true, order_number: previous.order_number, grand_total: previous.grand_total,
          subtotal: previous.subtotal, discount_amount: previous.discount_amount, delivery_charge: previous.delivery_charge,
          created_at: previous.created_at, duplicate: true });
      }
    }

    const { data: cmsData, error: cmsError } = await supabase.from('site_content')
      .select('del_inside_charge, del_outside_charge, products_json').eq('id', 'master_content').maybeSingle();
    if (cmsError) throw cmsError;
    const products = Array.isArray(cmsData?.products_json) && cmsData.products_json.length ? cmsData.products_json : DEFAULT_PRODUCTS;

    // মূল্য Frontend থেকে বিশ্বাস নয়; বর্তমান Database product price থেকে নির্ধারণ
    const normalizedItems = items.map((item: any) => {
      const product = products.find((p: any) => String(p.id) === String(item.product_id));
      if (!product) throw new Error(`পণ্য পাওয়া যায়নি: ${String(item.product_id || '')}`);
      const quantity = Math.floor(Number(item.quantity));
      const price = Number(product.price);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isFinite(price) || price < 0) {
        throw new Error('পণ্যের পরিমাণ বা মূল্য সঠিক নয়।');
      }
      const size = String(item.size || 'Standard').slice(0, 50);
      const baseName = String(product.name || item.product_name || 'Product').slice(0, 255);
      return { product_id: product.id, product_name: size && size !== 'Standard' ? `${baseName} (${size})` : baseName,
        size, quantity, unit_price: price, total_price: price * quantity,
        image_url: String(product.image || item.image_url || '').slice(0, 2000) };
    });

    const subtotal = normalizedItems.reduce((sum: number, item: any) => sum + item.total_price, 0);
    const totalQty = normalizedItems.reduce((sum: number, item: any) => sum + item.quantity, 0);
    const districtText = String(shipping_district || '').trim().toLowerCase();
    const isOutsideDhaka = districtText.includes('outside') || districtText.includes('বাইরে');
    const isDhaka = !isOutsideDhaka && (districtText.includes('dhaka') || districtText.includes('ঢাকা'));
    let delivery = isDhaka ? Number(cmsData?.del_inside_charge ?? 60) : Number(cmsData?.del_outside_charge ?? 120);
    let discount = 0;
    if (totalQty === 2) discount = 100;
    else if (totalQty >= 3) { discount = 250; delivery = 0; }
    const grandTotal = Math.max(0, subtotal - discount + delivery);
    const orderNumber = `SO-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const orderRecord: Record<string, any> = {
      order_number: orderNumber, customer_name: String(customer_name).trim().slice(0, 150), customer_phone: cleanPhone,
      shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে', shipping_address: String(shipping_address).trim(),
      subtotal, discount_amount: discount, delivery_charge: delivery, grand_total: grandTotal,
      order_status: 'new', is_incomplete: false
    };
    if (checkout_key) orderRecord.checkout_key = String(checkout_key).slice(0, 100);

    const { data: savedOrder, error: orderError } = await supabase.from('orders').insert(orderRecord).select().single();
    if (orderError) {
      // Unique checkout_key conflict হলে আগের অর্ডারটি রিটার্ন
      if (checkout_key) {
        const { data: duplicate } = await supabase.from('orders').select('*').eq('checkout_key', String(checkout_key)).maybeSingle();
        if (duplicate) return res.json({ success: true, order_number: duplicate.order_number, grand_total: duplicate.grand_total,
          subtotal: duplicate.subtotal, discount_amount: duplicate.discount_amount, delivery_charge: duplicate.delivery_charge,
          created_at: duplicate.created_at, duplicate: true });
      }
      throw orderError;
    }
    savedOrderId = savedOrder.id;

    const itemsPayload = normalizedItems.map((it: any) => ({ order_id: savedOrder.id, product_name: it.product_name,
      size: it.size, quantity: it.quantity, unit_price: it.unit_price, total_price: it.total_price, image_url: it.image_url }));
    const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload);
    if (itemsError) {
      // আইটেম সংরক্ষণ ব্যর্থ হলে অসম্পূর্ণ অর্ডার রেখে দেবেন না
      await supabase.from('orders').delete().eq('id', savedOrder.id);
      savedOrderId = null;
      throw itemsError;
    }

    // স্থায়ী কাস্টমার প্রোফাইল তৈরি/আপডেট; অর্ডার সংরক্ষণ সফল হওয়ার পর
    try {
      const { data: existingCustomer, error: customerReadError } = await supabase.from('customers').select('*').eq('customer_phone', cleanPhone).maybeSingle();
      if (customerReadError) throw customerReadError;
      const customerValues = {
        customer_name: String(customer_name).trim().slice(0, 150), shipping_district: orderRecord.shipping_district,
        shipping_address: String(shipping_address).trim(), updated_at: new Date().toISOString()
      };
      if (existingCustomer) {
        const { error } = await supabase.from('customers').update({ ...customerValues,
          total_orders: Number(existingCustomer.total_orders || 0) + 1,
          total_spent: Number(existingCustomer.total_spent || 0) + grandTotal }).eq('id', existingCustomer.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('customers').insert({ customer_phone: cleanPhone, ...customerValues,
          total_orders: 1, total_spent: grandTotal, customer_category: 'Normal Customer', customer_rating: 5 });
        if (error) throw error;
      }
    } catch (customerError) { console.error('Customer profile update failed (order is saved):', customerError); }

    sendTelegramAlert(orderRecord, normalizedItems).catch((e: any) => console.warn('Telegram alert failed:', e));
    return res.json({ success: true, order_number: orderNumber, grand_total: grandTotal, subtotal,
      discount_amount: discount, delivery_charge: delivery, created_at: savedOrder.created_at, items: normalizedItems });
  } catch (err: any) {
    console.error('Checkout failed:', err);
    return res.status(500).json({ success: false, error: err.message || 'অর্ডার সংরক্ষণ করা যায়নি।' });
  }
});

// ৩. ইনকমপ্লিট অর্ডার হ্যান্ডলার
app.post('/api/incomplete-order', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address } = req.body || {};
    const phone = String(customer_phone || '').replace(/\D/g, '');
    if (!/^01[3-9]\d{8}$/.test(phone)) return res.status(400).json({ success: false });
    const { data: existing, error: findError } = await supabase.from('orders').select('id').eq('customer_phone', phone).eq('is_incomplete', true).maybeSingle();
    if (findError) throw findError;
    const lead = { customer_name: String(customer_name || '').trim().slice(0,150), customer_phone: phone,
      shipping_district: shipping_district || 'ঢাকা', shipping_address: String(shipping_address || '').trim(),
      subtotal: 0, delivery_charge: 0, discount_amount: 0, grand_total: 0, order_status: 'pending', is_incomplete: true,
      updated_at: new Date().toISOString() };
    if (existing) {
      const { error } = await supabase.from('orders').update(lead).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('orders').insert({ ...lead, order_number: `INC-${Date.now()}-${randomUUID().slice(0,5).toUpperCase()}` });
      if (error) throw error;
    }
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ success: false, error: e.message }); }
});

// ৪. অ্যাডমিন অর্ডার তালিকা (সরাসরি Supabase PostgreSQL থেকে)
app.get('/api/admin/orders', async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;

    if (status === 'incomplete') {
      const { data, error } = await supabase.from('orders').select('*').eq('is_incomplete', true).order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ orders: data || [] });
    }

    let query = supabase.from('orders').select('*').or('is_incomplete.is.null,is_incomplete.eq.false').order('created_at', { ascending: false });

    if (status && status !== 'all' && status !== 'duplicates') {
      query = query.eq('order_status', status);
    }

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,order_number.ilike.%${search}%`);
    }

    const { data: orders, error: ordersErr } = await query;
    if (ordersErr) throw ordersErr;

    const allOrders = orders || [];

    if (allOrders.length > 0) {
      const orderIds = allOrders.map(o => o.id);
      const { data: allItems, error: itemsError } = await supabase.from('order_items').select('*').in('order_id', orderIds);
      if (itemsError) throw itemsError;
      allOrders.forEach(o => {
        o.order_items = (allItems || []).filter(it => it.order_id === o.id);
      });
    }

    let result = allOrders;

    if (status === 'duplicates') {
      const phoneCounts: Record<string, number> = {};
      allOrders.forEach(o => phoneCounts[o.customer_phone] = (phoneCounts[o.customer_phone] || 0) + 1);
      result = allOrders.filter(o => phoneCounts[o.customer_phone] > 1);
    }

    res.json({ orders: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৫. লাইভ ড্যাশবোর্ড মেট্রিকস সরাসরি PostgreSQL থেকে
app.get('/api/admin/metrics', async (req: Request, res: Response) => {
  try {
    const { data: allOrders, error: orderErr } = await supabase.from('orders').select('order_status, is_incomplete, grand_total, created_at');
    if (orderErr) throw orderErr;

    const { data: allCusts, error: custErr } = await supabase.from('customers').select('customer_category');
    if (custErr) throw custErr;

    const all = allOrders || [];
    const valid = all.filter(o => !o.is_incomplete);
    const incomplete = all.filter(o => o.is_incomplete);
    const custs = allCusts || [];

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let totalSales = 0;
    let todayOrdersCount = 0;

    valid.forEach(o => {
      totalSales += Number(o.grand_total || 0);
      if (o.created_at && new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Dhaka', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(o.created_at)) === todayStr) {
        todayOrdersCount++;
      }
    });

    res.json({
      total: valid.length,
      today: todayOrdersCount,
      new: valid.filter(o => o.order_status === 'new').length,
      pending: valid.filter(o => o.order_status === 'pending').length,
      confirmed: valid.filter(o => o.order_status === 'confirmed').length,
      processing: valid.filter(o => o.order_status === 'processing').length,
      shipped: valid.filter(o => o.order_status === 'shipped').length,
      delivered: valid.filter(o => o.order_status === 'delivered').length,
      cancelled: valid.filter(o => o.order_status === 'cancelled').length,
      incomplete: incomplete.length,
      total_sales: totalSales,
      total_customers: custs.length,
      good_customers: custs.filter(c => c.customer_category === 'Good Customer').length,
      bad_customers: custs.filter(c => c.customer_category === 'Bad Customer').length,
      rated_customers: custs.filter(c => c.customer_category === 'Rated Customer').length
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৬. রিয়েল-টাইম নতুন অর্ডার নোটিফিকেশন এন্ডপয়েন্ট (Polling / Alert Engine)
app.get('/api/admin/poll-new-orders', async (req: Request, res: Response) => {
  try {
    const since = req.query.since ? String(req.query.since) : new Date(Date.now() - 15000).toISOString();
    const { data, error } = await supabase.from('orders').select('*').eq('is_incomplete', false).gt('created_at', since).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ new_orders: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ৭. কাস্টমার ডিরেক্টরি ফেচ
app.get('/api/admin/customers', async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
    let query = supabase.from('customers').select('*').order('updated_at', { ascending: false });

    if (category && category !== 'all') {
      query = query.eq('customer_category', category);
    }
    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const customers = data || [];
    if (customers.length) {
      const phones = customers.map((c: any) => c.customer_phone);
      const { data: recentOrders, error: recentError } = await supabase.from('orders').select('*').in('customer_phone', phones).or('is_incomplete.is.null,is_incomplete.eq.false').order('created_at', { ascending: false });
      if (recentError) throw recentError;
      const latestByPhone: Record<string, any> = {};
      (recentOrders || []).forEach((o: any) => { if (!latestByPhone[o.customer_phone]) latestByPhone[o.customer_phone] = o; });
      const latestIds = Object.values(latestByPhone).map((o: any) => o.id);
      const { data: latestItems, error: itemError } = latestIds.length ? await supabase.from('order_items').select('*').in('order_id', latestIds) : { data: [], error: null };
      if (itemError) throw itemError;
      customers.forEach((c: any) => {
        const latest = latestByPhone[c.customer_phone];
        if (latest) latest.order_items = (latestItems || []).filter((it: any) => it.order_id === latest.id);
        c.latest_order = latest || null;
      });
    }
    res.json({ customers });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৮. কাস্টমার ক্যাটাগরি ও রেটিং আপডেট
app.post('/api/admin/customers/update-rating', async (req: Request, res: Response) => {
  try {
    const { customer_id, customer_category, customer_rating, customer_notes, customer_name, shipping_district, shipping_address } = req.body;
    const updateObj: Record<string, any> = { updated_at: new Date().toISOString() };
    const allowedCategories = ['Good Customer', 'Bad Customer', 'Rated Customer', 'Normal Customer'];
    if (customer_category !== undefined) { if (!allowedCategories.includes(customer_category)) return res.status(400).json({success:false,error:'Invalid customer category'}); updateObj.customer_category = customer_category; }
    if (customer_rating !== undefined) { const rating = Number(customer_rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({success:false,error:'Rating must be 1 to 5'}); updateObj.customer_rating = rating; }
    if (customer_notes !== undefined) updateObj.customer_notes = String(customer_notes).slice(0, 5000);
    if (customer_name !== undefined) updateObj.customer_name = String(customer_name).trim().slice(0, 150);
    if (shipping_district !== undefined) updateObj.shipping_district = String(shipping_district).trim().slice(0, 100);
    if (shipping_address !== undefined) updateObj.shipping_address = String(shipping_address).trim().slice(0, 2000);

    const { error } = await supabase.from('customers').update(updateObj).eq('id', customer_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ৯. কাস্টমার ডিলিট (জিরো ডাটা লস গ্যারান্টি: অর্ডার হিস্ট্রি কখনো ডিলিট হবে না)
app.post('/api/admin/customers/delete', async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.body;
    const { error } = await supabase.from('customers').delete().eq('id', customer_id);
    if (error) throw error;
    res.json({ success: true, message: 'কাস্টমার প্রোফাইল রিমুভ হয়েছে। পূর্ববর্তী সব অর্ডার অক্ষত রয়েছে।' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ১০. অর্ডার স্ট্যাটাস ও তথ্য আপডেট
app.post('/api/admin/orders/update-status', async (req: Request, res: Response) => {
  try {
    const { order_id, status } = req.body;
    const { error } = await supabase.from('orders').update({ order_status: status, updated_at: new Date().toISOString() }).eq('id', order_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/orders/update-full', async (req: Request, res: Response) => {
  try {
    const { order_id, customer_name, customer_phone, shipping_district, shipping_address, grand_total, order_status } = req.body;
    const { error } = await supabase.from('orders').update({
      customer_name,
      customer_phone,
      shipping_district,
      shipping_address,
      grand_total: Number(grand_total),
      order_status,
      updated_at: new Date().toISOString()
    }).eq('id', order_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/orders/delete', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body;
    const { error } = await supabase.from('orders').delete().eq('id', order_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/cms/update-single', async (req: Request, res: Response) => {
  try {
    const { field, value } = req.body || {};
    const allowedFields = new Set(['store_name','store_name_color','store_tagline','store_tagline_color','header_btn_text','header_btn_bg','header_btn_color','header_bg_color','hero_headline','hero_headline_color','hero_discount_badge','hero_discount_color','hero_subtitle','hero_subtitle_color','hero_btn_text','timer_hours','timer_minutes','timer_seconds','size_section_title','size_section_subtitle','size_title_color','size_m_len','size_m_chest','size_l_len','size_l_chest','size_xl_len','size_xl_chest','size_xxl_len','size_xxl_chest','size_note_1','size_note_2','combo_section_title','combo_section_badge','combo_section_sub','combo2_badge','combo2_title','combo2_reg_price','combo2_offer_price','combo2_discount_tag','combo3_badge','combo3_title','combo3_reg_price','combo3_offer_price','combo3_discount_tag','combo3_delivery_tag','spec_section_title','dynamic_specs','del_inside_charge','del_outside_charge','del_inside_title','del_inside_sub','del_outside_title','del_outside_sub','office_address','contact_phone','contact_whatsapp','contact_section_title','policy_about','policy_terms','policy_return','fb_pixel_id','fb_enabled','tiktok_pixel_id','tiktok_enabled','show_hero','show_gallery','show_desc','show_specs','show_size_chart','show_combo','show_delivery','products_json']);
    if (!allowedFields.has(String(field))) return res.status(400).json({ success:false, error:'এই CMS field অনুমোদিত নয়।' });
    const { error } = await supabase.from('site_content').upsert({ id:'master_content', [field]:value, updated_at:new Date().toISOString() });
    if (error) throw error;
    return res.json({ success:true, field, value });
  } catch (e: any) { return res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/admin/specs/add', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    const { data: dbData } = await supabase.from('site_content').select('dynamic_specs').eq('id', 'master_content').maybeSingle();
    let specs = dbData?.dynamic_specs || [];
    specs.push(text);
    await supabase.from('site_content').upsert({ id: 'master_content', dynamic_specs: specs, updated_at: new Date().toISOString() });
    res.json({ success: true, specs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/specs/delete', async (req: Request, res: Response) => {
  try {
    const { index } = req.body;
    const { data: dbData } = await supabase.from('site_content').select('dynamic_specs').eq('id', 'master_content').maybeSingle();
    let specs = dbData?.dynamic_specs || [];
    specs.splice(index, 1);
    await supabase.from('site_content').upsert({ id: 'master_content', dynamic_specs: specs, updated_at: new Date().toISOString() });
    res.json({ success: true, specs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/products/update', async (req: Request, res: Response) => {
  try {
    const { id, name, regular_price, price, image } = req.body;
    const { data: dbData } = await supabase.from('site_content').select('products_json').eq('id', 'master_content').maybeSingle();
    let products = Array.isArray(dbData?.products_json) && dbData.products_json.length ? dbData.products_json : [...DEFAULT_PRODUCTS];
    const p = products.find((x: any) => x.id === id);
    if (p) {
      if (name) p.name = name;
      if (regular_price !== undefined && regular_price !== '') p.regular_price = Number(regular_price);
      if (price !== undefined && price !== '') p.price = Number(price);
      if (image) p.image = image;
      const { error } = await supabase.from('site_content').upsert({ id: 'master_content', products_json: products, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.json({ success: true, product: p });
    }
    res.status(404).json({ success: false });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/products/add', async (req: Request, res: Response) => {
  try {
    const { name, regular_price, price, image } = req.body;
    const { data: dbData } = await supabase.from('site_content').select('products_json').eq('id', 'master_content').maybeSingle();
    let products = Array.isArray(dbData?.products_json) && dbData.products_json.length ? dbData.products_json : [...DEFAULT_PRODUCTS];
    const newProd = {
      id: 'prod_' + Date.now(),
      name: name || 'নতুন প্রিমিয়াম কাতুয়া',
      regular_price: Number(regular_price) || 1050,
      price: Number(price) || 750,
      image: image || 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80'
    };
    products.push(newProd);
    const { error } = await supabase.from('site_content').upsert({ id: 'master_content', products_json: products, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ success: true, product: newProd });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/products/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    const { data: dbData } = await supabase.from('site_content').select('products_json').eq('id', 'master_content').maybeSingle();
    let products = Array.isArray(dbData?.products_json) && dbData.products_json.length ? dbData.products_json : [...DEFAULT_PRODUCTS];
    products = products.filter((p: any) => p.id !== id);
    if (products.length === 0) products = [...DEFAULT_PRODUCTS];
    const { error } = await supabase.from('site_content').upsert({ id: 'master_content', products_json: products, updated_at: new Date().toISOString() });
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Enterprise Persistent Server live on port ${PORT}`));
