const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID) || 5055497784;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('MongoDB Connected Successfully'))
        .catch(err => console.error('MongoDB Connection Error:', err));
}

// Mongoose Models
const Category = mongoose.model('Category', new mongoose.Schema({
    name: { type: String, required: true, unique: true }
}));

const Product = mongoose.model('Product', new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    image: { type: String, default: 'https://via.placeholder.com/300' }
}));

// Cloudinary Config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
    storage: new CloudinaryStorage({
        cloudinary: cloudinary,
        params: { folder: 'bkkpod_products', allowed_formats: ['jpg', 'png', 'jpeg', 'webp'] }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Auth Middleware
function verifyTelegramData(telegramInitData) {
    if (!telegramInitData) return null;
    try {
        const urlParams = new URLSearchParams(telegramInitData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const paramsArr = Array.from(urlParams.entries()).map(([k, v]) => `${k}=${v}`).sort();
        const dataCheckString = paramsArr.join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash !== hash) return null;
        return JSON.parse(urlParams.get('user'));
    } catch (e) {
        return null;
    }
}

function authMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    const user = verifyTelegramData(initData);
    req.user = user || { id: 0, first_name: "Guest" };
    req.isAdmin = user ? Number(user.id) === Number(ADMIN_USER_ID) : false;
    next();
}

function adminOnly(req, res, next) {
    if (!req.isAdmin) return res.status(403).json({ error: "Access denied. Admin only." });
    next();
}

// API Routes
app.get('/api/me', authMiddleware, (req, res) => res.json({ user: req.user, isAdmin: req.isAdmin }));

app.get('/api/categories', async (req, res) => {
    const categories = await Category.find();
    res.json(categories.map(c => c.name));
});

app.post('/api/categories', authMiddleware, adminOnly, async (req, res) => {
    try {
        await Category.create({ name: req.body.name });
        const categories = await Category.find();
        res.json({ success: true, categories: categories.map(c => c.name) });
    } catch (err) {
        res.status(400).json({ error: "หมวดหมู่นี้มีอยู่แล้ว" });
    }
});

app.post('/api/categories', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อหมวดหมู่" });
        
        await Category.create({ name });
        const categories = await Category.find();
        res.json({ success: true, categories: categories.map(c => c.name) });
    } catch (err) {
        console.error("Add Category Error:", err);
        // ส่งข้อความ Error จากระบบกลับไปแสดงบนหน้าจอ
        res.status(500).json({ error: `ไม่สามารถเพิ่มได้: ${err.message}` });
    }
});
                                                           

app.delete('/api/categories/:name', authMiddleware, adminOnly, async (req, res) => {
    const total = await Category.countDocuments();
    if (total <= 1) return res.status(400).json({ error: "ต้องมีอย่างน้อย 1 หมวดหมู่" });
    
    await Category.deleteOne({ name: req.params.name });
    const fallback = await Category.findOne();
    if (fallback) await Product.updateMany({ category: req.params.name }, { category: fallback.name });
    
    const categories = await Category.find();
    res.json({ success: true, categories: categories.map(c => c.name) });
});

app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    res.json(products.map(p => ({ id: p._id, name: p.name, price: p.price, category: p.category, image: p.image })));
});

app.post('/api/products', authMiddleware, adminOnly, upload.single('image'), async (req, res) => {
    const { name, price, category } = req.body;
    const fallbackCat = await Category.findOne();
    const catToUse = category || (fallbackCat ? fallbackCat.name : "General");
    const imageUrl = req.file ? req.file.path : 'https://via.placeholder.com/300';

    const newProduct = await Product.create({ name, price: Number(price), category: catToUse, image: imageUrl });
    res.json({ success: true, product: { id: newProduct._id, name, price, category: catToUse, image: imageUrl } });
});

app.delete('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  
