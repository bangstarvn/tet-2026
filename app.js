const ACCOUNTS_INDEX_KEY = 'lixi_tet_accounts_v1';
const ACTIVE_PHONE_KEY = 'lixi_tet_active_phone_v1';
const USER_STATE_PREFIX = 'lixi_tet_user_';
const GUEST_SPUN_PREFIX = 'lixi_tet_guest_spun_';
const SECRET_PASS = '2027';

// Firebase Realtime Database config (Project: Tet2027)
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyALBsjtIzpJk_L_mvYZe0ov4YcCpogtI5U',
  authDomain: 'tet2027-1c101.firebaseapp.com',
  databaseURL: 'https://tet2027-1c101-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'tet2027-1c101',
  storageBucket: 'tet2027-1c101.firebasestorage.app',
  messagingSenderId: '951751063089',
  appId: '1:951751063089:web:bbc3022cbfdf4d60c48710',
  measurementId: 'G-6MKB6HFNV5'
};

const DEFAULT_DENOMINATIONS = [
  0, 10000, 20000, 50000, 68000, 88000, 100000, 200000, 500000
];

const DEFAULT_QUANTITIES = {
  0: 5,
  10000: 10,
  20000: 10,
  50000: 8,
  68000: 5,
  88000: 5,
  100000: 5,
  200000: 3,
  500000: 2
};

const TET_WISHES = [
  'Tiền vào như nước sông Đà, tiền ra nhỏ giọt như cà phê phin!',
  'An khang thịnh vượng – Vạn sự như ý – Tỷ sự như mơ!',
  'Năm mới phát tài phát lộc, công việc thuận buồm xuôi gió!',
  'Sức khỏe dồi dào, túi tiền rủng rỉnh, hạnh phúc ngập tràn!',
  'Khai xuân đón lộc, cả năm may mắn, đánh đâu thắng đó!',
  'Lộc biếc mai vàng xuân hạnh phúc – Đời vui sức khỏe Tết an khang!',
  'Cung chúc tân xuân – Tiền đầy túi, tình đầy tim!'
];

const ENVELOPE_COUNT = 12;

function createDefaultState() {
  return {
    initialBudget: 5000000,
    remainingBudget: 5000000,
    deductFromTotal: true,
    allowRemainder: true,
    limitOneSpinPerGuest: false,
    ownerName: '',
    denominations: [...DEFAULT_DENOMINATIONS],
    activeDenominations: [0, 10000, 20000, 50000, 100000, 200000, 500000],
    denomQuantities: { ...DEFAULT_QUANTITIES },
    history: [],
    filter: 'all'
  };
}

let currentPhone = null;
let currentUserName = '';
let isGuestMode = false;
let guestDeductFromTotal = true; // Gạt quay thật / quay thử riêng trên máy khách
let state = createDefaultState();

// Firebase runtime handles
let fbDb = null;
let fbRoomRef = null;
let fbRoomListener = null;
let fbConnected = false;

// Runtime UI state (always locked as *** on fresh load until password 2027 entered)
let isUnlocked = false;
let envelopes = [];
let isSpinning = false;
let activeQrRecordId = null;

// Initialize Firebase safely (falls back to localStorage if offline/unavailable)
function initFirebase() {
  try {
    if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.databaseURL) {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      fbDb = firebase.database();
      fbDb.ref('.info/connected').on('value', (snap) => {
        fbConnected = Boolean(snap.val());
        updateSyncBadge();
      });
    } else {
      updateSyncBadge();
    }
  } catch (e) {
    console.warn('Firebase init failed, using localStorage fallback:', e);
    fbDb = null;
    updateSyncBadge();
  }
}

function updateSyncBadge() {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  if (fbDb && fbConnected) {
    badge.textContent = '🟢 Realtime Online';
    badge.className = 'sync-badge online';
  } else {
    badge.textContent = '🟡 Offline (Lưu máy)';
    badge.className = 'sync-badge offline';
  }
}

// Phone & Multi-account helpers
function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d]/g, '');
}

function isValidPhone(phone) {
  return /^\d{9,11}$/.test(phone);
}

function getSavedAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function registerAccount(phone, displayName) {
  const accounts = getSavedAccounts();
  const existing = accounts.find((a) => a.phone === phone);
  if (existing) {
    if (displayName) existing.name = displayName;
    existing.lastLogin = Date.now();
  } else {
    accounts.unshift({ phone, name: displayName || '', lastLogin: Date.now() });
  }
  try {
    localStorage.setItem(ACCOUNTS_INDEX_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.error('Cannot save accounts index:', e);
  }
}

function getStorageKeyForPhone(phone) {
  return `${USER_STATE_PREFIX}${phone}`;
}

function hasGuestSpun(roomPhone) {
  try {
    return localStorage.getItem(`${GUEST_SPUN_PREFIX}${roomPhone}`) === '1';
  } catch {
    return false;
  }
}

function markGuestSpun(roomPhone) {
  try {
    localStorage.setItem(`${GUEST_SPUN_PREFIX}${roomPhone}`, '1');
  } catch {}
}

// Helpers
function formatVND(amount) {
  return Number(amount || 0).toLocaleString('vi-VN') + ' ₫';
}

function formatDenomLabel(denom) {
  return denom === 0 ? '🧧 Lời chúc Tết' : formatVND(denom);
}

function formatPrizeLabel(amount) {
  return amount === 0 ? '🧧 Lời chúc Tết' : formatVND(amount);
}

function formatSecretVND(amount) {
  return isUnlocked ? formatVND(amount) : '***';
}

function formatNumberInput(num) {
  return Number(num || 0).toLocaleString('vi-VN');
}

function parseNumberInput(str) {
  const digits = String(str).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function getQtyFromMap(map, denom) {
  const q = map?.[denom] ?? map?.[String(denom)];
  return typeof q === 'number' && q >= 0 ? q : 0;
}

function getQty(denom) {
  return getQtyFromMap(state.denomQuantities, denom);
}

function setQty(denom, qty) {
  if (!state.denomQuantities) state.denomQuantities = {};
  state.denomQuantities[String(denom)] = Math.max(0, parseInt(qty, 10) || 0);
}

// Normalize raw room data (from localStorage or Firebase) into valid state object
function normalizeStateObject(parsed) {
  const base = createDefaultState();
  if (!parsed || typeof parsed !== 'object') return base;

  let denoms = Array.isArray(parsed.denominations) && parsed.denominations.length
    ? parsed.denominations.map(Number)
    : [...DEFAULT_DENOMINATIONS];
  if (!denoms.includes(0)) denoms.unshift(0);

  const rawQtys = parsed.denomQuantities || {};
  const quantities = {};
  denoms.forEach((d) => {
    const val = rawQtys[d] ?? rawQtys[String(d)];
    quantities[String(d)] = typeof val === 'number' ? val : (DEFAULT_QUANTITIES[d] ?? 5);
  });

  const activeDenoms = Array.isArray(parsed.activeDenominations)
    ? parsed.activeDenominations.map(Number)
    : [...base.activeDenominations];

  const history = Array.isArray(parsed.history)
    ? parsed.history
    : parsed.history && typeof parsed.history === 'object'
      ? Object.values(parsed.history)
      : [];

  return {
    ...base,
    ...parsed,
    initialBudget: Number(parsed.initialBudget ?? base.initialBudget),
    remainingBudget: Number(parsed.remainingBudget ?? base.remainingBudget),
    deductFromTotal: parsed.deductFromTotal !== undefined ? Boolean(parsed.deductFromTotal) : true,
    allowRemainder: parsed.allowRemainder !== undefined ? Boolean(parsed.allowRemainder) : true,
    limitOneSpinPerGuest: Boolean(parsed.limitOneSpinPerGuest),
    ownerName: parsed.ownerName || '',
    denominations: denoms,
    activeDenominations: activeDenoms,
    denomQuantities: quantities,
    history,
    filter: state.filter || 'all'
  };
}

function saveLocalState() {
  if (!currentPhone) return;
  try {
    localStorage.setItem(getStorageKeyForPhone(currentPhone), JSON.stringify(state));
  } catch (e) {
    console.error('Cannot save to localStorage:', e);
  }
}

function saveState() {
  saveLocalState();
  if (fbRoomRef && !isGuestMode) {
    // Exclude UI-only filter from cloud sync
    const payload = { ...state };
    delete payload.filter;
    fbRoomRef.set(payload).catch((e) => console.warn('Firebase write error:', e));
  }
}

function loadLocalStateForPhone(phone) {
  try {
    const raw = localStorage.getItem(getStorageKeyForPhone(phone));
    if (!raw) return null;
    return normalizeStateObject(JSON.parse(raw));
  } catch (e) {
    console.error('Cannot load local state:', e);
    return null;
  }
}

function detachFirebaseRoom() {
  if (fbRoomRef && fbRoomListener) {
    fbRoomRef.off('value', fbRoomListener);
  }
  fbRoomRef = null;
  fbRoomListener = null;
}

function attachFirebaseRoom(phone) {
  detachFirebaseRoom();
  if (!fbDb || !phone) return;

  fbRoomRef = fbDb.ref(`rooms/${phone}`);
  let firstLoad = true;

  fbRoomListener = fbRoomRef.on('value', (snap) => {
    const remote = snap.val();
    if (remote) {
      const currentFilter = state.filter;
      state = normalizeStateObject(remote);
      state.filter = currentFilter;
      if (state.ownerName && isGuestMode) {
        document.getElementById('current-name-display').textContent = state.ownerName;
      }
      saveLocalState();
      renderAll();
    } else if (firstLoad && !isGuestMode) {
      // Room does not exist in Firebase yet -> push initial host state
      saveState();
    } else if (firstLoad && isGuestMode) {
      alert(`Phòng lì xì (${phone}) chưa được khởi tạo hoặc không tồn tại!`);
    }
    firstLoad = false;
  }, (err) => {
    console.warn('Firebase listen error:', err);
  });
}

function initEnvelopes() {
  envelopes = Array.from({ length: ENVELOPE_COUNT }, (_, idx) => ({
    index: idx + 1,
    opened: false,
    amount: null,
    isTrial: false
  }));
}

function renderSavedAccountsChips() {
  const wrap = document.getElementById('saved-accounts-wrap');
  const list = document.getElementById('saved-accounts-list');
  const accounts = getSavedAccounts();

  if (!accounts.length) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  list.innerHTML = '';
  accounts.forEach((acc) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saved-acc-chip';
    btn.textContent = acc.name ? `${acc.phone} (${acc.name})` : acc.phone;
    btn.addEventListener('click', () => {
      loginWithPhone(acc.phone, acc.name);
    });
    list.appendChild(btn);
  });
}

function loginWithPhone(rawPhone, rawName) {
  const phone = normalizePhone(rawPhone);
  if (!isValidPhone(phone)) {
    alert('Vui lòng nhập số điện thoại hợp lệ (9 - 11 chữ số)!');
    return false;
  }

  const accounts = getSavedAccounts();
  const existing = accounts.find((a) => a.phone === phone);
  const displayName = (rawName || '').trim() || existing?.name || '';

  isGuestMode = false;
  document.body.classList.remove('guest-mode');
  document.getElementById('guest-bank-bar').hidden = true;

  currentPhone = phone;
  currentUserName = displayName;
  isUnlocked = false;

  registerAccount(phone, displayName);
  try {
    localStorage.setItem(ACTIVE_PHONE_KEY, phone);
  } catch {}

  const localLoaded = loadLocalStateForPhone(phone);
  state = localLoaded || createDefaultState();
  if (displayName) state.ownerName = displayName;

  initEnvelopes();

  document.getElementById('account-role-label').innerHTML =
    `📱 Chủ quỹ: <strong id="current-phone-display">${phone}</strong>`;
  document.getElementById('current-name-display').textContent = displayName;
  document.getElementById('account-bar').hidden = false;
  document.getElementById('auth-modal').hidden = true;
  document.getElementById('secret-auth-bar').hidden = true;

  renderAll();
  attachFirebaseRoom(phone);
  return true;
}

function enterGuestRoom(roomPhone) {
  const phone = normalizePhone(roomPhone);
  if (!isValidPhone(phone)) {
    alert('Link phòng lì xì không hợp lệ!');
    openAuthModal(true);
    return;
  }

  isGuestMode = true;
  document.body.classList.add('guest-mode');
  document.getElementById('guest-bank-bar').hidden = false;

  currentPhone = phone;
  isUnlocked = false;
  state = loadLocalStateForPhone(phone) || createDefaultState();
  initEnvelopes();

  document.getElementById('account-role-label').innerHTML =
    `🎁 Phòng Lì Xì: <strong id="current-phone-display">${phone}</strong>`;
  document.getElementById('current-name-display').textContent = state.ownerName || 'Khách mời';
  document.getElementById('account-bar').hidden = false;
  document.getElementById('auth-modal').hidden = true;
  document.getElementById('recipient-input').placeholder = 'Nhập tên của bạn để nhận lì xì...';

  renderAll();
  attachFirebaseRoom(phone);
}

function openAuthModal(clearActive) {
  if (clearActive) {
    detachFirebaseRoom();
    currentPhone = null;
    currentUserName = '';
    isUnlocked = false;
    isGuestMode = false;
    document.body.classList.remove('guest-mode');
    try {
      localStorage.removeItem(ACTIVE_PHONE_KEY);
    } catch {}
    document.getElementById('account-bar').hidden = true;
  }
  document.getElementById('auth-phone-input').value = '';
  document.getElementById('auth-name-input').value = '';
  renderSavedAccountsChips();
  document.getElementById('auth-modal').hidden = false;
  setTimeout(() => document.getElementById('auth-phone-input').focus(), 60);
}

// Weighted random choice by remaining quantity (pure helper for both local & Firebase transaction)
function pickWeightedByQtyFromMap(denomList, qtyMap) {
  const totalQty = denomList.reduce((acc, d) => acc + Math.max(0, getQtyFromMap(qtyMap, d)), 0);
  if (totalQty <= 0) {
    return denomList[Math.floor(Math.random() * denomList.length)];
  }
  let r = Math.floor(Math.random() * totalQty);
  for (const d of denomList) {
    const q = Math.max(0, getQtyFromMap(qtyMap, d));
    if (r < q) return d;
    r -= q;
  }
  return denomList[denomList.length - 1];
}

// Pure evaluation function so both local mode and Firebase atomic transaction share exact same rules
function evaluatePick(targetState, deductOverride) {
  const active = (targetState.activeDenominations || []).slice().map(Number).sort((a, b) => a - b);
  if (active.length === 0) {
    return { error: 'Chưa có mệnh giá lì xì nào được bật!' };
  }

  const withStock = active.filter((d) => getQtyFromMap(targetState.denomQuantities, d) > 0);
  if (withStock.length === 0) {
    return { error: 'Tất cả các mệnh giá đều đã hết số lượng! Hãy báo chủ quỹ bổ sung.' };
  }

  const isReal = deductOverride !== undefined ? Boolean(deductOverride) : Boolean(targetState.deductFromTotal);

  if (isReal) {
    const affordable = withStock.filter((d) => d <= targetState.remainingBudget);
    if (affordable.length === 0) {
      if (targetState.remainingBudget <= 0) {
        return { error: 'Quỹ lì xì đã hết! Hẹn gặp lại năm sau hoặc báo chủ quỹ nạp thêm.' };
      }
      if (targetState.allowRemainder) {
        return { amount: targetState.remainingBudget, matchedDenom: null, isTrial: false };
      }
      return { error: 'Số dư còn lại nhỏ hơn mệnh giá thấp nhất đang mở!' };
    }
    const chosen = pickWeightedByQtyFromMap(affordable, targetState.denomQuantities);
    return { amount: chosen, matchedDenom: chosen, isTrial: false };
  }

  // Trial mode (host or guest)
  const pool = targetState.remainingBudget > 0
    ? withStock.filter((d) => d <= targetState.remainingBudget)
    : withStock;
  const effectivePool = pool.length > 0 ? pool : withStock;
  const chosen = pickWeightedByQtyFromMap(effectivePool, targetState.denomQuantities);
  return { amount: chosen, matchedDenom: chosen, isTrial: true };
}

function getEffectiveDeductFlag() {
  return isGuestMode ? guestDeductFromTotal : state.deductFromTotal;
}

// Open a specific envelope index (0-based)
function openEnvelope(envIdx) {
  if (isSpinning) return;
  const env = envelopes[envIdx];
  if (!env || env.opened) return;

  const isRealSpin = getEffectiveDeductFlag();

  if (isGuestMode && isRealSpin && state.limitOneSpinPerGuest && hasGuestSpun(currentPhone)) {
    alert('Bạn đã bóc lì xì thật trong phòng này rồi! Bạn vẫn có thể gạt sang Quay thử để chơi tiếp.');
    return;
  }

  const recipientInput = document.getElementById('recipient-input');
  const rawRecipient = recipientInput.value.trim();
  if (isGuestMode && !rawRecipient) {
    alert('Vui lòng nhập tên của bạn trước khi mở bao lì xì!');
    recipientInput.focus();
    return;
  }

  const guestBank = isGuestMode ? document.getElementById('guest-bank-select').value : '';
  const guestAcc = isGuestMode ? document.getElementById('guest-account-input').value.trim() : '';

  const wish = TET_WISHES[Math.floor(Math.random() * TET_WISHES.length)];
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Use Firebase Transaction when connected for atomic multi-user safety
  if (fbRoomRef && fbConnected) {
    let txResult = null;
    let txError = null;

    fbRoomRef.transaction((currentData) => {
      const s = normalizeStateObject(currentData || state);
      const picked = evaluatePick(s, isRealSpin);
      if (picked.error) {
        txError = picked.error;
        return; // abort transaction
      }

      const recipientName = rawRecipient || `Lộc Xuân #${s.history.length + 1}`;
      if (!picked.isTrial) {
        s.remainingBudget = Math.max(0, s.remainingBudget - picked.amount);
        if (picked.matchedDenom !== null) {
          const k = String(picked.matchedDenom);
          s.denomQuantities[k] = Math.max(0, getQtyFromMap(s.denomQuantities, picked.matchedDenom) - 1);
        }
      }

      const record = {
        id: Date.now() + Math.floor(Math.random() * 10000),
        recipient: recipientName,
        amount: picked.amount,
        wish,
        matchedDenom: picked.matchedDenom,
        isTrial: picked.isTrial,
        remainingAfter: s.remainingBudget,
        time: timeStr,
        envelopeIndex: env.index,
        bankCode: guestBank || '',
        bankAccount: guestAcc || '',
        bankName: '',
        bankMemo: guestAcc ? `Li xi Tet ${recipientName}` : '',
        isPaid: false
      };

      s.history.unshift(record);
      txResult = record;

      const payload = { ...s };
      delete payload.filter;
      return payload;
    }, (err, committed) => {
      if (err) {
        alert('Lỗi đồng bộ mạng, vui lòng thử lại!');
        return;
      }
      if (!committed || !txResult) {
        if (txError) alert(txError);
        return;
      }

      env.opened = true;
      env.amount = txResult.amount;
      env.isTrial = txResult.isTrial;
      if (isGuestMode && !txResult.isTrial) markGuestSpun(currentPhone);
      recipientInput.value = '';

      renderEnvelopes();
      showResultModal(txResult, wish);
      launchConfetti();
    });
    return;
  }

  // Offline / Local fallback
  const picked = evaluatePick(state, isRealSpin);
  if (picked.error) {
    alert(picked.error);
    return;
  }

  const recipientName = rawRecipient || `Lộc Xuân #${state.history.length + 1}`;
  if (!picked.isTrial) {
    state.remainingBudget = Math.max(0, state.remainingBudget - picked.amount);
    if (picked.matchedDenom !== null && getQty(picked.matchedDenom) > 0) {
      setQty(picked.matchedDenom, getQty(picked.matchedDenom) - 1);
    }
  }

  env.opened = true;
  env.amount = picked.amount;
  env.isTrial = picked.isTrial;

  const record = {
    id: Date.now() + Math.floor(Math.random() * 10000),
    recipient: recipientName,
    amount: picked.amount,
    wish,
    matchedDenom: picked.matchedDenom,
    isTrial: picked.isTrial,
    remainingAfter: state.remainingBudget,
    time: timeStr,
    envelopeIndex: env.index,
    bankCode: guestBank || '',
    bankAccount: guestAcc || '',
    bankName: '',
    bankMemo: guestAcc ? `Li xi Tet ${recipientName}` : '',
    isPaid: false
  };

  state.history.unshift(record);
  if (isGuestMode && !record.isTrial) markGuestSpun(currentPhone);
  recipientInput.value = '';

  saveState();
  renderAll();
  showResultModal(record, wish);
  launchConfetti();
}

// Auto-distribute remaining budget into quantities of active cash denominations (> 0)
function autoSplitBudgetToQuantities() {
  const activeCash = state.activeDenominations.filter((d) => d > 0).sort((a, b) => a - b);
  if (activeCash.length === 0) {
    alert('Vui lòng tích chọn ít nhất 1 mệnh giá tiền mặt (> 0đ) trước khi chia quỹ!');
    return;
  }

  let budget = state.remainingBudget > 0 ? state.remainingBudget : state.initialBudget;
  if (budget < activeCash[0]) {
    alert('Quỹ hiện tại nhỏ hơn mệnh giá tiền mặt nhỏ nhất đang chọn!');
    return;
  }

  state.denominations.forEach((d) => {
    if (d > 0 && activeCash.includes(d)) {
      setQty(d, 0);
    }
  });

  let safety = 0;
  while (budget >= activeCash[0] && safety < 10000) {
    const affordable = activeCash.filter((d) => d <= budget);
    if (affordable.length === 0) break;
    const pick = affordable[Math.floor(Math.random() * affordable.length)];
    setQty(pick, getQty(pick) + 1);
    budget -= pick;
    safety++;
  }

  saveState();
  renderAll();
}

// Spin animation across unopened envelopes
function spinRandomEnvelope() {
  if (isSpinning) return;

  const isRealSpin = getEffectiveDeductFlag();

  if (isGuestMode && isRealSpin && state.limitOneSpinPerGuest && hasGuestSpun(currentPhone)) {
    alert('Bạn đã bóc lì xì thật trong phòng này rồi! Bạn vẫn có thể gạt sang Quay thử để chơi tiếp.');
    return;
  }

  if (isGuestMode && !document.getElementById('recipient-input').value.trim()) {
    alert('Vui lòng nhập tên của bạn trước khi quay lì xì!');
    document.getElementById('recipient-input').focus();
    return;
  }

  let availableIndices = envelopes
    .map((e, i) => (!e.opened ? i : -1))
    .filter((i) => i !== -1);

  if (availableIndices.length === 0) {
    initEnvelopes();
    renderEnvelopes();
    availableIndices = envelopes.map((_, i) => i);
  }

  const testPick = evaluatePick(state, isRealSpin);
  if (testPick.error) {
    alert(testPick.error);
    return;
  }

  isSpinning = true;
  const spinBtn = document.getElementById('spin-random-btn');
  spinBtn.disabled = true;

  const targetIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
  const totalSteps = 16 + Math.floor(Math.random() * 8);
  let step = 0;

  const cards = document.querySelectorAll('.envelope-card');

  function tick() {
    cards.forEach((c) => c.classList.remove('highlighting'));

    if (step < totalSteps) {
      const currentEnvIdx = availableIndices[step % availableIndices.length];
      cards[currentEnvIdx]?.classList.add('highlighting');
      step++;
      const delay = 45 + Math.floor((step / totalSteps) * 140);
      setTimeout(tick, delay);
    } else {
      cards[targetIdx]?.classList.add('highlighting');
      setTimeout(() => {
        cards[targetIdx]?.classList.remove('highlighting');
        isSpinning = false;
        spinBtn.disabled = false;
        openEnvelope(targetIdx);
      }, 320);
    }
  }

  tick();
}

// Render functions
function renderSecretLockUI() {
  const btn = document.getElementById('toggle-secret-btn');
  const budgetInput = document.getElementById('budget-input');

  if (isUnlocked) {
    btn.textContent = '🔓 Ẩn thông tin';
    btn.classList.add('unlocked');
    budgetInput.type = 'text';
    budgetInput.value = formatNumberInput(state.initialBudget);
  } else {
    btn.textContent = '🔒 Hiện thông tin';
    btn.classList.remove('unlocked');
    budgetInput.type = 'password';
    budgetInput.value = '***';
  }
}

function renderBudgetStats() {
  document.getElementById('remaining-display').textContent = formatSecretVND(state.remainingBudget);
  document.getElementById('initial-display').textContent = formatSecretVND(state.initialBudget);

  const spentReal = state.history
    .filter((h) => !h.isTrial)
    .reduce((sum, h) => sum + h.amount, 0);
  document.getElementById('spent-display').textContent = formatVND(spentReal);

  const pct = !isUnlocked
    ? 100
    : state.initialBudget > 0
      ? Math.min(100, Math.max(0, (state.remainingBudget / state.initialBudget) * 100))
      : 0;
  document.getElementById('budget-progress').style.width = `${pct}%`;
}

function renderDenominations() {
  const grid = document.getElementById('denom-grid');
  grid.innerHTML = '';

  const sorted = state.denominations.slice().sort((a, b) => a - b);
  sorted.forEach((denom) => {
    const isActive = state.activeDenominations.includes(denom);
    const qty = getQty(denom);
    const isOverBudget = isUnlocked && state.deductFromTotal && denom > state.remainingBudget;
    const isOutOfStock = isUnlocked && qty <= 0;

    const row = document.createElement('div');
    row.className = [
      'denom-row',
      isActive ? 'active' : '',
      isOverBudget ? 'over-budget' : '',
      isOutOfStock ? 'out-of-stock' : ''
    ].filter(Boolean).join(' ');

    const qtyDisplayHTML = isUnlocked
      ? `<input type="number" class="qty-input" value="${qty}" min="0" />`
      : `<span class="qty-masked" title="Nhập mật khẩu để xem số lượng">***</span>`;

    row.innerHTML = `
      <label class="denom-check-label">
        <input type="checkbox" class="denom-cb" ${isActive ? 'checked' : ''} />
        <span>${formatDenomLabel(denom)}</span>
      </label>
      <div class="qty-control">
        <button type="button" class="qty-btn qty-minus" title="Giảm số lượng">&minus;</button>
        ${qtyDisplayHTML}
        <button type="button" class="qty-btn qty-plus" title="Tăng số lượng">+</button>
      </div>
      <button type="button" class="denom-remove" title="Xoá mệnh giá này">&times;</button>
    `;

    const cb = row.querySelector('.denom-cb');
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!state.activeDenominations.includes(denom)) {
          state.activeDenominations.push(denom);
        }
      } else {
        state.activeDenominations = state.activeDenominations.filter((d) => d !== denom);
      }
      saveState();
      renderDenominations();
    });

    row.querySelector('.qty-minus').addEventListener('click', () => {
      setQty(denom, getQty(denom) - 1);
      saveState();
      renderDenominations();
    });

    row.querySelector('.qty-plus').addEventListener('click', () => {
      setQty(denom, getQty(denom) + 1);
      saveState();
      renderDenominations();
    });

    const qtyInput = row.querySelector('.qty-input');
    if (qtyInput) {
      qtyInput.addEventListener('change', (e) => {
        setQty(denom, e.target.value);
        saveState();
        renderDenominations();
      });
    }

    row.querySelector('.denom-remove').addEventListener('click', () => {
      state.denominations = state.denominations.filter((d) => d !== denom);
      state.activeDenominations = state.activeDenominations.filter((d) => d !== denom);
      delete state.denomQuantities[String(denom)];
      saveState();
      renderDenominations();
    });

    grid.appendChild(row);
  });
}

function renderModeToggle() {
  const cb = document.getElementById('deduct-cb');
  const wrap = document.getElementById('deduct-toggle-wrap');
  const title = document.getElementById('mode-title');
  const subtitle = document.getElementById('mode-subtitle');
  const banner = document.getElementById('trial-banner');

  const isReal = getEffectiveDeductFlag();
  cb.checked = isReal;
  if (isReal) {
    wrap.classList.remove('trial-mode');
    title.textContent = isGuestMode ? 'Quay thật (Nhận lì xì)' : 'Trừ vào tổng tiền (Quay thật)';
    subtitle.textContent = 'Bỏ tích để chuyển sang lượt quay thử';
    banner.hidden = true;
  } else {
    wrap.classList.add('trial-mode');
    title.textContent = 'Chế độ Quay thử (Không trừ tiền)';
    subtitle.textContent = isGuestMode ? 'Tích lại để quay nhận lì xì thật' : 'Tích lại để trừ vào tổng tiền khi trúng';
    banner.hidden = false;
  }
}

function renderEnvelopes() {
  const grid = document.getElementById('envelopes-grid');
  grid.innerHTML = '';

  const symbols = ['PHÚC', 'LỘC', 'THỌ', 'TÀI', 'AN', 'TẾT'];

  envelopes.forEach((env, idx) => {
    const card = document.createElement('div');
    card.className = `envelope-card ${env.opened ? 'opened' : ''}`;
    const symbol = symbols[idx % symbols.length];

    if (env.opened) {
      card.innerHTML = `
        <span class="env-number">Bao #${env.index} ${env.isTrial ? '(Thử)' : ''}</span>
        <div class="env-coin">${env.amount === 0 ? '🧧' : '✓'}</div>
        <span class="env-label">${formatPrizeLabel(env.amount)}</span>
      `;
    } else {
      card.innerHTML = `
        <span class="env-number">Bao #${env.index}</span>
        <div class="env-coin">${symbol}</div>
        <span class="env-label">Chạm để mở</span>
      `;
      card.addEventListener('click', () => openEnvelope(idx));
    }

    grid.appendChild(card);
  });
}

function renderHistory() {
  const listEl = document.getElementById('history-list');
  const countAll = state.history.length;
  const countReal = state.history.filter((h) => !h.isTrial).length;
  const countTrial = state.history.filter((h) => h.isTrial).length;

  document.getElementById('count-all').textContent = countAll;
  document.getElementById('count-real').textContent = countReal;
  document.getElementById('count-trial').textContent = countTrial;

  const filtered = state.history.filter((h) => {
    if (state.filter === 'real') return !h.isTrial;
    if (state.filter === 'trial') return h.isTrial;
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">Chưa có lượt mở lì xì nào trong mục này.</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (item) => `
      <div class="history-item ${item.isTrial ? 'is-trial' : ''}">
        <div class="history-info">
          <span class="history-recipient">${escapeHTML(item.recipient)}</span>
          <div class="history-meta">
            <span>Bao #${item.envelopeIndex || '?'} &bull; ${item.time}</span>
            <span class="${item.isTrial ? 'badge-trial' : 'badge-real'}">
              ${item.isTrial ? 'Quay thử' : item.amount === 0 ? 'Lời chúc' : 'Đã trừ tiền'}
            </span>
            ${item.isPaid ? '<span class="badge-paid">Đã CK</span>' : ''}
          </div>
        </div>
        <div class="history-right">
          <div class="history-amount">${item.amount === 0 ? '🧧 Lời chúc Tết' : '+' + formatVND(item.amount)}</div>
          ${!isGuestMode ? `<div class="history-after">Dư: ${formatSecretVND(item.remainingAfter)}</div>` : ''}
          ${
            !isGuestMode && item.amount > 0
              ? `<div class="history-qr-row">
                  <button type="button" class="btn-qr-mini ${item.isPaid ? 'paid' : ''}" data-qr-id="${item.id}">
                    ${item.isPaid ? '✅ Đã CK / QR' : item.bankAccount ? '🏦 Quét QR (Có STK)' : '🏦 Quét QR'}
                  </button>
                </div>`
              : ''
          }
        </div>
      </div>
    `
    )
    .join('');

  if (!isGuestMode) {
    listEl.querySelectorAll('.btn-qr-mini').forEach((btn) => {
      btn.addEventListener('click', () => {
        openQrModal(btn.dataset.qrId);
      });
    });
  }
}

// VietQR Modal Logic
function buildVietQrUrl(bankCode, accountNo, amount, memo, accountName) {
  const cleanAcc = encodeURIComponent(String(accountNo).trim());
  const params = new URLSearchParams();
  params.set('amount', String(Math.round(amount)));
  if (memo) params.set('addInfo', memo.trim());
  if (accountName) params.set('accountName', accountName.trim());
  return `https://img.vietqr.io/image/${bankCode}-${cleanAcc}-compact2.png?${params.toString()}`;
}

function openQrModal(recordId) {
  const record = state.history.find((h) => String(h.id) === String(recordId));
  if (!record) return;

  activeQrRecordId = record.id;

  const modal = document.getElementById('qr-modal');
  const bankSelect = document.getElementById('qr-bank-select');
  const accInput = document.getElementById('qr-account-input');
  const nameInput = document.getElementById('qr-name-input');
  const memoInput = document.getElementById('qr-memo-input');
  const previewBox = document.getElementById('qr-preview-box');
  const qrImg = document.getElementById('qr-image');
  const markPaidBtn = document.getElementById('mark-paid-btn');

  document.getElementById('qr-recipient-label').textContent = `${record.recipient} (Bao #${record.envelopeIndex || '?'})`;
  document.getElementById('qr-amount-label').textContent = formatVND(record.amount);

  bankSelect.value = record.bankCode || 'VCB';
  accInput.value = record.bankAccount || '';
  nameInput.value = record.bankName || '';
  memoInput.value = record.bankMemo || `Li xi Tet ${record.recipient}`;

  markPaidBtn.textContent = record.isPaid ? '↩ Bỏ đánh dấu đã CK' : '✅ Đánh dấu đã CK';

  if (record.bankAccount) {
    qrImg.src = buildVietQrUrl(
      bankSelect.value,
      record.bankAccount,
      record.amount,
      memoInput.value,
      nameInput.value
    );
    previewBox.hidden = false;
  } else {
    previewBox.hidden = true;
    qrImg.removeAttribute('src');
  }

  modal.hidden = false;
}

// Share Room Modal Logic
function openShareModal() {
  if (!currentPhone) return;
  const baseUrl = window.location.href.split('?')[0].split('#')[0];
  const shareUrl = `${baseUrl}?room=${encodeURIComponent(currentPhone)}`;

  document.getElementById('share-link-input').value = shareUrl;
  document.getElementById('limit-one-spin-cb').checked = Boolean(state.limitOneSpinPerGuest);

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(shareUrl)}`;
  document.getElementById('share-qr-image').src = qrUrl;

  const isLocalFile = window.location.protocol === 'file:';
  document.getElementById('share-local-warning').hidden = !isLocalFile;

  document.getElementById('share-modal').hidden = false;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showResultModal(record, wish) {
  const modal = document.getElementById('result-modal');
  const badge = document.getElementById('modal-badge');
  const recipientEl = document.getElementById('modal-recipient');
  const amountEl = document.getElementById('modal-amount');
  const wishEl = document.getElementById('modal-wish');
  const remainingEl = document.getElementById('modal-remaining');

  if (record.isTrial) {
    badge.textContent = 'LƯỢT QUAY THỬ • KHÔNG TRỪ TIỀN & SỐ LƯỢNG';
    badge.classList.add('trial');
  } else if (record.amount === 0) {
    badge.textContent = 'QUÀ TINH THẦN • CHỈ LỜI CHÚC TẾT (0 ₫)';
    badge.classList.remove('trial');
  } else {
    badge.textContent = isGuestMode ? 'CHÚC MỪNG BẠN ĐÃ NHẬN LỘC!' : 'LỘC ĐẦU XUÂN • ĐÃ TRỪ QUỸ & SỐ LƯỢNG';
    badge.classList.remove('trial');
  }

  recipientEl.textContent = `${record.recipient} (Bao #${record.envelopeIndex})`;
  amountEl.textContent = record.amount === 0 ? '🧧 Lời Chúc Tết!' : formatVND(record.amount);
  wishEl.textContent = `"${wish}"`;

  if (isGuestMode) {
    remainingEl.style.display = 'none';
  } else {
    remainingEl.style.display = '';
    remainingEl.textContent = `Số dư quỹ còn lại: ${formatSecretVND(record.remainingAfter)}`;
  }

  modal.hidden = false;
}

function renderAll() {
  renderSecretLockUI();
  renderBudgetStats();
  renderDenominations();
  renderModeToggle();
  renderEnvelopes();
  renderHistory();
  document.getElementById('allow-remainder-cb').checked = state.allowRemainder;
}

// Simple Confetti Effect
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#ffd700', '#ff3b3b', '#ffae00', '#fff3b0', '#ff6b6b'];
  const particles = Array.from({ length: 90 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200,
    y: canvas.height / 2,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    size: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * 360,
    vr: (Math.random() - 0.5) * 10
  }));

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35;
      p.rotation += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    frame++;
    if (frame < 95) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  animate();
}

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initEnvelopes();

  // Auth by Phone Number
  const authPhoneInput = document.getElementById('auth-phone-input');
  const authNameInput = document.getElementById('auth-name-input');
  const authSubmitBtn = document.getElementById('auth-submit-btn');

  function handleAuthSubmit() {
    loginWithPhone(authPhoneInput.value, authNameInput.value);
  }

  authSubmitBtn.addEventListener('click', handleAuthSubmit);
  authPhoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuthSubmit();
  });
  authNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuthSubmit();
  });

  document.getElementById('share-room-btn').addEventListener('click', openShareModal);

  const shareModal = document.getElementById('share-modal');
  document.getElementById('close-share-modal-btn').addEventListener('click', () => {
    shareModal.hidden = true;
  });
  shareModal.addEventListener('click', (e) => {
    if (e.target.id === 'share-modal') shareModal.hidden = true;
  });

  document.getElementById('limit-one-spin-cb').addEventListener('change', (e) => {
    state.limitOneSpinPerGuest = e.target.checked;
    saveState();
  });

  document.getElementById('copy-share-link-btn').addEventListener('click', () => {
    const link = document.getElementById('share-link-input').value;
    navigator.clipboard?.writeText(link).then(() => {
      alert('Đã copy link phòng lì xì!');
    }).catch(() => {
      document.getElementById('share-link-input').select();
      document.execCommand('copy');
      alert('Đã copy link phòng lì xì!');
    });
  });

  document.getElementById('switch-account-btn').addEventListener('click', () => {
    openAuthModal(false);
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    openAuthModal(true);
  });

  document.getElementById('auth-modal').addEventListener('click', (e) => {
    if (e.target.id === 'auth-modal' && currentPhone) {
      document.getElementById('auth-modal').hidden = true;
    }
  });

  // Secret Password Lock (2027)
  const toggleSecretBtn = document.getElementById('toggle-secret-btn');
  const secretAuthBar = document.getElementById('secret-auth-bar');
  const secretPassInput = document.getElementById('secret-pass-input');
  const secretSubmitBtn = document.getElementById('secret-submit-btn');

  function verifySecretPassword() {
    if (secretPassInput.value.trim() === SECRET_PASS) {
      isUnlocked = true;
      secretPassInput.value = '';
      secretAuthBar.hidden = true;
      renderAll();
    } else {
      alert('Sai mật khẩu!');
      secretPassInput.select();
    }
  }

  toggleSecretBtn.addEventListener('click', () => {
    if (isUnlocked) {
      isUnlocked = false;
      secretAuthBar.hidden = true;
      renderAll();
    } else {
      secretAuthBar.hidden = !secretAuthBar.hidden;
      if (!secretAuthBar.hidden) {
        secretPassInput.value = '';
        secretPassInput.focus();
      }
    }
  });

  secretSubmitBtn.addEventListener('click', verifySecretPassword);
  secretPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifySecretPassword();
  });

  const budgetInput = document.getElementById('budget-input');

  budgetInput.addEventListener('focus', () => {
    if (!isUnlocked && budgetInput.value === '***') {
      budgetInput.value = '';
    }
  });

  budgetInput.addEventListener('input', (e) => {
    if (isUnlocked) {
      const val = parseNumberInput(e.target.value);
      e.target.value = val ? formatNumberInput(val) : '';
    }
  });

  document.getElementById('set-budget-btn').addEventListener('click', () => {
    const val = parseNumberInput(budgetInput.value);
    if (val <= 0) {
      alert('Vui lòng nhập tổng số tiền lớn hơn 0!');
      return;
    }
    state.initialBudget = val;
    state.remainingBudget = val;
    initEnvelopes();
    saveState();
    renderAll();
  });

  document.querySelectorAll('.chip-btn[data-budget]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.budget, 10);
      state.initialBudget = val;
      state.remainingBudget = val;
      initEnvelopes();
      saveState();
      renderAll();
    });
  });

  const customDenomInput = document.getElementById('custom-denom-input');
  const customQtyInput = document.getElementById('custom-qty-input');

  customDenomInput.addEventListener('input', (e) => {
    const val = parseNumberInput(e.target.value);
    e.target.value = val ? formatNumberInput(val) : '';
  });

  document.getElementById('add-denom-btn').addEventListener('click', () => {
    const val = parseNumberInput(customDenomInput.value);
    const qty = Math.max(0, parseInt(customQtyInput.value, 10) || 0);
    if (val <= 0) return;
    if (!state.denominations.includes(val)) {
      state.denominations.push(val);
    }
    if (!state.activeDenominations.includes(val)) {
      state.activeDenominations.push(val);
    }
    setQty(val, qty);
    customDenomInput.value = '';
    saveState();
    renderDenominations();
  });

  document.getElementById('auto-split-btn').addEventListener('click', autoSplitBudgetToQuantities);

  document.getElementById('toggle-all-denom').addEventListener('click', () => {
    if (state.activeDenominations.length === state.denominations.length) {
      state.activeDenominations = [];
    } else {
      state.activeDenominations = [...state.denominations];
    }
    saveState();
    renderDenominations();
  });

  document.getElementById('allow-remainder-cb').addEventListener('change', (e) => {
    state.allowRemainder = e.target.checked;
    saveState();
  });

  document.getElementById('deduct-cb').addEventListener('change', (e) => {
    if (isGuestMode) {
      guestDeductFromTotal = e.target.checked;
      renderModeToggle();
    } else {
      state.deductFromTotal = e.target.checked;
      saveState();
      renderModeToggle();
      renderDenominations();
    }
  });

  document.getElementById('spin-random-btn').addEventListener('click', spinRandomEnvelope);

  document.getElementById('shuffle-btn').addEventListener('click', () => {
    initEnvelopes();
    renderEnvelopes();
  });

  document.getElementById('close-modal-btn').addEventListener('click', () => {
    document.getElementById('result-modal').hidden = true;
  });

  document.getElementById('result-modal').addEventListener('click', (e) => {
    if (e.target.id === 'result-modal') {
      document.getElementById('result-modal').hidden = true;
    }
  });

  // QR Transfer Modal events
  const qrModal = document.getElementById('qr-modal');
  document.getElementById('close-qr-modal-btn').addEventListener('click', () => {
    qrModal.hidden = true;
  });
  qrModal.addEventListener('click', (e) => {
    if (e.target.id === 'qr-modal') {
      qrModal.hidden = true;
    }
  });

  document.getElementById('generate-qr-btn').addEventListener('click', () => {
    const record = state.history.find((h) => String(h.id) === String(activeQrRecordId));
    if (!record) return;

    const bankCode = document.getElementById('qr-bank-select').value;
    const accNo = document.getElementById('qr-account-input').value.trim();
    const accName = document.getElementById('qr-name-input').value.trim();
    const memo = document.getElementById('qr-memo-input').value.trim();

    if (!accNo) {
      alert('Vui lòng nhập số tài khoản người nhận!');
      document.getElementById('qr-account-input').focus();
      return;
    }

    record.bankCode = bankCode;
    record.bankAccount = accNo;
    record.bankName = accName;
    record.bankMemo = memo;
    saveState();

    const qrImg = document.getElementById('qr-image');
    qrImg.src = buildVietQrUrl(bankCode, accNo, record.amount, memo, accName);
    document.getElementById('qr-preview-box').hidden = false;
  });

  document.getElementById('copy-stk-btn').addEventListener('click', () => {
    const accNo = document.getElementById('qr-account-input').value.trim();
    if (!accNo) return;
    navigator.clipboard?.writeText(accNo).then(() => {
      alert(`Đã copy số tài khoản: ${accNo}`);
    }).catch(() => {
      alert(`Số tài khoản: ${accNo}`);
    });
  });

  document.getElementById('mark-paid-btn').addEventListener('click', () => {
    const record = state.history.find((h) => String(h.id) === String(activeQrRecordId));
    if (!record) return;
    record.isPaid = !record.isPaid;
    saveState();
    renderHistory();
    document.getElementById('mark-paid-btn').textContent = record.isPaid
      ? '↩ Bỏ đánh dấu đã CK'
      : '✅ Đánh dấu đã CK';
  });

  // Undo latest history item (host only)
  document.getElementById('undo-btn').addEventListener('click', () => {
    if (isGuestMode || state.history.length === 0) return;
    const latest = state.history.shift();
    if (!latest.isTrial) {
      state.remainingBudget = Math.min(state.initialBudget, state.remainingBudget + latest.amount);
      if (latest.matchedDenom !== null && latest.matchedDenom !== undefined) {
        setQty(latest.matchedDenom, getQty(latest.matchedDenom) + 1);
      }
    }
    if (latest.envelopeIndex && envelopes[latest.envelopeIndex - 1]) {
      envelopes[latest.envelopeIndex - 1].opened = false;
      envelopes[latest.envelopeIndex - 1].amount = null;
    }
    saveState();
    renderAll();
  });

  // Clear history (host only)
  document.getElementById('clear-history-btn').addEventListener('click', () => {
    if (isGuestMode || state.history.length === 0) return;
    if (!confirm('Xoá toàn bộ lịch sử mở lì xì?')) return;
    state.history = [];
    initEnvelopes();
    saveState();
    renderAll();
  });

  // History filter tabs
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.filter = tab.dataset.filter;
      renderHistory();
    });
  });

  // Check URL ?room=<phone> for Guest Mode first
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    enterGuestRoom(roomParam);
    return;
  }

  // Otherwise Host Mode: restore last active phone or prompt login
  const savedActivePhone = localStorage.getItem(ACTIVE_PHONE_KEY);
  if (savedActivePhone && isValidPhone(savedActivePhone)) {
    loginWithPhone(savedActivePhone);
  } else {
    renderAll();
    openAuthModal(true);
  }
});
