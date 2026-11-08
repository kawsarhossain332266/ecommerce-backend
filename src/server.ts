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

// নিরাপদ টেলিগ্রাম অ্যালার্ট ফাংশন (HTML মোড - কখনো ক্র্যাশ করবে না)
async function sendTelegramAlert(orderData: any, items: any[]): Promise<any> {
  if (!telegramBotToken || !telegramChatId) {
    console.error('Telegram Token or Chat ID missing in Environment Variables!');
    return { error: 'Token/ChatID missing' };
  }

  let itemList = '';
  items.forEach((item, index) => {
    itemList += `<b>${index + 1}.</b> ${item.product_name} x <b>${item.quantity}</b> = ${item.total_price} ৳\n`;
  });

  const message = `🛍️ <b>নতুন অর্ডার এসেছে!</b> (<code>${orderData.order_number}</code>)\n\n` +
    `👤 <b>গ্রাহক:</b> ${orderData.customer_name}\n` +
    `📞 <b>ফোন:</b> <code>${orderData.customer_phone}</code>\n` +
    `📍 <b>ঠিকানা:</b> ${orderData.shipping_address}, ${orderData.shipping_district}\n\n` +
    `📦 <b>অর্ডারকৃত পণ্যসমূহ:</b>\n${itemList}\n` +
    `💵 <b>সাবটোটাল:</b> ${orderData.subtotal} ৳\n` +
    `🚚 <b>ডেলিভারি চার্জ:</b> ${orderData.delivery_charge} ৳\n` +
    `💰 <b>সর্বমোট বিল:</b> <b>${orderData.grand_total} ৳</b>\n` +
    `💳 <b>পেমেন্ট:</b> ক্যাশ অন ডেলিভারি (COD)`;

  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    const result = await res.json();
    console.log('Telegram API result:', result);
    return result;
  } catch (err) {
    console.error('Telegram network error:', err);
    return { error: err };
  }
}

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ১. টেলিগ্রাম টেস্ট করার সরাসরি লিংক (এটি দিয়ে চেক করবেন বট ঠিক আছে কি না)
app.get('/api/test-telegram', async (req: Request, res: Response) => {
  if (!telegramBotToken || !telegramChatId) {
    return res.json({
      success: false,
      error: 'Render Environment-এ TELEGRAM_BOT_TOKEN বা TELEGRAM_CHAT_ID পাওয়া যায়নি।'
    });
  }

  const testUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  try {
    const tgRes = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: '🔔 <b>টেস্ট মেসেজ:</b> অভিনন্দন! আপনার টেলিগ্রাম বট ব্যাকএন্ডের সাথে সফলভাবে কানেক্ট হয়েছে।',
        parse_mode: 'HTML'
      })
    });
    const result = await tgRes.json();
    if (result.ok) {
      res.json({ success: true, message: 'টেলিগ্রামে টেস্ট মেসেজ চলে গেছে! আপনার বট সম্পূর্ণ ঠিক আছে।' });
    } else {
      res.json({ success: false, telegram_response: result });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ২. স্টোর ডেটা ফেচ
app.get('/api/store-data', async (req: Request, res: Response) => {
  res.json({ status: 'ready', message: 'Custom landing page active' });
});

// ৩. নতুন ব্লগার থিমের সাথে ১০০% মানানসই অর্ডার চেকআউট এন্ডপয়েন্ট
app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ error: 'সকল প্রয়োজনীয় তথ্য প্রদান করুন।' });
    }

    const orderItems = items && items.length > 0 ? items : [{ product_name: 'কাতুয়া - অলিভ গ্রিন', quantity: 1, total_price: 750 }];
    
    // মোট মূল্য হিসাব
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

    // সবার আগে টেলিগ্রামে মেসেজ পাঠানো নিশ্চিত করা
    const telegramResult = await sendTelegramAlert(orderRecord, orderItems);

    // ডাটাবেসে ব্যাকগ্রাউন্ডে সেভ (ঐচ্ছিক)
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
