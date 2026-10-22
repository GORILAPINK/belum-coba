const SUPABASE_URL = 'https://txmbeylyepacynfulwip.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FGNsE1INo7jcMgZ-bRPzvg_o2txZETj';

const ADMIN_1_NUMBER = '6281234567890'; 
const ADMIN_2_NUMBER = '6289876543210'; 

const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let CURRENT_USER_ID = null; 
let CURRENT_AUTH_ID = null; 
let activeCartId = null;

let currentDonation = 0; 
let currentTotalItems = 0;
let currentTotalProducts = 0;
let currentGrandTotal = 0;
let currentCartItemsData = []; 
let timerInterval = null;

// Format Rupiah
function formatRupiah(value) {
    return Number(value || 0).toLocaleString('id-ID');
}

// Amankan teks dari XSS
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

// Login Google OAuth
async function signInWithGoogle() {
    const { error } = await _supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.href
        }
    });

    if (error) {
        console.error('Login Google gagal:', error.message);
        alert('Login Google gagal: ' + error.message);
    }
}

// Logout
async function signOutGoogle() {
    const { error } = await _supabase.auth.signOut();
    if (error) {
        alert('Gagal logout: ' + error.message);
        return;
    }

    CURRENT_USER_ID = null;
    CURRENT_AUTH_ID = null;
    activeCartId = null;
    currentCartItemsData = [];
    currentDonation = 0;

    updateAuthUI(null);
    await loadProducts();
    await loadCartItems();
    alert('Berhasil keluar akun.');
}

// Perbarui Tampilan Tombol Login / Profil Header
function updateAuthUI(userSession) {
    const authContainer = document.getElementById('auth-container');
    if (!authContainer) return;

    if (!userSession) {
        authContainer.innerHTML = `
            <button onclick="signInWithGoogle()" class="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg font-medium shadow-sm transition flex items-center gap-2 text-sm">
                <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96H1.18v3.14C3.16 21.32 7.24 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.62H1.18C.43 8.13 0 9.81 0 12s.43 3.87 1.18 5.38l4.09-3.14z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.24 0 3.16 2.68 1.18 6.62l4.09 3.14c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
                Login Google
            </button>
        `;
    } else {
        const metadata = userSession.user_metadata || {};
        const name = metadata.full_name || metadata.name || userSession.email.split('@')[0];
        const avatar = metadata.avatar_url || metadata.picture;

        authContainer.innerHTML = `
            <div class="flex items-center gap-3">
                ${avatar ? `<img src="${escapeHtml(avatar)}" alt="Avatar" class="w-8 h-8 rounded-full border">` : ''}
                <span class="text-sm font-semibold text-gray-700 hidden sm:inline">${escapeHtml(name)}</span>
                <button onclick="signOutGoogle()" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition">
                    Logout
                </button>
            </div>
        `;
    }
}

// Sinkronisasi data pengguna ke tabel database 'users'
async function ensureUserExists() {
    const { data: { session }, error: sessionError } = await _supabase.auth.getSession();

    if (sessionError || !session?.user) {
        CURRENT_USER_ID = null;
        CURRENT_AUTH_ID = null;
        updateAuthUI(null);
        return false;
    }

    updateAuthUI(session.user);
    const authUser = session.user;
    const authId = authUser.id;
    const email = authUser.email;
    const metadata = authUser.user_metadata || {};
    const name = metadata.full_name || metadata.name || email.split('@')[0];

    const { data: existingUser, error: findError } = await _supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', authId)
        .maybeSingle();

    if (findError) {
        console.error('Gagal mencari profil pengguna:', findError.message);
        return false;
    }

    if (existingUser) {
        CURRENT_USER_ID = existingUser.id;
    } else {
        const { data: newUser, error: insertError } = await _supabase
            .from('users')
            .insert([{
                auth_user_id: authId,
                name: name,
                email: email,
                role: 'customer'
            }])
            .select('id')
            .single();

        if (insertError) {
            console.error('Gagal membuat profil di tabel users:', insertError.message);
            return false;
        }
        CURRENT_USER_ID = newUser.id;
    }

    CURRENT_AUTH_ID = authId;
    return true;
}

// Dapatkan atau buat keranjang aktif untuk user
async function getOrCreateUserCart() {
    if (!CURRENT_USER_ID) return false;

    let { data: cart, error: cartError } = await _supabase
        .from('carts')
        .select('id')
        .eq('user_id', CURRENT_USER_ID)
        .maybeSingle();

    if (cartError) {
        console.error('Gagal mengambil keranjang:', cartError.message);
        return false;
    }

    if (!cart) {
        const { data: newCart, error: createError } = await _supabase
            .from('carts')
            .insert([{ user_id: CURRENT_USER_ID }])
            .select('id')
            .single();

        if (createError || !newCart) {
            console.error('Gagal membuat keranjang baru:', createError?.message);
            return false;
        }
        activeCartId = newCart.id;
    } else {
        activeCartId = cart.id;
    }

    return true;
}

// Inisialisasi Utama Aplikasi
async function initApp() {
    const isAuthed = await ensureUserExists();
    if (isAuthed) {
        await getOrCreateUserCart();
    }
    await loadProducts();
    await loadCartItems();
}

// Listener perubahan state auth Supabase
_supabase.auth.onAuthStateChange(async (event, session) => {
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) {
        await initApp();
    }
});

// Memuat Katalog Produk
async function loadProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    const { data: products, error } = await _supabase
        .from('produk')
        .select('id, name, price, stock')
        .order('id', { ascending: true });

    if (error || !products || products.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-gray-500 text-center">Belum ada produk yang tersedia.</p>';
        return;
    }

    grid.innerHTML = products.map(product => `
        <div class="bg-white rounded-lg shadow p-4 flex flex-col justify-between hover:shadow-md transition">
            <div>
                <div class="h-32 bg-gray-200 rounded-md mb-4 flex items-center justify-center text-gray-500 font-bold">
                    📦 ${escapeHtml(product.name)}
                </div>
                <h3 class="font-semibold text-lg text-gray-800">${escapeHtml(product.name)}</h3>
                <p class="text-blue-600 font-bold mt-1">Rp ${formatRupiah(product.price)}</p>
                <p class="text-xs text-gray-500 mt-1">Stok: ${Number(product.stock)}</p>
            </div>
            <button 
                onclick="addToCart(${Number(product.id)})" 
                ${Number(product.stock) <= 0 ? 'disabled' : ''} 
                class="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-medium py-2 rounded transition">
                ${Number(product.stock) > 0 ? '+ Keranjang' : 'Stok Habis'}
            </button>
        </div>
    `).join('');
}

// Tambah Produk ke Keranjang
async function addToCart(productId) {
    const isAuthed = await ensureUserExists();
    if (!isAuthed || !CURRENT_USER_ID) {
        alert('Silakan login menggunakan Google terlebih dahulu untuk berbelanja.');
        signInWithGoogle();
        return;
    }

    if (!activeCartId) {
        const ready = await getOrCreateUserCart();
        if (!ready) {
            alert('Gagal memuat keranjang belanja pengguna.');
            return;
        }
    }

    const { data: product, error: prodErr } = await _supabase
        .from('produk')
        .select('id, stock')
        .eq('id', productId)
        .maybeSingle();

    if (prodErr || !product || Number(product.stock) <= 0) {
        alert('Produk tidak ditemukan atau stok habis.');
        await loadProducts();
        return;
    }

    const { data: existingItem } = await _supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', activeCartId)
        .eq('product_id', productId)
        .maybeSingle();

    const newQty = Number(existingItem?.quantity || 0) + 1;
    if (newQty > Number(product.stock)) {
        alert('Jumlah melebihi stok yang tersedia.');
        return;
    }

    if (existingItem) {
        await _supabase
            .from('cart_items')
            .update({ quantity: newQty })
            .eq('id', existingItem.id);
    } else {
        await _supabase
            .from('cart_items')
            .insert([{ cart_id: activeCartId, product_id: productId, quantity: 1 }]);
    }

    await loadCartItems();
    alert('Produk berhasil ditambahkan ke keranjang!');
}

// Memuat Item Keranjang Belanja
async function loadCartItems() {
    const container = document.getElementById('cart-items-container');
    const cartCount = document.getElementById('cart-count');
    const subtotalProductsEl = document.getElementById('subtotal-products');
    const subtotalDonationEl = document.getElementById('subtotal-donation');
    const cartTotalEl = document.getElementById('cart-total');
    const donationSection = document.getElementById('cart-donation-section');
    const donationText = document.getElementById('donation-amount-text');

    if (!container) return;

    if (!activeCartId || !CURRENT_USER_ID) {
        currentCartItemsData = [];
        container.innerHTML = '<p class="text-gray-500 text-center py-8">Silakan login Google untuk melihat keranjang.</p>';
        if (cartCount) cartCount.innerText = '0';
        if (subtotalProductsEl) subtotalProductsEl.innerText = 'Rp 0';
        if (subtotalDonationEl) subtotalDonationEl.innerText = 'Rp ' + formatRupiah(currentDonation);
        if (cartTotalEl) cartTotalEl.innerText = 'Rp ' + formatRupiah(currentDonation);
        if (donationSection) donationSection.classList.toggle('hidden', currentDonation <= 0);
        return;
    }

    const { data: items, error } = await _supabase
        .from('cart_items')
        .select(`
            id,
            quantity,
            produk ( id, name, price, stock )
        `)
        .eq('cart_id', activeCartId);

    if (error) {
        console.error('Gagal mengambil item keranjang:', error.message);
        container.innerHTML = '<p class="text-gray-500 text-center py-8">Keranjang Anda kosong.</p>';
        return;
    }

    currentCartItemsData = items || [];
    let totalItemCount = 0;
    let productTotalPrice = 0;

    if (!items || items.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">Keranjang belanja Anda masih kosong.</p>';
    } else {
        container.innerHTML = items.map(item => {
            const product = item.produk;
            const price = Number(product?.price || 0);
            const name = product?.name || 'Produk';
            const quantity = Number(item.quantity || 0);
            const subtotal = quantity * price;

            totalItemCount += quantity;
            productTotalPrice += subtotal;

            return `
                <div class="flex justify-between items-center border-b pb-3 mb-3">
                    <div class="flex-1 pr-2">
                        <p class="font-semibold text-gray-800 text-sm">${escapeHtml(name)}</p>
                        <p class="text-xs text-gray-500">@ Rp ${formatRupiah(price)}</p>
                        <div class="flex items-center gap-2 mt-2">
                            <button onclick="updateQuantity(${Number(item.id)}, ${quantity - 1})" class="w-6 h-6 rounded bg-gray-200 font-bold hover:bg-gray-300">-</button>
                            <span class="text-xs font-semibold">${quantity}</span>
                            <button onclick="updateQuantity(${Number(item.id)}, ${quantity + 1})" class="w-6 h-6 rounded bg-gray-200 font-bold hover:bg-gray-300">+</button>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="font-bold text-gray-700 text-sm">Rp ${formatRupiah(subtotal)}</span>
                        <button onclick="removeFromCart(${Number(item.id)})" class="text-red-500 text-lg font-bold hover:text-red-700">&times;</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    currentTotalItems = totalItemCount;
    currentTotalProducts = currentCartItemsData.length;
    currentGrandTotal = productTotalPrice + currentDonation;

    if (donationSection) {
        donationSection.classList.toggle('hidden', currentDonation <= 0);
    }
    if (donationText) {
        donationText.innerText = 'Rp ' + formatRupiah(currentDonation);
    }
    if (cartCount) {
        cartCount.innerText = totalItemCount + (currentDonation > 0 ? 1 : 0);
    }
    if (subtotalProductsEl) {
        subtotalProductsEl.innerText = 'Rp ' + formatRupiah(productTotalPrice);
    }
    if (subtotalDonationEl) {
        subtotalDonationEl.innerText = 'Rp ' + formatRupiah(currentDonation);
    }
    if (cartTotalEl) {
        cartTotalEl.innerText = 'Rp ' + formatRupiah(currentGrandTotal);
    }
}

// Update Kuantitas Item
async function updateQuantity(cartItemId, newQty) {
    if (!activeCartId) return;

    if (newQty <= 0) {
        await removeFromCart(cartItemId);
        return;
    }

    const item = currentCartItemsData.find(row => String(row.id) === String(cartItemId));
    if (!item || !item.produk) return;

    if (newQty > Number(item.produk.stock)) {
        alert('Jumlah melebihi stok yang tersedia.');
        return;
    }

    const { error } = await _supabase
        .from('cart_items')
        .update({ quantity: newQty })
        .eq('id', cartItemId)
        .eq('cart_id', activeCartId);

    if (error) {
        alert('Gagal mengubah kuantitas: ' + error.message);
        return;
    }

    await loadCartItems();
}

// Hapus Item dari Keranjang
async function removeFromCart(cartItemId) {
    if (!activeCartId) return;

    const { error } = await _supabase
        .from('cart_items')
        .delete()
        .eq('id', cartItemId)
        .eq('cart_id', activeCartId);

    if (error) {
        alert('Gagal menghapus item: ' + error.message);
        return;
    }

    await loadCartItems();
}

// Atur Donasi
function setDonation(amount) {
    currentDonation = Math.max(0, Number(amount) || 0);
    loadCartItems();
    toggleCartModal();
}

function addCustomDonation() {
    const input = document.getElementById('custom-donation');
    const value = Number(input?.value);

    if (!Number.isSafeInteger(value) || value <= 0) {
        alert('Masukkan nominal donasi yang valid.');
        return;
    }

    currentDonation = value;
    loadCartItems();
    if (input) input.value = '';
    toggleCartModal();
}

function removeDonation() {
    currentDonation = 0;
    loadCartItems();
}

// Proses Checkout
async function processCheckout() {
    const isAuthed = await ensureUserExists();
    if (!isAuthed || !CURRENT_USER_ID) {
        alert('Silakan login Google sebelum melakukan checkout.');
        signInWithGoogle();
        return;
    }

    await loadCartItems();

    if (currentTotalItems === 0 && currentDonation === 0) {
        alert('Keranjang belanja Anda masih kosong!');
        return;
    }

    const payload = {
        cart_id: activeCartId,
        total_items: currentTotalItems,
        total_products: currentTotalProducts,
        grand_total: currentGrandTotal
    };

    if (currentDonation > 0) {
        payload.donasi = currentDonation;
    }

    const { error } = await _supabase
        .from('checkout')
        .insert([payload]);

    if (error) {
        alert('Gagal memproses checkout: ' + error.message);
        return;
    }

    toggleCartModal();

    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const qrisModal = document.getElementById('qris-modal');
    const orderIdEl = document.getElementById('order-id');
    const qrisTotalEl = document.getElementById('qris-total');
    const qrisImgEl = document.getElementById('qris-img');

    if (qrisModal && qrisImgEl) {
        if (orderIdEl) orderIdEl.innerText = orderId;
        if (qrisTotalEl) qrisTotalEl.innerText = 'Rp ' + formatRupiah(currentGrandTotal);
        qrisImgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=QRIS-${orderId}-${currentGrandTotal}`;

        qrisModal.classList.remove('hidden');
        qrisModal.style.display = 'flex';
        startQrisTimer(15 * 60);
    }
}

// Timer Countdown QRIS
function startQrisTimer(duration) {
    let timer = duration;
    const timerEl = document.getElementById('timer');
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        const minutes = Math.floor(timer / 60);
        const seconds = timer % 60;
        
        if (timerEl) {
            timerEl.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        if (--timer < 0) {
            clearInterval(timerInterval);
            alert('Waktu pembayaran QRIS telah habis!');
            closeQrisModal();
        }
    }, 1000);
}

// Konfirmasi Pembayaran
async function confirmPayment() {
    clearInterval(timerInterval);
    if (typeof confetti === 'function') {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
    alert('Pembayaran QRIS Berhasil Dikonfirmasi! Pesanan Anda segera diproses.');
    
    if (activeCartId) {
        await _supabase.from('cart_items').delete().eq('cart_id', activeCartId);
    }
    currentDonation = 0;
    await loadCartItems();
    closeQrisModal();
}

function closeQrisModal() {
    const qrisModal = document.getElementById('qris-modal');
    if (qrisModal) {
        qrisModal.classList.add('hidden');
        qrisModal.style.display = 'none';
    }
}

function toggleCartModal() {
    document.getElementById('cart-modal')?.classList.toggle('hidden');
}

// Jalankan inisialisasi aplikasi
initApp();