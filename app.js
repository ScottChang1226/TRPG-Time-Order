import { initializeApp }         from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteField, onSnapshot,
         collection, query, where, getDocs }
         from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword,
         createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
         signInWithPopup, updateProfile }
         from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { firebaseConfig as FIREBASE_CONFIG } from './firebase-config.js';

const CONFIGURED = FIREBASE_CONFIG.projectId !== "YOUR_PROJECT_ID";
let db = null, auth = null, gProvider = null;
if (CONFIGURED) {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    auth = getAuth(app);
    gProvider = new GoogleAuthProvider();
}

// ── State ──────────────────────────────────────────────────
const S = {
    user: null,
    view: 'loading',
    pollId: null,
    poll: null,
    votes: {},
    slots: [mkSlot()],
    draft: null,
    unsub: null,
    sidebarOpen: true,
    myPolls: [],
    joinedPolls: [],
    pollsLoaded: false,
    authError: '',
    calView: 'month',
    calCursor: null,
    editMode: false,
    voteNameDraft: undefined,
    voteWeekIdx: 0,
    resultsTab: 'overview',
    darkMode: localStorage.getItem('darkMode') === '1',
};

// Apply dark mode on load
if (S.darkMode) document.documentElement.classList.add('dark');

function mkSlot() { return { id: uid(), date: '', start: '', end: '' }; }
function uid()    { return Math.random().toString(36).slice(2, 11); }
function h(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Router ─────────────────────────────────────────────────
window.toggleSidebar = function() {
    S.sidebarOpen = !S.sidebarOpen;
    applyLayout();
};
function applyLayout() {
    const sb  = document.getElementById('sidebar');
    const ov  = document.getElementById('overlay');
    if (!sb) return;
    const mobile = window.innerWidth <= 680;
    if (mobile) {
        sb.classList.toggle('collapsed', !S.sidebarOpen);
        ov && (ov.style.display = S.sidebarOpen ? 'block' : 'none');
    } else {
        sb.classList.toggle('collapsed', !S.sidebarOpen);
        ov && (ov.style.display = 'none');
    }
    const toggleBtn = document.getElementById('sb-toggle-btn');
    if (toggleBtn) toggleBtn.textContent = S.sidebarOpen ? '◀' : '▶';
}

function go(view, extra = {}) {
    if (S.unsub) { S.unsub(); S.unsub = null; }
    Object.assign(S, extra);
    S.view = view;
    paint();
}

// ── Auth guard ─────────────────────────────────────────────
function init() {
    const root = document.getElementById('root');
    root.innerHTML = '<div class="loading">載入中…<span class="spin"></span></div>';
    if (!CONFIGURED) { go('config'); return; }
    onAuthStateChanged(auth, user => {
        S.user = user;
        if (!user) { go('auth-login'); return; }
        if (!S.pollsLoaded) loadMyPolls();
        const p = new URLSearchParams(location.search).get('poll');
        if (p) { S.pollId = p.toUpperCase(); go('poll-loading'); }
        else if (S.view === 'loading' || S.view === 'auth-login' || S.view === 'auth-register') {
            go('dashboard');
        } else paint();
    });
}

// ── Load user's polls ──────────────────────────────────────
async function loadMyPolls() {
    S.pollsLoaded = true;
    try {
        const [cSnap, jSnap] = await Promise.all([
            getDocs(query(collection(db,'polls'), where('creatorUid','==', S.user.uid))),
            getDocs(query(collection(db,'userPolls'), where('uid','==', S.user.uid)))
        ]);
        S.myPolls = cSnap.docs.map(d => d.data());
        const joinedIds = jSnap.docs.map(d => d.data().pollId)
            .filter(id => !S.myPolls.find(p => p.id === id));
        if (joinedIds.length) {
            const fetches = await Promise.all(joinedIds.map(id => getDoc(doc(db,'polls',id))));
            S.joinedPolls = fetches.filter(d => d.exists()).map(d => d.data());
        } else S.joinedPolls = [];
        if (S.view === 'dashboard' || S.view === 'my-polls' || S.view === 'joined-polls') paint();
    } catch(e) { console.error(e); }
}

// ── Dark mode toggle ───────────────────────────────────────
window.toggleDarkMode = function() {
    S.darkMode = !S.darkMode;
    document.documentElement.classList.toggle('dark', S.darkMode);
    localStorage.setItem('darkMode', S.darkMode ? '1' : '0');
    // update toggle UI without full repaint
    const track = document.querySelector('.toggle-track');
    if (track) track.parentElement.outerHTML; // just repaint sidebar bottom
    paint();
};

// ═══════════════════════════════════════════════════════════
//  PAINT
// ═══════════════════════════════════════════════════════════
function paint() {
    const root = document.getElementById('root');
    if (!S.user || S.view === 'auth-login' || S.view === 'auth-register' || S.view === 'config') {
        root.innerHTML = noAuthPage();
        attachAuthHandlers();
        return;
    }
    root.innerHTML = shellHTML();
    applyLayout();
    attachShellHandlers();
    const content = document.getElementById('content');
    switch (S.view) {
        case 'dashboard':    content.innerHTML = vDashboard();   break;
        case 'my-polls':     content.innerHTML = vPollList('my'); break;
        case 'joined-polls': content.innerHTML = vPollList('joined'); break;
        case 'create':       content.innerHTML = vCreate();      break;
        case 'created':      content.innerHTML = vCreated();     break;
        case 'poll-loading': loadPoll(); break;
        case 'vote':         content.innerHTML = vVote();        break;
        case 'live':         content.innerHTML = vResults();     break;
        case 'edit-poll':    content.innerHTML = vEditPoll();    break;
        default: content.innerHTML = vDashboard();
    }
    setTopbarTitle();
}

function setTopbarTitle() {
    const el = document.getElementById('topbar-title');
    if (!el) return;
    const map = {
        dashboard: '首頁', 'my-polls': '我建立的活動',
        'joined-polls': '我參加過的活動', create: '建立新活動',
        created: '建立成功', vote: S.poll?.title || '填寫時間',
        live: (S.poll?.title || '活動結果') + ' — 結果',
        'edit-poll': '編輯活動',
        'poll-loading': '載入中…',
    };
    el.textContent = map[S.view] || '';
}

// ═══════════════════════════════════════════════════════════
//  SHELL (Sidebar + Topbar)
// ═══════════════════════════════════════════════════════════
function shellHTML() {
    const u = S.user;
    const avatarEl = u.photoURL
        ? `<div class="sb-avatar"><img src="${h(u.photoURL)}" referrerpolicy="no-referrer"></div>`
        : `<div class="sb-avatar">${h((u.displayName||u.email||'?')[0].toUpperCase())}</div>`;

    const navItem = (view, icon, label) => {
        const active = S.view === view ? ' active' : '';
        return `<button class="sb-item${active}" onclick="go('${view}')">
            <span class="sb-icon">${icon}</span>
            <span class="sb-label">${label}</span>
        </button>`;
    };

    const darkIcon = S.darkMode ? '☀️' : '🌙';
    const darkLabel = S.darkMode ? '切換亮色模式' : '切換深色模式';

    return `<div id="layout">
      <nav id="sidebar">
        <button class="sb-toggle" id="sb-toggle-btn" onclick="toggleSidebar()">◀</button>
        <div id="sidebar-logo">
            <span class="logo-icon">📅</span>
            <span>時間協調工具</span>
        </div>
        <div class="sb-section-title">功能</div>
        ${navItem('dashboard','🏠','首頁')}
        ${navItem('create','✨','建立新活動')}
        <div class="sb-section-title">我的活動</div>
        ${navItem('my-polls','📋','我建立的活動')}
        ${navItem('joined-polls','👥','我參加過的活動')}
        <div class="sb-spacer"></div>
        <div class="sb-bottom">
            <button class="dark-toggle" onclick="toggleDarkMode()">
                <span class="sb-icon">${darkIcon}</span>
                <span class="sb-label">${darkLabel}</span>
                <div class="toggle-track"><div class="toggle-thumb"></div></div>
            </button>
            <div class="sb-user">
                ${avatarEl}
                <div class="sb-user-info">
                    <div class="sb-user-name">${h(u.displayName || '未設定名稱')}</div>
                    <div class="sb-user-email">${h(u.email || '')}</div>
                </div>
            </div>
        </div>
      </nav>
      <div id="main">
        <div id="topbar">
          <button class="btn btn-secondary btn-sm" style="display:none;padding:6px 10px" id="topbar-menu-btn" onclick="toggleSidebar()">☰</button>
          <h1 id="topbar-title"></h1>
          <button class="btn btn-secondary btn-sm" onclick="doSignOut()">登出</button>
        </div>
        <div id="content"></div>
      </div>
    </div>`;
}

function attachShellHandlers() {
    const menuBtn = document.getElementById('topbar-menu-btn');
    if (menuBtn && window.innerWidth <= 680) menuBtn.style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════
//  NO-AUTH PAGES
// ═══════════════════════════════════════════════════════════
function noAuthPage() {
    if (!CONFIGURED) return `<div id="auth-wrap"><div class="auth-card">
        <div class="config-warn" style="margin-bottom:0">
            <strong>⚠️ 尚未設定 Firebase</strong>
            請複製 <code>firebase-config.example.js</code> 為 <code>firebase-config.js</code>，填入您的 Firebase 專案設定後儲存重整。<br>
            詳細步驟請參閱 <code>README.md</code>。
        </div>
    </div></div>`;

    if (S.view === 'auth-register') return `<div id="auth-wrap"><div class="auth-card">
        <h2>📅 建立帳號</h2>
        <p class="sub">歡迎加入時間協調工具</p>
        ${S.authError ? `<div class="alert alert-error">${h(S.authError)}</div>` : ''}
        <div class="form-group"><label>顯示名稱</label>
            <input class="fc" id="a-name" type="text" placeholder="您的姓名" maxlength="40" /></div>
        <div class="form-group"><label>Email</label>
            <input class="fc" id="a-email" type="email" placeholder="you@example.com" /></div>
        <div class="form-group"><label>密碼（至少 6 個字元）</label>
            <input class="fc" id="a-pass" type="password" placeholder="••••••" /></div>
        <button class="btn btn-primary btn-lg btn-block" id="register-btn">建立帳號</button>
        <div class="or-divider">或</div>
        <button class="btn btn-google btn-block" id="google-btn">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.2 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6C43.6 37 46.5 31.2 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.4-5.7l-7.2-5.6c-2 1.4-4.7 2.2-8.2 2.2-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
            使用 Google 帳號登入
        </button>
        <div class="divider"></div>
        <p style="text-align:center;font-size:13px;color:var(--text-m)">
            已有帳號？<a href="#" id="to-login">登入</a>
        </p>
    </div></div>`;

    return `<div id="auth-wrap"><div class="auth-card">
        <h2>📅 時間協調工具</h2>
        <p class="sub">登入以管理您的活動</p>
        ${S.authError ? `<div class="alert alert-error">${h(S.authError)}</div>` : ''}
        <div class="form-group"><label>Email</label>
            <input class="fc" id="a-email" type="email" placeholder="you@example.com" /></div>
        <div class="form-group"><label>密碼</label>
            <input class="fc" id="a-pass" type="password" placeholder="••••••"
                onkeydown="if(event.key==='Enter')document.getElementById('login-btn').click()" /></div>
        <button class="btn btn-primary btn-lg btn-block" id="login-btn">登入</button>
        <div class="or-divider">或</div>
        <button class="btn btn-google btn-block" id="google-btn">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.2 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6C43.6 37 46.5 31.2 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.4-5.7l-7.2-5.6c-2 1.4-4.7 2.2-8.2 2.2-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
            使用 Google 帳號登入
        </button>
        <div class="divider"></div>
        <p style="text-align:center;font-size:13px;color:var(--text-m)">
            還沒有帳號？<a href="#" id="to-register">建立帳號</a>
        </p>
    </div></div>`;
}

function attachAuthHandlers() {
    document.getElementById('login-btn')?.addEventListener('click', doLogin);
    document.getElementById('register-btn')?.addEventListener('click', doRegister);
    document.getElementById('google-btn')?.addEventListener('click', doGoogleLogin);
    document.getElementById('to-register')?.addEventListener('click', e => { e.preventDefault(); S.authError=''; go('auth-register'); });
    document.getElementById('to-login')?.addEventListener('click', e => { e.preventDefault(); S.authError=''; go('auth-login'); });
}

async function doLogin() {
    const email = document.getElementById('a-email').value.trim();
    const pass  = document.getElementById('a-pass').value;
    if (!email || !pass) { S.authError='請填寫 Email 和密碼'; go('auth-login'); return; }
    try { await signInWithEmailAndPassword(auth, email, pass); S.authError=''; }
    catch(e) { S.authError = authErrMsg(e.code); go('auth-login'); }
}
async function doRegister() {
    const name  = document.getElementById('a-name')?.value.trim() || '';
    const email = document.getElementById('a-email').value.trim();
    const pass  = document.getElementById('a-pass').value;
    if (!email || !pass) { S.authError='請填寫 Email 和密碼'; go('auth-register'); return; }
    if (pass.length < 6)  { S.authError='密碼至少需要 6 個字元'; go('auth-register'); return; }
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        if (name) await updateProfile(cred.user, { displayName: name });
        S.authError='';
    } catch(e) { S.authError = authErrMsg(e.code); go('auth-register'); }
}
async function doGoogleLogin() {
    try { await signInWithPopup(auth, gProvider); S.authError=''; }
    catch(e) { S.authError = authErrMsg(e.code); paint(); }
}
async function doSignOut() {
    S.pollsLoaded = false; S.myPolls = []; S.joinedPolls = [];
    await signOut(auth);
}
function authErrMsg(code) {
    const map = {
        'auth/user-not-found':'找不到此帳號',
        'auth/wrong-password':'密碼錯誤',
        'auth/invalid-email':'Email 格式不正確',
        'auth/email-already-in-use':'此 Email 已被使用',
        'auth/too-many-requests':'嘗試次數過多，請稍後再試',
        'auth/popup-closed-by-user':'登入視窗已關閉',
        'auth/invalid-credential':'帳號或密碼錯誤',
    };
    return map[code] || `登入失敗（${code}）`;
}

// ═══════════════════════════════════════════════════════════
//  VIEW: DASHBOARD
// ═══════════════════════════════════════════════════════════
function vDashboard() {
    const name = S.user.displayName || S.user.email?.split('@')[0] || '使用者';
    const recent = [...S.myPolls, ...S.joinedPolls]
        .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0, 5);
    const recentHtml = recent.length ? recent.map(p => actCard(p, S.myPolls.find(x=>x.id===p.id)?'created':'joined')).join('')
        : `<div class="empty-state"><span class="emoji">📭</span>還沒有任何活動</div>`;
    return `<div class="card">
        <div class="card-title">👋 嗨，${h(name)}！</div>
        <div class="card-sub">歡迎回來</div>
        <div class="btn-group">
            <button class="btn btn-primary btn-lg" onclick="go('create')">✨ 建立新活動</button>
            <button class="btn btn-outline btn-lg" onclick="showJoinDialog()">🔗 加入活動</button>
        </div>
    </div>
    <div class="card">
        <div class="card-title" style="margin-bottom:14px">📌 最近活動</div>
        <div class="activity-list">${recentHtml}</div>
    </div>`;
}

window.showJoinDialog = function() {
    const code = prompt('請輸入活動代碼：')?.trim().toUpperCase();
    if (!code) return;
    S.pollId = code; go('poll-loading');
};

// ═══════════════════════════════════════════════════════════
//  VIEW: POLL LISTS
// ═══════════════════════════════════════════════════════════
function vPollList(type) {
    const polls = type === 'my' ? S.myPolls : S.joinedPolls;
    const title = type === 'my' ? '📋 我建立的活動' : '👥 我參加過的活動';
    const empty = type === 'my' ? '還沒有建立任何活動' : '還沒有參加過任何活動';
    const badgeType = type === 'my' ? 'created' : 'joined';
    const html = polls.length
        ? polls.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(p=>actCard(p,badgeType)).join('')
        : `<div class="empty-state"><span class="emoji">📭</span>${empty}</div>`;
    const refreshBtn = `<button class="btn btn-secondary btn-sm" onclick="refreshPolls()">🔄 重新整理</button>`;
    return `<div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div class="card-title" style="margin-bottom:0">${title}</div>
            ${refreshBtn}
        </div>
        <div class="activity-list">${html}</div>
    </div>`;
}

window.refreshPolls = async function() {
    S.pollsLoaded = false;
    await loadMyPolls();
};

function actCard(p, type) {
    const isDeleted = !!p.deleted;
    let badge;
    if (isDeleted) badge = `<span class="act-badge badge-deleted">已刪除</span>`;
    else if (type==='created') badge = `<span class="act-badge badge-created">我建立的</span>`;
    else badge = `<span class="act-badge badge-joined">我參加的</span>`;

    const slots = (p.slots||[]).length;
    const resp  = Object.keys(p.responses||{}).length;
    const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString('zh-TW') : '';
    return `<div class="act-card${isDeleted?' act-deleted':''}" onclick="openPoll('${h(p.id)}')">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
            <h3>${h(p.title)}${isDeleted?' <span style="text-decoration:line-through;opacity:.5">(已刪除)</span>':''}</h3>${badge}
        </div>
        <div class="meta">${slots} 個時間段・${resp} 人已填寫${dateStr ? '・'+dateStr : ''}</div>
        ${p.desc ? `<div class="meta" style="margin-top:2px">${h(p.desc.slice(0,60))}${p.desc.length>60?'…':''}</div>` : ''}
    </div>`;
}

window.openPoll = function(id) { S.pollId = id; go('poll-loading'); };

// ═══════════════════════════════════════════════════════════
//  VIEW: CREATE (with batch slot feature)
// ═══════════════════════════════════════════════════════════
function vCreate() {
    const today = new Date().toISOString().slice(0,10);
    const settings = S.draft?.settings || {};
    const noThresh = settings.noThreshold || 1;
    const maybeAsNo = settings.maybeAsNo || false;
    const slotsHtml = S.slots.map(s => `
        <div class="slot-row">
            <input class="fc" type="date" min="${today}" value="${h(s.date)}"
                onchange="slotSet('${s.id}','date',this.value)" />
            <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                placeholder="開始 HH:MM" value="${h(s.start)}"
                oninput="fmtTimeInput(this)"
                onchange="slotSet('${s.id}','start',this.value)" />
            <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                placeholder="結束 HH:MM" value="${h(s.end)}"
                oninput="fmtTimeInput(this)"
                onchange="slotSet('${s.id}','end',this.value)" />
            <button class="btn btn-secondary btn-sm remove-btn" onclick="slotRemove('${s.id}')"
                ${S.slots.length===1?'disabled':''}>✕</button>
        </div>`).join('');

    return `<div class="card">
        <div class="card-title">✨ 建立新活動</div>
        <div class="card-sub">填好後將連結傳給參與者</div>
        <div class="form-group"><label>活動名稱 *</label>
            <input class="fc" id="f-title" type="text" maxlength="100"
                placeholder="例：Q2 專案啟動會議" value="${h(S.draft?.title||'')}" /></div>
        <div class="form-group"><label>描述（可選）</label>
            <textarea class="fc" id="f-desc" rows="2" maxlength="400"
                placeholder="會議目的、地點…">${h(S.draft?.desc||'')}</textarea></div>
        <div class="form-group">
            <label>候選時間段（至少 1 個）</label>
            <p style="font-size:12px;color:var(--text-m);margin-bottom:9px">日期 ｜ 開始時間 ｜ 結束時間（可留空）</p>
            <div id="slots-wrap">${slotsHtml}</div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="slotAdd()">＋ 新增時間段</button>
                <button class="btn btn-outline btn-sm" onclick="toggleBatchPanel()">📅 批次套用日期範圍</button>
            </div>
        </div>
        <div class="batch-panel" id="batch-panel" style="display:none">
            <p style="font-weight:600;font-size:13px;margin-bottom:10px">📅 批次新增時間段</p>
            <p style="font-size:12px;color:var(--text-m);margin-bottom:10px">依照下方設定，對日期範圍內每天新增一個時間段</p>
            <div class="date-range-row">
                <div style="flex:1;min-width:130px">
                    <label>開始日期</label>
                    <input class="fc" type="date" id="batch-start-date" min="${today}" />
                </div>
                <div style="align-self:flex-end;padding-bottom:10px;color:var(--text-m)">～</div>
                <div style="flex:1;min-width:130px">
                    <label>結束日期</label>
                    <input class="fc" type="date" id="batch-end-date" min="${today}" />
                </div>
            </div>
            <div class="date-range-row" style="margin-top:8px">
                <div style="flex:1;min-width:130px">
                    <label>開始時間</label>
                    <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                        placeholder="HH:MM" id="batch-start-time" oninput="fmtTimeInput(this)" />
                </div>
                <div style="align-self:flex-end;padding-bottom:10px;color:var(--text-m)">～</div>
                <div style="flex:1;min-width:130px">
                    <label>結束時間（可留空）</label>
                    <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                        placeholder="HH:MM" id="batch-end-time" oninput="fmtTimeInput(this)" />
                </div>
            </div>
            <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="slotBatchAdd()">套用</button>
        </div>
        <div class="form-group" style="margin-top:16px">
            <label>🎨 顏色判定設定（選用）</label>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
                <span style="font-size:13px;color:var(--text-m)">幾人「不行」才顯示紅色：</span>
                <div class="btn-group">
                    ${[1,2,3,4].map(v=>`<button class="btn btn-sm no-thresh-btn ${noThresh===v?'btn-primary':'btn-secondary'}" data-val="${v}" onclick="setNoThresh(${v})">${v}人</button>`).join('')}
                </div>
            </div>
            <label class="checkbox-label">
                <input type="checkbox" id="f-maybe-as-no" ${maybeAsNo?'checked':''}> 將「大概可以」視為「不行」計算
            </label>
            <p style="font-size:11px;color:var(--text-m);margin-top:6px">此設定影響結果頁的顏色顯示，不影響填寫。</p>
        </div>
        <button class="btn btn-primary btn-lg btn-block" style="margin-top:16px" onclick="doSubmitCreate()">建立活動 →</button>
    </div>`;
}

window.toggleBatchPanel = function() {
    syncSlotsFromDom();
    const p = document.getElementById('batch-panel');
    if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
};

window.slotBatchAdd = function() {
    const startDate = document.getElementById('batch-start-date')?.value;
    const endDate   = document.getElementById('batch-end-date')?.value;
    const startTime = document.getElementById('batch-start-time')?.value || '';
    const endTime   = document.getElementById('batch-end-time')?.value || '';
    if (!startDate || !endDate) { alert('請選擇開始和結束日期'); return; }
    if (startDate > endDate) { alert('結束日期不能早於開始日期'); return; }
    syncSlotsFromDom();
    const d = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const added = [];
    while (d <= end) {
        const iso = d.toISOString().slice(0,10);
        if (!S.slots.find(s => s.date === iso && s.start === startTime)) {
            added.push({ id: uid(), date: iso, start: startTime, end: endTime });
        }
        d.setDate(d.getDate() + 1);
    }
    if (!added.length) { alert('所選範圍內的時間段已全部存在'); return; }
    S.slots.push(...added);
    go(S.editMode ? 'edit-poll' : 'create');
};

window.slotSet = function(id, field, val) { const s=S.slots.find(x=>x.id===id); if(s) s[field]=val; };
window.slotAdd = function() { syncSlotsFromDom(); S.slots.push(mkSlot()); go(S.editMode ? 'edit-poll' : 'create'); };
window.slotRemove = function(id) { if(S.slots.length===1) return; syncSlotsFromDom(); S.slots=S.slots.filter(x=>x.id!==id); go(S.editMode ? 'edit-poll' : 'create'); };

// Auto-format time text input: inserts colon after 2 digits (e.g. "20" → "20:")
window.fmtTimeInput = function(el) {
    let v = el.value.replace(/\D/g, '');
    if (v.length > 4) v = v.slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
    el.value = v;
};

window.setNoThresh = function(val) {
    document.querySelectorAll('.no-thresh-btn').forEach(b => {
        b.className = 'btn btn-sm no-thresh-btn ' + (parseInt(b.dataset.val) === val ? 'btn-primary' : 'btn-secondary');
    });
};

function syncSlotsFromDom() {
    S.slots.forEach(s => {
        const de=document.querySelector(`input[onchange*="${s.id},'date'"]`);
        const se=document.querySelector(`input[onchange*="${s.id},'start'"]`);
        const ee=document.querySelector(`input[onchange*="${s.id},'end'"]`);
        if(de) s.date=de.value; if(se) s.start=se.value; if(ee) s.end=ee.value;
    });
    const activeThresh = document.querySelector('.no-thresh-btn.btn-primary');
    S.draft = {
        title: document.getElementById('f-title')?.value||'',
        desc:  document.getElementById('f-desc')?.value||'',
        settings: {
            noThreshold: activeThresh ? parseInt(activeThresh.dataset.val) : (S.draft?.settings?.noThreshold||1),
            maybeAsNo: document.getElementById('f-maybe-as-no')?.checked ?? (S.draft?.settings?.maybeAsNo||false),
        },
    };
}

async function doSubmitCreate() {
    syncSlotsFromDom();
    const title = (document.getElementById('f-title')?.value||S.draft?.title||'').trim();
    const desc  = (document.getElementById('f-desc')?.value||S.draft?.desc||'').trim();
    if (!title) { alert('請輸入活動名稱'); return; }
    const valid = S.slots.filter(s=>s.date&&s.start);
    if (!valid.length) { alert('請至少填寫一個有日期＋開始時間的時間段'); return; }

    const noThreshold = parseInt(document.querySelector('.no-thresh-btn.btn-primary')?.dataset?.val||'1');
    const maybeAsNo = document.getElementById('f-maybe-as-no')?.checked||false;
    const pollId = uid().toUpperCase().slice(0,8);
    const poll = {
        id: pollId, title, desc,
        creator: S.user.displayName || S.user.email,
        creatorUid: S.user.uid,
        createdAt: new Date().toISOString(),
        slots: valid.map(s=>({id:s.id,date:s.date,start:s.start,end:s.end,label:fmtSlot(s)})),
        settings: { noThreshold, maybeAsNo },
        responses: {}
    };
    try {
        await setDoc(doc(db,'polls',pollId), poll);
        S.poll = poll; S.pollId = pollId;
        S.slots = [mkSlot()]; S.draft = null;
        S.myPolls.unshift(poll);
        go('created');
    } catch(e) { alert('建立失敗：'+e.message); }
}

// ═══════════════════════════════════════════════════════════
//  VIEW: CREATED
// ═══════════════════════════════════════════════════════════
function vCreated() {
    const url = shareUrl();
    return `<div class="card" style="text-align:center;padding:36px">
        <div style="font-size:56px">🎉</div>
        <h2 style="margin-top:12px;font-size:22px;font-weight:700">活動建立成功！</h2>
        <p style="color:var(--text-m);margin-top:4px">${h(S.poll.title)}</p>
        <div class="alert alert-info" style="margin-top:18px;text-align:left">
            活動代碼：<strong style="font-size:20px;letter-spacing:3px;font-family:monospace">${S.pollId}</strong>
        </div>
        <div class="form-group" style="text-align:left">
            <label>分享連結</label>
            <div class="copy-row">
                <input class="copy-input" id="share-url-el" type="text" value="${h(url)}" readonly />
                <button class="btn btn-secondary btn-sm" onclick="doCopy('share-url-el',this)">複製</button>
            </div>
        </div>
        <div class="btn-group" style="justify-content:center">
            <button class="btn btn-primary btn-lg" onclick="S.pollId='${S.pollId}'; go('poll-loading')">我先填寫時間 →</button>
            <button class="btn btn-secondary" onclick="go('dashboard')">返回首頁</button>
        </div>
    </div>`;
}

function shareUrl() {
    return location.origin + location.pathname + '?poll=' + (S.pollId||'');
}
window.doCopy = function(elId, btn) {
    const el = document.getElementById(elId); el.select(); document.execCommand('copy');
    const o = btn.textContent; btn.textContent='已複製！'; setTimeout(()=>btn.textContent=o,2000);
};

// ═══════════════════════════════════════════════════════════
//  FIREBASE: LOAD POLL
// ═══════════════════════════════════════════════════════════
async function loadPoll() {
    const content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="loading">載入活動資訊…<span class="spin"></span></div>';
    try {
        const snap = await getDoc(doc(db,'polls',S.pollId));
        if (!snap.exists()) { errInContent(`找不到代碼「${S.pollId}」的活動`); return; }
        S.poll = snap.data();
        S.votes = { ...(S.poll.responses?.[S.user.uid] || {}) };
        S.voteNameDraft = undefined;
        S.voteWeekIdx = 0;
        S.resultsTab = 'overview';
        history.replaceState({}, '', location.pathname);
        go('vote');
    } catch(e) { errInContent(e.message); }
}

function errInContent(msg) {
    const c = document.getElementById('content');
    if (c) c.innerHTML = `<div class="card" style="text-align:center;padding:48px">
        <span style="font-size:48px">😕</span>
        <h2 style="margin-top:12px">載入失敗</h2>
        <p style="color:var(--text-m);margin-top:8px">${h(msg)}</p>
        <button class="btn btn-primary" style="margin-top:18px" onclick="go('dashboard')">返回首頁</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  VIEW: VOTE
// ═══════════════════════════════════════════════════════════
function vVote() {
    const poll = S.poll;

    // Deleted poll banner in vote view
    if (poll.deleted) {
        const delTime = new Date(poll.deletedAt);
        const expireTime = new Date(delTime.getTime() + 168*60*60*1000);
        const expStr = expireTime.toLocaleString('zh-TW');
        return `<div class="card">
            <button class="nav-back" onclick="go('dashboard')">← 返回首頁</button>
            <div class="alert alert-error" style="margin-bottom:16px">
                <strong>⚠️ 此活動已被刪除</strong><br>
                「${h(poll.title)}」已由「${h(poll.deletedBy||poll.creator)}」於 ${new Date(poll.deletedAt).toLocaleString('zh-TW')} 刪除。<br>
                如有需要，請於 <strong>${expStr}</strong> 前下載檔案記錄。
            </div>
            <div class="btn-group">
                <button class="btn btn-secondary btn-sm" onclick="S.pollId='${poll.id}'; go('live-init')">查看結果並下載</button>
                <button class="btn btn-outline btn-sm" onclick="go('dashboard')">返回首頁</button>
            </div>
        </div>`;
    }

    const count = Object.keys(poll.responses||{}).length;
    const isCreator = poll.creatorUid === S.user.uid;
    const url = shareUrl();

    // Week grouping
    const weeks = getVoteWeeks(poll.slots);
    const hasWeeks = weeks.length > 1;
    const wIdx = Math.min(S.voteWeekIdx||0, Math.max(0, weeks.length-1));
    const visSlots = hasWeeks
        ? poll.slots.filter(s => s.date >= weeks[wIdx].start && s.date <= weeks[wIdx].end)
        : poll.slots;

    const slotsHtml = visSlots.map(slot => {
        const v = S.votes[slot.id]||'';
        return `<div class="slot-card">
            <div class="slot-card-title">🗓 ${h(fmtSlot(slot))}</div>
            <div class="avail-sel" data-slotid="${slot.id}">
                <button class="avail-btn${v==='yes'   ?' sel-yes':''}"   onclick="castVote('${slot.id}','yes')">✅ 可以</button>
                <button class="avail-btn${v==='maybe' ?' sel-maybe':''}" onclick="castVote('${slot.id}','maybe')">🟡 大概可以</button>
                <button class="avail-btn${v==='no'    ?' sel-no':''}"    onclick="castVote('${slot.id}','no')">❌ 不行</button>
            </div>
        </div>`;
    }).join('');

    const bm = S.bulkMode||'rest';
    const bulkPanel = `<div class="bulk-panel">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:600;color:var(--text)">快速填入：</span>
            <button class="btn btn-sm" style="background:var(--success-l);color:#15803d;border:1px solid #86efac" onclick="bulkVote('yes')">✅ 一律可以</button>
            <button class="btn btn-sm" style="background:var(--warning-l);color:#92400e;border:1px solid #fde68a" onclick="bulkVote('maybe')">🟡 一律大概可以</button>
            <button class="btn btn-sm" style="background:var(--danger-l);color:#991b1b;border:1px solid #fca5a5" onclick="bulkVote('no')">❌ 一律不行</button>
            <button class="btn btn-secondary btn-sm" onclick="bulkVote(null)">🗑️ 全部清空</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--text-m)">套用至：</span>
            <button class="btn btn-sm bulk-mode-btn ${bm==='rest'?'btn-primary':'btn-secondary'}" data-mode="rest" onclick="setBulkMode('rest')">填入剩下時段</button>
            <button class="btn btn-sm bulk-mode-btn ${bm==='all'?'btn-primary':'btn-secondary'}" data-mode="all" onclick="setBulkMode('all')">全部修改</button>
        </div>
    </div>`;

    const displayName = S.voteNameDraft !== undefined ? S.voteNameDraft : (S.user.displayName || S.user.email || '');
    const weekNav = hasWeeks ? `<div class="vote-week-nav">
        <button class="btn btn-secondary btn-sm" onclick="setVoteWeek(${wIdx-1})" ${wIdx>0?'':'disabled'}>&#9664;</button>
        <select class="vote-week-select" onchange="setVoteWeek(parseInt(this.value))">
            ${weeks.map((w,i)=>`<option value="${i}" ${i===wIdx?'selected':''}>${h(w.label)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="setVoteWeek(${wIdx+1})" ${wIdx<weeks.length-1?'':'disabled'}>&#9654;</button>
        <span style="font-size:12px;color:var(--text-m)">${visSlots.length} 個時段</span>
    </div>` : '';

    const topBar = `<div class="vote-action-bar">
        <div class="vote-action-row">
            <button class="btn btn-outline btn-sm" onclick="S.pollId='${poll.id}'; go('live-init')">📊 查看結果</button>
            ${isCreator ? `
            <button class="btn btn-outline btn-sm" onclick="startEditPoll()">✏️ 編輯活動</button>
            <button class="btn btn-danger btn-sm" onclick="doDeletePoll()">🗑️ 刪除活動</button>` :
            `<button class="btn btn-secondary btn-sm" onclick="doLeavePoll()">🚪 離開活動</button>`}
        </div>
        <div class="copy-row" style="margin-top:8px">
            <span class="vote-code-lbl">代碼：<code>${h(S.pollId)}</code></span>
            <input class="copy-input" id="vote-share-url" type="text" value="${h(url)}" readonly style="flex:1;min-width:100px"/>
            <button class="btn btn-secondary btn-sm" onclick="doCopy('vote-share-url',this)">複製連結</button>
        </div>
    </div>`;

    return `<div class="card">
        <button class="nav-back" onclick="go('dashboard')">← 返回首頁</button>
        <div class="card-title">${h(poll.title)}</div>
        ${poll.desc ? `<p style="color:var(--text-m);font-size:14px;margin-bottom:8px">${h(poll.desc)}</p>` : ''}
        <p style="font-size:13px;color:var(--text-m);margin-bottom:10px">由 ${h(poll.creator)} 建立・${count} 人已填寫</p>
        ${topBar}
        <div class="form-group" style="margin-top:14px">
            <label>填寫者</label>
            <input class="fc" id="voter-name" type="text" value="${h(displayName)}"
                maxlength="40" placeholder="您的顯示名稱（可修改）"
                oninput="S.voteNameDraft=this.value" />
        </div>
        <div class="form-group">
            <label>請選擇您的可用時間</label>
            ${bulkPanel}
            ${weekNav}
            <div class="vote-slot-scroll">${slotsHtml}</div>
        </div>
        <button class="btn btn-success btn-lg btn-block" onclick="doSubmitVote()" style="margin-top:4px">提交 ✓</button>
    </div>`;
}

window.castVote = function(slotId, val) {
    S.votes[slotId] = S.votes[slotId]===val ? undefined : val;
    if (S.votes[slotId]===undefined) delete S.votes[slotId];
    document.querySelectorAll(`.avail-sel[data-slotid="${slotId}"] .avail-btn`).forEach((btn,i)=>{
        const keys=['yes','maybe','no'];
        btn.className='avail-btn'+(S.votes[slotId]===keys[i] ? ` sel-${keys[i]}` : '');
    });
};

window.bulkVote = function(val) {
    const mode = S.bulkMode || 'rest';
    (S.poll?.slots || []).forEach(slot => {
        if (val === null) {
            delete S.votes[slot.id];
            document.querySelectorAll(`.avail-sel[data-slotid="${slot.id}"] .avail-btn`).forEach(btn => {
                btn.className = 'avail-btn';
            });
            return;
        }
        if (mode === 'rest' && S.votes[slot.id]) return;
        S.votes[slot.id] = val;
        document.querySelectorAll(`.avail-sel[data-slotid="${slot.id}"] .avail-btn`).forEach((btn,i)=>{
            const keys=['yes','maybe','no'];
            btn.className='avail-btn'+(keys[i]===val?` sel-${val}`:'');
        });
    });
};

window.setBulkMode = function(mode) {
    S.bulkMode = mode;
    document.querySelectorAll('.bulk-mode-btn').forEach(b=>{
        b.className='btn btn-sm bulk-mode-btn '+(b.dataset.mode===mode?'btn-primary':'btn-secondary');
    });
};

function getVoteWeeks(slots) {
    const seen = new Set();
    const weeks = [];
    slots.forEach(s => {
        if (!s.date) return;
        const d = new Date(s.date + 'T00:00:00');
        const dow = d.getDay();
        const ws = new Date(d); ws.setDate(d.getDate() - dow);
        const key = localISO(ws);
        if (!seen.has(key)) {
            seen.add(key);
            const we = new Date(ws); we.setDate(ws.getDate() + 6);
            const mo = ws.getMonth() + 1;
            const wNum = Math.ceil(ws.getDate() / 7);
            const ordinals = ['一','二','三','四','五'];
            const lbl = `${mo}月 / 第${ordinals[wNum-1]||(wNum)}週 (${mo}/${ws.getDate()}～${we.getMonth()+1}/${we.getDate()})`;
            weeks.push({ key, label: lbl, start: key, end: localISO(we) });
        }
    });
    return weeks.sort((a,b) => a.key.localeCompare(b.key));
}
window.setVoteWeek = function(idx) {
    const nameEl = document.getElementById('voter-name');
    if (nameEl) S.voteNameDraft = nameEl.value;
    S.voteWeekIdx = idx;
    const c = document.getElementById('content');
    if (c) c.innerHTML = vVote();
};

async function doSubmitVote() {
    const nameEl = document.getElementById('voter-name');
    const name   = nameEl?.value.trim() || S.user.displayName || S.user.email || '';
    if (!name) { alert('請輸入您的名稱'); return; }
    if (!Object.keys(S.votes).length && !confirm('您還沒選擇任何時間，確定要提交嗎？')) return;
    try {
        const ref = doc(db,'polls',S.pollId);
        const upd = {};
        const authName = (S.user.displayName || S.user.email?.split('@')[0] || '').trim();
        upd[`responses.${S.user.uid}`] = { ...S.votes, _name: name, _authName: authName };
        await updateDoc(ref, upd);
        await setDoc(doc(db,'userPolls',`${S.user.uid}_${S.pollId}`),
            { uid: S.user.uid, pollId: S.pollId, joinedAt: new Date().toISOString() });
        if (!S.myPolls.find(p=>p.id===S.pollId) && !S.joinedPolls.find(p=>p.id===S.pollId)) {
            S.joinedPolls.unshift(S.poll);
        }
        go('results-loading');
    } catch(e) { alert('提交失敗：'+e.message); }
}

// ═══════════════════════════════════════════════════════════
//  DELETE POLL (creator only)
// ═══════════════════════════════════════════════════════════
window.doDeletePoll = async function() {
    if (!confirm(`確定要刪除活動「${S.poll.title}」嗎？\n\n刪除後，參與者仍可瀏覽結果並下載資料，168 小時後資料將自動失效。`)) return;
    try {
        await updateDoc(doc(db,'polls',S.pollId), {
            deleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: S.user.displayName || S.user.email,
        });
        // update local cache
        const idx = S.myPolls.findIndex(p => p.id === S.pollId);
        if (idx !== -1) { S.myPolls[idx].deleted = true; S.myPolls[idx].deletedAt = new Date().toISOString(); }
        alert('活動已刪除。參與者在 168 小時內仍可查看結果與下載資料。');
        go('dashboard');
    } catch(e) { alert('刪除失敗：'+e.message); }
};

// ═══════════════════════════════════════════════════════════
//  LEAVE POLL (participant)
// ═══════════════════════════════════════════════════════════
window.doLeavePoll = async function() {
    if (!confirm(`確定要離開活動「${S.poll.title}」嗎？\n\n您的填寫記錄將被刪除。`)) return;
    try {
        // Remove this user's response from the poll
        const upd = {};
        upd[`responses.${S.user.uid}`] = deleteField();
        await updateDoc(doc(db,'polls',S.pollId), upd);
        // Remove from userPolls
        const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        await deleteDoc(doc(db,'userPolls',`${S.user.uid}_${S.pollId}`));
        // Update local state
        S.joinedPolls = S.joinedPolls.filter(p => p.id !== S.pollId);
        S.votes = {};
        alert('您已離開活動。');
        go('dashboard');
    } catch(e) { alert('操作失敗：'+e.message); }
};

// ── Record tab renderer ───────────────────────────────────
function vResultsRecord(scored, outcomes, todayISO, isCreator, n) {
    const poll = S.poll;
    const pastSlots = scored
        .filter(s => s.slot.date && s.slot.date <= todayISO)
        .sort((a, b) => a.slot.date.localeCompare(b.slot.date));

    if (pastSlots.length === 0) {
        return `<p style="color:var(--text-m);text-align:center;padding:32px 0;font-size:14px">尚無過去的時段記錄</p>`;
    }

    return pastSlots.map(s => {
        const outcome = outcomes[s.slot.id];
        const outcomeBadge = outcome === 'success'
            ? `<span class="outcome-banner outcome-success">🏆 約團成功</span>`
            : outcome === 'failure'
            ? `<span class="outcome-banner outcome-failure">💔 約團失敗</span>`
            : `<span class="outcome-banner outcome-pending">⬜ 尚未確認</span>`;

        const summary = n > 0
            ? `<span class="ptag ptag-yes">✅ ${s.yes}</span><span class="ptag ptag-maybe">🟡 ${s.maybe}</span><span class="ptag ptag-no">❌ ${s.no}</span>`
            : `<span style="color:var(--text-m);font-size:12px">尚無人填寫</span>`;

        const outcomeSetRow = isCreator ? `
            <div class="outcome-set-row" style="margin-top:8px">
                <span style="font-size:11px;color:var(--text-m)">標記：</span>
                <button class="outcome-btn outcome-btn-success${outcome==='success'?' active':''}" onclick="doSetOutcome('${s.slot.id}','success')">🏆 成功</button>
                <button class="outcome-btn outcome-btn-failure${outcome==='failure'?' active':''}" onclick="doSetOutcome('${s.slot.id}','failure')">💔 失敗</button>
            </div>` : '';

        return `<div class="record-slot record-outcome-${outcome||'pending'}">
            <div class="record-slot-left">
                <div class="record-slot-date">${h(fmtSlot(s.slot))}</div>
                <div class="record-slot-summary">${summary}</div>
                ${outcomeSetRow}
            </div>
            <div class="record-slot-outcome">${outcomeBadge}</div>
        </div>`;
    }).join('');
}

// ── Outcome & tab helpers ─────────────────────────────────
window.doSetOutcome = async function(slotId, status) {
    if (!S.poll || S.poll.creatorUid !== S.user.uid) return;
    try {
        const ref = doc(db, 'polls', S.pollId);
        if ((S.poll.outcomes || {})[slotId] === status) {
            await updateDoc(ref, { [`outcomes.${slotId}`]: deleteField() });
        } else {
            await updateDoc(ref, { [`outcomes.${slotId}`]: status });
        }
    } catch(e) { alert('更新失敗：' + e.message); }
};
window.switchResultsTab = function(tab) {
    S.resultsTab = tab;
    const c = document.getElementById('content');
    if (c) c.innerHTML = vResults();
};

// ── Live results watcher ───────────────────────────────────
function listenResults() {
    const content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="loading">載入結果…<span class="spin"></span></div>';
    S.unsub = onSnapshot(doc(db,'polls',S.pollId), snap => {
        if (!snap.exists()) return;
        S.poll = snap.data();
        S.view = 'live';
        const c = document.getElementById('content');
        if (c) { c.innerHTML = vResults(); setTopbarTitle(); }
    }, err => errInContent(err.message));
}

// ═══════════════════════════════════════════════════════════
//  SLOT HEAT HELPERS
// ═══════════════════════════════════════════════════════════
function getSlotHeat(s, n, settings) {
    if (n === 0) return 'poor';
    const noThresh = Math.max(1, settings?.noThreshold ?? 1);
    const maybeAsNo = settings?.maybeAsNo ?? false;
    const effNo = s.no + (maybeAsNo ? s.maybe : 0);
    if (s.yes === n) return 'great';
    if (effNo === 0) return 'good';
    if (effNo < noThresh) return 'ok';
    return 'poor';
}
function getSlotLabel(s, n) {
    if (s.heat === 'great') return {t:'🌟 所有人都可以！', c:'sc-great'};
    if (s.heat === 'good')  return {t:'✅ 所有人都有空',  c:'sc-good'};
    if (n > 0 && s.yes+s.maybe === n-1) return {t:'👍 幾乎所有人有空', c:'sc-ok'};
    if (n > 0) return {t:`${s.yes+s.maybe}/${n} 人有空`, c:s.heat==='ok'?'sc-ok':'sc-poor'};
    return {t:'尚無人填寫', c:'sc-poor'};
}

// ═══════════════════════════════════════════════════════════
//  VIEW: RESULTS
// ═══════════════════════════════════════════════════════════
function vResults() {
    const poll = S.poll;
    const settings = poll.settings || {};
    const resp = poll.responses||{};
    const entries = Object.entries(resp).map(([uid, votes]) => ({
        name: votes._name || uid, uid, votes,
        authName: votes._authName || ''
    }));
    const n = entries.length;
    const isCreator = poll.creatorUid === S.user.uid;
    const outcomes = poll.outcomes || {};
    const todayISO = localISO(new Date());

    const scored = poll.slots.map(slot => {
        let yes=0,maybe=0,no=0;
        const yN=[],mN=[],xN=[];
        entries.forEach(({name,votes,authName}) => {
            const v = votes[slot.id];
            const disp = isCreator && authName && authName !== name ? `${name}(${authName})` : name;
            if(v==='yes'){yes++;yN.push(disp);}
            else if(v==='maybe'){maybe++;mN.push(disp);}
            else if(v==='no'){no++;xN.push(disp);}
        });
        const score = n>0 ? (yes*2+maybe)/(n*2) : 0;
        const heat = getSlotHeat({yes,maybe,no}, n, settings);
        return {slot,yes,maybe,no,score,yN,mN,xN,heat};
    }).sort((a,b)=>b.score-a.score);

    const tab = S.resultsTab || 'overview';
    const tabBar = `<div class="results-tab-bar">
        <button class="results-tab${tab==='overview'?' active':''}" onclick="switchResultsTab('overview')">📊 結果總覽</button>
        <button class="results-tab${tab==='record'?' active':''}" onclick="switchResultsTab('record')">📅 約團記錄</button>
    </div>`;

    const creatorBtns = isCreator && !poll.deleted ? `
        <button class="btn btn-outline btn-sm" onclick="startEditPoll()">✏️ 編輯活動</button>
        <button class="btn btn-danger btn-sm" onclick="doDeletePoll()">🗑️ 刪除活動</button>` : '';

    const deletedBanner = poll.deleted ? `<div class="alert alert-error">⚠️ 此活動已被刪除，資料僅供查閱與下載，無法再填寫。</div>` : '';
    const dlBtns = `
        <button class="btn btn-secondary btn-sm" onclick="dlHTML()">⬇ 下載 HTML</button>
        <button class="btn btn-secondary btn-sm" onclick="dlXLSX()">📊 下載 Excel</button>
        <button class="btn btn-secondary btn-sm" onclick="dlCSV()">📄 下載 CSV</button>`;

    const header = `<div class="card">
        <button class="nav-back" onclick="go('dashboard')">← 返回首頁</button>
        <div class="card-title" style="margin-bottom:8px">${h(poll.title)}</div>
        <div class="vote-action-bar">
            <div class="vote-action-row">
                ${!poll.deleted ? `<button class="btn btn-outline btn-sm" onclick="S.pollId='${poll.id}'; go('poll-loading')">📝 修改我的填寫</button>` : ''}
                ${creatorBtns}
            </div>
            <div class="copy-row" style="margin-top:8px">
                <span class="vote-code-lbl">代碼：<code>${h(S.pollId)}</code></span>
                <input class="copy-input" id="r-url" type="text" value="${h(shareUrl())}" readonly style="flex:1;min-width:100px"/>
                <button class="btn btn-secondary btn-sm" onclick="doCopy('r-url',this)">複製連結</button>
            </div>
        </div>
        ${deletedBanner}
        ${tabBar}`;

    // ── Record tab ──
    if (tab === 'record') {
        return header + vResultsRecord(scored, outcomes, todayISO, isCreator, n) + `
        <div class="divider"></div>
        <div class="btn-group">${dlBtns}</div>
    </div>`;
    }

    // ── Overview tab ──
    const best = scored.filter(s=>s.heat==='great'||s.heat==='good');
    const banner = best.length>0
        ? `<div class="alert alert-success">🌟 <strong>所有人都有空的時間：</strong>${best.map(s=>h(fmtSlot(s.slot))).join('、')}</div>`
        : (n>0?`<div class="alert alert-warning">⚠️ 目前沒有所有人都完全空閒的時間，請參考下方排序</div>`:'');

    const slotsHtml = scored.map((s,i)=>{
        const l = getSlotLabel(s, n);
        const yp=n>0?(s.yes/n*100).toFixed(0):0;
        const mp=n>0?(s.maybe/n*100).toFixed(0):0;
        const tags=[
            ...s.yN.map(nm=>`<span class="ptag ptag-yes">✅ ${h(nm)}</span>`),
            ...s.mN.map(nm=>`<span class="ptag ptag-maybe">🟡 ${h(nm)}</span>`),
            ...s.xN.map(nm=>`<span class="ptag ptag-no">❌ ${h(nm)}</span>`),
        ].join('');
        const gcData = JSON.stringify({t:poll.title,s:s.slot,d:poll.desc||''}).replace(/'/g,'&#39;');
        const gcBtn=`<button class="btn btn-sm" style="background:#4285F4;color:#fff;gap:4px" onclick='addGC(${gcData})'>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
            加入 Google 日曆</button>`;

        const outcome = outcomes[s.slot.id];
        const isPast = s.slot.date && s.slot.date <= todayISO;
        const outcomeBadge = outcome === 'success'
            ? `<span class="outcome-banner outcome-success">🏆 約團成功</span>`
            : outcome === 'failure'
            ? `<span class="outcome-banner outcome-failure">💔 約團失敗</span>`
            : '';
        const outcomeSetRow = (isCreator && isPast) ? `
            <div class="outcome-set-row">
                <span style="font-size:11px;color:var(--text-m)">標記結果：</span>
                <button class="outcome-btn outcome-btn-success${outcome==='success'?' active':''}" onclick="doSetOutcome('${s.slot.id}','success')">🏆 成功</button>
                <button class="outcome-btn outcome-btn-failure${outcome==='failure'?' active':''}" onclick="doSetOutcome('${s.slot.id}','failure')">💔 失敗</button>
            </div>` : '';

        return `<div class="result-slot heat-${s.heat}${outcome?' outcome-slot-'+outcome:''}" id="rs-${s.slot.date||i}">
            <div class="res-header">
                <div>
                    <div class="res-title">${h(fmtSlot(s.slot))}</div>
                    <span class="sc-badge ${l.c}" style="margin-top:5px;display:inline-block">${l.t}</span>
                    ${outcomeBadge}
                </div>
                <div style="margin-top:2px">${gcBtn}</div>
            </div>
            ${n>0?`
            <div class="bar-row"><span style="width:52px">✅ ${s.yes}人</span>
                <div class="bar-out"><div class="bar-in" style="width:${yp}%;background:var(--success)"></div></div>
            </div>
            <div class="bar-row"><span style="width:52px">🟡 ${s.maybe}人</span>
                <div class="bar-out"><div class="bar-in" style="width:${mp}%;background:var(--warning)"></div></div>
            </div>`:''}
            ${tags?`<div class="tag-list">${tags}</div>`:''}
            ${outcomeSetRow}
        </div>`;
    }).join('');

    return header + banner + `
        ${n>0 ? vCalendar(scored) : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 8px;flex-wrap:wrap;gap:8px">
            <p style="font-size:13px;color:var(--text-m);margin:0">📋 詳細列表（依可行性排序）<span class="live-dot" title="即時更新"></span></p>
            <p style="font-size:13px;color:var(--text-m);margin:0">${n} 人已填寫</p>
        </div>
        <div class="slot-list-scroll">${slotsHtml}</div>
        <div class="divider"></div>
        <div class="btn-group">${dlBtns}</div>
    </div>`;
}

// ── Route 'results-loading' and 'live-init' ────────────────
const origGo = go;
window.go = function(view, extra={}) {
    if (view === 'results-loading' || view === 'live-init') {
        Object.assign(S, extra); S.view = 'results-loading'; paint();
        S.calCursor = null;
        listenResults(); return;
    }
    origGo(view, extra);
};

// ═══════════════════════════════════════════════════════════
//  CALENDAR WIDGET
// ═══════════════════════════════════════════════════════════
function vCalendar(scored) {
    const daySlots = {};
    scored.forEach(s => {
        const d = s.slot.date;
        if (!d) return;
        if (!daySlots[d]) daySlots[d] = [];
        daySlots[d].push(s);
    });
    const allDates = Object.keys(daySlots).sort();
    if (!allDates.length) return '';
    if (!S.calCursor) S.calCursor = allDates[0];
    const cursor = new Date(S.calCursor + 'T00:00:00');
    const hRank = {great:3,good:2,ok:1,poor:0};
    const isMonth = S.calView !== 'week';
    let title, cells, prevCursor, nextCursor;

    if (isMonth) {
        const yr=cursor.getFullYear(), mo=cursor.getMonth();
        title = `${yr}年${mo+1}月`;
        const firstDay=new Date(yr,mo,1), lastDay=new Date(yr,mo+1,0);
        prevCursor = localISO(new Date(yr,mo-1,1));
        nextCursor = localISO(new Date(yr,mo+1,1));
        cells = [];
        for(let i=0;i<firstDay.getDay();i++) cells.push(null);
        for(let d=1;d<=lastDay.getDate();d++){
            const iso=`${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            cells.push({iso, d, slots:daySlots[iso]||[]});
        }
        const rem=(7-cells.length%7)%7;
        for(let i=0;i<rem;i++) cells.push(null);
    } else {
        const dow=cursor.getDay();
        const ws=new Date(cursor); ws.setDate(cursor.getDate()-dow);
        const we=new Date(ws); we.setDate(ws.getDate()+6);
        title=`${ws.getMonth()+1}/${ws.getDate()} – ${we.getMonth()+1}/${we.getDate()}`;
        const pv=new Date(ws); pv.setDate(ws.getDate()-7); prevCursor=localISO(pv);
        const nx=new Date(ws); nx.setDate(ws.getDate()+7); nextCursor=localISO(nx);
        cells=[];
        for(let i=0;i<7;i++){
            const d=new Date(ws); d.setDate(ws.getDate()+i);
            const iso=localISO(d);
            cells.push({iso, d:d.getDate(), slots:daySlots[iso]||[]});
        }
    }

    const wd=['日','一','二','三','四','五','六'];
    const headHtml=wd.map(w=>`<div class="cal-head">${w}</div>`).join('');
    const cellsHtml=cells.map(c=>{
        if(!c) return `<div class="cal-cell cal-pad"></div>`;
        let bestHeat='';
        if(c.slots.length){
            const best=c.slots.reduce((a,b)=>(hRank[a.heat]||0)>=(hRank[b.heat]||0)?a:b);
            bestHeat=best.heat;
        }
        const times=c.slots.slice(0,2).map(s=>`<div class="cal-time">${s.slot.start||''}${s.slot.end?' – '+s.slot.end:''}</div>`).join('');
        const more=c.slots.length>2?`<div class="cal-time cal-more">+${c.slots.length-2}</div>`:'';
        return `<div class="cal-cell${bestHeat?' cal-'+bestHeat:''}" onclick="calJump('${c.iso}')">
            <span class="cal-day-num">${c.d}</span>
            <div class="cal-slot-info">${times}${more}</div>
        </div>`;
    }).join('');

    return `<div class="cal-widget">
        <div class="cal-toolbar">
            <button class="btn btn-secondary btn-sm" onclick="calNav('${prevCursor}')">◀</button>
            <span class="cal-title">${title}</span>
            <button class="btn btn-secondary btn-sm" onclick="calNav('${nextCursor}')">▶</button>
            <span style="flex:1"></span>
            <button class="btn btn-sm ${S.calView==='month'?'btn-primary':'btn-secondary'}" onclick="calSwitch('month')">月</button>
            <button class="btn btn-sm ${S.calView==='week'?'btn-primary':'btn-secondary'}" onclick="calSwitch('week')">週</button>
        </div>
        <div class="cal-grid">${headHtml}${cellsHtml}</div>
        <div class="cal-legend">
            <span class="cal-leg"><span class="cal-leg-dot cal-great"></span>全員可以</span>
            <span class="cal-leg"><span class="cal-leg-dot cal-good"></span>全員有空</span>
            <span class="cal-leg"><span class="cal-leg-dot cal-ok"></span>部分有空</span>
            <span class="cal-leg"><span class="cal-leg-dot cal-poor"></span>有人無法</span>
        </div>
    </div>`;
}
window.calNav    = function(cursor) { S.calCursor=cursor; const c=document.getElementById('content'); if(c) c.innerHTML=vResults(); };
window.calSwitch = function(view)   { S.calView=view;     const c=document.getElementById('content'); if(c) c.innerHTML=vResults(); };
window.calJump   = function(iso) {
    const el=document.querySelector('[id^="rs-'+iso+'"]');
    if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'});
};

// ═══════════════════════════════════════════════════════════
//  EDIT POLL
// ═══════════════════════════════════════════════════════════
window.startEditPoll = function() {
    if(!S.poll) return;
    S.editMode = true;
    S.slots = S.poll.slots.map(s=>({...s}));
    S.draft = { title:S.poll.title, desc:S.poll.desc||'', settings:S.poll.settings||{} };
    go('edit-poll');
};
window.cancelEdit = function() {
    S.editMode = false; S.slots=[mkSlot()]; S.draft=null;
    go('live-init');
};

async function doSubmitEdit() {
    syncSlotsFromDom();
    const title=(document.getElementById('f-title')?.value||S.draft?.title||'').trim();
    const desc =(document.getElementById('f-desc')?.value||S.draft?.desc||'').trim();
    if(!title){alert('請輸入活動名稱');return;}
    const valid=S.slots.filter(s=>s.date&&s.start);
    if(!valid.length){alert('請至少填寫一個有日期＋開始時間的時間段');return;}
    const noThreshold=parseInt(document.querySelector('.no-thresh-btn.btn-primary')?.dataset?.val||'1');
    const maybeAsNo=document.getElementById('f-maybe-as-no')?.checked||false;
    try{
        await updateDoc(doc(db,'polls',S.pollId),{
            title,desc,
            slots:valid.map(s=>({id:s.id,date:s.date,start:s.start,end:s.end,label:fmtSlot(s)})),
            settings:{noThreshold,maybeAsNo},
            updatedAt:new Date().toISOString(),
        });
        Object.assign(S.poll,{title,desc,slots:valid.map(s=>({id:s.id,date:s.date,start:s.start,end:s.end})),settings:{noThreshold,maybeAsNo}});
        const idx=S.myPolls.findIndex(p=>p.id===S.pollId);
        if(idx!==-1) S.myPolls[idx]={...S.myPolls[idx],title,desc};
        S.editMode=false; S.slots=[mkSlot()]; S.draft=null;
        go('live-init');
    }catch(e){alert('儲存失敗：'+e.message);}
}

function vEditPoll() {
    const poll=S.poll;
    const today=new Date().toISOString().slice(0,10);
    const settings=S.draft?.settings||{};
    const noThresh=settings.noThreshold||1;
    const maybeAsNo=settings.maybeAsNo||false;
    const slotsHtml=S.slots.map(s=>`
        <div class="slot-row">
            <input class="fc" type="date" value="${h(s.date)}"
                onchange="slotSet('${s.id}','date',this.value)" />
            <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                placeholder="開始 HH:MM" value="${h(s.start)}"
                oninput="fmtTimeInput(this)"
                onchange="slotSet('${s.id}','start',this.value)" />
            <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                placeholder="結束 HH:MM" value="${h(s.end)}"
                oninput="fmtTimeInput(this)"
                onchange="slotSet('${s.id}','end',this.value)" />
            <button class="btn btn-secondary btn-sm remove-btn" onclick="slotRemove('${s.id}')"
                ${S.slots.length===1?'disabled':''}>✕</button>
        </div>`).join('');

    return `<div class="card">
        <button class="nav-back" onclick="cancelEdit()">← 取消編輯</button>
        <div class="card-title">✏️ 編輯活動</div>
        <div class="card-sub">${h(poll.title)}</div>
        <div class="form-group"><label>活動名稱 *</label>
            <input class="fc" id="f-title" type="text" maxlength="100" value="${h(S.draft?.title||poll.title||'')}" /></div>
        <div class="form-group"><label>描述（可選）</label>
            <textarea class="fc" id="f-desc" rows="2" maxlength="400">${h(S.draft?.desc??poll.desc??'')}</textarea></div>
        <div class="form-group">
            <label>候選時間段</label>
            <p style="font-size:12px;color:var(--text-m);margin-bottom:9px">日期 ｜ 開始時間 ｜ 結束時間（可留空）</p>
            <div id="slots-wrap">${slotsHtml}</div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="slotAdd()">＋ 新增時間段</button>
                <button class="btn btn-outline btn-sm" onclick="toggleBatchPanel()">📅 批次套用日期範圍</button>
            </div>
        </div>
        <div class="batch-panel" id="batch-panel" style="display:none">
            <p style="font-weight:600;font-size:13px;margin-bottom:10px">📅 批次新增時間段</p>
            <p style="font-size:12px;color:var(--text-m);margin-bottom:10px">依照下方設定，對日期範圍內每天新增一個時間段</p>
            <div class="date-range-row">
                <div style="flex:1;min-width:130px"><label>開始日期</label>
                    <input class="fc" type="date" id="batch-start-date" min="${today}" /></div>
                <div style="align-self:flex-end;padding-bottom:10px;color:var(--text-m)">～</div>
                <div style="flex:1;min-width:130px"><label>結束日期</label>
                    <input class="fc" type="date" id="batch-end-date" min="${today}" /></div>
            </div>
            <div class="date-range-row" style="margin-top:8px">
                <div style="flex:1;min-width:130px"><label>開始時間</label>
                    <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                        placeholder="HH:MM" id="batch-start-time" oninput="fmtTimeInput(this)" /></div>
                <div style="align-self:flex-end;padding-bottom:10px;color:var(--text-m)">～</div>
                <div style="flex:1;min-width:130px"><label>結束時間（可留空）</label>
                    <input class="fc time-fc" type="text" inputmode="numeric" maxlength="5"
                        placeholder="HH:MM" id="batch-end-time" oninput="fmtTimeInput(this)" /></div>
            </div>
            <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="slotBatchAdd()">套用</button>
        </div>
        <div class="form-group" style="margin-top:16px">
            <label>🎨 顏色判定設定</label>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
                <span style="font-size:13px;color:var(--text-m)">幾人「不行」才顯示紅色：</span>
                <div class="btn-group">
                    ${[1,2,3,4].map(v=>`<button class="btn btn-sm no-thresh-btn ${noThresh===v?'btn-primary':'btn-secondary'}" data-val="${v}" onclick="setNoThresh(${v})">${v}人</button>`).join('')}
                </div>
            </div>
            <label class="checkbox-label">
                <input type="checkbox" id="f-maybe-as-no" ${maybeAsNo?'checked':''}> 將「大概可以」視為「不行」計算
            </label>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
            <button class="btn btn-primary btn-lg" onclick="doSubmitEdit()">儲存修改 ✓</button>
            <button class="btn btn-secondary" onclick="cancelEdit()">取消</button>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  GOOGLE CALENDAR
// ═══════════════════════════════════════════════════════════
window.addGC = function(data) {
    const {t,s,d} = data;
    const date = s.date.replace(/-/g,'');
    const st   = (s.start||'09:00').replace(':','')+'00';
    const et   = s.end ? s.end.replace(':','')+'00' : nextHour(s.start||'09:00');
    const url  = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action','TEMPLATE');
    url.searchParams.set('text',t);
    url.searchParams.set('dates',`${date}T${st}/${date}T${et}`);
    if (d) url.searchParams.set('details',d);
    window.open(url.toString(),'_blank','noopener,noreferrer');
};
function nextHour(t){ const [hh,mm]=t.split(':').map(Number); return String((hh+1)%24).padStart(2,'0')+String(mm).padStart(2,'0')+'00'; }

// ═══════════════════════════════════════════════════════════
//  DOWNLOAD FUNCTIONS
// ═══════════════════════════════════════════════════════════
function getTableData() {
    const poll = S.poll;
    const resp = poll.responses||{};
    const entries = Object.entries(resp).map(([uid,votes])=>({name:votes._name||uid,votes}));
    const slots = poll.slots;
    const icon = {yes:'✅',maybe:'🟡',no:'❌','':'-'};
    const header = ['時間段', ...entries.map(e=>e.name),'✅ 可以','🟡 大概可以','❌ 不行'];
    const rows = slots.map(slot => {
        let yes=0,maybe=0,no=0;
        const cols = entries.map(e=>{
            const v=e.votes[slot.id]||'';
            if(v==='yes')yes++; else if(v==='maybe')maybe++; else if(v==='no')no++;
            return icon[v]||'-';
        });
        return [fmtSlot(slot), ...cols, yes, maybe, no];
    });
    return {header, rows, title: poll.title};
}

window.dlCSV = function() {
    const {header,rows,title} = getTableData();
    const csv = [header,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    triggerDownload('\uFEFF'+csv, `${title}_結果.csv`, 'text/csv;charset=utf-8');
};

window.dlXLSX = function() {
    if (typeof XLSX === 'undefined') { alert('XLSX 函式庫尚未載入，請稍後再試'); return; }
    const {header,rows,title} = getTableData();
    const ws = XLSX.utils.aoa_to_sheet([header,...rows]);
    ws['!cols'] = [{wch:28}, ...Array(header.length-1).fill({wch:12})];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '結果');
    XLSX.writeFile(wb, `${title}_結果.xlsx`);
};

window.dlHTML = function() {
    const poll = S.poll;
    const resp = poll.responses||{};
    const entries = Object.entries(resp).map(([uid,votes])=>({name:votes._name||uid,votes}));
    const {header,rows} = getTableData();
    const thHtml = header.map(c=>`<th>${hStatic(c)}</th>`).join('');
    const tdRows = rows.map(r=>`<tr>${r.map(c=>`<td>${hStatic(String(c))}</td>`).join('')}</tr>`).join('');
    const now = new Date().toLocaleString('zh-TW');
    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>${hStatic(poll.title)} — 結果</title>
<style>body{font-family:sans-serif;padding:24px;color:#1e293b}h1{margin-bottom:4px}p.sub{color:#64748b;margin-bottom:20px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:8px 12px;font-size:14px;text-align:center}
th{background:#6366f1;color:#fff}tr:nth-child(even){background:#f8fafc}.meta{font-size:12px;color:#94a3b8;margin-top:16px}</style>
</head><body>
<h1>📅 ${hStatic(poll.title)}</h1>
<p class="sub">${poll.desc?hStatic(poll.desc)+'<br>':''
}由 ${hStatic(poll.creator)} 建立・${entries.length} 人已填寫</p>
<table><thead><tr>${thHtml}</tr></thead><tbody>${tdRows}</tbody></table>
<p class="meta">匯出時間：${now}</p>
</body></html>`;
    triggerDownload(html, `${poll.title}_結果.html`, 'text/html;charset=utf-8');
};

function hStatic(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function triggerDownload(content, filename, mime) {
    const blob = new Blob([content], {type: mime});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════
function fmtSlot(s) {
    if (!s) return '';
    const ds = s.date ? fmtDate(s.date) : '未設定日期';
    const ts = s.start ? (s.end ? `${s.start} – ${s.end}` : s.start) : '';
    return ts ? `${ds}　${ts}` : ds;
}
function fmtDate(ds) {
    if (!ds) return '';
    const d  = new Date(ds+'T00:00:00');
    const wd = ['日','一','二','三','四','五','六'][d.getDay()];
    return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${wd}）`;
}
function localISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Expose globals ─────────────────────────────────────────
Object.assign(window, { S, go: window.go, doSubmitCreate, doSubmitVote, doSubmitEdit, doSignOut, doSetOutcome: window.doSetOutcome, switchResultsTab: window.switchResultsTab });

init();
