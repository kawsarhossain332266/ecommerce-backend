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

// ২. কাস্টমার অর্ডার চেকআউট (Verifiable Write-First Protocol)
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ success: false, error: 'সব প্রয়োজনীয় তথ্য প্রদান করুন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন', quantity: 1, total_price: 750 }];
    
    let subtotal = 0;
    let totalQty = 0;
    orderItems.forEach((it: any) => {
      subtotal += Number(it.total_price || 750);
      totalQty += Number(it.quantity || 1);
    });

    const { data: cmsData } = await supabase.from('site_content').select('del_inside_charge, del_outside_charge').eq('id', 'master_content').maybeSingle();
    const isDhaka = String(shipping_district).toLowerCase().includes('dhaka') || String(shipping_district).includes('ঢাকা');
    let delivery = isDhaka ? Number(cmsData?.del_inside_charge || 60) : Number(cmsData?.del_outside_charge || 120);

    let discount = 0;
    if (totalQty === 2) discount = 100;
    else if (totalQty >= 3) {
      discount = 250;
      delivery = 0;
    }

    const grandTotal = Math.max(0, subtotal - discount + delivery);
    const orderNumber = 'SO-' + Math.floor(1000 + Math.random() * 9000);

    // পূর্বের ইনকমপ্লিট অর্ডার মোছা
    await supabase.from('orders').delete().eq('customer_phone', customer_phone).eq('is_incomplete', true);

    const orderRecord = {
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে',
      shipping_address,
      subtotal,
      discount_amount: discount,
      delivery_charge: delivery,
      grand_total: grandTotal,
      order_status: 'new',
      is_incomplete: false
    };

    // ১. Supabase orders টেবিলে স্থায়ী ইনসার্ট
    const { data: savedOrder, error: orderError } = await supabase.from('orders').insert(orderRecord).select().single();
    if (orderError) throw orderError;

    // ২. Supabase order_items টেবিলে ইনসার্ট
    if (savedOrder) {
      const itemsPayload = orderItems.map((it: any) => ({
        order_id: savedOrder.id,
        product_name: it.product_name,
        quantity: Math.max(1, Number(it.quantity) || 1),
        unit_price: it.unit_price || 750,
        total_price: it.total_price || 750,
        image_url: it.image_url || ''
      }));
      await supabase.from('order_items').insert(itemsPayload);
    }

    // ৩. কাস্টমার ডিরেক্টরি প্রোফাইল স্বয়ংক্রিয়ভাবে তৈরি বা আপডেট
    try {
      const { data: existCust } = await supabase.from('customers').select('*').eq('customer_phone', customer_phone).maybeSingle();
      if (existCust) {
        await supabase.from('customers').update({
          customer_name,
          shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে',
          shipping_address,
          total_orders: (existCust.total_orders || 1) + 1,
          total_spent: Number(existCust.total_spent || 0) + grandTotal,
          updated_at: new Date().toISOString()
        }).eq('id', existCust.id);
      } else {
        await supabase.from('customers').insert({
          customer_phone,
          customer_name,
          shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে',
          shipping_address,
          total_orders: 1,
          total_spent: grandTotal,
          customer_category: 'Normal Customer',
          customer_rating: 5
        });
      }
    } catch (custErr) {
      console.warn('Customer upsert notification:', custErr);
    }

    sendTelegramAlert(orderRecord, orderItems);

    res.json({
      success: true,
      order_number: orderNumber,
      grand_total: grandTotal
    });
  } catch (err: any) {
    console.error('Checkout failed:', err);
    res.status(500).json({ success: false, error: err.message });
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

app.listen(PORT, () => console.log(`Enterprise Persistent Server live on port ${PORT}`));
