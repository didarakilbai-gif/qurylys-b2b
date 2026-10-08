-- 1. Ұйымдар мен қолданушылар кестесі (Мердігерлер мен Зауыттар)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    bin VARCHAR(12) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    user_name VARCHAR(150) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('BUYER', 'SUPPLIER', 'ADMIN')),
    license_code VARCHAR(50) UNIQUE NOT NULL, -- DA01, DBMS01
    balance_kzt NUMERIC(15, 2) DEFAULT 0.00,
    phone VARCHAR(20),
    is_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Номенклатура және нақты қойма қалдықтары
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'дана',
    price_kzt NUMERIC(12, 2) NOT NULL,
    stock_qty NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    min_order_limit NUMERIC(12, 2) DEFAULT 15000.00,
    advance_percent INT DEFAULT 0 CHECK (advance_percent IN (0, 30, 50, 100)),
    has_vat BOOLEAN DEFAULT TRUE,
    tnved VARCHAR(10) DEFAULT '2523290000',
    okei VARCHAR(10) DEFAULT '778',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Тапсырыстар және қаржылық төлем мәртебесі
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) UNIQUE NOT NULL, -- ORD-1791418330
    buyer_bin VARCHAR(12) REFERENCES users(bin),
    sku VARCHAR(50) REFERENCES products(sku),
    qty NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL,
    advance_percent INT DEFAULT 0,
    advance_amount NUMERIC(15, 2) DEFAULT 0.00,
    remaining_amount NUMERIC(15, 2) NOT NULL,
    payment_status VARCHAR(30) DEFAULT 'WAITING_ADVANCE' 
        CHECK (payment_status IN ('WAITING_ADVANCE', 'ADVANCE_PAID', 'FULLY_PAID')),
    status VARCHAR(30) DEFAULT 'ACCEPTED' 
        CHECK (status IN ('PENDING', 'ACCEPTED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')),
    delivery_address TEXT NOT NULL,
    courier_name VARCHAR(100) DEFAULT 'Логистика бөлімі (+7 727 330-10-10)',
    track_code VARCHAR(50) UNIQUE NOT NULL,
    qr_secret_hash VARCHAR(64) NOT NULL, -- З-2 накладнаяны жабуға арналған кілт
    z2_closed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Логистикалық курьер трекингі (Live GPS)
CREATE TABLE courier_geo_logs (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES orders(order_id),
    lat NUMERIC(9, 6) NOT NULL,
    lon NUMERIC(9, 6) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Бастапқы тестілік мәліметтерді енгізу
INSERT INTO users (bin, company_name, user_name, role, license_code, balance_kzt) VALUES
('210340029182', 'ТОО ''Tolegen Stroy Enterprise''', 'Толеген Т.', 'BUYER', 'DA01', 5000000.00),
('180940023411', 'ТОО ''Semey Build Серіктестігі''', 'Айдос С.', 'SUPPLIER', 'DBMS01', 120000.00);

INSERT INTO products (sku, name, brand, category, unit, price_kzt, stock_qty, limit_min, advance_percent, has_vat) VALUES
('CEM-ALA-M400', 'Цемент Аласем ПЦ 400-Д20 (50 кг қап)', 'Аласем (Alacem)', 'Цемент', 'қап', 1750, 1800, 87500, 30, true),
('CEM-ALA-M500', 'Цемент Аласем ПЦ 500-Д0 (Үйінді/Вагон)', 'Аласем (Alacem)', 'Цемент', 'тонна', 34500, 350, 172500, 50, true),
('HRT-P-110', '110 по кафелю без фланца HRT-P-110', 'HARTEK Tools', 'Құрал-саймандар', 'дана', 1650, 420, 16500, 0, false),
('KNF-ROT-30', 'Гипс сылағы Knauf Ротбанд 30 кг', 'Knauf', 'Құрғақ қоспалар', 'қап', 3450, 600, 34500, 0, true);