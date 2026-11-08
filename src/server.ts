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

// পণ্য অনুযায়ী আসল ছবির ম্যাপিং
const COLOR_IMAGE_MAP: Record<string, string> = {
  olive: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80',
  blue: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80',
  pink: 'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80',
  maroon: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80'
};

// ছবিসহ টেলিগ্রাম নোটিফিকেশন পাঠানোর উন্নত ফাংশন (sendPhoto)
async function sendTelegramAlertWithPhoto(orderData: any, items: any[]): Promise<any> {
  if (!telegramBotToken || !telegramChatId) {
    console.error('Telegram Token or Chat ID missing!');
    return { error: 'Token/ChatID missing' };
  }

  // কাস্টমার কোন কালার অর্ডার করেছে তা শনাক্ত করে সঠিক ছবি বেছে নেওয়া
  let selectedPhoto = COLOR_IMAGE_MAP.olive;
  const firstItemName = (items[0]?.product_name || '').toLowerCase();

  if (firstItemName.includes('রয়েল') || firstItemName.includes('রয়্যাল') || firstItemName.includes('blue')) {
    selectedPhoto = COLOR_IMAGE_MAP.blue;
  } else if (firstItemName.includes('পিংক') || firstItemName.includes('pink')) {
    selectedPhoto = COLOR_IMAGE_MAP.pink;
  } else if (firstItemName.includes('মেরুন') || firstItemName.includes('maroon') || firstItemName.includes('রেড')) {
    selectedPhoto = COLOR_IMAGE_MAP.maroon;
  }

  // পণ্যের বিবরণ তৈরি
  let itemList = '';
  items.forEach((item, index) => {
    itemList += `<b>${index + 1}.</b> ${item.product_name} x <b>${item.quantity}</b> = ${item.total_price} ৳\n`;
  });

  // ছবির নিচের বিস্তারিত ক্যাপশন
  const caption = `🛍️ <b>নতুন অর্ডার এসেছে!</b> (<code>${orderData.order_number}</code>)\n\n` +
    `👤 <b>গ্রাহক:</b> ${orderData.customer_name}\n` +
    `📞 <b>ফোন:</b> <code>${orderData.customer_phone}</code>\n` +
    `📍 <b>ঠিকানা:</b> ${orderData.shipping_address}, ${orderData.shipping_district}\n\n` +
    `📦 <b>অর্ডারকৃত পণ্যসমূহ:</b>\n${itemList}\n` +
    `💵 <b>সাবটোটাল:</b> ${orderData.subtotal} ৳\n` +
    `🚚 <b>ডেলিভারি চার্জ:</b> ${orderData.delivery_charge} ৳\n` +
    `💰 <b>সর্বমোট বিল:</b> <b>${orderData.grand_total} ৳</b>\n` +
    `💳 <b>পেমেন্ট:</b> ক্যাশ অন ডেলিভারি (COD)`;

  // ১. সরাসরি ছবিসহ টেলিগ্রামে পাঠানো (sendPhoto API)
  const photoUrl = `https://api.telegram.org/bot${telegramBotToken}/sendPhoto`;
  
  try {
    const photoRes = await fetch(photoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        photo: selectedPhoto,
        caption: caption,
        parse_mode: 'HTML'
      })
    });
    
    const result = await photoRes.json();
    if (result.ok) {
      console.log('Telegram photo alert sent successfully!');
      return result;
    }
    console.warn('sendPhoto failed, trying fallback to text:', result);
  } catch (err) {
    console.error('sendPhoto network error:', err);
  }

  // ২. কোনো কারণে ছবি পাঠাতে সমস্যা হলে টেক্সট মেসেজ পাঠানো (যাতে অর্ডার মিস না হয়)
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
  } catch (e) {
    console.error('sendMessage fallback error:', e);
    return { error: e };
  }
}

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// সরাসরি ছবিসহ টেলিগ্রাম টেস্ট লিংক
app.get('/api/test-telegram', async (req: Request, res: Response) => {
  if (!telegramBotToken || !telegramChatId) {
    return res.json({ success: false, error: 'Telegram credentials missing.' });
  }

  const testUrl = `https://api.telegram.org/bot${telegramBotToken}/sendPhoto`;
  try {
    const tgRes = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        photo: COLOR_IMAGE_MAP.olive,
        caption: '🔔 <b>টেস্ট ফটো অ্যালার্ট:</b> অভিনন্দন! ছবিসহ আপনার টেলিগ্রাম নোটিফিকেশন সিস্টেম সম্পূর্ণ সক্রিয়।',
        parse_mode: 'HTML'
      })
    });
    const result = await tgRes.json();
    res.json({ success: result.ok, telegram_response: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// চেকআউট এন্ডপয়েন্ট (ছবিসহ টেলিগ্রামে পাঠানোর লজিক)
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ error: 'সকল প্রয়োজনীয় তথ্য প্রদান করুন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন (L)', quantity: 1, total_price: 750 }];
    
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

    // সরাসরি ছবিসহ টেলিগ্রামে অ্যালার্ট পাঠানো
    const telegramResult = await sendTelegramAlertWithPhoto(orderRecord, orderItems);

    // ডাটাবেসে ব্যাকআপ লগ
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
      console.log('Database backup log skipped');
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
