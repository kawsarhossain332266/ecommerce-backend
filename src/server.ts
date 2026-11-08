import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// পণ্য অনুযায়ী হাই-রেজ্যুলেশন আসল ছবি
const DEFAULT_IMAGES = {
  olive: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80',
  blue: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80',
  pink: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80',
  maroon: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80'
};

// পণ্যের সঠিক ছবি শনাক্তকারী ফাংশন (বাংলা সব ভ্যারিয়েন্ট সাপোর্ট করে)
function getExactPhotoForItem(item: any): string {
  if (item.image_url && String(item.image_url).startsWith('http')) {
    return item.image_url;
  }
  const name = String(item.product_name || '').toLowerCase();
  
  if (name.includes('blue') || name.includes('রয়েল') || name.includes('রয়েল') || name.includes('নীল')) {
    return DEFAULT_IMAGES.blue;
  }
  if (name.includes('pink') || name.includes('পিংক') || name.includes('গোলাপি')) {
    return DEFAULT_IMAGES.pink;
  }
  if (name.includes('maroon') || name.includes('মেরুন') || name.includes('red') || name.includes('রেড') || name.includes('লাল')) {
    return DEFAULT_IMAGES.maroon;
  }
  return DEFAULT_IMAGES.olive;
}

// অর্ডারকৃত সব পণ্যের ছবি একসাথে টেলিগ্রামে পাঠানোর স্মার্ট ফাংশন
async function sendTelegramOrderNotification(orderData: any, items: any[]): Promise<any> {
  if (!telegramBotToken || !telegramChatId) {
    console.error('Telegram Bot Token or Chat ID is missing!');
    return { error: 'Token or ChatID missing' };
  }

  // অর্ডারকৃত পণ্যগুলোর তালিকা তৈরি
  let itemList = '';
  items.forEach((item, index) => {
    itemList += `<b>${index + 1}.</b> ${item.product_name} x <b>${item.quantity}</b> = ${item.total_price} ৳\n`;
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

  // অর্ডারকৃত পণ্যগুলোর ইউনিক ছবির তালিকা সংগ্রহ
  const photos = items.map(getExactPhotoForItem);
  const uniquePhotos: string[] = Array.from(new Set(photos));

  // কেস ১: যদি একাধিক পণ্যের ছবি থাকে (Send as Album / Media Group)
  if (uniquePhotos.length > 1) {
    const mediaGroupUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMediaGroup`;
    const mediaPayload = uniquePhotos.slice(0, 5).map((photoUrl, idx) => ({
      type: 'photo',
      media: photoUrl,
      caption: idx === 0 ? caption : undefined,
      parse_mode: 'HTML'
    }));

    try {
      const groupRes = await fetch(mediaGroupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          media: mediaPayload
        })
      });
      const groupResult = await groupRes.json();
      if (groupResult.ok) return groupResult;
    } catch (e) {
      console.warn('sendMediaGroup failed, trying single photo fallback');
    }
  }

  // কেস ২: যদি ১টি পণ্যের ছবি থাকে (Send Single Photo)
  const singlePhotoUrl = `https://api.telegram.org/bot${telegramBotToken}/sendPhoto`;
  try {
    const photoRes = await fetch(singlePhotoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        photo: uniquePhotos[0] || DEFAULT_IMAGES.olive,
        caption: caption,
        parse_mode: 'HTML'
      })
    });
    const photoResult = await photoRes.json();
    if (photoResult.ok) return photoResult;
  } catch (err) {
    console.warn('sendPhoto failed, trying text fallback');
  }

  // কেস ৩: কোনো কারণে ছবি না গেলে টেক্সট মেসেজ পাঠানো
  const textUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  try {
    const textRes = await fetch(textUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: caption,
        parse_mode: 'HTML'
      })
    });
    return await textRes.json();
  } catch (err) {
    console.error('Telegram text dispatch failed:', err);
    return { error: err };
  }
}

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ error: 'সকল প্রয়োজনীয় তথ্য প্রদান করুন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন (L)', quantity: 1, total_price: 750 }];
    
    let subtotal = 0;
    orderItems.forEach((it: any) => {
      subtotal += Number(it.total_price || 750);
    });

    const isDhaka = String(shipping_district).toLowerCase().includes('dhaka') || String(shipping_district).includes('ঢাকা');
    const deliveryCharge = isDhaka ? 80 : 150;
    const grandTotal = subtotal + deliveryCharge;
    const orderNumber = 'SWP-' + Math.floor(100000 + Math.random() * 900000);

    const orderRecord = {
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district: shipping_district || (isDhaka ? 'ঢাকার ভিতরে' : 'ঢাকার বাইরে'),
      shipping_address,
      subtotal,
      delivery_charge: deliveryCharge,
      grand_total: grandTotal
    };

    // অর্ডারকৃত পণ্যের সঠিক ছবিসহ টেলিগ্রামে পাঠানো
    const telegramResult = await sendTelegramOrderNotification(orderRecord, orderItems);

    try {
      await supabase.from('orders').insert({
        order_number: orderNumber,
        customer_name,
        customer_phone,
        shipping_district: orderRecord.shipping_district,
        shipping_address,
        subtotal,
        delivery_charge: deliveryCharge,
        grand_total: grandTotal,
        payment_method: 'cod',
        order_status: 'pending'
      });
    } catch (dbErr) {
      console.log('Database backup log');
    }

    res.json({
      success: true,
      message: 'অর্ডার সফলভাবে গ্রহণ করা হয়েছে!',
      order_number: orderNumber,
      telegram: telegramResult?.ok || false
    });

  } catch (error: any) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});
