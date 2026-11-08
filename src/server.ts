import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// পণ্য অনুযায়ী ইমেজ ম্যাপিং
const COLOR_IMAGES: Record<string, string> = {
  olive: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80',
  blue: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80',
  pink: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80',
  maroon: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80'
};

function getExactPhoto(item: any): string {
  if (item.image_url && String(item.image_url).startsWith('http')) return item.image_url;
  const name = String(item.product_name || '').toLowerCase();
  if (name.includes('blue') || name.includes('রয়েল') || name.includes('রয়েল')) return COLOR_IMAGES.blue;
  if (name.includes('pink') || name.includes('পিংক')) return COLOR_IMAGES.pink;
  if (name.includes('maroon') || name.includes('মেরুন') || name.includes('রেড')) return COLOR_IMAGES.maroon;
  return COLOR_IMAGES.olive;
}

// টেলিগ্রাম নোটিফিকেশন ডিসপ্যাচার
async function sendTelegramAlert(orderData: any, items: any[]): Promise<any> {
  if (!telegramBotToken || !telegramChatId) return;

  let itemList = '';
  items.forEach((it, i) => {
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

  const photos = Array.from(new Set(items.map(getExactPhoto)));

  if (photos.length > 1) {
    try {
      return await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          media: photos.slice(0, 5).map((p, idx) => ({ type: 'photo', media: p, caption: idx === 0 ? caption : undefined, parse_mode: 'HTML' }))
        })
      });
    } catch (e) {}
  }

  try {
    return await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, photo: photos[0] || COLOR_IMAGES.olive, caption, parse_mode: 'HTML' })
    });
  } catch (err) {
    return await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: caption, parse_mode: 'HTML' })
    });
  }
}

// ================= PUBLIC ENDPOINTS =================

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// হোমপেজ লাইভ ডেটা (ব্লগার এটি পড়ে পুরো পেজ ডায়নামিক করবে)
app.get('/api/store-data', async (req: Request, res: Response) => {
  try {
    const [cmsRes, pixelsRes, settingsRes, productsRes] = await Promise.all([
      supabase.from('homepage_cms').select('*').limit(1).maybeSingle(),
      supabase.from('tracking_pixels').select('*').limit(1).maybeSingle(),
      supabase.from('store_settings').select('*').limit(1).maybeSingle(),
      supabase.from('products').select('*, product_images(*)').eq('is_active', true)
    ]);

    res.json({
      cms: cmsRes.data || {},
      pixels: pixelsRes.data || {},
      settings: settingsRes.data || {},
      products: productsRes.data || []
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// অর্ডার গ্রহণ
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;
    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ error: 'সব তথ্য দিন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন (L)', quantity: 1, total_price: 750 }];
    let subtotal = 0;
    orderItems.forEach((it: any) => subtotal += Number(it.total_price || 750));

    const isDhaka = String(shipping_district).toLowerCase().includes('dhaka') || String(shipping_district).includes('ঢাকা');
    const deliveryCharge = isDhaka ? 80 : 150;
    const grandTotal = subtotal + deliveryCharge;
    const orderNumber = 'SO-' + Math.floor(1000 + Math.random() * 9000);

    const orderRecord = {
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে',
      shipping_address,
      subtotal,
      delivery_charge: deliveryCharge,
      grand_total: grandTotal,
      order_status: 'pending'
    };

    // টেলিগ্রামে ছবিসহ নোটিফিকেশন পাঠানো
    sendTelegramAlert(orderRecord, orderItems);

    // ডাটাবেসে অর্ডার সেভ
    const { data: dbOrder } = await supabase.from('orders').insert(orderRecord).select().single();
    if (dbOrder) {
      await supabase.from('order_items').insert(orderItems.map((it: any) => ({
        order_id: dbOrder.id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.total_price / (it.quantity || 1),
        total_price: it.total_price
      })));
    }

    res.json({ success: true, order_number: orderNumber, grand_total: grandTotal });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ================= ADMIN DASHBOARD API =================

// ১. অ্যাডমিন লগইন
app.post('/api/admin/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const { data: user } = await supabase.from('admin_users').select('*').eq('email', email).maybeSingle();

  if (!user || user.password_hash !== password) {
    return res.status(401).json({ success: false, message: 'ভুল ইমেইল বা পাসওয়ার্ড!' });
  }

  res.json({ success: true, token: 'auth-token-' + user.id, user: { name: user.name, role: user.role, email: user.email } });
});

// ২. ড্যাশবোর্ড ওভারভিউ মেট্রিকস
app.get('/api/admin/metrics', async (req: Request, res: Response) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*');
    const total = orders?.length || 0;
    const pending = orders?.filter(o => o.order_status === 'pending').length || 0;
    const processing = orders?.filter(o => o.order_status === 'processing').length || 0;
    const shipped = orders?.filter(o => o.order_status === 'shipped').length || 0;
    const delivered = orders?.filter(o => o.order_status === 'delivered').length || 0;
    const cancelled = orders?.filter(o => o.order_status === 'cancelled').length || 0;

    res.json({ total, pending, processing, shipped, delivered, cancelled });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৩. অর্ডার লিস্ট ফেচ (ফিল্টার ও সার্চ সহ)
app.get('/api/admin/orders', async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;
    let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });

    if (status && status !== 'all') query = query.eq('order_status', status);
    if (search) query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,order_number.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ orders: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৪. অর্ডার স্ট্যাটাস আপডেট
app.post('/api/admin/orders/update-status', async (req: Request, res: Response) => {
  const { order_id, status } = req.body;
  const { data, error } = await supabase.from('orders').update({ order_status: status }).eq('id', order_id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, order: data });
});

// ৫. হোমপেজ CMS কন্টেন্ট আপডেট (Header to Footer A to Z)
app.post('/api/admin/cms/update', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const { data: existing } = await supabase.from('homepage_cms').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('homepage_cms').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('homepage_cms').insert(payload);
    }
    res.json({ success: true, message: 'হোমপেজ সেটিংস সফলভাবে সেভ হয়েছে!' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৬. Facebook & TikTok Pixel সেটিংস আপডেট
app.post('/api/admin/pixels/update', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const { data: existing } = await supabase.from('tracking_pixels').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('tracking_pixels').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('tracking_pixels').insert(payload);
    }
    res.json({ success: true, message: 'Pixel সেটিংস সফলভাবে আপডেট হয়েছে!' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Master API live on port ${PORT}`));
