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

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('CRITICAL: Supabase credentials missing in Render environment variables!');
}

// Every Supabase HTTP request must finish or fail within 12 seconds.
// This prevents checkout from waiting forever when the database/network stalls.
const supabaseFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
};

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
  global: { fetch: supabaseFetch }
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

// Database connectivity probe for Render troubleshooting.
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const started = Date.now();
    const { error } = await supabase
      .from('site_content')
      .select('id')
      .eq('id', 'master_content')
      .maybeSingle();
    if (error) throw error;
    return res.json({ ok: true, database: 'connected', latency_ms: Date.now() - started });
  } catch (err: any) {
    console.error('Health check failed:', err);
    return res.status(503).json({
      ok: false,
      database: 'unavailable',
      error: err?.message || 'Database connection failed'
    });
  }
});

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

// ২. কাস্টমার অর্ডার চেকআউট (validated write-first flow)
app.post('/api/checkout', async (req: Request, res: Response) => {
  let savedOrderId: string | null = null;
  try {
    const customer_name = String(req.body?.customer_name || '').trim();
    const customer_phone = String(req.body?.customer_phone || '').replace(/\s+/g, '');
    const shipping_district = String(req.body?.shipping_district || '').trim();
    const shipping_address = String(req.body?.shipping_address || '').trim();
    const items = req.body?.items;

    if (!customer_name || !customer_phone || !shipping_address || !shipping_district) {
      return res.status(400).json({ success: false, error: 'নাম, ফোন, জেলা ও সম্পূর্ণ ঠিকানা দিন।' });
    }
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(customer_phone)) {
      return res.status(400).json({ success: false, error: 'সঠিক বাংলাদেশি ১১ ডিজিটের মোবাইল নম্বর দিন।' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'কমপক্ষে একটি পণ্য নির্বাচন করুন।' });
    }

    const orderItems = items.map((it: any) => {
      const quantity = Math.max(1, Math.min(99, Math.floor(Number(it.quantity) || 1)));
      const unitPrice = Number(it.unit_price);
      if (!it.product_name || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error('পণ্যের তথ্য বা মূল্য সঠিক নয়।');
      }
      return {
        product_name: String(it.product_name).slice(0, 255),
        size: String(it.size || 'L').slice(0, 50),
        quantity,
        unit_price: unitPrice,
        total_price: unitPrice * quantity,
        image_url: String(it.image_url || '')
      };
    });

    const subtotal = orderItems.reduce((sum: number, it: any) => sum + it.total_price, 0);
    const totalQty = orderItems.reduce((sum: number, it: any) => sum + it.quantity, 0);

    const { data: cmsData, error: cmsError } = await supabase
      .from('site_content')
      .select('del_inside_charge, del_outside_charge')
      .eq('id', 'master_content')
      .maybeSingle();
    if (cmsError) throw cmsError;

    // "ঢাকার বাইরে" যেন ভুল করে ঢাকা হিসেবে ধরা না হয়।
    const districtLower = shipping_district.toLowerCase();
    const isDhaka = districtLower === 'dhaka' ||
      districtLower === 'ঢাকা' ||
      districtLower.includes('ঢাকার ভিতরে') ||
      districtLower.includes('ঢাকার মধ্যে');
    let delivery = isDhaka
      ? Number(cmsData?.del_inside_charge ?? 60)
      : Number(cmsData?.del_outside_charge ?? 120);

    let discount = 0;
    if (totalQty === 2) discount = 100;
    else if (totalQty >= 3) {
      discount = 250;
      delivery = 0;
    }
    const grandTotal = Math.max(0, subtotal - discount + delivery);

    // Timestamp + random suffix: short random-number collision avoided.
    const orderNumber = 'SO-' + Date.now().toString(36).toUpperCase() + '-' +
      Math.random().toString(36).slice(2, 7).toUpperCase();

    const { data: savedOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        customer_name,
        customer_phone,
        shipping_district: isDhaka ? 'ঢাকা' : shipping_district,
        shipping_address,
        subtotal,
        discount_amount: discount,
        delivery_charge: delivery,
        grand_total: grandTotal,
        payment_method: 'cod',
        order_status: 'new',
        is_incomplete: false
      })
      .select()
      .single();

    if (orderError) throw orderError;
    savedOrderId = savedOrder.id;

    const itemsPayload = orderItems.map((it: any) => ({
      order_id: savedOrder.id,
      product_name: it.product_name,
      size: it.size,
      quantity: it.quantity,
      unit_price: it.unit_price,
      total_price: it.total_price,
      image_url: it.image_url
    }));
    const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload);
    if (itemsError) {
      // Do not leave an order that appears complete without its line items.
      await supabase.from('orders').delete().eq('id', savedOrder.id);
      savedOrderId = null;
      throw itemsError;
    }

    // Customer directory is maintained independently from the order history.
    const { data: existCust, error: customerReadError } = await supabase
      .from('customers').select('*').eq('customer_phone', customer_phone).maybeSingle();
    if (customerReadError) console.warn('Customer lookup warning:', customerReadError.message);

    if (existCust) {
      const { error: customerUpdateError } = await supabase.from('customers').update({
        customer_name,
        shipping_district: isDhaka ? 'ঢাকা' : shipping_district,
        shipping_address,
        total_orders: Number(existCust.total_orders || 0) + 1,
        total_spent: Number(existCust.total_spent || 0) + grandTotal,
        updated_at: new Date().toISOString()
      }).eq('id', existCust.id);
      if (customerUpdateError) console.warn('Customer update warning:', customerUpdateError.message);
    } else {
      const { error: customerInsertError } = await supabase.from('customers').insert({
        customer_phone,
        customer_name,
        shipping_district: isDhaka ? 'ঢাকা' : shipping_district,
        shipping_address,
        total_orders: 1,
        total_spent: grandTotal,
        customer_category: 'Normal Customer',
        customer_rating: 5
      });
      if (customerInsertError) console.warn('Customer insert warning:', customerInsertError.message);
    }

    // Notification is best-effort; saved order is not rolled back by Telegram downtime.
    sendTelegramAlert({
      ...savedOrder,
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_address,
      shipping_district: isDhaka ? 'ঢাকা' : shipping_district,
      subtotal,
      delivery_charge: delivery,
      grand_total: grandTotal
    }, orderItems).catch((e: any) => console.warn('Telegram alert failed:', e?.message || e));

    return res.status(201).json({
      success: true,
      order_number: orderNumber,
      grand_total: grandTotal,
      message: 'অর্ডার সফলভাবে গ্রহণ করা হয়েছে।'
    });
  } catch (err: any) {
    console.error('Checkout failed:', err);
    const rawMessage = String(err?.message || '');
    const isTimeout = err?.name === 'AbortError' || /abort|timeout|timed out/i.test(rawMessage);
    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? 'ডাটাবেজ থেকে সময়মতো উত্তর পাওয়া যায়নি। অর্ডার সংরক্ষণ সম্পন্ন হয়নি; অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
        : (rawMessage || 'অর্ডার সংরক্ষণ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।')
    });
  }
});

// ৩. ইনকমপ্লিট অর্ডার হ্যান্ডলার
app.post('/api/incomplete-order', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address } = req.body;
    if (!customer_phone || customer_phone.length < 11) return res.json({ success: false });

    const { data: existing } = await supabase.from('orders').select('id').eq('customer_phone', customer_phone).eq('is_incomplete', true).maybeSingle();

    if (!existing) {
      const orderNumber = 'INC-' + Math.floor(1000 + Math.random() * 9000);
      await supabase.from('orders').insert({
        order_number: orderNumber,
        customer_name: customer_name || 'নাম লিখেননি',
        customer_phone,
        shipping_district: shipping_district || 'ঢাকা',
        shipping_address: shipping_address || 'ঠিকানা লিখেননি',
        subtotal: 0,
        delivery_charge: 0,
        grand_total: 0,
        order_status: 'pending',
        is_incomplete: true
      });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false });
  }
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
      const { data: allItems } = await supabase.from('order_items').select('*').in('order_id', orderIds);
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

    const todayStr = new Date().toISOString().slice(0, 10);
    let totalSales = 0;
    let todayOrdersCount = 0;

    valid.forEach(o => {
      totalSales += Number(o.grand_total || 0);
      if (o.created_at && o.created_at.startsWith(todayStr)) {
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
    res.json({ customers: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৮. কাস্টমার ক্যাটাগরি ও রেটিং আপডেট
app.post('/api/admin/customers/update-rating', async (req: Request, res: Response) => {
  try {
    const { customer_id, customer_category, customer_rating, customer_notes } = req.body;
    const updateObj: Record<string, any> = { updated_at: new Date().toISOString() };
    if (customer_category !== undefined) updateObj.customer_category = customer_category;
    if (customer_rating !== undefined) updateObj.customer_rating = Number(customer_rating);
    if (customer_notes !== undefined) updateObj.customer_notes = customer_notes;

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
    const { field, value } = req.body;
    if (field) {
      await supabase.from('site_content').upsert({ id: 'master_content', [field]: value, updated_at: new Date().toISOString() });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
    let products = dbData?.products_json || DEFAULT_PRODUCTS;
    const p = products.find((x: any) => x.id === id);
    if (p) {
      if (name) p.name = name;
      if (regular_price) p.regular_price = Number(regular_price);
      if (price) p.price = Number(price);
      if (image) p.image = image;
      await supabase.from('site_content').upsert({ id: 'master_content', products_json: products, updated_at: new Date().toISOString() });
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
    let products = dbData?.products_json || [...DEFAULT_PRODUCTS];
    const newProd = {
      id: 'prod_' + Date.now(),
      name: name || 'নতুন প্রিমিয়াম কাতুয়া',
      regular_price: Number(regular_price) || 1050,
      price: Number(price) || 750,
      image: image || 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80'
    };
    products.push(newProd);
    await supabase.from('site_content').upsert({ id: 'master_content', products_json: products, updated_at: new Date().toISOString() });
    res.json({ success: true, product: newProd });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/products/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    const { data: dbData } = await supabase.from('site_content').select('products_json').eq('id', 'master_content').maybeSingle();
    let products = dbData?.products_json || [...DEFAULT_PRODUCTS];
    products = products.filter((p: any) => p.id !== id);
    if (products.length === 0) products = [...DEFAULT_PRODUCTS];
    await supabase.from('site_content').upsert({ id: 'master_content', products_json: products, updated_at: new Date().toISOString() });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


// Bulk update selected orders in one request.
app.post('/api/admin/orders/bulk-status', async (req: Request, res: Response) => {
  try {
    const ids = Array.isArray(req.body?.order_ids)
      ? [...new Set(req.body.order_ids.map((id: any) => String(id)).filter(Boolean))]
      : [];
    const status = String(req.body?.status || '');
    const allowed = ['new', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!ids.length) return res.status(400).json({ success: false, error: 'অন্তত একটি অর্ডার নির্বাচন করুন।' });
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'অবৈধ অর্ডার স্ট্যাটাস।' });

    const { data, error } = await supabase
      .from('orders')
      .update({ order_status: status, updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('is_incomplete', false)
      .select('id');
    if (error) throw error;
    return res.json({ success: true, updated: data?.length || 0 });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Mark an order's customer as Good Customer and ensure it exists in the directory.
app.post('/api/admin/customers/mark-good', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, grand_total } = req.body || {};
    const phone = String(customer_phone || '').replace(/\s+/g, '');
    if (!phone) return res.status(400).json({ success: false, error: 'কাস্টমারের ফোন নম্বর পাওয়া যায়নি।' });

    const { data: existing, error: findError } = await supabase
      .from('customers').select('id').eq('customer_phone', phone).maybeSingle();
    if (findError) throw findError;

    const values = {
      customer_name: String(customer_name || '').slice(0, 150),
      shipping_district: String(shipping_district || ''),
      shipping_address: String(shipping_address || ''),
      customer_category: 'Good Customer',
      updated_at: new Date().toISOString()
    };

    let result;
    if (existing) {
      result = await supabase.from('customers').update(values).eq('id', existing.id);
    } else {
      result = await supabase.from('customers').insert({
        customer_phone: phone,
        ...values,
        total_orders: 1,
        total_spent: Number(grand_total) || 0,
        customer_rating: 5
      });
    }
    if (result.error) throw result.error;
    return res.json({ success: true, message: 'কাস্টমার ডিরেক্টরিতে Good Customer হিসেবে যোগ হয়েছে।' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Enterprise Persistent Server live on port ${PORT}`));
