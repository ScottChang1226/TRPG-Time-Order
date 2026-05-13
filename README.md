# 📅 時間協調工具

像 Doodle / When2Meet 的免費時間投票工具，支援即時同步與 Google 日曆匯出。

## 功能

### 帳號系統
- **Email / 密碼** 註冊登入
- **Google 帳號** 一鍵登入（OAuth）
- 登入後以 UID 識別，防止假冒姓名重複投票

### 可收合側邊欄
- 📋 **我建立的活動** — 列出自己建立的所有活動
- 👥 **我參加過的活動** — 列出曾填寫時間的活動
- 點選任一活動可直接跳轉

### 活動功能
- 建立活動並設定多個候選時間段
- 產生分享連結，讓所有人填寫可用時間（✅ 可以 / 🟡 大概可以 / ❌ 不行）
- 即時顯示結果，以熱力圖排序所有時間段
- 自動標出「所有人都有空」的時間
- 一鍵新增最佳時段到 **Google 日曆**（無需 API 金鑰）

### 下載離線檔案
| 按鈕 | 格式 | 說明 |
|------|------|------|
| ⬇ 下載 HTML | `.html` | 可直接用瀏覽器開啟的離線報表 |
| 📊 下載 Excel | `.xlsx` | 可用 Excel / Numbers 開啟 |
| 📄 下載 CSV | `.csv` | 純文字，通用格式 |

---

## 免費部署步驟

### 第一步：建立 Firebase 專案（免費）

1. 前往 [Firebase Console](https://console.firebase.google.com)
2. 點「建立專案」→ 輸入名稱 → 選**免費 Spark 方案**
3. 建立後，左側選單點「**Firestore Database**」→「建立資料庫」→ 選「**測試模式**」
4. 左側選單點「**Authentication**」→「開始使用」→ 啟用以下登入方式：
   - **電子郵件/密碼**：直接啟用
   - **Google**：啟用，填入專案支援 Email

> **測試模式**：允許任何人讀寫，適合快速測試。正式使用請設定安全規則（見下方）。

5. 點左上角齒輪⚙️→「**專案設定**」
6. 往下找「**您的應用程式**」→ 點「**&lt;/&gt;**」（網頁應用程式）
7. 輸入應用程式暱稱 → 點「繼續」
8. 複製顯示的 `firebaseConfig` 物件內容

### 第二步：設定 index.html

開啟 `index.html`，找到這個區塊並替換：

```javascript
const FIREBASE_CONFIG = {
    apiKey:            "YOUR_API_KEY",         // ← 替換
    authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
    projectId:         "YOUR_PROJECT_ID",       // ← 替換
    storageBucket:     "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId:             "YOUR_APP_ID"
};
```

### 第三步：部署（選一種）

#### 選項 A：GitHub Pages（最簡單，完全免費）

1. 建立 GitHub 帳號（免費），新建 repository
2. 將 `index.html` 上傳到 repository
3. 進入 repo 設定 → Pages → Branch: main → 資料夾: `/（root）`
4. 網址會是 `https://你的帳號.github.io/repo名稱/`

#### 選項 B：Firebase Hosting（與 Firestore 同專案，免費）

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # 選擇您的專案，public 資料夾設為 .
firebase deploy
```

#### 選項 C：Netlify（拖曳上傳，免費）

1. 前往 [netlify.com](https://netlify.com) 登入
2. 主頁直接把 `meeting-scheduler` 資料夾拖進去即可

---

## Firestore 安全規則（正式使用建議）

在 Firebase Console → Firestore → 規則，貼上：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /polls/{pollId} {
      // 任何登入者都可讀取活動
      allow read: if request.auth != null;
      // 只有登入者可建立，且必須包含必要欄位
      allow create: if request.auth != null
                    && request.resource.data.keys().hasAll(['title','creator','creatorUid','slots','responses'])
                    && request.resource.data.creatorUid == request.auth.uid
                    && request.resource.data.title is string
                    && request.resource.data.title.size() <= 100;
      // 只能更新 responses 欄位（投票用）
      allow update: if request.auth != null
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['responses']);
    }

    match /userPolls/{docId} {
      // 只能讀寫自己的參與記錄
      allow read, write: if request.auth != null
                         && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null
                    && request.auth.uid == request.resource.data.uid;
    }
  }
}
```

---

## 使用流程

```
建立者                            參與者
   |                                |
   ├── 點「建立新活動」              |
   ├── 填入活動名稱、時間段          |
   ├── 取得活動代碼 / 分享連結       |
   │                                ├── 開啟分享連結
   │                                ├── 輸入姓名
   │                                ├── 勾選可用時間
   │                                └── 提交
   │                                |
   └── 開啟結果頁面（即時同步）
       ├── 查看熱力圖排序
       ├── 看到最佳時間段
       └── 點「加入 Google 日曆」
```

---

## 技術說明

| 項目 | 技術 | 費用 |
|------|------|------|
| 前端 | 純 HTML + CSS + Vanilla JS | 免費 |
| 身分驗證 | Firebase Authentication | 免費：不限用戶數 |
| 資料庫 | Firebase Firestore（Spark 方案） | 免費：1GB 儲存、50K 讀/天、20K 寫/天 |
| 托管 | GitHub Pages / Netlify / Firebase Hosting | 免費 |
| Google 日曆 | URL Scheme（無需 API 金鑰） | 免費 |
| Excel 匯出 | SheetJS CDN | 免費（MIT 授權）|

> Firebase Spark 免費額度對一般小型活動綽綽有餘。
