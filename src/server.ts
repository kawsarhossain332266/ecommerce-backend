import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Supabase URL স্যানিটাইজার
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

// টেলিগ্রাম অ্যালার্ট প্রেরক
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

// ================= API ENDPOINTS (DIRECT DATABASE) =================

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

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
    console.error('Store-data fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ২. ইনকমপ্লিট অর্ডার হ্যান্ডলার (সরাসরি Supabase-এ সংরক্ষণ)
app.post('/api/incomplete-order', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address } = req.body;
    if (!customer_phone || customer_phone.length < 11) return res.json({ success: false });

    // আগে থেকে এই নম্বরের ইনকমপ্লিট অর্ডার থাকলে ডুপ্লিকেট রোধ
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

// ৩. নতুন অর্ডার প্লেসমেন্ট (সরাসরি Supabase PostgreSQL-এ স্থায়ীভাবে সেভ)
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ success: false, error: 'সব প্রয়োজনীয় তথ্য দিন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন', quantity: 1, total_price: 750 }];
    
    let subtotal = 0;
    let totalQty = 0;
    orderItems.forEach((it: any) => {
      subtotal += Number(it.total_price || 750);
      totalQty += Number(it.quantity || 1);
    });

    // ডাটাবেস থেকে বর্তমান ডেলিভারি রেট যাচাই
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

    // পূর্বে যদি ইনকমপ্লিট অর্ডার থেকে থাকে তা মুছে ফেলা
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
      order_status: 'pending',
      is_incomplete: false
    };

    // ১. Supabase orders টেবিলে নিশ্চিত ইনসার্ট
    const { data: savedOrder, error: orderError } = await supabase.from('orders').insert(orderRecord).select().single();
    if (orderError) {
      console.error('Supabase Order Insert Error:', orderError);
      throw orderError;
    }

    // ২. Supabase order_items টেবিলে ইনসার্ট
    if (savedOrder) {
      const itemsPayload = orderItems.map((it: any) => ({
        order_id: savedOrder.id,
        product_name: it.product_name,
        quantity: it.quantity || 1,
        unit_price: it.unit_price || 750,
        total_price: it.total_price || 750,
        image_url: it.image_url || ''
      }));
      await supabase.from('order_items').insert(itemsPayload);
    }

    // ৩. টেলিগ্রামে ব্যাকগ্রাউন্ড অ্যালার্ট
    sendTelegramAlert(orderRecord, orderItems);

    res.json({
      success: true,
      order_number: orderNumber,
      grand_total: grandTotal
    });
  } catch (err: any) {
    console.error('Checkout failure:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ৪. অ্যাডমিন অর্ডার তালিকা সরাসরি Supabase থেকে ফেচ
app.get('/api/admin/orders', async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;

    if (status === 'incomplete') {
      const { data, error } = await supabase.from('orders').select('*').eq('is_incomplete', true).order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ orders: data || [] });
    }

    // শুধু মূল অর্ডারসমূহ আনা
    let query = supabase.from('orders').select('*, order_items(*)').eq('is_incomplete', false).order('created_at', { ascending: false });

    if (status && status !== 'all' && status !== 'duplicates') {
      query = query.eq('order_status', status);
    }

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,order_number.ilike.%${search}%`);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    let result = orders || [];

    // ডুপ্লিকেট কাস্টমার ফিল্টারিং
    if (status === 'duplicates') {
      const phoneCounts: Record<string, number> = {};
      result.forEach(o => phoneCounts[o.customer_phone] = (phoneCounts[o.customer_phone] || 0) + 1);
      result = result.filter(o => phoneCounts[o.customer_phone] > 1);
    }

    res.json({ orders: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৫. পূর্ণাঙ্গ অর্ডার অ্যানালাইসিস সরাসরি Supabase ডেটার ওপর
app.get('/api/admin/analytics', async (req: Request, res: Response) => {
  try {
    const { data: allOrders, error } = await supabase.from('orders').select('*').eq('is_incomplete', false);
    if (error) throw error;

    const all = allOrders || [];
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

    const { count: incompleteCount } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('is_incomplete', true);

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
      incompleteCount: incompleteCount || 0,
      duplicateCustomersCount,
      topCustomers: Object.entries(phoneMap).map(([phone, data]) => ({ phone, ...data })).sort((a,b) => b.totalSpent - a.totalSpent).slice(0, 5)
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৬. মেট্রিকস ফেচ
app.get('/api/admin/metrics', async (req: Request, res: Response) => {
  try {
    const { data: allOrders } = await supabase.from('orders').select('order_status, is_incomplete');
    const all = allOrders || [];
    const valid = all.filter(o => !o.is_incomplete);
    const incomplete = all.filter(o => o.is_incomplete);

    res.json({
      total: valid.length,
      pending: valid.filter(o => o.order_status === 'pending').length,
      processing: valid.filter(o => o.order_status === 'processing').length,
      shipped: valid.filter(o => o.order_status === 'shipped').length,
      delivered: valid.filter(o => o.order_status === 'delivered').length,
      cancelled: valid.filter(o => o.order_status === 'cancelled').length,
      incomplete: incomplete.length
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৭. কাস্টমার ও অর্ডার তথ্য আপডেট সরাসরি Supabase-এ
app.post('/api/admin/orders/update-full', async (req: Request, res: Response) => {
  try {
    const { order_id, customer_name, customer_phone, shipping_district, shipping_address, grand_total, order_status } = req.body;
    const { error } = await supabase.from('orders').update({
      customer_name,
      customer_phone,
      shipping_district,
      shipping_address,
      grand_total: Number(grand_total),
      order_status
    }).eq('id', order_id);

    if (error) throw error;
    res.json({ success: true, message: 'অর্ডার তথ্য স্থায়ীভাবে আপডেট হয়েছে!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ৮. অর্ডার স্ট্যাটাস আপডেট
app.post('/api/admin/orders/update-status', async (req: Request, res: Response) => {
  try {
    const { order_id, status } = req.body;
    const { error } = await supabase.from('orders').update({ order_status: status }).eq('id', order_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৯. অর্ডার ডিলিট
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

// ১০. CMS টেক্সট, কালার ও টগল আপডেট (Supabase-এ স্থায়ী সংরক্ষণ)
app.post('/api/admin/cms/update-single', async (req: Request, res: Response) => {
  try {
    const { field, value } = req.body;
    if (field) {
      const payload: any = { id: 'master_content', [field]: value, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('site_content').upsert(payload);
      if (error) throw error;
    }
    res.json({ success: true, message: 'স্থায়ীভাবে সংরক্ষিত হয়েছে!' });
  } catch (e: any) {
    console.error('CMS update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ১১. স্পেসিফিকেশন অ্যাড ও ডিলিট
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

// ১২. প্রোডাক্ট আপডেট ও স্থায়ী সংরক্ষণ
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
    res.status(404).json({ success: false, message: 'প্রোডাক্ট পাওয়া যায়নি' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ১৩. নতুন প্রোডাক্ট যোগ
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

// ১৪. প্রোডাক্ট ডিলিট
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

app.listen(PORT, () => console.log(`Database-First Persistent Server live on port ${PORT}`));
```

---

# পর্ব ৩: অ্যাডমিন প্যানেল XML আপডেট (`admin123s.blogspot.com`)

অ্যাডমিন প্যানেলের **Facebook ও TikTok পিক্সেলের জন্য ডেডিকেটেড ON/OFF সুইচ** যুক্ত করা হয়েছে এবং সরাসরি Supabase ডেটার সঙ্গে সংযুক্ত করা হয়েছে।

আপনার অ্যাডমিন ব্লগের **Theme > Edit HTML**-এ গিয়ে নিচের কোডটি পেস্ট করে **Save** দিন:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:css='false' b:responsive='true' xmlns='http://www.w3.org/1999/xhtml' xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta charset='utf-8'/>
  <meta content='width=device-width, initial-scale=1.0, maximum-scale=1.0' name='viewport'/>
  <title>Shekder Online - Master Admin Panel</title>
  
  <link href='https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700;800&amp;display=swap' rel='stylesheet'/>
  <script src='https://cdn.tailwindcss.com'></script>
  
  <b:skin><![CDATA[
    body { font-family: 'Hind Siliguri', sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 0; }
    .sidebar-active { background: linear-gradient(90deg, #4338ca 0%, #3730a3 100%); color: #ffffff !important; }
    @media print {
      body * { visibility: hidden !important; }
      #print-area, #print-area * { visibility: visible !important; }
      #print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
    }
  ]]></b:skin>
</head>
<body class="antialiased flex h-screen overflow-hidden">

  <!-- লগইন উইন্ডো -->
  <div id="login-modal" class="fixed inset-0 z-50 bg-[#0b1329] flex items-center justify-center p-4">
    <div class="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-5 text-center">
      <div class="inline-block bg-indigo-50 p-3 rounded-2xl text-3xl">🔐</div>
      <div>
        <h2 class="text-2xl font-black text-slate-900">অ্যাডমিন প্রবেশদ্বার</h2>
        <p class="text-xs text-slate-500 mt-1">পাসওয়ার্ড দিন (admin123)</p>
      </div>

      <form onsubmit="handleLogin(event)" class="space-y-3">
        <input type="password" id="admin-pass" required="required" placeholder="পাসওয়ার্ড লিখুন" class="w-full border border-slate-300 rounded-xl px-4 py-3 text-center text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"/>
        <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3 rounded-xl text-sm shadow transition-all">
          লগইন করুন →
        </button>
      </form>
    </div>
  </div>

  <!-- সাইডবার -->
  <aside class="w-64 bg-[#0b1329] text-slate-300 flex flex-col justify-between flex-shrink-0 z-20">
    <div>
      <div class="p-5 flex items-center gap-3 border-b border-slate-800">
        <div class="bg-gradient-to-tr from-amber-500 to-rose-500 p-2 rounded-xl text-xl shadow">🛍️</div>
        <div>
          <h1 class="font-extrabold text-white text-base leading-tight">Shekder Online</h1>
          <span class="text-[11px] text-slate-400 font-medium">Master Admin Panel</span>
        </div>
      </div>

      <nav class="p-3 space-y-1 text-sm font-semibold">
        <button onclick="switchTab('orders')" id="nav-orders" class="sidebar-active w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all shadow">
          <span class="flex items-center gap-3"><span>🛒</span> কাস্টমার অর্ডার</span>
          <span class="bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full font-bold" id="badge-pending">0</span>
        </button>

        <button onclick="switchTab('analytics')" id="nav-analytics" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>📊</span> অর্ডার অ্যানালাইসিস</span>
          <span class="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full">New</span>
        </button>

        <button onclick="switchTab('incomplete')" id="nav-incomplete" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>⏳</span> ইনকমপ্লিট অর্ডার</span>
          <span class="bg-amber-500 text-stone-900 text-xs px-2 py-0.5 rounded-full font-bold" id="badge-incomplete">0</span>
        </button>

        <button onclick="switchTab('duplicates')" id="nav-duplicates" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>👥</span> ডুপ্লিকেট কাস্টমার</span>
          <span>›</span>
        </button>

        <button onclick="switchTab('sections-toggle')" id="nav-sections-toggle" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>🔘</span> সেকশন অন/অফ</span>
          <span>›</span>
        </button>

        <button onclick="switchTab('text-cms')" id="nav-text-cms" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>✏️</span> টেক্সট, কালার ও HTML</span>
          <span>›</span>
        </button>

        <button onclick="switchTab('products-cms')" id="nav-products-cms" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>📦</span> প্রোডাক্ট ও ছবি ম্যানেজার</span>
          <span>›</span>
        </button>

        <button onclick="switchTab('pixels')" id="nav-pixels" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300">
          <span class="flex items-center gap-3"><span>🎯</span> Facebook &amp; TikTok পিক্সেল</span>
          <span>›</span>
        </button>
      </nav>
    </div>

    <div class="p-3 border-t border-slate-800/80 m-3 bg-slate-900/60 rounded-2xl flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-xl bg-indigo-600 text-white font-black flex items-center justify-center text-sm shadow">RM</div>
        <div>
          <div class="text-xs font-bold text-white">Rasel Mahmud</div>
          <div class="text-[10px] text-emerald-400 font-semibold flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Super Admin</div>
        </div>
      </div>
      <button onclick="logoutAdmin()" class="text-slate-400 hover:text-rose-400 p-1.5 text-xs font-bold" title="লগআউট">🚪</button>
    </div>
  </aside>

  <!-- মেইন কন্টেন্ট -->
  <main class="flex-1 flex flex-col h-screen overflow-y-auto">

    <header class="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-10 shadow-sm">
      <h2 class="text-xl font-extrabold text-slate-800" id="page-title">কাস্টমার অর্ডার ম্যানেজমেন্ট</h2>

      <div class="flex items-center gap-3">
        <div class="relative w-72">
          <input type="text" id="global-search" oninput="handleSearch(this.value)" placeholder="অর্ডার আইডি, নাম বা ফোন নম্বর খুঁজুন..." class="w-full pl-9 pr-3 py-2 text-xs bg-slate-100 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"/>
          <span class="absolute left-3 top-2 text-slate-400 text-xs">🔍</span>
        </div>
        <button onclick="loadLiveOrders()" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 text-xs font-bold">🔄 রিফ্রেশ</button>
      </div>
    </header>

    <div class="p-6 space-y-6">

      <!-- ================= TAB 1: কাস্টমার অর্ডার ================= -->
      <section id="tab-orders" class="space-y-6">
        <div class="grid grid-cols-2 md:grid-cols-6 gap-3.5">
          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div class="bg-indigo-50 text-indigo-600 p-3 rounded-xl text-xl">🛒</div>
            <div>
              <div class="text-[11px] text-slate-500 font-bold">মোট অর্ডার</div>
              <div class="text-xl font-black text-slate-900" id="stat-total">0</div>
              <div class="text-[10px] text-emerald-600 font-bold">↑ ডাটাবেজ পারসিস্টেন্ট</div>
            </div>
          </div>

          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div class="bg-amber-50 text-amber-600 p-3 rounded-xl text-xl">🕒</div>
            <div>
              <div class="text-[11px] text-slate-500 font-bold">পেন্ডিং অর্ডার</div>
              <div class="text-xl font-black text-slate-900" id="stat-pending">0</div>
            </div>
          </div>

          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div class="bg-blue-50 text-blue-600 p-3 rounded-xl text-xl">⚙️</div>
            <div>
              <div class="text-[11px] text-slate-500 font-bold">প্রসেসিং</div>
              <div class="text-xl font-black text-slate-900" id="stat-processing">0</div>
            </div>
          </div>

          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div class="bg-emerald-50 text-emerald-600 p-3 rounded-xl text-xl">🚚</div>
            <div>
              <div class="text-[11px] text-slate-500 font-bold">পাঠানো হয়েছে</div>
              <div class="text-xl font-black text-slate-900" id="stat-shipped">0</div>
            </div>
          </div>

          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div class="bg-green-50 text-green-600 p-3 rounded-xl text-xl">✅</div>
            <div>
              <div class="text-[11px] text-slate-500 font-bold">সম্পন্ন</div>
              <div class="text-xl font-black text-slate-900" id="stat-delivered">0</div>
            </div>
          </div>

          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div class="bg-rose-50 text-rose-600 p-3 rounded-xl text-xl">❌</div>
            <div>
              <div class="text-[11px] text-slate-500 font-bold">বাতিল</div>
              <div class="text-xl font-black text-slate-900" id="stat-cancelled">0</div>
            </div>
          </div>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2 text-xs font-bold" id="filter-status-buttons">
            <button onclick="filterStatus('all', this)" class="bg-indigo-600 text-white px-3.5 py-2 rounded-xl shadow-sm">সকল অর্ডার</button>
            <button onclick="filterStatus('pending', this)" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl">পেন্ডিং</button>
            <button onclick="filterStatus('processing', this)" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl">প্রসেসিং</button>
            <button onclick="filterStatus('shipped', this)" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl">পাঠানো হয়েছে</button>
            <button onclick="filterStatus('delivered', this)" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl">সম্পন্ন</button>
            <button onclick="filterStatus('cancelled', this)" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl">বাতিল</button>
          </div>
        </div>

        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                <th class="p-3.5 text-center w-10"><input type="checkbox"/></th>
                <th class="p-3.5">অর্ডার আইডি</th>
                <th class="p-3.5">কাস্টমার তথ্য</th>
                <th class="p-3.5">অর্ডারকৃত পণ্য</th>
                <th class="p-3.5">মোট দাম</th>
                <th class="p-3.5">পেমেন্ট</th>
                <th class="p-3.5">স্ট্যাটাস</th>
                <th class="p-3.5">তারিখ</th>
                <th class="p-3.5 text-center">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody id="order-table-body" class="divide-y divide-slate-100 font-medium">
              <tr>
                <td colspan="9" class="p-8 text-center text-slate-400">অর্ডার লোড হচ্ছে...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ================= TAB: অর্ডার অ্যানালাইসিস ================= -->
      <section id="tab-analytics" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
          <div class="border-b pb-3 flex justify-between items-center">
            <div>
              <h3 class="text-lg font-black text-slate-900">📊 পূর্ণাঙ্গ অর্ডার অ্যানালাইসিস</h3>
              <p class="text-xs text-slate-500">Supabase PostgreSQL ডাটাবেসের তথ্যের ভিত্তিতে রিয়েল-টাইম সেলস রিপোর্ট</p>
            </div>
            <button onclick="loadAnalyticsData()" class="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold">🔄 রিফ্রেশ</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-gradient-to-br from-indigo-500 to-indigo-700 text-white p-5 rounded-2xl shadow-md">
              <span class="text-xs font-semibold text-indigo-100 uppercase">সর্বমোট রাজস্ব (Total Revenue)</span>
              <div class="text-2xl font-black mt-1" id="an-total-rev">৳ 0</div>
              <div class="text-[11px] text-indigo-200 mt-2">মোট অর্ডারের মোট মূল্য</div>
            </div>

            <div class="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white p-5 rounded-2xl shadow-md">
              <span class="text-xs font-semibold text-emerald-100 uppercase">আজকের মোট সেলস</span>
              <div class="text-2xl font-black mt-1" id="an-today-rev">৳ 0</div>
              <div class="text-[11px] text-emerald-200 mt-2" id="an-today-orders">০ টি অর্ডার</div>
            </div>

            <div class="bg-gradient-to-br from-amber-500 to-amber-700 text-white p-5 rounded-2xl shadow-md">
              <span class="text-xs font-semibold text-amber-100 uppercase">ইনকমপ্লিট অর্ডার</span>
              <div class="text-2xl font-black mt-1" id="an-incomplete">0</div>
              <div class="text-[11px] text-amber-200 mt-2">চেকআউটে থেমে যাওয়া গ্রাহক</div>
            </div>

            <div class="bg-gradient-to-br from-rose-500 to-rose-700 text-white p-5 rounded-2xl shadow-md">
              <span class="text-xs font-semibold text-rose-100 uppercase">ডুপ্লিকেট কাস্টমার</span>
              <div class="text-2xl font-black mt-1" id="an-duplicates">0</div>
              <div class="text-[11px] text-rose-200 mt-2">একাধিকবার অর্ডারকারী গ্রাহক</div>
            </div>
          </div>

          <div class="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
            <h4 class="font-bold text-slate-800 text-sm">👑 শীর্ষ কাস্টমার তালিকা (Top Loyal Customers)</h4>
            <div id="top-customers-list" class="space-y-2">
              <div class="text-xs text-slate-400">তথ্য লোড হচ্ছে...</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ================= TAB: ইনকমপ্লিট অর্ডার ================= -->
      <section id="tab-incomplete" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div class="border-b pb-3">
            <h3 class="text-lg font-black text-slate-900">⏳ ইনকমপ্লিট অর্ডার তালিকা</h3>
            <p class="text-xs text-slate-500">যেসব গ্রাহক ওয়েবসাইটে নাম বা ফোন নাম্বার লেখার পর অর্ডার কনফার্ম করেননি, তাদের তালিকা।</p>
          </div>

          <div class="overflow-hidden rounded-2xl border border-slate-200">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="bg-amber-50 text-amber-900 font-bold border-b">
                  <th class="p-3">তারিখ ও সময়</th>
                  <th class="p-3">কাস্টমারের নাম</th>
                  <th class="p-3">মোবাইল নম্বর</th>
                  <th class="p-3">জেলা ও ঠিকানা</th>
                  <th class="p-3 text-center">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody id="incomplete-table-body" class="divide-y font-medium">
                <tr><td colspan="5" class="p-6 text-center text-slate-400">কোনো ইনকমপ্লিট অর্ডার নেই।</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ================= TAB: ডুপ্লিকেট কাস্টমার ================= -->
      <section id="tab-duplicates" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div class="border-b pb-3">
            <h3 class="text-lg font-black text-slate-900">👥 ডুপ্লিকেট কাস্টমার অর্ডার তালিকা</h3>
            <p class="text-xs text-slate-500">একই মোবাইল নম্বর দিয়ে একাধিকবার অর্ডার করা গ্রাহকদের সব অর্ডার এখানে আলাদাভাবে প্রদর্শিত হচ্ছে।</p>
          </div>

          <div class="overflow-hidden rounded-2xl border border-slate-200">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="bg-rose-50 text-rose-900 font-bold border-b">
                  <th class="p-3">অর্ডার আইডি</th>
                  <th class="p-3">কাস্টমার নাম ও ফোন</th>
                  <th class="p-3">ঠিকানা</th>
                  <th class="p-3">মোট বিল</th>
                  <th class="p-3">স্ট্যাটাস</th>
                  <th class="p-3 text-center">ইনভয়েস</th>
                </tr>
              </thead>
              <tbody id="duplicates-table-body" class="divide-y font-medium">
                <tr><td colspan="6" class="p-6 text-center text-slate-400">কোনো ডুপ্লিকেট অর্ডার নেই।</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ================= TAB: সেকশন অন/অফ ================= -->
      <section id="tab-sections-toggle" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div class="border-b pb-3">
            <h3 class="text-lg font-black text-slate-900">🔘 ওয়েবসাইট সেকশন অন/অফ কন্ট্রোলার</h3>
            <p class="text-xs text-slate-500">শাড়ি বা অন্যান্য প্রোডাক্টে সাইজ বা কম্বো দরকার না হলে সংশ্লিষ্ট সেকশনটি অফ রাখুন।</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4" id="section-toggles-container"></div>
        </div>
      </section>

      <!-- ================= TAB: টেক্সট ও কন্টেন্ট এডিটর ================= -->
      <section id="tab-text-cms" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div class="border-b pb-3">
            <h3 class="text-lg font-black text-slate-900">✏️ সম্পূর্ণ ওয়েবসাইট টেক্সট, কালার ও HTML এডিটর</h3>
            <p class="text-xs text-slate-500">প্রতিটি লেখার ফন্ট কালার, ব্যাকগ্রাউন্ড কালার পরিবর্তন করুন অথবা সরাসরি HTML কোডিং বসিয়ে স্টাইল করুন।</p>
          </div>

          <!-- নতুন স্পেসিফিকেশন অ্যাড করার ডেডিকেটেড বক্স -->
          <div class="bg-amber-50/70 p-4 rounded-2xl border border-amber-300 space-y-3">
            <div class="flex justify-between items-center">
              <div>
                <h4 class="font-extrabold text-amber-950 text-sm">✨ প্রোডাক্ট স্পেসিফিকেশন ম্যানেজার</h4>
                <p class="text-xs text-amber-800">প্রয়োজন অনুযায়ী নতুন স্পেসিফিকেশন পয়েন্ট যোগ বা ডিলিট করুন</p>
              </div>
              <button onclick="openAddSpecModal()" class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow flex items-center gap-1">
                <span>＋ Add New Specification</span>
              </button>
            </div>
            <div id="dynamic-specs-list" class="space-y-1.5 pt-1"></div>
          </div>

          <div class="space-y-6" id="cms-fields-container"></div>
        </div>
      </section>

      <!-- ================= TAB: প্রোডাক্ট ও ছবি ম্যানেজার ================= -->
      <section id="tab-products-cms" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div class="border-b pb-3 flex justify-between items-center">
            <div>
              <h3 class="text-lg font-black text-slate-900">📦 প্রোডাক্ট ও ছবি ম্যানেজমেন্ট</h3>
              <p class="text-xs text-slate-500">রেগুলার প্রাইস, অফার প্রাইস ও ছবি পরিবর্তন করুন অথবা নতুন প্রোডাক্ট যোগ করুন</p>
            </div>
            <button onclick="openAddProductModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow">
              <span>＋</span> নতুন প্রোডাক্ট যোগ করুন
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4" id="admin-products-container"></div>
        </div>
      </section>

      <!-- ================= TAB: পিক্সেল ট্র্যাকিং (ON/OFF SWITCH সহ) ================= -->
      <section id="tab-pixels" class="hidden space-y-6">
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <div class="border-b pb-3">
            <h3 class="text-lg font-black text-slate-900">🎯 Facebook &amp; TikTok পিক্সেল সেটআপ ও ট্র্যাকিং</h3>
            <p class="text-xs text-slate-500">পিক্সেল চালু (ON) বা বন্ধ (OFF) রাখুন। বন্ধ করলেও আপনার পিক্সেল আইডি ডাটাবেসে অক্ষত থাকবে।</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <!-- Facebook Pixel Card -->
            <div class="bg-blue-50/60 p-5 rounded-2xl border border-blue-200 space-y-3">
              <div class="flex items-center justify-between">
                <span class="font-extrabold text-blue-700 flex items-center gap-2"><span>🌐</span> Facebook (Meta) Pixel</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" id="fb-pixel-toggle" onchange="togglePixel('fb_enabled', this.checked)" class="sr-only peer"/>
                  <div class="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <div class="flex gap-2">
                <input type="text" id="pixel-fb-val" placeholder="Meta Pixel ID লিখুন" class="w-full border rounded-xl p-2.5 text-xs bg-white font-mono"/>
                <button onclick="saveField('fb_pixel_id', document.getElementById('pixel-fb-val').value)" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 rounded-xl text-xs">Save ID</button>
              </div>
              <p class="text-[10px] text-slate-500">✓ চালু রাখলে PageView, InitiateCheckout ও Purchase ইভেন্ট স্বয়ংক্রিয়ভাবে ট্র্যাক হবে।</p>
            </div>

            <!-- TikTok Pixel Card -->
            <div class="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
              <div class="flex items-center justify-between">
                <span class="font-extrabold text-slate-900 flex items-center gap-2"><span>🎵</span> TikTok Pixel</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" id="tiktok-pixel-toggle" onchange="togglePixel('tiktok_enabled', this.checked)" class="sr-only peer"/>
                  <div class="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div>
                </label>
              </div>
              <div class="flex gap-2">
                <input type="text" id="pixel-tiktok-val" placeholder="TikTok Pixel ID লিখুন" class="w-full border rounded-xl p-2.5 text-xs bg-white font-mono"/>
                <button onclick="saveField('tiktok_pixel_id', document.getElementById('pixel-tiktok-val').value)" class="bg-slate-900 hover:bg-black text-white font-bold px-4 rounded-xl text-xs">Save ID</button>
              </div>
              <p class="text-[10px] text-slate-500">✓ চালু রাখলে PageView, CompletePayment ও ইভেন্ট ট্র্যাক হবে।</p>
            </div>
          </div>
        </div>
      </section>

    </div>
  </main>

  <!-- ================= EDIT ORDER DETAILS MODAL ================= -->
  <div id="edit-order-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center border-b pb-3">
        <h3 class="text-base font-black text-slate-900">✏️ কাস্টমার ও অর্ডার তথ্য এডিট করুন</h3>
        <button onclick="closeEditOrderModal()" class="text-slate-400 text-2xl font-bold">✕</button>
      </div>

      <div>
        <label class="block font-bold text-slate-700 text-xs mb-2">📦 অর্ডারকৃত সকল পণ্যের তালিকা ও ছবি:</label>
        <div id="modal-order-items-cards" class="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border"></div>
      </div>

      <input type="hidden" id="edit-ord-id"/>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
        <div>
          <label class="block font-bold text-slate-600 mb-1">কাস্টমারের নাম *</label>
          <input type="text" id="edit-ord-name" class="w-full border rounded-xl p-2.5 outline-none font-bold"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">মোবাইল নম্বর *</label>
          <input type="text" id="edit-ord-phone" class="w-full border rounded-xl p-2.5 outline-none font-bold"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">ডেলিভারি জেলা *</label>
          <select id="edit-ord-district" class="w-full border rounded-xl p-2.5 outline-none font-bold bg-white">
            <option value="ঢাকা">ঢাকা</option>
            <option value="ঢাকার বাইরে">ঢাকার বাইরে</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">সর্বমোট প্রদেয় বিল (৳) *</label>
          <input type="number" id="edit-ord-total" class="w-full border rounded-xl p-2.5 outline-none font-black text-indigo-600"/>
        </div>
        <div class="col-span-full">
          <label class="block font-bold text-slate-600 mb-1">সম্পূর্ণ ডেলিভারি ঠিকানা *</label>
          <textarea id="edit-ord-address" rows="2" class="w-full border rounded-xl p-2.5 outline-none font-medium"></textarea>
        </div>
        <div class="col-span-full">
          <label class="block font-bold text-slate-600 mb-1">অর্ডার স্ট্যাটাস</label>
          <select id="edit-ord-status" class="w-full border rounded-xl p-2.5 outline-none font-bold bg-white">
            <option value="pending">🕒 পেন্ডিং</option>
            <option value="processing">⚙️ প্রসেসিং</option>
            <option value="shipped">🚚 পাঠানো হয়েছে</option>
            <option value="delivered">✅ সম্পন্ন</option>
            <option value="cancelled">❌ বাতিল</option>
          </select>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-3 border-t">
        <button onclick="closeEditOrderModal()" class="bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs">বাতিল</button>
        <button onclick="saveOrderEdits()" class="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl text-xs shadow">✓ আপডেট সংরক্ষণ করুন</button>
      </div>
    </div>
  </div>

  <!-- ================= ADD SPECIFICATION MODAL ================= -->
  <div id="add-spec-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b pb-3">
        <h3 class="text-base font-black text-slate-900">নতুন স্পেসিফিকেশন যুক্ত করুন</h3>
        <button onclick="closeAddSpecModal()" class="text-slate-400 text-2xl font-bold">✕</button>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-600 mb-1">স্পেসিফিকেশন টেক্সট বা HTML:</label>
        <textarea id="new-spec-text" rows="3" placeholder="যেমন: ১০০% ওয়াশ গ্যারান্টি সম্পন্ন ফেব্রিক।" class="w-full border border-slate-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-amber-500"></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t">
        <button onclick="closeAddSpecModal()" class="bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs">বাতিল</button>
        <button onclick="submitNewSpec()" class="bg-amber-600 text-white font-bold px-6 py-2 rounded-xl text-xs shadow">＋ যুক্ত করুন</button>
      </div>
    </div>
  </div>

  <!-- ================= EDIT CMS TEXT MODAL ================= -->
  <div id="edit-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b pb-3">
        <div>
          <span class="text-[10px] font-bold text-indigo-600 uppercase tracking-widest" id="modal-section-name">SECTION</span>
          <h3 class="text-base font-black text-slate-900" id="modal-field-title">টেক্সট বা কালার কোড এডিট</h3>
        </div>
        <button onclick="closeEditModal()" class="text-slate-400 hover:text-slate-800 text-2xl font-bold">✕</button>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-600 mb-1">নতুন টেক্সট, কালার কোড (যেমন: #ea580c) বা কাস্টম HTML লিখুন:</label>
        <textarea id="modal-input-val" rows="4" class="w-full border border-slate-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono"></textarea>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t">
        <button onclick="closeEditModal()" class="bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs">বাতিল</button>
        <button onclick="submitModalEdit()" class="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl text-xs shadow">✓ Save Changes</button>
      </div>
    </div>
  </div>

  <!-- ================= EDIT PRODUCT MODAL ================= -->
  <div id="edit-prod-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b pb-3">
        <h3 class="text-base font-black text-slate-900">✏️ প্রোডাক্ট এডিট করুন</h3>
        <button onclick="closeEditProductModal()" class="text-slate-400 text-2xl font-bold">✕</button>
      </div>

      <input type="hidden" id="edit-prod-id"/>
      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-bold text-slate-600 mb-1">প্রোডাক্টের নাম *</label>
          <input type="text" id="edit-prod-name" class="w-full border rounded-xl p-2.5 outline-none font-bold"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">রেগুলার প্রাইস (আসল মূল্য) ৳ *</label>
          <input type="number" id="edit-prod-reg-price" class="w-full border rounded-xl p-2.5 outline-none font-bold text-slate-500"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">অফার প্রাইস (বিক্রয় মূল্য) ৳ *</label>
          <input type="number" id="edit-prod-price" class="w-full border rounded-xl p-2.5 outline-none font-bold text-orange-600"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">ছবির URL (Image Link) *</label>
          <input type="text" id="edit-prod-image" class="w-full border rounded-xl p-2.5 outline-none font-mono"/>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t">
        <button onclick="closeEditProductModal()" class="bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs">বাতিল</button>
        <button onclick="saveProductEdits()" class="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl text-xs shadow">✓ আপডেট করুন</button>
      </div>
    </div>
  </div>

  <!-- ================= ADD NEW PRODUCT MODAL ================= -->
  <div id="add-prod-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 hidden">
    <div class="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b pb-3">
        <h3 class="text-base font-black text-slate-900">নতুন প্রোডাক্ট যুক্ত করুন</h3>
        <button onclick="closeAddProductModal()" class="text-slate-400 text-2xl font-bold">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-bold text-slate-600 mb-1">প্রোডাক্টের নাম *</label>
          <input type="text" id="new-prod-name" placeholder="যেমন: কাতুয়া - ব্ল্যাক এডিশন" class="w-full border rounded-xl p-2.5 outline-none font-bold"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">রেগুলার প্রাইস (আসল মূল্য) ৳</label>
          <input type="number" id="new-prod-reg-price" placeholder="যেমন: 1050" class="w-full border rounded-xl p-2.5 outline-none font-bold"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">বিক্রয় মূল্য (অফার মূল্য) ৳ *</label>
          <input type="number" id="new-prod-price" placeholder="যেমন: 750" class="w-full border rounded-xl p-2.5 outline-none font-bold text-orange-600"/>
        </div>
        <div>
          <label class="block font-bold text-slate-600 mb-1">ছবির URL (Image Link) *</label>
          <input type="text" id="new-prod-image" placeholder="https://..." class="w-full border rounded-xl p-2.5 outline-none font-mono"/>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t">
        <button onclick="closeAddProductModal()" class="bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs">বাতিল</button>
        <button onclick="submitNewProduct()" class="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl text-xs shadow">যোগ করুন</button>
      </div>
    </div>
  </div>

  <div id="print-area" class="hidden"></div>
  <div style="display:none;"><b:section id='main' showaddelement='no'/></div>

  <script type="text/javascript">
    //<![CDATA[
    const API_BASE_URL = 'https://my-store-api-z3gi.onrender.com';
    let allOrders = [];
    let currentFilter = 'all';
    let currentEditingField = null;

    let siteContentCache = {
      show_hero: true,
      show_gallery: true,
      show_desc: true,
      show_specs: true,
      show_size_chart: true,
      show_combo: true,
      show_delivery: true,

      store_name: 'স্বপ্ন লাইফস্টাইল',
      store_name_color: '#ea580c',
      store_tagline: 'Premium Menswear Brand',
      store_tagline_color: '#78716c',
      header_btn_text: 'অর্ডার করুন 👉',
      header_btn_bg: '#ea580c',
      header_btn_color: '#ffffff',
      header_bg_color: '#ffffff',

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
      fb_enabled: true,
      tiktok_pixel_id: '',
      tiktok_enabled: true
    };

    let liveProducts = [
      { id: 'prod_1', name: 'কাতুয়া - অলিভ গ্রিন', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80' },
      { id: 'prod_2', name: 'কাতুয়া - রয়েল ব্লু', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80' },
      { id: 'prod_3', name: 'কাতুয়া - লাইট পিংক', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80' },
      { id: 'prod_4', name: 'কাতুয়া - মেরুন রেড', regular_price: 1050, price: 750, image: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80' }
    ];

    const EDITABLE_FIELDS = [
      { key: 'store_name', title: 'ই-কমার্স ওয়েবসাইটের নাম (HTML সাপোর্টেড)', section: 'Store Branding & Header' },
      { key: 'store_name_color', title: 'স্টোর নামের ফন্ট কালার (যেমন: #ea580c)', section: 'Store Branding & Header' },
      { key: 'store_tagline', title: 'ব্র্যান্ডের সাব-টাইটেল', section: 'Store Branding & Header' },
      { key: 'store_tagline_color', title: 'ট্যাগলাইন ফন্ট কালার (যেমন: #78716c)', section: 'Store Branding & Header' },
      { key: 'header_btn_text', title: 'হেডার বাটন টেক্সট', section: 'Store Branding & Header' },
      { key: 'header_btn_bg', title: 'হেডার বাটনের ব্যাকগ্রাউন্ড কালার (যেমন: #ea580c)', section: 'Store Branding & Header' },
      { key: 'header_btn_color', title: 'হেডার বাটনের টেক্সট কালার (যেমন: #ffffff)', section: 'Store Branding & Header' },
      { key: 'header_bg_color', title: 'হেডারের মূল ব্যাকগ্রাউন্ড কালার (যেমন: #ffffff)', section: 'Store Branding & Header' },

      { key: 'hero_headline', title: 'হিরো মেইন হেডলাইন (HTML সাপোর্টেড)', section: 'Hero Section' },
      { key: 'hero_headline_color', title: 'হিরো হেডলাইন ফন্ট কালার (যেমন: #ffffff)', section: 'Hero Section' },
      { key: 'hero_discount_badge', title: '৩০% ডিসকাউন্ট টেক্সট', section: 'Hero Section' },
      { key: 'hero_discount_color', title: 'ডিসকাউন্ট টেক্সট কালার (যেমন: #c2410c)', section: 'Hero Section' },
      { key: 'hero_subtitle', title: 'হিরো সাব-টাইটেল বিবরণ', section: 'Hero Section' },
      { key: 'hero_subtitle_color', title: 'হিরো সাব-টাইটেল কালার (যেমন: #ffedd5)', section: 'Hero Section' },
      { key: 'hero_btn_text', title: 'হিরো বাটন টেক্সট', section: 'Hero Section' },

      { key: 'size_section_title', title: 'সাইজ চার্ট টাইটেল', section: 'Size Measurement Chart' },
      { key: 'size_title_color', title: 'সাইজ চার্ট টাইটেল কালার', section: 'Size Measurement Chart' },
      { key: 'size_section_subtitle', title: 'সাইজ চার্ট সাব-টাইটেল', section: 'Size Measurement Chart' },
      { key: 'size_m_len', title: 'M সাইজ দৈর্ঘ্য', section: 'Size Measurement Chart' },
      { key: 'size_m_chest', title: 'M সাইজ বুক', section: 'Size Measurement Chart' },
      { key: 'size_l_len', title: 'L সাইজ দৈর্ঘ্য', section: 'Size Measurement Chart' },
      { key: 'size_l_chest', title: 'L সাইজ বুক', section: 'Size Measurement Chart' },
      { key: 'size_xl_len', title: 'XL সাইজ দৈর্ঘ্য', section: 'Size Measurement Chart' },
      { key: 'size_xl_chest', title: 'XL সাইজ বুক', section: 'Size Measurement Chart' },
      { key: 'size_xxl_len', title: 'XXL সাইজ দৈর্ঘ্য', section: 'Size Measurement Chart' },
      { key: 'size_xxl_chest', title: 'XXL সাইজ বুক', section: 'Size Measurement Chart' },
      { key: 'size_note_1', title: 'সাইজ চার্ট নোট ১ (সিরিয়াল লিস্ট)', section: 'Size Measurement Chart' },
      { key: 'size_note_2', title: 'সাইজ চার্ট নোট ২ (সিরিয়াল লিস্ট)', section: 'Size Measurement Chart' },

      { key: 'combo2_badge', title: '২ পিস কার্ডের ব্যাজ', section: 'Special Combo Offer' },
      { key: 'combo2_title', title: 'দুই পিস প্যাকেজ রেট শিরোনাম', section: 'Special Combo Offer' },
      { key: 'combo2_reg_price', title: '২ পিস রেগুলার মূল্য', section: 'Special Combo Offer' },
      { key: 'combo2_offer_price', title: '২ পিস অফার মূল্য', section: 'Special Combo Offer' },
      { key: 'combo2_discount_tag', title: '২ পিস ডিসকাউন্ট ট্যাগ', section: 'Special Combo Offer' },
      { key: 'combo3_badge', title: '৩ পিস কার্ডের ব্যাজ', section: 'Special Combo Offer' },
      { key: 'combo3_title', title: 'তিন পিস মেগা প্যাকেজ রেট শিরোনাম', section: 'Special Combo Offer' },
      { key: 'combo3_reg_price', title: '৩ পিস রেগুলার মূল্য', section: 'Special Combo Offer' },
      { key: 'combo3_offer_price', title: '৩ পিস অফার মূল্য', section: 'Special Combo Offer' },
      { key: 'combo3_discount_tag', title: '৩ পিস ক্যাশ ডিসকাউন্ট ট্যাগ', section: 'Special Combo Offer' },
      { key: 'combo3_delivery_tag', title: '৩ পিস ফ্রি ডেলিভারি ট্যাগ', section: 'Special Combo Offer' },

      { key: 'spec_section_title', title: 'স্পেসিফিকেশন সেকশন টাইটেল', section: 'Specifications' },
      { key: 'del_inside_charge', title: 'ঢাকার ভেতরে ডেলিভারি চার্জ', section: 'Delivery Settings' },
      { key: 'del_outside_charge', title: 'ঢাকার বাইরে ডেলিভারি চার্জ', section: 'Delivery Settings' },
      { key: 'office_address', title: 'অফিসের পূর্ণ ঠিকানা', section: 'Contact & Office' },
      { key: 'contact_phone', title: 'হেল্পলাইন মোবাইল নম্বর', section: 'Contact & Office' },
      { key: 'contact_whatsapp', title: 'হোয়াটসঅ্যাপ নম্বর', section: 'Contact & Office' },
      { key: 'policy_about', title: 'আমাদের সম্পর্কে', section: 'Policy & Pages' },
      { key: 'policy_terms', title: 'টার্মস অ্যান্ড কন্ডিশন', section: 'Policy & Pages' },
      { key: 'policy_return', title: 'অর্ডার ও রিটার্ন পলিসি', section: 'Policy & Pages' }
    ];

    const SECTION_TOGGLES = [
      { key: 'show_hero', title: 'হিরো সেকশন (Hero Banner & Timer)' },
      { key: 'show_gallery', title: 'কালার অ্যান্ড ডিজাইন অপশন গ্যালারি' },
      { key: 'show_desc', title: 'পণ্যের বিবরণ সেকশন' },
      { key: 'show_specs', title: 'প্রোডাক্ট স্পেসিফিকেশন সেকশন' },
      { key: 'show_size_chart', title: 'সাইজ চার্ট (Size Chart - শাড়িতে অফ করতে পারেন)' },
      { key: 'show_combo', title: 'স্পেশাল কম্বো অফার সেকশন' },
      { key: 'show_delivery', title: 'ডেলিভারি তথ্য বক্স' }
    ];

    function checkAuth() {
      if (localStorage.getItem('admin_login_status') === 'active') {
        document.getElementById('login-modal').classList.add('hidden');
        bootApp();
      }
    }

    function handleLogin(e) {
      e.preventDefault();
      if (document.getElementById('admin-pass').value === 'admin123') {
        localStorage.setItem('admin_login_status', 'active');
        document.getElementById('login-modal').classList.add('hidden');
        bootApp();
      } else {
        alert('ভুল পাসওয়ার্ড! (admin123 দিন)');
      }
    }

    function logoutAdmin() {
      localStorage.removeItem('admin_login_status');
      window.location.reload();
    }

    function bootApp() {
      renderSectionToggles();
      renderDynamicSpecs();
      renderTextCmsList();
      renderProductsCards();

      loadMetrics();
      loadLiveOrders();
      syncServerData();

      setInterval(loadLiveOrders, 4000);
      setInterval(loadMetrics, 4000);
    }

    function renderSectionToggles() {
      const container = document.getElementById('section-toggles-container');
      if (!container) return;
      container.innerHTML = '';

      SECTION_TOGGLES.forEach(sec => {
        const isChecked = siteContentCache[sec.key] !== false;
        const div = document.createElement('div');
        div.className = 'bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-3 shadow-sm';
        div.innerHTML = `
          <div>
            <div class="text-xs font-black text-slate-800">${sec.title}</div>
            <div class="text-[10px] text-slate-500 font-semibold mt-0.5">${isChecked ? '✅ বর্তমানে চালু (Active)' : '❌ বন্ধ (Hidden)'}</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" ${isChecked ? 'checked="checked"' : ''} onchange="toggleSection('${sec.key}', this.checked)" class="sr-only peer"/>
            <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        `;
        container.appendChild(div);
      });
    }

    async function toggleSection(key, val) {
      siteContentCache[key] = val;
      renderSectionToggles();
      await fetch(`${API_BASE_URL}/api/admin/cms/update-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: key, value: val })
      });
    }

    async function togglePixel(key, val) {
      siteContentCache[key] = val;
      await fetch(`${API_BASE_URL}/api/admin/cms/update-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: key, value: val })
      });
      alert(val ? '✅ পিক্সেল চালু (ON) করা হয়েছে!' : '❌ পিক্সেল বন্ধ (OFF) করা হয়েছে!');
    }

    async function syncServerData() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/store-data`);
        const data = await res.json();
        if (data.content && Object.keys(data.content).length > 0) {
          siteContentCache = { ...siteContentCache, ...data.content };
          renderSectionToggles();
          renderDynamicSpecs();
          renderTextCmsList();
          if (siteContentCache.fb_pixel_id) document.getElementById('pixel-fb-val').value = siteContentCache.fb_pixel_id;
          if (siteContentCache.tiktok_pixel_id) document.getElementById('pixel-tiktok-val').value = siteContentCache.tiktok_pixel_id;
          document.getElementById('fb-pixel-toggle').checked = (siteContentCache.fb_enabled !== false);
          document.getElementById('tiktok-pixel-toggle').checked = (siteContentCache.tiktok_enabled !== false);
        }
        if (data.products && data.products.length > 0) {
          liveProducts = data.products;
          renderProductsCards();
        }
      } catch (e) {}
    }

    async function loadLiveOrders() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/orders?status=${currentFilter}`);
        const data = await res.json();
        allOrders = data.orders || [];

        if (currentFilter === 'incomplete') {
          renderIncompleteTable(allOrders);
        } else if (currentFilter === 'duplicates') {
          renderDuplicatesTable(allOrders);
        } else {
          renderOrdersTable(allOrders);
        }
      } catch (e) {}
    }

    async function loadMetrics() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/metrics`);
        const m = await res.json();
        document.getElementById('stat-total').innerText = m.total || 0;
        document.getElementById('stat-pending').innerText = m.pending || 0;
        document.getElementById('stat-processing').innerText = m.processing || 0;
        document.getElementById('stat-shipped').innerText = m.shipped || 0;
        document.getElementById('stat-delivered').innerText = m.delivered || 0;
        document.getElementById('stat-cancelled').innerText = m.cancelled || 0;
        document.getElementById('badge-pending').innerText = m.pending || 0;
        document.getElementById('badge-incomplete').innerText = m.incomplete || 0;
      } catch (e) {}
    }

    async function loadAnalyticsData() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/analytics`);
        const a = await res.json();

        document.getElementById('an-total-rev').innerText = `৳ ${a.totalRevenue || 0}`;
        document.getElementById('an-today-rev').innerText = `৳ ${a.todayRevenue || 0}`;
        document.getElementById('an-today-orders').innerText = `${a.todayOrders || 0} টি অর্ডার`;
        document.getElementById('an-incomplete').innerText = a.incompleteCount || 0;
        document.getElementById('an-duplicates').innerText = a.duplicateCustomersCount || 0;

        const custList = document.getElementById('top-customers-list');
        custList.innerHTML = '';
        if (a.topCustomers && a.topCustomers.length > 0) {
          a.topCustomers.forEach((c, idx) => {
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center bg-white p-2.5 rounded-xl border text-xs';
            div.innerHTML = `
              <div>
                <span class="font-bold text-slate-900">${idx + 1}. ${c.name}</span>
                <span class="text-slate-500 font-mono ml-2">(${c.phone})</span>
              </div>
              <div class="text-right">
                <span class="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-bold">${c.count} টি অর্ডার</span>
                <span class="font-black text-orange-600 ml-2">৳ ${c.totalSpent}</span>
              </div>
            `;
            custList.appendChild(div);
          });
        } else {
          custList.innerHTML = '<div class="text-xs text-slate-400">পর্যাপ্ত অর্ডার ডাটা নেই।</div>';
        }
      } catch (e) {}
    }

    function renderOrdersTable(orders) {
      const tbody = document.getElementById('order-table-body');
      tbody.innerHTML = '';

      if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400">কোনো অর্ডার পাওয়া যায়নি।</td></tr>';
        return;
      }

      orders.forEach(o => {
        const items = o.order_items || [];
        const itemTitle = items[0]?.product_name || 'কাতুয়া কালেকশন';
        const itemImg = items[0]?.image_url || 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=80&q=80';
        const totalItemsCount = items.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
        const formattedDate = new Date(o.created_at).toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors border-b';
        tr.innerHTML = `
          <td class="p-3.5 text-center"><input type="checkbox"/></td>
          <td class="p-3.5 font-bold text-indigo-600">#${o.order_number}</td>
          <td class="p-3.5">
            <div class="font-bold text-slate-900">${o.customer_name}</div>
            <div class="text-[11px] text-slate-500 font-mono">${o.customer_phone}</div>
            <div class="text-[10px] text-slate-400">📍 ${o.shipping_address}, ${o.shipping_district}</div>
          </td>
          <td class="p-3.5">
            <div class="flex items-center gap-2">
              <img src="${itemImg}" class="w-9 h-9 rounded-lg object-cover border"/>
              <div>
                <div class="font-bold text-slate-800">${itemTitle}</div>
                <div class="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-0.5">মোট ${totalItemsCount}টি পণ্য</div>
              </div>
            </div>
          </td>
          <td class="p-3.5 font-black text-slate-900">৳ ${o.grand_total}</td>
          <td class="p-3.5"><span class="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-[10px]">COD</span></td>
          <td class="p-3.5">
            <select onchange="updateOrderStatus('${o.id}', this.value)" class="text-[11px] font-bold border rounded-lg p-1 bg-white outline-none cursor-pointer">
              <option value="pending" ${o.order_status === 'pending' ? 'selected' : ''}>🕒 পেন্ডিং</option>
              <option value="processing" ${o.order_status === 'processing' ? 'selected' : ''}>⚙️ প্রসেসিং</option>
              <option value="shipped" ${o.order_status === 'shipped' ? 'selected' : ''}>🚚 পাঠানো হয়েছে</option>
              <option value="delivered" ${o.order_status === 'delivered' ? 'selected' : ''}>✅ সম্পন্ন</option>
              <option value="cancelled" ${o.order_status === 'cancelled' ? 'selected' : ''}>❌ বাতিল</option>
            </select>
          </td>
          <td class="p-3.5 text-slate-500 font-medium">${formattedDate}</td>
          <td class="p-3.5 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="openEditOrderModal('${o.id}')" class="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg font-bold" title="তথ্য এডিট করুন">✏️</button>
              <button onclick="printOrderInvoice('${o.id}')" class="p-1.5 hover:bg-slate-200 text-slate-700 rounded-lg" title="ইনভয়েস প্রিন্ট">🖨️</button>
              <button onclick="removeOrder('${o.id}')" class="p-1.5 hover:bg-rose-100 text-rose-600 rounded-lg" title="ডিলিট">🗑️</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    function renderIncompleteTable(orders) {
      const tbody = document.getElementById('incomplete-table-body');
      tbody.innerHTML = '';

      if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400">কোনো ইনকমপ্লিট অর্ডার পাওয়া যায়নি।</td></tr>';
        return;
      }

      orders.forEach(o => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-amber-50/50 border-b';
        tr.innerHTML = `
          <td class="p-3 text-slate-500">${new Date(o.created_at).toLocaleTimeString('bn-BD')}</td>
          <td class="p-3 font-bold text-slate-900">${o.customer_name}</td>
          <td class="p-3 font-mono font-bold text-indigo-600"><a href="tel:${o.customer_phone}">📞 ${o.customer_phone}</a></td>
          <td class="p-3 text-slate-600">${o.shipping_address}, ${o.shipping_district}</td>
          <td class="p-3 text-center">
            <button onclick="removeOrder('${o.id}')" class="p-1.5 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold">ডিলিট</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    function renderDuplicatesTable(orders) {
      const tbody = document.getElementById('duplicates-table-body');
      tbody.innerHTML = '';

      if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400">কোনো ডুপ্লিকেট অর্ডার পাওয়া যায়নি।</td></tr>';
        return;
      }

      orders.forEach(o => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-rose-50/40 border-b';
        tr.innerHTML = `
          <td class="p-3 font-bold text-rose-600">#${o.order_number}</td>
          <td class="p-3">
            <div class="font-bold text-slate-900">${o.customer_name}</div>
            <div class="font-mono text-xs text-indigo-600 font-bold">${o.customer_phone}</div>
          </td>
          <td class="p-3 text-slate-600">${o.shipping_address}, ${o.shipping_district}</td>
          <td class="p-3 font-black text-slate-900">৳ ${o.grand_total}</td>
          <td class="p-3"><span class="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">${o.order_status}</span></td>
          <td class="p-3 text-center">
            <button onclick="printOrderInvoice('${o.id}')" class="p-1 hover:bg-slate-200 rounded text-slate-700">🖨️</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    async function updateOrderStatus(id, status) {
      await fetch(`${API_BASE_URL}/api/admin/orders/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, status })
      });
      loadMetrics();
    }

    function openEditOrderModal(orderId) {
      const o = allOrders.find(x => x.id === orderId);
      if (!o) return;

      document.getElementById('edit-ord-id').value = o.id;
      document.getElementById('edit-ord-name').value = o.customer_name;
      document.getElementById('edit-ord-phone').value = o.customer_phone;
      document.getElementById('edit-ord-district').value = o.shipping_district;
      document.getElementById('edit-ord-address').value = o.shipping_address;
      document.getElementById('edit-ord-total').value = o.grand_total;
      document.getElementById('edit-ord-status').value = o.order_status;

      const container = document.getElementById('modal-order-items-cards');
      container.innerHTML = '';
      const items = o.order_items || [];

      items.forEach(it => {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2.5 bg-white p-2 rounded-xl border';
        div.innerHTML = `
          <img src="${it.image_url || 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=80&q=80'}" class="w-12 h-12 object-cover rounded-lg border"/>
          <div class="overflow-hidden">
            <div class="font-bold text-slate-900 text-[11px] truncate">${it.product_name}</div>
            <div class="text-[10px] text-slate-500 font-semibold">পরিমাণ: ${it.quantity} টি | সাইজ: ${it.size || 'L'}</div>
            <div class="text-[10px] text-orange-600 font-black">মূল্য: ৳ ${it.total_price}</div>
          </div>
        `;
        container.appendChild(div);
      });

      document.getElementById('edit-order-modal').classList.remove('hidden');
    }

    function closeEditOrderModal() {
      document.getElementById('edit-order-modal').classList.add('hidden');
    }

    async function saveOrderEdits() {
      const payload = {
        order_id: document.getElementById('edit-ord-id').value,
        customer_name: document.getElementById('edit-ord-name').value.trim(),
        customer_phone: document.getElementById('edit-ord-phone').value.trim(),
        shipping_district: document.getElementById('edit-ord-district').value,
        shipping_address: document.getElementById('edit-ord-address').value.trim(),
        grand_total: document.getElementById('edit-ord-total').value.trim(),
        order_status: document.getElementById('edit-ord-status').value
      };

      await fetch(`${API_BASE_URL}/api/admin/orders/update-full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      alert('✅ কাস্টমার ও অর্ডার তথ্য সফলভাবে আপডেট হয়েছে!');
      closeEditOrderModal();
      loadLiveOrders();
      loadMetrics();
    }

    function printOrderInvoice(id) {
      const o = allOrders.find(x => x.id === id);
      if (!o) return;
      const pa = document.getElementById('print-area');
      
      let itemsListHtml = '';
      (o.order_items || []).forEach((it, idx) => {
        itemsListHtml += `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px 8px; font-weight:bold;">${idx + 1}</td>
            <td style="padding:10px 8px;"><b>${it.product_name}</b></td>
            <td style="padding:10px 8px; text-align:center; font-weight:bold;">${it.quantity}</td>
            <td style="padding:10px 8px; text-align:right; font-weight:bold; color:#ea580c;">৳ ${it.total_price}</td>
          </tr>
        `;
      });

      pa.innerHTML = `
        <div style="padding:30px; font-family:sans-serif; max-width:680px; margin:0 auto; border:2px solid #fdba74; border-radius:20px; background:#fff;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #ea580c; padding-bottom:12px;">
            <div>
              <h2 style="color:#ea580c; margin:0; font-size:24px; font-weight:900;">${siteContentCache.store_name || 'স্বপ্ন লাইফস্টাইল'}</h2>
              <p style="font-size:12px; color:#666; margin:4px 0 0 0;">${siteContentCache.office_address || 'মোহাম্মদপুর, ঢাকা'} | হেল্পলাইন: ${siteContentCache.contact_phone || '01700000000'}</p>
            </div>
            <div style="text-align:right;">
              <span style="background:#dcfce7; color:#166534; font-weight:bold; padding:4px 10px; border-radius:20px; font-size:11px;">অর্ডার ভেরিফাইড</span>
              <div style="font-size:14px; font-weight:bold; margin-top:6px;">#${o.order_number}</div>
              <div style="font-size:11px; color:#888;">${new Date(o.created_at).toLocaleDateString('bn-BD')}</div>
            </div>
          </div>
          <div style="margin:16px 0; background:#f8fafc; padding:12px; border-radius:12px; font-size:12px; line-height:1.6;">
            <div><b>গ্রাহকের নাম:</b> ${o.customer_name}</div>
            <div><b>মোবাইল নম্বর:</b> ${o.customer_phone}</div>
            <div><b>ডেলিভারি ঠিকানা:</b> ${o.shipping_address}, ${o.shipping_district}</div>
          </div>
          <table style="width:100%; font-size:12px; border-collapse:collapse;">
            <thead>
              <tr style="background:#fff7ed; text-align:left; color:#c2410c;">
                <th style="padding:8px;">#</th><th style="padding:8px;">পণ্য বিবরণ</th><th style="padding:8px; text-align:center;">পরিমাণ</th><th style="padding:8px; text-align:right;">মোট টাকা</th>
              </tr>
            </thead>
            <tbody>${itemsListHtml}</tbody>
          </table>
          <div style="margin-top:15px; border-top:2px solid #eee; padding-top:10px; text-align:right; font-size:14px;">
            <div style="font-size:18px; font-weight:900; color:#ea580c;">সর্বমোট প্রদেয় বিল: ৳ ${o.grand_total}</div>
            <div style="font-size:11px; color:#16a34a; font-weight:bold; margin-top:2px;">পেমেন্ট: ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে পরিশোধ)</div>
          </div>
          <div style="background:#fffbeb; padding:10px; border-left:4px solid #f59e0b; font-size:11px; margin-top:15px; border-radius:6px; color:#92400e;">
            <b>⚠️ বিশেষ দ্রষ্টব্য:</b> ডেলিভারি রাইডার থাকাকালীন প্রোডাক্ট চেক করে রিসিভ করবেন। কোনো সমস্যা থাকলে রাইডারের কাছে রিটার্ন করতে পারবেন।
          </div>
        </div>
      `;
      pa.classList.remove('hidden');
      window.print();
      pa.classList.add('hidden');
    }

    async function removeOrder(id) {
      if (!confirm('আপনি কি এই অর্ডারটি ডিলিট করতে চান?')) return;
      await fetch(`${API_BASE_URL}/api/admin/orders/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id })
      });
      loadLiveOrders();
      loadMetrics();
    }

    function filterStatus(st, btn) {
      currentFilter = st;
      document.querySelectorAll('#filter-status-buttons button').forEach(b => {
        b.className = 'bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl';
      });
      btn.className = 'bg-indigo-600 text-white px-3.5 py-2 rounded-xl shadow-sm';
      loadLiveOrders();
    }

    function handleSearch(q) {
      q = q.toLowerCase();
      const filtered = allOrders.filter(o => 
        o.customer_name?.toLowerCase().includes(q) ||
        o.customer_phone?.includes(q) ||
        o.order_number?.toLowerCase().includes(q)
      );
      renderOrdersTable(filtered);
    }

    function renderDynamicSpecs() {
      const list = document.getElementById('dynamic-specs-list');
      if (!list) return;
      list.innerHTML = '';
      const specs = siteContentCache.dynamic_specs || [];

      specs.forEach((s, idx) => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center bg-white p-2.5 rounded-xl border border-amber-200 text-xs';
        div.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="text-orange-600 font-bold">🔶 ${idx + 1}.</span>
            <span class="font-medium text-slate-800">${s}</span>
          </div>
          <button onclick="deleteSpec(${idx})" class="p-1 hover:bg-rose-100 text-rose-600 rounded text-xs font-bold" title="মুছে ফেলুন">🗑️</button>
        `;
        list.appendChild(div);
      });
    }

    function openAddSpecModal() {
      document.getElementById('new-spec-text').value = '';
      document.getElementById('add-spec-modal').classList.remove('hidden');
    }

    function closeAddSpecModal() {
      document.getElementById('add-spec-modal').classList.add('hidden');
    }

    async function submitNewSpec() {
      const text = document.getElementById('new-spec-text').value.trim();
      if (!text) return;

      if (!Array.isArray(siteContentCache.dynamic_specs)) {
        siteContentCache.dynamic_specs = [];
      }
      siteContentCache.dynamic_specs.push(text);
      renderDynamicSpecs();
      closeAddSpecModal();

      await fetch(`${API_BASE_URL}/api/admin/specs/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      alert('✅ নতুন স্পেসিফিকেশন সফলভাবে যুক্ত হয়েছে!');
    }

    async function deleteSpec(index) {
      if (!confirm('আপনি কি এই স্পেসিফিকেশনটি মুছে ফেলতে চান?')) return;
      siteContentCache.dynamic_specs.splice(index, 1);
      renderDynamicSpecs();

      await fetch(`${API_BASE_URL}/api/admin/specs/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index })
      });
    }

    function renderTextCmsList() {
      const container = document.getElementById('cms-fields-container');
      if (!container) return;
      container.innerHTML = '';

      const grouped = {};
      EDITABLE_FIELDS.forEach(f => {
        if (!grouped[f.section]) grouped[f.section] = [];
        grouped[f.section].push(f);
      });

      for (const [section, fields] of Object.entries(grouped)) {
        const sectionBox = document.createElement('div');
        sectionBox.className = 'bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3';
        sectionBox.innerHTML = `<h4 class="font-extrabold text-indigo-700 text-sm border-b border-slate-200 pb-1.5 flex items-center gap-1.5"><span>📁</span> ${section}</h4>`;

        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-1 md:grid-cols-2 gap-3';

        fields.forEach(f => {
          const val = siteContentCache[f.key] !== undefined ? siteContentCache[f.key] : '...';
          const card = document.createElement('div');
          card.className = 'bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-start gap-2 shadow-sm';
          card.innerHTML = `
            <div class="flex-1 overflow-hidden">
              <div class="text-[11px] font-bold text-slate-500">${f.title}</div>
              <div class="text-xs font-black text-slate-900 truncate mt-0.5" id="preview-${f.key}">${val}</div>
            </div>
            <button onclick="openEditModal('${f.key}', '${f.title}', '${f.section}')" class="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-sm shadow-sm flex items-center gap-1 font-bold" title="এডিট করুন">
              <span>✏️</span>
            </button>
          `;
          grid.appendChild(card);
        });

        sectionBox.appendChild(grid);
        container.appendChild(sectionBox);
      }
    }

    function renderProductsCards() {
      const container = document.getElementById('admin-products-container');
      if (!container) return;
      container.innerHTML = '';

      liveProducts.forEach(p => {
        const card = document.createElement('div');
        card.className = 'bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-2';
        card.innerHTML = `
          <img src="${p.image}" class="w-full h-44 object-cover rounded-xl border"/>
          <div class="font-bold text-slate-800 text-sm">${p.name}</div>
          <div class="text-xs">
            <span class="text-slate-400 line-through">৳ ${p.regular_price || 1050}</span>
            <span class="text-orange-600 font-black ml-1">৳ ${p.price}</span>
          </div>
          <div class="flex gap-2 pt-1">
            <button onclick="openEditProductModal('${p.id}')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-1.5 rounded-xl text-xs">
              ✏️ এডিট প্রোডাক্ট
            </button>
            <button onclick="deleteProduct('${p.id}')" class="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-3 py-1.5 rounded-xl text-xs">
              🗑️
            </button>
          </div>
        `;
        container.appendChild(card);
      });
    }

    function openEditModal(key, title, section) {
      currentEditingField = key;
      document.getElementById('modal-section-name').innerText = section;
      document.getElementById('modal-field-title').innerText = title;
      document.getElementById('modal-input-val').value = siteContentCache[key] !== undefined ? siteContentCache[key] : '';
      document.getElementById('edit-modal').classList.remove('hidden');
    }

    function closeEditModal() {
      document.getElementById('edit-modal').classList.add('hidden');
    }

    async function submitModalEdit() {
      const val = document.getElementById('modal-input-val').value.trim();
      siteContentCache[currentEditingField] = val;
      const prev = document.getElementById(`preview-${currentEditingField}`);
      if (prev) prev.innerText = val;
      closeEditModal();
      alert('✅ সফলভাবে সংরক্ষিত ও লাইভ ওয়েবসাইটে পরিবর্তন কার্যকর হয়েছে!');

      fetch(`${API_BASE_URL}/api/admin/cms/update-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: currentEditingField, value: val })
      }).catch(() => {});
    }

    async function saveField(key, val) {
      siteContentCache[key] = val;
      alert('✅ Pixel ID সংরক্ষিত হয়েছে!');
      fetch(`${API_BASE_URL}/api/admin/cms/update-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: key, value: val })
      }).catch(() => {});
    }

    function openEditProductModal(id) {
      const p = liveProducts.find(x => x.id === id);
      if (!p) return;
      document.getElementById('edit-prod-id').value = p.id;
      document.getElementById('edit-prod-name').value = p.name;
      document.getElementById('edit-prod-reg-price').value = p.regular_price || 1050;
      document.getElementById('edit-prod-price').value = p.price;
      document.getElementById('edit-prod-image').value = p.image;
      document.getElementById('edit-prod-modal').classList.remove('hidden');
    }

    function closeEditProductModal() {
      document.getElementById('edit-prod-modal').classList.add('hidden');
    }

    async function saveProductEdits() {
      const id = document.getElementById('edit-prod-id').value;
      const name = document.getElementById('edit-prod-name').value.trim();
      const regular_price = document.getElementById('edit-prod-reg-price').value.trim();
      const price = document.getElementById('edit-prod-price').value.trim();
      const image = document.getElementById('edit-prod-image').value.trim();

      const p = liveProducts.find(x => x.id === id);
      if (p) {
        p.name = name;
        p.regular_price = Number(regular_price);
        p.price = Number(price);
        p.image = image;
        renderProductsCards();
      }

      alert('✅ প্রোডাক্ট তথ্য সফলভাবে আপডেট হয়েছে!');
      closeEditProductModal();

      fetch(`${API_BASE_URL}/api/admin/products/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, regular_price, price, image })
      }).catch(() => {});
    }

    function openAddProductModal() {
      document.getElementById('add-prod-modal').classList.remove('hidden');
    }

    function closeAddProductModal() {
      document.getElementById('add-prod-modal').classList.add('hidden');
    }

    async function submitNewProduct() {
      const name = document.getElementById('new-prod-name').value.trim();
      const regular_price = document.getElementById('new-prod-reg-price').value.trim();
      const price = document.getElementById('new-prod-price').value.trim();
      const image = document.getElementById('new-prod-image').value.trim();

      if (!name || !price || !image) {
        alert('সব ফিল্ড পূরণ করুন!');
        return;
      }

      const newProd = {
        id: 'prod_' + Date.now(),
        name,
        regular_price: Number(regular_price) || 1050,
        price: Number(price) || 750,
        image
      };
      liveProducts.push(newProd);
      renderProductsCards();

      alert('✅ নতুন প্রোডাক্ট সফলভাবে যোগ করা হয়েছে!');
      closeAddProductModal();

      fetch(`${API_BASE_URL}/api/admin/products/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, regular_price, price, image })
      }).catch(() => {});
    }

    async function deleteProduct(id) {
      if (!confirm('আপনি কি এই প্রোডাক্টটি মুছে ফেলতে চান?')) return;
      liveProducts = liveProducts.filter(p => p.id !== id);
      renderProductsCards();

      fetch(`${API_BASE_URL}/api/admin/products/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      }).catch(() => {});
    }

    function switchTab(tab) {
      ['orders', 'analytics', 'incomplete', 'duplicates', 'sections-toggle', 'text-cms', 'products-cms', 'pixels'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (el) el.classList.add('hidden');
        const nav = document.getElementById(`nav-${t}`);
        if (nav) nav.className = 'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/60 transition-all text-slate-300';
      });

      document.getElementById(`tab-${tab}`).classList.remove('hidden');
      document.getElementById(`nav-${tab}`).className = 'sidebar-active w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all shadow-md';

      const titles = {
        'orders': 'কাস্টমার অর্ডার ম্যানেজমেন্ট',
        'analytics': '📊 অর্ডার অ্যানালাইসিস ড্যাশবোর্ড',
        'incomplete': '⏳ ইনকমপ্লিট অর্ডার তালিকা',
        'duplicates': '👥 ডুপ্লিকেট ও রিপিট কাস্টমার',
        'sections-toggle': '🔘 ওয়েবসাইট সেকশন অন/অফ কন্ট্রোলার',
        'text-cms': '✏️ সম্পূর্ণ ওয়েবসাইট টেক্সট ও কালার ম্যানেজার',
        'products-cms': '📦 প্রোডাক্ট ও ছবি ম্যানেজমেন্ট',
        'pixels': '🎯 Facebook ও TikTok Pixel সেটআপ'
      };
      document.getElementById('page-title').innerText = titles[tab] || 'অ্যাডমিন প্যানেল';

      if (tab === 'analytics') {
        loadAnalyticsData();
      } else if (tab === 'incomplete') {
        currentFilter = 'incomplete';
        loadLiveOrders();
      } else if (tab === 'duplicates') {
        currentFilter = 'duplicates';
        loadLiveOrders();
      } else if (tab === 'orders') {
        currentFilter = 'all';
        loadLiveOrders();
      }
    }

    window.onload = checkAuth;
    //]]>
  </script>
</body>
</html>
