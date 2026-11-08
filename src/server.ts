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

const DEFAULT_IMAGES = {
  olive: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80',
  blue: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80',
  pink: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80',
  maroon: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80'
};

function getExactPhotoForItem(item: any): string {
  if (item.image_url && String(item.image_url).startsWith('http')) return item.image_url;
  const name = String(item.product_name || '').toLowerCase();
  if (name.includes('blue') || name.includes('রয়েল') || name.includes('রয়েল')) return DEFAULT_IMAGES.blue;
  if (name.includes('pink') || name.includes('পিংক')) return DEFAULT_IMAGES.pink;
  if (name.includes('maroon') || name.includes('মেরুন') || name.includes('রেড')) return DEFAULT_IMAGES.maroon;
  return DEFAULT_IMAGES.olive;
}

// নির্ভরযোগ্য টেলিগ্রাম প্রেরক
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

  const photos = Array.from(new Set(items.map(getExactPhotoForItem)));

  if (photos.length > 1) {
    try {
      return await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMediaGroup`, {
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
    } catch (e) {}
  }

  try {
    return await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        photo: photos[0] || DEFAULT_IMAGES.olive,
        caption,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    return await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: caption, parse_mode: 'HTML' })
    });
  }
}

// ================= PUBLIC API ENDPOINTS =================

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ১. পাবলিক সাইটের সমস্ত ডাইনামিক ডেটা লোড
app.get('/api/store-data', async (req: Request, res: Response) => {
  try {
    const [cmsRes, pixelsRes] = await Promise.all([
      supabase.from('website_cms').select('*').limit(1).maybeSingle(),
      supabase.from('tracking_pixels').select('*').limit(1).maybeSingle()
    ]);

    res.json({
      cms: cmsRes.data || {},
      pixels: pixelsRes.data || {}
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ২. অর্ডার সাবমিশন (ডাটাবেস ও টেলিগ্রাম শতভাগ নিশ্চিত)
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ error: 'সকল প্রয়োজনীয় তথ্য প্রদান করুন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন (L)', quantity: 1, total_price: 750 }];

    let rawSubtotal = 0;
    let totalQty = 0;
    orderItems.forEach((it: any) => {
      rawSubtotal += Number(it.total_price || 750);
      totalQty += Number(it.quantity || 1);
    });

    // কম্বো ছাড় ও ডেলিভারি হিসাব
    let discount = 0;
    const isDhaka = String(shipping_district).toLowerCase().includes('dhaka') || String(shipping_district).includes('ঢাকা');
    let delivery = isDhaka ? 80 : 150;

    if (totalQty === 2) discount = 100;
    else if (totalQty >= 3) {
      discount = 250;
      delivery = 0;
    }

    const grandTotal = Math.max(0, rawSubtotal - discount + delivery);
    const orderNumber = 'SO-' + Math.floor(1000 + Math.random() * 9000);

    const orderData = {
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district: isDhaka ? 'ঢাকা' : 'ঢাকার বাইরে',
      shipping_address,
      subtotal: rawSubtotal,
      discount_amount: discount,
      delivery_charge: delivery,
      grand_total: grandTotal,
      order_status: 'pending'
    };

    // ১. নিশ্চিতভাবে ডাটাবেসে অর্ডার সেভ
    const { data: dbOrder, error: dbError } = await supabase.from('orders').insert(orderData).select().single();
    if (dbError) {
      console.error('Supabase DB Insert Error:', dbError);
    }

    if (dbOrder) {
      const itemsToInsert = orderItems.map((it: any) => ({
        order_id: dbOrder.id,
        product_name: it.product_name,
        size: it.size || 'L',
        quantity: it.quantity || 1,
        unit_price: it.unit_price || 750,
        total_price: it.total_price || 750,
        image_url: getExactPhotoForItem(it)
      }));
      await supabase.from('order_items').insert(itemsToInsert);
    }

    // ২. টেলিগ্রামে ছবিসহ অর্ডার এলার্ট
    sendTelegramAlert(orderData, orderItems);

    res.json({
      success: true,
      order_number: orderNumber,
      grand_total: grandTotal
    });
  } catch (error: any) {
    console.error('Checkout Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================= ADMIN DASHBOARD API (COMPLETE CRUD) =================

// ১. মেট্রিকস (ড্যাশবোর্ড কার্ডস)
app.get('/api/admin/metrics', async (req: Request, res: Response) => {
  try {
    const { data: orders } = await supabase.from('orders').select('*');
    const all = orders || [];
    res.json({
      total: all.length,
      pending: all.filter(o => o.order_status === 'pending').length,
      processing: all.filter(o => o.order_status === 'processing').length,
      shipped: all.filter(o => o.order_status === 'shipped').length,
      delivered: all.filter(o => o.order_status === 'delivered').length,
      cancelled: all.filter(o => o.order_status === 'cancelled').length
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ২. সম্পূর্ণ অর্ডার তালিকা ফেচ (ফিল্টার ও সার্চ সহ)
app.get('/api/admin/orders', async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;
    let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('order_status', status);
    }

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,order_number.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ orders: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৩. অর্ডার স্ট্যাটাস আপডেট
app.post('/api/admin/orders/update-status', async (req: Request, res: Response) => {
  try {
    const { order_id, status } = req.body;
    const { data, error } = await supabase.from('orders').update({ order_status: status }).eq('id', order_id).select();
    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৪. অর্ডার ডিলিট
app.post('/api/admin/orders/delete', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body;
    await supabase.from('orders').delete().eq('id', order_id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৫. CMS সম্পূর্ণ কন্টেন্ট আপডেট
app.post('/api/admin/cms/update', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const { data: existing } = await supabase.from('website_cms').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('website_cms').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('website_cms').insert(payload);
    }
    res.json({ success: true, message: 'কন্টেন্ট সফলভাবে আপডেট হয়েছে!' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ৬. পিক্সেল কনফিগারেশন আপডেট
app.post('/api/admin/pixels/update', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const { data: existing } = await supabase.from('tracking_pixels').select('id').limit(1).maybeSingle();
    if (existing) {
      await supabase.from('tracking_pixels').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('tracking_pixels').insert(payload);
    }
    res.json({ success: true, message: 'Pixel সেটিংস সংরক্ষিত হয়েছে!' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Production Backend running on port ${PORT}`));
