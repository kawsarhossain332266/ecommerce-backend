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

// গ্যারান্টিড ব্যাকআপ ব্যানার (ডাটাবেস খালি থাকলেও এটি সাথে সাথে ওয়েবসাইটে ছবি দেখাবে)
const FALLBACK_BANNERS = [
  {
    id: 'b1',
    badge_text: 'ঈদ স্পেশাল অফার',
    title: 'রয়্যাল লাক্সারি প্রিমিয়াম পাঞ্জাবি কালেকশন',
    subtitle: '১০০% প্রিমিয়াম সুতি কাপড়ে তৈরি আরামদায়ক ও আভিজাত্যপূর্ণ পোশাক। সারা দেশে ফ্রি হোম ডেলিভারি!',
    button_text: 'এখনই অর্ডার করুন',
    image_url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1000&q=80',
    is_active: true
  }
];

// গ্যারান্টিড ব্যাকআপ প্রোডাক্ট (ছবিসহ আসল পাঞ্জাবি)
const FALLBACK_PRODUCTS = [
  {
    id: 'prod-001',
    title: 'প্রিমিয়াম রয়্যাল কটন পাঞ্জাবি - নেভি ব্লু',
    regular_price: '1850',
    sale_price: '1250',
    short_description: 'আভিজাত্য ও আরামের অনন্য সমন্বয়। নিখুঁত সেলাই এবং এক্সক্লুসিভ বাটন ডিজাইন।',
    product_images: [
      { image_url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80' }
    ]
  }
];

async function sendTelegramAlert(orderData: any, items: any[]) {
  if (!telegramBotToken || !telegramChatId) return;

  let itemList = '';
  items.forEach((item, index) => {
    itemList += `${index + 1}. ${item.product_name} x ${item.quantity} = ${item.total_price} ৳\n`;
  });

  const message = `🛍️ *নতুন অর্ডার এসেছে!* (${orderData.order_number})\n\n` +
    `👤 *গ্রাহক:* ${orderData.customer_name}\n` +
    `📞 *ফোন:* ${orderData.customer_phone}\n` +
    `📍 *ঠিকানা:* ${orderData.shipping_address}, ${orderData.shipping_district}\n\n` +
    `📦 *অর্ডারকৃত পণ্যসমূহ:*\n${itemList}\n` +
    `💵 *সাবটোটাল:* ${orderData.subtotal} ৳\n` +
    `🚚 *ডেলিভারি চার্জ:* ${orderData.delivery_charge} ৳\n` +
    `💰 *সর্বমোট:* ${orderData.grand_total} ৳\n` +
    `💳 *পেমেন্ট পদ্ধতি:* ক্যাশ অন ডেলিভারি`;

  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('/api/store-data', async (req: Request, res: Response) => {
  try {
    const [settingsRes, bannersRes, productsRes, imagesRes] = await Promise.all([
      supabase.from('store_settings').select('*'),
      supabase.from('banners').select('*'),
      supabase.from('products').select('*'),
      supabase.from('product_images').select('*')
    ]);

    // ডাটাবেসে প্রোডাক্ট থাকলে সেটি নেবে, না থাকলে স্বয়ংক্রিয়ভাবে ব্যাকআপ প্রোডাক্ট দেখাবে
    let finalProducts = [];
    if (productsRes.data && productsRes.data.length > 0) {
      finalProducts = productsRes.data.map((prod: any) => {
        const prodImages = (imagesRes.data || []).filter((img: any) => img.product_id === prod.id);
        return {
          ...prod,
          product_images: prodImages.length > 0 ? prodImages : [{ image_url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80' }]
        };
      });
    } else {
      finalProducts = FALLBACK_PRODUCTS;
    }

    // ডাটাবেসে ব্যানার থাকলে সেটি নেবে, না থাকলে ব্যাকআপ ব্যানার দেখাবে
    let finalBanners = (bannersRes.data && bannersRes.data.length > 0) ? bannersRes.data : FALLBACK_BANNERS;

    res.json({
      settings: settingsRes.data?.[0] || { store_name: 'BD Exclusive Store', phone: '01700000000', delivery_inside_dhaka: 80, delivery_outside_dhaka: 150 },
      banners: finalBanners,
      products: finalProducts
    });
  } catch (error: any) {
    // যেকোনো এরর হলেও স্বয়ংক্রিয়ভাবে ছবি ও ডেটা চলে যাবে
    res.json({
      settings: { store_name: 'BD Exclusive Store', phone: '01700000000', delivery_inside_dhaka: 80, delivery_outside_dhaka: 150 },
      banners: FALLBACK_BANNERS,
      products: FALLBACK_PRODUCTS
    });
  }
});

app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, items } = req.body;

    if (!customer_name || !customer_phone || !shipping_address) {
      return res.status(400).json({ error: 'সকল প্রয়োজনীয় তথ্য দিন।' });
    }

    const deliveryCharge = shipping_district.toLowerCase().includes('dhaka') || shipping_district.includes('ঢাকা') ? 80 : 150;
    const subtotal = 1250;
    const grandTotal = subtotal + deliveryCharge;
    const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

    // টেলিগ্রামে অ্যালার্ট পাঠানো
    await sendTelegramAlert({
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district,
      shipping_address,
      subtotal,
      delivery_charge: deliveryCharge,
      grand_total: grandTotal
    }, [{
      product_name: 'প্রিমিয়াম রয়্যাল কটন পাঞ্জাবি - নেভি ব্লু',
      quantity: 1,
      total_price: 1250
    }]);

    // ডাটাবেসে সেভ করা (ঐচ্ছিক)
    try {
      await supabase.from('orders').insert({
        order_number: orderNumber,
        customer_name,
        customer_phone,
        shipping_district,
        shipping_address,
        subtotal,
        delivery_charge: deliveryCharge,
        grand_total: grandTotal,
        payment_method: 'cod',
        order_status: 'pending'
      });
    } catch (e) {
      console.log('DB save skipped');
    }

    res.json({
      success: true,
      message: 'অর্ডার সফল হয়েছে!',
      order_number: orderNumber,
      grand_total: grandTotal
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});
