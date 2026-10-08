// server.js — QURYLYS B2B Backend API Server
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Фронтенд файлдарды тікелей тарату

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// 1. АВТОРИЗАЦИЯ (DA01 / DBMS01)
app.post('/api/auth/login', async (req, res) => {
    const { login, company_code } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE license_code = $1',
            [company_code.toUpperCase()]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ status: 'error', detail: 'Лицензиялық код табылмады' });
        }
        const user = result.rows[0];
        res.json({
            status: 'success',
            user: {
                user_name: user.user_name,
                company_name: user.company_name,
                role: user.role,
                role_display: user.role === 'BUYER' ? 'Сатып алушы (DA)' : 'Жеткізуші (DBMS)',
                bin: user.bin,
                license_code: user.license_code,
                balance: user.balance_kzt
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', detail: err.message });
    }
});

// 2. АКТИВТІ ЗАЯВКАЛАР ТІЗІМІН ШЫҒАРУ
app.get('/api/active-orders', async (req, res) => {
    try {
        const query = `
            SELECT o.*, p.name as product_name, p.unit, p.tnved, p.has_vat
            FROM orders o
            JOIN products p ON o.sku = p.sku
            ORDER BY o.created_at DESC
        `;
        const result = await pool.query(query);
        const mappedData = result.rows.map(r => ({
            order_id: r.order_id,
            date: new Date(r.created_at).toLocaleString('ru-RU'),
            product_name: r.product_name,
            sku: r.sku,
            qty: `${r.qty} ${r.unit}`,
            total: Number(r.total_amount),
            advance_percent: r.advance_percent,
            advance_amount: Number(r.advance_amount),
            remaining_amount: Number(r.remaining_amount),
            delivery_address: r.delivery_address,
            status: r.status,
            status_title: r.status === 'ACCEPTED' ? 'Қабылданды (Зауыт)' : (r.status === 'IN_TRANSIT' ? 'Жолда' : 'Жеткізілді'),
            track_code: r.track_code,
            courier_name: r.courier_name,
            has_vat: r.has_vat,
            tnved: r.tnved,
            payment_status: r.payment_status,
            qr_secret: r.qr_secret_hash
        }));
        res.json({ data: mappedData });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. ЖАҢА ЗАЯВКА ҚАБЫЛДАУ (Транзакциямен қойма қалдығын азайту)
app.post('/api/order-without-advance', async (req, res) => {
    const { sku, buyer_bin, quantity, delivery_address } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Тауар мен қалдықты тексеру
        const prodRes = await client.query('SELECT * FROM products WHERE sku = $1 FOR UPDATE', [sku]);
        if (prodRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ detail: 'Тауар табылмады' });
        }
        const product = prodRes.rows[0];

        if (Number(product.stock_qty) < Number(quantity)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ detail: `Қоймада жеткіліксіз! Бар қалдық: ${product.stock_qty} ${product.unit}` });
        }

        // Қаржылық есептеулер
        const total = Number(product.price_kzt) * Number(quantity);
        const advAmount = Math.round(total * (Number(product.advance_percent) / 100));
        const remAmount = total - advAmount;
        const orderId = `ORD-${Date.now().toString().slice(-8)}`;
        const trackCode = `TRK-QUR-${Math.floor(1000 + Math.random() * 9000)}`;
        const qrHash = crypto.randomBytes(16).toString('hex');

        // Қойма қалдығын шегеру
        await client.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE sku = $2', [quantity, sku]);

        // Тапсырыс жасау
        await client.query(`
            INSERT INTO orders (order_id, buyer_bin, sku, qty, total_amount, advance_percent, advance_amount, remaining_amount, payment_status, status, delivery_address, track_code, qr_secret_hash)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            orderId, buyer_bin, sku, quantity, total, 
            product.advance_percent, advAmount, remAmount, 
            advAmount === 0 ? 'FULLY_PAID' : 'WAITING_ADVANCE',
            'ACCEPTED', delivery_address || 'Алматы қ., Райымбек 212/1', trackCode, qrHash
        ]);

        await client.query('COMMIT');
        res.json({ message: `№ ${orderId} тапсырыс сәтті қабылданды!`, order_id: orderId, track_code: trackCode });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ detail: err.message });
    } finally {
        client.release();
    }
});

// 4. ТӨЛЕМ ШЛЮЗІ (KASPI PAY / HALYK WEBHOOK CALLBACK)
app.post('/api/payments/webhook', async (req, res) => {
    const { order_id, amount_paid, signature } = req.body;

    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1', [order_id]);
        if (orderRes.rows.length === 0) return res.status(404).send('Order not found');
        const order = orderRes.rows[0];

        if (Number(amount_paid) >= Number(order.advance_amount)) {
            await pool.query(`
                UPDATE orders 
                SET payment_status = 'ADVANCE_PAID', status = 'IN_TRANSIT' 
                WHERE order_id = $1
            `, [order_id]);

            // Зауытқа / Жеткізушіге авто-хабарлама (SMS/Telegram Bot арқылы)
            console.log(`[ALERT ЗАУЫТҚА] ${order.order_id} үшін ${amount_paid} ₸ аванс төленді! Жөнелтуге рұқсат берілді.`);
        }

        res.json({ status: 'PROCESSED' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. ҚОЙМА ЖӘНЕ ПРОРАБТЫҢ QR-СКАНЕРІ (З-2 НАКЛАДНАЯНЫ ЖАБУ)
app.post('/api/orders/qr-confirm', async (req, res) => {
    const { qr_hash, supervisor_bin } = req.body;

    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE qr_secret_hash = $1', [qr_hash]);
        if (orderRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Жарамсыз QR-код немесе жүкқұжат жоқ!' });
        }

        const order = orderRes.rows[0];
        if (order.status === 'DELIVERED') {
            return res.status(400).json({ success: false, message: 'Бұл тауар бұрын қабылданған және З-2 жабылған!' });
        }

        // Жүкқұжатты жауып, мәртебені "Жеткізілді" етіп бекіту
        await pool.query(`
            UPDATE orders 
            SET status = 'DELIVERED', payment_status = 'FULLY_PAID', z2_closed_at = NOW() 
            WHERE qr_secret_hash = $1
        `, [qr_hash]);

        res.json({ 
            success: true, 
            message: `З-2 Накладнаясы бекітілді! № ${order.order_id} қабылданды.`,
            order_id: order.order_id 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. КУРЬЕР ГЕОЛОКАЦИЯСЫН ЖАҢАРТУ ЖӘНЕ ОҚУ (LIVE 2GIS TRACKING)
app.post('/api/logistics/geo-update', async (req, res) => {
    const { order_id, lat, lon } = req.body;
    try {
        await pool.query(
            'INSERT INTO courier_geo_logs (order_id, lat, lon) VALUES ($1, $2, $3)',
            [order_id, lat, lon]
        );
        res.json({ status: 'UPDATED' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logistics/live/:order_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT lat, lon, updated_at FROM courier_geo_logs WHERE order_id = $1 ORDER BY id DESC LIMIT 1',
            [req.params.order_id]
        );
        if (result.rows.length === 0) {
            // Әдепкі нүкте (Алматы хабы)
            return res.json({ lat: 43.2642, lon: 76.8920 });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`QURYLYS Enterprise Backend http://localhost:${PORT} портында қосылды`);
});