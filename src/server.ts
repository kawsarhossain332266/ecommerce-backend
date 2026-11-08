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

async function sendTelegramAlert(orderData: any, items: any[]) {
  if (!telegramBotToken || !telegramChatId) return;

  let itemList = '';
  items.forEach((item, index) => {
    itemList += `${index + 1}. ${item.product_name} (${item.variant_info || 'Regular'}) x ${item.quantity} = ${item.total_price} ৳\n`;
  });

  const message = `🛍️ *নতুন অর্ডার এসেছে!* (${orderData.order_number})\n\n` +
    `👤 *গ্রাহক:* ${orderData.customer_name}\n` +
    `📞 *ফোন:* ${orderData.customer_phone}\n` +
    `📍 *ঠিকানা:* ${orderData.shipping_address}, ${orderData.shipping_district}\n\n` +
    `📦 *অর্ডারকৃত পণ্যসমূহ:*\n${itemList}\n` +
    `💵 *সাবটোটাল:* ${orderData.subtotal} ৳\n` +
    `🚚 *ডেলিভারি চার্জ:* ${orderData.delivery_charge} ৳\n` +
    `💰 *সর্বমোট:* ${orderData.grand_total} ৳\n` +
    `💳 *পেমেন্ট পদ্ধতি:* ${orderData.payment_method.toUpperCase()}`;

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
    const [settingsRes, bannersRes, productsRes] = await Promise.all([
      supabase.from('store_settings').select('*').limit(1).single(),
      supabase.from('banners').select('*').eq('is_active', true),
      supabase.from('products').select('*, product_variants(*), product_images(*)').eq('is_active', true)
    ]);

    res.json({
      settings: settingsRes.data || {},
      banners: bannersRes.data || [],
      products: productsRes.data || []
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout', async (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, shipping_district, shipping_address, customer_note, items, payment_method } = req.body;

    if (!customer_name || !customer_phone || !shipping_address || !items || items.length === 0) {
      return res.status(400).json({ error: 'সকল প্রয়োজনীয় তথ্য দিন।' });
    }

    const { data: settings } = await supabase.from('store_settings').select('*').limit(1).single();
    
    const deliveryCharge = shipping_district.toLowerCase().includes('dhaka') || shipping_district.includes('ঢাকা')
      ? Number(settings?.delivery_inside_dhaka || 80)
      : Number(settings?.delivery_outside_dhaka || 150);

    let subtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      const { data: prod } = await supabase.from('products').select('*').eq('id', item.product_id).single();
      if (!prod) continue;

      const itemTotal = Number(prod.sale_price) * Number(item.quantity);
      subtotal += itemTotal;

      verifiedItems.push({
        product_id: prod.id,
        product_name: prod.title,
        variant_info: item.variant_info || '',
        quantity: item.quantity,
        unit_price: prod.sale_price,
        total_price: itemTotal
      });
    }

    const grandTotal = subtotal + deliveryCharge;
    const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 900000);

    const { data: order, error: orderError } = await supabase.from('orders').insert({
      order_number: orderNumber,
      customer_name,
      customer_phone,
      shipping_district,
      shipping_address,
      customer_note,
      subtotal,
      delivery_charge: deliveryCharge,
      grand_total: grandTotal,
      payment_method: payment_method || 'cod',
      order_status: 'pending'
    }).select().single();

    if (orderError) throw orderError;

    const orderItemsWithId = verifiedItems.map(it => ({ ...it, order_id: order.id }));
    await supabase.from('order_items').insert(orderItemsWithId);

    sendTelegramAlert(order, verifiedItems);

    res.json({
      success: true,
      message: 'অর্ডার সফল হয়েছে!',
      order_number: order.order_number,
      grand_total: order.grand_total
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});
